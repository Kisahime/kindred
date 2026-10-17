// 🌙 After Dark (18+): opt-in adult shop. Hidden unless "Show adult (18+) content" is on (confirmed 18+). Tasteful, non-graphic only.
import { appearanceOf, Character } from "./types";
import { isFamily, isRomantic, lifeOf } from "./lifecore";
import { econApi, isAdultItem, JsonFn, setAdultFlag } from "./economy";
import { MallItem, tierPrice, weekKey } from "./mall";
import { parseJson } from "./mind";
import { toText } from "./text";
import { isProtectedMinor } from "./protect";
import { listFor, typeItem, typeRules, typesFor } from "./itemtypes";

export const ADULT_TAG = "18+";
export const ADULT_DEPTS = [
  { id: "lingerie", label: "Lingerie & Loungewear", emoji: "\u{1FA71}" },
  { id: "toys", label: "Toys for Grown-ups", emoji: "\u{1F49C}" },
  { id: "massage", label: "Massage & Bath", emoji: "\u{1F56F}\uFE0F" },
  { id: "accessories", label: "Intimate Accessories", emoji: "\u{1F380}" },
  { id: "games", label: "Games & Romance", emoji: "\u{1F3B2}" },
] as const;
export type AdultDept = typeof ADULT_DEPTS[number]["id"];
const RAW: Record<AdultDept, string> = {
  lingerie: `
🩱|Lace bodysuit|Delicate black lace, made to be admired|3|w
👙|Silk lingerie set|Champagne silk with a satin bow|3|w
👙|Red lace set|Classic, bold and confident|2|w
👙|Pastel bralette set|Soft, sweet and comfy|2|w
🩲|Lace briefs trio|Three shades of pretty|1|w
👘|Satin kimono robe|Short, silky, slips off the shoulder|2|w
👗|Silk slip nightdress|Bias-cut and barely-there|3|w
👗|Babydoll chemise|Sheer chiffon with a ribbon tie|2|w
🧦|Lace-top stockings|Sheer with a lace band|1|w
🎀|Suspender belt|Vintage style, adjustable|1|w
🩱|Velvet teddy|Plush velvet in deep wine|3|w
👘|Feather-trim robe|Old-Hollywood glamour|3|w
👙|Mesh balconette set|Sheer panels, strong silhouette|2|w
🩱|Corset top|Boned satin, ribbon lacing|3|w
👚|Oversized silk shirt|Theirs, borrowed for the night|2|w
🩳|Satin pyjama shorts set|Cami and shorts in blush|2|w
🖤|Strappy harness bralette|Elegant straps, modern edge|2|w
👠|Feathered mules|Kitten heels with marabou|2|w`,
  toys: `
💜|Personal massager|Discreet, whisper-quiet, rechargeable|3
💗|Couples' massager|Designed to be shared|4
🌸|Mini bullet|Small, pretty and travel-friendly|1
🌹|Rose-shaped massager|Looks like a flower, feels like a secret|3
🔮|Wand massager|A cult favourite, many settings|3
📱|App-controlled toy|Hand the remote to someone else|4
🪶|Feather tickler|Light, teasing and playful|1
💫|Warming massage stone|Smooth, heats in warm water|1
🎁|Discovery toy kit|Four beginner-friendly pieces|3
💞|Couples' ring|Shared fun, gentle buzz|2
🌙|Silicone massager|Soft-touch, waterproof|2
✨|Luxury gold-finish massager|Weighted, elegant, indulgent|4`,
  massage: `
🧴|Massage oil|Warm vanilla and sandalwood|1
🧴|Edible massage oil|Strawberry, sweet to taste|1
🕯️|Massage candle|Melts into warm skin-safe oil|2
🛁|Bath for two|Rose petals and bubbles|1
🌹|Rose petal pack|Silk petals for the bed|1
🫧|Silky bath oil|Jasmine and amber|1
🖐️|Massage roller|Smooth wooden beads|1
💆|Couples' massage class|One evening, two of you|3
🕯️|Candle trio "After Dark"|Oud, fig and black cherry|2
🧖|Spa night for two|Robes, oils and candles|3
💧|Silk-touch lubricant|Water-based, gentle|1
🍓|Chocolate body paint|With a little brush|1
🌙|Pillow mist "Midnight"|Musky and warm|1
🧴|Warming lotion|A gentle tingle|1`,
  accessories: `
🖤|Silk blindfold|Soft black silk, padded|1
🎀|Satin ribbon ties|Long, soft and pretty|1
⛓️|Fluffy handcuffs|Playful pink fur|1
🖤|Leather cuffs|Soft-lined, adjustable|2
🎭|Lace masquerade mask|Mystery for a night|1
🪶|Feather boa|Glamorous and silly|1
💋|Kiss-print bedsheets|Red lips on white satin|2
🛏️|Satin sheet set|Cool, smooth, decadent|3
🔔|Bell choker|Velvet with a tiny bell|1|w
🖤|Lace choker|Delicate and dark|1|w
🪢|Silk restraint set|Gentle, beginner-friendly|2
🗝️|Locked keepsake box|For private things|2
💄|Long-wear lipstick|Stays put through anything|1
🌹|Garter|Lace with a rose|1|w`,
  games: `
🎲|Couples' dice|Roll for a little dare|1
🃏|Flirty card game|Truth, dare and kisses|1
📜|Love coupons|Redeemable, cheeky|1
🎟️|Date-night scratch cards|Surprise ideas for two|1
📖|Sensual poetry book|Tasteful and tender|1
🎬|Romantic film night box|Film, snacks, blanket|2
🍾|Champagne & strawberries|For a special night|2
🏨|Boutique hotel night|A room with a big bath|4
🎟️|Burlesque show tickets|Two seats, front row|3
📝|Fantasy journal|Write them down together|1
🍫|Aphrodisiac chocolates|Chilli, rose and salt|2
💌|Steamy letter set|Scented paper, wax seal|1`,
};
export function parseAdult(): MallItem[] {
  const out: MallItem[] = [];
  for (const [dept, text] of Object.entries(RAW)) for (const line of text.split("\n")) {
    const p = line.split("|").map((x) => x.trim());
    if (p.length < 4 || !p[1]) continue;
    const tier = Math.min(4, Math.max(1, Number(p[3]) || 1)) as MallItem["tier"];
    out.push({ sku: `ad-${dept}:${p[1].toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, dept, emoji: p[0], name: p[1], description: p[2], tier,
      price: tierPrice(p[1], tier), tags: [ADULT_TAG, "romantic"], wearable: p[4] === "w" });
  }
  return out;
}
export const ADULT_CATALOG = parseAdult();

// ---- the opt-in setting (kv "adult_content") --------------------------------------
export interface AdultSetting { enabled: boolean; confirmed18: boolean; at: number; }
export async function loadAdult(): Promise<AdultSetting> {
  const v = await econApi.kvGet<AdultSetting>("adult_content").catch(() => null);
  const s = { enabled: false, confirmed18: false, at: 0, ...(v ?? {}) };
  s.enabled = s.enabled && s.confirmed18;
  setAdultFlag(s.enabled);
  return s;
}
/** Turning on requires the 18+ confirmation (asked by the caller). */
export async function saveAdult(enabled: boolean, confirmed18: boolean): Promise<AdultSetting> {
  if (enabled && !confirmed18) throw new Error("Please confirm you are 18 or older.");
  const s = { enabled, confirmed18, at: Date.now() };
  await econApi.kvSet("adult_content", s);
  setAdultFlag(enabled);
  return s;
}

// ---- gifting rules ----------------------------------------------------------------
/** Stored age (not the 25 default fill-in): unknown when missing. */
export function storedAge(c: Character): number | null {
  const raw = (c.appearance as unknown as Record<string, unknown> | undefined)?.age;
  const n = Number(raw);
  return raw === undefined || raw === null || raw === "" || !Number.isFinite(n) ? null : n;
}
export interface AdultCheck { ok: boolean; reason: string; warning: string; }
export function adultGiftCheck(c: Character, enabled: boolean): AdultCheck {
  const rel = lifeOf(c).relationship;
  if (isProtectedMinor(c)) return { ok: false, reason: `${c.name} is under 18 and protected. After Dark gifts can never go to them.`, warning: "" };
  if (!enabled) return { ok: false, reason: "Adult (18+) content is switched off in Options.", warning: "" };
  if (isFamily(rel)) return { ok: false, reason: `${c.name} is family. After Dark gifts can never go to family.`, warning: "" };
  const age = storedAge(c);
  if (age === null) return { ok: false, reason: `${c.name} has no age set. Set an adult age (18+) in their editor (Appearance) first.`, warning: "" };
  if (age < 18) return { ok: false, reason: `${c.name} must be 18 or older.`, warning: "" };
  const warning = !isRomantic(rel) && c.closeness < 70 ? `You and ${c.name} aren't together and not very close yet, so this might be too forward. They may turn it down.` : "";
  return { ok: true, reason: "", warning };
}
export const adultGiftNote = (c: Character, userName: string) =>
  `This is an intimate, grown-up gift. React fully in character as the adult you are (${appearanceOf(c).age}): you may be flattered, flirty, shy, amused or politely decline if it doesn't suit you or your relationship with ${userName}. Keep it suggestive at most; never explicit or graphic.`;
export const isAdult = isAdultItem;

// ---- weekly Ollama items (same tasteful rules) ----------------------------------------
export function buildAdultPrompt(recent: string[] = []) {
  return [
    { role: "system", content: [
      "You stock 'After Dark', a tasteful 18+ boutique for adults in a cosy messenger game (like a classy lingerie and wellness shop).",
      `Invent 4 new items for these departments: ${ADULT_DEPTS.map((d) => d.id).join(", ")}.`,
      "Descriptions must be tasteful, playful and NON-GRAPHIC: no explicit sexual acts, body parts or crude words. Nothing involving minors, school or youthful themes, non-consent or anything illegal.",
      "Each item: name (max 5 words), item_type, colour, material, description (max 20 words), dept (one of the ids), tier 1-4, wearable (true only for lingerie/clothing/jewellery).",
      typeRules(` for its department:\n${listFor([...ADULT_DEPTS], true)}\n`),
      recent.length ? `Avoid these existing items: ${recent.slice(0, 40).join(", ")}.` : "",
      'Respond only with JSON: {"items": [{"name": "...", "item_type": "...", "colour": "...", "material": "...", "description": "...", "dept": "lingerie", "tier": 2, "wearable": true}]}',
    ].filter(Boolean).join("\n") },
    { role: "user", content: "This week's new After Dark items." },
  ];
}
const BANNED = /\b(child|kid|teen|minor|young|school|student|underage|girl|boy|loli|daddy|incest|forced|rape|drug)/i;
export function normalizeAdult(raw: unknown, week: string): MallItem[] {
  const list = Array.isArray((raw as { items?: unknown })?.items) ? (raw as { items: Record<string, unknown>[] }).items : [];
  const out: MallItem[] = [];
  for (const r of list.slice(0, 6)) {
    const rawName = toText(r?.name).replace(/["*]/g, "").slice(0, 40), rawDesc = toText(r?.description).slice(0, 140);
    if (!rawName || BANNED.test(`${rawName} ${rawDesc}`)) continue;
    const dept = ADULT_DEPTS.find((d) => d.id === String(r.dept).toLowerCase())?.id
      ?? ADULT_DEPTS.find((d) => typeItem(r ?? {}, rawName, rawDesc, typesFor(d.id, true)))?.id ?? "accessories";
    const typed = typeItem(r ?? {}, rawName, rawDesc, typesFor(dept, true));
    if (!typed || BANNED.test(`${typed.name} ${typed.description}`)) continue;
    const name = typed.name, description = typed.description;
    if (out.some((x) => x.name.toLowerCase() === name.toLowerCase()) || ADULT_CATALOG.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
    const tier = Math.min(4, Math.max(1, Math.round(Number(r.tier)) || 1)) as MallItem["tier"];
    out.push({ sku: `ad-new-${week}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, dept, name, description, tier, price: tierPrice(name, tier),
      emoji: typed.emoji, itemType: typed.itemType, tags: [ADULT_TAG, "romantic"], wearable: r.wearable === true || r.wearable === "true" });
  }
  return out;
}
export async function weeklyAdult(model: string, json: JsonFn | null, week = weekKey()): Promise<MallItem[]> {
  const have = await econApi.kvGet<MallItem[]>(`afterdark_week_${week}`);
  if (have || !json) return have ?? [];
  let items: MallItem[] = [];
  for (let i = 0; i < 2 && items.length < 3; i++) items = normalizeAdult(parseJson(await json(model, buildAdultPrompt(ADULT_CATALOG.map((i) => i.name)), 0.9)), week);
  if (items.length) await econApi.kvSet(`afterdark_week_${week}`, items);
  return items;
}
