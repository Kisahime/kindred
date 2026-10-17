// v1.3 Living World: world options, character-to-character relations, and the extra prompt context ("People you know").
// Relations live in SQLite (kv "char_relations"), so data backups include them. Family is always platonic.
import { api } from "./api";
import { econApi } from "./economy";
import { parseJson } from "./mind";
import { transcript as groupTranscript } from "./groupchat";
import { Character, Group, GroupMessage, setWorldBlock } from "./types";
import { isProtectedMinor, pairTypeAllowed } from "./protect";

/** kv storage (SQLite); swappable in tests. */
export const worldKv = { get: <T,>(key: string) => econApi.kvGet<T>(key), set: (key: string, value: unknown) => econApi.kvSet(key, value) };
export const setWorldKvForTest = (get: (k: string) => Promise<any>, set: (k: string, v: unknown) => Promise<void>) => { worldKv.get = get as never; worldKv.set = set; };

// ---- options -----------------------------------------------------------------------
export type WFreq = "off" | "rarely" | "sometimes" | "often";
export interface WorldCfg {
  relations: boolean;   // characters' relations evolve in the background
  feedSocial: boolean;  // characters like / comment on each other's posts
  feedPhotos: WFreq;    // how often a feed post gets a photo (selfie rules still apply)
  feedPhotoCap: number; // max feed photos a day
  letters: WFreq;       // letters from characters
  diaries: boolean;     // characters keep diaries
  seasonal: boolean;    // seasonal events + decorations
  weather: boolean;     // real weather from Open-Meteo (off until enabled)
}
export const DEFAULT_WORLD: WorldCfg = { relations: true, feedSocial: true, feedPhotos: "sometimes", feedPhotoCap: 4, letters: "sometimes", diaries: true, seasonal: true, weather: false };
export const WORLD_KEY = "world_cfg";
const FREQS: WFreq[] = ["off", "rarely", "sometimes", "often"];
export function normalizeWorld(raw: unknown): WorldCfg {
  const r = (raw ?? {}) as Partial<WorldCfg>;
  const b = (k: keyof WorldCfg) => (typeof r[k] === "boolean" ? r[k] : DEFAULT_WORLD[k]) as boolean;
  const f = (k: "feedPhotos" | "letters") => (FREQS.includes(r[k] as WFreq) ? r[k] : DEFAULT_WORLD[k]) as WFreq;
  const cap = Math.round(Number(r.feedPhotoCap));
  return { relations: b("relations"), feedSocial: b("feedSocial"), feedPhotos: f("feedPhotos"), feedPhotoCap: cap >= 0 && cap <= 20 ? cap : DEFAULT_WORLD.feedPhotoCap,
    letters: f("letters"), diaries: b("diaries"), seasonal: b("seasonal"), weather: b("weather") };
}
let cfg: WorldCfg = { ...DEFAULT_WORLD };
export const worldCfg = () => cfg;
export async function loadWorld(): Promise<WorldCfg> { cfg = normalizeWorld(await worldKv.get(WORLD_KEY).catch(() => null)); return cfg; }
export async function saveWorld(c: WorldCfg) { cfg = normalizeWorld(c); await worldKv.set(WORLD_KEY, cfg); }
export const setWorldForTest = (c: Partial<WorldCfg>) => { cfg = normalizeWorld({ ...DEFAULT_WORLD, ...c }); };

// ---- relations between characters ---------------------------------------------------------
export type PairType = "acquaintance" | "friend" | "best friend" | "rival" | "crush" | "partner" | "family";
export const PAIR_TYPES: { id: PairType; label: string }[] = [
  { id: "acquaintance", label: "Acquaintances" }, { id: "friend", label: "Friends" }, { id: "best friend", label: "Best friends" },
  { id: "rival", label: "Friendly rivals" }, { id: "crush", label: "Crush (romantic)" }, { id: "partner", label: "Partners (romantic)" }, { id: "family", label: "Family (always platonic)" },
];
/** Types the background world may switch between by itself. Romance and family are only ever set by hand. */
export const AUTO_TYPES: PairType[] = ["acquaintance", "friend", "best friend", "rival"];
export const ROMANTIC_PAIR: PairType[] = ["crush", "partner"];
export interface PairNote { t: number; text: string; }
export interface Relation {
  a: string; b: string;              // character ids, a < b
  type: PairType;
  family: string;                    // family detail when type is family, e.g. "sisters", "cousins"
  affinity: number;                  // -100..100
  opinions: Record<string, string>;  // charId -> what that character thinks of the other
  notes: PairNote[];                 // newest last, max 12
  manual: boolean;                   // locked: the world tick never changes the type
  updatedAt: number;
}
export const RELATIONS_KEY = "char_relations";
export const MAX_NOTES = 12;
export const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
const clampAff = (n: number) => Math.max(-100, Math.min(100, Math.round(Number(n) || 0)));
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "").trim().slice(0, n);

export function blankRelation(x: string, y: string): Relation {
  const [a, b] = x < y ? [x, y] : [y, x];
  return { a, b, type: "acquaintance", family: "", affinity: 0, opinions: {}, notes: [], manual: false, updatedAt: 0 };
}
export function normalizeRelation(raw: unknown, x: string, y: string): Relation {
  const r = (raw ?? {}) as Partial<Relation>;
  const base = blankRelation(x, y);
  const type = PAIR_TYPES.some((t) => t.id === r.type) ? r.type as PairType : "acquaintance";
  const opinions: Record<string, string> = {};
  for (const id of [base.a, base.b]) { const o = clip(r.opinions?.[id], 200); if (o) opinions[id] = o; }
  const notes = (Array.isArray(r.notes) ? r.notes : []).map((n) => ({ t: Number(n?.t) || 0, text: clip(n?.text, 240) })).filter((n) => n.text).slice(-MAX_NOTES);
  return { ...base, type, family: type === "family" ? clip(r.family, 40) : "", affinity: clampAff(r.affinity ?? 0), opinions, notes, manual: !!r.manual, updatedAt: Number(r.updatedAt) || 0 };
}
export function normalizeRelations(raw: unknown): Record<string, Relation> {
  const out: Record<string, Relation> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const [x, y] = k.split("|");
    if (x && y && x !== y) out[pairKey(x, y)] = normalizeRelation(v, x, y);
  }
  return out;
}
let rels: Record<string, Relation> = {};
let relsLoaded = false;
export const relationsCache = () => rels;
export const setRelationsForTest = (r: Record<string, Relation>) => { rels = normalizeRelations(r); relsLoaded = true; };
export async function loadRelations(): Promise<Record<string, Relation>> {
  rels = normalizeRelations(await worldKv.get(RELATIONS_KEY).catch(() => null)); relsLoaded = true;
  await migrateOptIn().catch((e) => console.warn("[relations] opt-in cleanup", e));
  return rels;
}
/** Pairs are opt-in: the user picks who knows whom. This flag marks the one-time cleanup of pairs the old version created by itself. */
export const RELATIONS_OPTIN_KEY = "char_relations_optin_v1";
let optInChecked = false;
export const resetOptInForTest = () => { optInChecked = false; };
/** A pair nobody ever touched: default type, neutral affinity, no opinions, no history, not kept. */
export const untouchedPair = (r: Relation) => r.type === "acquaintance" && r.affinity === 0 && !Object.keys(r.opinions).length && !r.notes.length && !r.manual;
async function migrateOptIn(): Promise<number> {
  if (optInChecked) return 0;
  const done = await worldKv.get(RELATIONS_OPTIN_KEY).catch(() => undefined);
  if (done === undefined) return 0; // kv not reachable: try again next load
  optInChecked = true;
  if (done) return 0;
  const keep = Object.fromEntries(Object.entries(rels).filter(([, r]) => !untouchedPair(r)));
  const removed = Object.keys(rels).length - Object.keys(keep).length;
  if (removed) { rels = keep; await worldKv.set(RELATIONS_KEY, rels); }
  await worldKv.set(RELATIONS_OPTIN_KEY, { at: Date.now(), removed, kept: Object.keys(keep).length });
  console.info(`[relations] opt-in cleanup: removed ${removed} untouched pair(s), kept ${Object.keys(keep).length}`);
  return removed;
}
/** The user links two characters (mutual: it shows in both editors). Returns the pair (existing or new). */
export async function addRelation(x: string, y: string): Promise<Relation> {
  if (!relsLoaded) await loadRelations();
  if (!x || !y || x === y) throw new Error("Pick someone else");
  const old = relationOf(x, y);
  if (old) return old;
  await saveRelation({ ...blankRelation(x, y), updatedAt: Date.now() });
  return relationOf(x, y)!;
}
/** Unlinks two characters (both sides). */
export async function removeRelation(x: string, y: string): Promise<Record<string, Relation>> {
  if (!relsLoaded) await loadRelations();
  const k = pairKey(x, y);
  if (rels[k]) { const n = { ...rels }; delete n[k]; rels = n; await worldKv.set(RELATIONS_KEY, rels); }
  return rels;
}
/** Has the pair real data worth a confirm before removing? */
export const pairHasHistory = (r: Relation) => !!r.notes.length || !!Object.keys(r.opinions).length || r.affinity !== 0 || r.manual || r.type !== "acquaintance";
export async function saveRelation(r: Relation): Promise<Record<string, Relation>> {
  if (!relsLoaded) await loadRelations();
  const n = normalizeRelation(r, r.a, r.b);
  const who = worldChars.filter((c) => c.id === n.a || c.id === n.b);
  if (!pairTypeAllowed(n.type, ...who)) n.type = "friend"; // never romantic with a protected (under-18) character
  rels = { ...rels, [pairKey(r.a, r.b)]: n };
  await worldKv.set(RELATIONS_KEY, rels);
  return rels;
}
/** Removes relations of deleted characters. */
export async function pruneRelations(liveIds: string[]) {
  if (!relsLoaded) await loadRelations();
  const keep = Object.fromEntries(Object.entries(rels).filter(([, r]) => liveIds.includes(r.a) && liveIds.includes(r.b)));
  if (Object.keys(keep).length !== Object.keys(rels).length) { rels = keep; await worldKv.set(RELATIONS_KEY, rels); }
}
export const relationOf = (x: string, y: string, all = rels): Relation | null => all[pairKey(x, y)] ?? null;
export const isPairRomantic = (r: Pick<Relation, "type">) => ROMANTIC_PAIR.includes(r.type);

/** The type the world would give this pair after an affinity change (never touches manual, romantic or family pairs). */
export function autoType(r: Relation, affinity: number): PairType {
  if (r.manual || !AUTO_TYPES.includes(r.type)) return r.type;
  return affinity >= 70 ? "best friend" : affinity >= 25 ? "friend" : affinity <= -30 ? "rival" : "acquaintance";
}
/** Applies one evolution step: affinity delta (clamped), new opinions, a history note. */
export function applyChange(r: Relation, delta: number, opinions: Record<string, string>, note: string, now = Date.now()): Relation {
  const affinity = clampAff(r.affinity + Math.max(-10, Math.min(10, Math.round(Number(delta) || 0))));
  const ops = { ...r.opinions };
  for (const id of [r.a, r.b]) { const o = clip(opinions[id], 200); if (o) ops[id] = o; }
  const notes = note ? [...r.notes, { t: now, text: clip(note, 240) }].slice(-MAX_NOTES) : r.notes;
  return { ...r, affinity, opinions: ops, notes, type: autoType(r, affinity), updatedAt: now };
}

const warmth = (n: number) => n >= 70 ? "very close" : n >= 35 ? "warm" : n >= 10 ? "friendly" : n > -10 ? "neutral" : n > -40 ? "a bit prickly" : "tense";
/** One line for c's prompt about `other`. */
export function relationLine(c: Pick<Character, "id" | "name">, other: Pick<Character, "id" | "name">, r: Relation): string {
  const kind = r.type === "family" ? `${other.name} is family (${r.family || "relative"}): warm and familiar, strictly platonic, never romantic`
    : r.type === "crush" ? `you have a quiet crush on ${other.name}`
    : r.type === "partner" ? `${other.name} is your partner`
    : r.type === "rival" ? `you and ${other.name} are friendly rivals (teasing, never cruel)`
    : r.type === "best friend" ? `${other.name} is one of your best friends`
    : r.type === "friend" ? `${other.name} is your friend` : `you know ${other.name} a little`;
  const op = r.opinions[c.id] ? `; you think: "${r.opinions[c.id]}"` : "";
  const last = r.notes[r.notes.length - 1];
  return `- ${kind} (feels ${warmth(r.affinity)})${op}${last ? `; lately: ${last.text}` : ""}`;
}
/** "People you know" block for c's prompts: the strongest/most recent relations, max 6. */
export function relationsBlock(c: Pick<Character, "id" | "name">, chars: Pick<Character, "id" | "name">[], userName: string, all = rels, max = 6): string {
  const lines = chars.filter((o) => o.id !== c.id).map((o) => ({ o, r: relationOf(c.id, o.id, all) }))
    .filter((x): x is { o: Pick<Character, "id" | "name">; r: Relation } => !!x.r)
    .sort((x, y) => (Math.abs(y.r.affinity) + (y.r.type !== "acquaintance" ? 30 : 0) + y.r.updatedAt / 1e12) - (Math.abs(x.r.affinity) + (x.r.type !== "acquaintance" ? 30 : 0) + x.r.updatedAt / 1e12))
    .slice(0, max).map(({ o, r }) => relationLine(c, o, r));
  if (!lines.length) return "";
  return `Other people in your life (also friends of ${userName || "the user"}). Mention them naturally now and then when it fits, but don't overdo it and never speak for them:\n${lines.join("\n")}`;
}

// ---- world tick: small offline moments between two characters --------------------------------
/** Picks a pair to evolve, only among pairs the user linked: pairs sharing a group are three times as likely; pairs updated in the last 6 h are skipped. */
export function pickPair(chars: Character[], groups: Group[], all = rels, now = Date.now(), rand = Math.random): [Character, Character] | null {
  const pairs: { p: [Character, Character]; w: number }[] = [];
  for (let i = 0; i < chars.length; i++) for (let j = i + 1; j < chars.length; j++) {
    const x = chars[i], y = chars[j];
    const r = relationOf(x.id, y.id, all);
    if (!r || now - r.updatedAt < 6 * 3_600_000) continue;
    const shared = groups.some((g) => g.memberIds.includes(x.id) && g.memberIds.includes(y.id));
    pairs.push({ p: [x, y], w: shared ? 3 : 1 });
  }
  const total = pairs.reduce((s, x) => s + x.w, 0);
  if (!total) return null;
  let roll = rand() * total;
  for (const x of pairs) { roll -= x.w; if (roll < 0) return x.p; }
  return pairs[pairs.length - 1].p;
}
const brief = (c: Character) => `${c.name}: ${clip(c.personality, 200) || "friendly"}${c.backstory ? `. ${clip(c.backstory, 200)}` : ""}`;
export function buildPairPrompt(a: Character, b: Character, r: Relation, shared: string, userName: string) {
  const user = userName || "the user";
  const kid = [a, b].find(isProtectedMinor);
  const rule = kid ? `${kid.name} is under 18: everything between them is wholesome, age-appropriate and strictly platonic, never romantic.${r.type === "family" ? ` They are family (${r.family || "relatives"}).` : ""}`
    : r.type === "family" ? `${a.name} and ${b.name} are family (${r.family || "relatives"}): strictly platonic, never romantic.`
    : isPairRomantic(r) && pairTypeAllowed(r.type, a, b) ? `${a.name} and ${b.name} are ${r.type === "crush" ? "a crush (one is sweet on the other)" : "partners"}: affectionate but always tasteful.`
    : `${a.name} and ${b.name} are not romantic.`;
  return [
    { role: "system", content: `You quietly simulate the everyday lives of fictional characters who are all friends of ${user}. Keep everything wholesome and believable; no explicit content. Answer with JSON only.` },
    { role: "user", content: [
      `Characters:\n- ${brief(a)}\n- ${brief(b)}`,
      `Their relationship now: ${PAIR_TYPES.find((t) => t.id === r.type)?.label ?? r.type}, affinity ${r.affinity} (-100..100). ${rule}`,
      r.opinions[a.id] ? `${a.name} thinks of ${b.name}: ${r.opinions[a.id]}` : "", r.opinions[b.id] ? `${b.name} thinks of ${a.name}: ${r.opinions[b.id]}` : "",
      r.notes.length ? `Recent history:\n${r.notes.slice(-4).map((n) => `- ${n.text}`).join("\n")}` : "",
      shared ? `Their recent shared group chat with ${user}:\n${shared}` : "",
      `Invent ONE small thing that happened between ${a.name} and ${b.name} today, off-screen and without ${user} (an everyday moment, a text, a small disagreement or a kind gesture), consistent with the above.`,
      `JSON: {"moment":"one short past-tense sentence naming both","opinionA":"how ${a.name} now sees ${b.name} (max 18 words)","opinionB":"how ${b.name} now sees ${a.name} (max 18 words)","affinityDelta":0}`,
      "affinityDelta is an integer from -5 to 5 (most moments are -2..3).",
    ].filter(Boolean).join("\n\n") },
  ];
}
export function interpretPair(raw: any, r: Relation, a: Character, b: Character, now = Date.now()): { relation: Relation; moment: string } | null {
  const moment = clip(raw?.moment, 220);
  if (!moment) return null;
  const delta = Math.max(-5, Math.min(5, Math.round(Number(raw?.affinityDelta ?? raw?.affinity_delta) || 0)));
  return { relation: applyChange(r, delta, { [a.id]: clip(raw?.opinionA, 160), [b.id]: clip(raw?.opinionB, 160) }, moment, now), moment };
}
export type JsonFn = (model: string, messages: { role: string; content: string }[], temperature?: number) => Promise<string>;
/** One evolution step for a random pair; returns what happened (already saved), or null. */
export async function runPairTick(chars: Character[], groups: Group[], userName: string, groupMsgs: (groupId: string) => Promise<GroupMessage[]>,
  callJson: JsonFn = api.ollamaJson, now = Date.now(), rand = Math.random): Promise<{ a: Character; b: Character; relation: Relation; moment: string } | null> {
  if (!relsLoaded) await loadRelations();
  const pair = pickPair(chars, groups, rels, now, rand);
  if (!pair) return null;
  const [a, b] = pair;
  const r = relationOf(a.id, b.id);
  if (!r) return null; // never creates pairs
  const g = groups.find((x) => x.memberIds.includes(a.id) && x.memberIds.includes(b.id));
  let shared = "";
  if (g) { const members = chars.filter((c) => g.memberIds.includes(c.id)); shared = groupTranscript(await groupMsgs(g.id).catch(() => []), members, userName, 20); }
  const out = interpretPair(parseJson(await callJson(a.model, buildPairPrompt(a, b, r, shared, userName), 0.8)), r, a, b, now);
  if (!out) return null;
  await saveRelation(out.relation);
  return { a, b, ...out };
}
/** After a group outing: every linked pair who went gets a shared note and a little closer (unlinked pairs are skipped). */
export async function noteOuting(attendees: Pick<Character, "id" | "name">[], place: string, recap: string, now = Date.now()) {
  if (attendees.length < 2) return;
  if (!relsLoaded) await loadRelations();
  for (let i = 0; i < attendees.length; i++) for (let j = i + 1; j < attendees.length; j++) {
    const x = attendees[i], y = attendees[j];
    const r = relationOf(x.id, y.id);
    if (!r) continue;
    await saveRelation(applyChange(r, 2, {}, `${x.name} and ${y.name} went to ${place || "a group outing"} together${recap ? `: ${clip(recap, 140)}` : ""}`, now));
  }
}

// ---- social feed: characters like and comment on each other's posts -----------------------------
export interface FeedLite {
  id: number; characterId: string; content: string; imagePath: string | null; createdAt: number;
  comments: { fromUser: boolean; authorId?: string; content: string }[]; likes?: string[];
}
export type FeedAction =
  | { kind: "like"; post: FeedLite; who: Character }
  | { kind: "comment"; post: FeedLite; who: Character; owner: Character }
  | { kind: "reply"; post: FeedLite; who: Character; to: Character };
const weightFor = (aff: number) => Math.max(5, Math.min(150, aff + 50));
/** One social action on recent posts (last 24 h): the owner answering a friend's comment first, else a like or a comment from someone who gets on with the poster. */
export function pickFeedAction(posts: FeedLite[], chars: Character[], awake: (c: Character) => boolean, all = rels, now = Date.now(), rand = Math.random): FeedAction | null {
  const byId = new Map(chars.map((c) => [c.id, c]));
  const recent = posts.filter((p) => now - p.createdAt < 24 * 3_600_000 && byId.has(p.characterId));
  // 1. the owner replies to a friend's comment (when it is the latest comment)
  for (const p of recent) {
    const last = p.comments[p.comments.length - 1];
    const owner = byId.get(p.characterId)!, to = last?.authorId ? byId.get(last.authorId) : undefined;
    if (to && !last.fromUser && relationOf(owner.id, to.id, all) && awake(owner) && rand() < 0.6) return { kind: "reply", post: p, who: owner, to };
  }
  // 2. a like or a comment, weighted by affinity with the poster
  const options: { p: FeedLite; c: Character; w: number }[] = [];
  for (const p of recent) {
    const likes = p.likes ?? [];
    const friendComments = p.comments.filter((m) => m.authorId).length;
    for (const c of chars) {
      if (c.id === p.characterId || !awake(c)) continue;
      const rel = relationOf(c.id, p.characterId, all);
      if (!rel) continue; // only characters who know each other
      const commented = p.comments.some((m) => m.authorId === c.id);
      if (likes.includes(c.id) && (commented || friendComments >= 2)) continue;
      options.push({ p, c, w: weightFor(rel.affinity) / (1 + likes.length + friendComments) });
    }
  }
  const total = options.reduce((s, o) => s + o.w, 0);
  if (!total) return null;
  let roll = rand() * total, pick = options[options.length - 1];
  for (const o of options) { roll -= o.w; if (roll < 0) { pick = o; break; } }
  const { p, c } = pick;
  const canComment = !p.comments.some((m) => m.authorId === c.id) && p.comments.filter((m) => m.authorId).length < 2;
  const liked = (p.likes ?? []).includes(c.id);
  if (canComment && (liked || rand() < 0.35)) return { kind: "comment", post: p, who: c, owner: byId.get(p.characterId)! };
  if (liked) return null;
  return { kind: "like", post: p, who: c };
}
const nameOf = (id: string | undefined, chars: Pick<Character, "id" | "name">[]) => chars.find((c) => c.id === id)?.name ?? "A friend";
export function feedThread(post: FeedLite, owner: Pick<Character, "id" | "name">, chars: Pick<Character, "id" | "name">[], user: string): string {
  return post.comments.map((m) => `${m.fromUser ? user : m.authorId ? nameOf(m.authorId, chars) : owner.name}: ${m.content}`).join("\n");
}
const pairRule = (r: Relation | null, other: string) => r?.type === "family" ? ` ${other} is family: warm and strictly platonic.` : r && isPairRomantic(r) ? "" : ` Keep it platonic.`;
/** A friend's comment on someone else's post (JSON {"comment"}). */
export function buildFriendCommentPrompt(who: Character, owner: Character, post: FeedLite, chars: Character[], userName: string, sys: (c: Character) => string) {
  const r = relationOf(who.id, owner.id);
  const thread = feedThread(post, owner, chars, userName || "the user");
  return [
    { role: "system", content: `${sys(who)}\n\nYour friend ${owner.name} posted this on their Messenger "What's new" feed${post.imagePath ? " (with a photo)" : ""}: "${post.content}".${thread ? `\nComments so far:\n${thread}` : ""}\n` +
      `Write ONE short, natural comment on it as ${who.name} (max 120 characters, an emoji is fine), matching how you get on with ${owner.name}${r ? ` (${PAIR_TYPES.find((t) => t.id === r.type)?.label.toLowerCase()})` : ""}.${pairRule(r, owner.name)} No explicit content. Answer with JSON only: {"comment":""}` },
    { role: "user", content: post.content },
  ];
}
/** The post owner's answer to a friend's comment (JSON {"comment"}). */
export function buildOwnerReplyPrompt(owner: Character, to: Character, post: FeedLite, chars: Character[], userName: string, sys: (c: Character) => string) {
  const r = relationOf(owner.id, to.id);
  return [
    { role: "system", content: `${sys(owner)}\n\nYou posted this on your Messenger "What's new" feed${post.imagePath ? " (with a photo)" : ""}: "${post.content}".\nComments:\n${feedThread(post, owner, chars, userName || "the user")}\n` +
      `Reply to ${to.name}'s latest comment with ONE short, natural comment (max 120 characters).${pairRule(r, to.name)} No explicit content. Answer with JSON only: {"comment":""}` },
    { role: "user", content: post.comments[post.comments.length - 1]?.content ?? "" },
  ];
}
export const cleanComment = (raw: any) => clip(raw?.comment ?? raw?.reply ?? raw?.text, 200);
/** A post about a relation moment (JSON {"post"}). */
export function buildMomentPostPrompt(a: Character, b: Character, moment: string, sys: (c: Character) => string) {
  return [
    { role: "system", content: `${sys(a)}\n\nAnswer with JSON only.` },
    { role: "user", content: `Today: ${moment}\nWrite a short status update about it for your Messenger "What's new" feed (max 160 characters, an emoji is fine), mentioning ${b.name} by name. Don't address the reader. No explicit content. JSON: {"post":""}` },
  ];
}

// ---- feed photos: Options frequency + a daily cap (the selfie rules still decide what is allowed) ----
export const FEED_PHOTO_CHANCE: Record<WFreq, number> = { off: 0, rarely: 0.12, sometimes: 0.3, often: 0.55 };
export const FEED_PHOTOS_KEY = "feed_photos_day";
const dayOf = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
export async function feedPhotoAllowed(force: boolean, now = new Date(), rand = Math.random): Promise<boolean> {
  const chance = FEED_PHOTO_CHANCE[cfg.feedPhotos];
  if (!chance) return false;
  const day = (await worldKv.get<{ day: string; n: number }>(FEED_PHOTOS_KEY).catch(() => null)) ?? { day: "", n: 0 };
  if (day.day === dayOf(now) && day.n >= cfg.feedPhotoCap) return false;
  return rand() < (force ? Math.max(0.5, chance) : chance);
}
export async function countFeedPhoto(now = new Date()) {
  const day = (await worldKv.get<{ day: string; n: number }>(FEED_PHOTOS_KEY).catch(() => null)) ?? { day: "", n: 0 };
  await worldKv.set(FEED_PHOTOS_KEY, day.day === dayOf(now) ? { day: day.day, n: day.n + 1 } : { day: dayOf(now), n: 1 });
}

// ---- prompt context ------------------------------------------------------------------------
let worldChars: Character[] = [];
let worldUser = "";
export const worldCharacters = () => worldChars;
/** Extra context lines (weather/season etc.) registered by other world modules. */
const extraBlocks: ((c: Character, now: Date, together: boolean) => string)[] = [];
export const addWorldContext = (f: (c: Character, now: Date, together: boolean) => string) => { extraBlocks.push(f); };
export function worldContext(c: Character, now: Date, together: boolean): string {
  return [relationsBlock(c, worldChars, worldUser), ...extraBlocks.map((f) => { try { return f(c, now, together); } catch { return ""; } })].filter(Boolean).join("\n\n");
}
/** Called by the app whenever the contact list or the user's name changes. */
export function installWorldPrompts(chars: Character[], userName: string) {
  worldChars = chars; worldUser = userName;
  setWorldBlock(worldContext);
}
