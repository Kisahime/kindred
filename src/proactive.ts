import { currentBlock, lifeOf } from "./lifecore";
import { api } from "./api";
import { ChatMessage, streamChat } from "./ollama";
import { selectMemories } from "./mind";
import { buildSystemPrompt, Character, Frequency, isEventText, Settings, StoredMessage, toModelText } from "./types";

const MIN = 60_000;
/** Random wait range (ms) between proactive attempts. */
const RANGES: Record<Frequency, [number, number]> = {
  rarely: [180 * MIN, 360 * MIN],
  sometimes: [60 * MIN, 180 * MIN],
  often: [20 * MIN, 60 * MIN],
};
export const RECENT_USER_GAP_MS = 10 * MIN; // don't interrupt if Alex wrote in the last 10 min

export function nextDelay(f: Frequency, rnd = Math.random): number {
  const [lo, hi] = RANGES[f] ?? RANGES.sometimes;
  return lo + rnd() * (hi - lo);
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
/** True when `d` is inside [start, end), handling ranges that wrap midnight. start == end means no quiet hours. */
export function inQuietHours(d: Date, start: string, end: string): boolean {
  const s = toMin(start), e = toMin(end), n = d.getHours() * 60 + d.getMinutes();
  if (s === e) return false;
  return s < e ? n >= s && n < e : n >= s || n < e;
}

/** Returns a reason to skip, or null when the character may message first. */
export function skipReason(c: Character, me: Settings, history: StoredMessage[], busy: boolean, now = new Date()): string | null {
  if (!c.proactiveEnabled) return "disabled";
  if (c.status === "offline" || c.status === "busy") return `character is ${c.status}`;
  if (me.status === "offline" || me.status === "busy") return `you are ${me.status}`;
  if (inQuietHours(now, me.quietStart, me.quietEnd)) return "quiet hours";
  const cur = currentBlock(lifeOf(c), now);
  if (cur?.block.status === "sleeping") return "character is asleep (schedule)";
  if (cur?.block.status === "busy") return `character is ${cur.block.activity} (schedule)`;
  if (busy) return "reply in progress";
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  if (lastUser && now.getTime() - lastUser.createdAt < RECENT_USER_GAP_MS) return "you messaged recently";
  const last = history[history.length - 1];
  if (last && last.isProactive) return "previous opener still unanswered";
  return null;
}

function partOfDay(h: number) { return h < 5 ? "late night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "night"; }
function ago(ms: number) {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
}

export function buildProactiveMessages(c: Character, me: Settings, history: StoredMessage[], now = new Date(), memories: string[] = [], note = ""): ChatMessage[] {
  const last = history[history.length - 1];
  const gapMs = last ? now.getTime() - last.createdAt : Infinity;
  const stale = gapMs > 2 * 3600_000;
  const context = [
    `It is now ${now.toLocaleString([], { weekday: "long", hour: "2-digit", minute: "2-digit" })} (${partOfDay(now.getHours())}) for ${me.userName}.`,
    last
      ? `The last message in your chat was ${ago(gapMs)} (${new Date(last.createdAt).toLocaleString([], { weekday: "long", hour: "2-digit", minute: "2-digit" })}).`
      : "You have never chatted with them before.",
    stale ? `That conversation is over: everything in the history below happened ${ago(gapMs)}. Do not talk about it as if it is happening right now (for example, if they said they were going to bed or off to an exam, that has already passed; you may ask how it went instead).` : "",
    `${me.userName} is online but hasn't messaged you. You decide to message them first.`,
    note,
    "Write ONE short, natural opening instant message that fits your personality, your mood, the current time of day and, if relevant, something you remember.",
    "Output only the message text: no quotes, no name prefix, no narration.",
  ].filter(Boolean).join(" ");
  return [
    { role: "system", content: `${buildSystemPrompt(c, me.userName, { memories, now })}\n\n${context}` },
    ...history.map((m) => ({ role: isEventText(m.content) ? "system" : m.role, content: `[${new Date(m.createdAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}] ${toModelText(m.content, m.role === "user", me.userName, c.name)}` } as ChatMessage)),
    { role: "user", content: `[${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${me.userName} is idle. Send your opening message now.]` },
  ];
}
export function cleanOpener(text: string, name: string): string {
  let t = text.trim();
  t = t.replace(new RegExp(`^\\**${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\**\\s*:\\s*`, "i"), "");
  t = t.replace(/^\[[^\]]{1,40}\]\s*/, "");
  if (/^".*"$/s.test(t)) t = t.slice(1, -1).trim();
  return t;
}

/** Generates and stores a proactive message. Returns the stored message. */
export async function generateProactive(c: Character, me: Settings, note = ""): Promise<StoredMessage> {
  const history = await api.recentMessages(c.id, 12);
  const memories = selectMemories(await api.listMemories(c.id));
  const text = cleanOpener(await streamChat(c.model, buildProactiveMessages(c, me, history, new Date(), memories, note), { onToken: () => {} }), c.name);
  return api.addProactiveMessage(c.id, text);
}