import { useState } from "react";
import { Character } from "./types";
import { Block, BlockStatus, currentBlock, defaultSchedule, EVOLVE, isFamily, isRomantic, Life, lifeOf, REL_OPTIONS, RelType, starterLife } from "./lifecore";
import { generateSchedule } from "./life";
import { Spark } from "./Spark";
import type { GenCtl } from "./genctl";

const STATUS_OPTS: BlockStatus[] = ["online", "away", "busy", "sleeping"];

/** "Relationship & daily life" section of the contact editor. */
export function LifeEditor({ c, userName, onChange, gen }: { c: Character; userName: string; onChange: (l: Life) => void; gen?: GenCtl }) {
  const l = lifeOf(c);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<"weekday" | "weekend">("weekday");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const set = (patch: Partial<Life>) => onChange({ ...l, ...patch });
  const opt = REL_OPTIONS.find((o) => o.id === l.relationship)!;
  const blocks = l[day];
  const setBlocks = (b: Block[]) => set({ [day]: b } as Partial<Life>);
  const setBlock = (i: number, patch: Partial<Block>) => setBlocks(blocks.map((b, j) => j === i ? { ...b, ...patch } : b));
  const cur = currentBlock(l);
  const evolve = EVOLVE[l.relationship];
  const auto = async () => {
    setBusy(true); setNote(null);
    try { set(await generateSchedule(c)); setNote("New routine generated. Tweak anything you like."); }
    catch (e) { setNote(`Couldn't generate: ${e instanceof Error ? e.message : e}`); } finally { setBusy(false); }
  };
  return (
    <div className="appearance-box">
      <button className="link" onClick={() => setOpen((o) => !o)}>{open ? "\u25BE" : "\u25B8"} Relationship &amp; daily life</button>
      {open && <>
        <div className="row2">
          <label>Relationship to {userName || "you"}
            <select value={l.relationship} onChange={(e) => { const r = e.target.value as RelType; const o = REL_OPTIONS.find((x) => x.id === r)!; set({ relationship: r, relationshipDetail: o.details?.[0] ?? "", proposal: null, relationshipSince: Date.now() }); }}>
              {REL_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select></label>
          {opt.details && <label>Called<select value={l.relationshipDetail} onChange={(e) => set({ relationshipDetail: e.target.value })}>
            {opt.details.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>}
          {l.relationship === "custom" && <label>Describe it<Spark f="l.relationshipDetail" gen={gen} /><input value={l.relationshipDetail} placeholder="e.g. old flatmate from uni" onChange={(e) => set({ relationshipDetail: e.target.value })} /></label>}
        </div>
        <small>{isFamily(l.relationship) ? "Family: warm and caring, never romantic." : isRomantic(l.relationship) ? "Romantic: affectionate and a bit flirty." : "Platonic."}
          {l.relationship === "child" && " Adult child only: pictures are always of adults (18+)."}</small>
        <label className="check"><input type="checkbox" checked={l.canEvolve} disabled={!evolve} onChange={(e) => set({ canEvolve: e.target.checked })} />
          Relationship can evolve {evolve ? <small>(at closeness {evolve.at}+ they may ask to become your {evolve.to})</small> : <small>(not for this type)</small>}</label>
        <div className="row2">
          <label>Their nickname for you<Spark f="l.nickname" gen={gen} /><input value={l.nickname} placeholder="unlocks at closeness 45" onChange={(e) => set({ nickname: e.target.value })} /></label>
          {isRomantic(l.relationship) && <label>Pet name<Spark f="l.petName" gen={gen} /><input value={l.petName} placeholder="unlocks at closeness 55" onChange={(e) => set({ petName: e.target.value })} /></label>}
        </div>
        <div className="sched-head">
          <b>Daily schedule</b>
          <span className="tabs">{(["weekday", "weekend"] as const).map((d) => <button key={d} className={day === d ? "sel" : ""} onClick={() => setDay(d)}>{d === "weekday" ? "Weekdays" : "Weekends"}</button>)}</span>
          <span className="spacer" />
          <button className="link" onClick={() => set({ ...defaultSchedule(), ...pickSched(starterLife(c.name)) })}>Use default</button>
          <button className="link" disabled={busy} onClick={auto}>{busy ? "Generating\u2026" : "\u2728 Generate from personality"}</button>
        </div>
        <table className="sched">
          <thead><tr><th>From</th><th>Doing</th><th>Where (for selfies)</th><th>Status</th><th /></tr></thead>
          <tbody>
            {blocks.map((b, i) => (
              <tr key={i} className={cur && cur.block === b ? "now" : ""}>
                <td><input type="time" value={b.start} onChange={(e) => setBlock(i, { start: e.target.value })} onBlur={() => setBlocks([...blocks].sort((x, y) => x.start.localeCompare(y.start)))} /></td>
                <td><input value={b.activity} onChange={(e) => setBlock(i, { activity: e.target.value })} /></td>
                <td><input value={b.place} onChange={(e) => setBlock(i, { place: e.target.value })} /></td>
                <td><select value={b.status} onChange={(e) => setBlock(i, { status: e.target.value as BlockStatus })}>{STATUS_OPTS.map((s) => <option key={s}>{s}</option>)}</select></td>
                <td><button className="link" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>{"\u2715"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="link" onClick={() => setBlocks([...blocks, { start: "12:00", activity: "", place: "", status: "online" }])}>+ Add time block</button>
        <label className="check"><input type="checkbox" checked={l.autoStatus} onChange={(e) => set({ autoStatus: e.target.checked })} />
          Auto status from schedule <small>(Online/Away/Busy and personal message follow what they're doing)</small></label>
        {cur && <small>Right now: <b>{cur.block.activity}</b>{cur.block.place && ` \u00B7 ${cur.block.place}`} ({cur.block.status})</small>}
        {note && <small className="ed-note">{note}</small>}
      </>}
    </div>
  );
}
const pickSched = (l: Partial<Life>) => ({ ...(l.weekday ? { weekday: l.weekday } : {}), ...(l.weekend ? { weekend: l.weekend } : {}) });