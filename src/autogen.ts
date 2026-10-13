// Auto-generation of contact editor fields (one field at a time, or a whole character) with Ollama JSON calls.
import { api } from "./api";
import { parseJson, JsonCaller } from "./mind";
import { appearanceOf, Appearance, blankCharacter, Character, hasLooks, MIN_AGE, Mood, MOODS } from "./types";
import { isFamily, isRomantic, lifeOf, Life, REL_OPTIONS, RelType, relationLabel } from "./lifecore";

import { toText } from "./text";
export { toText };
let callJson: JsonCaller = api.ollamaJson;
export const setGenJsonCaller = (f: JsonCaller) => { callJson = f; };

type AKey = Exclude<keyof Appearance, "imageModel" | "negativeTags" | "seed" | "lora" | "loraStrength" | "selfiesUnprompted" | "voice" | "voiceSpeed" | "canCall">;
export type GenField = "personalMessage" | "personality" | "backstory" | "speakingStyle" | "greeting" | "exampleMessages" | "baselineMood"
  | `a.${AKey}` | "l.nickname" | "l.petName" | "l.relationshipDetail";

const CHAR_HINT: Record<string, string> = {
  personalMessage: "their Messenger personal message / status line (max 60 characters, may include an emoji)",
  personality: "a personality description (1-2 sentences of traits, likes and quirks)",
  backstory: "a short backstory (2-3 sentences: job or studies, where they live, a bit of history)",
  speakingStyle: "how they type in chat (capitalisation, emoji use, slang, punctuation habits), one sentence",
  greeting: "their very first chat message to the user (one short in-character instant message)",
  exampleMessages: "4 short example chat messages in their voice, as an array of strings",
  baselineMood: `their usual mood, one of: ${MOODS.join(", ")}`,
};
const A_HINT: Record<AKey, string> = {
  age: `their age as a number (adult, ${MIN_AGE} or older)`,
  body: "gender and body type and skin tone for an image prompt, as short tags",
  face: "face, hair and eyes as image prompt tags",
  features: "distinguishing features as image tags (glasses, tattoos, piercings, jewellery...)",
  style: "picture style keywords (photo look, lighting, or an art style)",
  outfitDay: "their usual daytime outfit", outfitEvening: "their evening outfit", outfitNight: "what they wear to bed (pyjamas etc.)",
  placeDay: "where they usually are in the daytime (a short visual setting)", placeEvening: "their usual evening setting", placeNight: "their night-time setting (a short visual setting)",
  extraTags: "a few extra positive image tags that fit their look (comma separated)",
};
const L_HINT: Record<string, string> = {
  "l.nickname": "an affectionate nickname they call the user (1-3 words)",
  "l.petName": "a sweet romantic pet name they call the user (1-2 words)",
  "l.relationshipDetail": "a short description of how they know the user (one short phrase)",
};
export const FIELD_LABEL = (f: GenField) => f.replace(/^[al]\./, "");

export function getField(c: Character, f: GenField): unknown {
  if (f.startsWith("a.")) return appearanceOf(c)[f.slice(2) as AKey];
  if (f.startsWith("l.")) return lifeOf(c)[f.slice(2) as keyof Life];
  return c[f as keyof Character];
}
export function setField(c: Character, f: GenField, v: unknown): Character {
  if (f.startsWith("a.")) return { ...c, appearance: { ...appearanceOf(c), [f.slice(2)]: v } };
  if (f.startsWith("l.")) return { ...c, life: { ...lifeOf(c), [f.slice(2)]: v } };
  return { ...c, [f]: v };
}
const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim());

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const STOP = new Set(["and", "the", "with", "her", "his", "their", "over", "for", "a", "of", "in", "on"]);
/** Word-overlap similarity (Jaccard) of two descriptions, 0..1. */
export function similarity(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase() && !!a.trim() ? 1 : 0;
  let both = 0; x.forEach((w) => { if (y.has(w)) both++; });
  return both / (x.size + y.size - both);
}
export const TOO_SIMILAR = 0.55;
type Slot = "Day" | "Evening" | "Night";
const SLOTS: Slot[] = ["Day", "Evening", "Night"];
const SLOT_GUIDE: Record<"outfit" | "place", Record<Slot, string>> = {
  outfit: { Day: "DAYTIME: casual or work clothes", Evening: "EVENING: a going-out outfit or relaxed home clothes", Night: "NIGHT: pyjamas, nightwear or loungewear for bed" },
  place: { Day: "DAYTIME: where they are during the day (work, studies, out and about)", Evening: "EVENING: an evening setting (home, a cafe, out with friends)", Night: "NIGHT: their bedroom or night-time spot" },
};
export function slotOf(f: GenField): { kind: "outfit" | "place"; slot: Slot } | null {
  const m = /^a\.(outfit|place)(Day|Evening|Night)$/.exec(f);
  return m ? { kind: m[1] as "outfit" | "place", slot: m[2] as Slot } : null;
}
const clip = (s: unknown, n: number) => toText(s).replace(/[<>]/g, " ").replace(/[ \t]+/g, " ").trim().replace(/^["']|["']$/g, "").slice(0, n);
/** Validates one generated value. Returns undefined if unusable. */
export function cleanValue(f: GenField, v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  if (f === "a.age") { const n = Math.round(Number(toText(v).match(/\d+/)?.[0])); return Number.isFinite(n) ? Math.max(MIN_AGE, Math.min(99, n)) : undefined; }
  if (f === "baselineMood") { const m = toText(v).toLowerCase().trim(); return (MOODS as string[]).includes(m) ? (m as Mood) : undefined; }
  if (f === "exampleMessages") {
    const lines = (Array.isArray(v) ? v.map((x) => toText(x)) : toText(v).split(/\n+/)).map((x) => clip(x, 160)).filter(Boolean).slice(0, 6);
    return lines.length ? lines.join("\n") : undefined;
  }
  const max = f === "personalMessage" ? 80 : f.startsWith("l.") ? 40 : f === "backstory" ? 600 : f === "personality" ? 400 : 200;
  const s = clip(v, max);
  return s || undefined;
}

/** Everything already known about the character, so new values stay consistent. */
export function contextOf(c: Character, user: string, skip?: GenField): string {
  const a = appearanceOf(c), l = lifeOf(c);
  const rows: [string, unknown][] = [
    ["Name", c.name], ["Personal message", skip === "personalMessage" ? "" : c.personalMessage], ["Personality", skip === "personality" ? "" : c.personality],
    ["Backstory", skip === "backstory" ? "" : c.backstory], ["Speaking style", skip === "speakingStyle" ? "" : c.speakingStyle],
    ["Greeting", skip === "greeting" ? "" : c.greeting], ["Example messages", skip === "exampleMessages" ? "" : c.exampleMessages],
    // usual mood only once the personality exists (a blank character's default mood would bias everything)
    ["Usual mood", skip === "baselineMood" || skip === "personality" || !c.personality.trim() ? "" : c.baselineMood],
    ...(Object.keys(A_HINT) as AKey[]).map((k): [string, unknown] => [`Appearance ${k}`, skip === `a.${k}` ? "" : a[k]]),
  ];
  const known = rows.filter(([, v]) => !isEmpty(v) && v !== 0).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `${known || "(nothing yet)"}\nRelationship to ${user}: ${relationLabel(l)}.`;
}
export function rulesFor(c: Character, user: string): string {
  const r = lifeOf(c).relationship;
  return [
    `All characters are adults (${MIN_AGE}+). Appearance text is for wholesome photos: tasteful, non-sexual, no nudity or lingerie.`,
    isFamily(r) ? `They are ${user}'s ${relationLabel(lifeOf(c))}: family, so nothing romantic, flirty or sexual.` : isRomantic(r) ? "The relationship is romantic, sweet and tasteful." : "The relationship is platonic.",
    "Use British English. Write original content; do not copy existing fictional characters.",
  ].join(" ");
}
function hint(f: GenField) { return f.startsWith("a.") ? A_HINT[f.slice(2) as AKey] : f.startsWith("l.") ? L_HINT[f] : CHAR_HINT[f]; }

function slotOthers(c: Character, f: GenField): { slot: Slot; text: string }[] {
  const s = slotOf(f); if (!s) return [];
  const a = appearanceOf(c);
  return SLOTS.filter((x) => x !== s.slot).map((x) => ({ slot: x, text: String(a[`${s.kind}${x}` as AKey] ?? "") })).filter((x) => x.text.trim());
}
export function buildFieldPrompt(c: Character, user: string, f: GenField, mustDiffer = false) {
  const s = slotOf(f);
  let ask = `Write ${hint(f)} for this character, consistent with everything above.${f === "baselineMood" ? ` Pick whichever fits their personality best; "${pick(MOODS)}" is just as valid as any other.` : avoidLine(f)}`;
  if (s) {
    const others = slotOthers(c, f);
    ask = `Write ONE ${s.kind === "outfit" ? "outfit" : "setting"} for the ${SLOT_GUIDE[s.kind][s.slot]}. Keep it wholesome and in their style. Write it as image-prompt style keywords: max 12 words, no full sentence, no name. A single string, not an object.` +
      (others.length ? ` Their other ${s.kind}s are: ${others.map((o) => `${o.slot.toLowerCase()}: "${o.text}"`).join("; ")}. This one must be clearly different from those.` : "") +
      (String(appearanceOf(c)[`${s.kind}${s.slot}` as AKey] ?? "").trim() ? ` Give a fresh alternative to the current one ("${appearanceOf(c)[`${s.kind}${s.slot}` as AKey]}").` : "") +
      (mustDiffer ? ` IMPORTANT: your previous answer was too similar to another time of day. It MUST differ: use different ${s.kind === "outfit" ? "garments, colours and fabrics" : "location and lighting"}.` : "");
  }
  return [
    { role: "system", content: `You help write characters for an instant-messenger chat app. Use only the character details given; ignore any real-world time or mood. ${rulesFor(c, user)} Reply with JSON only.` },
    { role: "user", content: `Character so far:\n${contextOf(c, user, f)}\n\n${ask} JSON: {"value": "..."}` },
  ];
}
const interpret = (f: GenField, raw: any) => cleanValue(f, raw && typeof raw === "object" && !Array.isArray(raw) && ("value" in raw || FIELD_LABEL(f) in raw) ? raw.value ?? raw[FIELD_LABEL(f)] : raw);
/** Is this slot value too close to one of the other time slots? */
export function clashes(c: Character, f: GenField, v: string) { return slotOthers(c, f).some((o) => similarity(o.text, v) >= TOO_SIMILAR); }
export async function generateField(c: Character, user: string, f: GenField): Promise<Character> {
  let v = interpret(f, parseJson(await callJson(c.model, buildFieldPrompt(c, user, f), tempFor(f), sampling())));
  if (slotOf(f) && (v === undefined || clashes(c, f, String(v)))) {
    const retry = interpret(f, parseJson(await callJson(c.model, buildFieldPrompt(c, user, f, true), 1.0, sampling())));
    if (retry !== undefined && (v === undefined || !clashes(c, f, String(retry)))) v = retry;
  }
  if (v === undefined) throw new Error("the model didn't return anything usable, try again");
  return setField(c, f, v);
}

// ---- whole character -----------------------------------------------------------
export const WHOLE: GenField[] = ["personalMessage", "personality", "backstory", "speakingStyle", "greeting", "exampleMessages", "baselineMood",
  ...(Object.keys(A_HINT) as AKey[]).map((k) => `a.${k}` as GenField)];
export function buildWholePrompt(idea: string, c: Character, user: string, avoidNames: string[] = []) {
  const angle = isShortIdea(idea) ? creativeAngle() : flavourAngle();
  const prevs = recent().byIdea[ideaKey(idea)] ?? [];
  const mood = pickMood();
  const keys = [...WHOLE.filter((f) => !slotOf(f)).map((f) => `"${FIELD_LABEL(f)}": ${hint(f)}`),
    `"outfits": {"day": casual/work daytime outfit, "evening": evening outfit, "night": pyjamas or loungewear} (three clearly different plain-text strings)`,
    `"places": {"day": daytime setting, "evening": evening setting, "night": night-time setting} (three clearly different plain-text strings)`].join(",\n");
  return [
    { role: "system", content: `You create varied, original characters for an instant-messenger chat app. Follow the user's idea exactly; be inventive only in details the idea leaves open. ${rulesFor(c, user)} Reply with JSON only.` },
    { role: "user", content: `Idea from ${user}: ${idea.trim() || "(surprise me)"}\n${idea.trim() ? `The idea is authoritative: age, job, studies and living situation in every field (especially the backstory) must match it exactly and must not contradict it.\n` : ""}${angle ? `Creative angle (use it${isShortIdea(idea) ? "" : " as flavour only; the idea wins if anything clashes"}): ${angle}.\n` : ""}${prevs.length ? `Earlier versions made from this same idea; make this one clearly different (different name, greeting, personal message, backstory events and personality slant):\n${prevs.map((p, i) => `${i + 1}. ${p.name}: "${p.pm}" / greeting "${p.greeting}" / backstory: ${p.gist}`).join("\n")}\n` : ""}${c.personality.trim() ? "" : `Suggested usual mood: ${mood} (use it unless the idea clearly contradicts it).\n`}${avoidText(avoidNames)}${c.name ? `Their name is ${c.name}.\n` : ""}Already decided (keep consistent):\n${contextOf(c, user)}\n\n` +
      `${idea.trim() ? `HARD FACTS (never contradict, especially in backstory and personality): ${idea.trim()}.\n` : ""}Return JSON with these keys:\n{"name": a first name${c.name ? " (use the given name)" : ""},\n"emoji": one emoji that suits them as an avatar,\n"color": a soft pastel hex colour like "#ffd27f",\n${keys}}` },
  ];
}
/** Applies a whole-character answer: fills empty fields only, unless `overwrite`. Age always stays 18+. */
export function applyWhole(c: Character, raw: any, overwrite: boolean): Character {
  let out = { ...c };
  if (!raw || typeof raw !== "object") return out;
  const name = clip(raw.name, 40);
  if (name && (overwrite || !c.name.trim())) out.name = name;
  const emoji = String(raw.emoji ?? "").trim();
  if (emoji && emoji.length <= 8 && !/[A-Za-z0-9]/.test(emoji) && (overwrite || !c.avatarPath)) out.avatar = emoji;
  if (/^#[0-9a-f]{6}$/i.test(String(raw.color ?? "").trim())) out.color = String(raw.color).trim().toLowerCase();
  const looksBlank = !hasLooks(appearanceOf(c));
  for (const [group, kind] of [["outfits", "outfit"], ["places", "place"]] as const) {
    const g = raw[group];
    if (g && typeof g === "object") for (const s of SLOTS) { const k = `${kind}${s}`; if (raw[k] === undefined) raw[k] = g[s.toLowerCase()] ?? g[s] ?? g[k]; }
  }
  for (const f of WHOLE) {
    const v = cleanValue(f, raw[FIELD_LABEL(f)]);
    if (v === undefined) continue;
    const empty = f === "a.age" ? looksBlank : f === "baselineMood" ? !c.personality.trim() : isEmpty(getField(out, f));
    if (overwrite || empty) out = setField(out, f, v);
  }
  return out;
}
export async function generateWhole(idea: string, c: Character, user: string, overwrite: boolean, rel?: RelType, takenNames: string[] = [], keep?: (GenField | "name")[]): Promise<Character> {
  // overwrite = regenerate from scratch: only hand-typed fields (keep) survive and are shown to the model
  let base = overwrite && keep ? scrub(c, keep) : c;
  if (rel && REL_OPTIONS.some((o) => o.id === rel)) {
    const o = REL_OPTIONS.find((x) => x.id === rel)!;
    base = { ...base, life: { ...lifeOf(base), relationship: rel, relationshipDetail: lifeOf(c).relationship === rel ? lifeOf(c).relationshipDetail : o.details?.[0] ?? "" } };
  }
  const taken = [...takenNames, ...recent().names];
  let raw: any;
  for (let i = 0; i < 3; i++) {
    raw = parseJson(await callJson(base.model, buildWholePrompt(idea, base, user, taken), 0.9, sampling()));
    if (base.name.trim() || !raw || typeof raw !== "object" || !nameTaken(String(raw.name ?? ""), takenNames)) break;
    taken.push(String(raw.name)); // duplicate of an existing contact: retry with it on the avoid list
  }
  if (!raw || typeof raw !== "object") throw new Error("the model didn't return a character, try again");
  let out = applyWhole(base, raw, overwrite);
  const age = ideaAge(idea);
  if (age && (overwrite || !keep?.includes("a.age"))) out = setField(out, "a.age", age);
  if (idea.trim() && out.backstory.trim()) out = await fitIdea(out, idea, user).catch(() => out);
  if (overwrite && keep) for (const k of keep) out = k === "name" ? { ...out, name: base.name } : setField(out, k, getField(base, k));
  // distinct times of day: regenerate any slot that repeats an earlier one
  for (const kind of ["outfit", "place"] as const) for (const s of SLOTS.slice(1)) {
    const f = `a.${kind}${s}` as GenField;
    const v = String(getField(out, f) ?? "");
    const earlier = SLOTS.slice(0, SLOTS.indexOf(s)).map((x) => String(getField(out, `a.${kind}${x}` as GenField) ?? ""));
    if (v && earlier.some((e) => similarity(e, v) >= TOO_SIMILAR) && (overwrite || getField(base, f) !== v)) out = await generateField(out, user, f).catch(() => out);
  }
  remember(out, idea);
  return out;
}
// ---- variety: random angles, sampling, anti-repetition history -------------------
let rand: () => number = Math.random;
export const setGenRandom = (f: () => number) => { rand = f; };
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length) % xs.length];
const CREATIVE = new Set<GenField>(["personalMessage", "personality", "backstory", "speakingStyle", "greeting", "exampleMessages", "l.nickname", "l.petName", "l.relationshipDetail"]);
export const tempFor = (f: GenField) => (f === "a.age" || f === "baselineMood" ? 0.6 : CREATIVE.has(f) || slotOf(f) ? 0.85 : 0.75);
export const sampling = () => ({ seed: Math.floor(rand() * 2147483647), topP: 0.95 });
export const ANGLES = {
  genre: ["slice of life", "light comedy", "quiet drama", "adventure", "mystery-loving", "sporty", "artsy", "techy", "outdoorsy", "glamorous city life", "small-town", "academic"],
  occupation: ["paramedic", "marine biologist", "tattoo artist", "train driver", "sommelier", "game developer", "physiotherapist", "florist", "air traffic controller", "stand-up comedian", "carpenter", "translator", "veterinary nurse", "architect", "DJ", "pastry chef", "firefighter", "museum curator", "personal trainer", "journalist", "pilot", "nurse", "software tester", "landscape gardener", "barber", "music teacher", "lifeguard", "mechanic", "lawyer", "photographer"],
  hobby: ["bouldering", "salsa dancing", "competitive chess", "astrophotography", "skateboarding", "pottery", "birdwatching", "kickboxing", "karaoke", "foraging", "restoring motorbikes", "open-water swimming", "board-game design", "street photography", "roller derby", "drumming", "cosplay", "trail running", "magic tricks", "urban sketching", "surfing", "beekeeping", "speedcubing", "amateur theatre"],
  temperament: ["blunt and witty", "bubbly and loud", "dry and sarcastic", "calm and philosophical", "competitive and driven", "shy but sharp", "chaotic and spontaneous", "dramatic", "deadpan", "fiercely loyal and protective", "nerdy and enthusiastic", "laid-back", "mischievous", "earnest and idealistic"],
  background: ["grew up on a farm", "moved from abroad", "big noisy family", "only child", "ex-military family", "grew up by the sea", "raised in a busy city", "former child actor", "career changer", "back home after years travelling", "first in the family at university", "grew up above the family shop"],
  quirk: ["uses lots of exclamation marks", "types in all lowercase", "rambles in long messages", "uses sports metaphors", "overuses one catchphrase", "corrects grammar playfully", "very short replies", "uses old-fashioned words", "quotes song lyrics", "lots of puns"],
  setting: ["seaside town", "busy city centre", "mountain village", "university town", "industrial city", "island", "suburb", "riverside flat", "countryside cottage", "high-rise apartment"],
} as const;
const isShortIdea = (idea: string) => idea.trim().split(/\s+/).filter(Boolean).length < 6;
/** A random mix of 4 angles from different categories, steering away from recent jobs/hobbies. */
export function creativeAngle(): string {
  const keys = Object.keys(ANGLES) as (keyof typeof ANGLES)[];
  const chosen = keys.map((k) => [rand(), k] as const).sort((a, b) => a[0] - b[0]).slice(0, 4).map(([, k]) => k);
  const h = recent();
  return chosen.map((k) => {
    const used = k === "occupation" ? h.occupations : k === "hobby" ? h.hobbies : [];
    const opts = ANGLES[k].filter((x) => !used.some((y) => y.toLowerCase() === x.toLowerCase()));
    return `${k}: ${pick(opts.length ? opts : ANGLES[k])}`;
  }).join("; ");
}
/** Usual mood: uniform over all moods, avoiding the last few picked. */
export function pickMood(): Mood {
  const used = recent().moods.slice(-3);
  const opts = MOODS.filter((m) => !used.includes(m));
  return pick(opts.length ? opts : MOODS);
}
export const nameTaken = (n: string, taken: string[]) => !!n.trim() && taken.some((t) => t.trim().toLowerCase() === n.trim().toLowerCase());

type Prev = { name: string; pm: string; greeting: string; gist: string };
type History = { names: string[]; occupations: string[]; hobbies: string[]; phrases: string[]; moods: Mood[]; byIdea: Record<string, Prev[]> };
export const ideaKey = (idea: string) => idea.trim().toLowerCase().replace(/\s+/g, " ");
/** Blank every whole-character field except the hand-typed ones in keep. */
export function scrub(c: Character, keep: (GenField | "name")[]): Character {
  const b = blankCharacter(); let out: Character = { ...c, name: keep.includes("name") ? c.name : "" };
  for (const f of WHOLE) if (!keep.includes(f)) out = setField(out, f, getField(b, f));
  return out;
}
/** Sub-angles that flavour a detailed idea without replacing it. */
export function flavourAngle(): string {
  const slant = ["more sarcastic", "warmer than they let on", "chaotic", "very competitive", "shy until comfortable", "dramatic", "deadpan", "hyper and talkative", "chill and unbothered", "nerdy and detail-obsessed", "mischievous", "secretly sentimental"];
  return `personality slant: ${pick(slant)}; quirk: ${pick(ANGLES.quirk)}; temperament: ${pick(ANGLES.temperament)}; detail to invent: a specific pet, routine, or side interest`;
}
const HKEY = "autogenHistory", HMAX = 12;
const emptyHistory = (): History => ({ names: [], occupations: [], hobbies: [], phrases: [], moods: [], byIdea: {} });
let memHistory: History = emptyHistory();
export function recent(): History {
  try { const s = globalThis.localStorage?.getItem(HKEY); if (s) return { ...emptyHistory(), ...JSON.parse(s) }; } catch { /* ignore */ }
  return memHistory;
}
export const resetGenHistory = () => { memHistory = emptyHistory(); try { globalThis.localStorage?.removeItem(HKEY); } catch { /* ignore */ } };
const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const OCC_RE = new RegExp(`\\b(${[...ANGLES.occupation, "baker", "barista", "librarian", "bookshop owner", "teacher", "student", "artist", "writer", "chef", "developer", "designer", "nurse"].map(escRx).join("|")})\\b`, "gi");
const HOB_RE = new RegExp(`\\b(${[...ANGLES.hobby, "reading", "baking", "knitting", "tea", "gardening", "painting", "hiking", "gaming", "yoga", "films", "books"].map(escRx).join("|")})\\b`, "gi");
/** Records what was just generated so the next generations steer away from it. */
export function remember(c: Character, idea = "") {
  const h = recent(); const add = (xs: string[], v: string[]) => [...xs.filter((x) => !v.includes(x)), ...v].slice(-HMAX);
  const text = `${c.personality} ${c.backstory}`;
  const uniq = (m: RegExpMatchArray | null) => [...new Set((m ?? []).map((x) => x.toLowerCase()))];
  const next: History = {
    names: add(h.names, c.name.trim() ? [c.name.trim()] : []),
    occupations: add(h.occupations, uniq(text.match(OCC_RE)).slice(0, 2)),
    hobbies: add(h.hobbies, uniq(text.match(HOB_RE)).slice(0, 3)),
    phrases: add(h.phrases, [c.personalMessage, c.greeting].map((x) => x.trim().slice(0, 60)).filter(Boolean)).slice(-8),
    moods: [...h.moods, c.baselineMood].slice(-HMAX) as Mood[],
    byIdea: { ...h.byIdea },
  };
  const k = ideaKey(idea);
  if (k) {
    next.byIdea[k] = [...(h.byIdea[k] ?? []), { name: c.name, pm: c.personalMessage.slice(0, 60), greeting: c.greeting.slice(0, 80), gist: c.backstory.split(/(?<=[.!?])\s/)[0].slice(0, 140) }].slice(-3);
    const keys = Object.keys(next.byIdea); for (const old of keys.slice(0, Math.max(0, keys.length - 20))) delete next.byIdea[old];
  }
  memHistory = next; try { globalThis.localStorage?.setItem(HKEY, JSON.stringify(next)); } catch { /* ignore */ }
}
function avoidText(names: string[]): string {
  const h = recent(); const n = [...new Set(names)];
  const parts = [n.length ? `names: ${n.join(", ")}` : "", h.occupations.length ? `jobs: ${h.occupations.join(", ")}` : "", h.hobbies.length ? `hobbies: ${h.hobbies.join(", ")}` : "",
    h.phrases.length ? `phrases: ${h.phrases.map((p) => `"${p}"`).join("; ")}` : ""].filter(Boolean);
  return parts.length ? `Recently used, do NOT reuse (pick something different): ${parts.join(" | ")}.\n` : "";
}
function avoidLine(f: GenField): string {
  const h = recent();
  return (f === "personalMessage" || f === "greeting" || f === "exampleMessages") && h.phrases.length ? ` Do not reuse these recent lines: ${h.phrases.slice(-6).map((p) => `"${p}"`).join("; ")}.` : "";
}
/** Age stated in the idea ("18 years old", "aged 24", "a 30 year old"), clamped to 18+. */
export function ideaAge(idea: string): number | undefined {
  const m = /\b(\d{2})\s*(?:-?\s*years?[- ]old|yo\b|y\/o)|\baged?\s*(\d{2})\b/i.exec(idea);
  const n = Number(m?.[1] ?? m?.[2]);
  return Number.isFinite(n) && n > 0 ? Math.max(MIN_AGE, Math.min(99, n)) : undefined;
}
/** Checks the backstory against the idea; rewrites it when it contradicts (e.g. university for a stay-at-home idea). */
export async function fitIdea(c: Character, idea: string, user: string): Promise<Character> {
  const age = appearanceOf(c).age;
  const msgs = [
    { role: "system", content: `You check character backstories against the user's idea. ${rulesFor(c, user)} Reply with JSON only.` },
    { role: "user", content: `Idea: ${idea}\nAge: ${age}\nBackstory: ${c.backstory}\n\nDoes the backstory contradict the idea or the age in any way (different age, a job/studies/commute when the idea says they stay at home, a different living situation, etc.)? If it does, rewrite it in 2-3 sentences so it matches the idea and age exactly, keeping its tone and any details that fit. JSON: {"contradicts": true|false, "backstory": "the fixed backstory, or empty if fine"}` },
  ];
  const r: any = parseJson(await callJson(c.model, msgs, 0.3, sampling()));
  const fixed = r && r.contradicts === true ? cleanValue("backstory", r.backstory) : undefined;
  return fixed ? { ...c, backstory: String(fixed) } : c;
}