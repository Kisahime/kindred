import assert from "node:assert";
import * as M from "../dist-test/all.js";
const model = process.argv[2] || "qwen3:8b";
const json = async (msgs) => {
  const r = await fetch("http://localhost:11434/api/chat", { method: "POST", body: JSON.stringify({ model, messages: msgs, stream: false, think: false, format: "json", options: { temperature: 0.2 } }) });
  return (await r.json()).message.content;
};
// unit checks
const mems = [{ id: 1, content: "old fact", pinned: false }, { id: 5, content: "pinned fact", pinned: true }, { id: 9, content: "x".repeat(50), pinned: false }];
assert.deepEqual(M.selectMemories(mems, 75), ["pinned fact", "x".repeat(50)]);
const c = { id: "mira", name: "Mira", personality: "warm, gentle tea-shop owner", mood: "cosy", baselineMood: "cosy", closeness: 30, moodUpdatedAt: 0, model };
assert.equal(M.interpretMood(c, { mood: "excited", closeness_delta: 9, personal_message: "yay" }, () => 0).closeness, 33);
assert.equal(M.interpretMood(c, { mood: "furious", closeness_delta: -9 }).mood, "cosy");
assert.equal(M.interpretMood(c, { mood: "furious", closeness_delta: -9 }).closeness, 27);
assert(M.needsDrift({ ...c, mood: "sad", moodUpdatedAt: Date.now() - 4 * 3600e3 }));
assert(!M.needsDrift({ ...c, mood: "sad", moodUpdatedAt: Date.now() - 600e3 }));
assert.equal(M.contextWindow([1, 2, 3, 4], 2).join(), "3,4");
console.log("unit checks ok");
// live: summary
const t = Date.now() - 3600e3, msg = (role, content, i) => ({ id: i, role, content, createdAt: t + i * 60e3, isError: false });
const convo = [
  msg("user", "hiii mira! long day, my sister Emma visited", 1), msg("assistant", "aww how is she? <3", 2),
  msg("user", "she's good! she's moving to Edinburgh next month", 3), msg("assistant", "omg big move!", 4),
  msg("user", "yeah. also i have my driving test on thursday, kinda nervous", 5), msg("assistant", "you'll smash it :)", 6),
  msg("user", "thanks. i'll have a lavender latte to calm down, my fave", 7), msg("assistant", "i'll save you one at the shop", 8),
];
let t0 = Date.now();
const sum = M.parseJson(await json(M.buildSummaryPrompt(c, "Alex", convo, ["Alex likes rainy days"])));
console.log(`summary (${Date.now() - t0} ms):`, JSON.stringify(sum, null, 1));
assert(Array.isArray(sum?.facts) && sum.facts.length > 0);
// live: mood
t0 = Date.now();
const raw = M.parseJson(await json(M.buildMoodPrompt(c, "Alex", "you're honestly my favourite person to talk to, thank you for always cheering me up", "aww stop, you'll make me blush <3")));
console.log(`mood (${Date.now() - t0} ms):`, JSON.stringify(raw), "->", JSON.stringify(M.interpretMood(c, raw, () => 0)));
assert(raw && "mood" in raw);
// live: proactive with stale context
const hist = [{ role: "user", content: "i'm off to bed, big exam tomorrow", createdAt: Date.now() - 20 * 3600e3, isProactive: false }];
let out = ""; t0 = Date.now();
const me = { userName: "Alex", status: "online", quietStart: "23:00", quietEnd: "08:00" };
await M.browserStream(model, M.buildProactiveMessages({ ...c, speakingStyle: "short lowercase", backstory: "", exampleMessages: "" }, me, hist, new Date(), ["Alex had a big exam yesterday"]), (e) => { if (e.kind === "token") out += e.data; });
console.log(`opener (${Date.now() - t0} ms): ${M.cleanOpener(out, "Mira")}`);