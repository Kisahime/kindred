import assert from "node:assert";
import * as M from "../dist-test/all.js";
const c = (s) => M.convertSmileys(s);
const cases = [
  ["hi :) how are you :D", "hi \u{1F642} how are you \u{1F604}"],
  ["love you (L) <3", "love you \u2764\uFE0F \u2764\uFE0F"],
  ["(Y) sounds good;) :P", "\u{1F44D} sounds good;) \u{1F61B}"],
  ["see https://example.com/a:)b and http://x.io/:P", "see https://example.com/a:)b and http://x.io/:P"],
  ["run `foo(:D)` then :O", "run `foo(:D)` then \u{1F62E}"],
  ["C:\\Users\\User\\Docs :(", "C:\\Users\\User\\Docs \u{1F641}"],
  ["meeting at 10:30, ratio 3:2 :|", "meeting at 10:30, ratio 3:2 \u{1F610}"],
  ["Package :Pancake <30 x:Dy", "Package :Pancake <30 x:Dy"],
  ["blushing :$ angry :@ cool (H) coffee (C)", "blushing \u{1F633} angry \u{1F620} cool \u{1F60E} coffee \u2615"],
  ["mail me at alex:)@example.com", "mail me at alex:)@example.com"],
];
for (const [i, o] of cases) assert.equal(c(i), o, i);
console.log(`emoticon conversion: ${cases.length} cases ok`);

const model = process.argv[2] || "qwen3:8b";
M.setJsonCaller(async (model, messages) => (await (await fetch("http://localhost:11434/api/chat", { method: "POST",
  body: JSON.stringify({ model, messages, stream: false, think: false, format: "json", options: { temperature: 0.2 } }) })).json()).message.content);
const json = async (msgs) => (await (await fetch("http://localhost:11434/api/chat", { method: "POST",
  body: JSON.stringify({ model, messages: msgs, stream: false, think: false, format: "json", options: { temperature: 0.2 } }) })).json()).message.content;
const mk = (id, name, p) => ({ id, name, personality: p, model });
const members = [mk("mira", "Mira", "warm tea-shop owner"), mk("rex", "Rex", "sarcastic gamer"), mk("elowen", "Elowen", "whimsical fortune-teller")];
const g = { id: "g1", name: "Tea Club" };
const t = Date.now() - 3600e3; let i = 1;
const m = (speakerId, content) => ({ id: i, groupId: "g1", speakerId, content, createdAt: t + i++ * 60e3, isError: false });
const msgs = [
  m(null, "hi everyone!! guess what, i got the job at the library!"), m("mira", "omg alex!! congratulations <3"),
  m("rex", "nice, free books forever. respect"), m("elowen", "the stars did whisper of new beginnings \u2728"),
  m(null, "haha thanks elowen. i start on the 2nd of november"), m("rex", "bet you'll reorganise the whole place by genre colour lol"),
  m(null, "rex i literally will, don't tempt me"), m("mira", "we should celebrate! cake at the shop on saturday?"),
  m(null, "yes!! lemon drizzle please, my favourite"), m("rex", "i'm bringing my switch, mario kart tournament"),
];
for (const who of [members[0], members[1]]) {
  const t0 = Date.now();
  const out = M.parseJson(await json(M.buildGroupSummaryPrompt(who, g, members, "Alex", msgs, [])));
  console.log(`\n${who.name}'s memories from Tea Club (${Date.now() - t0} ms):`); for (const f of out?.facts ?? []) console.log("  - " + f);
  assert(Array.isArray(out?.facts) && out.facts.length > 0);
}