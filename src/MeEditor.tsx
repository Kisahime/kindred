// "Me" profile editor: opened from Alex's own name/avatar in the header.
import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { Avatar } from "./Avatar";
import { Character } from "./types";
import { aboutUserBlock, FIELDS, FieldId, parseBirthday, UserProfile } from "./profile";

const LONG: FieldId[] = ["about", "boundaries", "traits", "likes", "dislikes", "hobbies"];

export function MeEditor({ initial, chars, onSave, onClose }: { initial: UserProfile; chars: Character[]; onSave: (p: UserProfile) => Promise<void>; onClose: () => void }) {
  const [p, setP] = useState<UserProfile>(structuredClone(initial));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const bd = p.fields.birthday.value;
  const [bdDate, bdYear] = [bd ? bd.slice(-5) : "", bd && !bd.startsWith("--") ? bd.slice(0, 4) : ""];
  const setF = (id: FieldId, x: Partial<{ value: string; share: boolean }>) => setP((o) => ({ ...o, fields: { ...o.fields, [id]: { ...o.fields[id], ...x } } }));
  const setBirthday = (mmdd: string, year: string) => setF("birthday", { value: !mmdd ? "" : `${/^\d{4}$/.test(year) ? `${year}-` : "--"}${mmdd}` });
  const pickPicture = async () => {
    const f = await openDialog({ multiple: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }] });
    if (typeof f !== "string") return;
    try { setF("picture", { value: await api.importAvatar(f) }); } catch (e) { setErr(String(e)); }
  };
  const save = async () => {
    if (bd && !parseBirthday(bd)) { setErr("That birthday doesn't look right."); return; }
    setBusy(true); setErr("");
    try { await onSave(p); } catch (e) { setErr(String(e)); setBusy(false); }
  };
  const share = (id: FieldId) => (
    <label className="share-toggle" title="Characters can know this"><input type="checkbox" checked={p.fields[id].share} onChange={(e) => setF(id, { share: e.target.checked })} /> characters can know this</label>);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal me-editor">
        <div className="modal-title">{"\u{1F64B}"} My profile<button className="x" onClick={onClose}>{"\u2715"}</button></div>
        <div className="modal-body">
          <small>Everything is optional. Only fields marked "characters can know this" go into their prompts.</small>
          <div className="me-pic">
            <Avatar big emoji={"\u{1F98B}"} path={p.fields.picture.value || null} />
            <div className="row-btns"><button onClick={pickPicture}>Choose picture{"\u2026"}</button>{p.fields.picture.value && <button onClick={() => setF("picture", { value: "" })}>Use the butterfly</button>}</div>
          </div>
          {FIELDS.filter(([id]) => id !== "picture").map(([id, label, ph]) => (
            <div key={id} className="me-field">
              <div className="opt-row">{label}{share(id)}</div>
              {id === "birthday" ? <span className="me-bday">
                  <input type="date" value={bd ? `${bdYear || "2000"}-${bdDate}` : ""} onChange={(e) => setBirthday(e.target.value.slice(5), bdYear)} />
                  <input type="number" placeholder="year (optional)" min={1900} max={2100} value={bdYear} onChange={(e) => setBirthday(bdDate, e.target.value)} />
                  {bd && <button className="link" onClick={() => setF("birthday", { value: "" })}>clear</button>}
                </span>
                : LONG.includes(id) ? <textarea rows={2} value={p.fields[id].value} placeholder={ph} onChange={(e) => setF(id, { value: e.target.value })} />
                : <input value={p.fields[id].value} placeholder={ph} onChange={(e) => setF(id, { value: e.target.value })} />}
            </div>))}
          {chars.length > 0 && <>
            <div className="opt-row">What each character calls you <small>(optional; overrides your nicknames for them)</small></div>
            {chars.map((c) => <label key={c.id} className="inline me-callme">{c.name}
              <input value={p.perChar[c.id] ?? ""} placeholder={`what ${c.name} calls you`} onChange={(e) => setP((o) => ({ ...o, perChar: { ...o.perChar, [c.id]: e.target.value } }))} /></label>)}
          </>}
          <button className="link" onClick={() => setPreview((x) => !x)}>{preview ? "Hide" : "Preview what characters see"}</button>
          {preview && <pre className="prompt-preview">{aboutUserBlock(p, chars[0]) || "(nothing shared)"}</pre>}
          {err && <div className="ed-error">{err}</div>}
        </div>
        <div className="modal-actions"><span className="spacer" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={save}>Save</button></div>
      </div>
    </div>
  );
}
