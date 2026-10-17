// v1.3 Living World: relations, feed social, letters & diaries, weather & seasons, character cards. Unit always; live needs Ollama.
import assert from "node:assert/strict";
import * as all from "../dist-test/all.js";
const { world: W, typesMod: T } = all;
const model = process.argv[2] || T.DEFAULT_MODEL;
const mk = (id, name, extra = {}) => ({ ...T.blankCharacter(), id, name, personality: `${name} is kind.`, model, ...extra });
const mira = mk("mira", "Mira"), rex = mk("rex", "Rex"), elo = mk("elowen", "Elowen");
const store = {};
W.setWorldKvForTest(async (k) => store[k] ?? null, async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); });

// ---- (relations) options
assert.deepEqual(W.normalizeWorld(null), W.DEFAULT_WORLD);
assert.equal(W.DEFAULT_WORLD.weather, false, "weather is off until enabled");
assert.equal(W.normalizeWorld({ feedPhotos: "bogus", feedPhotoCap: 99, relations: false }).feedPhotos, "sometimes");
assert.equal(W.normalizeWorld({ feedPhotoCap: 99 }).feedPhotoCap, 4);
assert.equal(W.normalizeWorld({ relations: false }).relations, false);

// ---- (relations) records
assert.equal(W.pairKey("rex", "mira"), "mira|rex");
assert.equal(W.pairKey("mira", "rex"), "mira|rex");
let r = W.blankRelation("rex", "mira");
assert.equal(r.a, "mira"); assert.equal(r.type, "acquaintance");
r = W.normalizeRelation({ type: "nonsense", affinity: 500, opinions: { mira: "  \"he's funny\" ", x: "ignored" }, notes: Array.from({ length: 20 }, (_, i) => ({ t: i, text: `n${i}` })) }, "rex", "mira");
assert.equal(r.type, "acquaintance"); assert.equal(r.affinity, 100); assert.equal(r.opinions.mira, "he's funny"); assert.equal(r.opinions.x, undefined); assert.equal(r.notes.length, 12); assert.equal(r.notes[11].text, "n19");
// auto types: only acquaintance/friend/best friend/rival; never romantic or family by itself
const b0 = W.blankRelation("mira", "rex");
assert.equal(W.applyChange(b0, 10, {}, "").type, "acquaintance");
assert.equal(W.applyChange({ ...b0, affinity: 20 }, 5, {}, "").type, "friend");
assert.equal(W.applyChange({ ...b0, affinity: 68 }, 5, {}, "").type, "best friend");
assert.equal(W.applyChange({ ...b0, affinity: -25 }, -5, {}, "").type, "rival");
assert.equal(W.applyChange({ ...b0, type: "family", family: "sisters", affinity: 95 }, 5, {}, "").type, "family");
assert.equal(W.applyChange({ ...b0, type: "crush", affinity: -90 }, -5, {}, "").type, "crush");
assert.equal(W.applyChange({ ...b0, type: "friend", manual: true, affinity: -90 }, -5, {}, "").type, "friend");
assert.equal(W.applyChange(b0, 99, {}, "").affinity, 10, "one step changes affinity by at most 10");
const noted = W.applyChange(b0, 3, { mira: "sweet", rex: "kind" }, "Mira lent Rex a book", 1234);
assert.equal(noted.notes.at(-1).text, "Mira lent Rex a book"); assert.equal(noted.opinions.rex, "kind"); assert.equal(noted.updatedAt, 1234);
// prompt lines + block
const fam = { ...W.blankRelation("mira", "rex"), type: "family", family: "siblings", affinity: 60, opinions: { mira: "my annoying little brother" } };
const famLine = W.relationLine(mira, rex, fam);
assert.match(famLine, /Rex is family \(siblings\)/); assert.match(famLine, /strictly platonic, never romantic/); assert.match(famLine, /my annoying little brother/);
assert.match(W.relationLine(rex, mira, { ...fam, type: "rival", affinity: -20 }), /friendly rivals/);
assert.doesNotMatch(W.relationLine(rex, mira, fam), /annoying little brother/, "each side sees only their own opinion");
W.setRelationsForTest({ "mira|rex": fam, "elowen|mira": { ...W.blankRelation("elowen", "mira"), type: "friend", affinity: 30, notes: [{ t: 1, text: "Elowen read Mira's tea leaves" }] } });
const blk = W.relationsBlock(mira, [mira, rex, elo], "Alex");
assert.match(blk, /Other people in your life \(also friends of Alex\)/); assert.match(blk, /Rex is family/); assert.match(blk, /Elowen is your friend/); assert.match(blk, /tea leaves/);
assert.equal(W.relationsBlock(mk("zed", "Zed"), [mira, rex], "Alex"), "", "no relations, no block");
// into the system prompt (chat + group + together)
W.installWorldPrompts([mira, rex, elo], "Alex");
const sp = T.buildSystemPrompt(mira, "Alex");
assert.match(sp, /Other people in your life/); assert.match(sp, /Rex is family/);
assert.match(T.buildSystemPrompt(mira, "Alex", { together: "IN PERSON" }), /Rex is family/);
const gt = all.buildGroupTurn(mira, { id: "g1", name: "Tea Club", memberIds: ["mira", "rex"] }, [mira, rex], [], "Alex", [], new Date(), "");
assert.match(gt[0].content, /Rex is family/);
// pair picking: only linked pairs; shared group pairs are favoured; recently updated pairs skipped
W.setRelationsForTest({});
const groups = [{ id: "g1", name: "Tea Club", memberIds: ["mira", "rex"] }];
assert.equal(W.pickPair([mira, rex, elo], groups, {}, 1e12, () => 0.1), null, "nobody linked: no pair");
const linked = { "mira|rex": W.blankRelation("mira", "rex"), "elowen|rex": W.blankRelation("elowen", "rex") };
const pick = W.pickPair([mira, rex, elo], groups, linked, 1e12, () => 0.1);
assert.deepEqual(pick.map((c) => c.id), ["mira", "rex"]);
for (let i = 0; i < 50; i++) assert.notDeepEqual(W.pickPair([mira, rex, elo], groups, linked, 1e12, Math.random).map((c) => c.id).sort(), ["elowen", "mira"], "unlinked pair never picked");
const recent = { ...linked, "mira|rex": { ...W.blankRelation("mira", "rex"), updatedAt: 1e12 - 1000 } };
assert.deepEqual(W.pickPair([mira, rex, elo], groups, recent, 1e12, () => 0).map((c) => c.id), ["rex", "elowen"]);
assert.equal(W.pickPair([mira], groups, linked, 1e12), null);
// pair prompt rules
const pp = W.buildPairPrompt(mira, rex, fam, "Alex: hi\nRex: yo", "Alex");
assert.match(pp[1].content, /family \(siblings\): strictly platonic, never romantic/); assert.match(pp[1].content, /Rex: yo/); assert.match(pp[0].content, /no explicit content/);
assert.match(W.buildPairPrompt(mira, elo, W.blankRelation("mira", "elowen"), "", "Alex")[1].content, /are not romantic/);
// interpret + run with a fake model
assert.equal(W.interpretPair({}, b0, mira, rex), null);
const ip = W.interpretPair({ moment: "Mira brought Rex soup when he was ill", opinionA: "softie", opinionB: "best tea ever", affinityDelta: 40 }, b0, mira, rex, 5);
assert.equal(ip.relation.affinity, 5); assert.equal(ip.relation.opinions.mira, "softie"); assert.equal(ip.relation.opinions.rex, "best tea ever");
let asked = null, nCalls = 0;
const fake = async (m, msgs) => { nCalls++; asked = { m, msgs }; return JSON.stringify({ moment: "Rex beat Mira at Mario Kart and she demanded a rematch", opinionA: "a sore winner", opinionB: "secretly competitive", affinityDelta: 2 }); };
assert.equal(await W.runPairTick([mira, rex, elo], groups, "Alex", async () => [], fake, 2e12, () => 0.1), null, "no links: no tick");
assert.equal(nCalls, 0); assert.deepEqual(store.char_relations ?? {}, {}, "nothing auto-created");
// the user links Mira and Rex: mutual
await W.addRelation("mira", "rex");
assert.ok(W.relationOf("rex", "mira")); assert.ok(W.relationOf("mira", "rex"));
assert.deepEqual(Object.keys(store.char_relations), ["mira|rex"]);
assert.equal((await W.addRelation("rex", "mira")).type, "acquaintance", "adding again keeps the one pair");
assert.equal(Object.keys(store.char_relations).length, 1);
W.installWorldPrompts([mira, rex, elo], "Alex");
assert.match(T.buildSystemPrompt(rex, "Alex"), /Mira/); assert.doesNotMatch(T.buildSystemPrompt(elo, "Alex"), /Other people in your life/, "unlinked: no mentions");
await assert.rejects(W.addRelation("mira", "mira"));
const out = await W.runPairTick([mira, rex, elo], groups, "Alex", async () => [{ id: 1, groupId: "g1", speakerId: "rex", content: "rematch?", createdAt: 1, isError: false }], fake, 2e12, () => 0.1);
assert.equal(out.moment, "Rex beat Mira at Mario Kart and she demanded a rematch"); assert.equal(asked.m, mira.model);
assert.match(asked.msgs[1].content, /Rex: rematch\?/);
assert.equal(store.char_relations["mira|rex"].affinity, 2); assert.equal(store.char_relations["mira|rex"].notes.length, 1);
// outings: linked pairs only
await W.addRelation("rex", "elowen");
await W.noteOuting([mira, rex, elo], "Board game café", "Lots of laughs over Catan.", 3e12);
assert.equal(store.char_relations["mira|rex"].affinity, 4); assert.match(store.char_relations["elowen|rex"].notes[0].text, /Board game café together: Lots of laughs/);
assert.equal(store.char_relations["elowen|mira"], undefined, "unlinked outing pair skipped, not created");
// remove is mutual
await W.removeRelation("elowen", "rex");
assert.equal(W.relationOf("rex", "elowen"), null); assert.equal(store.char_relations["elowen|rex"], undefined);
assert.equal(W.pairHasHistory(W.blankRelation("a", "b")), false); assert.equal(W.pairHasHistory(store.char_relations["mira|rex"]), true);
await W.pruneRelations(["mira", "rex"]);
assert.deepEqual(Object.keys(store.char_relations), ["mira|rex"]);
// one-time cleanup of pairs the old version created by itself
{
  const keepRel = store.char_relations["mira|rex"];
  store.char_relations = { "mira|rex": keepRel, "elowen|mira": W.blankRelation("elowen", "mira"), "a|b": { ...W.blankRelation("a", "b"), manual: true },
    "c|d": { ...W.blankRelation("c", "d"), opinions: { c: "nice" } }, "e|f": { ...W.blankRelation("e", "f"), affinity: 3 }, "g|h": { ...W.blankRelation("g", "h"), type: "friend" }, "i|j": { ...W.blankRelation("i", "j"), updatedAt: 99 } };
  delete store[W.RELATIONS_OPTIN_KEY]; W.resetOptInForTest();
  await W.loadRelations();
  assert.deepEqual(Object.keys(store.char_relations).sort(), ["a|b", "c|d", "e|f", "g|h", "mira|rex"]);
  assert.equal(store[W.RELATIONS_OPTIN_KEY].removed, 2);
  store.char_relations["k|l"] = W.blankRelation("k", "l"); W.resetOptInForTest();
  await W.loadRelations();
  assert.ok(store.char_relations["k|l"], "runs once only: later blank pairs (added by the user) stay");
  store.char_relations = { "mira|rex": keepRel }; await W.loadRelations();
}
console.log("relations unit ok");

// ---- (feedsocial)
{
  const now = 5e12;
  W.setRelationsForTest({ "mira|rex": { ...W.blankRelation("mira", "rex"), type: "friend", affinity: 60 }, "elowen|mira": { ...W.blankRelation("elowen", "mira"), type: "rival", affinity: -60 } });
  const awake = () => true;
  const post = { id: 7, characterId: "mira", content: "new lavender blend at the shop ☕", imagePath: null, createdAt: now - 3600_000, comments: [], likes: [] };
  // old posts are ignored; the poster never reacts to their own post
  assert.equal(W.pickFeedAction([{ ...post, createdAt: now - 30 * 3600_000 }], [mira, rex, elo], awake, undefined, now), null);
  assert.equal(W.pickFeedAction([post], [mira], awake, undefined, now), null);
  // affinity: Rex (60) is far more likely than Elowen (-60) to react
  let rexN = 0, eloN = 0;
  for (let i = 0; i < 400; i++) { const a = W.pickFeedAction([post], [mira, rex, elo], awake, undefined, now, Math.random); if (a?.who.id === "rex") rexN++; if (a?.who.id === "elowen") eloN++; }
  assert.ok(rexN > eloN * 3, `rex ${rexN} vs elowen ${eloN}`);
  // only linked characters react (Elowen unlinked here)
  W.setRelationsForTest({ "mira|rex": { ...W.blankRelation("mira", "rex"), type: "friend", affinity: 60 } });
  for (let i = 0; i < 200; i++) assert.notEqual(W.pickFeedAction([post], [mira, rex, elo], awake, undefined, now, Math.random)?.who.id, "elowen");
  assert.equal(W.pickFeedAction([post], [mira, elo], awake, undefined, now, Math.random), null, "nobody linked to Mira: nothing");
  assert.equal(W.pickFeedAction([{ ...post, likes: ["elowen"], comments: [{ fromUser: false, authorId: "elowen", content: "hi" }] }], [mira, elo], awake, undefined, now, () => 0.1), null, "no reply to an unlinked commenter");
  W.setRelationsForTest({ "mira|rex": { ...W.blankRelation("mira", "rex"), type: "friend", affinity: 60 }, "elowen|mira": { ...W.blankRelation("elowen", "mira"), type: "rival", affinity: -60 } });
  // asleep characters don't react
  assert.equal(W.pickFeedAction([post], [mira, rex], (c) => c.id !== "rex", undefined, now), null);
  // a like first (rand high), then a comment from someone who already liked it
  const like = W.pickFeedAction([post], [mira, rex], awake, undefined, now, () => 0.9);
  assert.equal(like.kind, "like"); assert.equal(like.who.id, "rex");
  const cmt = W.pickFeedAction([{ ...post, likes: ["rex"] }], [mira, rex], awake, undefined, now, () => 0.9);
  assert.equal(cmt.kind, "comment"); assert.equal(cmt.owner.id, "mira");
  // owner answers a friend's comment (latest), but not their own or the user's
  const withC = { ...post, likes: ["rex"], comments: [{ fromUser: false, authorId: "rex", content: "save me a cup!" }] };
  const rep = W.pickFeedAction([withC], [mira, rex], awake, undefined, now, () => 0.1);
  assert.equal(rep.kind, "reply"); assert.equal(rep.who.id, "mira"); assert.equal(rep.to.id, "rex");
  const answered = { ...withC, comments: [...withC.comments, { fromUser: false, authorId: "", content: "always!" }] };
  assert.equal(W.pickFeedAction([answered], [mira, rex], awake, undefined, now, () => 0.1), null, "liked + commented already: nothing more from Rex");
  // max two friend comments per post
  const two = { ...post, likes: ["rex", "elowen"], comments: [{ fromUser: false, authorId: "rex", content: "a" }, { fromUser: false, authorId: "elowen", content: "b" }, { fromUser: false, authorId: "", content: "c" }] };
  assert.equal(W.pickFeedAction([two], [mira, rex, elo, mk("zed", "Zed")], awake, undefined, now, () => 0.9)?.kind ?? "like", "like");
  // prompts
  const sys = (c) => `SYS ${c.name}`;
  const fp = W.buildFriendCommentPrompt(rex, mira, withC, [mira, rex], "Alex", sys);
  assert.match(fp[0].content, /^SYS Rex/); assert.match(fp[0].content, /Your friend Mira posted/); assert.match(fp[0].content, /Rex: save me a cup!/); assert.match(fp[0].content, /Keep it platonic/); assert.match(fp[0].content, /\{"comment":""\}/);
  W.setRelationsForTest({ "mira|rex": { ...W.blankRelation("mira", "rex"), type: "family", family: "siblings" } });
  assert.match(W.buildFriendCommentPrompt(rex, mira, post, [mira, rex], "Alex", sys)[0].content, /Mira is family: warm and strictly platonic/);
  assert.match(W.buildOwnerReplyPrompt(mira, rex, withC, [mira, rex], "Alex", sys)[0].content, /Reply to Rex's latest comment/);
  assert.equal(W.cleanComment({ comment: "  \"so jealous\" " }), "so jealous");
  assert.match(W.buildMomentPostPrompt(mira, rex, "Mira and Rex baked bread", sys)[1].content, /mentioning Rex by name/);
  // running actions against a fake backend
  const calls = [];
  const be = { setFeedLikes: async (id, l) => { calls.push(["likes", id, l]); return l; }, addFeedComment: async (id, fu, t, a) => { calls.push(["comment", id, fu, t, a]); return {}; } };
  const d = { chars: [mira, rex], me: { userName: "Alex" } };
  await all.worldtick.runFeedAction({ kind: "like", post, who: rex }, d, null, be);
  await all.worldtick.runFeedAction({ kind: "comment", post, who: rex, owner: mira }, d, async () => '{"comment":"save me a cup!"}', be);
  await all.worldtick.runFeedAction({ kind: "reply", post: withC, who: mira, to: rex }, d, async () => '{"comment":"always!"}', be);
  assert.deepEqual(calls, [["likes", 7, ["rex"]], ["comment", 7, false, "save me a cup!", "rex"], ["comment", 7, false, "always!", ""]]);
  // the user's comment replies know who the friends are
  const crp = all.life.buildCommentReplyPrompt(mira, "Alex", { ...withC, comments: [...withC.comments, { fromUser: true, content: "me too" }] }, { rex: "Rex" });
  assert.match(crp[0].content, /Rex: save me a cup!/); assert.match(crp[0].content, /Alex: me too/);
  // feed photos: off, frequency and daily cap
  W.setWorldForTest({ feedPhotos: "off" });
  assert.equal(await W.feedPhotoAllowed(true, new Date(2026, 9, 17), () => 0), false);
  W.setWorldForTest({ feedPhotos: "sometimes", feedPhotoCap: 2 });
  const day = new Date(2026, 9, 17, 12);
  assert.equal(await W.feedPhotoAllowed(false, day, () => 0.29), true); assert.equal(await W.feedPhotoAllowed(false, day, () => 0.31), false);
  assert.equal(await W.feedPhotoAllowed(true, day, () => 0.45), true, "asking for an update: at least 50%");
  await W.countFeedPhoto(day); await W.countFeedPhoto(day);
  assert.equal(await W.feedPhotoAllowed(true, day, () => 0), false, "daily cap reached");
  assert.equal(await W.feedPhotoAllowed(true, new Date(2026, 9, 18, 9), () => 0), true, "new day");
  W.setWorldForTest({});
}
console.log("feedsocial unit ok");

// ---- (letters)
{
  const L = all.letters;
  const day = 86_400_000, now = new Date(2026, 9, 17, 19, 0).getTime();
  const c = { ...mira, closeness: 60, proactiveEnabled: true, createdAt: now - 30 * day };
  const st = L.blankLetterState();
  // gaps by frequency, shorter when closer; off = never
  assert.equal(L.letterGapMs(c, "off"), 0);
  assert.ok(L.letterGapMs({ closeness: 35 }, "sometimes") === 5 * day);
  assert.ok(L.letterGapMs({ closeness: 95 }, "sometimes") < 5 * day && L.letterGapMs({ closeness: 100 }, "sometimes") >= 3 * day);
  assert.ok(L.letterGapMs({ closeness: 35 }, "often") < L.letterGapMs({ closeness: 35 }, "rarely"));
  // due: only characters who can message first, closeness 35+, after the gap, about once in 72 checks, max one a day overall
  assert.equal(L.letterDue(c, st, { letters: "sometimes" }, now, () => 0), true);
  assert.equal(L.letterDue(c, st, { letters: "sometimes" }, now, () => 0.5), false);
  assert.equal(L.letterDue(c, st, { letters: "off" }, now, () => 0), false);
  assert.equal(L.letterDue({ ...c, proactiveEnabled: false }, st, { letters: "often" }, now, () => 0), false);
  assert.equal(L.letterDue({ ...c, closeness: 20 }, st, { letters: "often" }, now, () => 0), false);
  assert.equal(L.letterDue(c, { ...st, last: { mira: now - day } }, { letters: "sometimes" }, now, () => 0), false);
  assert.equal(L.letterDue(c, { ...st, lastAny: now - 3600_000 }, { letters: "sometimes" }, now, () => 0), false, "one letter a day overall");
  assert.equal(L.letterDue({ ...c, createdAt: now - day }, st, { letters: "sometimes" }, now, () => 0), false, "new contacts wait for the gap");
  // diaries: closeness 50+, evenings, once a day, only after chatting
  assert.deepEqual([0, 49, 50, 70, 90].map(L.diaryLevel), [0, 0, 1, 2, 3]);
  const eve = new Date(2026, 9, 17, 20, 0);
  assert.equal(L.diaryDue(c, st, { diaries: true }, eve.getTime() - 3600_000, eve), true);
  assert.equal(L.diaryDue(c, st, { diaries: false }, eve.getTime() - 3600_000, eve), false);
  assert.equal(L.diaryDue({ ...c, closeness: 40 }, st, { diaries: true }, eve.getTime() - 3600_000, eve), false);
  assert.equal(L.diaryDue(c, st, { diaries: true }, eve.getTime() - 2 * day, eve), false, "no chat today");
  assert.equal(L.diaryDue(c, st, { diaries: true }, eve.getTime() - 3600_000, new Date(2026, 9, 17, 11)), false, "evenings only");
  assert.equal(L.diaryDue(c, { ...st, diary: { mira: L.dayKey(eve) } }, { diaries: true }, eve.getTime() - 3600_000, eve), false, "once a day");
  // prompts: family stays platonic, romance tasteful, never explicit
  const msgs = [{ id: 1, characterId: "mira", role: "user", content: "the rain is so loud today", createdAt: now, isError: false }];
  const famC = { ...c, life: { relationship: "sibling", weekday: [], weekend: [] } };
  const lp = L.buildLetterPrompt(famC, "Alex", msgs, ["Alex loves lavender tea"], "SYS");
  assert.match(lp[1].content, /Dear Alex,/); assert.match(lp[1].content, /strictly platonic/); assert.match(lp[1].content, /No explicit content/); assert.match(lp[1].content, /lavender tea/); assert.match(lp[1].content, /Alex: the rain is so loud/);
  assert.match(L.buildLetterPrompt({ ...c, life: { relationship: "partner", weekday: [], weekend: [] } }, "Alex", [], [], "SYS")[1].content, /romantic relationship with Alex: loving and tender, but tasteful/);
  const rp = L.buildLetterReplyPrompt(c, "Alex", [{ fromUser: false, body: "Dear Alex, the shop smells of rain." }, { fromUser: true, body: "Dear Mira, I miss it!" }], "SYS");
  assert.match(rp[1].content, /Alex wrote:\nDear Mira, I miss it!/); assert.match(rp[1].content, /Write back/);
  const dp = L.buildDiaryPrompt(famC, "Alex", msgs, 3, "SYS", eve);
  assert.match(dp[1].content, /Dear diary/); assert.match(dp[1].content, /deepest/); assert.match(dp[1].content, /strictly platonic/);
  assert.match(L.buildDiaryPrompt(c, "Alex", [], 1, "SYS", eve)[1].content, /light, honest entry/);
  // interpret
  assert.equal(L.interpretLetter({ letter: "too short" }, "letter"), null);
  const il = L.interpretLetter({ title: " Rainy days ", letter: "Dear Alex,\n\n\n\nThe rain hasn't stopped all week and the shop smells of wet umbrellas.\n\nMira" }, "letter");
  assert.equal(il.title, "Rainy days"); assert.match(il.body, /Dear Alex,\n\nThe rain/);
  assert.equal(L.interpretLetter({ entry: "Dear diary, today Alex told me about the rain and I couldn't stop smiling." }, "diary").title, "Diary");
  // threads: letter + replies grouped, newest activity first
  const ls = [
    { id: 1, kind: "letter", replyTo: 0, characterId: "mira" }, { id: 2, kind: "letter", replyTo: 1, characterId: "mira" },
    { id: 3, kind: "letter", replyTo: 0, characterId: "rex" }, { id: 4, kind: "letter", replyTo: 2, characterId: "mira" }, { id: 5, kind: "diary", replyTo: 0, characterId: "mira" },
  ];
  assert.deepEqual(L.letterThreads(ls).map((t) => t.map((l) => l.id)), [[1, 2, 4], [3]]);
}
console.log("letters unit ok");

// ---- (weather) + (seasonal)
{
  const WX = all.weather, S = all.seasonal, P = all.places, prof = all.profile;
  assert.deepEqual(WX.describeWeather(61), { emoji: "\u{1F326}\uFE0F", text: "light rain", wet: true });
  assert.equal(WX.describeWeather(0, false).text, "clear and starry");
  assert.equal(WX.describeWeather(12345).text, "cloudy");
  assert.equal(WX.seasonFor(new Date(2026, 9, 17)), "autumn"); assert.equal(WX.seasonFor(new Date(2026, 9, 17), -33.9), "spring");
  assert.equal(WX.placeQuery("Exampletown, Examplecounty"), "Exampletown");
  assert.match(WX.geocodeUrl("Exampletown"), /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=Exampletown&count=1/);
  assert.match(WX.forecastUrl(52.0, -1.0), /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=52\.000&longitude=-1\.000&current=temperature_2m,weather_code,is_day,wind_speed_10m/);
  // only with the switch on AND the town shared
  const p = prof.blankProfile("Alex"); p.fields.town = { value: "Exampletown, Examplecounty", share: true };
  assert.equal(WX.weatherAllowed({ weather: false }, p), "");
  assert.equal(WX.weatherAllowed({ weather: true }, { ...p, fields: { ...p.fields, town: { value: "Exampletown", share: false } } }), "");
  assert.equal(WX.weatherAllowed({ weather: true }, p), "Exampletown");
  // fetch, cache 30 min, offline fallback (3 h), off clears it
  const urls = []; let offline = false;
  const fake = async (u) => { urls.push(u); if (offline) throw new Error("offline");
    return { ok: true, json: async () => u.includes("geocoding") ? { results: [{ name: "Exampletown", latitude: 52.0, longitude: -1.0, country: "UK" }] } : { current: { temperature_2m: 11.4, weather_code: 63, is_day: 1, wind_speed_10m: 12 } } }; };
  const t0 = 7e12, on = { weather: true, seasonal: true };
  let w = await WX.refreshWeather(fake, t0, on, p);
  assert.equal(w.tempC, 11); assert.equal(w.place, "Exampletown"); assert.equal(urls.length, 2);
  w = await WX.refreshWeather(fake, t0 + 10 * 60_000, on, p); assert.equal(urls.length, 2, "cached for 30 min");
  w = await WX.refreshWeather(fake, t0 + 31 * 60_000, on, p); assert.equal(urls.length, 3, "geocode cached, forecast refreshed");
  offline = true;
  w = await WX.refreshWeather(fake, t0 + 2 * 3600_000, on, p); assert.equal(w?.tempC, 11, "offline: last known weather");
  w = await WX.refreshWeather(fake, t0 + 5 * 3600_000, on, p); assert.equal(w, null, "too old: simulated weather again");
  offline = false;
  await WX.refreshWeather(fake, t0 + 6 * 3600_000, on, p);
  assert.equal(await WX.refreshWeather(fake, t0 + 6 * 3600_000, { weather: false }, p), null, "switched off");
  assert.equal(WX.currentWeather(), null);
  // context + scene card + photos
  const wet = { tempC: 9, code: 63, isDay: true, wind: 35, fetchedAt: Date.now(), lat: 52.0, place: "Exampletown", query: "Exampletown" };
  const line = WX.worldNowLine("Alex", new Date(2026, 9, 17, 18), wet);
  assert.match(line, /It's autumn\./); assert.match(line, /real weather where Alex lives right now: rainy, 9°C, windy/); assert.doesNotMatch(line, /Exampletown/, "never names the town");
  assert.doesNotMatch(WX.worldNowLine("Alex", new Date(2026, 9, 17, 18), null), /weather/);
  assert.match(WX.worldNowLine("Alex", new Date(2026, 9, 26, 18), null), /Halloween is coming up \(in 5 days\)/);
  WX.setWeatherForTest(wet); WX.installWeather(() => "Alex");
  assert.equal(WX.liveWeatherFor(new Date()).text, "rainy");
  const card = P.sceneCard({ id: "s1", place: "Park", placeId: "park" }, new Date());
  assert.match(card.weather, /rainy, 9°C/, "scene cards use the real weather");
  assert.match(T.buildSystemPrompt(mira, "Alex"), /real weather where Alex lives right now: rainy/);
  assert.equal(WX.photoWorldTag("cosy bedroom", new Date(2026, 9, 17), wet), "", "indoors: nothing");
  assert.equal(WX.photoWorldTag("in the park", new Date(2026, 9, 17), wet), "autumn leaves, rainy weather, wet pavement");
  assert.equal(WX.photoWorldTag("on the beach", new Date(2026, 6, 17), null), "summer");
  const sp = all.selfie.buildSelfiePrompt({ ...mira, appearance: { ...T.blankAppearance(), body: "woman", placeDay: "sunny park bench" } }, "", new Date(2026, 9, 17, 12));
  assert.match(sp.prompt, /park bench.*rainy weather/); assert.match(sp.negative, /nude, nudity, explicit, nsfw, exposed/);
  WX.setWeatherForTest(null);
  assert.doesNotMatch(P.sceneCard({ id: "s1", place: "Park", placeId: "park" }, new Date()).weather, /rainy, 9°C/);
  // seasonal events
  assert.equal(S.eventToday(new Date(2026, 9, 31)).id, "halloween"); assert.equal(S.eventToday(new Date(2026, 9, 30)), null);
  assert.equal(S.eventToday(new Date(2026, 11, 24)).id, "christmas"); assert.equal(S.eventToday(new Date(2027, 0, 1)).id, "newyear");
  assert.equal(S.decorFor(new Date(2026, 9, 17)), null); assert.equal(S.decorFor(new Date(2026, 9, 24)).id, "halloween");
  assert.equal(S.decorFor(new Date(2026, 11, 5)).id, "christmas"); assert.equal(S.decorFor(new Date(2026, 11, 29)).id, "newyear"); assert.equal(S.decorFor(new Date(2027, 0, 1)).id, "newyear");
  assert.equal(S.daysUntil(S.EVENTS[2], new Date(2026, 9, 17)), 14);
  assert.equal(S.daysUntil(S.EVENTS[0], new Date(2026, 11, 30)), 1);
  assert.equal(S.seasonalKey(S.EVENTS[0], new Date(2026, 11, 31)), "newyear-2027"); assert.equal(S.seasonalKey(S.EVENTS[0], new Date(2027, 0, 1)), "newyear-2027");
  assert.match(S.eventNotice(new Date(2026, 11, 24)), /Christmas Eve/); assert.match(S.eventNotice(new Date(2026, 11, 31)), /New Year's Eve/); assert.match(S.eventNotice(new Date(2027, 0, 1)), /New Year's Day/);
  const life = (r) => ({ ...mira, life: { relationship: r, weekday: [], weekend: [] } });
  const val = S.EVENTS[1];
  assert.equal(S.eventMessageNote(val, life("sibling"), "Alex"), null, "no Valentine from family");
  assert.match(S.eventMessageNote(val, life("friend"), "Alex"), /strictly platonic/);
  assert.match(S.eventMessageNote(val, life("partner"), "Alex"), /loving Valentine's/);
  assert.match(S.eventMessageNote(S.EVENTS[2], life("sibling"), "Alex"), /Nothing gory or explicit/);
  assert.match(S.eventPostPrompt(S.EVENTS[3], "SYS", new Date(2026, 11, 25))[1].content, /Today is Christmas/);
}
console.log("weather/seasonal unit ok");

// ---- (cards)
{
  const K = all.cards;
  const v2 = JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: { name: "Rhea", description: "{{char}} is a 27-year-old lighthouse keeper. She was 12 years old when she moved to the coast.",
    personality: "Dry humour, warm underneath. She loves sex jokes. Patient.", scenario: "{{user}} visits the lighthouse.", first_mes: "Oh. Hello, {{user}}.", mes_example: "<START>\n{{user}}: hi\n{{char}}: Hm.",
    alternate_greetings: ["a", "b"], character_book: { entries: [{ keys: ["x"] }] }, tags: ["slice of life"], creator: "someone", extensions: {} } });
  const p = K.parseCard(v2);
  assert.equal(p.spec, "v2"); assert.equal(p.data.name, "Rhea"); assert.equal(p.data.alternateGreetings, 2); assert.ok(p.data.hasLorebook);
  const plan = K.planImport(p.data, "Alex", false);
  assert.equal(plan.refused, ""); assert.equal(plan.age.age, 27, "skips 'was 12 ... when'");
  assert.equal(plan.char.greeting, "Oh. Hello, Alex."); assert.match(plan.char.backstory, /Rhea is a 27-year-old/); assert.match(plan.char.backstory, /Scenario: Alex visits/);
  assert.equal(plan.char.exampleMessages, "Alex: hi\nRhea: Hm.");
  assert.equal(plan.char.personality, "Dry humour, warm underneath. Patient.", "explicit sentence dropped with 18+ off"); assert.equal(plan.removed, 1);
  assert.match(K.planImport(p.data, "Alex", true).char.personality, /sex jokes/, "kept for chat when 18+ is on");
  for (const pl of [plan, K.planImport(p.data, "Alex", true)]) {
    const a = pl.char.appearance; assert.equal([a.body, a.face, a.features, a.style, a.extraTags, a.outfitDay].join(""), "", "nothing from the card in picture fields");
    assert.equal(pl.char.proactiveEnabled, false); assert.equal(a.selfiesUnprompted, false);
  }
  // V1, V3, Kindred, junk
  assert.equal(K.parseCard(JSON.stringify({ name: "Old", description: "d", first_mes: "hey" })).spec, "v1");
  assert.equal(K.parseCard(JSON.stringify({ spec: "chara_card_v3", data: { name: "New" } })).data.name, "New");
  assert.equal(K.parseCard(JSON.stringify({ format: "kindred/1", name: "K" })).spec, "kindred");
  assert.throws(() => K.parseCard("{nope")); assert.throws(() => K.parseCard(JSON.stringify({ spec: "chara_card_v2", data: {} })));
  // ages
  const age = (s, tags) => K.checkAge([s], tags);
  assert.equal(age("She is 17 years old.").minor, true);
  assert.equal(age("A 16yo girl").minor, true);
  assert.equal(age("Age: 15").minor, true);
  assert.equal(age("a high school student who loves chess").minor, true);
  assert.equal(age("she's a loli").minor, true);
  assert.equal(age("nice", ["loli"]).minor, true);
  assert.equal(age("She is 24. Since she was 10 she has painted.").age, 24);
  assert.equal(age("She is 5'4\" and 30 years old").age, 30, "height isn't an age");
  assert.equal(age("He is 175cm tall.").age, null);
  assert.equal(age("Her mother died 15 years ago. She is twenty-ish.").minor, false);
  assert.equal(age("A cheerful teen").age, null); assert.match(age("A cheerful teen").reason, /teen/);
  assert.equal(age("A retired sailor.").age, null);
  assert.equal(age("thirty years old").age, 30);
  // the preview's save rule
  const unknown = K.planImport(K.parseCard(JSON.stringify({ name: "Q", description: "A quiet florist." })).data, "Alex", false);
  assert.equal(unknown.age.age, null); assert.equal(K.ageOk(unknown, NaN), false); assert.equal(K.ageOk(unknown, 17), false); assert.equal(K.ageOk(unknown, 18), true);
  // v1.3: a card describing someone under 18 is no longer refused outright: protected family import only (see the protected block)
  const minor = K.planImport(K.parseCard(JSON.stringify({ name: "Kid", description: "{{char}} is 15 years old." })).data, "Alex", true);
  assert.equal(minor.refused, ""); assert.equal(minor.minor, true); assert.match(minor.age.reason, /"15 years old"/);
  assert.equal(K.ageOk(minor, 30, "child"), false, "can't be imported as an adult"); assert.equal(K.ageOk(minor, 15, ""), false, "needs a family role"); assert.equal(K.ageOk(minor, 15, "child"), true);
  // family + romance
  const fr = K.planImport(K.parseCard(JSON.stringify({ name: "S", description: "{{char}} is your step-sister, 22 years old, and secretly in love with {{user}}." })).data, "Alex", true);
  assert.match(fr.refused, /never romantic/);
  assert.equal(K.planImport(K.parseCard(JSON.stringify({ name: "S", description: "{{char}} is your sister, 22 years old, who teases you." })).data, "Alex", true).refused, "");
  // export round trip
  const c = { ...mira, speakingStyle: "short, wry", color: "#123456", appearance: { ...mira.appearance, age: 31, body: "SECRET-LOOKS" } };
  const out = JSON.parse(K.toV2Card(c));
  assert.equal(out.spec, "chara_card_v2"); assert.equal(out.data.name, c.name); assert.equal(out.name, c.name); assert.equal(out.data.first_mes, c.greeting);
  assert.doesNotMatch(K.toV2Card(c), /SECRET-LOOKS/);
  const back = K.planImport(K.parseCard(K.toV2Card(c)).data, "Alex", true);
  assert.equal(back.char.speakingStyle, "short, wry"); assert.equal(back.char.color, "#123456"); assert.equal(back.age.age, 31);
}
console.log("cards unit ok");

// ---- (protected) under-18 family characters: one helper, every rule
{
  const P = all.protect, LC = all.lifecore, SP = all.scenephoto, TG = all.together, AD = all.afterdark, IG = all.imagegen, K = all.cards;
  const kid = mk("tom", "Tom", { appearance: { ...T.blankAppearance(), age: 9, body: "boy" }, life: { relationship: "child", relationshipDetail: "son", weekday: [], weekend: [] } });
  const badKid = { ...kid, id: "tim", name: "Tim", life: { relationship: "partner", weekday: [], weekend: [] } };
  const adult = mk("ella", "Ella", { appearance: { ...T.blankAppearance(), age: 30, body: "woman" }, life: { relationship: "partner", weekday: [], weekend: [] } });
  // the helper
  assert.equal(P.isProtectedMinor(kid), true); assert.equal(P.isProtectedMinor(adult), false); assert.equal(P.isProtectedMinor({ appearance: {} }), false);
  assert.equal(P.isProtectedMinor({ appearance: { minor: true } }), true, "age unknown + marked as a child"); assert.equal(P.isProtectedMinor({ appearance: { age: 18 } }), false);
  // 1. age rule: under 18 only as family; Save is blocked otherwise (also at the api layer)
  assert.equal(P.ageRuleError(kid), "");
  assert.match(P.ageRuleError(badKid), /Tim is under 18, so they can only be family/);
  for (const r of ["sibling", "cousin", "grandchild", "nibling"]) assert.equal(P.ageRuleError({ ...kid, life: { relationship: r } }), "", r);
  for (const r of ["friend", "crush", "parent", "grandparent", "mentor", "custom"]) assert.notEqual(P.ageRuleError({ ...kid, life: { relationship: r } }), "", r);
  await assert.rejects(all.apiMod.saveCharacter(badKid), /under 18, so they can only be family/);
  assert.match(P.relationChangeError(kid, "partner"), /only a family relationship/); assert.equal(P.relationChangeError(kid, "sibling"), ""); assert.equal(P.relationChangeError(adult, "partner"), "");
  assert.ok(LC.REL_OPTIONS.some((o) => o.id === "grandchild") && LC.REL_OPTIONS.some((o) => o.id === "nibling")); assert.ok(LC.isFamily("grandchild") && LC.isFamily("nibling"));
  assert.match(LC.REL_OPTIONS.find((o) => o.id === "child").label, /son \/ daughter/);
  // backstop: bad data still behaves as family, never evolves
  assert.equal(LC.lifeOf(badKid).relationship, "child"); assert.equal(LC.lifeOf(badKid).canEvolve, false);
  assert.equal(LC.evolutionDue({ ...kid, closeness: 99, life: { relationship: "friend", canEvolve: true } }), null);
  assert.equal(T.appearanceOf(kid).age, 9); assert.equal(T.appearanceOf({ appearance: { ...kid.appearance, selfiesUnprompted: true } }).selfiesUnprompted, false);
  // 2. no pictures: selfies, avatar/looks generation, scene + group photos, and the hard guard in generateImage
  P.installProtect(() => [kid, adult]);
  assert.throws(() => all.selfie.buildSelfiePrompt(kid, ""), /Tom is under 18 and protected/);
  assert.match((await all.selfie.selfieSetup(kid)).reason, /never pictures of them/);
  await assert.rejects(all.autogen.generateField(kid, "Alex", "a.body"), /protected/);
  assert.match(P.imageGuard({ prompt: "portrait", meta: { source: "selfie", characterId: "tom" } }), /Tom is under 18/);
  assert.match(P.imageGuard({ prompt: "x", meta: { source: "scene", people: ["ella", "tom"] } }), /Tom/);
  assert.match(P.imageGuard({ prompt: "Tom and Ella at the beach", meta: { source: "studio" } }), /mentions Tom/, "Image Studio refuses prompts naming them");
  assert.equal(P.imageGuard({ prompt: "tomato soup", meta: { source: "studio" } }), "", "whole words only");
  assert.equal(P.imageGuard({ prompt: "an empty park", meta: { source: "place" } }), "");
  assert.equal(P.imageGuard({ prompt: "empty park", meta: { source: "scene", characterId: "tom", noPeople: true } }), "");
  assert.equal(P.imageGuard({ prompt: "Ella smiling", meta: { source: "selfie", characterId: "ella" } }), "");
  await assert.rejects(IG.generateImage({ ...IG.DEFAULT_PARAMS, prompt: "Tom waving", meta: { source: "studio" } }, () => {}), /mentions Tom/);
  const card = { place: "Park", placeId: "park", tod: "afternoon", outdoor: true, weather: "\u2600\uFE0F sunny, 18\u00B0C" };
  const solo = SP.scenePhotoPrompt(kid, card, true, "woman with auburn hair");
  assert.equal(solo.noPeople, true); assert.doesNotMatch(solo.prompt, /boy|year old|auburn/); assert.match(solo.caption, /The view/);
  const sp = SP.scenePhotoParams({ ...IG.DEFAULT_PARAMS, loras: [{ path: "l", strength: 1 }] }, kid, solo);
  assert.equal(sp.meta.noPeople, true); assert.deepEqual(sp.loras, []); assert.equal(P.imageGuard(sp), "");
  const grp = SP.groupScenePhotoPrompt([adult, kid], card, false, "");
  assert.deepEqual(grp.people, ["ella"]); assert.doesNotMatch(grp.caption, /Tom/); assert.doesNotMatch(grp.prompt, /\b9 year old|boy/);
  assert.equal(P.imageGuard(SP.scenePhotoParams(IG.DEFAULT_PARAMS, kid, grp)), "", "group photo of the adults, posted by the child: allowed");
  const onlyKids = SP.groupScenePhotoPrompt([kid, { ...kid, id: "amy", name: "Amy" }], card, true, "woman with auburn hair");
  assert.equal(onlyKids.noPeople, true, "only protected characters (and the user): background-only place photo"); assert.doesNotMatch(onlyKids.prompt, /auburn/);
  // 3. no romance or 18+ content, whatever the 18+ switch says
  all.economy.setAdultFlag?.(true);
  const sys = T.buildSystemPrompt(kid, "Alex");
  assert.match(sys, /you are a minor \(9 years old\)/); assert.match(sys, /never engage in or respond to romantic, flirtatious or sexual content/); assert.doesNotMatch(sys, /Your appearance/);
  assert.match(T.buildSystemPrompt(badKid, "Alex"), /you are a minor/);
  assert.doesNotMatch(T.buildSystemPrompt(adult, "Alex"), /you are a minor/);
  const chk = AD.adultGiftCheck(kid, true); assert.equal(chk.ok, false); assert.match(chk.reason, /under 18 and protected/);
  assert.equal(AD.adultGiftCheck({ ...badKid, life: { relationship: "partner" } }, true).ok, false);
  assert.equal(all.connected.canGiveAdult(kid, true), false);
  assert.deepEqual(TG.activityChoices(badKid), ["hangout"], "no dates"); assert.deepEqual(TG.activityChoices(adult), ["date", "hangout"]);
  const tp = TG.togetherPrompt(kid, "Alex", { place: "Park", activity: "date" }, true);
  assert.match(tp, /\(a hangout\)/); assert.doesNotMatch(tp, /suggestive|a date/); assert.match(tp, /under 18 and this is a family outing/);
  const gp = TG.groupTogetherPrompt(adult, "Fam", [adult, kid], "Alex", { place: "Zoo" });
  assert.match(gp, /Tom is under 18: the whole outing is strictly family-friendly/);
  assert.doesNotMatch(TG.groupTogetherPrompt(adult, "Fam", [adult], "Alex", { place: "Zoo" }), /under 18/);
  assert.equal(all.seasonal.eventMessageNote(all.seasonal.EVENTS[1], badKid, "Alex"), null, "no Valentine's from them");
  assert.match(all.letters.buildLetterPrompt(badKid, "Alex", [], [], "SYS")[1].content, /platonic|family/i);
  // relations: never crush / partner with them
  assert.equal(P.pairTypeAllowed("crush", kid, adult), false); assert.equal(P.pairTypeAllowed("best friend", kid, adult), true); assert.equal(P.pairTypeAllowed("partner", adult, mira), true);
  W.installWorldPrompts([kid, adult], "Alex");
  await W.saveRelation({ ...W.blankRelation("tom", "ella"), type: "partner" });
  assert.equal(W.relationOf("tom", "ella").type, "friend", "a romantic type is never stored for them");
  assert.match(W.buildPairPrompt(kid, adult, W.relationOf("tom", "ella"), "", "Alex")[1].content, /Tom is under 18: everything between them is wholesome/);
  await W.removeRelation("tom", "ella");
  // 4. card import
  const pc = (d, tags = []) => K.planImport(K.parseCard(JSON.stringify({ spec: "chara_card_v2", data: { name: "Sam", tags, ...d } })).data, "Alex", true);
  const ok = pc({ description: "{{char}} is 12 years old. He loves football and dinosaurs. He has a crush on a girl in his class.", first_mes: "Hi! Can we go to the park?" });
  assert.equal(ok.refused, ""); assert.equal(ok.minor, true); assert.equal(ok.age.trigger, "12 years old"); assert.match(ok.age.reason, /"12 years old"/, "the exact trigger is shown");
  assert.doesNotMatch(ok.char.backstory, /crush/); assert.match(ok.char.backstory, /dinosaurs/); assert.ok(ok.removed >= 1);
  assert.equal(ok.char.avatar, "\u{1F642}"); assert.equal(ok.char.appearance.body, ""); assert.ok(ok.notes.some((n) => /card's picture isn't used/.test(n)));
  assert.equal(K.ageOk(ok, 12, ""), false); assert.equal(K.ageOk(ok, 12, "partner"), false); assert.equal(K.ageOk(ok, 25, "child"), false); assert.equal(K.ageOk(ok, 12, "sibling"), true);
  const rom = pc({ description: "{{char}} is 15 years old and in love with {{user}}. She flirts constantly. She wants to kiss you." });
  assert.match(rom.refused, /under 18 \("15 years old"\) and is sexual or romantic in nature \("in love"\)/); assert.equal(K.ageOk(rom, 15, "child"), false);
  assert.match(pc({ description: "A 14 year old. NSFW roleplay." }).refused, /"NSFW"/);
  assert.match(pc({ description: "A cute girl." }, ["loli"]).refused, /"loli"/);
  assert.match(pc({ description: "High school student, best at maths." }).age.reason, /"High school student"/);
  assert.equal(pc({ description: "She is 24 and runs a bakery." }).minor, false);
  // export of a protected character says so (and round-trips as protected)
  const ex = JSON.parse(K.toV2Card(kid)); assert.match(ex.data.creator_notes, /protected family character \(9/); assert.equal(ex.data.extensions.kindred.age, 9);
  assert.equal(K.planImport(K.parseCard(K.toV2Card(kid)).data, "Alex", true).minor, true);
  P.installProtect(() => []);
}
console.log("protected unit ok");
