// Voice helpers + live Kokoro -> Whisper round trip and call-turn latency. Needs engine/voice/server.py running for the live part.
import assert from "node:assert/strict";
import * as all from "../dist-test/all.js";
const { voice: V, typesMod: T } = all;
const ch = new V.SentenceChunker();
assert.deepEqual(ch.push("Hey you! How "), ["Hey you!"]); assert.deepEqual(ch.push("are you? I'm "), ["How are you?"]); assert.deepEqual(ch.flush(), ["I'm"]);
assert.equal(V.speakable("*waves* Hi there \u{1F60A}! https://x.y :)"), "Hi there !");
assert.equal(V.suggestVoice({ appearance: { body: "elderly woman", age: 74 } }), "bf_emma");
assert.equal(V.suggestVoice({ appearance: { body: "man, athletic", age: 27 } }), "am_michael");
assert.equal(V.suggestVoice({ appearance: { body: "woman", age: 29, voice: "" } }), "af_heart");
const w = V.encodeWav(new Float32Array(16000), 16000); assert.equal(w.length, 44 + 32000);
assert.equal(V.downsample(new Float32Array(48000), 48000).length, 16000);
assert.ok(V.isNoise("Thank you.")); assert.ok(!V.isNoise("I had a lovely day"));
const log = `${T.CALL} ${JSON.stringify({ d: 125, lines: [{ me: true, t: "hi" }, { me: false, t: "hello!" }] })}`;
assert.match(T.toModelText(log, false, "Alex", "Lily"), /Phone call between Lily and Alex \(2:05\):\*\nAlex: hi\nLily: hello!/);
assert.match(T.toModelText(`${T.CALL} {"d":0,"missed":true,"incoming":true,"lines":[]}`, false, "Alex", "Lily"), /Lily tried to phone Alex/);
const msgs = V.buildCallMessages({ ...T.blankCharacter(), name: "Lily" }, "Alex", [], [], [], true);
assert.match(msgs[0].content, /PHONE CALL/); assert.match(msgs[msgs.length - 1].content, /picks up/);
console.log("unit ok");

const H = "http://127.0.0.1:8765";
let h; try { h = await (await fetch(`${H}/health`)).json(); } catch {}
if (!h?.ready) { console.log("voice engine not running: live skipped"); process.exit(0); }
console.log(`engine: whisper ${h.whisper} on ${h.device}, ${h.voices.length} voices`);
const tts = async (text, voice = "bf_emma") => { const t = Date.now(); const r = await fetch(`${H}/tts`, { method: "POST", body: JSON.stringify({ text, voice, speed: 1 }) }); const b = new Uint8Array(await r.arrayBuffer()); return { b, ms: Date.now() - t, server: +r.headers.get("x-ms") }; };
const stt = async (b) => { const t = Date.now(); const r = await (await fetch(`${H}/stt`, { method: "POST", body: b })).json(); return { ...r, total: Date.now() - t }; };
const sentence = "Hi Alex! I just got back from the garden centre, and I'm putting the kettle on.";
await tts("Warm up."); // first call compiles the graph
for (const v of ["bf_emma", "af_heart", "am_michael"]) {
  const a = await tts(sentence, v), s = await stt(a.b);
  const audio = (a.b.length - 44) / 2 / 24000;
  console.log(`${v}: TTS ${a.ms} ms for ${audio.toFixed(1)} s audio (RTF ${(a.ms / 1000 / audio).toFixed(2)}) | STT ${s.total} ms -> "${s.text}"`);
  assert.match(s.text.toLowerCase(), /garden centre|garden center/); assert.match(s.text.toLowerCase(), /kettle/);
}
// call-turn latency: Ollama streaming first sentence + TTS of it = time until she hears the reply
const c = { ...T.blankCharacter(), name: "Juniper", personality: "Gentle plant lover.", model: "qwen3:8b", mood: "cosy" };
const m = V.buildCallMessages(c, "Alex", [], [], [{ me: true, t: "Hey Juniper, how was work today?" }], false);
const t0 = Date.now(); let first = 0, full = "";
const res = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ model: c.model, messages: m, stream: true, think: false }) });
const ck = new V.SentenceChunker(); let firstSentence = null, buf = "";
const dec = new TextDecoder();
for await (const chunk of res.body) {
  buf += dec.decode(chunk, { stream: true }); let i;
  while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
    const tok = JSON.parse(line).message?.content ?? ""; if (!first && tok) first = Date.now() - t0; full += tok;
    const s = ck.push(tok); if (s.length && !firstSentence) firstSentence = { s: s[0], at: Date.now() - t0 }; }
}
if (!firstSentence) firstSentence = { s: ck.flush()[0] ?? full, at: Date.now() - t0 };
const a1 = await tts(V.speakable(firstSentence.s), "af_heart");
console.log(`reply: "${full.trim()}"`);
console.log(`latency: first token ${first} ms, first sentence ${firstSentence.at} ms, + TTS ${a1.ms} ms => audio starts ~${firstSentence.at + a1.ms} ms after she stops talking (+ Whisper ~${(await stt(V.encodeWav(new Float32Array(16000 * 2), 16000))).total} ms for 2 s)`);
console.log("live ok");