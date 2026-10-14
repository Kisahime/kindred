// Together mode (Milestone 15, part 1): meeting a character in person.
// Pure helpers only (no I/O): scene state, markers, prompts, *action* parsing, wrap-up flag and recap maths.
import { currentBlock, isFamily, isRomantic, lifeOf, relationLabel } from "./lifecore";
import type { Character, Mood } from "./types";
import { MOODS } from "./types";

export type Activity = "date" | "hangout";
export type SceneStatus = "active" | "paused" | "ended";
export interface Scene { id: string; charId: string; place: string; activity: Activity; startedAt: number; status: SceneStatus;
  /** together2 (optional, older scenes lack them): place preset, narrator on/off, Sparkles Alex paid. */
  placeId?: string; narrator?: boolean; paid?: number;
  /** together3: the character already handed over an in-person present this scene. */
  gifted?: boolean; }

/** Stored text of a scene start/end marker: "[scene] {json}". Sent to the model as narration, never as a chat line. */
export const SCENE = "[scene]";
export interface SceneMarker { phase: "start" | "end" | "narrate" | "invite"; id: string; place: string; activity: Activity; recap?: string;
  /** narrate: the narration text. invite: suggested time + place preset. */
  text?: string; dueAt?: number; when?: WhenKind; placeId?: string; }
export const sceneKey = (charId: string) => `scene:${charId}`;
/** Tag the character adds when the meet-up is naturally wrapping up. Stripped before display. */
export const WRAP_TAG = "[END_SCENE]";

export function newScene(charId: string, place: string, activity: Activity, now = Date.now()): Scene {
  return { id: `s${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, charId, place: place.trim().slice(0, 160), activity, startedAt: now, status: "active" };
}
export function sceneMarker(m: SceneMarker): string { return `${SCENE} ${JSON.stringify(m)}`; }
export function parseSceneMarker(content: string): SceneMarker | null {
  if (!content.startsWith(SCENE)) return null;
  try {
    const v = JSON.parse(content.slice(SCENE.length));
    const phase: SceneMarker["phase"] = v.phase === "end" || v.phase === "narrate" || v.phase === "invite" ? v.phase : "start";
    return { phase, id: String(v.id ?? ""), place: String(v.place ?? ""), activity: v.activity === "date" ? "date" : "hangout", recap: v.recap ? String(v.recap) : undefined,
      text: v.text ? String(v.text) : undefined, dueAt: Number(v.dueAt) || undefined, when: v.when ? (String(v.when) as WhenKind) : undefined, placeId: v.placeId ? String(v.placeId) : undefined };
  } catch { return null; }
}
const what = (a: Activity) => (a === "date" ? "a date" : "a hangout");
/** How a marker reads to the model: unambiguous narration. */
export function sceneNarration(m: SceneMarker, user: string, name: string): string {
  if (m.phase === "narrate") return `[Narration: ${m.text ?? ""}]`;
  if (m.phase === "invite") return `[Event: You (${name}) suggested ${what(m.activity)} with ${user} at ${m.place || "somewhere nice"} (${m.dueAt ? formatDue(m.dueAt) : "soon"}); ${user} sees it as an invite to accept or decline.]`;
  if (m.phase === "start") return `[Event: ${user} and you (${name}) met up IN PERSON for ${what(m.activity)}: ${m.place || "somewhere nice"}. From here on you are physically together, talking face to face (not texting).]`;
  return `[Event: The in-person meet-up at ${m.place || "the place"} has ended. ${user} and you (${name}) are apart again and back to texting on the messenger.${m.recap ? ` What happened: ${m.recap}` : ""} Remember it; never contradict it.]`;
}
/** What the chat shows for a marker. */
export function sceneLine(m: SceneMarker, name: string): string {
  if (m.phase === "narrate") return m.text ?? "";
  if (m.phase === "invite") return `\u{1F4C5} ${name} invited you: ${m.activity === "date" ? "date" : "hangout"} at ${m.place || "somewhere"}${m.dueAt ? `, ${formatDue(m.dueAt)}` : ""}`;
  return m.phase === "start" ? `\u{1F4CD} You met up with ${name} \u00B7 ${m.place || "somewhere"} (${m.activity})` : `\u{1F44B} The meet-up with ${name} ended${m.recap ? `: ${m.recap}` : ""}`;
}

/** Activity types allowed for this relationship: romantic "date" only for partners/crushes/spouses. */
export function activityChoices(c: Pick<Character, "life">): Activity[] {
  return isRomantic(lifeOf(c).relationship) ? ["date", "hangout"] : ["hangout"];
}

/** Can they meet right now? Asleep or busy (schedule, or a busy/offline status) means no, with an in-character reason. */
export function canMeetNow(c: Pick<Character, "life" | "name" | "status">, now = new Date()): { ok: true } | { ok: false; reason: string; line: string } {
  const cur = currentBlock(lifeOf(c), now);
  if (cur?.block.status === "sleeping") return { ok: false, reason: `${c.name} is asleep right now${cur.block.place ? ` (${cur.block.place})` : ""}.`, line: "*mumbles sleepily* mm... it's so late. can we meet tomorrow? \u{1F634}" };
  if (cur?.block.status === "busy") return { ok: false, reason: `${c.name} is busy: ${cur.block.activity}.`, line: `I'd love to, but I'm ${cur.block.activity} right now. Later? \u{1F49B}` };
  if (c.status === "offline") return { ok: false, reason: `${c.name} is offline.`, line: "" };
  if (c.status === "busy") return { ok: false, reason: `${c.name} is set to Busy.`, line: "I can't get away right now, sorry! Another time?" };
  return { ok: true };
}

/** The in-person roleplay block that replaces the messenger framing while Together. */
export function togetherPrompt(c: Pick<Character, "name" | "life" | "closeness">, user: string, scene: Pick<Scene, "place" | "activity">, adult: boolean): string {
  const l = lifeOf(c), r = l.relationship;
  const romantic = isRomantic(r);
  const affection = isFamily(r)
    ? `${user} is family (your ${relationLabel(l)}): warm, caring, familiar and strictly platonic. Hugs are fine; nothing romantic or flirtatious, ever.`
    : romantic
      ? `You're ${user}'s ${relationLabel(l)}. Show affection that fits your closeness (${c.closeness}/100): ${c.closeness >= 70 ? "openly loving, holding hands, cuddles, kisses are natural" : c.closeness >= 40 ? "sweet and a bit flirty, small touches like holding hands" : "shy and a little nervous, light flirting"}.`
      : `You're ${user}'s ${relationLabel(l)}: friendly and platonic, with warmth matching your closeness (${c.closeness}/100). No romance or flirting.`;
  const limits = adult && romantic
    ? "Content: you are both adults. Things may get suggestive if it fits, but always fade to black before anything explicit: never describe sexual acts or explicit nudity; skip ahead with a time cut instead."
    : "Content: keep it wholesome. No sexual content.";
  return [
    `RIGHT NOW YOU ARE TOGETHER IN PERSON with ${user}, not texting. Where / what: ${scene.place || "somewhere nice"} (${what(scene.activity)}).`,
    "Speak out loud and act in person, in first person. Put physical actions and expressions in *asterisks* (e.g. *smiles and nudges your arm*), and speech as plain text.",
    "Never mention phones, texting, typing, emoji reactions or the messenger while you're together. React to what you can see, hear and do there.",
    "Replies are short to medium: one to four sentences, usually one action plus some speech. Leave room for them to act too; never decide what they say or do.",
    affection,
    limits,
    `If the meet-up is naturally wrapping up (saying goodbye, heading home, the evening ending), finish that reply with the tag ${WRAP_TAG}. Otherwise never write it.`,
    "Stay in character, never mention being an AI or a language model.",
  ].join("\n");
}

// ---- *action* parsing --------------------------------------------------------
export type Seg = { kind: "speech" | "action"; text: string };
/** Splits text into speech and *action* segments. **bold** and lone asterisks stay speech. */
export function splitActions(text: string): Seg[] {
  const out: Seg[] = [];
  const re = /(?<![*\w])\*(?![*\s])([^*\n]*?[^*\s])\*(?![*\w])/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[1].trim()) continue;
    if (m.index > last) out.push({ kind: "speech", text: text.slice(last, m.index) });
    out.push({ kind: "action", text: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "speech", text: text.slice(last) });
  return out.filter((s) => s.text.length > 0);
}
export const hasActions = (text: string) => splitActions(text).some((s) => s.kind === "action");

/** Strips the wrap-up tag; `ended` tells whether the character is wrapping the scene up. */
export function detectWrap(text: string): { text: string; ended: boolean } {
  const ended = text.includes(WRAP_TAG) || /\[\s*end[_ ]scene\s*\]/i.test(text);
  return { text: ended ? text.replace(/\[\s*end[_ ]scene\s*\]/gi, "").trim() : text, ended };
}

/** Proactive messages are paused for a character while a scene is active. */
export const proactivePaused = (scene: Scene | null | undefined) => scene?.status === "active";
/** On startup, an active scene means the app was closed mid-scene: pause it so the user can resume or end. */
export function pauseOnStartup(scene: Scene | null): Scene | null {
  return scene && scene.status === "active" ? { ...scene, status: "paused" } : scene;
}

// ---- recap -------------------------------------------------------------------
export interface Recap { recap: string; memory: string; post: string; rating: number; mood: Mood | null; followUp: string; }
export const RATING_DELTA: Record<number, number> = { 1: -3, 2: -1, 3: 1, 4: 3, 5: 5 };

export function buildRecapPrompt(c: Pick<Character, "name" | "personality" | "mood">, user: string, scene: Pick<Scene, "place" | "activity">, transcript: string) {
  return [
    { role: "system", content: [
      `You summarise an in-person meet-up between ${c.name} (${c.personality || "a character"}) and ${user}: ${what(scene.activity)} at ${scene.place || "somewhere"}.`,
      `recap: two or three sentences, past tense, third person, what they did and how it felt. No explicit content.`,
      `memory: one sentence ${c.name} will remember about this meet-up with ${user}.`,
      `post: a short status update ${c.name} would post on their Messenger "What's new" feed about it (max 140 characters, an emoji is fine, no explicit content).`,
      `rating: an integer 1-5, how well it went for ${c.name} (1 awful, 3 fine, 5 wonderful).`,
      `mood: ${c.name}'s mood afterwards, one of ${MOODS.join(", ")}.`,
      `Photos taken and gifts given during the meet-up may be mentioned in the recap and memory.`,
      `follow_up: a short text ${c.name} might send ${user} later on the messenger (e.g. "had a great time tonight"), or "" for none.`,
      'Respond only with JSON: {"recap":"","memory":"","post":"","rating":3,"mood":"","follow_up":""}',
    ].join("\n") },
    { role: "user", content: transcript || "(they didn't say much)" },
  ];
}
export function parseRecap(raw: any, fallbackMood: Mood): Recap {
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const rating = Math.max(1, Math.min(5, Math.round(Number(raw?.rating) || 3)));
  return { recap: s(raw?.recap, 600), memory: s(raw?.memory, 300), post: s(raw?.post, 160), rating,
    mood: MOODS.includes(raw?.mood) ? raw.mood : fallbackMood, followUp: s(raw?.follow_up ?? raw?.followUp, 200) };
}
export const closenessAfter = (closeness: number, rating: number) => Math.max(0, Math.min(100, closeness + (RATING_DELTA[rating] ?? 0)));
/** Milestone for a first: first_date / first_hangout. */
export const firstMilestone = (activity: Activity, name: string) => activity === "date"
  ? { kind: "first_date", title: `First date with ${name}` } : { kind: "first_hangout", title: `First hangout with ${name}` };

/** Transcript of the scene's messages for the recap prompt. */
export function sceneTranscript(msgs: { from: "me" | "them"; text: string }[], user: string, name: string, max = 4000): string {
  const lines: string[] = [];
  for (const m of msgs) {
    if (m.text.startsWith("\u26A0")) continue;
    const mk = parseSceneMarker(m.text);
    if (mk?.phase === "narrate" && mk.text) { lines.push(`(narrator: ${mk.text})`); continue; }
    if (mk || m.text.startsWith(SCENE)) continue;
    if (m.text.startsWith("[selfie]")) { lines.push(`(photo taken: ${m.text.slice(8).trim()})`); continue; }
    if (m.text.startsWith("[gift]")) { lines.push(`(${m.from === "me" ? user : name} gave a gift: ${m.text.slice(6).replace("(in person)", "").trim()})`); continue; }
    lines.push(`${m.from === "me" ? user : name}: ${m.text}`);
  }
  const t = lines.join("\n");
  return t.length > max ? "..." + t.slice(-max) : t;
}

/** Runs the recap with an injectable JSON model call (fake in tests, Ollama in the app). */
export async function runRecap(c: Pick<Character, "name" | "personality" | "mood" | "model">, user: string, scene: Scene, transcript: string,
  callJson: (model: string, messages: { role: string; content: string }[], temperature?: number) => Promise<string>, parse: (t: string) => any): Promise<Recap> {
  const raw = parse(await callJson(c.model, buildRecapPrompt(c, user, scene, transcript), 0.4));
  const r = parseRecap(raw, c.mood as Mood);
  if (!r.recap) r.recap = `${user} and ${c.name} spent time together at ${scene.place || "a nice spot"}.`;
  if (!r.memory) r.memory = `${c.name} met up with ${user} at ${scene.place || "a nice spot"}.`;
  return r;
}

// ---- Plan for later ------------------------------------------------------------
export type WhenKind = "next_free" | "tonight" | "tomorrow_afternoon" | "this_weekend" | "at";
export type PlanStatus = "planned" | "ready" | "started" | "cancelled";
export interface PlannedMeetup {
  id: string; charId: string; place: string; activity: Activity;
  when: WhenKind; dueAt: number; status: PlanStatus; createdAt: number; notified?: boolean;
  /** together2 (optional): place preset, narrator, who pays. */
  placeId?: string; narrator?: boolean; pay?: "me" | "split" | "them";
}
export const PLANS_KEY = "meetup_plans";
export const openPlans = (plans: PlannedMeetup[], charId?: string) =>
  plans.filter((p) => (p.status === "planned" || p.status === "ready") && (!charId || p.charId === charId));

const pad = (n: number) => String(n).padStart(2, "0");
const atDay = (d: Date, h: number, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const FREE: Array<"online" | "away"> = ["online", "away"];

/** Next time the character's schedule is free (online/away), searching up to a week ahead. Falls back to tomorrow 18:00 with no schedule. */
export function nextFreeAt(c: Pick<Character, "life">, now = new Date()): Date {
  const l = lifeOf(c);
  for (let day = 0; day < 8; day++) {
    const d = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), day);
    const we = d.getDay() === 0 || d.getDay() === 6;
    const list = we ? (l.weekend.length ? l.weekend : l.weekday) : (l.weekday.length ? l.weekday : l.weekend);
    if (!list.length) continue;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!FREE.includes(b.status as "online" | "away")) continue;
      const [hh, mm] = b.start.split(":").map(Number);
      const start = atDay(d, hh, mm);
      if (start.getTime() <= now.getTime() + 5 * 60_000) continue; // at least 5 minutes away
      return start;
    }
  }
  return atDay(addDays(now, 1), 18);
}

/** Resolves a when-choice to an absolute Date. `at` is for the datetime picker (ISO or timestamp). */
export function resolveWhen(kind: WhenKind, c: Pick<Character, "life">, now = new Date(), at?: number | string): Date {
  if (kind === "next_free") return nextFreeAt(c, now);
  if (kind === "tonight") { const t = atDay(now, 19); return t.getTime() > now.getTime() + 30 * 60_000 ? t : atDay(addDays(now, 1), 19); }
  if (kind === "tomorrow_afternoon") return atDay(addDays(now, 1), 14);
  if (kind === "this_weekend") {
    const day = now.getDay(); // 0 Sun .. 6 Sat
    if (day === 0 && now.getHours() < 13) return atDay(now, 14); // Sunday morning: this afternoon
    let toSat = (6 - day + 7) % 7;
    if (toSat === 0 && now.getHours() >= 13) toSat = 1; // Saturday afternoon already: Sunday
    if (day === 0) toSat = 6;
    return atDay(addDays(now, toSat), 14);
  }
  const raw = typeof at === "number" ? at : Date.parse(String(at ?? ""));
  return Number.isFinite(raw) && raw > now.getTime() ? new Date(raw) : nextFreeAt(c, now);
}

export function newPlan(charId: string, place: string, activity: Activity, kind: WhenKind, dueAt: number, now = Date.now(),
  opts: Partial<Pick<PlannedMeetup, "placeId" | "narrator" | "pay">> = {}): PlannedMeetup {
  return { id: `p${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, charId, place: place.trim().slice(0, 160), activity, when: kind, dueAt, status: "planned", createdAt: now, ...opts };
}

export const WHEN_LABELS: Record<WhenKind, string> = {
  next_free: "Next free window", tonight: "Tonight", tomorrow_afternoon: "Tomorrow afternoon", this_weekend: "This weekend", at: "Pick a date & time",
};

/** Friendly "Sat 18 Oct, 14:00" / "tonight at 19:00". */
export function formatDue(dueAt: number, now = Date.now()): string {
  const d = new Date(dueAt), n = new Date(now);
  const same = d.toDateString() === n.toDateString();
  const tom = d.toDateString() === addDays(n, 1).toDateString();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (same) return `today at ${time}`;
  if (tom) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} at ${time}`;
}

/** Short line for chat cards and feed. */
export function planSummary(p: PlannedMeetup, name: string): string {
  return `${p.activity === "date" ? "Date" : "Hangout"} with ${name} \u00B7 ${p.place || "somewhere"} \u00B7 ${formatDue(p.dueAt)}`;
}

/**
 * Tick one plan: when due, wait if the character or user can't meet, re-aim "next free", else mark ready.
 * Returns the (possibly updated) plan, and whether a notification should fire (false in quiet hours).
 */
export function tickPlan(p: PlannedMeetup, c: Pick<Character, "life" | "name" | "status">, userStatus: string, quiet: boolean, now = Date.now()): { plan: PlannedMeetup; notify: boolean } {
  if (p.status !== "planned" || p.dueAt > now) return { plan: p, notify: false };
  // Character still asleep/busy: for "next free" push to the next free window; otherwise wait for them to free up.
  const can = canMeetNow(c, new Date(now));
  if (!can.ok) {
    if (p.when === "next_free") {
      const next = nextFreeAt(c, new Date(now)).getTime();
      return { plan: { ...p, dueAt: Math.max(next, now + 10 * 60_000) }, notify: false };
    }
    return { plan: p, notify: false };
  }
  // User Busy / Appear offline: defer until they're available.
  if (userStatus === "busy" || userStatus === "offline") return { plan: p, notify: false };
  const ready = { ...p, status: "ready" as const, notified: true };
  return { plan: ready, notify: !quiet && !p.notified };
}

/** Can she press Start on this plan right now? Ready plans always; planned ones only if both free. */
export function canStartPlan(p: PlannedMeetup, c: Pick<Character, "life" | "name" | "status">, now = new Date()): boolean {
  if (p.status === "ready") return canMeetNow(c, now).ok;
  if (p.status === "planned" && canMeetNow(c, now).ok) return true; // start early if free
  return false;
}

/** Line injected into the character's prompt so they can mention looking forward to it. */
export function planPrompt(plans: PlannedMeetup[], user: string, now = Date.now()): string {
  const open = openPlans(plans).filter((p) => p.dueAt > now - 60_000);
  if (!open.length) return "";
  return open.map((p) => {
    const when = formatDue(p.dueAt, now);
    return `You have a planned ${p.activity} with ${user}: ${p.place || "somewhere nice"} (${when}). You may mention looking forward to it naturally; don't nag.`;
  }).join("\n");
}
