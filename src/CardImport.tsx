// v1.3: preview of a Tavern / SillyTavern character card before it becomes a contact.
import { useMemo, useState } from "react";
import { api } from "./api";
import { ageOk, CardData, CardFile, CardSpec, planImport } from "./cards";
import { Character, DEFAULT_MODEL, MIN_AGE } from "./types";
import { lifeOf, REL_OPTIONS, RelType } from "./lifecore";
import { MINOR_ROLE_LABELS, MINOR_ROLES, PROTECTED_NOTE } from "./protect";

const SPEC_LABEL: Record<CardSpec, string> = { v1: "Tavern card (V1)", v2: "Character card V2", v3: "Character card V3", kindred: "Kindred" };
export function uniqueName(name: string, taken: string[]): string {
  const low = new Set(taken.map((t) => t.toLowerCase()));
  if (!low.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i++) if (!low.has(`${name} (${i})`.toLowerCase())) return `${name} (${i})`;
  return `${name} ${Date.now() % 1000}`;
}

export function CardImport(props: { path: string; file: CardFile; spec: CardSpec; data: CardData; userName: string; adult: boolean; models: string[]; taken: string[];
  onSaved: (c: Character) => void; onClose: () => void }) {
  const { file, data } = props;
  const plan = useMemo(() => planImport(data, props.userName, props.adult), [data, props.userName, props.adult]);
  const [age, setAge] = useState<string>(plan.age.age && (plan.minor ? plan.age.age < MIN_AGE : plan.age.age >= MIN_AGE) ? String(plan.age.age) : "");
  const [role, setRole] = useState<string>("");
  const [name, setName] = useState(uniqueName(plan.char.name, props.taken));
  const defModel = props.models.includes(DEFAULT_MODEL) || !props.models.length ? DEFAULT_MODEL : props.models[0];
  const [model, setModel] = useState(defModel);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const n = parseInt(age, 10);
  const can = ageOk(plan, n, role) && !!name.trim() && !busy;
  const save = async () => {
    if (!can) return;
    setBusy(true); setErr("");
    try {
      const c: Character = { ...plan.char, name: name.trim(), model, appearance: { ...plan.char.appearance, age: n } };
      if (plan.minor) { const o = REL_OPTIONS.find((x) => x.id === role); c.life = { ...lifeOf(c), relationship: role as RelType, relationshipDetail: o?.details?.[0] ?? "", canEvolve: false }; }
      else if (file.kind === "png") c.avatarPath = await api.importAvatar(props.path).catch(() => null); // never the card picture for a protected character
      props.onSaved(await api.saveCharacter(c));
    } catch (e) { setErr(String(e)); setBusy(false); }
  };
  const peek = (label: string, s: string) => s ? <details className="card-peek"><summary>{label} <small>({s.length} characters)</small></summary><pre>{s}</pre></details> : null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal card-import">
        <div className="modal-title">Import a character card<button className="x" onClick={props.onClose}>{"\u2715"}</button></div>
        <div className="modal-body">
          <div className="card-head">
            {plan.minor ? <div className="card-thumb none">{"\u{1F6E1}\uFE0F"}</div> : file.thumb ? <img className="card-thumb" src={file.thumb} alt="" /> : <div className="card-thumb none">{"\u{1F4C4}"}</div>}
            <div>
              <b>{data.name}</b> <small>{SPEC_LABEL[props.spec]}{data.creator ? ` \u00B7 by ${data.creator}` : ""}</small>
              {data.tags.length > 0 && <div className="card-tags">{data.tags.slice(0, 10).map((t) => <span key={t}>{t}</span>)}</div>}
            </div>
          </div>
          {plan.refused ? <div className="ed-error">{"\u26D4"} Can't import this card. {plan.refused}{plan.minor ? " Characters under 18 are only ever protected family, never romantic or sexual." : " Family is never romantic."}</div> : plan.minor ? <>
            <div className="card-minor">{"\u{1F6E1}\uFE0F"} {plan.age.reason} {PROTECTED_NOTE}</div>
            <label>Name<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
            <label>Family role <small>(required)</small>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">Choose{"\u2026"}</option>
                {MINOR_ROLES.map((r) => <option key={r} value={r}>{MINOR_ROLE_LABELS[r]}</option>)}
              </select></label>
            <label>Age <small>(under 18{plan.age.age ? ", found in the card" : ""})</small>
              <input type="number" min={1} max={MIN_AGE - 1} value={age} placeholder="How old are they?" onChange={(e) => setAge(e.target.value)} /></label>
            {age !== "" && !(n >= 1 && n < MIN_AGE) && <div className="ed-error">{"\u26D4"} This card can only be imported as a protected character under 18.</div>}
          </> : <>
            <label>Name<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
            <label>Age <small>(18 or older{plan.age.age ? ", found in the card" : ""})</small>
              <input type="number" min={MIN_AGE} max={120} value={age} placeholder="How old are they?" onChange={(e) => setAge(e.target.value)} /></label>
            {!plan.age.age && <small className="card-ask">{"\u2753"} {plan.age.reason} Please enter their age.</small>}
            {age !== "" && n < MIN_AGE && <div className="ed-error">{"\u26D4"} Imported adults must be 18 or older. (Under-18 characters are only possible as protected family; this card describes an adult.)</div>}
          </>}
          {!plan.refused && <>
            <label>Chat model<select value={model} onChange={(e) => setModel(e.target.value)}>
              {[...new Set([defModel, ...props.models])].map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
            {peek("Personality", plan.char.personality)}
            {peek("Background", plan.char.backstory)}
            {peek("Greeting", plan.char.greeting)}
            {peek("Example messages", plan.char.exampleMessages)}
            <ul className="card-notes">{plan.notes.map((x) => <li key={x}>{x}</li>)}<li>They arrive with {"\u201C"}can message me first{"\u201D"} off; you can change everything in the editor afterwards.</li></ul>
          </>}
          {err && <div className="ed-error">{"\u26A0\uFE0F"} {err}</div>}
        </div>
        <div className="modal-actions">
          <span className="spacer" />
          <button onClick={props.onClose}>Cancel</button>
          {!plan.refused && <button className="primary" disabled={!can} onClick={save}>{busy ? "Adding\u2026" : "Add contact"}</button>}
        </div>
      </div>
    </div>
  );
}
