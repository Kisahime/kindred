// Voice: local Kokoro TTS + faster-whisper STT helper, mic capture with VAD, sentence-chunked playback, call prompts.
import { invoke } from "@tauri-apps/api/core";
import { appearanceOf, buildSystemPrompt, Character } from "./types";
import type { ChatMessage } from "./ollama";

export interface VoiceHealth { ready: boolean; tts: boolean; stt: boolean; device: string | null; error: string | null; voices: string[]; whisper: string; }
export interface VoiceInfo { installed: boolean; running: boolean; dir: string; health: VoiceHealth | null; }
export const voiceApi = {
  info: () => invoke<VoiceInfo>("voice_info"),
  start: () => invoke<VoiceHealth>("voice_start"),
  stop: () => invoke<void>("voice_stop"),
  tts: (text: string, voice: string, speed: number) => invoke<ArrayBuffer>("voice_tts", { text, voice, speed }),
  stt: (wav: Uint8Array) => invoke<{ text: string; ms: number; seconds: number }>("voice_stt", wav),
  setCallActive: (active: boolean) => invoke<void>("set_call_active", { active }),
};
let starting: Promise<VoiceHealth> | null = null;
/** Starts the helper once (shared by every caller). */
export function ensureVoice(): Promise<VoiceHealth> {
  // health-checked every time (fast when running): image generation stops the helper to free VRAM
  if (!starting) starting = voiceApi.start().finally(() => { starting = null; });
  return starting;
}

// ---- voices -------------------------------------------------------------------
export const VOICE_LABEL: Record<string, string> = {
  af: "American woman", am: "American man", bf: "British woman", bm: "British man", ef: "Spanish woman", em: "Spanish man", ff: "French woman",
  hf: "Hindi woman", hm: "Hindi man", if: "Italian woman", im: "Italian man", jf: "Japanese woman", jm: "Japanese man", pf: "Portuguese woman", pm: "Portuguese man", zf: "Chinese woman", zm: "Chinese man",
};
export const voiceLabel = (v: string) => `${v.split("_")[1] ?? v} (${VOICE_LABEL[v.slice(0, 2)] ?? v.slice(0, 2)})`;
/** Kokoro v1.0 English voices (used before the engine has reported its list). */
export const KOKORO_EN = ["af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis"];
/** English voices only: the call pipeline speaks English. */
export const englishVoices = (all: string[]) => all.filter((v) => /^[ab][fm]_/.test(v));
/** A sensible default from looks: gender from "body", older characters get calmer British voices. */
export function suggestVoice(c: Pick<Character, "appearance">): string {
  const a = appearanceOf(c), body = a.body.toLowerCase();
  const woman = /\b(woman|girl|female|lady|grandma|grandmother)\b/.test(body), man = !woman && /\b(man|guy|male|grandad|grandfather|robot)\b/.test(body);
  if (man) return a.age >= 55 ? "bm_george" : a.age >= 35 ? "bm_lewis" : "am_michael";
  if (woman || !body) return a.age >= 55 ? "bf_emma" : a.age >= 35 ? "bf_isabella" : "af_heart";
  return "af_heart";
}
export const voiceOf = (c: Pick<Character, "appearance">) => appearanceOf(c).voice || suggestVoice(c);
/** Text as it should be spoken: no emoji, actions, markdown or URLs. */
export function speakable(t: string): string {
  return t.replace(/\*[^*]{0,200}\*/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ")
    .replace(/[_~`#>]/g, " ").replace(/:\)|:\(|:D|;\)|<3|xD/gi, " ").replace(/\s+/g, " ").trim();
}

// ---- playback -----------------------------------------------------------------
let ctx: AudioContext | null = null;
export const audioCtx = () => (ctx ??= new AudioContext());
export async function playWav(buf: ArrayBuffer, onSource?: (s: AudioBufferSourceNode) => void): Promise<void> {
  const ac = audioCtx(); if (ac.state === "suspended") await ac.resume();
  const data = await ac.decodeAudioData(buf.slice(0));
  return new Promise((res) => { const s = ac.createBufferSource(); s.buffer = data; s.connect(ac.destination); s.onended = () => res(); onSource?.(s); s.start(); });
}
/** One-off "voice note": speak a chat message. */
export async function speakMessage(c: Character, text: string, onSource?: (s: AudioBufferSourceNode) => void) {
  const t = speakable(text); if (!t) return;
  await ensureVoice();
  await playWav(await voiceApi.tts(t, voiceOf(c), appearanceOf(c).voiceSpeed || 1), onSource);
}
/** Ring / connect / hang-up tones (synthesised). */
export function tone(kind: "ring" | "connect" | "hangup") {
  const ac = audioCtx(), t0 = ac.currentTime, g = ac.createGain(); g.connect(ac.destination);
  const beep = (f: number, at: number, len: number, vol = 0.12) => { const o = ac.createOscillator(); o.frequency.value = f; o.connect(g); g.gain.setValueAtTime(vol, t0 + at); o.start(t0 + at); o.stop(t0 + at + len); };
  if (kind === "ring") { beep(440, 0, 0.4); beep(480, 0, 0.4); beep(440, 0.6, 0.4); beep(480, 0.6, 0.4); }
  else if (kind === "connect") { beep(660, 0, 0.12); beep(880, 0.14, 0.18); }
  else { beep(480, 0, 0.15); beep(360, 0.18, 0.25); }
}

/** Splits streaming text into speakable sentences as soon as they end. */
export class SentenceChunker {
  private buf = "";
  push(tok: string): string[] {
    this.buf += tok;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    const re = /^(.*?[.!?\u2026]+["')\]]?)(\s+)/s;
    while ((m = re.exec(this.buf)) && m[1].trim().length >= 2) { out.push(m[1].trim()); this.buf = this.buf.slice(m[0].length); }
    if (this.buf.length > 220) { const cut = this.buf.lastIndexOf(",", 200); if (cut > 40) { out.push(this.buf.slice(0, cut + 1).trim()); this.buf = this.buf.slice(cut + 1); } }
    return out;
  }
  flush(): string[] { const t = this.buf.trim(); this.buf = ""; return t ? [t] : []; }
}

// ---- reply cleaning (speaker labels, self-continuation) ----------------------------
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Strips a leading "Lily:" / "Alex:" label and cuts where the model starts a new labelled turn (it sometimes repeats itself as "Lily: ..."). */
export function cleanCallReply(text: string, names: string[]): string {
  const alt = names.filter(Boolean).map(escRe).join("|");
  if (!alt) return text.trim();
  let t = text;
  const lead = new RegExp(`^\\s*[*_"]*(?:${alt})[*_"]*\\s*:[*_]*\\s*`, "i");
  while (lead.test(t)) t = t.replace(lead, "");
  const cut = t.search(new RegExp(`(?:^|[\\s.!?\u2026,;)"\\]])[*_"]*(?:${alt})[*_"]*\\s*:`, "i"));
  if (cut > 0) t = t.slice(0, cut + (/[.!?\u2026,;)"\]]/.test(t[cut]) ? 1 : 0));
  // identical sentences back to back ("I was drifting off. I was drifting off.")
  const parts = t.match(/[^.!?\u2026]+[.!?\u2026]*\s*/g) ?? [t];
  const out: string[] = [];
  for (const p of parts) if (!out.length || out[out.length - 1].trim().toLowerCase() !== p.trim().toLowerCase()) out.push(p);
  return out.join("").trim();
}
/** Streaming version: feed tokens, get only the new clean text. Holds back a short tail so a label split across tokens is caught. */
export class ReplyCleaner {
  private raw = ""; private out = ""; stopped = false;
  private lead: RegExp; private label: RegExp; private hold: number;
  constructor(private names: string[]) {
    const alt = names.filter(Boolean).map(escRe).join("|") || "\u0000";
    this.lead = new RegExp(`^\\s*[*_"]*(?:${alt})[*_"]*\\s*:[*_]*\\s*`, "i");
    this.label = new RegExp(`(?:^|[\\s.!?\u2026,;)"\\]])[*_"]*(?:${alt})[*_"]*\\s*:`, "i");
    this.hold = Math.max(4, ...names.map((n) => n.length + 3));
  }
  private take(ready: string): string {
    if (!ready.startsWith(this.out) || ready.length <= this.out.length) return "";
    const d = ready.slice(this.out.length); this.out = ready; return d;
  }
  push(tok: string): string {
    if (this.stopped) return "";
    this.raw += tok;
    const head = this.raw.trimStart().toLowerCase();
    if (this.names.some((n) => n && head.length <= n.length + 2 && (n.toLowerCase() + ":").startsWith(head.replace(/^[*_"]+/, "")))) return ""; // maybe a leading label
    let body = this.raw; while (this.lead.test(body)) body = body.replace(this.lead, "");
    if (body.search(this.label) > 0) { this.stopped = true; return this.take(cleanCallReply(this.raw, this.names)); }
    const clean = cleanCallReply(this.raw, this.names);
    return this.take(clean.slice(0, Math.max(0, clean.length - this.hold)));
  }
  /** End of stream: the rest of the clean text. */
  end(): string { const d = this.stopped ? "" : this.take(cleanCallReply(this.raw, this.names)); this.stopped = true; return d; }
  get text() { return this.out; }
}
// ---- mic capture + VAD ----------------------------------------------------------
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const b = new ArrayBuffer(44 + samples.length * 2), v = new DataView(b);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Uint8Array(b);
}
export function downsample(x: Float32Array, from: number, to = 16000): Float32Array {
  if (from === to) return x;
  const r = from / to, out = new Float32Array(Math.floor(x.length / r));
  for (let i = 0; i < out.length; i++) { const s = Math.floor(i * r), e = Math.min(x.length, Math.floor((i + 1) * r)); let a = 0; for (let j = s; j < e; j++) a += x[j]; out[i] = a / Math.max(1, e - s); }
  return out;
}
export interface MicEvents { onSpeechStart: () => void; onUtterance: (wav: Uint8Array, seconds: number) => void; onLevel?: (rms: number) => void; }
/** Energy VAD with an adaptive noise floor. `ptt` = only record while the button is held. */
export class Mic {
  private stream: MediaStream | null = null; private node: ScriptProcessorNode | null = null; private src: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = []; private speaking = false; private silentMs = 0; private speechMs = 0; private floor = 0.004;
  muted = false; ptt = false; held = false; ttsPlaying = false;
  constructor(private ev: MicEvents) {}
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const ac = audioCtx(); if (ac.state === "suspended") await ac.resume();
    this.src = ac.createMediaStreamSource(this.stream);
    this.node = ac.createScriptProcessor(2048, 1, 1);
    const rate = ac.sampleRate, frameMs = (2048 / rate) * 1000;
    this.node.onaudioprocess = (e) => {
      const x = new Float32Array(e.inputBuffer.getChannelData(0));
      let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i];
      const rms = Math.sqrt(s / x.length);
      this.ev.onLevel?.(this.muted ? 0 : rms);
      if (this.muted) { this.reset(); return; }
      if (this.ptt) {
        if (this.held) { this.chunks.push(x); if (!this.speaking) { this.speaking = true; this.ev.onSpeechStart(); } }
        else if (this.speaking) this.finish(rate);
        return;
      }
      if (!this.speaking) this.floor = this.floor * 0.98 + Math.min(rms, 0.05) * 0.02;
      const thr = Math.max(0.012, this.floor * 3) * (this.ttsPlaying ? 2.5 : 1); // louder needed to barge in over the speaker
      const loud = rms > thr;
      if (loud) { this.speechMs += frameMs; this.silentMs = 0; } else this.silentMs += frameMs;
      if (!this.speaking) {
        this.chunks.push(x); if (this.chunks.length > 6) this.chunks.shift(); // pre-roll
        if (loud && this.speechMs > 120) { this.speaking = true; this.ev.onSpeechStart(); }
        if (!loud) this.speechMs = Math.max(0, this.speechMs - frameMs);
      } else {
        this.chunks.push(x);
        if (this.silentMs > 750 || this.chunks.length * frameMs > 30_000) this.finish(rate);
      }
    };
    this.src.connect(this.node); this.node.connect(ac.destination);
  }
  private reset() { this.chunks = []; this.speaking = false; this.silentMs = 0; this.speechMs = 0; }
  private finish(rate: number) {
    const total = this.chunks.reduce((n, c) => n + c.length, 0), all = new Float32Array(total);
    let o = 0; for (const c of this.chunks) { all.set(c, o); o += c.length; }
    this.reset();
    const secs = total / rate;
    if (secs < 0.4) return;
    this.ev.onUtterance(encodeWav(downsample(all, rate), 16000), secs);
  }
  stop() { this.node?.disconnect(); this.src?.disconnect(); this.stream?.getTracks().forEach((t) => t.stop()); this.node = null; this.stream = null; }
}
/** Whisper sometimes "hears" these in silence. */
export function isNoise(t: string) {
  const s = t.toLowerCase().replace(/[^a-z ]/g, "").trim();
  return !s || ["you", "thank you", "thanks for watching", "thank you for watching", "bye", "uh", "um", "hmm"].includes(s);
}

// ---- prompt ---------------------------------------------------------------------
export function buildCallMessages(c: Character, user: string, memories: string[], chatTail: ChatMessage[], lines: { me: boolean; t: string }[], incoming: boolean, extra = ""): ChatMessage[] {
  const sys = `${buildSystemPrompt(c, user, { memories })}\n\nYou are now on a live PHONE CALL with ${user} (${incoming ? "you called them" : "they called you"}). ` +
    "Speak naturally like on the phone: one to three short spoken sentences per turn, no emoji, no *actions*, no lists, no markdown. " +
    "Use casual spoken words, react to what they just said, and sometimes ask something back. Their words come from speech recognition, so ignore small transcription mistakes." + (extra ? `\n\n${extra}` : "");
  return [
    { role: "system", content: sys },
    ...chatTail,
    ...lines.map((l): ChatMessage => ({ role: l.me ? "user" : "assistant", content: l.t })),
    ...(lines.length === 0 ? [{ role: "user" as const, content: incoming ? `(${user} picks up the phone: "Hello?")` : `(You pick up ${user}'s call.)` }] : []),
  ];
}