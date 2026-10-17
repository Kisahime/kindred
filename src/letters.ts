// v1.3 Living World: letters from characters (and the user's replies) and characters' diaries. Stored in SQLite (table "letters").
import { invoke } from "@tauri-apps/api/core";
import { Character, StoredMessage, toModelText } from "./types";
import { isFamily, isRomantic, lifeOf } from "./lifecore";
import type { WFreq, WorldCfg } from "./world";

export interface Letter { id: number; characterId: string; kind: "letter" | "diary"; fromUser: boolean; title: string; body: string; replyTo: number; createdAt: number; isRead: boolean; }
export const lettersApi = {
  list: (characterId: string | null = null, kind: "letter" | "diary" | null = null, limit = 200) => invoke<Letter[]>("letters_list", { characterId, kind, limit }),
  add: (characterId: string, kind: "letter" | "diary", fromUser: boolean, title: string, body: string, replyTo = 0) => invoke<Letter>("letter_add", { characterId, kind, fromUser, title, body, replyTo }),
  markRead: (characterId: string | null = null, kind: "letter" | "diary" | null = null) => invoke<void>("letters_mark_read", { characterId, kind }),
  remove: (id: number) => invoke<void>("letter_delete", { id }),
  unread: () => invoke<Record<string, number>>("letters_unread"),
};

// ---- when ------------------------------------------------------------------------------
/** Days between letters from one character (shorter when closer). */
export const LETTER_GAP_DAYS: Record<WFreq, number> = { off: 0, rarely: 10, sometimes: 5, often: 2 };
export const LETTER_MIN_CLOSENESS = 35;
/** Diary pages unlock at these closeness levels (deeper entries at each). */
export const DIARY_UNLOCK = [50, 70, 90];
export const diaryLevel = (closeness: number) => DIARY_UNLOCK.filter((n) => closeness >= n).length;
export interface LetterState { last: Record<string, number>; lastAny: number; diary: Record<string, string>; }
export const LETTER_STATE_KEY = "letters_state";
export const blankLetterState = (): LetterState => ({ last: {}, lastAny: 0, diary: {} });
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function letterGapMs(c: Pick<Character, "closeness">, f: WFreq): number {
  const days = LETTER_GAP_DAYS[f];
  return days ? days * 86_400_000 * Math.max(0.6, 1 - (c.closeness - LETTER_MIN_CLOSENESS) / 150) : 0;
}
/** Is a letter from c due? At most one letter a day across everyone; after the gap, about once in 12 h of checks (10-min ticks). */
export function letterDue(c: Pick<Character, "id" | "closeness" | "proactiveEnabled" | "createdAt">, st: LetterState, cfg: Pick<WorldCfg, "letters">, now = Date.now(), rand = Math.random): boolean {
  const gap = letterGapMs(c, cfg.letters);
  if (!gap || !c.proactiveEnabled || c.closeness < LETTER_MIN_CLOSENESS) return false;
  if (st.lastAny && dayKey(new Date(st.lastAny)) === dayKey(new Date(now))) return false;
  const since = st.last[c.id] || c.createdAt || 0;
  if (now - since < gap) return false;
  return rand() < 1 / 72;
}
/** A diary entry tonight? Closeness 50+, once a day, from 17:00, only after chatting with the user in the last 24 h. */
export function diaryDue(c: Pick<Character, "id" | "closeness">, st: LetterState, cfg: Pick<WorldCfg, "diaries">, lastChatAt: number, now = new Date()): boolean {
  if (!cfg.diaries || diaryLevel(c.closeness) < 1 || now.getHours() < 17) return false;
  if (st.diary[c.id] === dayKey(now)) return false;
  return now.getTime() - lastChatAt < 86_400_000;
}

// ---- prompts -------------------------------------------------------------------------------
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().replace(/^["']|["']$/g, "").trim().slice(0, n);
const chat = (msgs: StoredMessage[], user: string, name: string) =>
  msgs.filter((m) => !m.isError).slice(-30).map((m) => `${m.role === "user" ? user : name}: ${toModelText(m.content, m.role === "user", user, name)}`).join("\n");
function tone(c: Pick<Character, "life">, user: string): string {
  const r = lifeOf(c).relationship;
  return isFamily(r) ? `You are family to ${user}: warm and caring, strictly platonic (never romantic).`
    : isRomantic(r) ? `You are in a romantic relationship with ${user}: loving and tender, but tasteful (no explicit content).`
    : `Keep it platonic and warm.`;
}
export function buildLetterPrompt(c: Character, user: string, recent: StoredMessage[], memories: string[], sys: string) {
  return [
    { role: "system", content: `${sys}\n\nAnswer with JSON only.` },
    { role: "user", content: [
      memories.length ? `Things you remember:\n${memories.slice(0, 10).map((m) => `- ${m}`).join("\n")}` : "",
      recent.length ? `Your recent chats with ${user}:\n${chat(recent, user, c.name)}` : "",
      `Write ${user} a real letter (not a text message): 120-220 words in 2-4 short paragraphs, in your own voice, starting "Dear ${user}," and signed with your name.`,
      `Make it personal: something from your own life lately, something specific you remember from your chats or time together, and how you feel about ${user}. ${tone(c, user)} No explicit content.`,
      'JSON: {"title":"a short title for the letter","letter":"the full letter, paragraphs separated by \\n\\n"}',
    ].filter(Boolean).join("\n\n") },
  ];
}
export function buildLetterReplyPrompt(c: Character, user: string, thread: Pick<Letter, "fromUser" | "body">[], sys: string) {
  const t = thread.slice(-4).map((l) => `${l.fromUser ? user : c.name} wrote:\n${clip(l.body, 1500)}`).join("\n\n---\n\n");
  return [
    { role: "system", content: `${sys}\n\nAnswer with JSON only.` },
    { role: "user", content: [
      `Your letters with ${user} so far (newest last):\n\n${t}`,
      `Write back to ${user}'s latest letter: 80-180 words, a real letter in your own voice, answering what they wrote, starting "Dear ${user}," and signed with your name. ${tone(c, user)} No explicit content.`,
      'JSON: {"title":"a short title","letter":"the full letter, paragraphs separated by \\n\\n"}',
    ].join("\n\n") },
  ];
}
export const DIARY_DEPTH = [
  "",
  "a light, honest entry: what you did today and how talking with them made you feel",
  "a more personal entry: little hopes, worries and things you haven't told them",
  "your deepest, most honest feelings about what they mean to you, and a secret or two you'd only tell your diary",
];
export function buildDiaryPrompt(c: Character, user: string, recent: StoredMessage[], level: number, sys: string, now = new Date()) {
  return [
    { role: "system", content: `${sys}\n\nAnswer with JSON only.` },
    { role: "user", content: [
      recent.length ? `Today's chats with ${user}:\n${chat(recent, user, c.name)}` : "",
      `It's ${now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}, evening. Write tonight's page in your private diary (${user} will never read it, so be honest): 80-170 words, first person, starting "Dear diary,". Make it ${DIARY_DEPTH[Math.max(1, Math.min(3, level))]}.`,
      `${tone(c, user)} No explicit content.`,
      'JSON: {"title":"a few words for the day","entry":"the diary page"}',
    ].filter(Boolean).join("\n\n") },
  ];
}
export function interpretLetter(raw: any, kind: "letter" | "diary"): { title: string; body: string } | null {
  const body = clip(kind === "diary" ? raw?.entry ?? raw?.diary ?? raw?.letter : raw?.letter ?? raw?.body ?? raw?.text, 3000);
  if (body.length < 40) return null;
  return { title: clip(raw?.title, 80) || (kind === "diary" ? "Diary" : "A letter"), body };
}
/** Letters grouped into threads (a letter and the replies that follow it), newest thread first. */
export function letterThreads(list: Letter[]): Letter[][] {
  const letters = list.filter((l) => l.kind === "letter").sort((a, b) => a.id - b.id);
  const rootOf = new Map<number, number>();
  const threads = new Map<number, Letter[]>();
  for (const l of letters) {
    const root = l.replyTo && rootOf.has(l.replyTo) ? rootOf.get(l.replyTo)! : l.id;
    rootOf.set(l.id, root);
    threads.set(root, [...(threads.get(root) ?? []), l]);
  }
  return [...threads.values()].sort((a, b) => b[b.length - 1].id - a[a.length - 1].id);
}
