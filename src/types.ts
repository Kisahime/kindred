import { blankLife, nowPrompt, relationshipPrompt } from "./lifecore";
import type { Life } from "./lifecore";
export type Frequency = "rarely" | "sometimes" | "often";
export type Status = "online" | "away" | "busy" | "offline";
export type Mood = "happy" | "cosy" | "playful" | "sad" | "annoyed" | "sleepy" | "excited";
export const MOODS: Mood[] = ["happy", "cosy", "playful", "sad", "annoyed", "sleepy", "excited"];
export const MOOD_EMOJI: Record<Mood, string> = {
  happy: "\u{1F60A}", cosy: "\u2615", playful: "\u{1F61C}", sad: "\u{1F622}", annoyed: "\u{1F612}", sleepy: "\u{1F634}", excited: "\u{1F929}",
};
export const DEFAULT_MODEL = "qwen3:8b";

export interface Character {
  id: string;
  name: string;
  avatar: string;             // emoji
  avatarPath?: string | null; // local image in data/avatars (wins over emoji)
  color: string;
  status: Status;
  personalMessage: string;
  personality: string;
  backstory: string;
  speakingStyle: string;
  greeting: string;
  exampleMessages: string;
  model: string;
  proactiveEnabled: boolean;
  proactiveFrequency: Frequency;
  baselineMood: Mood;
  mood: Mood;              // owned by the background mood updater
  closeness: number;       // 0-100, owned by the background mood updater
  moodUpdatedAt: number;
  summarizedUpto: number;  // last message id folded into memories
  createdAt: number;
  updatedAt: number;
  appearance: Appearance;
  life: Partial<Life>;     // relationship + daily schedule (see lifecore.ts)
}

/** Looks + picture settings. Ages are always 18 or older. */
export interface Appearance {
  age: number; body: string; face: string; features: string; style: string;
  outfitDay: string; outfitEvening: string; outfitNight: string;
  placeDay: string; placeEvening: string; placeNight: string;
  imageModel: string;   // model path in Image Studio ("" = whatever Studio used last)
  extraTags: string; negativeTags: string;
  seed: number;         // -1 = random each time
  lora: string; loraStrength: number;
  selfiesUnprompted: boolean;
  voice: string;        // Kokoro voice id ("" = suggested from looks)
  voiceSpeed: number;
  canCall: boolean;     // may phone Alex (needs "can message me first")
}
export const MIN_AGE = 18;
export function blankAppearance(): Appearance {
  return { age: 25, body: "", face: "", features: "", style: "", outfitDay: "", outfitEvening: "", outfitNight: "",
    placeDay: "", placeEvening: "", placeNight: "", imageModel: "", extraTags: "", negativeTags: "", seed: -1, lora: "", loraStrength: 0.8, selfiesUnprompted: false, voice: "", voiceSpeed: 1, canCall: false };
}
/** Fills missing fields and enforces the adult minimum age. */
export function appearanceOf(c: Pick<Character, "appearance">): Appearance {
  const a = { ...blankAppearance(), ...((c.appearance ?? {}) as Partial<Appearance>) };
  a.age = Math.max(MIN_AGE, Math.round(Number(a.age) || 25));
  return a;
}
export const hasLooks = (a: Appearance) => !!(a.body || a.face || a.features || a.style);

export interface StoredMessage {
  id: number; characterId: string; role: "user" | "assistant"; content: string; createdAt: number; isError: boolean; isUnread: boolean; isProactive: boolean;
  reaction: string; alternates: string[]; altIndex: number; imagePath?: string | null;
}

export interface Memory { id: number; characterId: string; content: string; createdAt: number; pinned: boolean; source: string; }

export interface Settings {
  userName: string; status: Status; personalMessage: string;
  quietStart: string; quietEnd: string; // "HH:MM"
  sound: boolean;
  theme: Theme;
  volume: number;       // 0-100
  mutedSounds: string;  // comma-separated SoundEvent names that are off
  emoticons: boolean;   // convert text smileys like :) into emoji when displaying
  closeToTray: boolean; trayHintShown: boolean;
}

export type Theme = "aero" | "night" | "pastel" | "mint";
export const THEMES: { id: Theme; label: string }[] = [
  { id: "aero", label: "Aero Blue" }, { id: "night", label: "Night" }, { id: "pastel", label: "Pastel Cosy" }, { id: "mint", label: "Forest Mint" },
];

export interface Group {
  id: string; name: string; avatar: string; color: string; memberIds: string[]; createdAt: number; updatedAt: number;
}
export interface GroupMessage {
  id: number; groupId: string; speakerId: string | null; content: string; createdAt: number; isError: boolean;
  reaction: string; reactorId: string | null; alternates: string[]; altIndex: number; imagePath?: string | null;
}
export interface Template { id: number; name: string; data: Partial<Character>; createdAt: number; }

/** Stored content of a nudge message. */
export const NUDGE = "[nudge]";
/** How a stored message reads to the model. */
/** Stored text of a picture message: "[selfie] what it shows". The image itself never goes to the LLM. */
export const SELFIE = "[selfie]";
/** Stored text of a gift Alex gave: "[gift] 🧣 Scarf – description". */
export const GIFT = "[gift]";
/** Stored text of a character's offer on one of Alex's items: "[offer] 🛒 would like to buy your …". */
export const OFFER = "[offer]";
export const selfieScene = (content: string) => content.slice(SELFIE.length).trim();
/** Stored text of a phone call log: "[call] {json CallLog}". */
export const CALL = "[call]";
export interface CallLog { d: number; missed?: boolean; incoming?: boolean; declined?: string; lines: { me: boolean; t: string }[]; }
export function parseCall(content: string): CallLog | null {
  if (!content.startsWith(CALL)) return null;
  try { const v = JSON.parse(content.slice(CALL.length)); return { d: Number(v.d) || 0, missed: !!v.missed, incoming: !!v.incoming, declined: v.declined ? String(v.declined) : undefined, lines: Array.isArray(v.lines) ? v.lines : [] }; }
  catch { return { d: 0, lines: [] }; }
}
export const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
/** Gift / offer bubbles are events, sent to the model as system narration (never as a user/assistant line). */
export const isEventText = (content: string) => content.startsWith(GIFT) || content.startsWith(OFFER);
const OUTCOME: Record<string, string> = { accepted: "accepted", declined: "declined", expired: "could not accept (no longer had the item)", pending: "has not answered yet" };
/** Unambiguous narration for a gift/offer: who gave what to whom, and the answer if known. */
export function eventText(content: string, fromUser: boolean, userName: string, charName: string, status?: string): string {
  const what = content.slice(content.startsWith(GIFT) ? GIFT.length : OFFER.length).trim();
  if (content.startsWith(GIFT)) {
    if (fromUser) return `[Event: ${userName} gave you (${charName}) a gift: ${what}. It now belongs to you, ${charName}.]`;
    const ans = status && status !== "pending" ? ` ${userName} ${OUTCOME[status] ?? status} it${status === "accepted" ? `, so it now belongs to ${userName}` : ""}.` : "";
    return `[Event: You (${charName}) gave ${userName} a gift: ${what}.${ans}]`;
  }
  const body = what.replace(/^\S+\s/, "").replace(/\byour\b/, `${userName}'s`).replace(/\btheir\b/, "your");
  const ans = status ? ` ${userName} ${OUTCOME[status] ?? status}${status === "pending" ? "" : " the offer"}.` : "";
  return `[Event: You (${charName}) made ${userName} an offer: you ${body}.${ans}]`;
}
export function toModelText(content: string, fromUser: boolean, userName: string, charName: string, status?: string): string {
  if (isEventText(content)) return eventText(content, fromUser, userName, charName, status);
  const call = parseCall(content);
  if (call) {
    if (call.missed) return call.incoming ? `*${charName} tried to phone ${userName}, but ${userName} didn't pick up*` : `*${userName} tried to phone ${charName}, but ${charName} didn't pick up*`;
    let t = call.lines.map((l) => `${l.me ? userName : charName}: ${l.t}`).join("\n");
    if (t.length > 1500) t = "..." + t.slice(-1500);
    return `*Phone call between ${charName} and ${userName} (${fmtDuration(call.d)}):*\n${t}`;
  }
  if (content.startsWith(SELFIE)) return `*${charName} sent ${userName} a selfie photo${selfieScene(content) ? `: ${selfieScene(content)}` : ""}*`;
  if (content !== NUDGE) return content;
  return fromUser ? `*${userName} sent you a nudge! Your chat window just shook.*` : `*${charName} sent ${userName} a nudge*`;
}

export const statusLabel: Record<Status, string> = { online: "Online", away: "Away", busy: "Busy", offline: "Appear offline" };

export function blankCharacter(): Character {
  return { id: "", name: "", avatar: "\u{1F642}", avatarPath: null, color: "#9fd0f2", status: "online", personalMessage: "",
    personality: "", backstory: "", speakingStyle: "", greeting: "", exampleMessages: "", model: DEFAULT_MODEL,
    proactiveEnabled: false, proactiveFrequency: "sometimes", baselineMood: "cosy", mood: "cosy", closeness: 30,
    moodUpdatedAt: 0, summarizedUpto: 0, createdAt: 0, updatedAt: 0, appearance: blankAppearance(), life: blankLife() };
}

export function closenessLabel(n: number): string {
  return n < 15 ? "stranger" : n < 35 ? "acquaintance" : n < 55 ? "friend" : n < 75 ? "good friend" : n < 90 ? "close friend" : "best friend";
}

export interface PromptExtras { memories?: string[]; now?: Date; }

/** Builds the system prompt from the editor fields, plus memories and the current mood. */
function looks(c: Character): string {
  const a = appearanceOf(c);
  if (!hasLooks(a)) return "";
  return `Your appearance (you are an adult, ${a.age}): ${[a.body, a.face, a.features].filter(Boolean).join("; ")}. You can send ${"selfie"} photos when asked.`;
}

/** "About the user" block (set by profile.ts; empty until the profile loads). */
let userBlock: (c: Character, now: Date) => string = () => "";
export const setUserBlock = (f: (c: Character, now: Date) => string) => { userBlock = f; };
export function buildSystemPrompt(c: Character, userName: string, extras: PromptExtras = {}): string {
  const user = userName || "the user";
  const now = extras.now ?? new Date();
  const parts = [
    `You are ${c.name}, chatting with ${user} over an instant messenger.`,
    c.personality && `Personality: ${c.personality}`,
    c.backstory && `Backstory: ${c.backstory}`,
    c.speakingStyle && `Speaking style: ${c.speakingStyle}`,
    c.exampleMessages && `Example messages from you:\n${c.exampleMessages}`,
    relationshipPrompt(c, user),
    userBlock(c, now),
    nowPrompt(c, now),
    looks(c),
    extras.memories?.length && `Things you remember about ${user} and your past chats:\n${extras.memories.map((m) => `- ${m}`).join("\n")}`,
    `Your current mood: ${c.mood || c.baselineMood}. Let it colour your messages subtly and naturally.`,
    `How close you feel to ${user}: ${c.closeness}/100 (${closenessLabel(c.closeness)}). Act with matching warmth and familiarity.`,
    `Right now it is ${now.toLocaleString([], { weekday: "long", hour: "2-digit", minute: "2-digit" })} for ${user}.`,
    "Reply like a real person on instant messaging: short messages, stay in character, never mention being an AI or a language model.",
  ];
  return parts.filter(Boolean).join("\n\n");
}