// 🏬 Shopping Centre: built-in catalogue, daily featured, weekly deals, basket, gift fit. Pure helpers are tested in scripts/test-economy.mjs.
import { invoke } from "@tauri-apps/api/core";
import { CATALOG_RAW, DEPARTMENTS, DeptId } from "./mallcatalog";
import { Character } from "./types";
import { isFamily, isRomantic, lifeOf } from "./lifecore";
import { dayKey, econApi, Item, JsonFn } from "./economy";
import { parseJson } from "./mind";
import { toText } from "./text";
import { listFor, typeItem, typeRules, typesFor } from "./itemtypes";
export { DEPARTMENTS };
export type { DeptId };

export const TAGS = ["cosy", "sporty", "romantic", "nerdy", "gamer", "artsy", "music", "bookish", "foodie", "outdoorsy", "nature", "glam", "cute", "luxury", "spooky", "family", "practical", "festive"] as const;
export interface MallItem { sku: string; dept: string; emoji: string; name: string; description: string; tier: 1 | 2 | 3 | 4; price: number; tags: string[]; wearable: boolean; itemType?: string; }
export const TIER_RANGE: Record<number, [number, number]> = { 1: [8, 40], 2: [40, 120], 3: [120, 350], 4: [350, 1200] };
export const hash = (s: string) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
/** Stable price inside the tier range, rounded to 5 (or 1 under 20). */
export function tierPrice(name: string, tier: number): number {
  const [lo, hi] = TIER_RANGE[tier] ?? TIER_RANGE[1];
  const raw = lo + (hash(name) % 1000) / 1000 * (hi - lo);
  return raw < 20 ? Math.round(raw) : Math.round(raw / 5) * 5;
}
export function parseCatalog(raw: Record<string, string> = CATALOG_RAW): MallItem[] {
  const out: MallItem[] = [];
  for (const [dept, text] of Object.entries(raw)) for (const line of text.split("\n")) {
    const p = line.split("|").map((x) => x.trim());
    if (p.length < 5 || !p[1]) continue;
    const tier = Math.min(4, Math.max(1, Number(p[3]) || 1)) as MallItem["tier"];
    out.push({ sku: `${dept}:${p[1].toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, dept: dept as DeptId, emoji: p[0], name: p[1], description: p[2], tier,
      price: tierPrice(p[1], tier), tags: p[4].split(",").map((t) => t.trim()).filter(Boolean), wearable: p[5] === "w" });
  }
  return out;
}
export const CATALOG = parseCatalog();

// ---- rotation ---------------------------------------------------------------
export const weekKey = (d = new Date()) => { const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return dayKey(t); };
function pick<T>(list: T[], n: number, seed: string): T[] {
  return [...list].map((x, i) => ({ x, k: hash(seed + i) })).sort((a, b) => a.k - b.k).slice(0, n).map((y) => y.x);
}
/** 8 "new in" items, the same all day, spread over departments. */
export const featured = (day = dayKey(), cat = CATALOG) => pick(cat, 8, `feat${day}`);
export const DEAL_OFF = 0.25;
/** 6 deals per week at 25% off. */
export const weeklyDeals = (week = weekKey(), cat = CATALOG) => pick(cat.filter((i) => i.tier >= 2), 6, `deal${week}`);
export const priceOf = (it: MallItem, deals: Set<string>) => deals.has(it.sku) ? Math.max(1, Math.round(it.price * (1 - DEAL_OFF))) : it.price;

// ---- search -----------------------------------------------------------------
export type PriceBand = "any" | "1" | "2" | "3" | "4";
export const PRICE_BANDS: { id: PriceBand; label: string }[] = [
  { id: "any", label: "Any price" }, { id: "1", label: "Under 40" }, { id: "2", label: "40\u2013120" }, { id: "3", label: "120\u2013350" }, { id: "4", label: "350+" }];
export function search(items: MallItem[], q: string, dept: DeptId | "all", band: PriceBand, tag = ""): MallItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((i) => (dept === "all" || i.dept === dept) && (band === "any" || i.tier === Number(band)) && (!tag || i.tags.includes(tag))
    && words.every((w) => `${i.name} ${i.description} ${i.tags.join(" ")} ${i.dept}`.toLowerCase().includes(w)));
}

// ---- basket -----------------------------------------------------------------
export interface BasketLine { item: MallItem; qty: number; unit: number; }
export function addToBasket(b: BasketLine[], item: MallItem, unit: number, qty = 1): BasketLine[] {
  const have = b.find((l) => l.item.sku === item.sku);
  if (have) return b.map((l) => l === have ? { ...l, qty: Math.min(99, l.qty + qty) } : l);
  return [...b, { item, qty: Math.min(99, qty), unit }];
}
export const setQty = (b: BasketLine[], sku: string, qty: number) => qty <= 0 ? b.filter((l) => l.item.sku !== sku) : b.map((l) => l.item.sku === sku ? { ...l, qty: Math.min(99, qty) } : l);
export const basketTotal = (b: BasketLine[]) => b.reduce((n, l) => n + l.unit * l.qty, 0);
export const basketCount = (b: BasketLine[]) => b.reduce((n, l) => n + l.qty, 0);
export function checkout(b: BasketLine[], source: "mall" | "afterdark" = "mall") {
  const lines = b.map((l) => ({ name: l.item.name, emoji: l.item.emoji, description: l.item.description, price: l.unit, qty: l.qty, wearable: l.item.wearable, tags: l.item.tags.join(","), source }));
  return invoke<[Item[], number]>("mall_checkout", { lines });
}

// ---- gift fit -----------------------------------------------------------------
const LIKES: Record<string, string[]> = {
  cosy: ["cosy", "cozy", "warm", "homebody", "blanket", "rain", "knit", "snug", "quiet night"],
  sporty: ["sport", "gym", "run", "football", "athlet", "fitness", "climb", "swim", "cycl", "hike", "yoga"],
  romantic: ["romantic", "flirt", "love letter", "hopeless romantic"],
  nerdy: ["nerd", "geek", "science", "tech", "code", "coding", "program", "puzzle", "comic", "sci-fi", "fantasy", "astronom", "engineer"],
  gamer: ["game", "gaming", "gamer", "console", "esport"],
  artsy: ["art", "paint", "draw", "creative", "design", "craft", "photograph", "illustrat", "pottery"],
  music: ["music", "sing", "guitar", "band", "piano", "song", "dj", "concert"],
  bookish: ["book", "read", "librar", "writer", "poet", "novel", "literat"],
  foodie: ["food", "cook", "bak", "chef", "caf\u00E9", "cafe", "coffee", "pastr", "restaurant", "barista"],
  outdoorsy: ["outdoor", "hike", "hiking", "camp", "travel", "adventur", "mountain", "beach"],
  nature: ["plant", "garden", "flower", "nature", "forest", "botan", "bird"],
  glam: ["fashion", "glam", "stylish", "elegant", "makeup", "chic"],
  cute: ["cute", "bubbly", "cheerful", "kawaii", "adorable"],
  luxury: ["luxur", "posh", "wealthy", "rich", "high-end"],
  spooky: ["spooky", "goth", "witch", "horror", "halloween", "occult", "tarot"],
  practical: ["practical", "organis", "organiz", "sensible", "tidy", "efficient"],
  festive: ["festive", "christmas", "holiday", "celebrat"],
};
/** Tags a character seems to like, from personality/backstory/speaking style. */
export function likedTags(c: Pick<Character, "personality" | "backstory" | "speakingStyle">): string[] {
  const text = `${c.personality} ${c.backstory} ${c.speakingStyle}`.toLowerCase();
  return Object.entries(LIKES).filter(([, ws]) => ws.some((w) => text.includes(w))).map(([t]) => t);
}
/** Tags for any item (stall items have none stored: guess from the words). */
export function itemTags(it: Pick<Item, "name" | "description"> & { tags?: string | string[] }): string[] {
  const own = Array.isArray(it.tags) ? it.tags : (it.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (own.length) return own;
  const text = `${it.name} ${it.description}`.toLowerCase();
  return Object.entries(LIKES).filter(([, ws]) => ws.some((w) => text.includes(w))).map(([t]) => t);
}
export interface GiftFit { matches: string[]; familyRomantic: boolean; forward: boolean; note: string; warning: string; }
export function giftFit(c: Character, it: Pick<Item, "name" | "description"> & { tags?: string | string[] }, userName: string): GiftFit {
  const tags = itemTags(it), likes = likedTags(c);
  const matches = tags.filter((t) => likes.includes(t) && t !== "romantic");
  const rel = lifeOf(c).relationship;
  const romanticItem = tags.includes("romantic");
  const familyRomantic = romanticItem && isFamily(rel);
  const forward = romanticItem && !familyRomantic && !isRomantic(rel) && c.closeness < 60;
  const parts: string[] = [];
  if (matches.length) parts.push(`This gift suits what you love (${matches.join(", ")}), so you are genuinely delighted.`);
  else parts.push("It isn't quite your usual taste; react honestly but kindly, appreciating the thought.");
  if (familyRomantic) parts.push(`It is the sort of thing people give as a romantic gift, but you are ${userName}'s family: take it purely as a sweet family gesture. Never romantic.`);
  else if (forward) parts.push("It feels a little romantic for where you two are; you may be a bit flustered or surprised, but stay kind.");
  else if (romanticItem && isRomantic(rel)) parts.push("It's a romantic gift and you are together, so you can be openly touched and affectionate.");
  const warning = familyRomantic ? `${c.name} is family, so this romantic-style gift will be taken as a sweet family present (no romance).`
    : forward ? `This is a romantic-style gift and you and ${c.name} aren't dating yet. They may be a bit surprised.` : "";
  return { matches, familyRomantic, forward, note: parts.join(" "), warning };
}

// ---- optional Ollama seasonal specials ----------------------------------------
export function buildSeasonalPrompt(now = new Date()) {
  const month = now.toLocaleString("en-GB", { month: "long" });
  return [
    { role: "system", content: [
      `You stock the Seasonal aisle of a cosy UK shopping centre in ${month}.`,
      "Invent 4 wholesome seasonal items that fit this time of year (holidays, weather, traditions). Non-sexual, family-friendly.",
      `Each item: name (max 5 words), item_type, colour, material, description (max 18 words), tier 1-3 (1 cheap, 3 pricier), tags from: ${TAGS.join(", ")}, wearable (true only for clothing/accessories).`,
      typeRules(` (seasonal: ${typesFor("seasonal").join(", ")})`),
      'Respond only with JSON: {"items": [{"name": "...", "item_type": "...", "colour": "...", "material": "...", "description": "...", "tier": 1, "tags": ["cosy"], "wearable": false}]}',
    ].join("\n") },
    { role: "user", content: `Seasonal specials for ${month}.` },
  ];
}
export function normalizeSeasonal(raw: unknown, week: string): MallItem[] {
  const list = Array.isArray((raw as { items?: unknown })?.items) ? (raw as { items: Record<string, unknown>[] }).items : [];
  const out: MallItem[] = [];
  for (const r of list.slice(0, 6)) {
    const typed = typeItem(r ?? {}, toText(r?.name).replace(/["*]/g, "").slice(0, 40), toText(r?.description), typesFor("seasonal"));
    if (!typed) continue;
    const name = typed.name;
    if (!name || out.some((x) => x.name.toLowerCase() === name.toLowerCase()) || CATALOG.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
    const tier = Math.min(3, Math.max(1, Math.round(Number(r.tier)) || 1)) as MallItem["tier"];
    const tags = (Array.isArray(r.tags) ? r.tags : String(r.tags ?? "").split(",")).map((t) => String(t).trim().toLowerCase()).filter((t) => (TAGS as readonly string[]).includes(t));
    out.push({ sku: `seasonal-${week}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, dept: "seasonal", emoji: typed.emoji, itemType: typed.itemType, name, description: typed.description,
      tier, price: tierPrice(name, tier), tags: tags.length ? [...new Set([...tags, "festive"])] : ["festive"], wearable: r.wearable === true || r.wearable === "true" });
  }
  return out;
}
export async function seasonalSpecials(model: string, json: JsonFn | null, week = weekKey()): Promise<MallItem[]> {
  const have = await econApi.kvGet<MallItem[]>(`mall_seasonal_${week}`);
  if (have || !json) return have ?? [];
  const items = normalizeSeasonal(parseJson(await json(model, buildSeasonalPrompt(), 0.9)), week);
  if (items.length) await econApi.kvSet(`mall_seasonal_${week}`, items);
  return items;
}

// ---- daily brand-new items ("✨ New") ------------------------------------------------
export function buildDailyPrompt(day: string, recent: string[] = []) {
  return [
    { role: "system", content: [
      "You are the buyer for a cosy UK shopping centre in a messenger game. Invent 4 brand-new, original products that arrived today.",
      `Departments (use the id): ${DEPARTMENTS.map((d) => `${d.id} (${d.label})`).join(", ")}. Pick different departments.`,
      "Wholesome, non-sexual, believable everyday items with a little charm.",
      `Each item: name (max 5 words), item_type, colour, material, description (max 20 words), dept, tier 1-4 (1 under 40, 2 40-120, 3 120-350, 4 350-1200 Sparkles), tags (1-3 from: ${TAGS.join(", ")}), wearable (true only for clothing/accessories/jewellery).`,
      typeRules(` for its department:\n${listFor(DEPARTMENTS)}\n`),
      recent.length ? `Do NOT repeat or closely copy these: ${recent.slice(0, 60).join(", ")}.` : "",
      'Respond only with JSON: {"items": [{"name": "...", "item_type": "...", "colour": "...", "material": "...", "description": "...", "dept": "home", "tier": 2, "tags": ["cosy"], "wearable": false}]}',
    ].filter(Boolean).join("\n") },
    { role: "user", content: `New arrivals for ${day}.` },
  ];
}
/** Validates generated items: real department, tier 1-4, known tags, no dupes vs catalogue/recent. */
export function normalizeDaily(raw: unknown, day: string, recent: string[] = []): MallItem[] {
  const list = Array.isArray((raw as { items?: unknown })?.items) ? (raw as { items: Record<string, unknown>[] }).items : [];
  const taken = new Set([...CATALOG.map((i) => i.name.toLowerCase()), ...recent.map((x) => x.toLowerCase())]);
  const out: MallItem[] = [];
  for (const r of list.slice(0, 6)) {
    const dept = DEPARTMENTS.find((d) => d.id === String(r?.dept).toLowerCase().trim())?.id;
    const typed = dept ? typeItem(r ?? {}, toText(r?.name).replace(/["*]/g, "").trim().slice(0, 40), toText(r?.description), typesFor(dept)) : null;
    if (!dept || !typed) continue;
    const name = typed.name;
    if (!name || taken.has(name.toLowerCase())) continue;
    taken.add(name.toLowerCase());
    const tier = Math.min(4, Math.max(1, Math.round(Number(r.tier)) || 1)) as MallItem["tier"];
    const tags = (Array.isArray(r.tags) ? r.tags : String(r.tags ?? "").split(",")).map((t) => String(t).trim().toLowerCase()).filter((t) => (TAGS as readonly string[]).includes(t));
    out.push({ sku: `new-${day}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, dept, name, description: typed.description, tier, price: tierPrice(name, tier),
      emoji: typed.emoji, itemType: typed.itemType, tags: tags.length ? [...new Set(tags)].slice(0, 3) : ["cute"], wearable: r.wearable === true || r.wearable === "true" });
    if (out.length >= 4) break;
  }
  return out;
}
let dailyFailedAt = 0;
/** Today's generated items: stored per day; made lazily on first open. On failure: [] (catalogue picks only), retried after 10 min. */
export async function dailyNew(model: string, json: JsonFn | null, day = dayKey()): Promise<MallItem[]> {
  const have = await econApi.kvGet<MallItem[]>(`mall_new_${day}`).catch(() => null);
  if (have) return have;
  if (!json || !model || Date.now() - dailyFailedAt < 600_000) return [];
  try {
    const recent = (await econApi.kvGet<string[]>("mall_new_recent")) ?? [];
    let items: MallItem[] = [];
    for (let i = 0; i < 2 && items.length < 3; i++) items = normalizeDaily(parseJson(await json(model, buildDailyPrompt(day, recent), 0.95)), day, recent);
    if (items.length < 3) throw new Error("not enough usable items");
    await econApi.kvSet(`mall_new_${day}`, items);
    await econApi.kvSet("mall_new_recent", [...items.map((x) => x.name), ...recent].slice(0, 80));
    return items;
  } catch (e) { dailyFailedAt = Date.now(); console.warn("[mall] daily items:", e); return []; }
}
