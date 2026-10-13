// Long-term memory and mood: background jobs that never block chatting.
import { api } from "./api";
import { Character, Group, GroupMessage, Memory, Mood, MOODS, StoredMessage, toModelText } from "./types";

export const CONTEXT_MESSAGES = 24;       // recent messages sent verbatim to the model
export const MEMORY_BUDGET_CHARS = 1600;  // ~400 tokens of memories in the prompt
export const SUMMARY_EVERY = 10;          // new messages before a summary pass
export const IDLE_SUMMARY_MIN = 4;        // fewer needed when the chat has gone idle
export const KEEP_UNSUMMARISED = 6;       // newest messages left for the next pass (still in context)
export const MOOD_DRIFT_MS = 3 * 3600_000;
export const MAX_CLOSENESS_STEP = 3;

/** JSON-capable caller; swappable so the node test can hit Ollama directly. */
export type JsonCaller = (model: string, messages: { role: string; content: string }[], temperature?: number, opts?: { seed?: number; topP?: number }) => Promise<string>;
let callJson: JsonCaller = api.ollamaJson;
export const setJsonCaller = (f: JsonCaller) => { callJson = f; };

/** All pinned memories, then the most recent others, within a character budget. */
export function selectMemories(mems: Memory[], budget = MEMORY_BUDGET_CHARS): string[] {
  const pinned = mems.filter((m) => m.pinned);
  const rest = mems.filter((m) => !m.pinned).sort((a, b) => b.id - a.id);
  const out = pinned.map((m) => m.content);
  let used = out.reduce((n, s) => n + s.length + 3, 0);
  for (const m of rest) {
    if (used + m.content.length + 3 > budget) break;
    out.push(m.content); used += m.content.length + 3;
  }
  return out;
}

export const contextWindow = <T,>(msgs: T[], n = CONTEXT_MESSAGES): T[] => msgs.slice(-n);

export function parseJson(text: string): any {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s >= 0 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch { /* ignore */ } }
  return null;
}

const stamp = (t: number) => new Date(t).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function buildSummaryPrompt(c: Character, userName: string, msgs: StoredMessage[], existing: string[], now = new Date()) {
  const transcript = msgs.map((m) => `[${stamp(m.createdAt)}] ${m.role === "user" ? userName : c.name}: ${toModelText(m.content, m.role === "user", userName, c.name)}`).join("\n");
  return [
    { role: "system", content: [
      `You maintain the long-term memory of ${c.name}, a character who chats with ${userName}.`,
      `Read the conversation and extract at most 6 concise facts worth remembering for weeks: facts about ${userName} (likes, plans, people, worries, events in their life) and shared moments or in-jokes between them.`,
      `Write each fact as one short standalone sentence in third person. Today is ${stamp(now.getTime())}; turn relative times ("tomorrow", "tonight") into absolute days so the fact stays true later.`,
      "Skip greetings and small talk. Do not repeat or rephrase any existing memory.",
      existing.length ? `Existing memories:\n${existing.map((m) => `- ${m}`).join("\n")}` : "There are no existing memories yet.",
      'Respond only with JSON: {"facts": ["...", "..."]}. Use an empty list if nothing is worth remembering.',
    ].join("\n") },
    { role: "user", content: transcript },
  ];
}

/** Folds older, not-yet-summarised messages into memories. Returns the new summarizedUpto, or null if nothing ran. */
export async function summarise(c: Character, userName: string, idle: boolean): Promise<{ upto: number; added: number } | null> {
  const fresh = (await api.listMessages(c.id)).filter((m) => !m.isError && m.id > c.summarizedUpto);
  const take = idle ? fresh : fresh.slice(0, Math.max(0, fresh.length - KEEP_UNSUMMARISED));
  if (take.length < (idle ? IDLE_SUMMARY_MIN : SUMMARY_EVERY - KEEP_UNSUMMARISED) || (!idle && fresh.length < SUMMARY_EVERY)) return null;
  const existing = (await api.listMemories(c.id)).map((m) => m.content);
  const out = parseJson(await callJson(c.model, buildSummaryPrompt(c, userName, take, existing)));
  const facts: string[] = Array.isArray(out?.facts) ? out.facts.filter((f: unknown) => typeof f === "string" && f.trim().length > 3 && f.length < 300) : [];
  let added = 0;
  for (const f of facts.slice(0, 6)) if (await api.addMemory(c.id, f)) added++;
  const upto = take[take.length - 1].id;
  await api.setSummarizedUpto(c.id, upto);
  return { upto, added };
}

/** Prompt for folding a group chat into ONE member's memories (their perspective). */
export function buildGroupSummaryPrompt(c: Character, g: Group, members: Character[], userName: string, msgs: GroupMessage[], existing: string[], now = new Date()) {
  const byId = new Map(members.map((m) => [m.id, m.name]));
  const others = members.filter((m) => m.id !== c.id).map((m) => m.name);
  const transcript = msgs.map((m) => {
    const who = m.speakerId ? byId.get(m.speakerId) ?? "A former member" : userName;
    return `[${stamp(m.createdAt)}] ${who}: ${toModelText(m.content, !m.speakerId, userName, who)}`;
  }).join("\n");
  return [
    { role: "system", content: [
      `You maintain the long-term memory of ${c.name}. ${c.name} is in a group chat called "${g.name}" with ${userName}${others.length ? ` and ${others.join(", ")}` : ""}.`,
      `From ${c.name}'s point of view, extract at most 5 concise facts worth remembering for weeks: facts about ${userName} (likes, plans, people, worries, life events) and memorable shared group moments or in-jokes.`,
      `When other characters are involved, name them (e.g. "Rex teased Alex about gaming all day in the ${g.name} group").`,
      `Write each fact as one short standalone sentence in third person. Today is ${stamp(now.getTime())}; turn relative times into absolute days.`,
      "Skip greetings, small talk and anything only about the other characters that does not involve the user or this character. Do not repeat existing memories.",
      existing.length ? `Existing memories:\n${existing.map((m) => `- ${m}`).join("\n")}` : "There are no existing memories yet.",
      'Respond only with JSON: {"facts": ["...", "..."]}. Use an empty list if nothing is worth remembering.',
    ].join("\n") },
    { role: "user", content: transcript },
  ];
}

/** Folds a group chat into one member's memories, tracked per character. Same thresholds as 1:1. */
export async function summariseGroup(c: Character, g: Group, members: Character[], userName: string, idle: boolean): Promise<{ upto: number; added: number } | null> {
  const upto = await api.groupSummaryUpto(g.id, c.id);
  const fresh = (await api.listGroupMessages(g.id)).filter((m) => !m.isError && m.id > upto);
  const take = idle ? fresh : fresh.slice(0, Math.max(0, fresh.length - KEEP_UNSUMMARISED));
  if (take.length < (idle ? IDLE_SUMMARY_MIN : SUMMARY_EVERY - KEEP_UNSUMMARISED) || (!idle && fresh.length < SUMMARY_EVERY)) return null;
  const existing = (await api.listMemories(c.id)).map((m) => m.content);
  const out = parseJson(await callJson(c.model, buildGroupSummaryPrompt(c, g, members, userName, take, existing)));
  const facts: string[] = Array.isArray(out?.facts) ? out.facts.filter((f: unknown) => typeof f === "string" && f.trim().length > 3 && f.length < 300) : [];
  let added = 0;
  for (const f of facts.slice(0, 5)) if (await api.addMemory(c.id, f, false, g.name)) added++;
  const last = take[take.length - 1].id;
  await api.setGroupSummaryUpto(g.id, c.id, last);
  return { upto: last, added };
}

export function buildMoodPrompt(c: Character, userName: string, userText: string, replyText: string) {
  return [
    { role: "system", content: [
      `You track the inner state of ${c.name} (${c.personality || "a character"}) who chats with ${userName}.`,
      `Current mood: ${c.mood}. Baseline mood: ${c.baselineMood}. Closeness to ${userName}: ${c.closeness}/100.`,
      `Allowed moods: ${MOODS.join(", ")}.`,
      `Given the latest exchange, decide ${c.name}'s mood now and how the exchange changed closeness.`,
      "closeness_delta is an integer from -3 to 3: positive when the user was warm, kind, playful or opened up; negative when rude, dismissive or hurtful; 0 when neutral.",
      `personal_message is a short new messenger status line for ${c.name} that fits the new mood (max 60 characters, no quotes), or "" to keep the current one.`,
      `reaction is an emoji ${c.name} would tap as a reaction on ${userName}'s message (e.g. a heart for something sweet, a laugh for a joke), or "" for none. Use "" most of the time.`,
      'Respond only with JSON: {"mood": "...", "closeness_delta": 0, "personal_message": "", "reaction": ""}',
    ].join("\n") },
    { role: "user", content: `${userName}: ${userText}\n${c.name}: ${replyText}` },
  ];
}

export interface MoodResult { mood: Mood; closeness: number; personalMessage: string | null; reaction: string; }

export function interpretMood(c: Character, raw: any, rnd = Math.random): MoodResult {
  const mood: Mood = MOODS.includes(raw?.mood) ? raw.mood : c.mood;
  const d = Math.round(Number(raw?.closeness_delta) || 0);
  const step = Math.max(-MAX_CLOSENESS_STEP, Math.min(MAX_CLOSENESS_STEP, d));
  const closeness = Math.max(0, Math.min(100, c.closeness + step));
  const pm = typeof raw?.personal_message === "string" ? raw.personal_message.trim().replace(/^"|"$/g, "").slice(0, 80) : "";
  // only occasionally touch the personal message, and only when the mood actually changed
  const personalMessage = pm && mood !== c.mood && rnd() < 0.35 ? pm : null;
  // reactions stay occasional even if the model is generous with them
  const r = typeof raw?.reaction === "string" ? raw.reaction.trim() : "";
  const reaction = r && [...r].length <= 3 && !/[\p{L}\p{N}]/u.test(r) && rnd() < 0.5 ? r : "";
  return { mood, closeness, personalMessage, reaction };
}

export async function evaluateMood(c: Character, userName: string, userText: string, replyText: string): Promise<{ character: Character; reaction: string }> {
  const raw = parseJson(await callJson(c.model, buildMoodPrompt(c, userName, userText, replyText)));
  if (!raw) throw new Error("mood: model did not return JSON");
  const r = interpretMood(c, raw);
  return { character: await api.setMood(c.id, r.mood, r.closeness, r.personalMessage), reaction: r.reaction };
}

/** Moods relax back to baseline after a few quiet hours. */
export function needsDrift(c: Character, now = Date.now()): boolean {
  return c.mood !== c.baselineMood && c.moodUpdatedAt > 0 && now - c.moodUpdatedAt > MOOD_DRIFT_MS;
}