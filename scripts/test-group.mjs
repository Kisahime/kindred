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
console.log("unit checks ok");
// live turn
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