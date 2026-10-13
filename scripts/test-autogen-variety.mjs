// Autogen variety: no time/mood context, sampling, anti-repetition. Unit always; live needs Ollama.
import assert from "node:assert/strict";
import * as all from "../dist-test/all.js";
const { autogen: G, typesMod: T } = all;
const blank = { ...T.blankCharacter(), model: "qwen3:8b" };
const RealDate = Date;
const at = (h) => { const base = new RealDate(2026, 9, 13, h, 30).getTime(); globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [base])); } static now() { return base; } }; };
const TIMEY = /\b(cosy|cozy|tea|rainy|books?|fairy lights|right now|current mood|tonight|this morning|o'clock|\d{1,2}:\d{2}|midnight|late night|schedule)\b/i;
const text = (msgs) => msgs.map((m) => m.content).join("\n");
// prompts carry no time / current mood / leading example words, and don't change with the clock
G.setGenRandom(() => 0.42);
at(23); const night = text(G.buildWholePrompt("", { ...blank, mood: "sleepy" }, "Alex"));
at(9); const morning = text(G.buildWholePrompt("", { ...blank, mood: "sleepy" }, "Alex"));
assert.equal(night, morning, "time of day does not change the prompt");
assert.doesNotMatch(night.replace(/one of: [^\n]*/, ""), TIMEY, night);
assert.doesNotMatch(night, /Usual mood: cosy/, "blank char's default mood not used as context");
assert.match(night, /Creative angle \(use it\)/); assert.match(night, /Suggested usual mood: \w+/);
assert.match(text(G.buildWholePrompt("a retired lighthouse keeper who restores old radios", blank, "Alex")), /flavour only/, "long idea: flavour angle");
for (const f of ["personality", "backstory", "greeting", "a.face", "a.placeNight", "a.outfitEvening", "a.style", "l.relationshipDetail"]) {
  const p = text(G.buildFieldPrompt({ ...blank, name: "Ava", personality: "x", baselineMood: "playful" }, "Alex", f));
  assert.doesNotMatch(p.replace(/one of: [^\n]*/, ""), TIMEY, `${f}: ${p}`);
}
assert.doesNotMatch(text(G.buildFieldPrompt({ ...blank, personality: "kind" }, "Alex", "personality")), /Usual mood/, "default mood not fed into personality");
assert.match(text(G.buildFieldPrompt(blank, "Alex", "a.outfitNight")), /NIGHT/); assert.doesNotMatch(text(G.buildFieldPrompt(blank, "Alex", "a.outfitNight")), /DAYTIME|EVENING/, "slot gets only its slot");
globalThis.Date = RealDate; G.setGenRandom(Math.random);
// sampling: creative temp high, random seed per call
assert.ok(G.tempFor("backstory") >= 0.8 && G.tempFor("a.outfitDay") >= 0.8); const s1 = G.sampling(), s2 = G.sampling(); assert.notEqual(s1.seed, s2.seed); assert.equal(s1.topP, 0.95);
// mood diversity
G.resetGenHistory(); const moods = new Set(); for (let i = 0; i < 60; i++) moods.add(G.pickMood()); assert.equal(moods.size, T.MOODS.length, "all moods reachable");
const angles = new Set(); for (let i = 0; i < 20; i++) angles.add(G.creativeAngle()); assert.ok(angles.size >= 18, "angles vary");
// anti-repetition: history goes into the next prompt, duplicate contact names retried
G.remember({ ...blank, name: "Mia", personality: "A florist who loves bouldering", backstory: "", personalMessage: "petals & chalk", greeting: "hiya!", baselineMood: "playful" });
const next = text(G.buildWholePrompt("", blank, "Alex", G.recent().names));
assert.match(next, /names: Mia/); assert.match(next, /florist/); assert.match(next, /bouldering/); assert.match(next, /"hiya!"/);
let calls = 0; const seen = [];
G.setGenJsonCaller(async (_m, msgs, temp, opts) => { calls++; seen.push({ temp, opts, p: text(msgs) }); return JSON.stringify({ name: calls === 1 ? "Lily" : "Nadia", personality: "p", backstory: "b", baselineMood: "excited" }); });
const d = await G.generateWhole("", blank, "Alex", false, undefined, ["Lily", "Bea"]);
assert.equal(d.name, "Nadia", "existing contact name rejected"); assert.equal(calls, 2); assert.match(seen[1].p, /Lily/); assert.ok(seen[0].temp >= 0.8 && seen[0].opts.seed !== seen[1].opts.seed);
assert.equal(d.baselineMood, "excited");
const fam = text(G.buildWholePrompt("", { ...blank, life: { relationship: "grandparent", relationshipDetail: "grandma" } }, "Alex"));
assert.match(fam, /nothing romantic/); assert.match(fam, /adults \(18\+\)/);
console.log("unit ok");

let up = false; try { up = (await fetch("http://127.0.0.1:11434/api/tags")).ok; } catch {}
if (!up) { console.log("Ollama not reachable: live skipped"); process.exit(0); }
G.resetGenHistory(); G.setGenRandom(Math.random);
G.setGenJsonCaller(async (model, messages, temperature, opts) => {
  const r = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ model, messages, stream: false, format: "json", think: false, options: { temperature: temperature ?? 0.2, seed: opts?.seed, top_p: opts?.topP } }) });
  return (await r.json()).message.content;
});
const ideas = ["", "", "", "a friend", "someone fun", "", "my gym buddy", "", "a coworker", ""];
const hours = [23, 1, 9, 13, 18, 22, 3, 7, 15, 20];
const rows = [], names = [];
for (let i = 0; i < ideas.length; i++) {
  at(hours[i]); const t0 = RealDate.now();
  const c = await G.generateWhole(ideas[i], { ...blank, mood: hours[i] >= 22 || hours[i] < 6 ? "sleepy" : "happy" }, "Alex", false, undefined, [...names, "Lily"]);
  globalThis.Date = RealDate;
  names.push(c.name);
  const blob = `${c.personality} ${c.backstory}`;
  rows.push({ h: `${String(hours[i]).padStart(2, "0")}:30`, idea: ideas[i] || "(blank)", name: c.name, mood: c.baselineMood, job: (c.backstory.match(/\b(?:an? |works? as an? |is an? )([a-z -]{3,30}?)(?: at| in| who|,|\.)/i)?.[1] ?? "").trim(), cosyWords: (blob.match(/\b(cosy|cozy|tea|rain|books?|blanket)\b/gi) ?? []).length, ms: RealDate.now() - t0 });
  assert.ok(c.appearance.age >= 18);
}
console.table(rows);
const uniqNames = new Set(names.map((n) => n.toLowerCase())).size, uniqMoods = new Set(rows.map((r) => r.mood)).size;
const nightCosy = rows.filter((r) => /^(2[2-3]|0[0-5])/.test(r.h)).map((r) => r.mood === "cosy" || r.mood === "sleepy").filter(Boolean).length;
console.log(`unique names ${uniqNames}/10, moods ${uniqMoods} (${[...new Set(rows.map((r) => r.mood))].join(", ")}), night rows with cosy/sleepy mood: ${nightCosy}/${rows.filter((r) => /^(2[2-3]|0[0-5])/.test(r.h)).length}, cosy-ish words total ${rows.reduce((a, r) => a + r.cosyWords, 0)}`);
assert.ok(uniqNames >= 9, "names distinct"); assert.ok(uniqMoods >= 4, "moods varied"); assert.ok(!names.some((n) => n.toLowerCase() === "lily"), "no clash with existing contact");
console.log("live ok");