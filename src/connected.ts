// 🔗 Connected economy: gifts/café context everywhere, characters giving gifts back, and offers on Alex's items.
// Pure decision helpers are exported for scripts/test-economy.mjs.
import { invoke } from "@tauri-apps/api/core";
import { isProtectedMinor } from "./protect";
import { cafe, cafePrompt } from "./cafe";
import { dayKey, econApi, giftsOf, giftsPrompt, isAdultItem, Item, SPARK, StockItem } from "./economy";
import { CATALOG, itemTags, likedTags, MallItem } from "./mall";
import { ADULT_CATALOG, storedAge } from "./afterdark";
import { isFamily, isRomantic, lifeOf } from "./lifecore";
import { Character, GIFT, OFFER } from "./types";

// ---- settings ---------------------------------------------------------------------
export type Freq = "rarely" | "sometimes" | "often";
export interface ConnectedCfg { context: boolean; giftsBack: boolean; offers: boolean; frequency: Freq; }
export const DEFAULT_CFG: ConnectedCfg = { context: true, giftsBack: true, offers: true, frequency: "sometimes" };
let cfgCache: ConnectedCfg = DEFAULT_CFG;
export const connectedCfg = () => cfgCache;
export async function loadConnected(): Promise<ConnectedCfg> {
  cfgCache = { ...DEFAULT_CFG, ...((await econApi.kvGet<Partial<ConnectedCfg>>("connected_cfg").catch(() => null)) ?? {}) };
  return cfgCache;
}
export async function saveConnected(c: ConnectedCfg) { cfgCache = c; await econApi.kvSet("connected_cfg", c); }
export const setConnectedForTest = (c: ConnectedCfg) => { cfgCache = c; };

// ---- (a) shared context -----------------------------------------------------------------
/** Gifts she owns + café, for first messages, group chats and calls. 18+ items: only when the switch is on (giftsOf), never for family or in groups. */
export function economyContext(c: Character, userName: string, opts: { group?: boolean; rand?: () => number; always?: boolean } = {}): string {
  if (!cfgCache.context && !opts.always) return "";
  const family = isFamily(lifeOf(c).relationship);
  const items = giftsOf(c.id).filter((i) => !isAdultItem(i) || (!family && !opts.group));
  return [giftsPrompt(items, userName), cafePrompt(cafe.s, c, userName, opts.rand)].filter(Boolean).join("\n");
}

// ---- who may give what ---------------------------------------------------------------
const GENEROUS = ["generous", "kind", "sweet", "caring", "thoughtful", "warm", "giving", "romantic", "affectionate", "doting"];
const STINGY = ["stingy", "frugal", "grumpy", "cold", "aloof", "selfish", "tsundere", "cynical", "shy"];
/** -0.3..+0.6 from personality words. */
export function generosity(c: Pick<Character, "personality" | "backstory">): number {
  const t = `${c.personality} ${c.backstory}`.toLowerCase();
  const g = GENEROUS.filter((w) => t.includes(w)).length, s = STINGY.filter((w) => t.includes(w)).length;
  return Math.max(-0.3, Math.min(0.6, 0.2 * g - 0.15 * s));
}
/** 18+ gifts only from partners (romantic, never family), only with the switch on, only adult (saved age 18+). */
export function canGiveAdult(c: Character, adultOn: boolean): boolean {
  const rel = lifeOf(c).relationship;
  return adultOn && isRomantic(rel) && !isFamily(rel) && !isProtectedMinor(c) && (storedAge(c) ?? 0) >= 18;
}
const BASE: Record<Freq, { gift: number; offer: number; giftGapDays: number; offerGapDays: number; perDay: number }> = {
  rarely: { gift: 0.06, offer: 0.04, giftGapDays: 7, offerGapDays: 14, perDay: 1 },
  sometimes: { gift: 0.15, offer: 0.1, giftGapDays: 3, offerGapDays: 7, perDay: 1 },
  often: { gift: 0.3, offer: 0.2, giftGapDays: 2, offerGapDays: 4, perDay: 2 },
};
export const freqOf = (f: Freq) => BASE[f] ?? BASE.sometimes;
/** Daily chance of a gift back, scaled by closeness and personality (0 under 25 closeness). */
export function giftChance(c: Character, f: Freq): number {
  if (c.closeness < 25) return 0;
  return Math.max(0, Math.min(0.7, freqOf(f).gift * (0.4 + c.closeness / 100) * (1 + generosity(c))));
}
export const offerChance = (c: Character, f: Freq) => c.closeness < 15 ? 0 : Math.min(0.5, freqOf(f).offer * (0.7 + c.closeness / 200));

export interface GiftPick { name: string; emoji: string; description: string; price: number; wearable: boolean; tags: string[]; source: "stall" | "mall" | "afterdark"; }
/** What they give: something they love from their own stall or the Shopping Centre, priced by closeness. */
export function pickReturnGift(c: Character, stall: StockItem[] | null, adultOn: boolean, rnd = Math.random): GiftPick | null {
  const rel = lifeOf(c).relationship;
  const family = isFamily(rel), romantic = isRomantic(rel);
  const maxPrice = c.closeness >= 80 ? 400 : c.closeness >= 50 ? 160 : 60;
  if (canGiveAdult(c, adultOn) && rnd() < 0.25) {
    const ad = ADULT_CATALOG.filter((i) => i.price <= Math.max(maxPrice, 120));
    if (ad.length) { const a = ad[Math.floor(rnd() * ad.length)]; return { ...fromMall(a), source: "afterdark" }; }
  }
  const likes = likedTags(c);
  const okTags = (tags: string[]) => !tags.includes("18+") && (!tags.includes("romantic") || (romantic && !family));
  const pool: { g: GiftPick; score: number }[] = [];
  for (const s of stall ?? []) {
    if (s.sold || s.price > maxPrice) continue;
    const tags = itemTags({ name: s.name, description: s.description });
    if (!okTags(tags)) continue;
    pool.push({ g: { name: s.name, emoji: s.emoji, description: s.description, price: s.price, wearable: s.wearable, tags, source: "stall" }, score: 2 + tags.filter((t) => likes.includes(t)).length });
  }
  for (const m of CATALOG) {
    if (m.price > maxPrice || !okTags(m.tags)) continue;
    const hit = m.tags.filter((t) => likes.includes(t)).length;
    if (hit) pool.push({ g: fromMall(m), score: hit });
  }
  if (!pool.length) { const cheap = CATALOG.filter((m) => m.price <= maxPrice && okTags(m.tags)); if (!cheap.length) return null; return fromMall(cheap[Math.floor(rnd() * cheap.length)]); }
  const total = pool.reduce((a, p) => a + p.score, 0);
  let r = rnd() * total;
  for (const p of pool) { r -= p.score; if (r <= 0) return p.g; }
  return pool[pool.length - 1].g;
}
const fromMall = (m: MallItem): GiftPick => ({ name: m.name, emoji: m.emoji, description: m.description, price: m.price, wearable: m.wearable, tags: m.tags, source: "mall" });

// ---- state + caps ---------------------------------------------------------------------
export interface ConnState { rolled: Record<string, string>; lastGift: Record<string, number>; lastOffer: Record<string, number>; day: string; gifts: number; offers: number; occasions: number[]; }
export const blankState = (): ConnState => ({ rolled: {}, lastGift: {}, lastOffer: {}, day: "", gifts: 0, offers: 0, occasions: [] });
export const freshDay = (s: ConnState, now: Date): ConnState => s.day === dayKey(now) ? s : { ...s, day: dayKey(now), gifts: 0, offers: 0 };
/** One roll per character per day; gap since their last gift; global per-day cap. */
export function shouldGift(s: ConnState, c: Character, cfg: ConnectedCfg, now: Date, rnd = Math.random): boolean {
  if (!cfg.giftsBack) return false;
  const f = freqOf(cfg.frequency);
  if (s.day === dayKey(now) && s.gifts >= f.perDay) return false;
  if (now.getTime() - (s.lastGift[c.id] ?? 0) < f.giftGapDays * 86_400_000) return false;
  return rnd() < giftChance(c, cfg.frequency);
}
export interface OfferPick { kind: "buy" | "swap"; target: Item; sparkles: number; swap?: GiftPick; }
/** An offer on one of Alex's items that fits their likes (never 18+ items, never with a pending offer from them). */
export function pickOffer(s: ConnState, c: Character, mine: Item[], cfg: ConnectedCfg, now: Date, pending: boolean, rnd = Math.random): OfferPick | null {
  if (!cfg.offers || pending) return null;
  const f = freqOf(cfg.frequency);
  if (s.day === dayKey(now) && s.offers >= f.perDay) return null;
  if (now.getTime() - (s.lastOffer[c.id] ?? 0) < f.offerGapDays * 86_400_000) return null;
  const likes = likedTags(c);
  const family = isFamily(lifeOf(c).relationship);
  const fits = mine.filter((i) => i.owner === "me" && !isAdultItem(i) && i.fromChar !== c.id).filter((i) => {
    const t = itemTags(i);
    return t.some((x) => likes.includes(x) && x !== "romantic") && !(family && t.includes("romantic"));
  });
  if (!fits.length || rnd() >= offerChance(c, cfg.frequency)) return null;
  const target = fits[Math.floor(rnd() * fits.length)];
  const value = Math.max(5, target.price || 20);
  if (rnd() < 0.4) {
    const swap = pickReturnGift({ ...c, closeness: Math.min(c.closeness, 79) }, null, false, rnd);
    if (swap && swap.name !== target.name && swap.price >= value * 0.6 && swap.price <= value * 2) return { kind: "swap", target, sparkles: 0, swap };
  }
  return { kind: "buy", target, sparkles: Math.round(value * (1.1 + 0.4 * Math.min(1, c.closeness / 100)) + rnd() * 5) };
}
/** Milestones worth a present (not "first met"). */
export const OCCASION_KINDS = ["anniversary", "relationship", "nickname", "pet_name", "inside_joke"];
export const occasionsDue = <T extends { id: number; kind: string; characterId: string; createdAt: number }>(ms: T[], s: ConnState, now = Date.now()): T[] =>
  ms.filter((m) => OCCASION_KINDS.includes(m.kind) && now - m.createdAt < 2 * 86_400_000 && !s.occasions.includes(m.id));

// ---- texts --------------------------------------------------------------------------------
export const giftBubble = (g: Pick<GiftPick, "emoji" | "name" | "description">) => `${GIFT} ${g.emoji} ${g.name}${g.description ? ` \u2013 ${g.description}` : ""}`;
export const offerBubble = (o: OfferPick) => o.kind === "buy"
  ? `${OFFER} \u{1F6D2} would like to buy your ${o.target.emoji} ${o.target.name} for ${o.sparkles} ${SPARK}`
  : `${OFFER} \u{1F504} would like to swap your ${o.target.emoji} ${o.target.name} for their ${o.swap!.emoji} ${o.swap!.name}`;
export function giftBackNote(c: Character, g: GiftPick, user: string, occasion = ""): string {
  const where = g.source === "stall" ? "from your own stall" : g.source === "afterdark" ? "from the After Dark boutique" : "from the Shopping Centre";
  const adult = g.source === "afterdark" ? " It's an intimate grown-up present for your partner: be flirty or shy, suggestive at most, never explicit." : "";
  return `${occasion ? `${occasion} ` : ""}You've decided to give ${user} a little present: ${g.emoji} ${g.name} (${g.description}), picked ${where} because it made you think of them. Write ONE short, natural message to go with the gift (it is sent right after your message). You are the GIVER: don't thank them for it and don't describe it at length.${adult}`;
}
export function offerNote(c: Character, o: OfferPick, user: string): string {
  return o.kind === "buy"
    ? `You've noticed ${user} has a ${o.target.name} and you'd really love one. Write ONE short message asking if they'd sell it to you for ${o.sparkles} Sparkles. Friendly, no pressure: it's fine if they say no.`
    : `You've noticed ${user} has a ${o.target.name} and you'd love it. Write ONE short message offering to swap it for your ${o.swap!.name}. Friendly, no pressure.`;
}
/** "🧣 Scarf" from an offer bubble ("… your 🧣 Scarf for 45 ✨" / "… your 🧣 Scarf for their …"). */
export const offerTarget = (text: string) => text.replace(/^.*?\byour /, "").replace(/ for (their |\d).*$/, "").trim();
type OfferLike = { kind: string; item: Partial<GiftPick>; sparkles: number };
const itemName = (i: Partial<GiftPick>) => `${i.emoji ?? ""} ${i.name ?? "gift"}`.trim();
/** Follow-up note after Alex answers. The direction is always spelled out: who gave what to whom. */
export function resolveNote(o: OfferLike, status: string, target: string, charName: string, user: string): string {
  const you = `You (${charName})`;
  if (o.kind === "gift") {
    const tease = o.item.wearable || (o.item.tags ?? []).includes("18+") ? ` You may playfully tease about ${user} wearing or using it.` : "";
    if (status === "accepted") return `[Event: ${you} gave ${user} a gift: ${target}. ${user} accepted it, so it now belongs to ${user}.] Reply as the GIVER, in one or two short messages: you're glad they accepted, you hope they like it, maybe say why you picked it for them.${tease} Do NOT thank ${user} for the gift and do NOT act as if you received it: it was your present to them.`;
    return `[Event: ${you} offered ${user} a gift: ${target}. ${user} declined it, so you keep it.] Reply as the GIVER: take it gracefully and kindly in one short message. Do NOT thank ${user} for a gift.`;
  }
  if (status === "expired") return `[Event: ${you} offered ${user} a deal for their ${target}, but ${user} no longer has it, so nothing changed hands.] React briefly and kindly.`;
  if (o.kind === "buy") return status === "accepted"
    ? `[Event: ${user} accepted your offer and SOLD you (${charName}) their ${target} for ${o.sparkles} Sparkles. You paid; the ${target} now belongs to you.] React as the BUYER: happy, and thank ${user} for selling it to you.`
    : `[Event: ${user} declined your offer to buy their ${target}. Nothing changed hands.] Take it gracefully in one short message; no pressure.`;
  return status === "accepted"
    ? `[Event: ${user} accepted your swap. You (${charName}) gave ${user} your ${itemName(o.item)}, and ${user} gave you their ${target}. Now ${user} has the ${o.item.name ?? "item"} and you have the ${target}.] React happily as someone who just made a fair swap; you may hope they enjoy the ${o.item.name ?? "item"}.`
    : `[Event: ${user} declined your offer to swap your ${itemName(o.item)} for their ${target}. Nothing changed hands.] Take it gracefully in one short message; no pressure.`;
}
/** Memory line so later chats keep the direction straight. */
export function offerMemory(o: OfferLike, status: string, target: string, charName: string, user: string): string {
  const d = new Date().toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
  if (o.kind === "gift") return status === "accepted" ? `${charName} gave ${user} a gift on ${d}: ${target}. ${user} accepted it and has it now.` : `${charName} offered ${user} a gift (${target}) on ${d}; ${user} declined.`;
  if (o.kind === "buy") return status === "accepted" ? `${user} sold ${charName} their ${target} for ${o.sparkles} Sparkles on ${d}.` : `${user} declined to sell ${charName} their ${target} (${d}).`;
  return status === "accepted" ? `${charName} swapped their ${itemName(o.item)} for ${user}'s ${target} on ${d}.` : `${user} declined ${charName}'s swap offer for their ${target} (${d}).`;
}

// ---- backend ---------------------------------------------------------------------------
export interface Offer { id: number; characterId: string; kind: "gift" | "buy" | "swap"; item: Partial<GiftPick>; targetId: number | null; sparkles: number; status: "pending" | "accepted" | "declined" | "expired"; messageId: number | null; createdAt: number; resolvedAt: number | null; }
export const offerApi = {
  create: (characterId: string, kind: Offer["kind"], item: unknown, targetId: number | null, sparkles: number, messageId: number | null) =>
    invoke<Offer>("offer_create", { characterId, kind, item, targetId, sparkles, messageId }),
  list: (characterId: string | null = null) => invoke<Offer[]>("offer_list", { characterId }),
  resolve: (id: number, accept: boolean, who: string) => invoke<[Offer, number]>("offer_resolve", { id, accept, who }),
  state: async () => ({ ...blankState(), ...((await econApi.kvGet<ConnState>("connected_state").catch(() => null)) ?? {}) }),
  saveState: (s: ConnState) => econApi.kvSet("connected_state", { ...s, occasions: s.occasions.slice(-200) }),
};
