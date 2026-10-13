// ✨ Sparkles economy: wallet, earning rules, character shops, gifts. Pure helpers are exported for scripts/test-economy.mjs.
import { invoke } from "@tauri-apps/api/core";
import { Character, closenessLabel, GIFT } from "./types";
export { GIFT };
import { parseJson } from "./mind";
import { toText } from "./text";
import { STALL_TYPES, typeItem, typeRules } from "./itemtypes";

export const SPARK = "\u2728";
export interface Tx { id: number; amount: number; kind: string; reason: string; createdAt: number; }
export interface Item { id: number; owner: string; name: string; emoji: string; description: string; price: number; wearable: boolean; fromChar: string; acquiredAt: number; giftedAt: number | null; qty: number; tags: string; }
export interface StockItem { name: string; emoji: string; description: string; price: number; rarity: "common" | "rare" | "special"; wearable: boolean; sold?: boolean; itemType?: string; }
export interface Stock { stallName: string; tagline: string; items: StockItem[]; }

export const econApi = {
  balance: () => invoke<number>("econ_balance"),
  add: (amount: number, kind: string, reason: string) => invoke<number>("econ_add", { amount: Math.round(amount), kind, reason }),
  history: (limit = 50) => invoke<Tx[]>("econ_history", { limit }),
  earnedSince: (kind: string, since: number) => invoke<number>("econ_earned_since", { kind, since }),
  shopGet: (characterId: string, day: string) => invoke<Stock | null>("shop_get", { characterId, day }),
  shopSet: (characterId: string, day: string, data: Stock) => invoke<void>("shop_set", { characterId, day, data }),
  shopBuy: (characterId: string, day: string, index: number, price: number) => invoke<[Item, number]>("shop_buy", { characterId, day, index, price }),
  inventory: (owner: string | null = null) => invoke<Item[]>("inventory_list", { owner }),
  gift: (id: number, characterId: string) => invoke<Item>("gift_item", { id, characterId }),
  sell: (id: number, price: number, to: string) => invoke<number>("sell_item", { id, price, to }),
  kvGet: <T,>(key: string) => invoke<T | null>("kv_get", { key }),
  kvSet: (key: string, value: unknown) => invoke<void>("kv_set", { key, value }),
};

// ---- change notifications (wallet badge, toasts) ----------------------------
type Listener = (balance: number, note?: string) => void;
const listeners = new Set<Listener>();
export const onWallet = (f: Listener) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const emitWallet = (balance: number, note?: string) => listeners.forEach((f) => f(balance, note));
/** Earn (or spend) and tell the UI. */
export async function earn(amount: number, kind: string, reason: string, toast = true): Promise<number> {
  const b = await econApi.add(amount, kind, reason);
  emitWallet(b, toast && amount > 0 ? `+${Math.round(amount)} ${SPARK} ${reason}` : undefined);
  return b;
}

// ---- earning rules ----------------------------------------------------------
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
export const CHAT_REWARD = 3;
export const CHAT_DAILY_CAP = 120;
export const LEVEL_REWARD = 50;
export const MILESTONE_REWARD = 60;

/** Daily login: 20 + 10 per streak day, max 100. Streak breaks after a missed day. */
export function nextStreak(prev: { day: string; streak: number } | null, today: string): { day: string; streak: number; reward: number } | null {
  if (prev?.day === today) return null;
  const y = new Date(today + "T12:00:00"); y.setDate(y.getDate() - 1);
  const streak = prev && prev.day === dayKey(y) ? prev.streak + 1 : 1;
  return { day: today, streak, reward: Math.min(100, 20 + 10 * (streak - 1)) };
}
export async function dailyLogin(now = new Date()): Promise<{ streak: number; reward: number } | null> {
  const prev = await econApi.kvGet<{ day: string; streak: number }>("econ_streak");
  const n = nextStreak(prev, dayKey(now));
  if (!n) return null;
  await econApi.kvSet("econ_streak", { day: n.day, streak: n.streak });
  await earn(n.reward, "daily", `Daily visit (day ${n.streak} streak)`);
  return n;
}
/** A real chat message earns a few Sparkles, up to a daily cap. */
export const chatWorthy = (text: string) => text.trim().length >= 4 && !text.startsWith("[");
export async function chatEarn(text: string, now = new Date()): Promise<number> {
  if (!chatWorthy(text)) return 0;
  const got = await econApi.earnedSince("chat", startOfDay(now));
  const amt = Math.min(CHAT_REWARD, CHAT_DAILY_CAP - got);
  if (amt <= 0) return 0;
  await earn(amt, "chat", "Chatting", false);
  return amt;
}
/** Closeness level index (stranger=0 ... best friend=5). */
export const LEVELS = ["stranger", "acquaintance", "friend", "good friend", "close friend", "best friend"];
export const levelOf = (closeness: number) => LEVELS.indexOf(closenessLabel(closeness));
/** Reward each new closeness level per character once. */
export async function closenessReward(c: Character): Promise<number> {
  const lvl = levelOf(c.closeness);
  const key = `econ_level_${c.id}`;
  const best = await econApi.kvGet<number>(key);
  if (best === null) { await econApi.kvSet(key, lvl); return 0; } // first sight: no back-pay
  if (lvl <= best) return 0;
  await econApi.kvSet(key, lvl);
  const amt = LEVEL_REWARD * (lvl - best);
  await earn(amt, "closeness", `${c.name} now feels like a ${LEVELS[lvl]}`);
  return amt;
}
/** Pays for milestones not yet paid. The first run pays a one-off welcome bonus instead of back-pay. */
export async function milestoneRewards(list: { id: number; title: string; characterId: string }[], names: Map<string, string>): Promise<number> {
  const paid = await econApi.kvGet<number[]>("econ_paid_milestones");
  if (paid === null) {
    await econApi.kvSet("econ_paid_milestones", list.map((m) => m.id));
    await earn(100, "milestone", "Welcome to Sparkles!");
    return 100;
  }
  const seen = new Set(paid); let total = 0;
  for (const m of list) if (!seen.has(m.id)) {
    seen.add(m.id); total += MILESTONE_REWARD;
    await earn(MILESTONE_REWARD, "milestone", `${names.get(m.characterId) ?? "Milestone"}: ${m.title}`);
  }
  if (total) await econApi.kvSet("econ_paid_milestones", [...seen]);
  return total;
}
const EVENTS = ["found some coins on a walk", "won a little raffle", "found Sparkles in an old coat pocket", "got a refund you forgot about", "had a lucky scratch card"];
/** Random small windfall (called about once a minute). */
export function randomEvent(rand = Math.random): { amount: number; reason: string } | null {
  if (rand() > 1 / 120) return null;
  return { amount: 10 + Math.floor(rand() * 41), reason: `You ${EVENTS[Math.floor(rand() * EVENTS.length)]}!` };
}

// ---- shops ------------------------------------------------------------------
export const PRICE_RANGE: Record<StockItem["rarity"], [number, number]> = { common: [15, 90], rare: [90, 350], special: [350, 1200] };
/** Special items are friends-only. */
export const SPECIAL_MIN_CLOSENESS = 55;
export function closenessDiscount(closeness: number): number { return closeness >= 90 ? 0.15 : closeness >= 75 ? 0.1 : closeness >= 55 ? 0.05 : 0; }
const hash = (s: string) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
/** About one day in five a stall has a sale (same answer all day). */
export const saleToday = (charId: string, day: string) => hash(charId + day) % 5 === 0 ? 0.2 : 0;
export function priceFor(item: StockItem, c: Character, day: string): { price: number; off: number } {
  const off = Math.min(0.35, closenessDiscount(c.closeness) + saleToday(c.id, day));
  return { price: Math.max(1, Math.round(item.price * (1 - off))), off };
}
/** What a shop pays back: 40%, 50% to the character who sold it to you. */
export const sellValue = (it: Item, toSeller: boolean) => Math.max(1, Math.floor(it.price * (toSeller ? 0.5 : 0.4)));

export function buildStockPrompt(c: Character, userName: string, recent: string[] = []) {
  return [
    { role: "system", content: [
      `You design a small market stall run by ${c.name} in a cosy messenger game. Currency: Sparkles.`,
      `About ${c.name}: ${[c.personality, c.backstory].filter(Boolean).join(" ").slice(0, 700) || "a friendly character"}.`,
      `The stall sells things ${c.name} would plausibly make, collect or love: match their job, hobbies and personality. Things ${userName} could keep or give as gifts.`,
      "Give 5 different items: 3 common (15-90 Sparkles), 1 rare (90-350) and 1 special (350-1200).",
      "Each item: name (max 5 words), item_type, colour, material, a short description (max 20 words), price (integer), rarity, wearable (true only for clothing or accessories someone could wear).",
      typeRules(` (${STALL_TYPES.join(", ")})`),
      "Keep everything wholesome and non-sexual.",
      recent.length ? `Avoid repeating these recent items: ${recent.join(", ")}.` : "",
      'Respond only with JSON: {"stallName": "...", "tagline": "...", "items": [{"name": "...", "item_type": "...", "colour": "...", "material": "...", "description": "...", "price": 40, "rarity": "common", "wearable": false}]}',
    ].filter(Boolean).join("\n") },
    { role: "user", content: `Today's stock for ${c.name}'s stall.` },
  ];
}
/** Validates model output into a stock (clamped prices, max 6 items, no dupes). */
export function normalizeStock(raw: unknown, c: Character): Stock | null {
  const v = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(v.items) ? v.items : [];
  const seen = new Set<string>(); const items: StockItem[] = [];
  for (const r of list as Record<string, unknown>[]) {
    const typed = typeItem(r ?? {}, toText(r?.name).replace(/["*]/g, "").trim().slice(0, 40), toText(r?.description), STALL_TYPES);
    if (!typed) continue; // vague: no concrete item type
    const name = typed.name;
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const rarity = (["common", "rare", "special"] as const).find((x) => x === String(r.rarity).toLowerCase()) ?? "common";
    const [lo, hi] = PRICE_RANGE[rarity];
    const p = Math.round(Number(r.price));
    items.push({ name, emoji: typed.emoji, itemType: typed.itemType, description: typed.description, rarity,
      price: Number.isFinite(p) ? Math.min(hi, Math.max(lo, p)) : lo, wearable: r.wearable === true || r.wearable === "true" });
    if (items.length >= 6) break;
  }
  if (items.length < 2) return null;
  return { stallName: toText(v.stallName).slice(0, 40) || `${c.name}'s stall`, tagline: toText(v.tagline).slice(0, 80), items };
}
export type JsonFn = (model: string, messages: { role: string; content: string }[], temperature?: number) => Promise<string>;
/** Today's stock for a character: stored, or generated once with Ollama. */
export async function getStock(c: Character, userName: string, json: JsonFn, day = dayKey()): Promise<Stock> {
  const have = await econApi.shopGet(c.id, day);
  if (have && Array.isArray(have.items)) return have;
  const recent = (await econApi.kvGet<string[]>(`shop_recent_${c.id}`)) ?? [];
  let stock: Stock | null = null;
  for (let i = 0; i < 2 && !stock; i++) stock = normalizeStock(parseJson(await json(c.model, buildStockPrompt(c, userName, recent), 0.9)), c);
  if (!stock) throw new Error(`${c.name}'s stall couldn't be stocked (the model gave no usable items). Try again.`);
  await econApi.shopSet(c.id, day, stock);
  await econApi.kvSet(`shop_recent_${c.id}`, [...stock.items.map((x) => x.name), ...recent].slice(0, 15));
  return stock;
}

// ---- gifts in prompts -------------------------------------------------------
/** Character inventories cached for synchronous prompt building (selfies). */
const giftCache = new Map<string, Item[]>();
export async function refreshGifts(): Promise<void> {
  const all = await econApi.inventory(null);
  giftCache.clear();
  for (const it of all) if (it.owner !== "me") giftCache.set(it.owner, [...(giftCache.get(it.owner) ?? []), it]);
}
/** 18+ items are only ever visible (prompts, selfies, inventory) while adult content is on. */
let adultOn = false;
export const setAdultFlag = (on: boolean) => { adultOn = on; };
export const adultFlag = () => adultOn;
export const isAdultItem = (it: { tags?: string | string[] }) => (Array.isArray(it.tags) ? it.tags : (it.tags ?? "").split(",")).some((t) => t.trim() === "18+");
export const visibleItem = (it: { tags?: string | string[] }) => adultOn || !isAdultItem(it);
/** Every item a character owns, 18+ included (callers apply the gates). */
export const allGiftsOf = (charId: string) => giftCache.get(charId) ?? [];
export const giftsOf = (charId: string) => (giftCache.get(charId) ?? []).filter(visibleItem);
export const setGiftsFor = (charId: string, items: Item[]) => { giftCache.set(charId, items); };
const ago = (t: number, now: number) => { const d = Math.floor((now - t) / 86400_000); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };
/** Short context line about gifts the character owns. */
export function giftsPrompt(items: Item[], userName: string, now = Date.now()): string {
  if (!items.length) return "";
  const list = items.slice(0, 6).map((i) => `${i.emoji} ${i.name}${i.giftedAt ? ` (${ago(i.giftedAt, now)})` : ""}`).join(", ");
  return `Gifts ${userName} has given you that you still have: ${list}. You may mention or use them now and then when natural.`;
}
/** A wearable gift for a selfie, sometimes (rand < 0.5). */
export function selfieGift(items: Item[], rand = Math.random): string {
  const w = items.filter((i) => i.wearable);
  if (!w.length || rand() >= 0.5) return "";
  return `wearing ${w[Math.floor(rand() * w.length)].name.toLowerCase()}`;
}
/** Text stored in chat when Alex gives a gift. */
export const giftMessage = (it: Item) => `${GIFT} ${it.emoji} ${it.name}${it.description ? ` \u2013 ${it.description}` : ""}`;
export const giftNote = (c: Character, it: Item, userName: string) =>
  `[Event: ${userName} just gave you (${c.name}) a gift: ${it.emoji} ${it.name} (${it.description || "a present"}). It now belongs to you.] You are the one RECEIVING this gift from ${userName}. React in character, naturally and briefly, showing how you feel about it (thanking ${userName} is natural). You keep it.`;
