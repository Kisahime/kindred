// Sparkles economy + café maths + shop stock. Build first:
//   npx esbuild scripts/test-entry.ts --bundle --platform=node --format=esm --outfile=dist-test/all.js --external:@tauri-apps/*
// Live part needs Ollama (skipped if not reachable).
import assert from "node:assert/strict";
import * as all from "../dist-test/all.js";
const { economy: E, cafeMod: K, typesMod, selfie } = all;
const base = { ...typesMod.blankCharacter(), id: "c-juniper", name: "Juniper", personality: "Gentle plant lover, works at a garden centre.", backstory: "Lives in a flat full of plants and knits in the evenings.", model: "qwen3:8b", closeness: 50 };

// daily streak
assert.deepEqual(E.nextStreak(null, "2026-10-13"), { day: "2026-10-13", streak: 1, reward: 20 });
assert.equal(E.nextStreak({ day: "2026-10-13", streak: 1 }, "2026-10-13"), null, "once a day");
assert.equal(E.nextStreak({ day: "2026-10-12", streak: 3 }, "2026-10-13").streak, 4);
assert.equal(E.nextStreak({ day: "2026-10-10", streak: 9 }, "2026-10-13").streak, 1, "missed day resets");
assert.equal(E.nextStreak({ day: "2026-10-12", streak: 20 }, "2026-10-13").reward, 100, "capped");
assert.equal(E.nextStreak({ day: "2026-09-30", streak: 2 }, "2026-10-01").streak, 3, "across months");
// chat + levels + events
assert.ok(E.chatWorthy("hello there") && !E.chatWorthy("hi") && !E.chatWorthy("[nudge]") && !E.chatWorthy("[gift] x"));
assert.deepEqual([E.levelOf(0), E.levelOf(40), E.levelOf(95)], [0, 2, 5]);
let n = 0; for (let i = 0; i < 12000; i++) if (E.randomEvent()) n++;
assert.ok(n > 40 && n < 180, `random events ~1/120 (${n})`);
// shops
assert.deepEqual([E.closenessDiscount(30), E.closenessDiscount(60), E.closenessDiscount(80), E.closenessDiscount(95)], [0, 0.05, 0.1, 0.15]);
const st = E.normalizeStock({ stallName: "Juniper's Greenhouse", items: [
  { name: "Mini cactus", emoji: "🌵 cute", description: "tiny", price: 5, rarity: "common" },
  { name: "mini cactus", emoji: "🌵", price: 20, rarity: "common" },
  { name: { value: "Knitted scarf" }, emoji: "", description: "green wool", price: 99999, rarity: "SPECIAL", wearable: "true" },
  { name: "", price: 10 }] }, base);
assert.equal(st.items.length, 2, "dupes and blanks dropped");
assert.deepEqual([st.items[0].price, st.items[0].emoji], [15, "🌵"], "price clamped, emoji cleaned");
assert.deepEqual([st.items[1].name, st.items[1].price, st.items[1].rarity, st.items[1].wearable, st.items[1].emoji], ["Knitted scarf", 1200, "special", true, "🧣"]);
assert.equal(E.normalizeStock({ items: [] }, base), null);
const sales = Array.from({ length: 200 }, (_, i) => E.saleToday(base.id, `2026-01-${i}`)).filter(Boolean).length;
assert.ok(sales > 20 && sales < 70, `sale ~1 day in 5 (${sales})`);
const day = "2026-10-13";
const p = E.priceFor({ price: 100 }, { ...base, closeness: 80 }, day);
assert.equal(p.price, Math.round(100 * (1 - p.off)));
assert.ok(p.off >= 0.1);
assert.equal(E.sellValue({ price: 100 }, true), 50); assert.equal(E.sellValue({ price: 100 }, false), 40);
// gifts in prompts and selfies
const scarf = { id: 1, owner: base.id, name: "Knitted scarf", emoji: "🧣", description: "", price: 40, wearable: true, fromChar: "x", acquiredAt: 0, giftedAt: Date.now() - 2 * 86400_000 };
assert.match(E.giftsPrompt([scarf], "Alex"), /Gifts Alex has given you.*🧣 Knitted scarf \(2 days ago\)/);
assert.equal(E.giftsPrompt([], "Alex"), "");
assert.equal(E.selfieGift([scarf], () => 0.1), "wearing knitted scarf");
assert.equal(E.selfieGift([scarf], () => 0.9), "");
E.setGiftsFor(base.id, [scarf]);
let found = false; for (let i = 0; i < 40 && !found; i++) found = /knitted scarf/.test(selfie.buildSelfiePrompt({ ...base, appearance: { ...typesMod.blankAppearance(), body: "woman" } }, "").prompt);
assert.ok(found, "selfies sometimes show a wearable gift");
assert.match(selfie.buildSelfiePrompt(base, "").negative, /underage/, "adult-only negative kept");
assert.equal(typesMod.toModelText(E.giftMessage(scarf), true, "Alex", "Juniper"), "[Event: Alex gave you (Juniper) a gift: 🧣 Knitted scarf. It now belongs to you, Juniper.]");
// café maths
const s0 = K.blankCafe(0);
assert.equal(K.rate(s0), 0);
assert.equal(K.clickValue(s0, [], 0), 1);
let s = K.buy(s0, "beans").s; assert.equal(K.clickValue(s, [], 0), 2);
assert.equal(K.clickValue({ ...s, rushUntil: 10 }, [], 5), 6, "rush hour x3");
assert.equal(K.buy(s, "beans").cost, Math.ceil(25 * 1.15));
s = { ...s, levels: { kettle: 1 } };
assert.ok(Math.abs(K.rate(s) - 0.01) < 0.001, "kettle ~0.6/min");
const huge = { ...s0, levels: { barista: 50, plants: 20 } };
assert.ok(K.rate(huge) <= K.SOFT_CAP + 1e-9 && K.rate(huge) * 3600 < 260, "soft cap ~250/h");
assert.ok(Math.abs(K.passiveFor(huge, [], 24 * 3600_000) - K.passiveFor(huge, [], 8 * 3600_000)) < 1e-6, "offline capped at 8h");
// staff scale with closeness
const ids = ["a", "b", "c", "d", "e", "f"]; const pid = ids.find((x) => K.staffPerk(x) === "passive"); const cid = ids.find((x) => K.staffPerk(x) === "click");
const lowS = { ...s, staff: [pid] };
assert.ok(K.rate(lowS, [{ ...base, id: pid, closeness: 90 }]) > K.rate(lowS, [{ ...base, id: pid, closeness: 10 }]));
assert.ok(K.clickValue({ ...s0, staff: [cid] }, [{ ...base, id: cid, closeness: 100 }], 0) > 1);
// prestige
assert.equal(K.prestige({ ...huge, branchEarned: 10 }).branches, 0, "not enough yet");
const pr = K.prestige({ ...huge, staff: ["a"], branchEarned: 5000 }, 1);
assert.deepEqual([pr.branches, Object.keys(pr.levels).length, pr.staff], [1, 0, ["a"]]);
assert.equal(K.branchMult(pr), 1.25);
assert.equal(K.prestigeNeed(pr), 6000);
// expanded upgrades: categories, unlocks, max levels, new effects
assert.ok(K.UPGRADES.length >= 18, `upgrades doubled (${K.UPGRADES.length})`);
assert.equal(new Set(K.UPGRADES.map((u) => u.id)).size, K.UPGRADES.length, "unique ids");
for (const u of K.UPGRADES) { assert.ok(K.CATEGORIES.some((c) => c.id === u.cat), u.id); if (u.unlock?.up) assert.ok(K.UPGRADES.some((x) => x.id === u.unlock.up[0]), `${u.id} unlock target`); }
for (const c of K.CATEGORIES) assert.ok(K.UPGRADES.some((u) => u.cat === c.id), `category ${c.id} has upgrades`);
const fresh = K.blankCafe(0);
assert.ok(K.unlocked(fresh, K.upgrade("beans")) && !K.unlocked(fresh, K.upgrade("latteart")) && !K.unlocked(fresh, K.upgrade("grinder")));
assert.match(K.unlockHint(K.upgrade("latteart")), /Better beans \u00D73/);
assert.match(K.unlockHint(K.upgrade("grinder")), /open 1 new branch/);
assert.throws(() => K.buy(fresh, "latteart"), /Unlocks when/);
assert.ok(K.unlocked({ ...fresh, levels: { beans: 3 } }, K.upgrade("latteart")));
assert.ok(K.unlocked({ ...fresh, branches: 1 }, K.upgrade("grinder")));
assert.ok(K.unlocked({ ...fresh, levels: { barista: 1 } }, K.upgrade("barista")), "owned stays unlocked (old saves)");
assert.throws(() => K.buy({ ...fresh, levels: { espresso: 1, counter: 2 } }, "counter"), /at its best/);
assert.ok(K.costOf(K.upgrade("counter"), 1) === 10000, "custom growth");
// every unlock chain is reachable from nothing (ignoring money)
{ let st = { ...fresh, branches: 2, levels: {} }; for (let i = 0; i < 400; i++) { const u = K.UPGRADES.find((x) => K.unlocked(st, x) && !K.maxed(x, K.levelOf(st, x.id)) && K.levelOf(st, x.id) < 6); if (!u) break; st = K.buy(st, u.id).s; }
  for (const u of K.UPGRADES) assert.ok(K.unlocked(st, u), `${u.id} reachable`); }
// effects
const full = { ...fresh, levels: Object.fromEntries(K.UPGRADES.map((u) => [u.id, u.max ?? 40])) };
assert.equal(K.staffSlots(fresh), 3); assert.equal(K.staffSlots(full), 5, "staff slots up to 5");
assert.equal(K.offlineCap(fresh), 8 * 3600_000); assert.equal(K.offlineCap(full), 12 * 3600_000, "away cap up to 12h");
assert.ok(K.passiveFor(full, [], 20 * 3600_000) === K.passiveFor(full, [], 12 * 3600_000));
assert.equal(K.goldenMs(full), 24_000); assert.equal(K.rushMs(full), 120_000); assert.equal(K.tipMult(full), 2); assert.equal(K.eventGap(full), 0.6);
assert.ok(Math.abs(K.luck(full) - 2) < 1e-9);
assert.ok(Math.abs(K.softCap(full) - 0.13) < 1e-9);
assert.ok(K.rate(full) * 3600 <= 470 && K.rate(full) * 3600 > 400, `fully seated ~470/h (${(K.rate(full) * 3600).toFixed(0)})`);
assert.ok(K.rate({ ...full, branches: 4 }) * 3600 < 950, "even at branch 5 under ~940/h");
assert.ok(K.clickValue({ ...fresh, levels: { buns: 2 } }, [], 0) === 1.1, "menu +% on brews");
const keep = K.prestige({ ...full, branchEarned: 1e9 }, 1);
assert.deepEqual(keep.levels, { counter: 2, rota: 2 }, "staff/night upgrades kept on new branch");
// café chat context
assert.equal(K.cafePrompt(s0, base, "Alex"), "", "no café yet");
assert.match(K.cafePrompt({ ...s, staff: [base.id] }, base, "Alex", () => 0.5), /help out part-time/);
assert.match(K.cafePrompt({ ...s, staff: [base.id] }, base, "Alex", () => 0.1), /where you work part-time/);
assert.equal(K.cafePrompt(s, base, "Alex", () => 0.9), "", "only sometimes");
// ---- Shopping Centre ----
const M = all.mall;
assert.ok(M.CATALOG.length >= 250, `big catalogue (${M.CATALOG.length})`);
assert.equal(new Set(M.CATALOG.map((i) => i.sku)).size, M.CATALOG.length, "unique skus");
for (const d of M.DEPARTMENTS) assert.ok(M.CATALOG.filter((i) => i.dept === d.id).length >= 20, `dept ${d.id} stocked`);
for (const i of M.CATALOG) {
  const [lo, hi] = M.TIER_RANGE[i.tier];
  assert.ok(i.price >= lo - 2 && i.price <= hi + 2, `${i.name} price ${i.price} in tier ${i.tier}`);
  assert.ok(i.emoji && i.description && i.tags.length, `${i.name} complete`);
  for (const t of i.tags) assert.ok(M.TAGS.includes(t), `${i.name} tag ${t}`);
}
assert.ok(M.CATALOG.filter((i) => i.wearable).length >= 40, "plenty of wearables");
assert.equal(M.tierPrice("Chunky knit scarf", 2), M.tierPrice("Chunky knit scarf", 2), "stable prices");
assert.deepEqual(M.featured("2026-10-13").map((i) => i.sku), M.featured("2026-10-13").map((i) => i.sku));
assert.notDeepEqual(M.featured("2026-10-13").map((i) => i.sku), M.featured("2026-10-14").map((i) => i.sku), "rotates daily");
assert.equal(M.weekKey(new Date(2026, 9, 13)), "2026-10-12"); assert.equal(M.weekKey(new Date(2026, 9, 18)), "2026-10-12"); assert.equal(M.weekKey(new Date(2026, 9, 19)), "2026-10-19");
const deals = M.weeklyDeals("2026-10-12"); assert.equal(deals.length, 6);
const ds = new Set(deals.map((d) => d.sku)); assert.equal(M.priceOf(deals[0], ds), Math.round(deals[0].price * 0.75));
assert.ok(M.search(M.CATALOG, "scarf", "all", "any").every((i) => /scarf/i.test(i.name + i.description + i.tags)));
assert.ok(M.search(M.CATALOG, "", "jewellery", "1").every((i) => i.dept === "jewellery" && i.tier === 1));
assert.ok(M.search(M.CATALOG, "", "all", "any", "romantic").length >= 15);
// basket
const rose = M.CATALOG.find((i) => i.name === "Dozen red roses"), mug = M.CATALOG.find((i) => i.name === "Hand-thrown mug");
let b = M.addToBasket([], rose, 50); b = M.addToBasket(b, rose, 50, 2); b = M.addToBasket(b, mug, 20);
assert.deepEqual([b.length, b[0].qty, M.basketTotal(b), M.basketCount(b)], [2, 3, 170, 4]);
b = M.setQty(b, rose.sku, 0); assert.deepEqual(b.map((l) => l.item.name), ["Hand-thrown mug"]);
assert.equal(M.setQty(b, mug.sku, 500)[0].qty, 99);
// gift fit: likes, family-safe romance
const baker = { ...base, personality: "Warm baker who loves coffee and cosy rainy days.", backstory: "Runs a bakery.", speakingStyle: "" };
assert.ok(M.likedTags(baker).includes("foodie") && M.likedTags(baker).includes("cosy"));
const cookies = M.CATALOG.find((i) => i.name === "Cookie tin");
assert.ok(M.giftFit(baker, cookies, "Alex").matches.length > 0);
assert.match(M.giftFit(baker, cookies, "Alex").note, /delighted/);
assert.match(M.giftFit({ ...baker, personality: "quiet", backstory: "" }, M.CATALOG.find((i) => i.name === "Football"), "Alex").note, /isn't quite your usual/);
const gran = { ...baker, life: { relationship: "grandparent", relationshipDetail: "grandma" } };
const fr = M.giftFit(gran, rose, "Alex");
assert.ok(fr.familyRomantic && /family/.test(fr.warning) && /Never romantic/.test(fr.note));
assert.ok(!M.giftFit(gran, cookies, "Alex").warning, "normal family gift no warning");
const gf = M.giftFit({ ...baker, life: { relationship: "partner" } }, rose, "Alex");
assert.ok(!gf.warning && /affectionate/.test(gf.note));
assert.ok(M.giftFit({ ...baker, closeness: 20, life: { relationship: "friend" } }, rose, "Alex").forward);
assert.deepEqual(M.itemTags({ name: "Garden trowel", description: "for plants", tags: "" }), ["nature"], "stall items get guessed tags");
// seasonal normaliser
const sea = M.normalizeSeasonal({ items: [{ name: "Frosty mittens", emoji: "🧤 x", description: "warm", tier: 9, tags: ["cosy", "bogus"], wearable: true }, { name: "Chunky knit scarf", tier: 1 }, { name: "" }] }, "2026-10-12");
assert.equal(sea.length, 1, "catalogue dupes + blanks dropped");
assert.deepEqual([sea[0].tier, sea[0].emoji, sea[0].tags, sea[0].wearable, sea[0].dept], [3, "🧤", ["cosy", "festive"], true, "seasonal"]);
// ---- daily new items ----
const dn = M.normalizeDaily({ items: [
  { name: "Cloud lamp", emoji: "☁️", description: "soft glow", dept: "home", tier: 2, tags: ["cosy", "weird"], wearable: false },
  { name: "Chunky knit scarf", dept: "clothing", tier: 1 }, { name: "Moss slippers", dept: "nowhere", tier: 1 },
  { name: "Yesterday thing", dept: "toys", tier: 1 }, { name: "cloud lamp", dept: "home" }, { name: "Star socks", dept: "clothing", tier: 7, tags: "cute", wearable: "true" }] }, "2026-10-13", ["Yesterday thing"]);
assert.deepEqual(dn.map((i) => i.name), ["Cloud lamp", "Star socks"], "dept/catalogue/recent/self dupes dropped");
assert.deepEqual([dn[0].tags, dn[1].tier, dn[1].wearable, dn[0].sku.startsWith("new-2026-10-13")], [["cosy"], 4, true, true]);
// ---- After Dark (18+) ----
const A = all.afterdark;
assert.ok(A.ADULT_CATALOG.length >= 60 && A.ADULT_CATALOG.length <= 80, `adult catalogue ${A.ADULT_CATALOG.length}`);
for (const d of A.ADULT_DEPTS) assert.ok(A.ADULT_CATALOG.some((i) => i.dept === d.id), d.id);
for (const i of A.ADULT_CATALOG) { assert.ok(i.tags.includes("18+"), i.name); assert.doesNotMatch(`${i.name} ${i.description}`, /\b(child|kid|teen|minor|school|student|underage)/i); }
assert.ok(A.ADULT_CATALOG.filter((i) => i.wearable).length >= 15, "wearable lingerie");
const adultC = { ...base, appearance: { ...typesMod.blankAppearance(), age: 30 }, life: { relationship: "partner" }, closeness: 40 };
assert.equal(A.adultGiftCheck(adultC, false).ok, false, "toggle off blocks");
assert.deepEqual([A.adultGiftCheck(adultC, true).ok, A.adultGiftCheck(adultC, true).warning], [true, ""]);
assert.match(A.adultGiftCheck({ ...adultC, life: { relationship: "sibling" } }, true).reason, /family/, "family blocked");
assert.equal(A.adultGiftCheck({ ...adultC, life: { relationship: "sibling" }, closeness: 99 }, true).ok, false);
assert.match(A.adultGiftCheck({ ...adultC, appearance: {} }, true).reason, /no age set/, "unknown age blocked");
assert.equal(A.adultGiftCheck({ ...adultC, appearance: { age: 17 } }, true).ok, false);
assert.match(A.adultGiftCheck({ ...adultC, life: { relationship: "friend" }, closeness: 30 }, true).warning, /too forward/);
assert.equal(A.adultGiftCheck({ ...adultC, life: { relationship: "friend" }, closeness: 85 }, true).warning, "");
assert.match(A.adultGiftNote(adultC, "Alex"), /decline.*never explicit/);
const na = A.normalizeAdult({ items: [{ name: "Velvet eye mask", dept: "accessories", tier: 1, description: "soft" }, { name: "Schoolgirl outfit", dept: "lingerie" },
  { name: "Silk blindfold", dept: "accessories" }, { name: "Mystery gift", dept: "bogus", tier: 2, description: "for adults" },
  { name: "Midnight Embrace Straps", dept: "bogus", item_type: "harness-style lingerie", colour: "black", material: "satin", description: "Pure allure." }] }, "2026-10-12");
assert.deepEqual(na.map((i) => [i.name, i.dept]), [["Velvet eye mask", "accessories"], ["Midnight Embrace Harness-Style Lingerie", "lingerie"]], "banned, dupes and vague dropped; dept from type");
assert.equal(na[1].description, "A black satin harness-style lingerie. Pure allure.");
// hidden when off (prompts/selfies/inventory)
const lace = { id: 9, owner: "c-lace", name: "Lace bodysuit", emoji: "🩱", description: "", price: 200, wearable: true, fromChar: "afterdark", acquiredAt: 0, giftedAt: Date.now(), qty: 1, tags: "18+,romantic" };
const laceChar = { ...base, id: "c-lace", appearance: { ...typesMod.blankAppearance(), age: 28, body: "woman" } };
E.setGiftsFor("c-lace", [lace]);
E.setAdultFlag(false);
assert.equal(E.giftsOf("c-lace").length, 0, "hidden when off");
for (let i = 0; i < 30; i++) assert.doesNotMatch(selfie.buildSelfiePrompt(laceChar, "").prompt, /bodysuit/);
E.setAdultFlag(true);
assert.equal(E.giftsOf("c-lace").length, 1);
let seen = false; for (let i = 0; i < 40 && !seen; i++) seen = /lace bodysuit/.test(selfie.buildSelfiePrompt(laceChar, "").prompt);
assert.ok(seen, "lingerie may appear when on and 18+");
for (let i = 0; i < 30; i++) assert.doesNotMatch(selfie.buildSelfiePrompt({ ...laceChar, appearance: {} }, "").prompt, /bodysuit/, "unknown stored age: never");
assert.match(selfie.buildSelfiePrompt(laceChar, "").negative, /nsfw.*underage|underage.*nsfw/);
E.setAdultFlag(false);
// ---- image prompts (imageprompts) ----
{
  const G = all.imagegen;
  const saved = { params: { ...G.DEFAULT_PARAMS, prompt: "a cat", negative: "blurry", seed: 1234, steps: 30, batch: 4, meta: { source: "selfie", characterId: "x" } } };
  const r1 = G.reuseParams(saved), r2 = G.reuseParams(saved, true);
  assert.ok(r1.prompt === "a cat" && r1.negative === "blurry" && r1.seed === 1234 && r1.steps === 30 && r1.batch === 1 && !("meta" in r1), "reuse loads everything, drops meta");
  assert.ok(r2.seed === -1 && r2.prompt === "a cat", "reuse with new seed");
  assert.deepEqual(G.tagged(G.DEFAULT_PARAMS, { source: "studio" }).meta, { source: "studio" });
  const row = { id: 1, path: "C:\\x\\a.png", params: { ...saved.params, model: "C:\\m\\anima.safetensors", loras: [{ path: "C:\\l\\soft.safetensors", strength: 0.8 }], seed: -1 }, createdAt: 0, source: "selfie", charId: "x", gift: "", adult: false, recorded: true };
  const st = Object.fromEntries(G.settingsList(row));
  assert.ok(st.Model === "anima.safetensors" && st.LoRAs === "soft.safetensors (0.8)" && st.Seed === "random (not recorded)" && st.Source === "Chat selfie");
  assert.deepEqual(G.settingsList({ ...row, recorded: false }), [["Source", "Chat selfie"]], "not recorded: no fake settings");
  // selfie/avatar/album generations carry where-it's-for meta; 18+ gift selfies are flagged
  const lily2 = { ...base, id: "c-lily2", appearance: { ...typesMod.blankAppearance(), age: 26, body: "woman" } };
  const bra = { id: 31, owner: "c-lily2", name: "Celestial Whispers Bra & Knicker Set", emoji: "x", description: "A midnight-blue satin bra & knicker set.", price: 300, wearable: true, fromChar: "afterdark", acquiredAt: 0, giftedAt: Date.now(), qty: 1, tags: "18+" };
  E.setGiftsFor("c-lily2", [bra]); E.setAdultFlag(true);
  const shot = selfie.selfieShot(G.DEFAULT_PARAMS, lily2, "wearing it", { wear: bra });
  assert.deepEqual(shot.params.meta, { source: "selfie", characterId: "c-lily2", gift: bra.name, adult: true });
  const av = selfie.withPrompt(G.DEFAULT_PARAMS, { ...lily2, id: "c-none" }, "close-up portrait", new Date(), { source: "avatar" });
  assert.ok(av.meta.source === "avatar" && av.meta.adult === false && av.meta.gift === "");
  E.setAdultFlag(false);
}
// ---- connected economy + data backup helpers (connected) ----
{
  const C = all.connected, DB = all.databackup, L = all.lifecore;
  const day = new Date(2026, 9, 13, 15);
  const kind = { ...base, id: "c-kind", personality: "Generous, sweet and caring baker who loves coffee and cosy rainy days.", closeness: 80, life: { relationship: "friend" } };
  const cold = { ...kind, id: "c-cold", personality: "Grumpy, aloof and frugal accountant.", closeness: 80 };
  assert.ok(C.generosity(kind) > 0 && C.generosity(cold) < 0);
  assert.ok(C.giftChance(kind, "sometimes") > C.giftChance(cold, "sometimes"), "personality scales gifts");
  assert.ok(C.giftChance({ ...kind, closeness: 90 }, "sometimes") > C.giftChance({ ...kind, closeness: 40 }, "sometimes"), "closeness scales gifts");
  assert.equal(C.giftChance({ ...kind, closeness: 10 }, "often"), 0, "strangers don't send gifts");
  assert.ok(C.giftChance(kind, "often") > C.giftChance(kind, "rarely"));
  // caps
  const cfg = { ...C.DEFAULT_CFG }; const st = C.freshDay(C.blankState(), day);
  assert.equal(C.shouldGift(st, kind, cfg, day, () => 0), true);
  assert.equal(C.shouldGift({ ...st, gifts: 1 }, kind, cfg, day, () => 0), false, "1 a day on 'sometimes'");
  assert.equal(C.shouldGift({ ...st, gifts: 1 }, kind, { ...cfg, frequency: "often" }, day, () => 0), true);
  assert.equal(C.shouldGift({ ...st, lastGift: { "c-kind": day.getTime() - 86_400_000 } }, kind, cfg, day, () => 0), false, "gap between gifts");
  assert.equal(C.shouldGift(st, kind, { ...cfg, giftsBack: false }, day, () => 0), false, "toggle off");
  // picks: what they love, from stall or mall; never 18+ unless partner + switch + adult age; never romantic from family
  const r = (() => { let i = 0; return () => ((i++ * 0.37) % 1); })();
  for (let i = 0; i < 40; i++) { const g = C.pickReturnGift(kind, null, true, r); assert.ok(g && !g.tags.includes("18+") && !g.tags.includes("romantic") && g.price <= 400); }
  const stallPick = C.pickReturnGift(kind, [{ name: "Cinnamon coffee beans", emoji: "x", description: "Fresh roasted coffee", price: 30, rarity: "common", wearable: false }], false, () => 0);
  assert.equal(stallPick.source, "stall", "own stall first");
  const fam = { ...kind, id: "c-fam", life: { relationship: "sibling" }, appearance: { ...typesMod.blankAppearance(), age: 30 } };
  const partner = { ...kind, id: "c-p", life: { relationship: "partner" }, appearance: { ...typesMod.blankAppearance(), age: 30 } };
  assert.equal(C.canGiveAdult(fam, true), false); assert.equal(C.canGiveAdult(partner, false), false);
  assert.equal(C.canGiveAdult({ ...partner, appearance: {} }, true), false, "unknown age");
  assert.equal(C.canGiveAdult(partner, true), true);
  for (let i = 0; i < 60; i++) { const g = C.pickReturnGift(fam, null, true, Math.random); assert.ok(!g.tags.includes("18+") && !g.tags.includes("romantic"), "family: never 18+/romantic"); }
  assert.equal(C.pickReturnGift(partner, null, true, () => 0).source, "afterdark", "partner + switch on may give 18+");
  assert.notEqual(C.pickReturnGift(partner, null, false, () => 0).source, "afterdark");
  // offers: fit their likes, never 18+ items, capped, never with one pending
  const mug = { id: 7, owner: "me", name: "Coffee mug", emoji: "x", description: "For coffee", price: 20, wearable: false, fromChar: "mall", acquiredAt: 0, giftedAt: null, qty: 1, tags: "foodie,cosy" };
  const lace = { ...mug, id: 8, name: "Lace set", tags: "18+,romantic,cosy" };
  const o = C.pickOffer(st, kind, [lace, mug], cfg, day, false, () => 0.9 * 0 + 0.01);
  assert.ok(o && o.target.id === 7 && (o.kind === "swap" || o.sparkles > 20));
  assert.equal(C.pickOffer(st, kind, [lace], cfg, day, false, () => 0.01), null, "never 18+ items");
  assert.equal(C.pickOffer(st, kind, [mug], cfg, day, true, () => 0.01), null, "one pending at a time");
  assert.equal(C.pickOffer({ ...st, offers: 1 }, kind, [mug], cfg, day, false, () => 0.01), null, "daily cap");
  assert.equal(C.pickOffer(st, kind, [mug], { ...cfg, offers: false }, day, false, () => 0.01), null);
  const buy = C.pickOffer(st, kind, [mug], cfg, day, false, (() => { const s = [0.01, 0, 0.9, 0.5]; let i = 0; return () => s[i++ % s.length]; })());
  assert.ok(buy && buy.kind === "buy" && /would like to buy your x Coffee mug for \d+/.test(C.offerBubble(buy)));
  // occasions
  const ms = [{ id: 1, kind: "anniversary", characterId: "c-kind", createdAt: Date.now() }, { id: 2, kind: "first_met", characterId: "c-kind", createdAt: Date.now() }];
  assert.deepEqual(C.occasionsDue(ms, C.blankState()).map((m) => m.id), [1]);
  assert.deepEqual(C.occasionsDue(ms, { ...C.blankState(), occasions: [1] }), []);
  // context: gifts + café everywhere; 18+ hidden when off, never for family or in groups
  E.setGiftsFor("c-p", [lace]); E.setGiftsFor("c-fam", [lace, mug]);
  E.setAdultFlag(true);
  assert.match(C.economyContext(partner, "Alex"), /Lace set/);
  assert.doesNotMatch(C.economyContext(partner, "Alex", { group: true }), /Lace set/, "not in group chats");
  const famCtx = C.economyContext(fam, "Alex"); assert.ok(/Coffee mug/.test(famCtx) && !/Lace/.test(famCtx), "never for family");
  E.setAdultFlag(false);
  assert.doesNotMatch(C.economyContext(partner, "Alex"), /Lace set/, "switch off");
  C.setConnectedForTest({ ...C.DEFAULT_CFG, context: false });
  assert.equal(C.economyContext(fam, "Alex"), ""); assert.match(C.economyContext(fam, "Alex", { always: true }), /Coffee mug/, "chat always knows");
  C.setConnectedForTest(C.DEFAULT_CFG);
  assert.match(typesMod.toModelText("[offer] \u{1F6D2} would like to buy your x Mug for 30 \u2728", false, "Alex", "Juniper"), /^\[Event: You \(Juniper\) made Alex an offer: you would like to buy Alex's x Mug/);
  assert.match(all.voice.buildCallMessages(kind, "Alex", [], [], [], false, "Gifts Alex has given you")[0].content, /Gifts Alex has given you/);
  // backup helpers
  assert.equal(DB.backupStamp(new Date(2026, 9, 3, 7, 5, 9)), "2026-10-03_070509");
  assert.match(DB.backupLabel("2026-10-13_150255_before-restore"), /safety copy before restore/);
  assert.equal(DB.fmtSize(46.4 * 1024 * 1024), "46.4 MB");
}
// ---- user profile (userprofile) ----
{
  const P = all.profile;
  const migrated = P.normalizeProfile(null, { userName: "Alex" });
  assert.equal(migrated.fields.displayName.value, "Alex", "header name migrated");
  assert.ok(migrated.fields.pronouns.share && !migrated.fields.picture.share);
  assert.deepEqual(P.parseBirthday("--03-14"), { y: null, m: 3, d: 14 }, "year optional");
  assert.equal(P.parseBirthday("1996-13-01"), null);
  assert.ok(P.isBirthday("1996-10-13", new Date(2026, 9, 13)) && !P.isBirthday("1996-10-14", new Date(2026, 9, 13)));
  assert.ok(P.isBirthday("--02-29", new Date(2027, 1, 28)), "leap-day birthdays on 28 Feb");
  assert.equal(P.ageOn("1996-10-14", new Date(2026, 9, 13)), 29); assert.equal(P.ageOn("--10-14"), null);
  const p = P.normalizeProfile({ fields: {
    displayName: { value: "Alex", share: true }, nicknames: { value: "Lexi", share: true }, pronouns: { value: "she/her", share: true },
    birthday: { value: "--10-13", share: true }, town: { value: "Exampletown", share: false }, food: { value: "pasta", share: true },
    boundaries: { value: "my ex", share: true }, about: { value: "secret diary", share: false } }, perChar: { "c-lily": "bunny" } }, { userName: "x" });
  const day = new Date(2026, 9, 13, 12);
  const b = P.aboutUserBlock(p, { id: "c-other", name: "Moss" }, day);
  assert.match(b, /About the user \(Alex, she\/her\)/); assert.match(b, /Nicknames you may use for them: Lexi/);
  assert.match(b, /Pronouns: she\/her/); assert.match(b, /Favourite food: pasta/); assert.match(b, /BOUNDARIES.*my ex/);
  assert.match(b, /TODAY IS ALEX'S BIRTHDAY/); assert.match(b, /Birthday: 13 October\./);
  assert.doesNotMatch(b, /Exampletown|secret diary/, "unshared fields stay private");
  assert.match(P.aboutUserBlock(p, { id: "c-lily", name: "Lily" }, day), /You call them "bunny"/, "per-character nickname");
  assert.doesNotMatch(P.aboutUserBlock(p, { id: "c-lily", name: "Lily" }, new Date(2026, 9, 14)), /BIRTHDAY!/);
  // injected into every prompt that uses buildSystemPrompt (chat, first messages, groups, calls)
  P.useProfileInPrompts(p);
  assert.match(typesMod.buildSystemPrompt(base, "Alex", { now: day }), /About the user \(Alex/);
  assert.match(all.voice.buildCallMessages(base, "Alex", [], [], [], false)[0].content, /Pronouns: she\/her/);
  P.useProfileInPrompts(P.blankProfile(""));
  assert.doesNotMatch(typesMod.buildSystemPrompt(base, "Alex"), /About the user/);
}
// ---- gift direction (giftdirection) ----
{
  const C = all.connected, T = typesMod;
  // history: gift/offer bubbles become system narration with explicit direction
  const fromLily = T.toModelText("[gift] x Garter \u2013 Lace with a rose", false, "Alex", "Lily", "accepted");
  assert.equal(fromLily, "[Event: You (Lily) gave Alex a gift: x Garter \u2013 Lace with a rose. Alex accepted it, so it now belongs to Alex.]");
  assert.equal(T.toModelText("[gift] x Garter", false, "Alex", "Lily"), "[Event: You (Lily) gave Alex a gift: x Garter.]");
  assert.equal(T.toModelText("[gift] x Scarf", true, "Alex", "Lily"), "[Event: Alex gave you (Lily) a gift: x Scarf. It now belongs to you, Lily.]");
  assert.ok(T.isEventText("[gift] a") && T.isEventText("[offer] a") && !T.isEventText("hello"));
  assert.equal(T.toModelText("[offer] \u{1F6D2} would like to buy your x Mug for 30 \u2728", false, "Alex", "Juniper", "declined"),
    "[Event: You (Juniper) made Alex an offer: you would like to buy Alex's x Mug for 30 \u2728. Alex declined the offer.]");
  assert.match(T.toModelText("[offer] \u{1F504} would like to swap your x Mug for their y Tea", false, "Alex", "Juniper"), /you would like to swap Alex's x Mug for your y Tea/);
  // follow-up notes: giver vs receiver spelled out, never thank for own gift
  const g = { kind: "gift", item: { name: "Garter", emoji: "x", wearable: true, tags: ["18+"] }, sparkles: 0 };
  const acc = C.resolveNote(g, "accepted", "x Garter", "Lily", "Alex");
  assert.match(acc, /^\[Event: You \(Lily\) gave Alex a gift: x Garter\. Alex accepted it, so it now belongs to Alex\.\]/);
  assert.match(acc, /as the GIVER/); assert.match(acc, /Do NOT thank Alex/); assert.match(acc, /tease about Alex wearing/);
  assert.doesNotMatch(acc, /your gift/i, "no ambiguous 'your gift'");
  assert.match(C.resolveNote(g, "declined", "x Garter", "Lily", "Alex"), /declined it, so you keep it/);
  const buy = { kind: "buy", item: {}, sparkles: 45 };
  assert.match(C.resolveNote(buy, "accepted", "x Mug", "Juniper", "Alex"), /Alex accepted your offer and SOLD you \(Juniper\) their x Mug for 45 Sparkles.*BUYER.*thank Alex/);
  assert.match(C.resolveNote(buy, "declined", "x Mug", "Juniper", "Alex"), /Alex declined your offer to buy their x Mug\. Nothing changed hands/);
  const swap = { kind: "swap", item: { name: "Tea", emoji: "y" }, sparkles: 0 };
  assert.match(C.resolveNote(swap, "accepted", "x Mug", "Juniper", "Alex"), /You \(Juniper\) gave Alex your y Tea, and Alex gave you their x Mug/);
  assert.match(C.resolveNote(swap, "expired", "x Mug", "Juniper", "Alex"), /no longer has it/);
  assert.equal(C.offerTarget("[offer] \u{1F6D2} would like to buy your x Mug for 30 \u2728"), "x Mug");
  assert.equal(C.offerTarget("[offer] \u{1F504} would like to swap your x Mug for their y Tea"), "x Mug");
  assert.match(C.offerMemory(g, "accepted", "x Garter", "Lily", "Alex"), /^Lily gave Alex a gift on .*: x Garter\. Alex accepted it/);
  assert.match(C.giftBackNote(base, { name: "Garter", emoji: "x", description: "Lace", price: 1, wearable: true, tags: [], source: "mall" }, "Alex"), /You are the GIVER: don't thank them/);
  // Alex -> character gifts: receiver framing
  const it = { id: 1, owner: "c", name: "Scarf", emoji: "x", description: "warm", price: 1, wearable: true, fromChar: "", acquiredAt: 0, giftedAt: 0, qty: 1, tags: "" };
  assert.match(E.giftNote({ ...base, name: "Lily" }, it, "Alex"), /^\[Event: Alex just gave you \(Lily\) a gift: x Scarf.*RECEIVING/);
  // first-message history: event lines go in as system role
  const msgs = all.buildProactiveMessages(base, { userName: "Alex" }, [{ id: 1, characterId: base.id, role: "assistant", content: "[gift] x Garter", createdAt: Date.now() - 60000 }], new Date());
  const ev = msgs.find((m) => m.content.includes("[Event: You (Juniper) gave Alex"));
  assert.ok(ev && ev.role === "system", "gift event is system narration, not the character speaking");
}
// ---- item types (clear generated items) ----
const T = all.itemtypes;
const lin = T.typesFor("lingerie");
assert.ok(lin.includes("bra & knicker set") && lin.includes("chemise") && T.typesFor("toys", true).includes("personal massager") && !T.typesFor("toys").includes("personal massager"));
const crimson = T.typeItem({ item_type: "bra and knicker set", colour: "red", material: "velvet" }, "Crimson Velvet Set", "Passion awaits in the dark.", lin);
assert.deepEqual(crimson, { name: "Crimson Velvet Bra & Knicker Set", emoji: "👙", itemType: "bra & knicker set", description: "A red velvet bra & knicker set. Passion awaits in the dark." });
const cel = T.typeItem({ item_type: "Teddy" }, "Celestial Whispers Set", "Starlight on skin.", lin);
assert.deepEqual([cel.name, cel.emoji, cel.description], ["Celestial Whispers Teddy", "🩱", "A teddy. Starlight on skin."]);
const dusk = T.typeItem({}, "Whisper Dusk Chemise", "A soft grey satin chemise with lace edges. Dreamy.", lin);
assert.deepEqual([dusk.name, dusk.itemType, dusk.emoji, dusk.description], ["Whisper Dusk Chemise", "chemise", "👗", "A soft grey satin chemise with lace edges. Dreamy."], "already clear: unchanged");
assert.equal(T.typeItem({ item_type: "vibes" }, "Celestial Whispers Set", "Starlight on skin.", lin), null, "vague rejected");
assert.equal(T.typeItem({ item_type: "kimono" }, "Dusk", "", lin).itemType, "kimono robe");
assert.equal(T.emojiFor("kimono robe"), "👘"); assert.equal(T.emojiFor("stockings"), "🧦"); assert.equal(T.emojiFor("massage oil"), "🧴");
assert.equal(T.inferType("Spring Charm", "a lucky spring charm", T.typesFor("jewellery")), null, "no 'ring' inside 'spring'");
assert.equal(T.inferType("Moon Earrings", "", T.typesFor("jewellery")), "earrings");
assert.equal(T.nameWithType("A Very Long Evening Romance Name Here", "harness-style lingerie"), "A Very Harness-Style Lingerie");
assert.match(T.plainDescription("", "earrings", "silver", ""), /^A silver earrings\.$/);
assert.match(M.buildDailyPrompt("2026-10-13")[0].content, /item_type[\s\S]*lingerie|clothing: jumper/);
assert.doesNotMatch(M.buildDailyPrompt("2026-10-13")[0].content, /bra & knicker/, "no After Dark types in the Shopping Centre");
assert.match(A.buildAdultPrompt()[0].content, /lingerie: bra & knicker set/);
assert.match(E.buildStockPrompt(base, "Alex")[0].content, /item_type/);
const st2 = E.normalizeStock({ items: [{ name: "Green Dream Set", item_type: "succulent", description: "Calm vibes" }, { name: "Mood Thing", item_type: "aura", description: "vibes" }, { name: "Fern pot", item_type: "plant pot", description: "A terracotta plant pot." }] }, base);
assert.deepEqual(st2.items.map((i) => [i.name, i.itemType]), [["Green Dream Succulent", "succulent"], ["Fern pot", "plant pot"]]);
// repair: infer offline, ask the model for the rest, keep unfixable as null
const fakeJson = async (_m, msgs) => { const idx = [...msgs[1].content.matchAll(/index (\d+)/g)].map((x) => Number(x[1])); return JSON.stringify({ items: idx.map((i) => ({ index: i, item_type: i === 1 ? "bodysuit" : "nonsense", colour: "plum", material: "velvet", description: i === 1 ? "A plum velvet bodysuit with a square neck. Glamorous." : "Mysterious." })) }); };
const fx = await all.repair.fixItems([
  { name: "Whisper Dusk Chemise", description: "Dreamy.", allowed: lin },
  { name: "Celestial Whispers Set", description: "Starlight.", allowed: lin },
  { name: "Odd Thing", description: "Hmm.", allowed: lin }], "m", fakeJson);
assert.deepEqual(fx.map((f) => f && [f.name, f.itemType]), [["Whisper Dusk Chemise", "chemise"], ["Celestial Whispers Bodysuit", "bodysuit"], null]);
assert.equal(fx[1].description, "A plum velvet bodysuit with a square neck. Glamorous.");
assert.equal((await all.repair.fixItems([{ name: "Odd Thing", description: "", allowed: lin }], "m", null))[0], null, "no model: left alone");
console.log("unit ok");

let up = false; try { up = (await fetch("http://127.0.0.1:11434/api/tags")).ok; } catch {}
if (!up) { console.log("Ollama not reachable: live skipped"); process.exit(0); }
const t0 = Date.now();
const r = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ model: base.model, messages: E.buildStockPrompt(base, "Alex"), stream: false, format: "json", think: false, options: { temperature: 0.9 } }) });
const stock = E.normalizeStock(all.parseJson((await r.json()).message.content), base);
assert.ok(stock && stock.items.length >= 3, "live stock");
console.log(`live stock (${((Date.now() - t0) / 1000).toFixed(1)}s): ${stock.stallName} - ${stock.tagline}`);
for (const it of stock.items) console.log(`  ${it.emoji} ${it.name} [${it.rarity}] ${it.price} ${it.wearable ? "(wearable) " : ""}- ${it.description}`);
{ const r2 = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ model: base.model, messages: all.mall.buildSeasonalPrompt(new Date(2026, 9, 13)), stream: false, format: "json", think: false, options: { temperature: 0.9 } }) });
  const sp = all.mall.normalizeSeasonal(all.parseJson((await r2.json()).message.content), "2026-10-12");
  assert.ok(sp.length >= 2, "live seasonal");
  console.log("live seasonal:"); for (const it of sp) console.log(`  ${it.emoji} ${it.name} [tier ${it.tier}] ${it.price} ${it.tags.join(",")}${it.wearable ? " (wearable)" : ""} - ${it.description}`); }
{ const call = async (messages) => (await (await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ model: base.model, messages, stream: false, format: "json", think: false, options: { temperature: 0.95 } }) })).json()).message.content;
  const d = M.normalizeDaily(all.parseJson(await call(M.buildDailyPrompt("2026-10-13", ["Cloud lamp"]))), "2026-10-13");
  assert.ok(d.length >= 3, `live daily items (${d.length})`);
  console.log("live daily new:"); for (const it of d) { assert.ok(it.itemType && T.mentionsType(it.name, it.itemType)); console.log(`  ${it.emoji} ${it.name} (${it.itemType}) [${it.dept}, tier ${it.tier}] ${it.price} - ${it.description}`); }
  const ad = A.normalizeAdult(all.parseJson(await call(A.buildAdultPrompt(A.ADULT_CATALOG.map((i) => i.name)))), "2026-10-12");
  console.log(`live After Dark weekly: ${ad.length} items`); for (const it of ad) { assert.ok(it.itemType && T.mentionsType(it.name, it.itemType) && T.mentionsType(it.description.split(".")[0], it.itemType)); console.log(`  ${it.emoji} ${it.name} (${it.itemType}) [${it.dept}] - ${it.description}`); }
  const fixedLive = await all.repair.fixItems([{ name: "Crimson Velvet Set", description: "Passion awaits.", allowed: lin }, { name: "Celestial Whispers Set", description: "Starlight on skin.", allowed: lin }],
    base.model, async (m, msgs, temp) => (await (await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ model: m, messages: msgs, stream: false, format: "json", think: false, options: { temperature: temp } }) })).json()).message.content);
  console.log("live repair:"); for (const f of fixedLive) console.log(`  ${f ? `${f.emoji} ${f.name} (${f.itemType}) - ${f.description}` : "(left as is)"}`); }
console.log("live ok");
