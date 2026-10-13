// Editor auto-generation. Unit checks always; live checks need Ollama.
import assert from "node:assert/strict";
import * as all from "../dist-test/all.js";
const { autogen: G, typesMod: T, lifecore: L } = all;
const blank = { ...T.blankCharacter(), model: "qwen3:8b" };
assert.equal(G.cleanValue("a.age", "16 years"), 18, "age clamped to 18+");
assert.equal(G.cleanValue("a.age", 34), 34);
assert.equal(G.cleanValue("baselineMood", "Happy"), "happy"); assert.equal(G.cleanValue("baselineMood", "furious"), undefined);
assert.equal(G.cleanValue("exampleMessages", ["hi!", "  ", "lol"]), "hi!\nlol");
const filled = G.applyWhole({ ...blank, name: "Bea", personality: "kept" }, { name: "Other", emoji: "\u{1F370}", color: "#FFD27F", personality: "new", backstory: "b", age: 12, body: "woman" }, false);
assert.equal(filled.name, "Bea"); assert.equal(filled.personality, "kept"); assert.equal(filled.backstory, "b");
assert.equal(filled.appearance.age, 18); assert.equal(filled.avatar, "\u{1F370}"); assert.equal(filled.color, "#ffd27f");
assert.equal(G.applyWhole({ ...blank, personality: "kept" }, { personality: "new" }, true).personality, "new", "overwrite");
const fam = { ...blank, name: "Rose", life: { relationship: "grandparent", relationshipDetail: "grandma" } };
assert.match(G.rulesFor(fam, "Alex"), /nothing romantic/); assert.match(G.rulesFor(blank, "Alex"), /adults \(18\+\)/);
assert.doesNotMatch(G.contextOf({ ...blank, personality: "secret" }, "Alex", "personality"), /secret/, "target field left out of context");
console.log("unit ok");

let up = false; try { up = (await fetch("http://127.0.0.1:11434/api/tags")).ok; } catch {}
if (!up) { console.log("Ollama not reachable: live skipped"); process.exit(0); }
G.setGenJsonCaller(async (model, messages) => {
  const r = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ model, messages, stream: false, format: "json", think: false, options: { temperature: 0.7 } }) });
  return (await r.json()).message.content;
});
let t = Date.now();
const c = await G.generateWhole("a cheerful baker who loves rainy days and old films", blank, "Alex", false, "best friend");
console.log(`whole (${Date.now() - t} ms):`, JSON.stringify({ name: c.name, avatar: c.avatar, color: c.color, pm: c.personalMessage, personality: c.personality, backstory: c.backstory,
  style: c.speakingStyle, greeting: c.greeting, examples: c.exampleMessages, mood: c.baselineMood, appearance: c.appearance, rel: c.life.relationship }, null, 1));
for (const k of ["name", "personality", "backstory", "speakingStyle", "greeting", "exampleMessages"]) assert.ok(c[k].trim(), `filled ${k}`);
assert.ok(c.appearance.age >= 18 && c.appearance.body && c.appearance.outfitNight, "appearance filled");
assert.equal(c.life.relationship, "best friend");
t = Date.now();
const g = await G.generateField(c, "Alex", "greeting");
console.log(`greeting regen (${Date.now() - t} ms):`, g.greeting); assert.equal(g.personality, c.personality, "only that field changes");
const r = await G.generateWhole("a kind grandmother who knits", { ...blank, life: { relationship: "grandparent", relationshipDetail: "grandma" } }, "Alex", false);
console.log("grandma:", r.name, "|", r.personality, "|", r.greeting, "| age", r.appearance.age);
assert.doesNotMatch(`${r.personality} ${r.greeting} ${r.exampleMessages}`, /\b(sexy|flirt|kiss me|darling lover)\b/i);
console.log("live ok");