// Tests for the first-run setup checklist (pure logic).
import assert from "node:assert/strict";
import * as all from "../dist-test/all.js";
const { setupStatus, setupReady } = all.setupMod;
const base = { ollama: true, models: ["qwen3:8b"], defaultModel: "qwen3:8b", image: false, voice: false };
let r = setupStatus(base);
assert.equal(setupReady(r), true, "ollama + model is enough");
assert.equal(r.find((i) => i.key === "image").required, false);
assert.equal(r.find((i) => i.key === "voice").required, false);
r = setupStatus({ ...base, models: ["mistral:latest"] });
assert.equal(setupReady(r), false);
assert.match(r.find((i) => i.key === "model").hint, /ollama pull qwen3:8b/);
r = setupStatus({ ...base, ollama: false, models: [] });
assert.equal(setupReady(r), false);
assert.equal(r.find((i) => i.key === "model").ok, false);
r = setupStatus({ ...base, models: ["mymodel:latest"], defaultModel: "mymodel" });
assert.equal(r.find((i) => i.key === "model").ok, true, "untagged name matches :latest");
for (const i of setupStatus(base)) for (const l of i.links) assert.match(l.url, /^https:\/\/(ollama\.com|github\.com|huggingface\.co)\//);
console.log("setup tests passed");
