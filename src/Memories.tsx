import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { Avatar } from "./Avatar";
import { Character, closenessLabel, Memory, MOOD_EMOJI } from "./types";
import { AlbumItem, lifeApi, Milestone } from "./life";
import { anniversaryLabel, isRomantic, lifeOf, MILESTONE_ICON, relationLabel } from "./lifecore";
import { Lightbox } from "./PhotoBubble";
import { useDataUrl } from "./photo";

interface Props { c: Character; onClose: () => void; onSummarise: () => Promise<string>; onJump: (a: AlbumItem) => void; onAvatar: (path: string) => void; }
type Tab = "memories" | "timeline" | "album";

export function MemoriesDialog(props: Props) {
  const [tab, setTab] = useState<Tab>("memories");
  const { c, onClose } = props;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">{c.name}{"\u2019"}s profile<button className="x" onClick={onClose}>{"\u2715"}</button></div>
        <div className="tabs profile-tabs">
          {([["memories", "\u{1F9E0} Memories"], ["timeline", "\u{1F49E} Milestones"], ["album", "\u{1F5BC}\uFE0F Album"]] as [Tab, string][]).map(([t, label]) =>
            <button key={t} className={tab === t ? "sel" : ""} onClick={() => setTab(t)}>{label}</button>)}
        </div>
        {tab === "memories" ? <MemoriesTab {...props} /> : tab === "timeline" ? <TimelineTab c={c} onClose={onClose} /> : <AlbumTab {...props} />}
      </div>
    </div>
  );
}

function TimelineTab({ c, onClose }: { c: Character; onClose: () => void }) {
  const [ms, setMs] = useState<Milestone[]>([]);
  const reload = () => lifeApi.listMilestones(c.id).then(setMs).catch(() => {});
  useEffect(() => { reload(); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const l = lifeOf(c);
  const met = ms.find((m) => m.kind === "first_met")?.createdAt ?? c.createdAt;
  const next = (since: number) => { if (!since) return null; const s = new Date(since), n = new Date(); const d = new Date(n.getFullYear(), n.getMonth(), s.getDate()); if (d <= n) d.setMonth(d.getMonth() + 1); const months = (d.getFullYear() - s.getFullYear()) * 12 + d.getMonth() - s.getMonth(); return { d, months }; };
  const nm = next(met);
  return (
    <>
      <div className="modal-body">
        <div className="mind-stats">
          <div>Relationship: <b>{relationLabel(l)}</b>{l.relationshipSince ? <small> since {new Date(l.relationshipSince).toLocaleDateString()}</small> : null}{l.canEvolve && <small> {"\u00B7"} can evolve</small>}</div>
          {l.nickname && <div>Calls you: <b>{l.nickname}</b></div>}
          {l.petName && isRomantic(l.relationship) && <div>Pet name: <b>{l.petName}</b></div>}
          {nm && <div><small>Next anniversary: {anniversaryLabel(nm.months)} of knowing each other on {nm.d.toLocaleDateString()}</small></div>}
        </div>
        <ul className="timeline">
          {ms.length === 0 && <li className="mem-empty">No milestones yet. They appear as you get closer.</li>}
          {[...ms].reverse().map((m) => (
            <li key={m.id}><span className="tl-icon">{MILESTONE_ICON[m.kind] ?? "\u2B50"}</span>
              <span className="mem-text">{m.title}<small> {"\u00B7"} {new Date(m.createdAt).toLocaleDateString()}</small></span>
              {m.kind !== "first_met" && <button className="link" onClick={() => lifeApi.deleteMilestone(m.id).then(reload)}>Delete</button>}</li>
          ))}
        </ul>
      </div>
      <div className="modal-actions"><span className="spacer" /><button className="primary" onClick={onClose}>Done</button></div>
    </>
  );
}

function Thumb({ item, onOpen }: { item: AlbumItem; onOpen: () => void }) {
  const src = useDataUrl(item.path);
  return <button className="thumb" onClick={onOpen} title={new Date(item.createdAt).toLocaleString()}>{src ? <img src={src} alt="" /> : "\u2026"}</button>;
}
function AlbumTab({ c, onClose, onJump, onAvatar }: Props) {
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [open, setOpen] = useState<AlbumItem | null>(null);
  const reload = () => lifeApi.listAlbum(c.id).then(setItems).catch(() => {});
  useEffect(() => { reload(); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async (a: AlbumItem) => {
    if (!(await ask("Delete this photo? The message stays, the picture is removed.", { title: "Delete photo", kind: "warning" }))) return;
    await lifeApi.removeAlbumItem(a.source, a.refId).catch(() => {}); setOpen(null); reload();
  };
  const where = (a: AlbumItem) => a.source === "chat" ? "chat" : a.source === "group" ? "group chat" : "What\u2019s new";
  return (
    <>
      <div className="modal-body">
        {items.length === 0 && <div className="mem-empty">No photos yet. Selfies from chats, groups and the What{"\u2019"}s new feed collect here.</div>}
        <div className="album">
          {items.map((a) => (
            <figure key={`${a.source}${a.refId}`}>
              <Thumb item={a} onOpen={() => setOpen(a)} />
              <figcaption>{new Date(a.createdAt).toLocaleDateString()} {"\u00B7"} <button className="link" onClick={() => onJump(a)}>{where(a)}</button>
                {" "}<button className="link" onClick={() => remove(a)}>{"\u{1F5D1}"}</button></figcaption>
            </figure>
          ))}
        </div>
      </div>
      <div className="modal-actions"><span className="spacer" /><button className="primary" onClick={onClose}>Done</button></div>
      {open && <Lightbox path={open.path} title={`${c.name}_photo`} onClose={() => setOpen(null)} onAvatar={() => { onAvatar(open.path); setOpen(null); }} />}
    </>
  );
}

function MemoriesTab({ c, onClose, onSummarise }: Props) {
  const [mems, setMems] = useState<Memory[]>([]);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = () => api.listMemories(c.id).then(setMems).catch((e) => setNote(String(e)));
  useEffect(() => { reload(); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!draft.trim()) return;
    const m = await api.addMemory(c.id, draft, true).catch((e) => { setNote(String(e)); return null; });
    if (!m) setNote("That memory already exists.");
    setDraft(""); reload();
  };
  const togglePin = async (m: Memory) => { await api.updateMemory(m.id, m.content, !m.pinned).catch((e) => setNote(String(e))); reload(); };
  const saveEdit = async (m: Memory) => {
    try { await api.updateMemory(m.id, editText, m.pinned); setEditing(null); reload(); } catch (e) { setNote(String(e)); }
  };
  const remove = async (m: Memory) => { await api.deleteMemory(m.id).catch((e) => setNote(String(e))); reload(); };
  const summariseNow = async () => {
    setBusy(true); setNote(null);
    try { setNote(await onSummarise()); reload(); } catch (e) { setNote(`Summary failed: ${e}`); } finally { setBusy(false); }
  };

  return (
    <>
        <div className="modal-body">
          <div className="mind-head">
            <Avatar big emoji={c.avatar} path={c.avatarPath} color={c.color} />
            <div className="mind-stats">
              <div>Mood: <b>{MOOD_EMOJI[c.mood] ?? ""} {c.mood}</b> <small>(usually {c.baselineMood})</small></div>
              <div className="closeness">Closeness: <b>{c.closeness}/100</b> <small>{closenessLabel(c.closeness)}</small>
                <div className="bar"><i style={{ width: `${c.closeness}%` }} /></div>
              </div>
            </div>
          </div>
          <div className="mem-add">
            <input value={draft} placeholder={`Add something ${c.name} should always remember\u2026`} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()} />
            <button onClick={add}>Add</button>
          </div>
          <ul className="mem-list">
            {mems.length === 0 && <li className="mem-empty">No memories yet. They are created automatically as you chat, or add one above.</li>}
            {mems.map((m) => (
              <li key={m.id} className={m.pinned ? "pinned" : ""}>
                <button className={`pin${m.pinned ? " on" : ""}`} title={m.pinned ? "Pinned: always remembered" : "Pin"} onClick={() => togglePin(m)}>{"\u{1F4CC}"}</button>
                {editing === m.id
                  ? <textarea rows={2} value={editText} autoFocus onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(m); } if (e.key === "Escape") setEditing(null); }} />
                  : <span className="mem-text" onDoubleClick={() => { setEditing(m.id); setEditText(m.content); }}>{m.content}
                      <small> {"\u00B7"} {new Date(m.createdAt).toLocaleDateString()} {"\u00B7"} </small>
                      <span className={`mem-source${m.source ? " group" : ""}`}>{m.source ? `\u{1F465} ${m.source}` : "1:1 chat"}</span></span>}
                <span className="mem-actions">
                  {editing === m.id
                    ? <><button className="link" onClick={() => saveEdit(m)}>Save</button><button className="link" onClick={() => setEditing(null)}>Cancel</button></>
                    : <><button className="link" onClick={() => { setEditing(m.id); setEditText(m.content); }}>Edit</button><button className="link" onClick={() => remove(m)}>Delete</button></>}
                </span>
              </li>
            ))}
          </ul>
          {note && <div className="ed-error">{note}</div>}
        </div>
        <div className="modal-actions">
          <button onClick={summariseNow} disabled={busy}>{busy ? "Remembering\u2026" : "Summarise recent chat now"}</button>
          <span className="spacer" /><button className="primary" onClick={onClose}>Done</button>
        </div>
    </>
  );
}