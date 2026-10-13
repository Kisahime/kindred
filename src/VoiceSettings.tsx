import { useState } from "react";
import { Appearance, appearanceOf, Character } from "./types";
import { KOKORO_EN, speakMessage, suggestVoice, voiceLabel } from "./voice";

/** "Voice & calls" section of the contact editor. */
export function VoiceSettings({ c, onChange, onTestCall }: { c: Character; onChange: (a: Appearance) => void; onTestCall?: () => void }) {
  const a = appearanceOf(c);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Appearance>(k: K, v: Appearance[K]) => onChange({ ...a, [k]: v });
  const suggested = suggestVoice(c);
  const preview = async () => {
    setBusy(true); setNote("Starting the voice engine (the first time takes up to a minute)\u2026");
    try { await speakMessage(c, c.greeting || `Hi, it's ${c.name || "me"}! How are you doing today?`); setNote(null); }
    catch (e) { setNote(`Voice failed: ${e instanceof Error ? e.message : e}`); } finally { setBusy(false); }
  };
  return (
    <div className="appearance-box">
      <button className="link" onClick={() => setOpen((o) => !o)}>{open ? "\u25BE" : "\u25B8"} Voice &amp; phone calls</button>
      {open && <>
        <div className="row2">
          <label>Voice<select value={a.voice} onChange={(e) => set("voice", e.target.value)}>
            <option value="">Suggested: {voiceLabel(suggested)}</option>
            {KOKORO_EN.map((v) => <option key={v} value={v}>{voiceLabel(v)}</option>)}</select></label>
          <label>Speed <b>{a.voiceSpeed.toFixed(2)}x</b><input type="range" min={0.7} max={1.4} step={0.05} value={a.voiceSpeed} onChange={(e) => set("voiceSpeed", +e.target.value)} /></label>
        </div>
        <div className="row-btns"><button disabled={busy} onClick={preview}>{"\u{1F50A}"} Preview voice</button>
          {onTestCall && <button onClick={onTestCall}>{"\u{1F4DE}"} Test: call me now</button>}</div>
        <label className="switch-row">
          <span className={`switch${a.canCall ? " on" : ""}`} role="switch" aria-checked={a.canCall} tabIndex={0} onClick={() => set("canCall", !a.canCall)}><i /></span>
          Can call me (rarely; only when "Can message me first" is on, never in quiet hours or while busy/asleep)
        </label>
        {note && <small className="ed-note">{note}</small>}
      </>}
    </div>
  );
}