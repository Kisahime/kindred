// Phone call state machine, independent of React (so it can be tested headless and survives StrictMode double effects).
import type { ChatMessage } from "./ollama";
import { CallLog, Character } from "./types";
import { currentBlock, lifeOf } from "./lifecore";
import { buildCallMessages, isNoise, ReplyCleaner, SentenceChunker, speakable, VoiceHealth } from "./voice";

export interface CallDeps {
  ensureVoice: () => Promise<VoiceHealth>;
  tts: (text: string, voice: string, speed: number) => Promise<ArrayBuffer>;
  stt: (wav: Uint8Array) => Promise<{ text: string }>;
  chat: (model: string, msgs: ChatMessage[], onToken: (t: string) => void) => Promise<string>;
  /** Plays audio; `register` receives a stop function for barge-in / hang-up. */
  play: (buf: ArrayBuffer, register: (stop: () => void) => void) => Promise<void>;
  tone: (kind: "ring" | "connect" | "hangup") => void;
  setCallActive: (on: boolean) => Promise<void>;
  /** Optional: load the chat model while it rings (saves the cold start on the first reply). */
  warm?: (model: string) => Promise<unknown>;
}
export type Phase = "starting" | "ringing" | "live" | "ended";
export interface CallView { phase: Phase; status: string; lines: { me: boolean; t: string }[]; caption: string; secs: number; error: string | null; speaking: boolean; }
/** How the character reacts to Alex's call. */
export interface Answer { mode: "answer" | "groggy" | "decline"; afterMs: number; reason?: string; }

/** Deliberate pick-up behaviour from status + schedule (never "ring forever"). */
export function decideAnswer(c: Character, now = new Date()): Answer {
  if (c.status === "offline") return { mode: "decline", afterMs: 12_000, reason: "offline" };
  const b = currentBlock(lifeOf(c), now)?.block;
  if (b?.status === "sleeping") return { mode: "groggy", afterMs: 10_000, reason: "asleep" };
  if (b?.status === "busy" || c.status === "busy") return { mode: "decline", afterMs: 7_500, reason: b ? b.activity : "busy" };
  return { mode: "answer", afterMs: 2_500 + Math.random() * 2_500 };
}
const GROGGY = "(You were fast asleep and the ringing phone just woke you up. You're groggy, yawning and a bit confused at first, speaking slowly and sleepily, but happy it's them.)";

export interface CallOptions {
  c: Character; user: string; incoming: boolean; voice: string; speed: number;
  memories: () => Promise<string[]>; chatTail: ChatMessage[]; deps: CallDeps; answer: Answer;
  /** Gifts/café context (connected economy). */
  extra?: string;
  onChange: (v: CallView) => void; onEnd: (log: CallLog) => void;
  ringTimeoutMs?: number; engineTimeoutMs?: number;
}

export class CallSession {
  private v: CallView = { phase: "starting", status: "Starting voice engine\u2026", lines: [], caption: "", secs: 0, error: null, speaking: false };
  private closed = false; private timers = new Set<ReturnType<typeof setTimeout>>(); private intervals = new Set<ReturnType<typeof setInterval>>();
  private turnId = 0; private stopAudio: (() => void) | null = null; private said = ""; private mems: string[] = [];
  constructor(private o: CallOptions) {}
  get view() { return this.v; }
  get isClosed() { return this.closed; }
  private set(p: Partial<CallView>) { if (this.closed && p.phase !== "ended") return; this.v = { ...this.v, ...p }; this.o.onChange(this.v); }
  private after(ms: number) { return new Promise<void>((res) => { const t = setTimeout(() => { this.timers.delete(t); res(); }, ms); this.timers.add(t); }); }
  private every(ms: number, f: () => void) { const i = setInterval(f, ms); this.intervals.add(i); return i; }
  private stopTimers() { this.timers.forEach(clearTimeout); this.intervals.forEach(clearInterval); this.timers.clear(); this.intervals.clear(); }
  private withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    return new Promise<T>((res, rej) => {
      const t = setTimeout(() => { this.timers.delete(t); rej(new Error(what)); }, ms); this.timers.add(t);
      p.then((x) => { clearTimeout(t); this.timers.delete(t); res(x); }, (e) => { clearTimeout(t); this.timers.delete(t); rej(e); });
    });
  }

  async start() {
    try {
      this.o.deps.setCallActive(true).catch(() => {});
      this.o.deps.warm?.(this.o.c.model).catch(() => {});
      const t0 = Date.now();
      const tick = this.every(1000, () => this.set({ status: `Starting voice engine\u2026 ${Math.round((Date.now() - t0) / 1000)} s` }));
      const [, mems] = await Promise.all([
        this.withTimeout(this.o.deps.ensureVoice(), this.o.engineTimeoutMs ?? 90_000, "The voice engine didn't start in time. See data\\logs\\voice.log."),
        this.o.memories().catch(() => [] as string[]),
      ]);
      clearInterval(tick); this.intervals.delete(tick);
      if (this.closed) return;
      this.mems = mems;
      if (!this.o.incoming) {
        this.set({ phase: "ringing", status: `Calling ${this.o.c.name}\u2026` });
        this.o.deps.tone("ring");
        const ring = this.every(2500, () => this.o.deps.tone("ring"));
        const a = this.o.answer, limit = this.o.ringTimeoutMs ?? 30_000;
        await this.after(Math.min(a.afterMs, limit));
        clearInterval(ring); this.intervals.delete(ring);
        if (this.closed) return;
        if (a.mode === "decline" || a.afterMs >= limit) {
          const why = a.reason === "offline" ? "No answer" : a.reason && a.mode === "decline" ? `${this.o.c.name} declined (${a.reason})` : "No answer";
          this.set({ status: why });
          this.finish({ d: 0, missed: true, incoming: false, lines: [], declined: a.reason } as CallLog, false);
          return;
        }
      }
      this.o.deps.tone("connect");
      this.set({ phase: "live", status: "Connected" });
      this.every(1000, () => this.set({ secs: this.v.secs + 1 }));
      await this.turn(this.o.answer.mode === "groggy" && !this.o.incoming ? GROGGY : undefined);
    } catch (e) {
      if (!this.closed) this.set({ error: e instanceof Error ? e.message : String(e), status: "Couldn't connect" });
    }
  }

  /** Character's turn: stream the reply and speak each finished sentence right away. */
  async turn(note?: string) {
    const id = ++this.turnId;
    this.set({ status: `${this.o.c.name} is thinking\u2026`, caption: "" });
    const chunk = new SentenceChunker();
    const clean = new ReplyCleaner([this.o.c.name, this.o.user]);
    let shown = "", chain: Promise<void> = Promise.resolve();
    const feed = (d: string) => { if (!d) return; shown += d; this.set({ caption: speakable(shown) }); chunk.push(d).forEach(enqueue); };
    this.said = "";
    const enqueue = (s: string) => {
      const sp = speakable(s); if (!sp) return;
      const audio = this.o.deps.tts(sp, this.o.voice, this.o.speed);
      chain = chain.then(async () => {
        if (id !== this.turnId || this.closed) return;
        const buf = await audio.catch((e) => { this.set({ error: `Voice: ${e}` }); return null; });
        if (!buf || id !== this.turnId || this.closed) return;
        this.set({ speaking: true, status: `${this.o.c.name} is talking` });
        await this.o.deps.play(buf, (stop) => { this.stopAudio = stop; });
        this.stopAudio = null;
        if (id === this.turnId) this.said = `${this.said} ${s}`.trim();
        this.set({ speaking: false });
      });
    };
    try {
      const msgs = buildCallMessages(this.o.c, this.o.user, this.mems, this.o.chatTail, this.v.lines, this.o.incoming, this.o.extra ?? "");
      if (note) msgs.splice(1, 0, { role: "system", content: note });
      // tokens go through the cleaner only; the final return value is NOT appended again
      await this.o.deps.chat(this.o.c.model, msgs, (tok) => {
        if (id !== this.turnId || this.closed) return;
        feed(clean.push(tok));
      });
      if (id !== this.turnId || this.closed) return;
      feed(clean.end());
      chunk.flush().forEach(enqueue);
      await chain;
      if (id !== this.turnId || this.closed) return;
      const t = speakable(shown);
      this.set({ lines: t ? [...this.v.lines, { me: false, t }] : this.v.lines, caption: "", status: "Listening\u2026" });
    } catch (e) { if (id === this.turnId && !this.closed) this.set({ error: e instanceof Error ? e.message : String(e), status: "Listening\u2026" }); }
  }
  /** Alex started speaking: cut the character off (barge-in). */
  speechStart() {
    if (this.closed || this.v.phase !== "live") return;
    if (this.v.speaking || this.stopAudio) {
      const said = this.said; this.turnId++; this.stopAudio?.(); this.stopAudio = null;
      this.set({ speaking: false, caption: "", lines: said ? [...this.v.lines, { me: false, t: `${said} \u2014` }] : this.v.lines });
    }
    this.set({ status: "Listening to you\u2026" });
  }
  async heard(wav: Uint8Array) {
    if (this.closed || this.v.phase !== "live") return;
    this.set({ status: "\u2026" });
    try {
      const r = await this.o.deps.stt(wav);
      if (this.closed) return;
      if (isNoise(r.text)) { this.set({ status: "Listening\u2026" }); return; }
      this.turnId++; this.stopAudio?.();
      this.set({ lines: [...this.v.lines, { me: true, t: r.text.trim() }] });
      await this.turn();
    } catch (e) { if (!this.closed) this.set({ error: `Speech recognition: ${e instanceof Error ? e.message : e}`, status: "Listening\u2026" }); }
  }
  private finish(log: CallLog, sound: boolean) {
    if (this.closed) return;
    this.closed = true; this.turnId++;
    this.stopTimers();
    try { this.stopAudio?.(); } catch { /* ignore */ }
    this.stopAudio = null;
    if (sound) this.o.deps.tone("hangup");
    this.o.deps.setCallActive(false).catch(() => {});
    this.v = { ...this.v, phase: "ended", speaking: false };
    this.o.onChange(this.v);
    this.o.onEnd(log);
  }
  /** Always works, in every phase. */
  hangUp() {
    const lines = [...this.v.lines];
    if (this.v.caption && this.said) lines.push({ me: false, t: `${this.said} \u2014` });
    const live = this.v.phase === "live";
    this.finish({ d: this.v.secs, incoming: this.o.incoming, lines, ...(live || this.o.incoming ? {} : { missed: true }) }, true);
  }
  /** Tear down without reporting (component unmounted). */
  dispose() {
    if (this.closed) return;
    this.closed = true; this.turnId++; this.stopTimers();
    try { this.stopAudio?.(); } catch { /* ignore */ }
    this.o.deps.setCallActive(false).catch(() => {});
  }
}