// Together mode (Milestone 15 part 1): prompt wording, *action* parsing + rendering, scene markers, end/recap flow with a fake model, then a live run.
import assert from "node:assert/strict";
import * as all from "../dist-test/all.js";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
const { together: T, typesMod, ActionText, parseJson } = all;
const model = process.argv[2] || typesMod.DEFAULT_MODEL;
const mk = (rel, extra = {}) => ({ ...typesMod.blankCharacter(), id: "c1", name: "Lily", personality: "Sweet, bubbly florist.", closeness: 60, model,
  life: { relationship: rel, weekday: [], weekend: [] }, ...extra });

// ---- activity choices: dates only for romantic relationships
assert.deepEqual(T.activityChoices(mk("partner")), ["date", "hangout"]);
assert.deepEqual(T.activityChoices(mk("crush")), ["date", "hangout"]);
assert.deepEqual(T.activityChoices(mk("friend")), ["hangout"]);
assert.deepEqual(T.activityChoices(mk("grandparent")), ["hangout"]);

// ---- schedule: asleep / busy means no, with an in-character reason
const sched = { weekday: [{ start: "00:00", activity: "asleep", place: "in bed", status: "sleeping" }, { start: "09:00", activity: "arranging bouquets at the shop", place: "flower shop", status: "busy" }, { start: "18:00", activity: "relaxing", place: "home", status: "online" }] };
sched.weekend = sched.weekday;
const sc = mk("friend", { life: { relationship: "friend", ...sched } });
const at = (h) => { const d = new Date(2026, 9, 14, h, 0); return d; };
let can = T.canMeetNow(sc, at(3)); assert.equal(can.ok, false); assert.match(can.reason, /asleep/); assert.match(can.line, /tomorrow/);
can = T.canMeetNow(sc, at(11)); assert.equal(can.ok, false); assert.match(can.reason, /busy: arranging bouquets/); assert.match(can.line, /arranging bouquets/);
assert.equal(T.canMeetNow(sc, at(19)).ok, true);
assert.equal(T.canMeetNow({ ...sc, status: "busy" }, at(19)).ok, false);

// ---- prompt wording
const scene = { place: "picnic in the park", activity: "date" };
const pPartner = T.togetherPrompt(mk("partner", { closeness: 80 }), "Alex", scene, false);
assert.match(pPartner, /TOGETHER IN PERSON/); assert.match(pPartner, /\*asterisks\*/); assert.match(pPartner, /first person/);
assert.match(pPartner, /Never mention phones, texting/); assert.match(pPartner, /one to four sentences/);
assert.match(pPartner, /openly loving/); assert.match(pPartner, /keep it wholesome/); assert.match(pPartner, /\[END_SCENE\]/);
const pAdult = T.togetherPrompt(mk("partner", { closeness: 80 }), "Alex", scene, true);
assert.match(pAdult, /suggestive/); assert.match(pAdult, /fade to black/); assert.match(pAdult, /never describe sexual acts/);
const pFam = T.togetherPrompt(mk("grandparent"), "Alex", { place: "tea at hers", activity: "hangout" }, true);
assert.match(pFam, /strictly platonic/); assert.doesNotMatch(pFam, /suggestive/); assert.match(pFam, /keep it wholesome/, "18+ never applies to family");
const pFriend = T.togetherPrompt(mk("friend"), "Alex", { place: "arcade", activity: "hangout" }, true);
assert.match(pFriend, /platonic/); assert.match(pFriend, /No romance/); assert.doesNotMatch(pFriend, /suggestive/);
assert.match(T.togetherPrompt(mk("partner", { closeness: 20 }), "Alex", scene, false), /shy and a little nervous/);
// system prompt swaps the messenger framing
const sysT = typesMod.buildSystemPrompt(mk("partner"), "Alex", { together: pPartner });
assert.match(sysT, /spending time with Alex in person/); assert.doesNotMatch(sysT, /over an instant messenger/); assert.doesNotMatch(sysT, /Reply like a real person on instant messaging/);
assert.match(typesMod.buildSystemPrompt(mk("partner"), "Alex"), /over an instant messenger/, "messenger mode unchanged");

// ---- action parsing
assert.deepEqual(T.splitActions("*smiles* hi there! *takes your hand*"), [{ kind: "action", text: "smiles" }, { kind: "speech", text: " hi there! " }, { kind: "action", text: "takes your hand" }]);
assert.deepEqual(T.splitActions("no actions here"), [{ kind: "speech", text: "no actions here" }]);
assert.equal(T.hasActions("this is **bold** not an action"), false);
assert.equal(T.hasActions("2 * 3 * 4"), false, "maths stays speech");
assert.equal(T.hasActions("*waves*"), true);
assert.equal(T.hasActions("an * unclosed star"), false);
// rendering: styled action spans, plain speech, safe escaping
const html = renderToStaticMarkup(createElement(ActionText, { text: "*grins* you came! <3" }));
assert.match(html, /<span class="act">grins<\/span>/); assert.match(html, /you came! &lt;3/);
assert.equal(renderToStaticMarkup(createElement(ActionText, { text: "just text" })), "just text");

// ---- wrap-up flag
assert.deepEqual(T.detectWrap("*hugs you* get home safe! [END_SCENE]"), { text: "*hugs you* get home safe!", ended: true });
assert.deepEqual(T.detectWrap("still here"), { text: "still here", ended: false });
assert.equal(T.detectWrap("bye [end scene]").ended, true);

// ---- scene state, markers and history narration
const s = T.newScene("c1", "  the riverside café  ", "hangout", 1000);
assert.equal(s.status, "active"); assert.equal(s.place, "the riverside café"); assert.match(s.id, /^s/);
assert.equal(T.proactivePaused(s), true); assert.equal(T.proactivePaused({ ...s, status: "paused" }), false); assert.equal(T.proactivePaused(null), false);
assert.equal(T.pauseOnStartup(s).status, "paused", "app closed mid-scene: paused"); assert.equal(T.pauseOnStartup({ ...s, status: "ended" }).status, "ended");
const startM = T.sceneMarker({ phase: "start", id: s.id, place: s.place, activity: "hangout" });
const endM = T.sceneMarker({ phase: "end", id: s.id, place: s.place, activity: "hangout", recap: "They shared cake." });
assert.equal(typesMod.isEventText(startM), true, "markers go to the model as system narration");
assert.match(typesMod.toModelText(startM, true, "Alex", "Lily"), /\[Event: Alex and you \(Lily\) met up IN PERSON for a hangout: the riverside café/);
assert.match(typesMod.toModelText(endM, true, "Alex", "Lily"), /has ended.*back to texting.*They shared cake\..*never contradict/);
assert.match(T.sceneLine(T.parseSceneMarker(startM), "Lily"), /You met up with Lily/);
assert.equal(T.parseSceneMarker("hello"), null);

// ---- end / recap flow with a fake model
const prompts = [];
const fake = async (m, msgs, temp) => { prompts.push({ m, msgs, temp }); return JSON.stringify({ recap: "Alex and Lily had coffee and laughed a lot.", memory: "Alex loves oat lattes.", post: "Best coffee date ☕", rating: 5, mood: "happy", follow_up: "had a great time today!" }); };
const transcript = T.sceneTranscript([{ from: "me", text: startM }, { from: "me", text: "*sits down* this place is cute" }, { from: "them", text: "*beams* I knew you'd like it!" }], "Alex", "Lily");
assert.doesNotMatch(transcript, /\[scene\]/); assert.match(transcript, /Alex: \*sits down\*/); assert.match(transcript, /Lily: \*beams\*/);
const r = await T.runRecap(mk("partner"), "Alex", s, transcript, fake, parseJson);
assert.equal(prompts.length, 1); assert.equal(prompts[0].m, model); assert.match(prompts[0].msgs[0].content, /Respond only with JSON/); assert.match(prompts[0].msgs[1].content, /sits down/);
assert.deepEqual([r.rating, r.mood, r.followUp], [5, "happy", "had a great time today!"]);
assert.equal(T.closenessAfter(60, r.rating), 65); assert.equal(T.closenessAfter(98, 5), 100); assert.equal(T.closenessAfter(1, 1), 0); assert.equal(T.closenessAfter(50, 3), 51);
// junk from the model is clamped / defaulted
const bad = await T.runRecap(mk("friend"), "Alex", s, "", async () => '{"rating": 99, "mood": "ecstatic"}', parseJson);
assert.equal(bad.rating, 5); assert.equal(bad.mood, "cosy"); assert.match(bad.recap, /spent time together/); assert.match(bad.memory, /met up with Alex/);
assert.equal((await T.runRecap(mk("friend"), "Alex", s, "", async () => "not json", parseJson)).rating, 3);
assert.deepEqual(T.firstMilestone("date", "Lily"), { kind: "first_date", title: "First date with Lily" });
assert.deepEqual(T.firstMilestone("hangout", "Lily"), { kind: "first_hangout", title: "First hangout with Lily" });
console.log("together unit ok");

// ---- (planlater) Plan for later
{
  const d = (y, mo, da, h, mi = 0) => new Date(y, mo, da, h, mi).getTime();
  // schedule from above: asleep 00:00, busy 09:00, free 18:00 (every day)
  const wed11 = new Date(2026, 9, 14, 11, 0); // Wednesday 11:00, busy
  assert.equal(T.nextFreeAt(sc, wed11).getTime(), d(2026, 9, 14, 18), "next free = today 18:00");
  assert.equal(T.nextFreeAt(sc, new Date(2026, 9, 14, 23, 0)).getTime(), d(2026, 9, 15, 18), "after the evening block: tomorrow 18:00");
  assert.equal(T.nextFreeAt(mk("friend"), wed11).getTime(), d(2026, 9, 15, 18), "no schedule: tomorrow 18:00");
  assert.equal(T.resolveWhen("tonight", sc, wed11).getTime(), d(2026, 9, 14, 19));
  assert.equal(T.resolveWhen("tonight", sc, new Date(2026, 9, 14, 19, 10)).getTime(), d(2026, 9, 15, 19), "too late tonight: tomorrow night");
  assert.equal(T.resolveWhen("tomorrow_afternoon", sc, wed11).getTime(), d(2026, 9, 15, 14));
  assert.equal(T.resolveWhen("this_weekend", sc, wed11).getTime(), d(2026, 9, 17, 14), "Wed -> Sat 14:00");
  assert.equal(T.resolveWhen("this_weekend", sc, new Date(2026, 9, 17, 15)).getTime(), d(2026, 9, 18, 14), "Sat afternoon -> Sun");
  assert.equal(T.resolveWhen("this_weekend", sc, new Date(2026, 9, 18, 10)).getTime(), d(2026, 9, 18, 14), "Sun morning -> today");
  assert.equal(T.resolveWhen("at", sc, wed11, "2026-10-20T15:30").getTime(), d(2026, 9, 20, 15, 30), "date picker");
  assert.equal(T.resolveWhen("at", sc, wed11, "2020-01-01T10:00").getTime(), d(2026, 9, 14, 18), "past pick falls back to next free");

  const p = T.newPlan("c1", " coffee by the river ", "hangout", "tonight", d(2026, 9, 14, 19), wed11.getTime());
  assert.equal(p.status, "planned"); assert.equal(p.place, "coffee by the river");
  assert.match(T.planSummary(p, "Lily"), /Hangout with Lily · coffee by the river ·/);
  assert.equal(T.openPlans([p, { ...p, id: "x", status: "cancelled" }, { ...p, id: "y", charId: "c2" }], "c1").length, 1);

  // not yet due: nothing
  let r = T.tickPlan(p, sc, "online", false, d(2026, 9, 14, 18, 30));
  assert.equal(r.plan, p); assert.equal(r.notify, false);
  // due and both free: ready + notify
  r = T.tickPlan(p, sc, "online", false, d(2026, 9, 14, 19, 1));
  assert.equal(r.plan.status, "ready"); assert.equal(r.notify, true);
  // quiet hours: ready (Start card shows) but no noisy notification
  r = T.tickPlan(p, sc, "online", true, d(2026, 9, 14, 19, 1));
  assert.equal(r.plan.status, "ready"); assert.equal(r.notify, false, "quiet hours: silent");
  // she's Busy / Appear offline: defer
  assert.equal(T.tickPlan(p, sc, "busy", false, d(2026, 9, 14, 19, 1)).plan.status, "planned");
  assert.equal(T.tickPlan(p, sc, "offline", false, d(2026, 9, 14, 19, 1)).plan.status, "planned");
  // character still busy at the planned time: wait (fixed time) / re-aim (next free)
  const busyAt = d(2026, 9, 15, 10);
  assert.equal(T.tickPlan({ ...p, dueAt: d(2026, 9, 15, 9, 30) }, sc, "online", false, busyAt).plan.status, "planned");
  const nf = T.tickPlan({ ...p, when: "next_free", dueAt: d(2026, 9, 15, 9, 30) }, sc, "online", false, busyAt);
  assert.equal(nf.plan.status, "planned"); assert.equal(nf.plan.dueAt, d(2026, 9, 15, 18), "next free re-aimed to 18:00");
  // already notified once: no second ping
  assert.equal(T.tickPlan({ ...p, notified: true }, sc, "online", false, d(2026, 9, 14, 19, 1)).notify, false);

  // Start button
  assert.equal(T.canStartPlan({ ...p, status: "ready" }, sc, new Date(2026, 9, 14, 19, 5)), true);
  assert.equal(T.canStartPlan({ ...p, status: "ready" }, sc, new Date(2026, 9, 15, 3)), false, "ready but asleep now");
  assert.equal(T.canStartPlan(p, sc, new Date(2026, 9, 14, 11)), false, "planned while busy");
  assert.equal(T.canStartPlan(p, sc, new Date(2026, 9, 14, 18, 30)), true, "free early: may start now");

  // character context
  const pp = T.planPrompt([p], "Alex", d(2026, 9, 14, 12));
  assert.match(pp, /planned hangout with Alex: coffee by the river \(today at 19:00\)/); assert.match(pp, /looking forward/); assert.match(pp, /don't nag/);
  assert.equal(T.planPrompt([{ ...p, status: "cancelled" }], "Alex"), "");
  assert.equal(T.formatDue(d(2026, 9, 15, 14), d(2026, 9, 14, 12)), "tomorrow at 14:00");
  console.log("planlater unit ok");
}

// ---- (together2) places, scene card, narrator, costs, invites, intent, follow-up toggle
{
  const P = all.places;
  assert.ok(P.PLACES.length >= 14);
  for (const p of P.PLACES) { assert.ok(p.emoji && p.name && p.ambience && p.kinds.length, p.id); assert.ok(p.cost >= 0); }
  for (const id of ["park", "their_place", "your_place"]) assert.equal(P.findPlace(id).cost, 0);
  assert.ok(P.findPlace("cafe").cost > 0 && P.findPlace("cinema").cost > 0);
  assert.ok(P.placesFor("hangout").every((p) => p.kinds.includes("hangout")));
  assert.ok(!P.placesFor("hangout").some((p) => p.id === "stargazing")); // date-only
  assert.equal(P.placeFromText("coffee by the river").id, "cafe");
  assert.equal(P.placeFromText("a hangout at the park").id, "park"); // Alex's existing plan text still maps (free)
  assert.equal(P.placeFromText("somewhere weird"), null);
  assert.equal(P.placeText("cafe", "by the river", ""), "Caf\u00E9 (by the river)");
  assert.equal(P.placeText("other", "", "  canal picnic "), "canal picnic");
  // costs
  assert.equal(P.costShare(30, "me"), 30); assert.equal(P.costShare(35, "split"), 18); assert.equal(P.costShare(30, "them"), 0); assert.equal(P.costShare(0, "me"), 0);
  assert.match(P.freeSuggestion("date"), /Park/); assert.doesNotMatch(P.freeSuggestion("date"), /Cinema/);
  assert.match(P.payLine("split", 30, "Alex", "Lily"), /split/); assert.equal(P.payLine("me", 0, "Alex", "Lily"), "");
  assert.equal(P.canTreat({ closeness: 70 }), true); assert.equal(P.canTreat({ closeness: 30 }), false);
  // scene card: real clock time of day, stable believable weather, mood
  const d = new Date(2026, 9, 14, 17, 30);
  assert.equal(P.timeOfDay(d), "evening"); assert.equal(P.timeOfDay(new Date(2026, 9, 14, 9)), "morning"); assert.equal(P.timeOfDay(new Date(2026, 9, 14, 23)), "night");
  assert.equal(P.seasonOf(d), "autumn"); assert.equal(P.seasonOf(new Date(2026, 0, 5)), "winter"); assert.equal(P.seasonOf(new Date(2026, 6, 5)), "summer");
  const w1 = P.weatherFor("s123", d), w2 = P.weatherFor("s123", d);
  assert.deepEqual(w1, w2);
  for (let i = 0; i < 40; i++) { const w = P.weatherFor("x" + i, d); assert.ok(w.temp >= 3 && w.temp <= 17, `autumn temp ${w.temp}`); }
  for (let i = 0; i < 40; i++) { const w = P.weatherFor("y" + i, new Date(2026, 6, 5, 14)); assert.ok(w.temp >= 16 && !/snow/.test(w.text)); }
  for (let i = 0; i < 40; i++) assert.doesNotMatch(P.weatherFor("n" + i, new Date(2026, 6, 5, 23)).text, /sunny/);
  const card = P.sceneCard({ id: "s1", place: "Park", placeId: "park" }, d);
  assert.equal(card.emoji, "\u{1F333}"); assert.equal(card.time, "17:30"); assert.equal(card.tod, "evening"); assert.ok(card.outdoor);
  assert.match(card.weather, /\u00B0C/); assert.match(card.mood, /trees/);
  const old = P.sceneCard({ id: "s2", place: "picnic in the park" }, d); // older scene without placeId
  assert.equal(old.emoji, "\u{1F333}");
  assert.match(P.sceneSetting(card), /Setting: Park, evening \(17:30\)/);
  // narrator
  assert.deepEqual(P.narrateCommand(">>"), { hint: "" });
  assert.deepEqual(P.narrateCommand("/narrate a busker starts playing"), { hint: "a busker starts playing" });
  assert.equal(P.narrateCommand("hello >> there"), null);
  const mkN = (t) => T.sceneMarker({ phase: "narrate", id: "s1", place: "Park", activity: "date", text: t });
  const isN = (t) => T.parseSceneMarker(t)?.phase === "narrate", isM = (t) => !!T.parseSceneMarker(t);
  const start = T.sceneMarker({ phase: "start", id: "s1", place: "Park", activity: "date" });
  const conv = [{ from: "me", text: start }, { from: "me", text: mkN("You arrive.") }, { from: "them", text: "hi" }, { from: "me", text: "a" }, { from: "them", text: "b" }, { from: "me", text: "c" }];
  assert.equal(P.turnsSinceNarration(conv, isN, isM), 2);
  assert.equal(P.turnsSinceNarration([{ from: "me", text: start }, { from: "me", text: "1" }, { from: "me", text: "2" }], isN, isM), 2);
  assert.equal(P.shouldNarrate(4, true), true); assert.equal(P.shouldNarrate(3, true), false); assert.equal(P.shouldNarrate(9, false), false); assert.equal(P.shouldNarrate(4, undefined), true);
  const nm = P.narratorMessages(card, "Alex", "Lily", "Alex: hi", "", true);
  assert.match(nm[0].content, /second person/); assert.match(nm[0].content, /JSON/); assert.match(nm[0].content, /opening/);
  assert.equal(P.cleanNarration({ narration: ' "The ducks squabble." ' }), "The ducks squabble.");
  assert.equal(P.cleanNarration({}), "");
  assert.match(P.fallbackNarration(card, "Lily", true), /You arrive at Park/);
  assert.ok(P.fallbackNarration(card, "Lily", false, () => 0).length > 5);
  // narration marker round trip + model text
  const nmk = T.parseSceneMarker(mkN("A breeze rustles the leaves."));
  assert.equal(nmk.phase, "narrate"); assert.equal(nmk.text, "A breeze rustles the leaves.");
  assert.equal(typesMod.toModelText(mkN("A breeze."), true, "Alex", "Lily"), "[Narration: A breeze.]");
  assert.equal(typesMod.isEventText(mkN("x")), true);
  assert.match(T.sceneTranscript(conv, "Alex", "Lily"), /\(narrator: You arrive\.\)/);
  assert.doesNotMatch(T.sceneTranscript(conv, "Alex", "Lily"), /\[scene\]/);
  // invites
  assert.equal(P.inviteChance({ closeness: 20, life: { relationship: "friend" } }), 0);
  const cf = P.inviteChance({ closeness: 70, life: { relationship: "friend" } }), cp = P.inviteChance({ closeness: 70, life: { relationship: "partner" } });
  assert.ok(cf > 0 && cp > cf && cp <= 0.22);
  assert.ok(P.inviteChance({ closeness: 100, life: { relationship: "friend" } }) > P.inviteChance({ closeness: 40, life: { relationship: "friend" } }));
  const inv = P.pickInvite(mk("friend", { closeness: 70 }), d, () => 0.3);
  assert.equal(inv.activity, "hangout"); assert.ok(P.findPlace(inv.placeId)); assert.ok(inv.dueAt > d.getTime());
  assert.equal(P.pickInvite(mk("partner", { closeness: 70 }), d, () => 0.1).activity, "date");
  assert.match(P.inviteNote(inv, "Alex", d.getTime()), /in person/);
  const imk = T.parseSceneMarker(T.sceneMarker({ phase: "invite", id: "i1", place: "Cinema", activity: "date", placeId: "cinema", when: "tonight", dueAt: d.getTime() + 3600e3 }));
  assert.equal(imk.phase, "invite"); assert.equal(imk.placeId, "cinema"); assert.equal(imk.when, "tonight"); assert.ok(imk.dueAt);
  assert.match(T.sceneNarration(imk, "Alex", "Lily"), /suggested a date with Alex at Cinema/);
  assert.match(T.sceneLine(imk, "Lily"), /Lily invited you/);
  // older markers still parse as before
  assert.equal(T.parseSceneMarker('[scene] {"phase":"start","id":"s9","place":"cafe","activity":"date"}').phase, "start");
  assert.equal(T.parseSceneMarker('[scene] {"phase":"end","id":"s9","place":"cafe","activity":"date","recap":"nice"}').recap, "nice");
  // plans keep the new optional fields; old plans without them still work
  const p2 = T.newPlan("c1", "Cinema", "date", "tonight", d.getTime() + 3600e3, d.getTime(), { placeId: "cinema", narrator: false, pay: "split" });
  assert.equal(p2.placeId, "cinema"); assert.equal(p2.pay, "split"); assert.equal(p2.narrator, false);
  const legacy = { id: "pOld", charId: "c1", place: "the park", activity: "hangout", when: "at", dueAt: d.getTime(), status: "planned", createdAt: d.getTime() - 1e6 };
  assert.equal(T.tickPlan(legacy, mk("friend"), "online", false, d.getTime() + 1000).plan.status, "ready");
  assert.equal(P.placeFromText(legacy.place).cost, 0);
  // Alex asking to meet
  const now = new Date(2026, 9, 14, 12, 0);
  let it = P.detectMeetIntent("want to go to the cinema tomorrow?", now);
  assert.equal(it.placeId, "cinema"); assert.equal(it.when, "tomorrow_afternoon");
  it = P.detectMeetIntent("Fancy grabbing a coffee tonight?", now); assert.equal(it.placeId, "cafe"); assert.equal(it.when, "tonight");
  it = P.detectMeetIntent("shall we meet up this weekend?", now); assert.equal(it.placeId, "other"); assert.equal(it.when, "this_weekend");
  it = P.detectMeetIntent("how about the beach tomorrow evening", now); assert.equal(it.when, "at"); assert.equal(new Date(it.at).getHours(), 19);
  assert.equal(P.detectMeetIntent("I went to the cinema yesterday", now), null);
  assert.equal(P.detectMeetIntent("send me a selfie at the park?", now), null);
  assert.equal(P.detectMeetIntent("how was your day?", now), null);
  // after-date follow-up respects 'can message me first'
  assert.equal(P.followUpAllowed({ proactiveEnabled: false }, false, false), false);
  assert.equal(P.followUpAllowed({ proactiveEnabled: true }, false, false), true);
  assert.equal(P.followUpAllowed({ proactiveEnabled: true }, true, false), false);
  assert.equal(P.followUpAllowed({ proactiveEnabled: true }, false, true), false);
  // UI: narrator line renders distinctly
  const html = renderToStaticMarkup(createElement(all.MarkerLine, { id: "m1", mk: nmk, name: "Lily", line: "", time: "17:31", onInvite: () => {} }));
  assert.match(html, /scene-line narrate/); assert.match(html, /Narrator/);
  const ih = renderToStaticMarkup(createElement(all.MarkerLine, { id: "m2", mk: imk, name: "Lily", line: T.sceneLine(imk, "Lily"), time: "17:31", onInvite: () => {} }));
  assert.match(ih, /Accept/); assert.match(ih, /Decline/);
  const ih2 = renderToStaticMarkup(createElement(all.MarkerLine, { id: "m2", mk: imk, name: "Lily", line: "x", time: "", status: "accepted", onInvite: () => {} }));
  assert.doesNotMatch(ih2, /Decline/);
  console.log("together2 unit ok");
}

// ---- (together3) place backgrounds, scene photos, in-person gifts
{
  const S = all.scenephoto, P = all.places;
  // background cache keys per place + time of day; custom places get their own key
  assert.equal(S.placeBgKey("cafe", "Caf\u00E9", "day"), "cafe:day");
  assert.equal(S.placeBgKey(undefined, "a hangout at the park", "night"), "park:night"); // old plans/scenes without placeId
  assert.equal(S.placeBgKey("other", "Canal picnic!", "evening"), "custom:canal-picnic:evening");
  const bp = S.placeBgPrompt("beach", "Beach", "evening");
  assert.match(bp.prompt, /no people/); assert.match(bp.prompt, /beach/); assert.match(bp.prompt, /evening/);
  assert.match(bp.negative, /people/); assert.match(bp.negative, /child/); assert.match(bp.negative, /nude/);
  const base = { ...all.imagegen?.DEFAULT_PARAMS, model: "m.safetensors", width: 1024, height: 1024, negative: "lowres", loras: [{ path: "x", strength: 1 }], seed: 5 };
  const pp = S.placeBgParams(base, "park", "Park", "day");
  assert.deepEqual([pp.width, pp.height], [1216, 832]); assert.equal(pp.loras.length, 0); assert.equal(pp.seed, -1);
  assert.equal(pp.meta.source, "place"); assert.equal(pp.meta.adult, false); assert.match(pp.negative, /lowres/);
  assert.deepEqual(S.bgSize({ width: 512, height: 768 }), { width: 768, height: 512 });
  assert.match(S.bgGradient("cafe:"), /^linear-gradient/); assert.equal(S.bgGradient("cafe:"), S.bgGradient("cafe:"));
  // photo intent during a scene
  assert.deepEqual(S.detectScenePhoto("take a photo of us!"), { pair: true });
  assert.deepEqual(S.detectScenePhoto("selfie of us here?"), { pair: true });
  assert.deepEqual(S.detectScenePhoto("can you take a picture of me and you together"), { pair: true });
  assert.deepEqual(S.detectScenePhoto("let me take a photo of you by the fountain"), { pair: false });
  assert.equal(S.detectScenePhoto("I love this photo frame"), null);
  assert.equal(S.detectScenePhoto("how are you?"), null);
  // poses: family platonic, romantic affectionate, friends casual
  assert.match(S.photoPose(mk("grandparent", { closeness: 90 })), /platonic/);
  assert.match(S.photoPose(mk("partner", { closeness: 80 })), /couple/);
  assert.match(S.photoPose(mk("friend", { closeness: 80 })), /friends/);
  assert.doesNotMatch(S.photoPose(mk("sibling", { closeness: 90 })), /couple|affectionate/);
  // scene photo prompts: adult-only, no lingerie/nudity, place + time of day; pair only with her opt-in look
  const card = P.sceneCard({ id: "s1", place: "Park", placeId: "park" }, new Date(2026, 9, 14, 17, 30));
  const solo = S.scenePhotoPrompt(mk("partner", { closeness: 80 }), card, false, "", new Date(2026, 9, 14, 17, 30));
  assert.equal(solo.pair, false); assert.match(solo.prompt, /adult, \d+ year old/); assert.match(solo.prompt, /at the park/); assert.match(solo.prompt, /evening/);
  for (const w of ["child", "nude", "lingerie", "nsfw"]) assert.match(solo.negative, new RegExp(w));
  assert.match(solo.caption, /Lily at the Park/);
  const noLook = S.scenePhotoPrompt(mk("partner", { closeness: 80 }), card, true, "  ");
  assert.equal(noLook.pair, false, "no look -> character-only photo");
  const pair = S.scenePhotoPrompt(mk("partner", { closeness: 80 }), card, true, "woman with auburn hair <b>");
  assert.equal(pair.pair, true); assert.match(pair.prompt, /two adults/); assert.match(pair.prompt, /auburn hair/); assert.doesNotMatch(pair.prompt, /</);
  assert.match(pair.caption, /You and Lily/);
  const fam = S.scenePhotoPrompt(mk("grandparent", { closeness: 90 }), card, true, "woman with auburn hair");
  assert.match(fam.prompt, /platonic/); assert.doesNotMatch(fam.prompt, /couple|affectionate/);
  const old = S.scenePhotoPrompt(mk("friend", { closeness: 50, appearance: { age: 12 } }), card, false, "");
  assert.doesNotMatch(old.prompt, /\b12 year old/); assert.match(old.prompt, /18 year old|adult/);
  const sp = S.scenePhotoParams(base, mk("friend"), pair);
  assert.equal(sp.meta.source, "scene"); assert.equal(sp.meta.adult, false); assert.equal(sp.width, 1216);
  assert.match(S.photoNote("Alex", true), /two of you/); assert.match(S.photoNote("Alex", false), /photo of you/);
  // in-person gifts: rare, closeness-scaled, narrated as in person, correct direction
  assert.equal(S.inPersonGiftChance({ closeness: 30 }), 0);
  assert.ok(S.inPersonGiftChance({ closeness: 100 }) > S.inPersonGiftChance({ closeness: 60 }));
  assert.ok(S.inPersonGiftChance({ closeness: 100 }) <= 0.08);
  const given = "[gift] \u{1F9E3} Scarf \u2013 a soft wool scarf" + S.IN_PERSON;
  assert.equal(S.isInPerson(given), true);
  assert.match(typesMod.toModelText(given, true, "Alex", "Lily"), /^\[Event: Alex hands Lily the .*Scarf.* in person\. It now belongs to you, Lily\.\]$/);
  assert.match(typesMod.toModelText(given, false, "Alex", "Lily", "pending"), /You \(Lily\) hand Alex a present in person/);
  assert.match(typesMod.toModelText("[gift] \u{1F9E3} Scarf", true, "Alex", "Lily"), /gave you \(Lily\) a gift/); // by message: unchanged
  // recap transcript mentions photos and gifts
  const tr = T.sceneTranscript([{ from: "them", text: "[selfie] \u{1F4F8} You and Lily at the Park" }, { from: "me", text: given }], "Alex", "Lily");
  assert.match(tr, /photo taken: .*You and Lily at the Park/); assert.match(tr, /Alex gave a gift: .*Scarf/); assert.doesNotMatch(tr, /in person\)/);
  assert.match(T.buildRecapPrompt(mk("friend"), "Alex", { place: "Park", activity: "hangout" }, tr)[0].content, /Photos taken and gifts given/);
  // (scenephoto-rules) scene photos follow the selfie gift rules
  {
    const bra = { id: 31, owner: "c1", name: "Celestial Whispers Bra & Knicker Set", emoji: "x", description: "A midnight-blue satin bra & knicker set.", price: 300, wearable: true, fromChar: "afterdark", acquiredAt: 0, giftedAt: Date.now(), qty: 1, tags: "18+" };
    const scarf = { id: 32, owner: "c1", name: "Cosy Wool Scarf", emoji: "x", description: "A soft red wool scarf.", price: 30, wearable: true, fromChar: "c1", acquiredAt: 0, giftedAt: Date.now(), qty: 1, tags: "" };
    const adultC = mk("partner", { closeness: 80, appearance: { age: 25 } });
    const home = { ...P.sceneCard({ id: "s5", place: "Their place", placeId: "their_place" }, new Date(2026, 9, 14, 21)), placeId: "their_place" };
    const park = { ...card, placeId: "park" };
    const g = (item) => ({ item, allowed: true });
    // ordinary gift: worn anywhere, honest caption, normal negative
    let s = S.scenePhotoPrompt(adultC, park, false, "", new Date(), g(scarf), false);
    assert.equal(s.worn, true); assert.match(s.prompt, /wearing .*scarf/i); assert.match(s.caption, /wearing the Cosy Wool Scarf/); assert.match(s.negative, /lingerie/);
    // lingerie: 18+ switch off -> declined (rules), ordinary photo, caption doesn't claim it
    s = S.scenePhotoPrompt(adultC, home, false, "", new Date(), g(bra), false);
    assert.equal(s.worn, false); assert.equal(s.declined, "rules"); assert.doesNotMatch(s.prompt, /bra|lingerie fully/); assert.doesNotMatch(s.caption, /wearing/);
    assert.match(S.photoNote("Alex", false, s), /Do NOT say you are wearing it/);
    // switch on + 18+ + private place -> worn, tasteful framing; always-on negative kept
    s = S.scenePhotoPrompt(adultC, home, false, "", new Date(), g(bra), true);
    assert.equal(s.worn, true); assert.equal(s.adult, true); assert.match(s.prompt, /boudoir/); assert.match(s.prompt, /fully covering, tasteful/);
    for (const w of ["nude", "nudity", "explicit", "nsfw", "exposed", "child"]) assert.match(s.negative, new RegExp(w));
    assert.doesNotMatch(s.negative, /lingerie, underwear/);
    assert.equal(S.scenePhotoParams(base, adultC, s).meta.adult, true); assert.equal(S.scenePhotoParams(base, adultC, s).meta.gift, bra.name);
    // ...but in a public place -> declined (public), suggest somewhere private
    s = S.scenePhotoPrompt(adultC, park, false, "", new Date(), g(bra), true);
    assert.equal(s.declined, "public"); assert.equal(s.worn, false); assert.match(S.photoNote("Alex", false, s), /somewhere private/);
    // age not saved -> declined; family -> declined and pair stays platonic
    s = S.scenePhotoPrompt(mk("partner", { closeness: 80, appearance: {} }), home, false, "", new Date(), g(bra), true);
    assert.equal(s.declined, "rules");
    const fam = mk("sibling", { closeness: 90, appearance: { age: 30 } });
    assert.equal(S.wearAllowed(bra, fam, true), false); assert.equal(S.wearAllowed(scarf, fam, false), true);
    s = S.scenePhotoPrompt(fam, home, true, "woman with auburn hair", new Date(), g(bra), true);
    assert.equal(s.declined, "rules"); assert.match(s.prompt, /platonic/); assert.doesNotMatch(s.prompt, /intimate|couple|bra/);
    // pair, romantic, private, allowed -> worn with tasteful framing
    s = S.scenePhotoPrompt(adultC, home, true, "woman with auburn hair", new Date(), g(bra), true);
    assert.equal(s.pair, true); assert.equal(s.worn, true); assert.match(s.prompt, /tasteful/);
    // no gift asked -> unchanged behaviour
    s = S.scenePhotoPrompt(adultC, park, false, "", new Date(), undefined, true);
    assert.equal(s.worn, false); assert.equal(s.declined, ""); assert.equal(s.gift, "");
  }
  console.log("together3 unit ok");
}

// ---- (v1.2 group-together) group availability, schedule intersection, prompts, cost split, narrator, scene photos, recap
{
  const S = all.scenephoto, P = all.places;
  const cFree1 = mk("friend", { id: "mira", name: "Mira", closeness: 65, appearance: { age: 24, body: "petite woman", face: "brown eyes", features: "warm smile", style: "", outfitDay: "cardigan", outfitEvening: "jumper", outfitNight: "pyjamas" } });
  const cFree2 = mk("friend", { id: "rex", name: "Rex", closeness: 45, appearance: { age: 26, body: "tall man", face: "dark hair", features: "glasses", style: "", outfitDay: "hoodie", outfitEvening: "jacket", outfitNight: "tee" } });
  const cBusy = mk("friend", { id: "elo", name: "Elowen", life: { relationship: "friend", ...sched } });
  // at 11:00 on Wed, Elowen is busy ("arranging bouquets"), Mira & Rex have no blocking schedule
  const wed11 = new Date(2026, 9, 14, 11, 0);
  const avail = T.canGroupMeetNow([cFree1, cFree2, cBusy], wed11);
  assert.equal(avail.ok, true);
  assert.deepEqual(avail.free.map((c) => c.id), ["mira", "rex"]);
  assert.equal(avail.busy.length, 1); assert.equal(avail.busy[0].c.id, "elo"); assert.match(avail.busy[0].reason, /arranging bouquets/);
  // all asleep -> ok is false
  const availSleep = T.canGroupMeetNow([cBusy, { ...cBusy, id: "b2", name: "Bea" }], new Date(2026, 9, 14, 3, 0));
  assert.equal(availSleep.ok, false); assert.equal(availSleep.free.length, 0);
  // nextGroupFreeAt finds the overlapping window when everyone is free (18:00 today)
  const overlap = T.nextGroupFreeAt([cFree1, cBusy], wed11);
  assert.equal(overlap.getHours(), 18); assert.equal(overlap.getDate(), 14);
  // groupCostShare splits across headcount (Alex + attendees)
  assert.equal(P.groupCostShare(60, "me", 3), 60);
  assert.equal(P.groupCostShare(60, "split", 3), 20);
  assert.equal(P.groupCostShare(35, "split", 4), 9);
  assert.equal(P.groupCostShare(60, "them", 3), 0);
  assert.match(P.groupPayLine("split", 60, "Alex"), /Everyone split/);
  assert.match(P.groupPayLine("them", 60, "Alex", "Mira"), /Mira insisted on treating/);
  // groupTogetherPrompt & markers
  const gs = T.newGroupScene("g1", ["mira", "rex"], "  Board game café ", 1000, { placeId: "cafe", narrator: true });
  assert.equal(gs.groupId, "g1"); assert.equal(gs.place, "Board game café"); assert.deepEqual(gs.attendeeIds, ["mira", "rex"]);
  const gp = T.groupTogetherPrompt(cFree1, "Tea Club", [cFree1, cFree2], "Alex", gs);
  assert.match(gp, /TOGETHER IN PERSON with Alex and Rex/); assert.match(gp, /Tea Club/);
  assert.match(gp, /Reply ONLY as Mira/); assert.match(gp, /wholesome/); assert.match(gp, /\[END_SCENE\]/);
  const gsm = T.parseSceneMarker(T.sceneMarker({ phase: "start", id: gs.id, place: gs.place, activity: "hangout", attendeeIds: ["mira", "rex"] }));
  assert.deepEqual(gsm.attendeeIds, ["mira", "rex"]);
  assert.match(T.groupSceneLine(gsm, "Tea Club", ["Mira", "Rex"]), /You met up with Tea Club \(Mira, Rex\)/);
  assert.match(T.groupSceneNarration(gsm, "Alex", "Mira", ["Rex"]), /Alex, you \(Mira\) and Rex met up IN PERSON/);
  // group plans & ticking
  const gplan = T.newGroupPlan("g1", ["mira", "elo"], "Park", "next_free", wed11.getTime() - 1000, wed11.getTime() - 5000);
  assert.equal(T.openGroupPlans([gplan], "g1").length, 1);
  assert.equal(T.openPlans([gplan], "g1").length, 0, "group plans excluded from 1-to-1 charId filter");
  assert.equal(T.openPlans([gplan]).length, 1, "included in all open plans for Feed");
  // at 11:00 Elowen is busy so only 1 of 2 is free -> next_free re-aims to 18:00
  const tickedBusy = T.tickGroupPlan(gplan, [cFree1, cBusy], "online", false, wed11.getTime());
  assert.equal(tickedBusy.plan.status, "planned"); assert.equal(new Date(tickedBusy.plan.dueAt).getHours(), 18);
  // at 18:05 both are free -> ready + notify
  const wed18 = new Date(2026, 9, 14, 18, 5).getTime();
  const tickedReady = T.tickGroupPlan({ ...gplan, dueAt: wed18 - 1000 }, [cFree1, cBusy], "online", false, wed18);
  assert.equal(tickedReady.plan.status, "ready"); assert.equal(tickedReady.notify, true);
  // group narrator
  const card = P.sceneCard(gs, new Date(2026, 9, 14, 18, 5));
  const gnm = P.groupNarratorMessages(card, "Alex", ["Mira", "Rex"], "Alex: *waves*", "a waiter brings tea", true);
  assert.match(gnm[0].content, /Mira, Rex/); assert.match(gnm[0].content, /waiter brings tea/);
  assert.match(P.groupFallbackNarration(card, ["Mira", "Rex"], true), /Mira and Rex wave you over/);
  // group scene photos: detect group vs single member, multi-person prompt & safeguards
  assert.deepEqual(S.detectGroupScenePhoto("let's take a group photo of us all!", [cFree1, cFree2]), { kind: "group", includeUser: true });
  assert.deepEqual(S.detectGroupScenePhoto("can I take a photo of you guys", [cFree1, cFree2]), { kind: "group", includeUser: false });
  const detSingle = S.detectGroupScenePhoto("let me take a picture of Mira by the counter", [cFree1, cFree2]);
  assert.equal(detSingle.kind, "member"); assert.equal(detSingle.target.id, "mira");
  const gShot = S.groupScenePhotoPrompt([cFree1, cFree2], card, true, "woman with curly hair", new Date(2026, 9, 14, 18, 5));
  assert.equal(gShot.pair, true);
  assert.match(gShot.prompt, /group photo of 3 adult friends/);
  assert.match(gShot.prompt, /person 1: adult 24 year old petite woman/);
  assert.match(gShot.prompt, /person 2: adult 26 year old tall man/);
  assert.match(gShot.prompt, /next to an adult: woman with curly hair/);
  for (const w of ["child", "nude", "lingerie", "nsfw"]) assert.match(gShot.negative, new RegExp(w));
  assert.match(gShot.caption, /You, Mira and Rex at the Board game café/);
  // group recap
  const gtr = T.groupSceneTranscript([
    { speakerId: null, content: T.sceneMarker({ phase: "start", id: gs.id, place: gs.place, activity: "hangout" }) },
    { speakerId: null, content: "*deals the cards* ready?" },
    { speakerId: "mira", content: "*giggles* go easy on me!" },
    { speakerId: "rex", content: "*grins* no mercy!" },
  ], [cFree1, cFree2], "Alex");
  assert.match(gtr, /Alex: \*deals the cards\*/); assert.match(gtr, /Mira: \*giggles\*/); assert.match(gtr, /Rex: \*grins\*/);
  const gr = await T.runGroupRecap("Tea Club", [cFree1, cFree2], "Alex", gs, gtr, async () => JSON.stringify({
    recap: "Alex, Mira and Rex played board games and laughed over tea.",
    poster: "Rex",
    post: "Board game night champion right here 🎮☕",
    members: {
      Mira: { memory: "Played board games with Alex and Rex at the café.", rating: 5, mood: "happy" },
      Rex: { memory: "Won a round of cards with Alex and Mira.", rating: 4, mood: "excited" },
    },
  }), parseJson);
  assert.equal(gr.posterId, "rex");
  assert.equal(gr.members.mira.rating, 5); assert.equal(gr.members.mira.mood, "happy");
  assert.equal(gr.members.rex.rating, 4); assert.equal(gr.members.rex.mood, "excited");
  console.log("group-together unit ok");
}

// ---- live
let up = false; try { up = (await fetch("http://127.0.0.1:11434/api/tags")).ok; } catch {}
if (!up) { console.log("Ollama not reachable: live skipped"); process.exit(0); }
const lily = mk("partner", { closeness: 70 });
const sys = typesMod.buildSystemPrompt(lily, "Alex", { together: T.togetherPrompt(lily, "Alex", { place: "a cosy café by the river", activity: "date" }, false) });
const msgs = [{ role: "system", content: sys }, { role: "system", content: typesMod.toModelText(T.sceneMarker({ phase: "start", id: "s", place: "a cosy café by the river", activity: "date" }), true, "Alex", "Lily") },
  { role: "user", content: "*walks in and spots you by the window* hey you! *waves*" }];
let out = ""; const t0 = Date.now();
await all.browserStream(model, msgs, (e) => { if (e.kind === "token") out += e.data; });
const clean = T.detectWrap(out).text;
console.log(`live reply (${((Date.now() - t0) / 1000).toFixed(1)}s): ${clean}`);
assert.ok(T.hasActions(clean), "in-person reply uses *actions*");
assert.doesNotMatch(clean, /\b(texting|text me|my phone|typing)\b/i, "no texting/phone references");
const t1 = Date.now();
const res = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ model, messages: T.buildRecapPrompt(lily, "Alex", { place: "a cosy café by the river", activity: "date" },
  `Alex: *walks in* hey you!\nLily: ${clean}\nAlex: *orders two hot chocolates* my treat\nLily: *squeezes your hand* you're the sweetest`), stream: false, format: "json", think: false, options: { temperature: 0.4 } }) });
const live = T.parseRecap(parseJson((await res.json()).message.content), "cosy");
console.log(`live recap (${((Date.now() - t1) / 1000).toFixed(1)}s): rating ${live.rating}, mood ${live.mood}: ${live.recap} | post: ${live.post} | follow-up: ${live.followUp}`);
assert.ok(live.recap.length > 10 && live.rating >= 1 && live.rating <= 5);
console.log("live ok");
