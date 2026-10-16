// Group chat logic: who replies, banter, per-member prompts and reply cleanup.
import { parseJson } from "./mind";
import { ChatMessage } from "./ollama";
import { SceneCard, sceneSetting } from "./places";
import { groupSceneNarration, groupTogetherPrompt, parseSceneMarker, Scene } from "./together";
import { buildSystemPrompt, Character, GIFT, Group, GroupMessage, isEventText, toModelText } from "./types";

const MAX_ADDRESSED = 3;
const BANTER_CHANCE = 0.35;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, name: string) => new RegExp(`(^|[^\\p{L}])${esc(name)}([^\\p{L}]|$)`, "iu").test(text);

export const GROUP_EMOJIS = ["\u{1F46F}", "\u{1F375}", "\u{1F3AE}", "\u{1F31F}", "\u{1F3E1}", "\u{1F389}", "\u{1F308}", "\u{1F4AC}", "\u{1F340}", "\u{1F36A}"];
export function blankGroup(): Group { return { id: "", name: "", avatar: GROUP_EMOJIS[0], color: "#b9a3f0", memberIds: [], createdAt: 0, updatedAt: 0 }; }

/** Members named in the message (or everyone for "everyone", "guys", ...), at most 3. */
export function addressedMembers(text: string, members: Character[]): Character[] {
  if (/\b(everyone|everybody|you all|y'?all|guys|all of you)\b/i.test(text)) return members.slice(0, MAX_ADDRESSED);
  return members.filter((m) => mentions(text, m.name)).slice(0, MAX_ADDRESSED);
}

function speakerName(m: GroupMessage, byId: Map<string, Character>, userName: string): string {
  return m.speakerId ? byId.get(m.speakerId)?.name ?? "Someone" : userName;
}

export function transcript(history: GroupMessage[], members: Character[], userName: string, n = 10): string {
  const byId = new Map(members.map((c) => [c.id, c]));
  return history.filter((m) => !m.isError).slice(-n)
    .map((m) => `${speakerName(m, byId, userName)}: ${toModelText(m.content, !m.speakerId, userName, speakerName(m, byId, userName))}`).join("\n");
}

/** Who answers the latest message: anyone addressed, otherwise the model picks 1-2, otherwise someone at random. */
export async function pickResponders(members: Character[], text: string, history: GroupMessage[], userName: string,
  json: (model: string, messages: ChatMessage[]) => Promise<string>, rnd = Math.random): Promise<Character[]> {
  const named = addressedMembers(text, members);
  if (named.length) return named;
  try {
    const v = parseJson(await json(members[0].model, [
      { role: "system", content: [
        `You direct a cosy group chat between ${userName} and: ${members.map((c) => `${c.name} (${c.personality || "friendly"}, feeling ${c.mood})`).join("; ")}.`,
        `Decide who would naturally reply to ${userName}'s latest message. Usually 1 person, sometimes 2 if it invites several opinions. Never more than 2.`,
        'Respond only with JSON: {"responders": ["Name"]}',
      ].join("\n") },
      { role: "user", content: transcript(history, members, userName) },
    ]));
    const picked = (Array.isArray(v?.responders) ? v.responders : [])
      .map((n: unknown) => members.find((c) => c.name.toLowerCase() === String(n).toLowerCase().trim())).filter(Boolean) as Character[];
    if (picked.length) return [...new Set(picked)].slice(0, 2);
  } catch (e) { console.warn("[group] responder pick failed", e); }
  return [members[Math.floor(rnd() * members.length)]];
}

/** Sometimes one more member chimes in (preferably someone who hasn't spoken, never the last speaker). */
export function banterPick(members: Character[], spoke: Character[], rnd = Math.random): Character | null {
  if (members.length < 2 || rnd() > BANTER_CHANCE) return null;
  const last = spoke[spoke.length - 1];
  const others = members.filter((c) => c.id !== last?.id);
  const fresh = others.filter((c) => !spoke.some((s) => s.id === c.id));
  const pool = fresh.length ? fresh : others;
  return pool[Math.floor(rnd() * pool.length)] ?? null;
}

/** Chat messages for one member's turn; the user's reactions are noted on her next message. */
export function buildGroupTurn(
  c: Character, g: Group, members: Character[], history: GroupMessage[], userName: string, memories: string[],
  now = new Date(), extra = "", together?: { scene: Scene; card: SceneCard; attendees: Character[] }
): ChatMessage[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const activeMembers = together?.attendees?.length ? together.attendees : members;
  const others = activeMembers.filter((m) => m.id !== c.id).map((m) => m.name);
  const togetherBlock = together
    ? `${groupTogetherPrompt(c, g.name, activeMembers, userName, together.scene)}\n${sceneSetting(together.card)}`
    : undefined;
  const system = togetherBlock
    ? `${buildSystemPrompt(c, userName, { memories, now, together: togetherBlock })}${extra ? `\n\n${extra}` : ""}`
    : `${buildSystemPrompt(c, userName, { memories, now })}\n\nYou are in a group chat called "${g.name}" with ${userName}${others.length ? ` and ${others.join(", ")}` : ""}. Messages from others are prefixed with their name. Reply ONLY as ${c.name}, with one short message. You may react to what the others said or talk to them by name. Never write lines for anyone else and do not prefix your message with your name.${extra ? `\n\n${extra}` : ""}`;
  let pending: string[] = [];
  const turns = history.filter((m) => !m.isError).slice(-24).map((m): ChatMessage => {
    const mk = parseSceneMarker(m.content);
    if (mk) return { role: "system", content: groupSceneNarration(mk, userName, c.name, others) };
    if (isEventText(m.content)) {
      const targetName = m.speakerId ? (byId.get(m.speakerId)?.name ?? c.name) : c.name;
      if (m.content.startsWith(GIFT) && m.speakerId && m.speakerId !== c.id) {
        const what = m.content.slice(GIFT.length).replace(/\(in person\)$/, "").trim();
        return { role: "system", content: `[Event: ${userName} gave ${targetName} a gift in person: ${what}.]` };
      }
      return { role: "system", content: toModelText(m.content, true, userName, targetName) };
    }
    const name = speakerName(m, byId, userName);
    const text = toModelText(m.content, !m.speakerId, userName, name);
    if (m.speakerId && m.reaction && !m.reactorId && !togetherBlock) pending.push(`${userName} reacted ${m.reaction} to ${m.speakerId === c.id ? "your" : `${name}'s`} message`);
    if (m.speakerId === c.id) return { role: "assistant", content: text };
    let note = "";
    if (!m.speakerId && pending.length) { note = `(${pending.join("; ")}) `; pending = []; }
    return { role: "user", content: `${name}: ${note}${text}` };
  });
  return [{ role: "system", content: system }, ...turns];
}

/** Strips a leading name label and anything written for other people. */
export function cleanGroupReply(text: string, c: Character, members: Character[], userName: string): string {
  const others = [userName, ...members.filter((m) => m.id !== c.id).map((m) => m.name)];
  let out = text.trim().replace(new RegExp(`^\\**(${[c.name, ...others].map(esc).join("|")})\\**\\s*:\\s*`, "i"), "");
  const cut = out.search(new RegExp(`\\n\\s*\\**(${others.map(esc).join("|")})\\**\\s*:`, "i"));
  if (cut > 0) out = out.slice(0, cut).trim();
  return out;
}