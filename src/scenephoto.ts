// Together part 3 (together3): place backgrounds, scene photos (character-only and pair) and in-person gifts.
// Pure helpers only (no I/O), tested by scripts/test-together.mjs. All pictures keep the adult-only safeguards.
import { appearanceOf, MIN_AGE } from "./types";
import type { Character } from "./types";
import { isFamily, isRomantic, lifeOf } from "./lifecore";
import { ADULT_NEGATIVE, buildSelfiePrompt, garmentText, giftAllowed, isLingerie, timeSlot } from "./selfie";
import type { GiftShot } from "./selfie";
import { adultFlag, isAdultItem } from "./economy";
import type { Item } from "./economy";
import type { Slot } from "./selfie";
import type { GenParams } from "./imagegen";
import { findPlace, placeFromText } from "./places";
import type { SceneCard } from "./places";

const clean = (s: string) => s.replace(/[<>()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "somewhere";

// ---- place backgrounds ---------------------------------------------------------------
export const PLACE_BGS_KEY = "place_bgs";
export const SCENE_BG_ON_KEY = "scene_backgrounds";
export interface PlaceBg { path: string; prompt: string; createdAt: number; }
/** Cache key per place and time-of-day variant: "cafe:day", "custom:canal-picnic:night". */
export function placeBgKey(placeId: string | undefined, place: string, slot: Slot): string {
  const p = placeId === "other" ? null : findPlace(placeId) ?? placeFromText(place); // "Somewhere else" always gets its own picture
  return `${p ? p.id : `custom:${slug(place)}`}:${slot}`;
}
const LIGHT: Record<Slot, string> = { day: "soft natural daylight", evening: "warm golden evening light, lamps glowing", night: "night time, soft ambient lights, moody" };
const PEOPLE_NEG = "people, person, man, woman, girl, boy, crowd, figure, character, face, portrait, hands";
/** Landscape, empty background (no people) for a place and time of day. */
export function placeBgPrompt(placeId: string | undefined, place: string, slot: Slot): { prompt: string; negative: string } {
  const p = findPlace(placeId) ?? placeFromText(place);
  const what = p ? `${p.name.toLowerCase()}${place && place.toLowerCase() !== p.name.toLowerCase() ? `, ${clean(place)}` : ""}` : clean(place) || "a cosy place";
  const prompt = ["scenic background illustration, empty scene, no people", what, p?.ambience ?? "", LIGHT[slot], "wide shot, landscape, atmospheric, highly detailed, soft focus"]
    .map(clean).filter(Boolean).join(", ");
  return { prompt, negative: [PEOPLE_NEG, ADULT_NEGATIVE, "nude, nsfw, explicit, text, watermark, logo, blurry, lowres"].join(", ") };
}
/** Landscape size matching the model family (SDXL-size vs SD1.5-size presets). */
export const bgSize = (p: Pick<GenParams, "width" | "height">) => p.width >= 1024 || p.height >= 1024 ? { width: 1216, height: 832 } : { width: 768, height: 512 };
export function placeBgParams(base: GenParams, placeId: string | undefined, place: string, slot: Slot): GenParams {
  const b = placeBgPrompt(placeId, place, slot);
  return { ...base, ...bgSize(base), loras: [], seed: -1, batch: 1, prompt: b.prompt, negative: [b.negative, base.negative].filter(Boolean).join(", "), meta: { source: "place", adult: false } };
}
/** Fallback when there's no image engine: a soft gradient stable per place. */
export function bgGradient(key: string): string {
  let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = h % 360, b = (a + 40 + (h >> 9) % 60) % 360;
  return `linear-gradient(135deg, hsla(${a}, 45%, 55%, .28), hsla(${b}, 50%, 45%, .22))`;
}
export const slotNow = (d = new Date()) => timeSlot(d);

// ---- scene photos --------------------------------------------------------------------
/** "take a photo of us", "selfie of us here", "can you take a picture of me?"... during a scene. */
export function detectScenePhoto(text: string): { pair: boolean } | null {
  const t = text.toLowerCase();
  if (t.length > 300) return null;
  const ask = /\b(take|snap|grab|get|let'?s (take|do|get)|can (we|you)|could (we|you)|how about)\b[^.?!]{0,40}\b(photo|picture|pic|selfie|snapshot)\b/.test(t) || /\b(selfie|photo|picture|pic)\b (of|with) us\b/.test(t);
  if (!ask) return null;
  return { pair: /\b(of us|with us|both of us|the two of us|us here|together|with me|you and me|me and you)\b/.test(t) };
}
export function photoPose(c: Pick<Character, "life" | "closeness">): string {
  const r = lifeOf(c).relationship;
  if (isFamily(r)) return "platonic family photo, standing side by side, warm friendly smiles, wholesome, no romance";
  if (isRomantic(r) && c.closeness >= 40) return "couple photo, standing close together, affectionate, arm around each other, happy smiles";
  return "friends photo, side by side, casual friendly pose, happy smiles";
}
/** Shaped like SelfiePrompt so logSelfie() can write it to selfie.log. */
export interface ScenePhoto { prompt: string; negative: string; caption: string; pair: boolean; outfit: string; place: string; adult: boolean; gift: string;
  /** The asked-for gift is worn in the picture. */ worn: boolean;
  /** Why an asked-for gift isn't worn: "rules" (18+ off, age not saved 18+, family) or "public" (lingerie outside a private place). */ declined: "" | "rules" | "public"; }
export const PRIVATE_PLACES = ["their_place", "your_place"];
/** Selfie rules for wearing a gift in a scene photo, plus: never After Dark items with family. */
export function wearAllowed(it: Item, c: Character, adultOn = adultFlag()): boolean {
  if (!isAdultItem(it)) return true;
  return giftAllowed(it, c, adultOn) && !isFamily(lifeOf(c).relationship);
}
/**
 * Prompt for a photo during a scene: place, time of day, weather, outfit. Pair photos add Alex's opt-in description.
 * A gifted item (resolved with the selfie rules) is worn when allowed; lingerie only in a private place, tastefully framed.
 * Always adult-only and never nude/explicit.
 */
export function scenePhotoPrompt(c: Character, card: SceneCard & { placeId?: string }, pair: boolean, look: string, now = new Date(), gift?: GiftShot, adultOn = adultFlag()): ScenePhoto {
  const a = appearanceOf(c);
  const age = Math.max(MIN_AGE, a.age);
  const outfit0 = buildSelfiePrompt(c, "", now).outfit; // schedule outfit
  const me = clean(look).slice(0, 200);
  const both = pair && !!me;
  const family = isFamily(lifeOf(c).relationship);
  const item = gift?.item ?? null;
  const ok = !!item && wearAllowed(item, c, adultOn);
  const lingerie = ok && isLingerie(item!);
  const priv = PRIVATE_PLACES.includes(card.placeId ?? "") || /\b(their|your|my) place\b|\bhome\b|\bbedroom\b/i.test(card.place);
  const declined: ScenePhoto["declined"] = !item ? "" : !ok ? "rules" : lingerie && !priv ? "public" : "";
  const worn = ok && !declined;
  const garment = worn ? garmentText(item!) : "";
  const outfit = worn ? garment : outfit0;
  const pose = both ? (lingerie && worn && !family ? "intimate couple photo, close together, tasteful, elegant" : photoPose(c)) : "";
  const parts = both
    ? ["photo of two adults together", pose, worn ? `(wearing ${garment}:1.3)` : "", `adult ${age} year old ${a.body}`, a.face, a.features, worn ? "" : `wearing ${outfit}`, `next to an adult: ${me}`]
    : [lingerie && worn ? "tasteful boudoir photo, three-quarter body, looking at the camera" : "candid photo, upper body, looking at the camera", worn ? `(wearing ${garment}:1.3)` : "",
       `adult, ${age} year old`, a.body, a.face, a.features, worn ? "" : `wearing ${outfit}`, "smiling"];
  if (lingerie && worn) parts.push("lingerie fully worn and fully covering, tasteful, elegant, non-explicit, soft warm lamp light");
  parts.push(`at the ${card.place.toLowerCase()}`, card.tod === "night" || card.tod === "late night" ? "night time, low light" : card.tod === "evening" ? "evening light" : "daylight",
    card.outdoor ? card.weather.replace(/^\S+\s/, "").replace(/,\s*-?\d+\u00B0C/, "") : "", a.style, a.extraTags);
  const prompt = parts.map((x) => clean(x ?? "")).filter(Boolean).join(", ");
  const negative = [ADULT_NEGATIVE, "nude, nudity, explicit, nsfw, exposed", lingerie && worn ? "" : "lingerie, underwear, cleavage",
    both ? "three people, crowd" : "extra people, crowd, second person", "extra fingers, deformed hands, blurry, lowres, watermark, text", a.negativeTags].filter(Boolean).join(", ");
  // honest caption: only what is in the picture
  const caption = `\u{1F4F8} ${both ? `You and ${c.name}` : c.name} at the ${card.place}${worn ? `, wearing the ${item!.name}` : ""}`;
  return { prompt, negative, caption, pair: both, outfit, place: card.place, adult: worn && isAdultItem(item!), gift: item?.name ?? "", worn, declined };
}
export function scenePhotoParams(base: GenParams, c: Character, p: ScenePhoto): GenParams {
  const size = p.pair ? bgSize(base) : { width: base.width, height: base.height };
  return { ...base, ...size, prompt: p.prompt, negative: [p.negative, base.negative].filter(Boolean).join(", "), meta: { source: "scene", characterId: c.id, gift: p.worn ? p.gift : "", adult: p.adult } };
}
/** Note for the reply that goes with a scene photo (mirrors selfieNote). */
export function photoNote(user: string, pair: boolean, shot?: Pick<ScenePhoto, "worn" | "declined" | "gift" | "adult">): string {
  const who = pair ? "a photo of the two of you together" : "a photo of you here";
  if (shot?.declined === "rules") return `(${user} asked for ${who} with you wearing the ${shot.gift}, but you won't do that kind of photo. Decline playfully and kindly in character; you'll pose for an ordinary photo instead. Do NOT say you are wearing it. React in person with an *action*.)`;
  if (shot?.declined === "public") return `(${user} asked for ${who} with you wearing the ${shot.gift}, but you're out in public. Laugh it off playfully and suggest saving that for somewhere private (your place or theirs); you pose for an ordinary photo instead. Do NOT say you are wearing it. React in person with an *action*.)`;
  if (shot?.worn) return `(${user} asked for ${who} with you wearing the ${shot.gift} they gave you. You're wearing it for the photo right now; it appears right after your message. React briefly in person with an *action*${shot.adult ? " (flirty or shy is fine, never explicit)" : ""}.)`;
  return pair
    ? `(${user} asked for a photo of the two of you together. You're taking it right now; it appears right after your message. React briefly in person with an *action*, e.g. leaning in close for the shot.)`
    : `(${user} wants a photo of you here. You're posing for it right now; it appears right after your message. React briefly in person with an *action*.)`;
}

// ---- in-person gifts -----------------------------------------------------------------
export const IN_PERSON = " (in person)";
export const isInPerson = (content: string) => content.endsWith(IN_PERSON);
/** Rare, closeness-scaled chance per reply that the character hands Alex something in person (once per scene). */
export function inPersonGiftChance(c: Pick<Character, "closeness">): number {
  return c.closeness < 50 ? 0 : Math.min(0.08, 0.02 + ((c.closeness - 50) / 50) * 0.06);
}
export const inPersonGiveNote = (user: string, name: string) => `You're together in person: ${user} is physically handing it to you right now. React physically with an *action* (taking it, opening it, hugging) and a line of speech.`;
