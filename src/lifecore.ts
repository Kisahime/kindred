// Relationships, daily schedules and milestones: pure helpers (no I/O, safe to import anywhere).
import type { Character, Status } from "./types";
import { toText } from "./text";

export type RelType = "friend" | "best friend" | "crush" | "partner" | "spouse" | "sibling" | "parent" | "child" | "cousin" | "grandparent" | "mentor" | "rival" | "custom";
export const REL_OPTIONS: { id: RelType; label: string; details?: string[] }[] = [
  { id: "friend", label: "Friend" }, { id: "best friend", label: "Best friend" }, { id: "crush", label: "Crush" },
  { id: "partner", label: "Girlfriend / boyfriend / partner", details: ["girlfriend", "boyfriend", "partner"] },
  { id: "spouse", label: "Spouse", details: ["wife", "husband", "spouse"] },
  { id: "sibling", label: "Sibling", details: ["sister", "brother", "sibling"] },
  { id: "parent", label: "Parent", details: ["mum", "dad", "parent"] },
  { id: "child", label: "Adult child", details: ["daughter", "son", "child"] },
  { id: "cousin", label: "Cousin" }, { id: "grandparent", label: "Grandparent", details: ["grandma", "grandad", "grandparent"] },
  { id: "mentor", label: "Mentor" }, { id: "rival", label: "Rival" }, { id: "custom", label: "Custom\u2026" },
];
export const ROMANTIC: RelType[] = ["crush", "partner", "spouse"];
export const FAMILY: RelType[] = ["sibling", "parent", "child", "cousin", "grandparent"];
export const isRomantic = (r: RelType) => ROMANTIC.includes(r);
export const isFamily = (r: RelType) => FAMILY.includes(r);

export type BlockStatus = "online" | "away" | "busy" | "sleeping";
export interface Block { start: string; activity: string; place: string; status: BlockStatus; }
export interface Proposal { to: RelType; detail: string; at: number; }
export interface Life {
  relationship: RelType; relationshipDetail: string; canEvolve: boolean; relationshipSince: number;
  nickname: string; petName: string;
  weekday: Block[]; weekend: Block[]; autoStatus: boolean;
  proposal: Proposal | null; lastProposalAt: number;
}
export function blankLife(): Life {
  return { relationship: "friend", relationshipDetail: "", canEvolve: false, relationshipSince: 0, nickname: "", petName: "",
    weekday: [], weekend: [], autoStatus: false, proposal: null, lastProposalAt: 0 };
}
const STATUSES: BlockStatus[] = ["online", "away", "busy", "sleeping"];
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
/** Cleans model or user supplied blocks: valid HH:MM, known status, sorted, max 16. */
export function normalizeBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  const out: Block[] = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") continue;
    const m = TIME.exec(String((b as Block).start ?? "").trim());
    const activity = toText((b as Block).activity).slice(0, 80);
    if (!m || !activity) continue;
    const st = String((b as Block).status ?? "").toLowerCase() as BlockStatus;
    out.push({ start: `${m[1].padStart(2, "0")}:${m[2]}`, activity, place: toText((b as Block).place).slice(0, 80),
      status: STATUSES.includes(st) ? st : "online" });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 16);
}
export function lifeOf(c: Pick<Character, "life">): Life {
  const raw = (c.life ?? {}) as Partial<Life>;
  const l = { ...blankLife(), ...raw };
  if (!REL_OPTIONS.some((o) => o.id === l.relationship)) l.relationship = "friend";
  l.weekday = normalizeBlocks(l.weekday); l.weekend = normalizeBlocks(l.weekend);
  return l;
}
export const hasSchedule = (l: Life) => l.weekday.length > 0 || l.weekend.length > 0;

// ---- schedules ---------------------------------------------------------------
const B = (start: string, activity: string, place: string, status: BlockStatus): Block => ({ start, activity, place, status });
/** A generic day built from a job, a hobby and a bedtime. */
export function makeSchedule(o: { job: string; workPlace: string; hobby: string; hobbyPlace?: string; wake?: string; sleep?: string; weekendHobby?: string; weekendPlace?: string }): Pick<Life, "weekday" | "weekend"> {
  const wake = o.wake ?? "07:00", sleep = o.sleep ?? "23:00";
  return {
    weekday: [
      B(wake, "waking up with a cup of tea", "at home", "away"), B("09:00", o.job, o.workPlace, "busy"), B("12:30", "on lunch break", o.workPlace, "online"),
      B("13:30", o.job, o.workPlace, "busy"), B("17:30", "heading home and unwinding", "at home", "online"), B("19:00", o.hobby, o.hobbyPlace ?? "at home", "online"),
      B("22:00", "winding down for bed", "at home, cosy lamp light", "away"), B(sleep, "asleep", "in bed", "sleeping"),
    ].sort((a, b) => a.start.localeCompare(b.start)),
    weekend: [
      B(addHours(wake, 2), "having a lazy breakfast", "at home", "online"), B("11:00", o.weekendHobby ?? o.hobby, o.weekendPlace ?? o.hobbyPlace ?? "out and about", "online"),
      B("15:00", "relaxing", "at home", "online"), B("19:00", "chilling with a film", "on the sofa", "online"),
      B(addHours(sleep, 1), "asleep", "in bed", "sleeping"),
    ].sort((a, b) => a.start.localeCompare(b.start)),
  };
}
function addHours(t: string, h: number) { const [a, b] = t.split(":").map(Number); return `${String(Math.min(23, a + h)).padStart(2, "0")}:${String(b).padStart(2, "0")}`; }
export const defaultSchedule = () => makeSchedule({ job: "at work", workPlace: "at work", hobby: "doing hobbies" });

/** Default relationship + schedule for the starter templates. */
export function starterLife(name: string): Partial<Life> {
  const t: Record<string, [RelType, string, Parameters<typeof makeSchedule>[0]]> = {
    Juniper: ["friend", "", { job: "working at the garden centre", workPlace: "garden centre greenhouse", hobby: "repotting plants", hobbyPlace: "sunny balcony full of plants", weekendHobby: "at the farmers market" }],
    Max: ["friend", "", { job: "coaching clients at the gym", workPlace: "the gym", hobby: "baking protein muffins", hobbyPlace: "kitchen", wake: "06:00", sleep: "22:30", weekendHobby: "on a long run", weekendPlace: "park trail" }],
    "Professor Hart": ["mentor", "", { job: "teaching a lecture", workPlace: "university lecture hall", hobby: "reading by the fire", hobbyPlace: "armchair by a fireplace", wake: "06:30", sleep: "22:30", weekendHobby: "browsing a second-hand bookshop", weekendPlace: "old bookshop" }],
    Nova: ["friend", "", { job: "in astrophysics classes", workPlace: "university observatory", hobby: "stargazing", hobbyPlace: "rooftop at dusk", wake: "08:30", sleep: "01:00" }],
    Sol: ["friend", "", { job: "working at the record shop", workPlace: "record shop", hobby: "playing an open-mic set", hobbyPlace: "small cafe stage", wake: "09:00", sleep: "00:30" }],
    Ivy: ["best friend", "", { job: "tattooing clients", workPlace: "tattoo studio", hobby: "watching horror films", hobbyPlace: "candlelit flat", wake: "09:30", sleep: "01:00", weekendHobby: "vintage shopping", weekendPlace: "flea market" }],
    "Grandma Rose": ["grandparent", "grandma", { job: "pottering in the garden", workPlace: "rose garden", hobby: "knitting", hobbyPlace: "armchair with a ginger cat", wake: "06:30", sleep: "21:30", weekendHobby: "baking scones", weekendPlace: "cosy kitchen" }],
    Kai: ["friend", "", { job: "exploring a new city", workPlace: "busy market in a foreign city", hobby: "editing travel photos", hobbyPlace: "hostel common room", wake: "07:30", sleep: "00:00", weekendHobby: "surfing", weekendPlace: "beach" }],
    Pixel: ["friend", "", { job: "fixing gadgets", workPlace: "cluttered repair shop", hobby: "playing retro games", hobbyPlace: "workbench with lamps", wake: "07:00", sleep: "23:00" }],
    Luna: ["friend", "", { job: "shelving books", workPlace: "quiet library aisle", hobby: "reading poetry", hobbyPlace: "window seat", wake: "11:00", sleep: "03:00" }],
  };
  const x = t[name];
  if (!x) return { ...defaultSchedule() };
  return { relationship: x[0], relationshipDetail: x[1], ...makeSchedule(x[2]) };
}

export interface Current { block: Block; weekend: boolean; }
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
/** What they are doing at `now`, or null without a schedule. Before the first block of the day, yesterday's last block applies. */
export function currentBlock(l: Life, now = new Date()): Current | null {
  const pick = (d: Date) => { const we = isWeekend(d); const list = we ? (l.weekend.length ? l.weekend : l.weekday) : (l.weekday.length ? l.weekday : l.weekend); return { we, list }; };
  const today = pick(now);
  if (!today.list.length) return null;
  const t = hhmm(now);
  const found = [...today.list].reverse().find((b) => b.start <= t);
  if (found) return { block: found, weekend: today.we };
  const y = pick(new Date(now.getTime() - 86_400_000));
  return { block: y.list[y.list.length - 1], weekend: y.we };
}
/** Status + personal message the schedule implies. */
export function scheduleStatus(cur: Current): { status: Status; personalMessage: string } {
  const b = cur.block;
  if (b.status === "sleeping") return { status: "away", personalMessage: "\u{1F4A4} asleep" };
  return { status: b.status, personalMessage: b.activity };
}

// ---- prompt -----------------------------------------------------------------
export function relationLabel(l: Life): string {
  if (l.relationship === "custom") return l.relationshipDetail.trim() || "friend";
  return l.relationshipDetail.trim() || l.relationship;
}
export function relationshipPrompt(c: Pick<Character, "life" | "name">, user: string): string {
  const l = lifeOf(c);
  const r = l.relationship, label = relationLabel(l);
  const lines: string[] = [];
  if (isFamily(r)) {
    lines.push(`You are ${user}'s ${r === "child" ? `adult ${label}` : label}. This is a FAMILY relationship: be warm, caring, familiar and supportive, the way family is. Never be romantic, flirtatious or sexual with ${user} in any way, and refuse to roleplay that.`);
  } else if (r === "crush") {
    lines.push(`You have a crush on ${user}. You're a little shy and flustered around them, with flirty hints, but you haven't confessed properly.`);
  } else if (isRomantic(r)) {
    lines.push(`You are ${user}'s ${label}. You're in a loving romantic relationship: affectionate, sweet and a bit flirty, keeping things tasteful.`);
  } else if (r === "rival") {
    lines.push(`You and ${user} are friendly rivals: competitive teasing and banter, but deep down you respect them. Keep it platonic.`);
  } else if (r === "mentor") {
    lines.push(`You are ${user}'s mentor: encouraging, wise and kind. Keep it platonic.`);
  } else if (r === "custom") {
    lines.push(`Your relationship with ${user}: ${label}.`);
  } else {
    lines.push(`You and ${user} are ${r === "best friend" ? "best friends: you share everything, tease each other and are fiercely loyal" : "friends"}. Keep it platonic.`);
  }
  if (l.nickname) lines.push(`You sometimes call ${user} "${l.nickname}".`);
  if (l.petName && isRomantic(r)) lines.push(`Your pet name for ${user} is "${l.petName}".`);
  return lines.join(" ");
}
export function nowPrompt(c: Pick<Character, "life">, now = new Date()): string {
  const cur = currentBlock(lifeOf(c), now);
  if (!cur) return "";
  const b = cur.block;
  const when = now.toLocaleString([], { weekday: "long", hour: "2-digit", minute: "2-digit" });
  if (b.status === "sleeping") return `Your daily life: right now (${when}) you would normally be asleep${b.place ? ` (${b.place})` : ""}. If you are messaging, you've just woken up or can't sleep, so you're drowsy.`;
  return `Your daily life: right now (${when}) you are ${b.activity}${b.place && !b.activity.includes(b.place) ? ` (${b.place})` : ""}.${b.status === "busy" ? " You're busy, so keep replies brief." : ""}`;
}

// ---- evolution, unlocks, anniversaries ----------------------------------------
const DAY = 86_400_000;
export const EVOLVE: Partial<Record<RelType, { to: RelType; at: number }>> = {
  friend: { to: "best friend", at: 70 }, rival: { to: "friend", at: 60 }, crush: { to: "partner", at: 75 }, partner: { to: "spouse", at: 92 },
};
export function partnerWord(c: Pick<Character, "appearance">, to: RelType): string {
  const body = String((c.appearance as { body?: string })?.body ?? "").toLowerCase();
  const woman = /\b(woman|girl|female|lady)\b/.test(body), man = !woman && /\b(man|guy|male)\b/.test(body);
  if (to === "partner") return woman ? "girlfriend" : man ? "boyfriend" : "partner";
  if (to === "spouse") return woman ? "wife" : man ? "husband" : "spouse";
  return "";
}
/** A relationship change the character could propose now, or null. */
export function evolutionDue(c: Pick<Character, "life" | "closeness" | "appearance">, now = Date.now()): Proposal | null {
  const l = lifeOf(c);
  if (!l.canEvolve || l.proposal) return null;
  if (now - l.lastProposalAt < 3 * DAY) return null;
  const e = EVOLVE[l.relationship];
  if (!e || c.closeness < e.at) return null;
  return { to: e.to, detail: partnerWord(c, e.to), at: now };
}
export type UnlockKind = "nickname" | "pet_name" | "inside_joke";
export const UNLOCKS: { kind: UnlockKind; at: number; data: string; romanticOnly?: boolean }[] = [
  { kind: "nickname", at: 45, data: "" }, { kind: "pet_name", at: 55, data: "", romanticOnly: true },
  { kind: "inside_joke", at: 60, data: "60" }, { kind: "inside_joke", at: 85, data: "85" },
];
export function unlocksDue(c: Pick<Character, "life" | "closeness">, have: { kind: string; data: string }[]) {
  const r = lifeOf(c).relationship;
  return UNLOCKS.filter((u) => c.closeness >= u.at && (!u.romanticOnly || isRomantic(r)) && !have.some((h) => h.kind === u.kind && h.data === u.data));
}
/** If today is a monthly (or yearly) anniversary of `since`, how many months it has been. */
export function anniversaryMonths(since: number, now = new Date()): number {
  if (!since) return 0;
  const s = new Date(since);
  const months = (now.getFullYear() - s.getFullYear()) * 12 + now.getMonth() - s.getMonth();
  if (months < 1) return 0;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return now.getDate() === Math.min(s.getDate(), lastDay) ? months : 0;
}
export function anniversaryLabel(months: number) {
  return months % 12 === 0 ? `${months / 12} year${months > 12 ? "s" : ""}` : `${months} month${months > 1 ? "s" : ""}`;
}
export const MILESTONE_ICON: Record<string, string> = {
  first_met: "\u{1F91D}", first_selfie: "\u{1F4F7}", relationship: "\u{1F49E}", nickname: "\u{1F3F7}\uFE0F", pet_name: "\u{1F496}",
  inside_joke: "\u{1F602}", anniversary: "\u{1F389}", first_date: "\u{1F49E}", first_hangout: "\u{1F4CD}",
};