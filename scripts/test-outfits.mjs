// Normaliser + distinct outfit/setting generation. Live part needs Ollama.
import assert from "node:assert/strict";
import * as all from "../dist-test/all.js";
const { autogen: G, typesMod: T } = all;
// toText
assert.equal(G.toText({ top: "white blouse", bottom: "blue jeans", shoes: ["white trainers"] }), "white blouse, blue jeans, white trainers");
assert.equal(G.toText({ outfit: "green dress" }), "green dress");
assert.equal(G.toText({ day: { top: "tee", bottom: "shorts" } }), "tee, shorts");
assert.equal(G.toText([{ item: "hoodie" }, "joggers"]), "hoodie, joggers");
assert.equal(G.toText("x [object Object] y").includes("object"), false);
assert.equal(G.toText(null), ""); assert.equal(G.toText(5), "5");
assert.equal(G.cleanValue("a.outfitDay", { top: "linen shirt", bottom: "chinos" }), "linen shirt, chinos");
assert.equal(G.cleanValue("exampleMessages", [{ text: "hi" }, "yo"]), "hi\nyo");
// similarity
assert.ok(G.similarity("cosy green pyjamas", "green cosy pyjamas") > 0.9);
assert.ok(G.similarity("black leather jacket and jeans", "silk pyjamas") < 0.2);
// whole: outfits object mapped to slots
const base = { ...T.blankCharacter(), name: "Bea", model: "qwen3:8b" };
const w = G.applyWhole(base, { outfits: { day: { top: "tee" }, evening: "dress", night: "pyjamas" }, places: { day: "cafe", evening: "pub", night: "bedroom" } }, false);
assert.deepEqual([w.appearance.outfitDay, w.appearance.outfitEvening, w.appearance.outfitNight, w.appearance.placeNight], ["tee", "dress", "pyjamas", "bedroom"]);
console.log("unit ok");

let up = false; try { up = (await fetch("http://127.0.0.1:11434/api/tags")).ok; } catch {}
if (!up) { console.log("Ollama not reachable: live skipped"); process.exit(0); }
let calls = 0, retries = 0;
G.setGenJsonCaller(async (model, messages, temperature) => {
  calls++; if (temperature >= 1) retries++;
  const r = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ model, messages, stream: false, format: "json", think: false, options: { temperature: temperature ?? 0.2 } }) });
  return (await r.json()).message.content;
});
const chars = [
  { ...base, name: "Juniper", personality: "Gentle plant lover, works at a garden centre.", appearance: { ...T.blankAppearance(), age: 29, body: "woman, curvy", face: "curly dark hair", outfitDay: "linen dungarees over a striped tee", outfitEvening: "", outfitNight: "" } },
  { ...base, name: "Max", personality: "Upbeat gym coach who bakes.", appearance: { ...T.blankAppearance(), age: 27, body: "man, athletic", face: "short fade", outfitDay: "", outfitEvening: "", outfitNight: "" } },
];
let bad = 0, clash = 0, n = 0;
for (const c0 of chars) {
  let c = c0;
  for (const kind of ["outfit", "place"]) for (const slot of ["Day", "Evening", "Night"]) {
    const f = `a.${kind}${slot}`, seen = [];
    for (let i = 0; i < 5; i++) {
      const v = (await G.generateField(c, "Alex", f)).appearance[`${kind}${slot}`];
      n++; seen.push(v);
      if (typeof v !== "string" || /object Object|^\s*[{[]/.test(v)) bad++;
      if (G.clashes(c, f, v)) clash++;
    }
    c = { ...c, appearance: { ...c.appearance, [`${kind}${slot}`]: seen[seen.length - 1] } };
    console.log(`${c.name} ${kind} ${slot}:`, seen.map((s) => s.slice(0, 70)).join(" | "));
  }
}
console.log(`results: ${n} generations, ${bad} non-text, ${clash} too similar to another slot, ${retries} retries of ${calls} calls`);
assert.equal(bad, 0);
assert.ok(clash <= Math.ceil(n * 0.1), "at most 10% clashes after retry");
console.log("live ok");