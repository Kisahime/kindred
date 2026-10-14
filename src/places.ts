// Together part 2 (together2): places, scene card (time of day, weather, mood), narrator, costs, character invites
// and meet-up intent detection. Pure helpers only (no I/O), tested by scripts/test-together.mjs.
import type { Character } from "./types";
import { isFamily, isRomantic, lifeOf } from "./lifecore";
import { formatDue, resolveWhen } from "./together";
import type { Activity, Scene, WhenKind } from "./together";

export interface Place { id: string; name: string; emoji: string; cost: number; kinds: Activity[]; outdoor: boolean; ambience: string; keywords: string[]; }
const both: Activity[] = ["date", "hangout"];
export const PLACES: Place[] = [
  { id: "cafe", name: "Caf\u00E9", emoji: "\u2615", cost: 15, kinds: both, outdoor: false, ambience: "the smell of fresh coffee, clinking cups and a soft playlist", keywords: ["cafe", "caf\u00E9", "coffee", "tea"] },
  { id: "restaurant", name: "Restaurant", emoji: "\u{1F37D}\uFE0F", cost: 60, kinds: both, outdoor: false, ambience: "candlelit tables, low chatter and something delicious from the kitchen", keywords: ["restaurant", "dinner", "eat out", "meal"] },
  { id: "cinema", name: "Cinema", emoji: "\u{1F3AC}", cost: 30, kinds: both, outdoor: false, ambience: "popcorn, dimmed lights and the hush before the film", keywords: ["cinema", "movie", "movies", "film", "pictures"] },
  { id: "park", name: "Park", emoji: "\u{1F333}", cost: 0, kinds: both, outdoor: true, ambience: "rustling trees, dog walkers and ducks on the pond", keywords: ["park", "picnic", "walk"] },
  { id: "beach", name: "Beach", emoji: "\u{1F3D6}\uFE0F", cost: 10, kinds: both, outdoor: true, ambience: "waves rolling in, gulls overhead and salt in the air", keywords: ["beach", "seaside", "sea", "coast"] },
  { id: "their_place", name: "Their place", emoji: "\u{1F3E0}", cost: 0, kinds: both, outdoor: false, ambience: "a cosy room full of their things, a blanket on the sofa", keywords: ["your place", "your house", "your flat", "yours"] },
  { id: "your_place", name: "Your place", emoji: "\u{1F6CB}\uFE0F", cost: 0, kinds: both, outdoor: false, ambience: "your own familiar sofa, a kettle on and the telly murmuring", keywords: ["my place", "my house", "my flat", "come over"] },
  { id: "fair", name: "Funfair", emoji: "\u{1F3A1}", cost: 40, kinds: both, outdoor: true, ambience: "flashing lights, candyfloss and the rattle of the rides", keywords: ["fair", "funfair", "carnival", "ferris"] },
  { id: "museum", name: "Museum", emoji: "\u{1F3DB}\uFE0F", cost: 12, kinds: both, outdoor: false, ambience: "quiet echoing halls, old treasures behind glass", keywords: ["museum", "gallery", "exhibition"] },
  { id: "bar", name: "Bar", emoji: "\u{1F378}", cost: 35, kinds: both, outdoor: false, ambience: "warm low lights, music and the clink of glasses", keywords: ["bar", "pub", "drinks", "cocktail"] },
  { id: "stargazing", name: "Stargazing hill", emoji: "\u{1F320}", cost: 0, kinds: ["date"], outdoor: true, ambience: "a quiet hilltop, cool grass and the whole sky overhead", keywords: ["stargaz", "stars", "hill"] },
  { id: "bookshop", name: "Bookshop", emoji: "\u{1F4DA}", cost: 10, kinds: ["hangout", "date"], outdoor: false, ambience: "creaky floorboards, tall shelves and the smell of paper", keywords: ["bookshop", "bookstore", "books", "library"] },
  { id: "arcade", name: "Arcade", emoji: "\u{1F579}\uFE0F", cost: 20, kinds: both, outdoor: false, ambience: "beeping machines, neon and the clatter of tokens", keywords: ["arcade", "games", "bowling"] },
  { id: "shopping", name: "Shopping centre", emoji: "\u{1F6CD}\uFE0F", cost: 25, kinds: ["hangout", "date"], outdoor: false, ambience: "busy shops, escalators and a food court buzzing", keywords: ["shopping", "mall", "shops"] },
  { id: "ice_rink", name: "Ice rink", emoji: "\u26F8\uFE0F", cost: 25, kinds: both, outdoor: false, ambience: "cold air, scraping skates and cheesy music", keywords: ["ice skating", "skating", "ice rink"] },
  { id: "garden", name: "Botanical garden", emoji: "\u{1F337}", cost: 8, kinds: both, outdoor: true, ambience: "winding paths, flowers everywhere and a warm glasshouse", keywords: ["garden", "flowers", "botanical"] },
];
export const OTHER = "other";
export const findPlace = (id?: string | null) => PLACES.find((p) => p.id === id) ?? null;
export const placesFor = (activity: Activity) => PLACES.filter((p) => p.kinds.includes(activity));
export const freePlaces = (activity: Activity) => placesFor(activity).filter((p) => p.cost === 0);
/** Best place match for free text ("coffee by the river" -> caf\u00E9). */
export function placeFromText(text: string): Place | null {
  const t = ` ${text.toLowerCase()} `;
  let best: Place | null = null, len = 0;
  for (const p of PLACES) for (const k of p.keywords) if (t.includes(k) && k.length > len) { best = p; len = k.length; }
  return best;
}
/** Stored place text: "Caf\u00E9" or "Caf\u00E9 (the one by the river)"; custom places as typed. */
export function placeText(placeId: string, detail: string, custom: string): string {
  const p = findPlace(placeId);
  if (!p) return custom.trim().slice(0, 160);
  const d = detail.trim();
  return (d ? `${p.name} (${d})` : p.name).slice(0, 160);
}
export const placeEmoji = (placeId?: string, place = "") => (findPlace(placeId) ?? placeFromText(place))?.emoji ?? "\u{1F4CD}";

// ---- costs -------------------------------------------------------------------------
export type Pay = "me" | "split" | "them";
export const canTreat = (c: Pick<Character, "closeness">) => c.closeness >= 60;
export function costShare(cost: number, pay: Pay): number { return cost <= 0 || pay === "them" ? 0 : pay === "split" ? Math.ceil(cost / 2) : cost; }
export function payLine(pay: Pay, cost: number, user: string, name: string): string {
  if (cost <= 0) return "";
  return pay === "them" ? `${name} insisted on paying (${cost} Sparkles).` : pay === "split" ? `${user} and ${name} split the cost (${cost} Sparkles).` : `${user} paid (${cost} Sparkles).`;
}
export const freeSuggestion = (activity: Activity) => `Free places: ${freePlaces(activity).map((p) => `${p.emoji} ${p.name}`).join(", ")}.`;

// ---- scene card --------------------------------------------------------------------
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export function timeOfDay(d: Date): string {
  const h = d.getHours();
  return h < 5 ? "late night" : h < 8 ? "early morning" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
}
type W = { e: string; t: string; lo: number; hi: number; wet?: boolean };
const SEASON: Record<string, W[]> = {
  winter: [{ e: "\u2601\uFE0F", t: "grey and chilly", lo: 2, hi: 8 }, { e: "\u{1F327}\uFE0F", t: "cold drizzle", lo: 3, hi: 8, wet: true }, { e: "\u2600\uFE0F", t: "crisp and bright", lo: 1, hi: 7 }, { e: "\u2744\uFE0F", t: "a few snowflakes", lo: -2, hi: 2, wet: true }, { e: "\u{1F32B}\uFE0F", t: "misty", lo: 1, hi: 6 }],
  spring: [{ e: "\u26C5", t: "sunny spells", lo: 10, hi: 16 }, { e: "\u{1F326}\uFE0F", t: "light showers", lo: 8, hi: 14, wet: true }, { e: "\u2600\uFE0F", t: "mild and sunny", lo: 12, hi: 18 }, { e: "\u2601\uFE0F", t: "cloudy", lo: 9, hi: 14 }],
  summer: [{ e: "\u2600\uFE0F", t: "warm and sunny", lo: 20, hi: 27 }, { e: "\u26C5", t: "warm with a breeze", lo: 18, hi: 24 }, { e: "\u{1F326}\uFE0F", t: "a passing shower", lo: 16, hi: 21, wet: true }, { e: "\u{1F975}", t: "hot and sticky", lo: 26, hi: 31 }],
  autumn: [{ e: "\u{1F342}", t: "crisp with falling leaves", lo: 9, hi: 14 }, { e: "\u{1F327}\uFE0F", t: "rainy", lo: 8, hi: 13, wet: true }, { e: "\u26C5", t: "bright and breezy", lo: 11, hi: 16 }, { e: "\u{1F32B}\uFE0F", t: "foggy", lo: 7, hi: 11 }, { e: "\u2601\uFE0F", t: "overcast", lo: 9, hi: 14 }],
};
export function seasonOf(d: Date): string { const m = d.getMonth(); return m <= 1 || m === 11 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn"; }
/** Simple, believable weather, stable for a scene (seeded by scene id), by season and time of day. No internet. */
export function weatherFor(seed: string, d: Date): { emoji: string; text: string; temp: number; wet: boolean } {
  const pool = SEASON[seasonOf(d)];
  const h = hash(seed);
  const w = pool[h % pool.length];
  const night = d.getHours() >= 20 || d.getHours() < 6;
  const temp = w.lo + (h >>> 8) % (w.hi - w.lo + 1) - (night ? 3 : 0);
  let text = w.t, emoji = w.e;
  if (night && /sunny|bright/.test(text)) { text = "clear and starry"; emoji = "\u{1F319}"; }
  return { emoji, text, temp, wet: !!w.wet };
}
export interface SceneCard { emoji: string; place: string; time: string; tod: string; weather: string; mood: string; outdoor: boolean; }
const MOODS_BY_TOD: Record<string, string> = { "late night": "hushed and a little magical", "early morning": "quiet, the day just waking up", morning: "fresh and unhurried", afternoon: "easy and lazy", evening: "warm and golden", night: "intimate and calm" };
export function sceneCard(s: Pick<Scene, "id" | "place"> & { placeId?: string }, now = new Date()): SceneCard {
  const p = findPlace(s.placeId) ?? placeFromText(s.place);
  const w = weatherFor(s.id, now);
  const tod = timeOfDay(now);
  const outdoor = p?.outdoor ?? false;
  const amb = p?.ambience ?? "somewhere new to the two of you";
  const wetNote = w.wet ? (outdoor ? "; you might need to dash for cover" : "; rain taps on the windows") : "";
  return { emoji: p?.emoji ?? "\u{1F4CD}", place: s.place || p?.name || "Together", time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    tod, weather: `${w.emoji} ${w.text}, ${w.temp}\u00B0C`, mood: `${amb[0].toUpperCase()}${amb.slice(1)} \u2014 ${MOODS_BY_TOD[tod]}${wetNote}.`, outdoor };
}
/** One-line setting for the character's prompt so they stay consistent with the card. */
export const sceneSetting = (card: SceneCard) => `Setting: ${card.place}, ${card.tod} (${card.time}). Weather outside: ${card.weather}. Atmosphere: ${card.mood}`;

// ---- narrator ----------------------------------------------------------------------
export const NARRATE_EVERY = 4;
/** ">>" or "/narrate [hint]" in the composer asks the narrator instead of the character. */
export function narrateCommand(text: string): { hint: string } | null {
  const m = text.trim().match(/^(?:>>|\/narrate\b)\s*(.*)$/is);
  return m ? { hint: m[1].trim().slice(0, 200) } : null;
}
/** Alex's turns since the last narration (or scene start). */
export function turnsSinceNarration(msgs: { from: "me" | "them"; text: string }[], isNarration: (t: string) => boolean, isMarker: (t: string) => boolean): number {
  let n = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = msgs[i].text;
    if (isNarration(t)) break;
    if (isMarker(t)) { if (/"phase":"start"/.test(t)) break; continue; }
    if (msgs[i].from === "me") n++;
  }
  return n;
}
export const shouldNarrate = (turns: number, on: boolean | undefined) => on !== false && turns >= NARRATE_EVERY;
export function narratorMessages(card: SceneCard, user: string, name: string, transcript: string, hint: string, opening: boolean) {
  return [
    { role: "system", content: [
      `You are a light, unobtrusive narrator for an in-person meet-up between ${user} and ${name} at ${card.place}.`,
      `Setting: ${card.tod}, ${card.time}; weather ${card.weather}; ${card.mood}`,
      opening ? `Write the opening: set the scene as ${user} arrives and sees ${name}.` : `Describe the surroundings or one small event happening around them (a waiter, a breeze, music changing, a dog, the light shifting).`,
      hint ? `Include this: ${hint}.` : "",
      `Write in second person addressing ${user} as "you", present tense, 1-2 short sentences (max 45 words). ${name} is "${name}" (third person).`,
      `Never write dialogue for anyone, never decide what ${user} says, feels or does. Keep it wholesome; no explicit content.`,
      'Respond only with JSON: {"narration":""}',
    ].filter(Boolean).join("\n") },
    { role: "user", content: transcript || "(they have just met up)" },
  ];
}
export function cleanNarration(raw: any): string {
  const t = typeof raw === "string" ? raw : typeof raw?.narration === "string" ? raw.narration : "";
  return t.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ").slice(0, 320);
}
export function fallbackNarration(card: SceneCard, name: string, opening: boolean, rand = Math.random): string {
  if (opening) return `You arrive at ${card.place}. It's ${card.tod}, ${card.weather.replace(/^\S+\s/, "")}; ${card.mood.charAt(0).toLowerCase()}${card.mood.slice(1)} ${name} spots you and lights up.`;
  const bits = card.outdoor ? ["A breeze picks up and tugs at your sleeves.", "Somewhere nearby a dog barks happily.", "The light shifts as a cloud drifts past."]
    : ["The music changes to something softer.", "Someone at the next table laughs out loud.", "A server drifts past with a tray of drinks."];
  return bits[Math.floor(rand() * bits.length)];
}

// ---- character-suggested meet-ups (invites) ---------------------------------------
export type InviteStatus = "pending" | "accepted" | "declined";
export const INVITES_KEY = "meetup_invites";
export interface InviteSpec { place: string; placeId: string; activity: Activity; when: WhenKind; dueAt: number; }
/** Chance per proactive opener that it's an invite: grows with closeness; romantic a bit more; strangers never. */
export function inviteChance(c: Pick<Character, "closeness" | "life">): number {
  if (c.closeness < 35) return 0;
  const base = 0.04 + ((c.closeness - 35) / 65) * 0.12;
  return Math.min(0.22, isRomantic(lifeOf(c).relationship) ? base * 1.5 : base);
}
const WHENS: WhenKind[] = ["tonight", "tomorrow_afternoon", "this_weekend", "next_free"];
export function pickInvite(c: Pick<Character, "closeness" | "life">, now = new Date(), rand = Math.random): InviteSpec {
  const romantic = isRomantic(lifeOf(c).relationship) && !isFamily(lifeOf(c).relationship);
  const activity: Activity = romantic && c.closeness >= 40 ? "date" : "hangout";
  const list = placesFor(activity).filter((p) => p.id !== "your_place");
  const p = list[Math.floor(rand() * list.length)];
  const when = WHENS[Math.floor(rand() * WHENS.length)];
  return { place: p.name, placeId: p.id, activity, when, dueAt: resolveWhen(when, c, now).getTime() };
}
export const inviteNote = (i: InviteSpec, user: string, now = Date.now()) =>
  `Suggest meeting ${user} in person: ${i.activity === "date" ? "a date" : "hanging out"} at the ${i.place.toLowerCase()} ${formatDue(i.dueAt, now)}. One or two short, natural sentences asking if they're up for it.`;

/** Alex asking to meet ("want to go to the cinema tomorrow?"): returns the suggested place/time, else null. */
export function detectMeetIntent(text: string, now = new Date()): { place: string; placeId: string; when: WhenKind; at?: number } | null {
  const t = text.toLowerCase();
  if (t.length > 300 || /selfie|photo|pic\b|picture/.test(t)) return null;
  const ask = /\b(want to|wanna|shall we|should we|let'?s|fancy|how about|would you like to|do you want to|up for|are you free|we could)\b/.test(t);
  const p = placeFromText(t.replace(/\bmy place\b|\bmy house\b|\bmy flat\b/g, (m) => m));
  const meet = /\b(meet up|meet|hang ?out|go out|date|come over|go to|going to|catch a|grab)\b/.test(t);
  if (!ask || !(p || /\b(meet up|hang ?out|go out|come over|date)\b/.test(t)) || !(p || meet)) return null;
  let when: WhenKind = "next_free", at: number | undefined;
  if (/\btonight|this evening\b/.test(t)) when = "tonight";
  else if (/\btomorrow (night|evening)\b/.test(t)) { when = "at"; const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(19, 0, 0, 0); at = d.getTime(); }
  else if (/\btomorrow\b/.test(t)) when = "tomorrow_afternoon";
  else if (/\bweekend|saturday|sunday\b/.test(t)) when = "this_weekend";
  return { place: p?.name ?? "Somewhere nice", placeId: p?.id ?? OTHER, when, at };
}

// ---- follow-ups ------------------------------------------------------------------
/** After-date follow-up text only if the character may message first, and not in quiet hours / scene. */
export const followUpAllowed = (c: Pick<Character, "proactiveEnabled">, quiet: boolean, inScene: boolean) => !!c.proactiveEnabled && !quiet && !inScene;
