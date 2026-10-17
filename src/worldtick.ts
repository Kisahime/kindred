// v1.3 Living World: the background "world tick" (called from the app's 10-minute life check).
// Every part checks its own option and timer, and nothing runs in quiet hours, while offline/Busy, or during a call.
import { api } from "./api";
import { buildSystemPrompt, Character, Group, Settings } from "./types";
import { buildFriendCommentPrompt, buildMomentPostPrompt, buildOwnerReplyPrompt, cleanComment, FeedAction, loadRelations, pickFeedAction, pruneRelations, runPairTick, worldCfg } from "./world";
import { econApi } from "./economy";
import { lifeApi } from "./life";
import { parseJson } from "./mind";
import { refreshWeather } from "./weather";
import { eventMessageNote, eventPostPrompt, eventToday, SEASONAL_KEY, seasonalKey, SeasonalState } from "./seasonal";
import { blankLetterState, buildDiaryPrompt, buildLetterPrompt, dayKey, diaryDue, diaryLevel, interpretLetter, Letter, letterDue, LETTER_STATE_KEY, LetterState, lettersApi } from "./letters";

export interface WorldDeps {
  chars: Character[]; groups: Group[]; me: Settings;
  /** quiet hours, Busy / Appear offline, or on a call: nothing should reach the user now */
  hush: boolean;
  awake: (c: Character) => boolean;
  inScene: (c: Character) => boolean;
  log: (what: string) => (e: unknown) => void;
  /** the feed changed (isNew: a new post, for the unread badge) */
  onFeed: (isNew: boolean) => void;
  /** a new letter arrived */
  onLetter: (c: Character, l: Letter) => void;
  /** the character is busy replying in a chat right now */
  generating?: (c: Character) => boolean;
  /** sends a proactive chat message with this note (seasonal events) */
  message?: (c: Character, note: string) => Promise<void>;
}
export interface WorldState { pairAt: number; }
export const WORLD_STATE_KEY = "world_state";
let st: WorldState | null = null;
let busy = false;
const PAIR_GAP_MIN = 90, PAIR_GAP_MAX = 150; // minutes between relation moments
async function state(): Promise<WorldState> {
  if (!st) st = { pairAt: 0, ...((await econApi.kvGet<Partial<WorldState>>(WORLD_STATE_KEY).catch(() => null)) ?? {}) };
  return st;
}
const save = () => econApi.kvSet(WORLD_STATE_KEY, st).catch(() => {});
export const nextGap = (min: number, max: number, rand = Math.random) => (min + rand() * (max - min)) * 60_000;

const sys = (d: WorldDeps) => (c: Character) => buildSystemPrompt(c, d.me.userName);
async function momentPost(d: WorldDeps, a: Character, b: Character, moment: string) {
  const raw = parseJson(await api.ollamaJson(a.model, buildMomentPostPrompt(a, b, moment, sys(d))));
  const post = String(raw?.post ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
  if (!post) return;
  const row = await lifeApi.addFeedPost(a.id, post);
  if (d.awake(b)) await lifeApi.setFeedLikes(row.id, [b.id]).catch(() => {});
  d.onFeed(true);
}
/** Runs one social action (exported for tests with a fake model and backend). */
export async function runFeedAction(act: FeedAction, d: Pick<WorldDeps, "chars" | "me">, json = api.ollamaJson,
  be: Pick<typeof lifeApi, "setFeedLikes" | "addFeedComment"> = lifeApi): Promise<string> {
  const s = (c: Character) => buildSystemPrompt(c, d.me.userName);
  if (act.kind === "like") { await be.setFeedLikes(act.post.id, [...(act.post.likes ?? []), act.who.id]); return `${act.who.name} liked ${act.post.characterId}'s post`; }
  const msgs = act.kind === "comment" ? buildFriendCommentPrompt(act.who, act.owner, act.post, d.chars, d.me.userName, s)
    : buildOwnerReplyPrompt(act.who, act.to, act.post, d.chars, d.me.userName, s);
  const text = cleanComment(parseJson(await json(act.who.model, msgs)));
  if (!text) return "";
  // the owner's own replies are stored without an author (they are the post's owner)
  await be.addFeedComment(act.post.id, false, text, act.kind === "comment" ? act.who.id : "");
  return `${act.who.name} ${act.kind === "comment" ? "commented" : "replied"}: ${text}`;
}
async function feedSocialStep(d: WorldDeps) {
  const posts = await lifeApi.listFeed(30);
  const act = pickFeedAction(posts, d.chars.filter((c) => !d.inScene(c)), d.awake);
  if (!act) return;
  const what = await runFeedAction(act, d);
  if (what) { console.info(`[world] ${what}`); d.onFeed(false); }
}

/** One letter or one diary page per check at most. */
export async function lettersStep(d: WorldDeps, now = Date.now(), json = api.ollamaJson, rand = Math.random) {
  const cfg = worldCfg();
  const st: LetterState = { ...blankLetterState(), ...((await econApi.kvGet<Partial<LetterState>>(LETTER_STATE_KEY).catch(() => null)) ?? {}) };
  const ok = (c: Character) => d.awake(c) && !d.inScene(c) && !d.generating?.(c);
  const sysOf = (c: Character) => buildSystemPrompt(c, d.me.userName);
  // diary: the first eligible character tonight
  if (cfg.diaries) for (const c of d.chars.filter(ok)) {
    const recent = await api.recentMessages(c.id, 30).catch(() => []);
    const lastChat = Math.max(0, ...recent.filter((m) => m.role === "user").map((m) => m.createdAt));
    if (!diaryDue(c, st, cfg, lastChat, new Date(now))) continue;
    st.diary = { ...st.diary, [c.id]: dayKey(new Date(now)) };
    await econApi.kvSet(LETTER_STATE_KEY, st);
    const today = recent.filter((m) => now - m.createdAt < 86_400_000);
    const page = interpretLetter(parseJson(await json(c.model, buildDiaryPrompt(c, d.me.userName, today, diaryLevel(c.closeness), sysOf(c), new Date(now)), 0.85)), "diary");
    if (page) { await lettersApi.add(c.id, "diary", false, page.title, page.body); console.info(`[world] ${c.name} wrote in their diary: ${page.title}`); }
    return;
  }
  // letter: the first character a letter is due from
  for (const c of [...d.chars].filter(ok).sort(() => rand() - 0.5)) {
    if (!letterDue(c, st, cfg, now, rand)) continue;
    st.last = { ...st.last, [c.id]: now }; st.lastAny = now;
    await econApi.kvSet(LETTER_STATE_KEY, st);
    const recent = await api.recentMessages(c.id, 30).catch(() => []);
    const mems = await api.listMemories(c.id).catch(() => []);
    const memories = [...mems].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt).map((m) => m.content).slice(0, 10);
    const l = interpretLetter(parseJson(await json(c.model, buildLetterPrompt(c, d.me.userName, recent, memories, sysOf(c)), 0.85)), "letter");
    if (!l) return;
    const saved = await lettersApi.add(c.id, "letter", false, l.title, l.body);
    api.addMemory(c.id, `${new Date(now).toLocaleDateString()}: I wrote ${d.me.userName} a letter ("${l.title}").`, false, "letter").catch(() => {});
    d.onLetter(c, saved);
    return;
  }
}

/** On an event day: one themed feed post, then one message per check from characters who can message first (once each per event). */
export async function seasonalStep(d: WorldDeps, now = new Date(), json = api.ollamaJson, rand = Math.random) {
  const ev = eventToday(now);
  if (!ev) return;
  const all = (await econApi.kvGet<SeasonalState>(SEASONAL_KEY).catch(() => null)) ?? {};
  const key = seasonalKey(ev, now);
  const rec = all[key] ?? { post: false, sent: [] };
  const save = () => econApi.kvSet(SEASONAL_KEY, { ...all, [key]: rec });
  const awake = d.chars.filter((c) => d.awake(c) && !d.inScene(c) && !d.generating?.(c));
  if (!rec.post && awake.length) {
    rec.post = true; await save();
    const c = awake[Math.floor(rand() * awake.length)];
    const raw = parseJson(await json(c.model, eventPostPrompt(ev, buildSystemPrompt(c, d.me.userName), now)));
    const post = String(raw?.post ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
    if (post) { await lifeApi.addFeedPost(c.id, post); d.onFeed(true); }
    return;
  }
  if (!d.message) return;
  const c = awake.find((x) => x.proactiveEnabled && !rec.sent.includes(x.id));
  if (!c) return;
  rec.sent = [...rec.sent, c.id]; await save();
  const note = eventMessageNote(ev, c, d.me.userName, now);
  if (note) await d.message(c, note);
}

export async function worldTick(d: WorldDeps, now = Date.now()) {
  if (busy || d.chars.length === 0) return;
  busy = true;
  try {
    const s = await state();
    await loadRelations();
    await pruneRelations(d.chars.map((c) => c.id)).catch(d.log("relations prune"));
    const cfg = worldCfg();
    // 1. characters know each other: a small offline moment between two of them
    if (cfg.relations && d.chars.length >= 2 && !d.hush) {
      if (!s.pairAt) { s.pairAt = now + nextGap(20, 60); save(); }
      else if (now >= s.pairAt) {
        s.pairAt = now + nextGap(PAIR_GAP_MIN, PAIR_GAP_MAX); save();
        const pool = d.chars.filter((c) => !d.inScene(c));
        const r = await runPairTick(pool, d.groups, d.me.userName, (gid) => api.listGroupMessages(gid)).catch((e) => { d.log("relations")(e); return null; });
        if (r) {
          console.info(`[world] ${r.a.name} & ${r.b.name}: ${r.moment} (affinity ${r.relation.affinity}, ${r.relation.type})`);
          // sometimes one of them posts about it on the feed
          if (cfg.feedSocial && d.awake(r.a) && Math.random() < 0.25) await momentPost(d, r.a, r.b, r.moment).catch(d.log("moment post"));
        }
      }
    }
    // 2. social feed: one like / comment / reply now and then
    if (cfg.feedSocial && !d.hush && Math.random() < 0.6) await feedSocialStep(d).catch(d.log("feed social"));
    // 3. letters (reach the user: never while hushed) and diaries (private, in the evening)
    if (!d.hush) await lettersStep(d, now).catch(d.log("letters"));
    // 4. weather (cached 30 min; off unless enabled + town shared) and seasonal events
    await refreshWeather().catch(d.log("weather"));
    if (cfg.seasonal && !d.hush) await seasonalStep(d, new Date(now)).catch(d.log("seasonal"));
  } finally { busy = false; }
}
