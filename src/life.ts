// Relationships, milestones, the "What's new" feed and albums: backend calls + Ollama generators.
import { invoke } from "@tauri-apps/api/core";
import { api } from "./api";
import { toText } from "./text";
import { parseJson, JsonCaller } from "./mind";
import { buildSystemPrompt, Character, StoredMessage, toModelText } from "./types";
import { isRomantic, lifeOf, Life, normalizeBlocks, relationLabel, UnlockKind } from "./lifecore";

export interface Milestone { id: number; characterId: string; kind: string; title: string; data: string; createdAt: number; }
export interface FeedComment { id: number; postId: number; fromUser: boolean; content: string; createdAt: number; }
export interface FeedPost { id: number; characterId: string; content: string; imagePath: string | null; reaction: string; createdAt: number; isUnread: boolean; comments: FeedComment[]; }
export interface AlbumItem { source: "chat" | "group" | "feed"; refId: number; groupId: string | null; path: string; caption: string; createdAt: number; }
export type FeedFrequency = "off" | "rarely" | "sometimes" | "often";
export interface FeedConfig { frequency: FeedFrequency; }
/** Average minutes between feed posts (across everyone). */
export const FEED_GAP_MIN: Record<FeedFrequency, number> = { off: 0, rarely: 180, sometimes: 75, often: 25 };

export const lifeApi = {
  listMilestones: (characterId: string | null) => invoke<Milestone[]>("list_milestones", { characterId }),
  addMilestone: (characterId: string, kind: string, title: string, data = "", at: number | null = null, unique = false) =>
    invoke<Milestone>("add_milestone", { characterId, kind, title, data, at, unique }),
  deleteMilestone: (id: number) => invoke<void>("delete_milestone", { id }),
  listFeed: (limit = 60) => invoke<FeedPost[]>("list_feed", { limit }),
  addFeedPost: (characterId: string, content: string, imagePath: string | null = null) => invoke<FeedPost>("add_feed_post", { characterId, content, imagePath }),
  setFeedImage: (id: number, path: string | null) => invoke<void>("set_feed_image", { id, path }),
  setFeedReaction: (id: number, reaction: string) => invoke<void>("set_feed_reaction", { id, reaction }),
  markFeedRead: () => invoke<void>("mark_feed_read"),
  deleteFeedPost: (id: number) => invoke<void>("delete_feed_post", { id }),
  addFeedComment: (postId: number, fromUser: boolean, content: string) => invoke<FeedComment>("add_feed_comment", { postId, fromUser, content }),
  listAlbum: (characterId: string) => invoke<AlbumItem[]>("list_album", { characterId }),
  removeAlbumItem: (source: string, refId: number) => invoke<void>("remove_album_item", { source, refId }),
  getFeedConfig: async (): Promise<FeedConfig> => ({ frequency: "sometimes", ...((await invoke<FeedConfig | null>("kv_get", { key: "feed_config" })) ?? {}) }),
  saveFeedConfig: (value: FeedConfig) => invoke<void>("kv_set", { key: "feed_config", value }),
};

let callJson: JsonCaller = api.ollamaJson;
export const setLifeJsonCaller = (f: JsonCaller) => { callJson = f; };
const clip = (s: unknown, n: number) => toText(s).replace(/\s+/g, " ").replace(/^["']|["']$/g, "").trim().slice(0, n);
const transcript = (msgs: StoredMessage[], user: string, name: string) =>
  msgs.filter((m) => !m.isError).map((m) => `${m.role === "user" ? user : name}: ${toModelText(m.content, m.role === "user", user, name)}`).join("\n");

// ---- schedule ---------------------------------------------------------------
export function buildSchedulePrompt(c: Character) {
  return [
    { role: "system", content: "You design realistic daily routines for fictional characters. Reply with JSON only." },
    { role: "user", content: `Character: ${c.name}.\nPersonality: ${c.personality}\nBackstory: ${c.backstory}\n\n` +
      `Write their typical weekday and weekend routine as JSON: {"weekday":[{"start":"07:00","activity":"waking up with coffee","place":"small flat kitchen","status":"away"}, ...],"weekend":[...]}. ` +
      `6-9 blocks per day, 24h "HH:MM" start times in order, activity is a short present-tense phrase that fits after "right now you are" (e.g. "at work at the tea shop"), ` +
      `place is a short visual setting, status is one of online, away, busy, sleeping (busy for work/study, sleeping for the night). Include waking up, work or study, hobbies, evening and sleep.` },
  ];
}
export async function generateSchedule(c: Character): Promise<Pick<Life, "weekday" | "weekend">> {
  const raw = parseJson(await callJson(c.model, buildSchedulePrompt(c)));
  const out = { weekday: normalizeBlocks(raw?.weekday), weekend: normalizeBlocks(raw?.weekend) };
  if (out.weekday.length < 3) throw new Error("the model didn't return a usable schedule, try again");
  if (out.weekend.length < 3) out.weekend = out.weekday;
  return out;
}

// ---- unlocks ------------------------------------------------------------------
export function buildUnlockPrompt(c: Character, user: string, kind: UnlockKind, recent: StoredMessage[]) {
  const rel = relationLabel(lifeOf(c));
  const ask = kind === "nickname"
    ? `You've become close to ${user}. Invent an affectionate nickname you'd call them (1-3 words, fitting your personality and your relationship as their ${rel}${isRomantic(lifeOf(c).relationship) ? "" : "; NOT romantic"}). JSON: {"nickname":"..."}`
    : kind === "pet_name"
    ? `You're in a romantic relationship with ${user}. Choose a sweet pet name you call them (1-2 words). JSON: {"petName":"..."}`
    : `Find something funny or memorable that actually happened in the chat below that could become an inside joke between you and ${user}. Describe it in one short sentence from your point of view. If nothing fits, use an empty string. JSON: {"joke":"..."}`;
  return [
    { role: "system", content: `${buildSystemPrompt(c, user)}\n\nAnswer with JSON only.` },
    { role: "user", content: `Recent chat:\n${transcript(recent, user, c.name) || "(none)"}\n\n${ask}` },
  ];
}
export function interpretUnlock(kind: UnlockKind, raw: any): string {
  return clip(kind === "nickname" ? raw?.nickname : kind === "pet_name" ? raw?.petName ?? raw?.pet_name : raw?.joke, kind === "inside_joke" ? 200 : 30);
}
/** Generates and records one unlock. Returns the updated character, or null if nothing came of it. */
export async function runUnlock(c: Character, user: string, kind: UnlockKind, data: string): Promise<{ character: Character; milestone: Milestone } | null> {
  const recent = await api.recentMessages(c.id, 30);
  const value = interpretUnlock(kind, parseJson(await callJson(c.model, buildUnlockPrompt(c, user, kind, recent))));
  if (!value) return null;
  const l = lifeOf(c);
  let character = c, title: string;
  if (kind === "inside_joke") {
    await api.addMemory(c.id, `\u2B50 Inside joke with ${user}: ${value}`, true);
    title = `New inside joke: ${value}`;
  } else {
    character = await api.saveCharacter({ ...c, life: { ...l, [kind === "nickname" ? "nickname" : "petName"]: value } });
    title = kind === "nickname" ? `Started calling you "${value}"` : `Pet name for you: "${value}"`;
  }
  const milestone = await lifeApi.addMilestone(c.id, kind, title, data, null, true);
  return { character, milestone };
}

// ---- feed -------------------------------------------------------------------
export function buildFeedPostPrompt(c: Character, user: string) {
  return [
    { role: "system", content: `${buildSystemPrompt(c, user)}\n\nAnswer with JSON only.` },
    { role: "user", content: `Write a short status update for your Messenger "What's new" feed (one or two sentences, max 160 characters, an emoji is fine) about what you're doing or feeling right now, matching your daily life and mood. Don't address ${user} directly. Also describe in a few words the photo you'd attach (what you're doing, where). JSON: {"post":"...","photo":"..."}` },
  ];
}
export async function generateFeedPost(c: Character, user: string): Promise<{ post: string; photo: string }> {
  const raw = parseJson(await callJson(c.model, buildFeedPostPrompt(c, user)));
  const post = clip(raw?.post, 220);
  if (!post) throw new Error("no post text came back");
  return { post, photo: clip(raw?.photo, 120) };
}
export function buildCommentReplyPrompt(c: Character, user: string, post: FeedPost) {
  const thread = post.comments.map((m) => `${m.fromUser ? user : c.name}: ${m.content}`).join("\n");
  return [
    { role: "system", content: `${buildSystemPrompt(c, user)}\n\nYou posted this on your Messenger feed${post.imagePath ? " (with a photo)" : ""}: "${post.content}".\nComments so far:\n${thread}\n\nReply to ${user}'s latest comment with ONE short, natural comment. Output only the comment text.` },
    { role: "user", content: post.comments[post.comments.length - 1]?.content ?? "" },
  ];
}
/** Records the first picture a character ever sent (no-op afterwards). */
export function markFirstSelfie(c: Pick<Character, "id" | "name">) {
  lifeApi.addMilestone(c.id, "first_selfie", `First selfie from ${c.name}`, "", null, true).catch((e) => console.warn("[milestone]", e));
}