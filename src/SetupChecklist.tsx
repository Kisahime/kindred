import { useEffect, useState } from "react";
import { listModels } from "./ollama";
import { imageApi } from "./imagegen";
import { voiceApi } from "./voice";
import { DEFAULT_MODEL } from "./types";
import { setupReady, setupStatus, SetupItem } from "./setup";

export async function probeSetup() {
  const models = await listModels().then((m) => ({ ok: true, m })).catch(() => ({ ok: false, m: [] as string[] }));
  const image = await imageApi.engineInfo().then((i) => i.ok).catch(() => false);
  const voice = await voiceApi.info().then((v) => v.installed).catch(() => false);
  return setupStatus({ ollama: models.ok, models: models.m, defaultModel: DEFAULT_MODEL, image, voice });
}

export function SetupChecklist({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<SetupItem[] | null>(null);
  const [copied, setCopied] = useState("");
  const check = () => { setItems(null); probeSetup().then(setItems); };
  useEffect(check, []);
  const copy = (url: string) => { navigator.clipboard?.writeText(url).then(() => setCopied(url)).catch(() => {}); };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <div className="modal-title">Setup checklist<button className="x" onClick={onClose}>{"\u2715"}</button></div>
        <div className="modal-body">
        {!items ? <p>Checking…</p> : <>
          <p>{setupReady(items) ? "You're ready to chat. Optional extras are below." : "Chat needs Ollama and a model. Everything else is optional."}</p>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {items.map((i) => (
              <li key={i.key} style={{ marginBottom: 10 }}>
                <b>{i.ok ? "\u2705" : i.required ? "\u274C" : "\u2796"} {i.label}</b>
                <div style={{ fontSize: "0.9em", userSelect: "text" }}>{i.hint}</div>
                {i.links.map((l) => (
                  <div key={l.url} style={{ fontSize: "0.85em" }}>
                    {l.label}: <code style={{ userSelect: "all" }}>{l.url}</code>{" "}
                    <button onClick={() => copy(l.url)}>{copied === l.url ? "Copied" : "Copy link"}</button>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>}
        </div>
        <div className="modal-actions"><button onClick={check}>Check again</button><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
