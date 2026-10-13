// Headless phone-call tests: every hang-up state, timeouts, decline/groggy, StrictMode double start,
// and (with the voice engine + Ollama running) a scripted live turn fed by a synthesized WAV.
import assert from "node:assert/strict";
import * as all from "../dist-test/all.js";
const { callsession: S, typesMod: T, lifecore: L } = all;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lily = { ...T.blankCharacter(), id: "lily", name: "Lily", model: "qwen3:8b", status: "away", personality: "Sweet, bubbly florist.",
  life: { ...L.blankLife(), ...L.makeSchedule({ job: "working at the flower shop", workPlace: "flower shop", hobby: "painting", sleep: "23:00" }) } };
// deliberate answer decisions
assert.equal(S.decideAnswer(lily, new Date(2026, 9, 12, 23, 58)).mode, "groggy", "asleep -> answers groggily");
assert.equal(S.decideAnswer(lily, new Date(2026, 9, 13, 10, 0)).mode, "decline", "at work -> declines");
assert.equal(S.decideAnswer({ ...lily, status: "offline" }).mode, "decline");
assert.equal(S.decideAnswer(lily, new Date(2026, 9, 13, 19, 30)).mode, "answer");

function fakeDeps(over = {}) {
  const d = { tones: [], active: [], stopped: 0,
    ensureVoice: async () => ({ ready: true }), tts: async () => new ArrayBuffer(8), stt: async () => ({ text: "hello" }),
    chat: async (_m, _msgs, on) => { for (const t of ["Hi ", "there! ", "How are you?"]) { on(t); await sleep(5); } return "Hi there! How are you?"; },
    play: (_b, reg) => new Promise((res) => { const t = setTimeout(res, 30); reg(() => { clearTimeout(t); d.stopped++; res(); }); }),
    tone: (k) => d.tones.push(k), setCallActive: async (on) => d.active.push(on), ...over };
  return d;
}
function session(deps, extra = {}) {
  const ends = [], views = [];
  const s = new S.CallSession({ c: lily, user: "Alex", incoming: false, voice: "af_heart", speed: 1, memories: async () => [], chatTail: [], deps,
    answer: { mode: "answer", afterMs: 50 }, onChange: (v) => views.push(v), onEnd: (l) => ends.push(l), ...extra });
  return { s, ends, views };
}
// 1) hang up while the engine is still starting (never resolves)
{ const d = fakeDeps({ ensureVoice: () => new Promise(() => {}) }); const { s, ends } = session(d); s.start(); await sleep(20); s.hangUp();
  assert.equal(ends.length, 1); assert.equal(ends[0].missed, true); assert.deepEqual(d.active, [true, false]); s.hangUp(); assert.equal(ends.length, 1, "idempotent"); }
// 2) hang up while ringing: ring tones stop
{ const d = fakeDeps(); const { s, ends } = session(d, { answer: { mode: "answer", afterMs: 60_000 } }); s.start(); await sleep(30); s.hangUp();
  const n = d.tones.filter((t) => t === "ring").length; await sleep(2700); assert.equal(d.tones.filter((t) => t === "ring").length, n, "no more ringing after hang up");
  assert.ok(d.tones.includes("hangup")); assert.equal(ends[0].missed, true); }
// 3) ring timeout -> No answer
{ const d = fakeDeps(); const { s, ends, views } = session(d, { answer: { mode: "answer", afterMs: 60_000 }, ringTimeoutMs: 120 }); await s.start();
  assert.equal(ends.length, 1); assert.equal(ends[0].missed, true); assert.match(views.at(-2).status, /No answer/); }
// 4) busy -> declined with reason
{ const d = fakeDeps(); const { s, ends } = session(d, { answer: { mode: "decline", afterMs: 50, reason: "working at the flower shop" } }); await s.start();
  assert.equal(ends[0].declined, "working at the flower shop"); }
// 5) engine timeout -> readable error, hang up still works
{ const d = fakeDeps({ ensureVoice: () => new Promise(() => {}) }); const { s, ends, views } = session(d, { engineTimeoutMs: 80 }); await s.start();
  assert.match(views.at(-1).error, /voice engine didn't start/i); s.hangUp(); assert.equal(ends.length, 1); }
// 6) StrictMode: first session disposed before it connects, second connects; disposed one never reports
{ const d = fakeDeps(); const a = session(d), b = session(d); a.s.start(); a.s.dispose(); await b.s.start(); await sleep(50);
  assert.equal(b.s.view.phase, "live"); assert.equal(a.ends.length, 0); assert.equal(b.s.view.lines[0].t, "Hi there! How are you?");
  // 7) barge-in while speaking, then hang up while live
  const p = b.s.turn(); await sleep(25); b.s.speechStart(); await p; assert.ok(d.stopped >= 0);
  await b.s.heard(new Uint8Array(10)); b.s.hangUp(); assert.equal(b.ends.length, 1); assert.ok(b.ends[0].lines.some((l) => l.me && l.t === "hello")); assert.equal(b.ends[0].missed, undefined); }
// ---- speaker labels / duplicated replies ----
{ const { voice: V } = all; const N = ["Lily", "Alex"];
  assert.equal(V.cleanCallReply("Lily: Hello? Sweetheart? What's up?", N), "Hello? Sweetheart? What's up?");
  assert.equal(V.cleanCallReply("Lily: You sound a little tired... I was just drifting off myself.Lily: You sound a little tired... I was just drifting off myself.", N), "You sound a little tired... I was just drifting off myself.");
  assert.equal(V.cleanCallReply("**Lily:** hi! Alex: hey", N), "hi!");
  assert.equal(V.cleanCallReply("Aww okay. Okay! Aww okay. Bye.", N), "Aww okay. Okay! Aww okay. Bye.", "non-adjacent repeats kept");
  assert.equal(V.cleanCallReply("Night night. Night night.", N), "Night night.");
  assert.equal(V.cleanCallReply("I told her: no way.", N), "I told her: no way.", "colons in normal text kept");
  // streaming with labels split across tokens
  const toks = ["Li", "ly", ": You ", "sound tired", "... I was dri", "fting off myself.", "Li", "ly: You sound tired", "... again"];
  const rc = new V.ReplyCleaner(N); let got = ""; for (const k of toks) got += rc.push(k); got += rc.end();
  assert.equal(got, "You sound tired... I was drifting off myself.");
}
// CallSession: model output with labels + self-repeat -> one clean line, spoken once
{ const spoken = [];
  const d = fakeDeps({ tts: async (text) => { spoken.push(text); return new ArrayBuffer(8); },
    chat: async (_m, _msgs, on) => { const out = "Lily: Hello? Sweetheart? What's up?"; for (const ch of out.match(/.{1,4}/g)) { on(ch); await sleep(1); } return out; } });
  const { s, ends } = session(d); await s.start(); await sleep(80);
  assert.deepEqual(s.view.lines.map((l) => l.t), ["Hello? Sweetheart? What's up?"]);
  d.chat = async (_m, _msgs, on) => { const out = "Lily: You sound a little tired... I was just drifting off myself.Lily: You sound a little tired... I was just drifting off myself."; for (const ch of out.match(/.{1,5}/g)) { on(ch); await sleep(1); } return out; };
  d.stt = async () => ({ text: "Hello." });
  await s.heard(new Uint8Array(4)); await sleep(80);
  assert.deepEqual(s.view.lines.map((l) => `${l.me ? "You" : "Lily"}: ${l.t}`), ["Lily: Hello? Sweetheart? What's up?", "You: Hello.", "Lily: You sound a little tired... I was just drifting off myself."]);
  assert.equal(spoken.filter((x) => /drifting/.test(x)).length, 1, "spoken once");
  assert.ok(spoken.every((x) => !/Lily:/.test(x)), "label never spoken");
  s.hangUp(); assert.equal(ends.length, 1); assert.equal(ends[0].lines.length, 3, "saved log not duplicated");
  const model = all.typesMod.toModelText(`${all.typesMod.CALL} ${JSON.stringify(ends[0])}`, false, "Alex", "Lily");
  assert.equal((model.match(/drifting/g) ?? []).length, 1, "history/memory text not duplicated"); }
console.log("labels/dup ok");
console.log("unit ok");

// live: real engine + Ollama, no mic: synthesized WAV fed to STT
const H = "http://127.0.0.1:8765";
let h; try { h = await (await fetch(`${H}/health`)).json(); } catch {}
if (!h?.ready) { console.log("voice engine not running: live skipped"); process.exit(0); }
const t = { tts: [], stt: [], firstAudio: 0 };
const live = fakeDeps({
  tts: async (text, voice, speed) => { const t0 = Date.now(); const r = await fetch(`${H}/tts`, { method: "POST", body: JSON.stringify({ text, voice, speed }) }); const b = await r.arrayBuffer(); t.tts.push(Date.now() - t0); return b; },
  stt: async (wav) => { const t0 = Date.now(); const r = await (await fetch(`${H}/stt`, { method: "POST", body: wav })).json(); t.stt.push(Date.now() - t0); return r; },
  chat: async (model, messages, on) => {
    const res = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ model, messages, stream: true, think: false }) });
    let full = "", buf = ""; const dec = new TextDecoder();
    for await (const ch of res.body) { buf += dec.decode(ch, { stream: true }); let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; const tok = JSON.parse(l).message?.content ?? ""; full += tok; on(tok); } }
    return full;
  },
  play: (b, reg) => { if (!t.firstAudio) t.firstAudio = Date.now(); const secs = (b.byteLength - 44) / 48000; return new Promise((res) => { const x = setTimeout(res, Math.min(400, secs * 100)); reg(() => { clearTimeout(x); res(); }); }); },
});
const { s, ends } = session(live, { answer: S.decideAnswer(lily, new Date(2026, 9, 12, 23, 58)) });
s.o.answer.afterMs = 500; // shorten the extra rings for the test
const t0 = Date.now(); await s.start();
console.log(`connected + Lily's groggy first turn in ${Date.now() - t0} ms: "${s.view.lines.at(-1)?.t}"`);
assert.equal(s.view.phase, "live");
const said = await (await fetch(`${H}/tts`, { method: "POST", body: JSON.stringify({ text: "Sorry Lily, did I wake you up? I just wanted to say goodnight.", voice: "bf_emma" }) })).arrayBuffer();
t.firstAudio = 0; const t1 = Date.now();
await s.heard(new Uint8Array(said));
console.log(`heard: "${s.view.lines.at(-2)?.t}" -> Lily: "${s.view.lines.at(-1)?.t}"`);
console.log(`latency: STT ${t.stt.at(-1)} ms, her voice starts ${t.firstAudio - t1} ms after the utterance, TTS per sentence ${t.tts.join("/")} ms`);
assert.match(s.view.lines.at(-2).t.toLowerCase(), /wake you up/);
s.hangUp(); assert.equal(ends.length, 1); assert.ok(ends[0].lines.length >= 3);
console.log("call log:", JSON.stringify(ends[0]).slice(0, 300));
console.log("live ok");