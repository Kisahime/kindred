import { AppearanceEditor } from "./AppearanceEditor";
import { LifeEditor } from "./LifeEditor";
import { VoiceSettings } from "./VoiceSettings";
import { RelationsEditor } from "./WorldUI";
import { lifeOf } from "./lifecore";
import { useRef, useState } from "react";
import { GenField, generateField, generateWhole, getField, setField, WHOLE } from "./autogen";
import type { GenCtl } from "./genctl";
import { Spark } from "./Spark";
import { generateSchedule } from "./life";
import { hasSchedule, REL_OPTIONS, RelType } from "./lifecore";
import { selfieSetup, withPrompt } from "./selfie";
import { generateImage } from "./imagegen";
import { open as openDialog, save as saveDialog, ask } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { cardsApi, toV2Card } from "./cards";
import { ageRuleError, isProtectedMinor, PROTECTED_NOTE } from "./protect";
import { Avatar } from "./Avatar";
import { buildSystemPrompt, Character, Frequency, Mood, MOOD_EMOJI, MOODS, Status, statusLabel } from "./types";

const EMOJIS = [
  "\u{1F642}", "\u{1F338}", "\u{1F3AE}", "\u{1F52E}", "\u{1F431}", "\u{1F98A}", "\u{1F43C}", "\u{1F984}",
  "\u{1F47B}", "\u{1F916}", "\u{1F9DA}", "\u{1F9DB}", "\u{1F9D9}", "\u{1F478}", "\u{1F934}", "\u{1F920}",
  "\u{1F60E}", "\u{1F607}", "\u{1F608}", "\u{1F31F}", "\u{1F319}", "\u{1F525}", "\u{1F33B}", "\u{1F340}",
  "\u{1F3B8}", "\u{1F3A8}", "\u{1F4DA}", "\u2615", "\u{1F370}", "\u{1F680}", "\u{1F3B5}", "\u{1F49C}",
];
const COLORS = ["#f6a5c0", "#7fb8ff", "#b9a3f0", "#9fe3b0", "#ffd27f", "#ff9f8a", "#9fd0f2", "#d0d0d0"];

interface Props {
  onTestCall?: (c: Character) => void;
  takenNames?: string[];
  initial: Character;
  models: string[];
  userName: string;
  onSaved: (c: Character) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
  onTestProactive: (c: Character, nudge: boolean) => void;
}

export function Editor({ initial, models, userName, onSaved, onDeleted, onClose, onTestProactive, onTestCall, takenNames }: Props) {
  const [c, setC] = useState<Character>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [tplName, setTplName] = useState<string | null>(null);
  const [tplNote, setTplNote] = useState<string | null>(null);
  const saveTemplate = async () => {
    if (!tplName?.trim()) return;
    try { await api.saveTemplate(tplName, { ...c, avatarPath: null, life: { ...lifeOf(c), nickname: "", petName: "", proposal: null, lastProposalAt: 0, relationshipSince: 0 } }); setTplNote(`Saved template "${tplName.trim()}".`); setTplName(null); }
    catch (e) { setErr(String(e)); }
  };
  const isNew = !initial.id;
  const set = <K extends keyof Character>(k: K, v: Character[K]) => setC((p) => ({ ...p, [k]: v }));
  // ---- AI generation ----
  const cRef = useRef(c); cRef.current = c;
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [undo, setUndo] = useState<Record<string, unknown>>({});
  const gen: GenCtl = {
    busy: (f) => !!busy[f] || !!busy.whole,
    canUndo: (f) => f in undo,
    undo: (f) => { if (!(f in undo)) return; const v = undo[f]; setC((p) => setField(p, f, v)); setUndo((u) => { const n = { ...u }; delete n[f]; return n; }); },
    run: async (f: GenField) => {
      setBusy((b) => ({ ...b, [f]: true })); setErr(null);
      try {
        const before = getField(cRef.current, f);
        const v = getField(await generateField(cRef.current, userName, f), f);
        setUndo((u) => ({ ...u, [f]: before }));
        setC((p) => setField(p, f, v));
        if (lastGen.current) lastGen.current = setField(lastGen.current, f, v); // generated, not hand-typed
        typed.current.delete(f);
      } catch (e) { setErr(`Couldn't generate ${f.replace(/^[al]\./, "")}: ${e instanceof Error ? e.message : e}`); }
      finally { setBusy((b) => ({ ...b, [f]: false })); }
    },
  };
  const [idea, setIdea] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [rel, setRel] = useState<RelType | "">("");
  const [wholeUndo, setWholeUndo] = useState<Character | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  // provenance: a field is hand-typed if it changed since the editor opened / the last generation
  const lastGen = useRef<Character | null>(null);
  const typed = useRef<Set<GenField | "name">>(new Set());
  const valueOf = (x: Character, k: GenField | "name") => JSON.stringify(k === "name" ? x.name : getField(x, k) ?? "");
  const handTyped = (cur: Character): (GenField | "name")[] => {
    const ref = lastGen.current ?? initial;
    for (const k of ["name", ...WHOLE] as (GenField | "name")[]) if (valueOf(cur, k) !== valueOf(ref, k) && valueOf(cur, k) !== JSON.stringify("")) typed.current.add(k);
    return [...typed.current].filter((k) => valueOf(cur, k) !== JSON.stringify(""));
  };
  const genWhole = async () => {
    setBusy((b) => ({ ...b, whole: true })); setErr(null);
    try {
      const prev = cRef.current;
      let next = await generateWhole(idea, prev, userName, overwrite, rel || undefined, (takenNames ?? []).filter((n) => n !== initial.name), overwrite ? handTyped(prev) : undefined);
      lastGen.current = next;
      if (overwrite || !hasSchedule(lifeOf(next))) next = { ...next, life: { ...lifeOf(next), ...(await generateSchedule(next).catch(() => ({}))) } };
      setWholeUndo(prev); setC(next);
    } catch (e) { setErr(`Couldn't generate the character: ${e instanceof Error ? e.message : e}`); }
    finally { setBusy((b) => ({ ...b, whole: false })); }
  };
  const genAvatar = async () => {
    setAvatarBusy(true); setErr(null);
    try {
      const setup = await selfieSetup(cRef.current);
      if ("reason" in setup) throw new Error(`${setup.reason}. Pick a working model in Image Studio`);
      const rows = await generateImage(withPrompt(setup.params, cRef.current, "close-up portrait, head and shoulders, smiling, plain soft background", new Date(), { source: "avatar" }), () => {});
      if (!rows[0]) throw new Error("no picture came back");
      set("avatarPath", await api.importAvatar(rows[0].path));
    } catch (e) { setErr(`Avatar failed: ${e instanceof Error ? e.message : e}`); }
    finally { setAvatarBusy(false); }
  };
  const modelOptions = models.includes(c.model) ? models : [c.model, ...models];

  const pickImage = async () => {
    try {
      const f = await openDialog({ multiple: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }] });
      if (typeof f === "string") set("avatarPath", await api.importAvatar(f));
    } catch (e) { setErr(String(e)); }
  };

  const save = async () => {
    if (!c.name.trim()) { setErr("Please give your contact a name."); return; }
    const bad = ageRuleError(c);
    if (bad) { setErr(bad); return; }
    try { onSaved(await api.saveCharacter({ ...c, name: c.name.trim() })); } catch (e) { setErr(String(e)); }
  };

  const testNow = async (nudge = false) => {
    try { const s = await api.saveCharacter({ ...c, name: c.name.trim() }); onSaved(s); onTestProactive(s, nudge); } catch (e) { setErr(String(e)); }
  };

  const remove = async () => {
    const ok = await ask(`Delete ${initial.name} and your whole chat history with them? This can't be undone.`,
      { title: "Delete contact", kind: "warning", okLabel: "Delete", cancelLabel: "Keep" });
    if (!ok) return;
    try { await api.deleteCharacter(initial.id); onDeleted(initial.id); } catch (e) { setErr(String(e)); }
  };

  const exportJson = async () => {
    try {
      const p = await saveDialog({ defaultPath: `${initial.name}.character.json`, filters: [{ name: "Character", extensions: ["json"] }] });
      if (p) await api.exportCharacter(initial.id, p);
    } catch (e) { setErr(String(e)); }
  };

  /** v1.3: share as a Tavern / SillyTavern V2 card (PNG with the card inside, or JSON). */
  const exportCard = async () => {
    try {
      const p = await saveDialog({ defaultPath: `${initial.name}.card.png`, filters: [{ name: "Card picture (PNG)", extensions: ["png"] }, { name: "Card file (JSON)", extensions: ["json"] }] });
      if (!p) return;
      const path = /\.(png|json)$/i.test(p) ? p : `${p}.png`;
      await cardsApi.write(path, toV2Card(initial), initial.avatarPath ?? null, initial.color);
      setTplNote(`Card saved: ${path}`);
    } catch (e) { setErr(String(e)); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">{isNew ? "Add a contact" : `Edit ${initial.name}`}<button className="x" onClick={onClose}>{"\u2715"}</button></div>
        <div className="modal-body">
          <div className="gen-box">
            <b>{"\u2728"} Generate whole character</b>
            <div className="mem-add">
              <input value={idea} placeholder="Short idea, e.g. a cheerful baker who loves rainy days" onChange={(e) => setIdea(e.target.value)} onKeyDown={(e) => e.key === "Enter" && genWhole()} />
              <select value={rel} onChange={(e) => setRel(e.target.value as RelType | "")} title="Relationship (optional)">
                <option value="">(keep relationship)</option>{REL_OPTIONS.filter((o) => o.id !== "custom").map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
              <button onClick={genWhole} disabled={!!busy.whole}>{busy.whole ? "Generating\u2026" : "Generate"}</button>
            </div>
            <label className="check"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Overwrite fields that are already filled</label>
            {wholeUndo && !busy.whole && <button className="link" onClick={() => { setC(wholeUndo); setWholeUndo(null); }}>{"\u21B6"} Undo whole generation</button>}
            <small> Name is used if you typed one. Sparkle buttons ({"\u2728"}) regenerate a single field.</small>
          </div>
          <div className="ed-top">
            <div className="ed-avatar">
              <Avatar big emoji={c.avatar} path={c.avatarPath} color={c.color} />
              <button className="link" onClick={pickImage}>Choose picture{"\u2026"}</button>
              {c.avatarPath && <button className="link" onClick={() => set("avatarPath", null)}>Use emoji</button>}
              {isProtectedMinor(c) ? <small className="protected-note">{PROTECTED_NOTE}</small>
                : <button className="link" disabled={avatarBusy} onClick={genAvatar} title="Uses their appearance and image model (Image Studio queue)">{avatarBusy ? "Painting\u2026" : "\u2728 Generate avatar"}</button>}
            </div>
            <div className="ed-grid">
              <label>Name<input value={c.name} autoFocus onChange={(e) => set("name", e.target.value)} /></label>
              <label>Status
                <select value={c.status} onChange={(e) => set("status", e.target.value as Status)}>
                  {(Object.keys(statusLabel) as Status[]).map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
                </select>
              </label>
              <label className="wide">Personal message<Spark f="personalMessage" gen={gen} /><input value={c.personalMessage} onChange={(e) => set("personalMessage", e.target.value)} /></label>
              <label className="wide">Usual mood<Spark f="baselineMood" gen={gen} />
                <select value={c.baselineMood} onChange={(e) => set("baselineMood", e.target.value as Mood)}>
                  {MOODS.map((m) => <option key={m} value={m}>{MOOD_EMOJI[m]} {m}</option>)}
                </select>
              </label>
              <label className="wide">Model
                <select value={c.model} onChange={(e) => set("model", e.target.value)}>
                  {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="emoji-row">
            {EMOJIS.map((em) => <button key={em} className={`emoji${!c.avatarPath && c.avatar === em ? " sel" : ""}`}
              onClick={() => { set("avatar", em); set("avatarPath", null); }}>{em}</button>)}
          </div>
          <div className="color-row">
            {COLORS.map((col) => <button key={col} className={`swatch${c.color === col ? " sel" : ""}`} style={{ background: col }} onClick={() => set("color", col)} />)}
          </div>
          <div className="proactive-box">
            <label className="switch-row">
              <span className={`switch${c.proactiveEnabled ? " on" : ""}`} role="switch" aria-checked={c.proactiveEnabled}
                tabIndex={0} onClick={() => set("proactiveEnabled", !c.proactiveEnabled)}
                onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), set("proactiveEnabled", !c.proactiveEnabled))}><i /></span>
              Can message me first
            </label>
            {c.proactiveEnabled && <>
              <label className="inline">How often
                <select value={c.proactiveFrequency} onChange={(e) => set("proactiveFrequency", e.target.value as Frequency)}>
                  <option value="rarely">Rarely (every 3-6 h)</option>
                  <option value="sometimes">Sometimes (every 1-3 h)</option>
                  <option value="often">Often (every 20-60 min)</option>
                </select>
              </label>
              {!isNew && <button className="link" onClick={() => testNow()}>Test: message me now</button>}
              {!isNew && <button className="link" onClick={() => testNow(true)}>Test: nudge me</button>}
            </>}
          </div>
          <label>Personality<Spark f="personality" gen={gen} /><textarea rows={2} value={c.personality} placeholder="e.g. warm, shy, loves books and tea" onChange={(e) => set("personality", e.target.value)} /></label>
          <label>Backstory<Spark f="backstory" gen={gen} /><textarea rows={2} value={c.backstory} onChange={(e) => set("backstory", e.target.value)} /></label>
          <label>Speaking style<Spark f="speakingStyle" gen={gen} /><textarea rows={2} value={c.speakingStyle} placeholder="e.g. short lowercase messages, uses :)" onChange={(e) => set("speakingStyle", e.target.value)} /></label>
          <label>Greeting (their first message)<Spark f="greeting" gen={gen} /><input value={c.greeting} onChange={(e) => set("greeting", e.target.value)} /></label>
          <label>Example messages (one per line)<Spark f="exampleMessages" gen={gen} /><textarea rows={3} value={c.exampleMessages} onChange={(e) => set("exampleMessages", e.target.value)} /></label>
          <AppearanceEditor c={c} gen={gen} onChange={(a) => set("appearance", a)} />
          <LifeEditor c={c} userName={userName} gen={gen} onChange={(l) => set("life", l)} />
          {!isNew && <RelationsEditor c={c} />}
          <VoiceSettings c={c} onChange={(a) => set("appearance", a)} onTestCall={isNew || !onTestCall ? undefined : async () => { try { const s = await api.saveCharacter({ ...c, name: c.name.trim() }); onSaved(s); onTestCall(s); } catch (e) { setErr(String(e)); } }} />
          <button className="link" onClick={() => setShowPrompt((s) => !s)}>{showPrompt ? "Hide" : "Preview"} system prompt</button>
          {showPrompt && <pre className="prompt-preview">{buildSystemPrompt(c, userName)}</pre>}
          {tplName !== null && <div className="mem-add"><input autoFocus value={tplName} placeholder="Template name" onChange={(e) => setTplName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveTemplate(); if (e.key === "Escape") setTplName(null); }} /><button onClick={saveTemplate}>Save template</button></div>}
          {tplNote && <small>{tplNote}</small>}
          {err && <div className="ed-error">{"\u26A0\uFE0F"} {err}</div>}
        </div>
        <div className="modal-actions">
          {!isNew && <button className="danger" onClick={remove}>Delete</button>}
          {!isNew && <button onClick={exportJson} title="Full Kindred backup of this contact (.json)">Export{"\u2026"}</button>}
          {!isNew && <button onClick={exportCard} title="Share as a Tavern / SillyTavern character card (PNG or JSON)">Export card{"\u2026"}</button>}
          <button onClick={() => { setTplName(c.name ? `${c.name} template` : ""); setTplNote(null); }} title="Reuse this personality for new contacts">Save as template</button>
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>{isNew ? "Add contact" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
