import { useEffect, useState } from "react";
import { imageApi, ImageRow, settingsList, SOURCE_LABEL } from "./imagegen";
import { useDataUrl } from "./photo";

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button className="link" disabled={!text} onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); })}>{done ? "Copied \u2713" : "Copy"}</button>;
}

/** Prompts + settings of one saved picture. Used by Image Studio and the chat ℹ️ button. */
export function ImageDetails({ row, charName, onReuse, onReuseNewSeed }: { row: ImageRow; charName?: string; onReuse?: () => void; onReuseNewSeed?: () => void }) {
  const p = row.params ?? ({} as ImageRow["params"]);
  return (
    <div className="img-details">
      <div className="img-details-head">
        <b>{SOURCE_LABEL[row.source] ?? row.source}</b>{charName ? ` \u00B7 ${charName}` : ""}{row.adult ? " \u00B7 18+" : ""}
        <small> {"\u00B7"} {new Date(row.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small>
      </div>
      {row.gift && <div><small>Wearing gift: <b>{row.gift}</b></small></div>}
      {!row.recorded ? <div className="img-norecord">Prompt not recorded (this picture was made before prompts were saved).</div> : <>
        <div className="img-prompt"><div className="opt-row">Prompt <Copy text={p.prompt ?? ""} /></div><pre>{p.prompt}</pre></div>
        <div className="img-prompt"><div className="opt-row">Negative prompt <Copy text={p.negative ?? ""} /></div><pre>{p.negative || "(none)"}</pre></div>
      </>}
      <table className="img-settings"><tbody>{settingsList(row).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
      {row.recorded && (onReuse || onReuseNewSeed) && <div className="row-btns">
        {onReuse && <button onClick={onReuse}>Reuse settings</button>}
        {onReuseNewSeed && <button onClick={onReuseNewSeed}>Reuse with new seed</button>}
      </div>}
    </div>
  );
}

/** Pop-up details for a chat/album picture, looked up by its file path. */
export function PromptDialog({ path, adult, charName, onClose, onReuse }: { path: string; adult: boolean; charName?: string; onClose: () => void; onReuse?: (r: ImageRow, newSeed: boolean) => void }) {
  const [row, setRow] = useState<ImageRow | null | "hidden" | "none">(null);
  const src = useDataUrl(path);
  useEffect(() => {
    imageApi.forPath(path, adult).then((r) => setRow("id" in r ? r : r.hidden ? "hidden" : "none")).catch(() => setRow("none"));
  }, [path, adult]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal img-details-modal">
        <h3>{"\u2139\uFE0F"} Picture prompt</h3>
        {src && <img className="img-details-thumb" src={src} alt="" />}
        {row === null ? <p>Loading{"\u2026"}</p>
          : row === "hidden" ? <p>This is an 18+ picture. Turn on the adult content switch in Options to see its prompt.</p>
          : row === "none" ? <p className="img-norecord">Prompt not recorded for this picture.</p>
          : <ImageDetails row={row} charName={charName} onReuse={onReuse && (() => onReuse(row, false))} onReuseNewSeed={onReuse && (() => onReuse(row, true))} />}
        <div className="row-btns"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
