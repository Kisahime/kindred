// Concrete item types for generated shop items: allowed per department, emoji from the type, plain names and descriptions.
const L = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
export const ITEM_TYPES: Record<string, string[]> = {
  clothing: L("jumper, cardigan, hoodie, t-shirt, shirt, blouse, dress, skirt, jeans, trousers, joggers, shorts, coat, jacket, scarf, gloves, mittens, hat, beanie, cap, socks, boots, trainers, shoes, slippers, handbag, backpack, belt, sunglasses, pyjamas, dressing gown"),
  tech: L("headphones, speaker, keyboard, mouse, games console, video game, camera, phone case, charger, power bank, lamp, smart bulb, alarm clock, smartwatch, tablet, e-reader, projector, radio, gadget kit"),
  home: L("candle, cushion, blanket, throw, mug, teapot, vase, lamp, mirror, art print, rug, clock, diffuser, plant pot, bedding set, tableware set, kitchen utensil, ornament, storage box, fairy lights"),
  books: L("novel, book, cookbook, notebook, journal, planner, pen, pencil set, stationery set, bookmark, art supplies, puzzle book, comic, notecards"),
  beauty: L("bath bomb, bath oil, soap, hand cream, body lotion, face mask, perfume, lip balm, lipstick, nail polish, hair accessory, scented candle, spa set, skincare set, hairbrush"),
  food: L("chocolates, sweets, biscuits, cake, pastries, tea, coffee, hamper, snack box, jam, honey, sauce, drink, scones, cookies"),
  flowers: L("bouquet, house plant, cactus, succulent, seeds, herb kit, terrarium, wreath, bonsai, flower bulbs, garland"),
  toys: L("plush toy, board game, card game, jigsaw puzzle, building set, figure, ball, kite, toy, craft toy"),
  hobbies: L("craft kit, paint set, knitting kit, yarn, musical instrument, guitar, ukulele, tickets, class, model kit, camping gear, sports gear"),
  jewellery: L("necklace, pendant, bracelet, ring, earrings, anklet, brooch, watch, choker, hair pin"),
  seasonal: L("ornament, decoration, wreath, garland, advent calendar, greeting card, candle, jumper, mug, scones, cake, chocolates, blanket, throw, hat, mittens, scarf, toy, lantern"),
  // After Dark (18+)
  lingerie: L("bra & knicker set, bralette, bodysuit, chemise, babydoll, robe, kimono robe, corset, bustier, suspender belt, stockings, garter, pyjama set, slip, teddy, harness-style lingerie, nightdress, camisole set, lounge set, knickers"),
  toys18: L("personal massager, couples' massager, bullet massager, wand massager, app-controlled massager, couples' ring, feather tickler, toy kit"),
  massage: L("massage oil, massage candle, bath oil, bath set, body lotion, lubricant, body paint, massage roller, pillow mist, rose petals, spa kit"),
  accessories: L("blindfold, eye mask, cuffs, restraint set, ribbon ties, masquerade mask, choker, sheet set, feather boa, garter, keepsake box"),
  games: L("dice, card game, love coupons, scratch cards, book, journal, gift box, tickets, voucher, chocolates"),
};
/** Character stalls can sell anything from the everyday departments. */
export const STALL_TYPES = [...new Set(["clothing", "tech", "home", "books", "beauty", "food", "flowers", "toys", "hobbies", "jewellery"].flatMap((d) => ITEM_TYPES[d]))];
/** After Dark "toys" share the id with Shopping Centre toys, so they use toys18. */
export const typesFor = (dept: string, adult = false) => adult && dept === "toys" ? ITEM_TYPES.toys18 : dept === "stall" ? STALL_TYPES : ITEM_TYPES[dept] ?? STALL_TYPES;

const EMOJI: [RegExp, string][] = [
  [/kimono|robe|dressing gown/, "\u{1F458}"], [/bra\b|bralette|knicker|bikini/, "\u{1F459}"], [/bodysuit|teddy|corset|bustier|swimsuit/, "\u{1FA71}"],
  [/chemise|slip|nightdress|babydoll|dress/, "\u{1F457}"], [/stocking|sock/, "\u{1F9E6}"], [/suspender|garter|ribbon|bow/, "\u{1F380}"], [/harness/, "\u{1F5A4}"],
  [/pyjama|lounge set|camisole|shorts/, "\u{1FA73}"], [/t-shirt|shirt|blouse/, "\u{1F455}"], [/jumper|cardigan|hoodie|coat|jacket/, "\u{1F9E5}"],
  [/scarf/, "\u{1F9E3}"], [/glove|mitten/, "\u{1F9E4}"], [/beanie|cap\b/, "\u{1F9E2}"], [/hat/, "\u{1F452}"], [/jeans|trousers|joggers/, "\u{1F456}"], [/skirt/, "\u{1F457}"],
  [/boots/, "\u{1F97E}"], [/trainers|shoes/, "\u{1F45F}"], [/slipper/, "\u{1F97F}"], [/handbag|backpack|bag/, "\u{1F45C}"], [/sunglasses|eye mask|blindfold/, "\u{1F576}\uFE0F"],
  [/headphone/, "\u{1F3A7}"], [/speaker|radio/, "\u{1F4FB}"], [/keyboard/, "\u2328\uFE0F"], [/mouse/, "\u{1F5B1}\uFE0F"], [/console|video game/, "\u{1F3AE}"], [/camera/, "\u{1F4F7}"],
  [/phone|charger|power bank/, "\u{1F4F1}"], [/lamp|bulb|lantern|fairy lights/, "\u{1F4A1}"], [/clock|watch/, "\u231A"], [/tablet|e-reader/, "\u{1F4F1}"], [/projector/, "\u{1F4FD}\uFE0F"],
  [/candle/, "\u{1F56F}\uFE0F"], [/cushion|blanket|throw|bedding|sheet/, "\u{1F6CF}\uFE0F"], [/mug|teapot|tea\b|coffee/, "\u2615"], [/vase|plant pot/, "\u{1F3FA}"],
  [/mirror/, "\u{1FA9E}"], [/art print/, "\u{1F5BC}\uFE0F"], [/rug/, "\u{1F9F6}"], [/diffuser|mist|perfume/, "\u{1F338}"], [/tableware|kitchen/, "\u{1F37D}\uFE0F"], [/ornament|decoration/, "\u2728"],
  [/storage box|keepsake box|gift box|hamper|snack box/, "\u{1F381}"], [/novel|book|comic|journal/, "\u{1F4D6}"], [/notebook|planner|notecards|stationery|greeting card|coupons|voucher|scratch/, "\u{1F4DD}"],
  [/pen\b|pencil|art supplies|paint/, "\u{1F58C}\uFE0F"], [/bookmark/, "\u{1F516}"], [/bath bomb|bath oil|bath set|soap/, "\u{1F6C1}"], [/lotion|cream|oil|lubricant|body paint/, "\u{1F9F4}"],
  [/face mask|skincare|spa/, "\u{1F9D6}"], [/lip/, "\u{1F484}"], [/nail/, "\u{1F485}"], [/hair/, "\u{1FAAE}"], [/chocolate/, "\u{1F36B}"], [/sweets/, "\u{1F36C}"],
  [/biscuit|cookie/, "\u{1F36A}"], [/cake/, "\u{1F370}"], [/pastr|scone/, "\u{1F950}"], [/jam|honey|sauce/, "\u{1F36F}"], [/drink/, "\u{1F964}"],
  [/bouquet|rose/, "\u{1F490}"], [/house plant|bonsai|herb|terrarium/, "\u{1FAB4}"], [/cactus|succulent/, "\u{1F335}"], [/seed|bulb/, "\u{1F331}"], [/wreath|garland/, "\u{1F33F}"],
  [/plush/, "\u{1F9F8}"], [/board game|dice/, "\u{1F3B2}"], [/card game/, "\u{1F0CF}"], [/puzzle/, "\u{1F9E9}"], [/building|model kit/, "\u{1F9F1}"], [/figure|toy/, "\u{1F9F8}"],
  [/ball/, "\u26BD"], [/kite/, "\u{1FA81}"], [/craft|knitting|yarn/, "\u{1F9F6}"], [/guitar|ukulele|instrument/, "\u{1F3B8}"], [/ticket|class/, "\u{1F39F}\uFE0F"],
  [/camping/, "\u{1F3D5}\uFE0F"], [/sports/, "\u26BD"], [/necklace|pendant|choker/, "\u{1F4FF}"], [/ring/, "\u{1F48D}"], [/bracelet|anklet/, "\u{1F4FF}"], [/earring|brooch|hair pin/, "\u2728"],
  [/advent/, "\u{1F4C5}"], [/massager|tickler|toy kit/, "\u{1F49C}"], [/cuffs|restraint/, "\u26D3\uFE0F"], [/masquerade/, "\u{1F3AD}"], [/boa/, "\u{1FAB6}"], [/petal/, "\u{1F339}"], [/roller/, "\u{1F486}"],
];
export const emojiFor = (type: string, fallback = "\u{1F381}") => (EMOJI.find(([r]) => r.test(type.toLowerCase())) ?? [null, fallback])[1];

const STOP = new Set(["set", "and", "style", "kit", "the", "of"]);
/** Words that identify a type in text ("bra & knicker set" -> bra, knicker). */
const keyWords = (type: string) => type.toLowerCase().replace(/[&'']/g, " ").split(/[\s-]+/).filter((w) => w.length > 2 && !STOP.has(w) || w === "bra");
const stem = (w: string) => w.replace(/(es|s)$/, "");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Word-start match so "ring" doesn't hit "earrings" or "spring". */
const hasWord = (text: string, w: string) => new RegExp(`(^|[^a-z])${esc(stem(w))}`).test(text);
const hasType = (text: string, t: string) => new RegExp(`(^|[^a-z])${esc(t)}`).test(text);
export const mentionsType = (text: string, type: string) => { const t = text.toLowerCase(); return keyWords(type).some((w) => hasWord(t, w)); };
/** Allowed type from the model's answer (exact, then loose match). */
export function matchType(raw: unknown, allowed: string[]): string | null {
  const s = String(raw ?? "").toLowerCase().trim();
  if (!s) return null;
  return allowed.find((t) => t === s) ?? [...allowed].sort((a, b) => b.length - a.length).find((t) => hasType(s, t))
    ?? allowed.find((t) => keyWords(t).length && keyWords(t).every((w) => hasWord(s, w)))
    ?? allowed.find((t) => keyWords(t).some((w) => stem(w) === stem(s))) ?? null;
}
/** Type guessed from an item's own words (longest match wins, so "kimono robe" beats "robe"). */
export function inferType(name: string, description: string, allowed: string[]): string | null {
  const text = `${name} ${description}`.toLowerCase();
  const hits = allowed.filter((t) => hasType(text, t) || keyWords(t).length > 0 && keyWords(t).every((w) => hasWord(text, w)));
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}
const title = (s: string) => s.replace(/(^|[\s-])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
/** Name always says what it is: replace a vague trailing Set/Kit/Box/Pack, or append the type. */
export function nameWithType(name: string, type: string): string {
  const n = name.trim();
  if (mentionsType(n, type)) return n;
  const T = title(type);
  const vague = n.match(/^(.*?)\s+(set|kit|box|pack|piece|collection|straps|bundle)$/i);
  if (vague && vague[1]) return `${vague[1]} ${T}`.slice(0, 48);
  const out = `${n} ${T}`;
  return out.length <= 48 ? out : `${n.split(/\s+/).slice(0, 2).join(" ")} ${T}`;
}
const article = (w: string) => /^[aeiou]/i.test(w) ? "An" : "A";
/** First clause states plainly what it is ("A red velvet bra & knicker set."), then the model's flourish. */
export function plainDescription(desc: string, type: string, colour = "", material = ""): string {
  const d = desc.trim().replace(/\s+/g, " ");
  const first = d.split(/(?<=[.!?])\s/)[0] ?? "";
  if (first && mentionsType(first, type)) return d.slice(0, 140);
  const head = [colour, material].map((x) => x.trim().toLowerCase()).filter((x) => x && x.length < 20 && !type.includes(x)).join(" ");
  const lead = `${article(head || type)} ${head ? head + " " : ""}${type}.`;
  return `${lead}${d ? " " + d.charAt(0).toUpperCase() + d.slice(1) : ""}`.slice(0, 160);
}
export interface Typed { name: string; emoji: string; description: string; itemType: string; }
/** Applies type rules to one generated item; null when no concrete type can be found (vague -> rejected). */
export function typeItem(r: Record<string, unknown>, name: string, description: string, allowed: string[]): Typed | null {
  const type = matchType(r.item_type ?? r.itemType ?? r.type, allowed) ?? inferType(name, description, allowed);
  if (!type) return null;
  return { name: nameWithType(name, type), emoji: emojiFor(type), itemType: type,
    description: plainDescription(description, type, String(r.colour ?? r.color ?? ""), String(r.material ?? "")) };
}
/** Prompt lines shared by every generator. */
export function typeRules(allowedText: string): string {
  return [
    `Every item MUST have "item_type": exactly one entry from the allowed list${allowedText}, plus "colour" and "material" (short words).`,
    "The name must include the item type (e.g. 'Crimson Velvet Bra & Knicker Set', not 'Crimson Velvet Set').",
    "The description's first sentence must plainly say what it is (e.g. 'A red velvet bra and knicker set with lace trim.'), then one short flourish. No vague mood-only descriptions.",
    "Do not choose an emoji; it is added automatically.",
  ].join("\n");
}
export const listFor = (depts: readonly { id: string }[], adult = false) => depts.map((d) => `${d.id}: ${typesFor(d.id, adult).join(", ")}`).join("\n");
