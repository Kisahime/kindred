// Selfie prompt + intent tests. Live intent checks need Ollama running (skipped if not reachable).
import assert from "node:assert/strict";
import * as all from "../dist-test/all.js";
const { selfie, typesMod } = all;
const c = { ...typesMod.blankCharacter(), name: "Juniper", mood: "cosy", personality: "Gentle.", model: "qwen3:8b",
  appearance: { age: 17.9, body: "woman, curvy", face: "curly dark hair, hazel eyes", outfitNight: "green plaid pyjamas", placeNight: "bedroom with fairy lights", style: "soft light" } };
const night = new Date(2026, 9, 12, 23, 30), day = new Date(2026, 9, 12, 10, 0);
// v1.3: under 18 = protected family character, never pictured (was: clamped to 18)
assert.throws(() => selfie.buildSelfiePrompt(c, "", night), /under 18 and protected/);
c.appearance.age = 18;
const p = selfie.buildSelfiePrompt(c, "holding a cup of tea <lora:x:1>", night);
assert.match(p.prompt, /adult, 18 year old/);
assert.match(p.prompt, /green plaid pyjamas/); assert.match(p.prompt, /fairy lights/); assert.match(p.prompt, /cup of tea/);
assert.doesNotMatch(p.prompt, /<lora/, "no prompt injection of lora tags");
assert.match(p.negative, /underage/);
const d = selfie.buildSelfiePrompt(c, "", day);
assert.match(d.prompt, /casual everyday clothes/); assert.match(d.prompt, /daylight/);
assert.equal(typesMod.appearanceOf({ appearance: { age: 3 } }).age, 3, "protected characters keep their real age");
assert.equal(typesMod.appearanceOf({ appearance: { age: 0 } }).age, 25); assert.equal(typesMod.appearanceOf({ appearance: {} }).age, 25);
assert.deepEqual(selfie.interpretIntent({ selfie: true, scene: "waving" }), { selfie: true, scene: "waving" });
assert.deepEqual(selfie.interpretIntent({ selfie: "no" }), { selfie: false, scene: "" });
assert.match(typesMod.toModelText("[selfie] waving", false, "Alex", "Juniper"), /Juniper sent Alex a selfie photo: waving/);
console.log("prompt:", p.prompt);
console.log("unit ok");

let up = false; try { up = (await fetch("http://127.0.0.1:11434/api/tags")).ok; } catch {}
if (!up) { console.log("Ollama not reachable: live intent skipped"); process.exit(0); }
// live: call Ollama the same way api.ollamaJson does (JSON format, temp 0.2)
const ask = async (text) => {
  const r = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ model: c.model, stream: false, think: false, format: "json", options: { temperature: 0.2 }, messages: selfie.buildIntentPrompt("Juniper", "Alex", text) }) });
  return selfie.interpretIntent(all.parseJson((await r.json()).message.content));
};
const cases = [["send me a selfie!", true], ["can I see a pic of you with your tea? :)", true], ["what are you wearing rn? show me", true],
  ["I took a photo of my cat today", false], ["how was your day?", false], ["my mum sent me old photos lol", false]];
let ok = 0;
for (const [t, want] of cases) { const r = await ask(t); console.log(`${r.selfie === want ? "ok " : "BAD"} ${JSON.stringify(t)} -> ${JSON.stringify(r)}`); if (r.selfie === want) ok++; }
assert.ok(ok >= cases.length - 1, `intent accuracy ${ok}/${cases.length}`);
console.log(`live intent ${ok}/${cases.length}`);