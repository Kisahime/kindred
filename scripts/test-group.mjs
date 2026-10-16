import assert from "node:assert";
import * as G from "../dist-test/all.js";
const model = process.argv[2] || "qwen3:8b";
const json = async (model, messages) => (await (await fetch("http://localhost:11434/api/chat", { method: "POST",
  body: JSON.stringify({ model, messages, stream: false, think: false, format: "json", options: { temperature: 0.2 } }) })).json()).message.content;
const mk = (id, name, personality, style) => ({ id, name, personality, speakingStyle: style, backstory: "", exampleMessages: "", mood: "cosy", baselineMood: "cosy", closeness: 40, model });
const mira = mk("mira", "Mira", "warm, gentle tea-shop owner", "short lowercase, :)");
const rex = mk("rex", "Rex", "sarcastic but big-hearted gamer", "short bursts, teasing, gaming slang");
const elo = mk("elowen", "Elowen", "mysterious whimsical fortune-teller", "a little poetic, short");
const members = [mira, rex, elo];
const g = { id: "g1", name: "Tea Club", memberIds: members.map((m) => m.id) };
// unit
assert.deepEqual(G.addressedMembers("hey Rex, wanna play?", members).map((m) => m.name), ["Rex"]);
assert.deepEqual(G.addressedMembers("morning everyone!", members).length, 3);
assert.deepEqual(G.addressedMembers("I love mirages", members), []);
assert.equal(G.cleanGroupReply("Rex: gg lol\nMira: hehe", rex, members, "Alex"), "gg lol");
assert.equal(G.banterPick(members, [rex], () => 0.9), null);
assert.notEqual(G.banterPick(members, [rex], () => 0.1).id, "rex");
assert.equal(G.cleanGroupReply("Elowen: grinding dungeons", rex, members, "Alex"), "grinding dungeons");
// v1.2 group together turn
{
  const T = G.together, P = G.places;
  const gs = T.newGroupScene("g1", ["mira", "rex"], "Park", 1000, { placeId: "park" });
  const card = P.sceneCard(gs, new Date(2026, 9, 14, 15, 0));
  const startM = T.sceneMarker({ phase: "start", id: gs.id, place: gs.place, activity: "hangout", attendeeIds: ["mira", "rex"] });
  const narrM = T.sceneMarker({ phase: "narrate", id: gs.id, place: gs.place, activity: "hangout", text: "The autumn leaves rustle." });
  const giftM = "[gift] \u{1F9E3} Scarf \u2013 a warm scarf (in person)";
  const h = [
    { id: 1, groupId: "g1", speakerId: null, content: startM, createdAt: 1000, isError: false, reaction: "", reactorId: null, alternates: [], altIndex: 0, sceneId: gs.id },
    { id: 2, groupId: "g1", speakerId: null, content: narrM, createdAt: 1001, isError: false, reaction: "", reactorId: null, alternates: [], altIndex: 0, sceneId: gs.id },
    { id: 3, groupId: "g1", speakerId: "mira", content: giftM, createdAt: 1002, isError: false, reaction: "", reactorId: null, alternates: [], altIndex: 0, sceneId: gs.id },
    { id: 4, groupId: "g1", speakerId: null, content: "*spreads out the picnic blanket* grab a seat!", createdAt: 1003, isError: false, reaction: "", reactorId: null, alternates: [], altIndex: 0, sceneId: gs.id },
  ];
  const turnMira = G.buildGroupTurn(mira, g, members, h, "Alex", [], new Date(2026, 9, 14, 15, 0), "", { scene: gs, card, attendees: [mira, rex] });
  assert.match(turnMira[0].content, /TOGETHER IN PERSON with Alex and Rex/);
  assert.doesNotMatch(turnMira[0].content, /Elowen/); // only attendees in the scene prompt
  assert.doesNotMatch(turnMira[0].content, /over an instant messenger/);
  assert.match(turnMira[1].content, /\[Event: Alex, you \(Mira\) and Rex met up IN PERSON/);
  assert.equal(turnMira[2].content, "[Narration: The autumn leaves rustle.]");
  assert.match(turnMira[3].content, /Alex hands Mira/);
  const turnRex = G.buildGroupTurn(rex, g, members, h, "Alex", [], new Date(2026, 9, 14, 15, 0), "", { scene: gs, card, attendees: [mira, rex] });
  assert.match(turnRex[3].content, /\[Event: Alex gave Mira a gift in person/);
}
console.log("unit checks ok");
// live turn
let up = false; try { up = (await fetch("http://127.0.0.1:11434/api/tags")).ok; } catch {}
if (!up) { console.log("Ollama not reachable: live skipped"); process.exit(0); }
let id = 1; const hist = [];
const add = (speakerId, content) => hist.push({ id: id++, groupId: "g1", speakerId, content, createdAt: Date.now(), isError: false });
async function turn(text) {
  add(null, text); console.log(`\nAlex: ${text}`);
  let t0 = Date.now();
  const resp = await G.pickResponders(members, text, hist, "Alex", json);
  console.log(`  -> responders (${Date.now() - t0} ms): ${resp.map((c) => c.name).join(", ")}`);
  const spoke = [];
  const speak = async (c) => {
    let out = ""; t0 = Date.now();
    await G.browserStream(c.model, G.buildGroupTurn(c, g, members, hist, "Alex", []), (e) => { if (e.kind === "token") out += e.data; });
    const clean = G.cleanGroupReply(out, c, members, "Alex"); add(c.id, clean); spoke.push(c);
    console.log(`  ${c.name} (${Date.now() - t0} ms): ${clean}`);
  };
  for (const c of resp) await speak(c);
  const extra = G.banterPick(members, spoke, () => 0.2); // force banter for the test
  if (extra) await speak(extra);
}
await turn("hi everyone!! finally home, what are you all up to tonight?");
await turn("Rex you're always gaming lol, be honest how many hours today");
await turn("i'm thinking of baking something cosy this weekend, any ideas?");