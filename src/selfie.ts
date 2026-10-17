// Character selfies: intent detection, prompt building and image settings.
import { invoke } from "@tauri-apps/api/core";
import { api } from "./api";
import { parseJson } from "./mind";
import { appearanceOf, Appearance, Character, Mood, MIN_AGE } from "./types";
import { currentBlock, lifeOf } from "./lifecore";
import { adultFlag, allGiftsOf, giftsOf, isAdultItem, Item, selfieGift } from "./economy";
import { inferType, ITEM_TYPES, mentionsType, STALL_TYPES } from "./itemtypes";
import { storedAge } from "./afterdark";
import { isProtectedMinor, noPictureReason } from "./protect";
import { DEFAULT_PARAMS, EngineInfo, GenParams, ImageConfig, imageApi, ImageMeta, ImageSource, ModelFile } from "./imagegen";

export type Slot = "day" | "evening" | "night";
export function timeSlot(d = new Date()): Slot {
  const h = d.getHours();
  return h >= 5 && h < 17 ? "day" : h >= 17 && h < 22 ? "evening" : "night";
}
const MOOD_FACE: Record<Mood, string> = { happy: "bright happy smile", cosy: "soft relaxed smile", playful: "playful grin, cheeky expression",
  sad: "slightly sad gentle expression", annoyed: "unimpressed pout", sleepy: "sleepy eyes, drowsy smile", excited: "excited wide smile" };
const DEFAULT_OUTFIT: Record<Slot, string> = { day: "casual everyday clothes", evening: "comfy evening outfit", night: "cosy pyjamas" };
const DEFAULT_PLACE: Record<Slot, string> = { day: "", evening: "at home, warm lamp light", night: "in bed, dim bedside lamp" };
/** Always in the negative prompt: keeps every picture adult-only. */
export const ADULT_NEGATIVE = "child, kid, teen, teenager, minor, underage, loli, shota, young-looking, childlike, school uniform";

const clean = (s: string) => s.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();

// ---- gifts worn in selfies ------------------------------------------------------
const ALL_TYPES = [...new Set([...STALL_TYPES, ...Object.values(ITEM_TYPES).flat()])];
const LINGERIE = new Set(ITEM_TYPES.lingerie);
/** Concrete type of an owned item (stored items have no type column: inferred from name + plain description). */
export const typeOfItem = (it: Pick<Item, "name" | "description">) => inferType(it.name, it.description.split(/(?<=[.!?])\s/)[0] ?? "", ALL_TYPES) ?? inferType(it.name, it.description, ALL_TYPES);
const REF = /\b(wear(ing)?|in|put(ting)? on|try(ing)? on|model(ling)?|show me)\s+(it|that|this|them|those|the one|my gift|your gift|your new)\b|\bthe (one|thing|set|outfit|gift) i (gave|got|bought|sent) you\b|\b(my|your( new)?) (gift|present)\b|\bwhat i (gave|got|bought) you\b/i;
export const RECENT_GIFT_MS = 26 * 3600_000;
const significant = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !["with", "the", "and", "set", "your"].includes(w));
/** Which owned wearable the text is about: name, then item type, then "it/that/the one I gave you" -> latest wearable gift (~a day). */
export function resolveGift(text: string, items: Item[], now = Date.now()): Item | null {
  const t = text.toLowerCase();
  const wear = items.filter((i) => i.wearable).sort((a, b) => (b.giftedAt ?? 0) - (a.giftedAt ?? 0));
  if (!wear.length || !t.trim()) return null;
  const byName = wear.find((i) => t.includes(i.name.toLowerCase())) ?? wear.find((i) => { const w = significant(i.name); return w.length >= 2 && w.filter((x) => t.includes(x)).length >= 2; });
  if (byName) return byName;
  const byType = wear.find((i) => { const ty = typeOfItem(i); return !!ty && mentionsType(t, ty); });
  if (byType) return byType;
  if (REF.test(t)) return wear.find((i) => i.giftedAt && now - i.giftedAt < RECENT_GIFT_MS) ?? null;
  return null;
}
/** After Dark items need the adult switch and a saved age of 18+. */
export function giftAllowed(it: Item, c: Character, adultOn = adultFlag()): boolean {
  if (!isAdultItem(it)) return true;
  return adultOn && (storedAge(c) ?? 0) >= MIN_AGE;
}
/** Removes "wearing it"-style claims from a scene when the gift isn't in the picture. */
export const stripGiftClaims = (scene: string, it?: Item | null) => clean(scene.replace(REF, "").replace(/\bwearing\b[^,.]*/gi, "")
  .replace(it ? new RegExp(it.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") : /$^/, "")).replace(/^[,\s]+|[,\s]+$/g, "");
/** "red velvet bra & knicker set" from the plain first sentence, else the name + type. */
export function garmentText(it: Item): string {
  const type = typeOfItem(it) ?? "";
  const first = (it.description.split(/(?<=[.!?])\s/)[0] ?? "").replace(/^(an?|this is an?|the)\s+/i, "").replace(/[.!?]$/, "").trim();
  if (type && first && mentionsType(first, type) && first.length < 90) return first;
  return clean(`${it.name}${type && !mentionsType(it.name, type) ? ` ${type}` : ""}`);
}
export const isLingerie = (it: Item) => { const ty = typeOfItem(it); return !!ty && LINGERIE.has(ty) && isAdultItem(it); };

export interface SelfieOpts { wear?: Item | null; source?: ImageSource; }
/** v1.3: season / real-weather tag for outdoor shots (weather.ts); "" indoors or when off. */
let worldTag: (where: string, now: Date) => string = () => "";
export const setSelfieWorldTag = (f: (where: string, now: Date) => string) => { worldTag = f; };
export interface SelfiePrompt { prompt: string; negative: string; caption: string; outfit: string; place: string; adult: boolean; gift: string; }
/** Prompt for one selfie: looks + outfit/setting for the time of day + mood + what was asked. A worn gift replaces the outfit, near the start. */
export function buildSelfiePrompt(c: Character, request: string, now = new Date(), opts: SelfieOpts = {}): SelfiePrompt {
  if (isProtectedMinor(c)) throw new Error(`No picture: ${noPictureReason(c)}.`);
  const a = appearanceOf(c);
  const cur = currentBlock(lifeOf(c), now);
  const slot: Slot = cur?.block.status === "sleeping" ? "night" : timeSlot(now);
  const wear = opts.wear && giftAllowed(opts.wear, c) ? opts.wear : null;
  const lingerie = !!wear && isLingerie(wear);
  const schedOutfit = a[`outfit${slot[0].toUpperCase()}${slot.slice(1)}` as keyof Appearance] as string || DEFAULT_OUTFIT[slot];
  const place = a[`place${slot[0].toUpperCase()}${slot.slice(1)}` as keyof Appearance] as string || DEFAULT_PLACE[slot];
  const where0 = cur && cur.block.place && cur.block.status !== "sleeping" ? cur.block.place : place;
  const garment = wear ? garmentText(wear) : "";
  const outfit = wear ? garment : schedOutfit;
  const where = lingerie ? "tasteful boudoir photo, bedroom mirror selfie, soft warm lamp light, elegant bedroom" : where0;
  const age = Math.max(MIN_AGE, a.age);
  const scene = wear ? stripGiftClaims(request, wear) : clean(request);
  const pool = giftsOf(c.id).filter((i) => giftAllowed(i, c));
  const extraGift = wear ? "" : selfieGift(pool);
  const extraAdult = !!extraGift && pool.some((i) => isAdultItem(i) && extraGift.toLowerCase().includes(i.name.toLowerCase()));
  const parts = [
    lingerie ? "mirror selfie, holding phone, three-quarter body, looking at the camera" : "selfie, phone selfie, upper body, looking at the camera, arm's length shot",
    wear ? `(wearing ${garment}:1.3)` : "",
    `adult, ${age} year old`, a.body, a.face, a.features,
    lingerie ? "lingerie fully worn and fully covering, tasteful, elegant, non-explicit" : "",
    scene, MOOD_FACE[c.mood] ?? "", wear ? "" : `wearing ${outfit}`, extraGift, where,
    slot === "night" ? "night time, low light" : slot === "evening" ? "evening" : "daylight",
    lingerie ? "" : worldTag(where, now),
    a.style, a.extraTags,
  ];
  const prompt = parts.map((x) => clean(x ?? "")).filter(Boolean).join(", ");
  const negative = [ADULT_NEGATIVE, "nude, nudity, explicit, nsfw, exposed", "extra fingers, deformed hands, blurry, lowres, watermark, text", a.negativeTags].filter(Boolean).join(", ");
  // honest caption: only what is actually in the prompt
  const caption = wear ? clean(`wearing the ${wear.name}${lingerie ? ", mirror selfie in the bedroom" : where ? `, ${where}` : ""}${scene ? `, ${scene}` : ""}`)
    : clean([scene, `in ${extraGift ? extraGift.replace(/^wearing /, "") + " and " : ""}${schedOutfit}`, where].filter(Boolean).join(", "));
  return { prompt, negative, caption, outfit, place: where, adult: (!!wear && isAdultItem(wear)) || extraAdult, gift: wear?.name ?? "" };
}

export interface Intent { selfie: boolean; scene: string; }
export function buildIntentPrompt(charName: string, userName: string, text: string) {
  return [
    { role: "system", content: [
      `You classify one chat message that ${userName} sent to ${charName}.`,
      `Is ${userName} asking ${charName} to send a selfie, photo or picture of themselves right now (including indirect asks like "show me", "what are you wearing? pic?", "send a pic")?`,
      "Talking about photos in general, or asking about someone else's photo, is not a request.",
      'If it is a request, "scene" is a short English description of what the photo should show (pose, expression, activity, props), or "" if nothing specific.',
      'Respond only with JSON: {"selfie": true|false, "scene": "..."}',
    ].join("\n") },
    { role: "user", content: text },
  ];
}
export function interpretIntent(raw: unknown): Intent {
  const v = (raw ?? {}) as { selfie?: unknown; scene?: unknown };
  const selfie = v.selfie === true || v.selfie === "true";
  return { selfie, scene: selfie && typeof v.scene === "string" ? v.scene.slice(0, 160) : "" };
}
export async function detectSelfie(c: Character, userName: string, text: string): Promise<Intent> {
  if (text.trim().length < 3 || text.length > 600) return { selfie: false, scene: "" };
  const raw = await api.ollamaJson(c.model, buildIntentPrompt(c.name, userName, text));
  return interpretIntent(parseJson(raw));
}

/** Image parameters for this character, or why pictures aren't possible yet. `place` = a picture with no people in it (place backgrounds, place-only scene photos). */
export async function selfieSetup(c: Character, purpose: "person" | "place" = "person"): Promise<{ params: GenParams } | { reason: string }> {
  if (purpose === "person" && isProtectedMinor(c)) return { reason: noPictureReason(c) };
  let cfg: ImageConfig, info: EngineInfo, files: ModelFile[];
  try { [cfg, info] = await Promise.all([imageApi.getConfig(), imageApi.engineInfo()]); files = await imageApi.scan(cfg.extraFolders); }
  catch (e) { return { reason: `Image Studio isn't available (${e})` }; }
  if (!info.ok) return { reason: "the image engine isn't set up" };
  const a = appearanceOf(c);
  const model = [a.imageModel, cfg.last?.model].find((m) => m && files.some((f) => f.path === m && f.kind === "model"));
  if (!model) return { reason: "no image model is chosen" };
  const file = files.find((f) => f.path === model);
  if (file?.note.includes("can't load")) return { reason: `${file.name} can't be used by the engine` };
  const base = { ...DEFAULT_PARAMS, ...(cfg.last?.model === model ? cfg.last : {}), ...(cfg.presets[model] ?? {}) };
  const loras = a.lora && files.some((f) => f.path === a.lora) ? [{ path: a.lora, strength: a.loraStrength }] : [];
  const portrait = base.width >= 1024 || base.height >= 1024 ? { width: 832, height: 1216 } : { width: 512, height: 768 };
  return { params: { ...base, model, loras, seed: a.seed >= 0 ? a.seed : -1, batch: 1, ...portrait, prompt: "", negative: base.negative } };
}

const metaFor = (c: Character, p: SelfiePrompt, opts: SelfieOpts): ImageMeta => ({ source: opts.source ?? "selfie", characterId: c.id, gift: p.gift, adult: p.adult });
export function withPrompt(params: GenParams, c: Character, scene: string, now = new Date(), opts: SelfieOpts = {}): GenParams {
  const p = buildSelfiePrompt(c, scene, now, opts);
  return { ...params, prompt: p.prompt, negative: [p.negative, params.negative].filter(Boolean).join(", "), meta: metaFor(c, p, opts) };
}
/** Selfie params + honest caption, for the chat flow. */
export function selfieShot(params: GenParams, c: Character, scene: string, opts: SelfieOpts = {}, now = new Date()) {
  const p = buildSelfiePrompt(c, scene, now, opts);
  return { params: { ...params, prompt: p.prompt, negative: [p.negative, params.negative].filter(Boolean).join(", "), meta: metaFor(c, p, opts) }, caption: p.caption, built: p };
}
/** What a selfie request means for gifts: which item, and whether it may be worn in the picture. */
export interface GiftShot { item: Item | null; allowed: boolean; }
export function giftForSelfie(c: Character, texts: string[], now = Date.now()): GiftShot {
  const item = resolveGift(texts.join(" \n "), allGiftsOf(c.id), now);
  return { item, allowed: !!item && giftAllowed(item, c) };
}

/** System note for the reply that goes with a selfie request. */
export function selfieNote(userName: string, ok: boolean, gift?: GiftShot): string {
  if (ok && gift?.item && gift.allowed) return `${userName} asked for a selfie of you wearing the ${gift.item.name} they gave you. You're putting it on and taking the photo right now; it will be sent right after your message. Reply briefly and naturally in character${isAdultItem(gift.item) ? " (flirty or shy is fine, never explicit)" : ""}, don't describe the photo in detail.`;
  if (ok && gift?.item && !gift.allowed) return `${userName} asked for a selfie of you wearing the ${gift.item.name}, but you won't send that kind of photo. Decline playfully and kindly in character; you'll send an ordinary selfie instead. Do NOT say you are wearing it.`;
  return ok
    ? `${userName} asked you for a selfie. You're taking one right now and it will be sent right after your message. Reply briefly and naturally in character (e.g. teasing, posing, "hang on"), and don't describe the photo in detail.`
    : `${userName} asked you for a selfie, but your phone camera isn't working right now. Reply briefly in character, apologise playfully and say you'll send one later.`;
}
/** One line per selfie in data\\logs\\selfie.log: who, which gift (and whether it was allowed), the prompt. */
export async function logSelfie(c: Character, p: SelfiePrompt, gift?: GiftShot): Promise<void> {
  const g = gift?.item ? `${gift.item.name} (#${gift.item.id}${isAdultItem(gift.item) ? ", 18+" : ""}) ${gift.allowed ? "WORN" : "BLOCKED"}` : "none";
  await invoke("selfie_log", { line: `${new Date().toISOString()} | ${c.name} | gift: ${g} | caption: ${p.caption} | prompt: ${p.prompt} | negative: ${p.negative}` });
}
