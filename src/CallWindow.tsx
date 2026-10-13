import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { api } from "./api";
import { streamChat, ChatMessage } from "./ollama";
import { appearanceOf, CallLog, Character, fmtDuration } from "./types";
import { ensureVoice, Mic, playWav, tone, voiceApi, voiceOf } from "./voice";
import { Answer, CallSession, CallView } from "./callsession";

interface Props { c: Character; userName: string; incoming: boolean; answer: Answer; memories: () => Promise<string[]>; chatTail: ChatMessage[]; onEnd: (log: CallLog) => void; extra?: string; }

/** Messenger-style call overlay. All logic lives in CallSession; this only renders it and owns the mic. */
export function CallWindow({ c, userName, incoming, answer, memories, chatTail, onEnd, extra }: Props) {
  const [v, setV] = useState<CallView>({ phase: "starting", status: "Starting voice engine\u2026", lines: [], caption: "", secs: 0, error: null, speaking: false });
  const [muted, setMuted] = useState(false);
  const [ptt, setPtt] = useState(false);
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const session = useRef<CallSession | null>(null);
  const mic = useRef<Mic | null>(null);
  const capRef = useRef<HTMLDivElement>(null);
  const endRef = useRef(onEnd); endRef.current = onEnd;

  useEffect(() => {
    // one session per effect run: StrictMode's mount/unmount/mount gets a fresh, independent session
    const s = new CallSession({
      c, user: userName, incoming, voice: voiceOf(c), speed: appearanceOf(c).voiceSpeed || 1, memories, chatTail, answer, extra,
      deps: {
        warm: (model) => api.ollamaJson(model, [{ role: "user", content: "Reply with {}" }]),
        ensureVoice, tts: voiceApi.tts, stt: voiceApi.stt, setCallActive: voiceApi.setCallActive, tone,
        chat: (model, msgs, onToken) => streamChat(model, msgs, { onToken }),
        play: (buf, register) => playWav(buf, (src) => register(() => { try { src.stop(); } catch { /* ended */ } })),
      },
      onChange: setV,
      onEnd: (log) => { mic.current?.stop(); mic.current = null; endRef.current(log); },
    });
    session.current = s;
    s.start();
    const m = new Mic({ onSpeechStart: () => s.speechStart(), onUtterance: (w) => { s.heard(w); }, onLevel: setLevel });
    m.start().then(() => { if (s.isClosed) m.stop(); else mic.current = m; })
      .catch((e) => setMicError(/Permission|NotAllowed|denied/i.test(String(e)) ? "Microphone access was blocked. Allow it in Windows Settings > Privacy & security > Microphone, then call again." : `Microphone: ${e}`));
    return () => { s.dispose(); m.stop(); if (mic.current === m) mic.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (mic.current) mic.current.ttsPlaying = v.speaking; }, [v.speaking]);
  useEffect(() => { if (mic.current) mic.current.muted = muted; }, [muted]);
  useEffect(() => { if (mic.current) { mic.current.ptt = ptt; mic.current.held = false; } }, [ptt]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); session.current?.hangUp(); }
      else if (ptt && e.code === "Space" && !e.repeat && mic.current) { e.preventDefault(); mic.current.held = true; }
    };
    const up = (e: KeyboardEvent) => { if (ptt && e.code === "Space" && mic.current) { e.preventDefault(); mic.current.held = false; } };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [ptt]);
  useEffect(() => { capRef.current?.scrollTo({ top: capRef.current.scrollHeight }); }, [v.lines, v.caption]);
  const hold = (on: boolean) => { if (mic.current) mic.current.held = on; };

  return (
    <div className="modal-backdrop call-backdrop">
      <div className="call-window" role="dialog" aria-label={`Call with ${c.name}`}>
        <div className="call-head">
          <div className={`call-avatar${v.speaking ? " talking" : ""}${v.phase === "ringing" ? " ringing" : ""}`}><Avatar big emoji={c.avatar} path={c.avatarPath} color={c.color} /></div>
          <div><div className="call-name">{c.name}</div>
            <div className="call-state">{v.phase === "live" ? fmtDuration(v.secs) : v.phase === "ringing" ? "Ringing\u2026" : v.phase === "ended" ? "Call ended" : "Connecting\u2026"} {"\u00B7"} {v.status}</div></div>
        </div>
        <div className="call-captions" ref={capRef}>
          {v.lines.map((l, i) => <div key={i} className={l.me ? "me" : "them"}><b>{l.me ? "You" : c.name}:</b> {l.t}</div>)}
          {v.caption && <div className="them live"><b>{c.name}:</b> {v.caption}</div>}
          {v.error && <div className="call-error">{"\u26A0\uFE0F"} {v.error}</div>}
          {micError && <div className="call-error">{"\u{1F3A4}"} {micError}</div>}
        </div>
        <div className="call-level"><i style={{ width: `${Math.min(100, level * 900)}%` }} /></div>
        <div className="call-buttons">
          <button className={muted ? "sel" : ""} onClick={() => setMuted((m) => !m)}>{muted ? "\u{1F507} Unmute" : "\u{1F399}\uFE0F Mute"}</button>
          <label className="check"><input type="checkbox" checked={ptt} onChange={(e) => setPtt(e.target.checked)} /> Push to talk</label>
          {ptt && <button className="ptt" onMouseDown={() => hold(true)} onMouseUp={() => hold(false)} onMouseLeave={() => hold(false)}>Hold to talk (or Space)</button>}
          <span className="spacer" />
          <button className="hangup" onClick={() => session.current?.hangUp()} title="Hang up (Esc)">{"\u{1F4F5}"} Hang up</button>
        </div>
      </div>
    </div>
  );
}