// Options sections: connected economy toggles and data backups.
import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { ConnectedCfg, connectedCfg, Freq, loadConnected, saveConnected } from "./connected";
import { BackupInfo, backupApi, backupLabel, fmtSize } from "./databackup";

export function ConnectedOptions() {
  const [cfg, setCfg] = useState<ConnectedCfg>(connectedCfg());
  useEffect(() => { loadConnected().then(setCfg).catch(() => {}); }, []);
  const set = (x: Partial<ConnectedCfg>) => { const n = { ...cfg, ...x }; setCfg(n); saveConnected(n).catch(() => {}); };
  const sw = (on: boolean, flip: () => void, label: string, hint: string) => (
    <label className="switch-row"><span className={`switch${on ? " on" : ""}`} role="switch" aria-checked={on} tabIndex={0} onClick={flip}><i /></span>{label} <small>{hint}</small></label>);
  return <>
    <div className="opt-row">{"\u2728"} Connected economy <small>(applies immediately)</small></div>
    {sw(cfg.context, () => set({ context: !cfg.context }), "Gifts & café in first messages, group chats and calls", "(chat always knows)")}
    {sw(cfg.giftsBack, () => set({ giftsBack: !cfg.giftsBack }), "Characters send you gifts", "(more from close, generous characters; on anniversaries too)")}
    {sw(cfg.offers, () => set({ offers: !cfg.offers }), "Characters make offers on your items", "(buy or swap; you choose)")}
    <label className="inline">How often <select value={cfg.frequency} onChange={(e) => set({ frequency: e.target.value as Freq })}>
      <option value="rarely">Rarely (max 1 gift + 1 offer a day, long gaps)</option>
      <option value="sometimes">Sometimes (max 1 + 1 a day)</option>
      <option value="often">Often (max 2 + 2 a day)</option></select></label>
  </>;
}

export function DataBackups() {
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [folder, setFolder] = useState("");
  const refresh = () => backupApi.list().then(setList).catch((e) => setMsg(String(e)));
  useEffect(() => { refresh(); backupApi.folder().then(setFolder).catch(() => {}); }, []);
  const now = async () => {
    setBusy("now"); setMsg("");
    try { const b = await backupApi.now(); setMsg(`Backed up ${b.files} files (${fmtSize(b.sizeBytes)}).`); await refresh(); }
    catch (e) { setMsg(`Backup failed: ${e}`); } finally { setBusy(""); }
  };
  const restore = async (b: BackupInfo) => {
    setBusy(b.name); setMsg("Making a safety backup of your current data first\u2026");
    try {
      const safety = await backupApi.now("before-restore");
      await refresh();
      const ok = await ask(`Restore your data from ${backupLabel(b.name)}?\n\nChats, characters, Sparkles, items and settings go back to that point. Pictures from that backup are copied back; newer pictures are kept.\n\nA safety copy of your data right now was saved first (${backupLabel(safety.name)}), so you can undo this.`,
        { title: "Restore backup", kind: "warning", okLabel: "Restore", cancelLabel: "Cancel" });
      if (!ok) { setMsg("Restore cancelled. (The safety backup was kept.)"); return; }
      await backupApi.restore(b.name);
      setMsg("Restored. Reloading\u2026");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) { setMsg(`Restore failed: ${e}`); } finally { setBusy(""); }
  };
  return <>
    <div className="opt-row">{"\u{1F4BE}"} Data backups</div>
    <small>Your chats, characters, pictures and logs (not models). One is made automatically each day when the app starts; the newest 14 are kept.{folder ? ` Folder: ${folder}` : ""}</small>
    <div className="row-btns"><button disabled={!!busy} onClick={now}>{busy === "now" ? "Backing up\u2026" : "Back up now"}</button></div>
    {msg && <small className="backup-msg">{msg}</small>}
    <ul className="backup-list">
      {list === null ? <li>Loading{"\u2026"}</li> : !list.length ? <li><small>No backups yet.</small></li>
        : list.map((b) => <li key={b.name}><span>{backupLabel(b.name)} <small>{fmtSize(b.sizeBytes)}</small></span>
          <button className="link" disabled={!!busy} onClick={() => restore(b)}>{busy === b.name ? "Working\u2026" : "Restore\u2026"}</button></li>)}
    </ul>
  </>;
}
