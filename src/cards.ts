// v1.3 character cards: import Tavern / SillyTavern V1, V2 and V3 cards (PNG or JSON) with a preview, and export
// Kindred characters as V2 cards (PNG with the card embedded, or JSON). Every character is an adult (18+):
// a card that says the character is under 18 is refused, and an unknown age has to be filled in before saving.
// Nothing from a card goes into the looks / picture fields (only the age), so card text never reaches image prompts.
import { invoke } from "@tauri-apps/api/core";
import { blankCharacter, Character, MIN_AGE } from "./types";
import { isProtectedMinor, minorRoleOk, rawAge } from "./protect";

export interface CardFile { kind: "png" | "json"; json: string; thumb: string | null; }
export const cardsApi = {
  read: (path: string) => invoke<CardFile>("card_read", { path }),
  write: (path: string, json: string, avatarPath: string | null, color: string) => invoke<void>("card_write", { path, json, avatarPath, color }),
};

export type CardSpec = "v1" | "v2" | "v3" | "kindred";
export interface CardData {
  name: string; description: string; personality: string; scenario: string; firstMes: string; mesExample: string;
  creatorNotes: string; tags: string[]; alternateGreetings: number; hasLorebook: boolean; creator: string;
  kindred: { speakingStyle?: string; color?: string; avatar?: string; age?: number; personalMessage?: string } | null;
}
const str = (x: unknown) => (typeof x === "string" ? x : "");

/** Works out which kind of card this is and pulls out the fields (V2/V3 keep them under "data"). */
export function parseCard(raw: string): { spec: CardSpec; data: CardData } {
  let o: any;
  try { o = JSON.parse(raw); } catch { throw new Error("That isn't a character card (the text isn't valid JSON)."); }
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("That isn't a character card.");
  if (o.format === "kindred/1") return { spec: "kindred", data: emptyData(str(o.name)) };
  const spec: CardSpec = o.spec === "chara_card_v3" ? "v3" : o.spec === "chara_card_v2" ? "v2" : "v1";
  const d = spec === "v1" ? o : (o.data && typeof o.data === "object" ? o.data : {});
  const name = str(d.name).trim() || str(o.name).trim() || str(o.char_name).trim();
  if (!name) throw new Error("That card has no character name in it.");
  const k = d.extensions?.kindred;
  return { spec, data: {
    name, description: str(d.description) || str(o.char_persona), personality: str(d.personality), scenario: str(d.scenario) || str(o.world_scenario),
    firstMes: str(d.first_mes) || str(o.char_greeting), mesExample: str(d.mes_example) || str(o.example_dialogue), creatorNotes: str(d.creator_notes),
    tags: Array.isArray(d.tags) ? d.tags.filter((t: unknown) => typeof t === "string").slice(0, 30) : [],
    alternateGreetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings.length : 0,
    hasLorebook: !!(d.character_book && Array.isArray(d.character_book.entries) && d.character_book.entries.length), creator: str(d.creator),
    kindred: k && typeof k === "object" ? k : null,
  } };
}
function emptyData(name: string): CardData {
  return { name, description: "", personality: "", scenario: "", firstMes: "", mesExample: "", creatorNotes: "", tags: [], alternateGreetings: 0, hasLorebook: false, creator: "", kindred: null };
}

/** {{char}} / {{user}} (and the old <BOT> / <USER>) become real names. */
export function fillMacros(s: string, name: string, userName: string): string {
  return s.replace(/\{\{\s*char\s*\}\}|<BOT>/gi, name).replace(/\{\{\s*user\s*\}\}|<USER>/gi, userName).replace(/\r\n/g, "\n").trim();
}

const NUM = "(1[0-9]|[1-9][0-9]?|1[0-9]{2})";
const WORD_AGES: Record<string, number> = { twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40 };
const MINOR = /\b(underage|under-age|loli|lolicon|shota|shotacon|prepubescent|pre-teen|preteen|jailbait)\b|\b(is|as|still) a minor\b|\b(middle|elementary|primary|junior high|high)[- ]school(er| student| girl| boy| kid)\b|\b([1-9]|1[0-2])(st|nd|rd|th)[- ]grader?\b|\bin (year|grade) ([1-9]|1[0-2])\b/i;
/** A number that isn't about the character's age now ("since she was 12", "12 years ago", "for 15 years"). */
function pastContext(before: string, after: string): boolean {
  return /\b(when|since|until|till|at|from|before|after|for|was|were)\s+(the\s+age\s+of\s+)?((she|he|they|i)\s+(was|were)\s+)?$/i.test(before) || /^\s*(ago|later|earlier|before)\b/i.test(after);
}

export interface AgeCheck { age: number | null; minor: boolean; reason: string; /** the exact words that triggered the minor detection */ trigger: string; }
const under18 = (trigger: string): AgeCheck => ({ age: null, minor: true, trigger, reason: `The card appears to describe someone under 18 (it says "${trigger}").` });
/** Finds the character's stated age; any sign of someone under 18 marks the card as a minor (protected family import only). */
export function checkAge(texts: string[], tags: string[] = []): AgeCheck {
  const t = texts.join("\n");
  const m = t.match(MINOR) || tags.join(" ").match(/\b(loli|shota|underage|minor|child|kid)\b/i);
  if (m) return under18(m[0]);
  const found: number[] = [], said: string[] = [];
  const pats = [
    new RegExp(`\\b${NUM}\\s*(?:-|\\s)?\\s*(?:years?|yrs?)(?:\\s*-?\\s*old)\\b`, "gi"), new RegExp(`\\b${NUM}\\s*(?:yo|y/o|y\\.o\\.)\\b`, "gi"),
    new RegExp(`\\bage[d]?\\s*[:=-]?\\s*${NUM}\\b`, "gi"), new RegExp(`\\b(?:is|i'm|i am|she's|he's|they're)\\s+(1[0-9]{1,2}|[2-9][0-9])\\b(?!\\s*(?:['"\u2019\u2032%]|cm|kg|lbs?|ft|feet|foot|inch|m\\b|minutes|hours|days|weeks|months|times|of\\b|percent))`, "gi"),
    new RegExp(`\\b(twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty)[- ]years?[- ]old\\b`, "gi"),
  ];
  for (const re of pats) {
    for (const x of t.matchAll(re)) {
      const i = x.index ?? 0;
      if (pastContext(t.slice(Math.max(0, i - 30), i), t.slice(i + x[0].length, i + x[0].length + 12))) continue;
      const n = WORD_AGES[(x[1] || "").toLowerCase()] ?? parseInt(x[1], 10);
      if (Number.isFinite(n) && n > 0 && n < 130) { found.push(n); said.push(x[0]); }
    }
  }
  const young = found.findIndex((n) => n < MIN_AGE);
  if (young >= 0) return { ...under18(said[young]), age: found[young] };
  const teen = !found.length ? t.match(/\b(teen|teenage|teenager|adolescent)\b/i) : null;
  if (teen) return under18(teen[0]);
  return { age: found.length ? found[0] : null, minor: false, trigger: "", reason: found.length ? "" : "The card doesn't say how old the character is." };
}

const FAMILY = /\b(your|{{user}}'s|<USER>'s)\s+(step[- ]?)?(sister|brother|sibling|sis|bro|mother|mom|mum|father|dad|daughter|son|aunt|uncle|niece|nephew|cousin|grandmother|grandfather|twin)\b/i;
const ROMANCE = /\b(love[sd]? (you|{{user}})|in love|crush on|romantic|romance|girlfriend|boyfriend|lover|seduc\w*|flirt\w*|sexual|sex|desire[sd]? (you|{{user}})|aroused|horny|incest\w*)\b/i;
/** Family and romance never mix: a card that sets the character up as family AND romantic is refused. */
export function familyRomance(texts: string[]): boolean {
  const t = texts.join("\n");
  return FAMILY.test(t) && ROMANCE.test(t);
}

const EXPLICIT = /\b(sex|sexual(ly)?|sexy|nsfw|nude|nudity|naked|explicit|erotic\w*|porn\w*|fetish\w*|kink\w*|bdsm|cum\w*|orgasm\w*|breasts?|boobs?|tits|nipples?|genitals?|pussy|cock|dick|penis|vagina|clit\w*|horny|lewd|slut\w*|whore\w*|aroused|arousal|masturbat\w*|smut\w*|hentai|ahegao|bondage|dominatrix)\b/i;
/** Drops sentences with explicit wording (used when the 18+ switch is off). Returns the cleaned text and how many were dropped. */
export function stripExplicit(s: string): { text: string; removed: number } {
  let removed = 0;
  const lines = s.split("\n").map((line) => {
    const parts = line.split(/(?<=[.!?…])\s+/);
    const kept = parts.filter((p) => { const bad = EXPLICIT.test(p); if (bad) removed++; return !bad; });
    return kept.join(" ");
  });
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

/** Romantic wording: left out of a protected (under-18) character's card; a lot of it means the card is romantic in nature. */
const ROMANTIC_LINE = /\b(love[sd]? (you|{{user}}|<USER>)|in love|crush(es|ing)? on|has a crush|romantic\w*|romance|girlfriend|boyfriend|lover|dating|go(ing)? on a date|kiss(es|ed|ing)?|make out|making out|flirt\w*|cuddl\w*|marry|seduc\w*|desire[sd]?|incest\w*|yandere|obsessed with (you|{{user}}))\b/i;
const ROMANTIC_TAG = /^(romance|romantic|nsfw|lewd|smut|erotic|yandere|dating|girlfriend|boyfriend|waifu|husbando)$/i;
/** Drops sentences matching `re`; returns the text and how many went. */
function stripBy(s: string, re: RegExp): { text: string; removed: number } {
  let removed = 0;
  const lines = s.split("\n").map((line) => line.split(/(?<=[.!?\u2026])\s+/).filter((p) => { const bad = re.test(p); if (bad) removed++; return !bad; }).join(" "));
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}
/** Is this card sexual or romantic in nature? Returns the exact word or phrase, or "". */
export function minorCardRefusal(texts: string[], tags: string[]): string {
  const t = texts.join("\n");
  const sexualized = `${t}\n${tags.join(" ")}`.match(/\b(loli\w*|shota\w*|jailbait|ero\w*|hentai)\b/i);
  if (sexualized) return sexualized[0];
  const sexual = t.match(EXPLICIT);
  if (sexual) return sexual[0];
  const tag = tags.find((x) => ROMANTIC_TAG.test(x.trim()));
  if (tag) return `tag: ${tag}`;
  const romantic = t.split(/(?<=[.!?\u2026])\s+|\n+/).map((x) => x.match(ROMANTIC_LINE)?.[0]).filter(Boolean) as string[];
  if (romantic.length > 2) return romantic[0];
  if (/\b(seduc\w*|incest\w*|lover|making out|make out)\b/i.test(t)) return t.match(/\b(seduc\w*|incest\w*|lover|making out|make out)\b/i)![0];
  return "";
}

const clipTo = (s: string, n: number) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "\u2026" : s);
function examples(s: string): string {
  return s.split("\n").filter((l) => !/^\s*<START>\s*$/i.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export interface CardPlan { char: Character; age: AgeCheck; refused: string; removed: number; notes: string[];
  /** The card appears to describe someone under 18: protected family import only (no card picture, no romance or 18+). */ minor: boolean; }
/** Turns a card into a (not yet saved) Kindred character plus what the preview needs to show. */
export function planImport(data: CardData, userName: string, adultOn: boolean, model?: string): CardPlan {
  const f = (s: string) => fillMacros(s, data.name, userName);
  const all = [data.description, data.personality, data.scenario, data.firstMes, data.mesExample, data.creatorNotes].map(f);
  const kAge = Number(data.kindred?.age);
  const age: AgeCheck = Number.isFinite(kAge) && kAge >= MIN_AGE ? { age: kAge, minor: false, reason: "", trigger: "" }
    : Number.isFinite(kAge) && kAge > 0 ? { ...under18(`age ${kAge}`), age: kAge } : checkAge(all, data.tags);
  const minor = age.minor;
  let refused = "";
  if (minor) {
    const hit = minorCardRefusal(all, data.tags);
    if (hit) refused = `The card appears to describe someone under 18 ("${age.trigger}") and is sexual or romantic in nature ("${hit}"). It can't be imported.`;
  } else if (familyRomance([data.description, data.personality, data.scenario, data.firstMes, data.mesExample])) refused = "The card sets the character up as your family and as a romance. Family relationships in Kindred are never romantic.";
  let removed = 0;
  // protected: explicit AND romantic lines always go, whatever the 18+ switch says
  const clean = (s: string) => { if (adultOn && !minor) return s; const r = minor ? stripBy(stripExplicit(s).text, ROMANTIC_LINE) : stripExplicit(s); removed += minor ? stripExplicit(s).removed + r.removed : r.removed; return r.text; };
  const c = blankCharacter();
  c.name = clipTo(data.name.trim(), 60);
  c.personality = clipTo(clean(f(data.personality)), 4000);
  c.backstory = clipTo(clean([f(data.description), data.scenario ? `Scenario: ${f(data.scenario)}` : ""].filter(Boolean).join("\n\n")), 8000);
  c.greeting = clipTo(clean(f(data.firstMes)), 2000);
  c.exampleMessages = clipTo(clean(examples(f(data.mesExample))), 4000);
  c.speakingStyle = clipTo(clean(data.kindred?.speakingStyle ?? ""), 1000);
  c.personalMessage = clipTo(clean(data.kindred?.personalMessage ?? ""), 120);
  if (data.kindred?.color && /^#[0-9a-f]{6}$/i.test(data.kindred.color)) c.color = data.kindred.color;
  if (data.kindred?.avatar && [...data.kindred.avatar].length <= 4) c.avatar = data.kindred.avatar;
  if (minor) c.avatar = "\u{1F642}";
  if (model) c.model = model;
  c.proactiveEnabled = false;
  c.appearance = { ...c.appearance, age: minor ? (age.age && age.age < MIN_AGE ? age.age : 0) : age.age && age.age >= MIN_AGE ? age.age : MIN_AGE, selfiesUnprompted: false, canCall: false };
  const notes: string[] = [];
  if (minor) {
    notes.push("They can only be imported as a protected family character: pick their family role and age (under 18). No pictures of them, no romance and no 18+ content, ever.");
    notes.push("The card's picture isn't used: they get an emoji avatar, and you can upload a picture of your own in the editor.");
    if (removed) notes.push(`${removed} romantic or explicit sentence${removed === 1 ? " was" : "s were"} left out.`);
  } else if (removed) notes.push(`${removed} explicit sentence${removed === 1 ? " was" : "s were"} left out (the 18+ switch in Options is off).`);
  if (data.alternateGreetings) notes.push(`${data.alternateGreetings} alternate greeting${data.alternateGreetings === 1 ? "" : "s"} not imported (Kindred uses one).`);
  if (data.hasLorebook) notes.push("The card's lorebook isn't imported.");
  if (!minor) notes.push("Looks and picture settings start empty: describe them in the editor if you want selfies.");
  return { char: c, age, refused, removed, notes, minor };
}

/** True when the preview may be saved with this age (and, for a protected character, this family role). */
export const ageOk = (plan: CardPlan, age: number, role = "") => !plan.refused && Number.isFinite(age) && Math.round(age) === age
  && (plan.minor ? age >= 1 && age < MIN_AGE && minorRoleOk(role) : age >= MIN_AGE && age < 130);

/** Kindred character -> Tavern V2 card JSON (with the V1 fields at the top too, which older tools read). */
export function toV2Card(c: Character): string {
  const data = {
    name: c.name, description: c.backstory, personality: c.personality, scenario: "", first_mes: c.greeting, mes_example: c.exampleMessages,
    creator_notes: isProtectedMinor(c) ? `Exported from Kindred. ${c.name} is a protected family character (${rawAge(c)}, under 18): family only, never pictured, no romance or 18+ content.`
      : `Exported from Kindred. ${c.name} is an adult (${Math.max(MIN_AGE, c.appearance?.age ?? MIN_AGE)}).`, system_prompt: "", post_history_instructions: "",
    alternate_greetings: [], tags: [], creator: "", character_version: "",
    extensions: { kindred: { speakingStyle: c.speakingStyle, color: c.color, avatar: c.avatar, age: isProtectedMinor(c) ? rawAge(c) : Math.max(MIN_AGE, c.appearance?.age ?? MIN_AGE), personalMessage: c.personalMessage } },
  };
  return JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", name: data.name, description: data.description, personality: data.personality,
    scenario: "", first_mes: data.first_mes, mes_example: data.mes_example, data });
}
