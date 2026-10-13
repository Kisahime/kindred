// Regenerate with overwrite: from scratch (only hand-typed fields kept), always varied, idea respected.
import assert from "node:assert/strict";
import * as all from "../dist-test/all.js";
const { autogen: G, typesMod: T } = all;
const blank = { ...T.blankCharacter(), model: "qwen3:8b" };
const IDEA = "a stay at home gamer girl, 18 years old";
const text = (m) => m.map((x) => x.content).join("\n");
G.resetGenHistory();
// scrub keeps only hand-typed fields
const prev = { ...blank, name: "Ella", personalMessage: "Grinding away. Don't talk to me.", greeting: "ugh, what do you want?", backstory: "final year of university", baselineMood: "annoyed", speakingStyle: "hand typed style" };
const sc = G.scrub(prev, ["speakingStyle"]);
assert.equal(sc.name, ""); assert.equal(sc.greeting, ""); assert.equal(sc.backstory, ""); assert.equal(sc.speakingStyle, "hand typed style");
let prompts = [];
G.setGenJsonCaller(async (_m, msgs, temp, opts) => { prompts.push({ p: text(msgs), temp, opts }); return JSON.stringify({ name: "Zoe", personalMessage: "pm", greeting: "hey", backstory: "Lives at home with her mum.", personality: "p", speakingStyle: "new", baselineMood: "happy" }); });
const r = await G.generateWhole(IDEA, prev, "Alex", true, "best friend", [], ["speakingStyle"]);
const p = prompts[0].p;
assert.doesNotMatch(p, /Ella|Grinding|ugh, what|university/, "old generated values not fed back");
assert.match(p, /hand typed style/); assert.equal(r.speakingStyle, "hand typed style", "hand-typed kept"); assert.equal(r.name, "Zoe");
assert.match(p, /Creative angle \(use it as flavour only/, "long idea still gets an angle"); assert.match(p, /idea is authoritative/);
assert.ok(prompts[0].temp >= 0.8 && Number.isInteger(prompts[0].opts.seed) && prompts[0].opts.topP === 0.95);
prompts = []; await G.generateWhole(IDEA, r, "Alex", true, "best friend", [], []);
assert.match(prompts[0].p, /Earlier versions made from this same idea[\s\S]*Zoe: "pm" \/ greeting "hey"/, "previous generation passed as avoid");
G.resetGenHistory();
console.log("unit ok");

let up = false; try { up = (await fetch("http://127.0.0.1:11434/api/tags")).ok; } catch {}
if (!up) { console.log("Ollama not reachable: live skipped"); process.exit(0); }
const sent = [];
G.setGenJsonCaller(async (model, messages, temperature, opts) => {
  const options = { temperature: temperature ?? 0.2, ...(opts?.seed !== undefined ? { seed: opts.seed } : {}), ...(opts?.topP !== undefined ? { top_p: opts.topP } : {}) };
  sent.push(options);
  const r = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ model, messages, stream: false, format: "json", think: false, options }) });
  return (await r.json()).message.content;
});
let c = blank; const out = [];
for (let i = 0; i < 5; i++) {
  c = await G.generateWhole(IDEA, c, "Alex", true, "best friend", ["Lily"], []);
  out.push(c); console.log(`#${i + 1} ${c.name} | mood ${c.baselineMood} | pm "${c.personalMessage}" | greeting "${c.greeting}" | backstory: ${c.backstory}`);
}
console.log("sampling sent:", sent.map((o) => `t=${o.temperature} seed=${o.seed} top_p=${o.top_p}`).join("; "));
const uniq = (k) => new Set(out.map((x) => String(x[k]).toLowerCase().trim())).size;
assert.equal(uniq("name"), 5, "names differ"); assert.equal(uniq("greeting"), 5); assert.equal(uniq("personalMessage"), 5);
assert.equal(new Set(sent.map((o) => o.seed)).size, sent.length, "fresh seed every call");
for (const x of out) { assert.doesNotMatch(x.backstory, /\b(is a student|studying|studies at|final year|lectures|commutes?|campus|office job)\b/i, `idea respected: ${x.backstory}`); assert.ok(x.appearance.age >= 18 && x.appearance.age <= 19, `age ${x.appearance.age}`); }
for (let i = 1; i < 5; i++) for (let j = 0; j < i; j++) assert.ok(G.similarity(out[i].backstory, out[j].backstory) < 0.45, `backstories ${i}/${j} too similar`);
console.log("live ok");