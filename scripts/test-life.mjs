// Relationships / schedule / milestone helpers. Live parts need Ollama (skipped if not reachable).
import assert from "node:assert/strict";
import * as all from "../dist-test/all.js";
const { lifecore: L, life, typesMod, selfie } = all;
const base = { ...typesMod.blankCharacter(), name: "Juniper", personality: "Gentle plant lover, works at a garden centre.", backstory: "Lives in a flat full of plants.", model: "qwen3:8b", mood: "cosy", closeness: 50 };

// schedule + current block
const j = { ...base, life: { ...L.blankLife(), ...L.starterLife("Juniper") } };
const tue10 = new Date(2026, 9, 13, 10, 0), tue0130 = new Date(2026, 9, 13, 1, 30), sat12 = new Date(2026, 9, 17, 12, 0);
assert.equal(L.currentBlock(L.lifeOf(j), tue10).block.activity, "working at the garden centre");
assert.equal(L.currentBlock(L.lifeOf(j), tue0130).block.status, "sleeping", "after midnight = yesterday's last block");
assert.equal(L.currentBlock(L.lifeOf(j), sat12).weekend, true);
assert.deepEqual(L.scheduleStatus(L.currentBlock(L.lifeOf(j), tue10)), { status: "busy", personalMessage: "working at the garden centre" });
assert.match(L.nowPrompt(j, tue10), /right now .* you are working at the garden centre \(garden centre greenhouse\)/);
assert.equal(L.currentBlock(L.blankLife(), tue10), null);
assert.equal(L.normalizeBlocks([{ start: "7:5", activity: "x" }, { start: "25:00", activity: "y" }, { start: "8:00", activity: "ok", status: "weird" }]).length, 1);
// selfie uses the schedule's place and night outfit while asleep
assert.match(selfie.buildSelfiePrompt(j, "", tue10).prompt, /garden centre greenhouse/);
assert.match(selfie.buildSelfiePrompt(j, "", tue0130).prompt, /pyjamas/);
// proactive respects the schedule
const me = { userName: "Alex", status: "online", quietStart: "23:00", quietEnd: "08:00" };
assert.match(all.skipReason({ ...j, proactiveEnabled: true, status: "online" }, me, [], false, tue10), /garden centre/);
// prompts: family never romantic, romantic allowed
const fam = L.relationshipPrompt({ name: "Rose", life: { relationship: "grandparent", relationshipDetail: "grandma" } }, "Alex");
assert.match(fam, /Alex's grandma/); assert.match(fam, /Never be romantic/);
assert.match(L.relationshipPrompt({ name: "A", life: { relationship: "child", relationshipDetail: "daughter" } }, "Alex"), /adult daughter.*Never be romantic/);
assert.match(L.relationshipPrompt({ name: "A", life: { relationship: "partner", relationshipDetail: "girlfriend", petName: "honey" } }, "Alex"), /girlfriend.*romantic.*"honey"/);
assert.doesNotMatch(L.relationshipPrompt({ name: "A", life: { relationship: "sibling", relationshipDetail: "sister", petName: "honey" } }, "Alex"), /honey/);
assert.match(typesMod.buildSystemPrompt({ ...base, life: { relationship: "best friend" } }, "Alex"), /best friends/);
// evolution
const fr = { ...base, appearance: { body: "woman" }, life: { relationship: "crush", canEvolve: true } };
assert.equal(L.evolutionDue({ ...fr, closeness: 60 }), null);
assert.deepEqual({ ...L.evolutionDue({ ...fr, closeness: 80 }, 1e13), at: 0 }, { to: "partner", detail: "girlfriend", at: 0 });
assert.equal(L.evolutionDue({ ...fr, closeness: 80, life: { ...fr.life, lastProposalAt: 1e13 - 3600e3 } }, 1e13), null, "3-day cooldown after a no");
assert.equal(L.evolutionDue({ ...fr, closeness: 80, life: { relationship: "crush" } }), null, "toggle off");
// unlocks
assert.deepEqual(L.unlocksDue({ closeness: 58, life: { relationship: "friend" } }, []).map((u) => u.kind), ["nickname"]);
assert.deepEqual(L.unlocksDue({ closeness: 58, life: { relationship: "partner" } }, [{ kind: "nickname", data: "" }]).map((u) => u.kind), ["pet_name"]);
// anniversaries
const met = new Date(2026, 0, 31).getTime();
assert.equal(L.anniversaryMonths(met, new Date(2026, 1, 28)), 1, "short months use their last day");
assert.equal(L.anniversaryMonths(met, new Date(2026, 1, 27)), 0);
assert.equal(L.anniversaryMonths(met, new Date(2027, 0, 31)), 12);
assert.equal(L.anniversaryLabel(12), "1 year"); assert.equal(L.anniversaryLabel(3), "3 months");
console.log("unit ok");

let up = false; try { up = (await fetch("http://127.0.0.1:11434/api/tags")).ok; } catch {}
if (!up) { console.log("Ollama not reachable: live skipped"); process.exit(0); }
life.setLifeJsonCaller(async (model, messages) => {
  const r = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ model, messages, stream: false, format: "json", think: false, options: { temperature: 0.2 } }) });
  return (await r.json()).message.content;
});
const t0 = Date.now();
const s = await life.generateSchedule(base);
console.log(`schedule (${Date.now() - t0} ms):`, s.weekday.map((b) => `${b.start} ${b.activity} [${b.status}]`).join(" | "));
assert.ok(s.weekday.length >= 3 && s.weekday.some((b) => b.status === "sleeping" || /sleep|bed/i.test(b.activity)));
const fp = await life.generateFeedPost(j, "Alex");
console.log("feed post:", fp);
assert.ok(fp.post.length > 3 && fp.post.length <= 220);
const nick = life.interpretUnlock("nickname", JSON.parse(await (async () => { const r = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ model: base.model, messages: life.buildUnlockPrompt(j, "Alex", "nickname", []), stream: false, format: "json", think: false }) }); return (await r.json()).message.content; })()));
console.log("nickname:", nick); assert.ok(nick.length > 0 && nick.length <= 30);
console.log("live ok");