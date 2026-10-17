// v1.3 Living World: seasonal events (New Year, Valentine's Day, Halloween, Christmas). The user's birthday is handled in App (profile).
import { isFamily, isRomantic, lifeOf } from "./lifecore";
import type { Character } from "./types";

export type EventId = "newyear" | "valentines" | "halloween" | "christmas";
export interface SeasonEvent { id: EventId; name: string; emoji: string; days: [number, number][]; decor: [number, number, number, number]; }
// days: [month(1-12), day] the event happens on; decor: [fromMonth, fromDay, toMonth, toDay] (wraps over New Year)
export const EVENTS: SeasonEvent[] = [
  { id: "newyear", name: "New Year", emoji: "\u{1F386}", days: [[12, 31], [1, 1]], decor: [12, 27, 1, 1] },
  { id: "valentines", name: "Valentine's Day", emoji: "\u{1F49D}", days: [[2, 14]], decor: [2, 7, 2, 14] },
  { id: "halloween", name: "Halloween", emoji: "\u{1F383}", days: [[10, 31]], decor: [10, 24, 10, 31] },
  { id: "christmas", name: "Christmas", emoji: "\u{1F384}", days: [[12, 24], [12, 25]], decor: [12, 1, 12, 26] },
];
const md = (d: Date) => (d.getMonth() + 1) * 100 + d.getDate();
export function eventToday(d = new Date()): SeasonEvent | null {
  return EVENTS.find((e) => e.days.some(([m, day]) => d.getMonth() + 1 === m && d.getDate() === day)) ?? null;
}
export function decorFor(d = new Date()): SeasonEvent | null {
  const x = md(d);
  return EVENTS.find((e) => { const a = e.decor[0] * 100 + e.decor[1], b = e.decor[2] * 100 + e.decor[3]; return a <= b ? x >= a && x <= b : x >= a || x <= b; }) ?? null;
}
/** Days until the event's first day (0 = today). */
export function daysUntil(e: SeasonEvent, d = new Date()): number {
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let best = Infinity;
  for (const [m, day] of e.days) for (const y of [d.getFullYear(), d.getFullYear() + 1]) {
    const t = new Date(y, m - 1, day);
    const n = Math.round((t.getTime() - today.getTime()) / 86_400_000);
    if (n >= 0 && n < best) best = n;
  }
  return best;
}
/** The event label for its year (New Year's Eve counts towards the coming year). */
export const eventYear = (e: SeasonEvent, d = new Date()) => e.id === "newyear" && d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
/** Context line for prompts while an event is on or coming up. */
export function eventNotice(d = new Date()): string {
  const today = eventToday(d);
  if (today) {
    const eve = (today.id === "newyear" && d.getMonth() === 11) || (today.id === "christmas" && d.getDate() === 24);
    return `Today is ${eve ? `${today.name === "New Year" ? "New Year's" : today.name} Eve` : today.name === "New Year" ? "New Year's Day" : today.name} ${today.emoji}.`;
  }
  const soon = decorFor(d);
  if (soon) { const n = daysUntil(soon, d); return `${soon.name} is coming up (in ${n} day${n === 1 ? "" : "s"}).`; }
  return "";
}
/** What a character's seasonal message should be about, or null for no message (family never gets a Valentine). */
export function eventMessageNote(e: SeasonEvent, c: Pick<Character, "life" | "name">, user: string, d = new Date()): string | null {
  const r = lifeOf(c).relationship;
  switch (e.id) {
    case "newyear": return d.getMonth() === 11 ? `It's New Year's Eve. Send ${user} a short, warm message about the year ending and the one ahead.` : `It's New Year's Day. Wish ${user} a happy new year in a short, warm message.`;
    case "halloween": return `It's Halloween! Send ${user} a short, playful, spooky-cosy message (a costume, sweets, a scary film, carved pumpkins...). Nothing gory or explicit.`;
    case "christmas": return d.getDate() === 24 ? `It's Christmas Eve. Send ${user} a short, cosy, festive message.` : `It's Christmas Day. Wish ${user} a merry Christmas in a short, warm message.`;
    case "valentines":
      if (isFamily(r)) return null;
      return isRomantic(r) ? `It's Valentine's Day. Send ${user} a short, sweet and loving Valentine's message (tasteful).`
        : `It's Valentine's Day. Send ${user} a short, friendly and strictly platonic message (e.g. a "happy Galentine's" or how glad you are to have them as a friend). Nothing romantic.`;
  }
}
export function eventPostPrompt(e: SeasonEvent, sys: string, d = new Date()) {
  return [
    { role: "system", content: `${sys}\n\nAnswer with JSON only.` },
    { role: "user", content: `${eventNotice(d)} Write a short status update for your Messenger "What's new" feed about how you're spending it (max 160 characters, an emoji is fine). No explicit content. JSON: {"post":""}` },
  ];
}
export interface SeasonalState { [key: string]: { post: boolean; sent: string[] }; }
export const SEASONAL_KEY = "seasonal_done";
export const seasonalKey = (e: SeasonEvent, d = new Date()) => `${e.id}-${eventYear(e, d)}`;
