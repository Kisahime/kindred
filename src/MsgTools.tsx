import { useState } from "react";

const QUICK_REACTIONS = ["\u2764\uFE0F", "\u{1F602}", "\u{1F44D}", "\u{1F62E}", "\u{1F622}", "\u{1F525}"];

/** Hover toolbar on a message: react / regenerate / edit / delete. */
export function MsgTools(p: { mine: boolean; reaction?: string; canRegen?: boolean; canEdit?: boolean; busy?: boolean;
  onReact?: (emoji: string) => void; onRegen?: () => void; onEdit?: () => void; onDelete?: () => void; }) {
  return (
    <div className="msg-tools" onMouseDown={(e) => e.stopPropagation()}>
      {!p.mine && p.onReact && QUICK_REACTIONS.map((e) => (
        <button key={e} className={p.reaction === e ? "sel" : ""} title={p.reaction === e ? "Remove reaction" : "React"} onClick={() => p.onReact!(e)}>{e}</button>
      ))}
      {p.canRegen && <button title="Regenerate reply" disabled={p.busy} onClick={p.onRegen}>{"\u21BB"}</button>}
      {p.canEdit && <button title="Edit" disabled={p.busy} onClick={p.onEdit}>{"\u270E"}</button>}
      {p.onDelete && <button title="Delete message" disabled={p.busy} onClick={p.onDelete}>{"\u{1F5D1}"}</button>}
    </div>
  );
}

export function ReactionChip({ emoji, by }: { emoji?: string; by?: string }) {
  if (!emoji) return null;
  return <span className="reaction-chip" title={by ? `${by} reacted` : "Reaction"}>{emoji}</span>;
}

/** "‹ 2/3 ›" switch between regenerated versions. */
export function AltSwitch({ index, count, disabled, onSwipe }: { index: number; count: number; disabled?: boolean; onSwipe: (dir: number) => void }) {
  if (count < 2) return null;
  return (
    <span className="alt-switch">
      <button disabled={disabled || index <= 0} onClick={() => onSwipe(-1)}>{"\u2039"}</button>{index + 1}/{count}
      <button disabled={disabled || index >= count - 1} onClick={() => onSwipe(1)}>{"\u203A"}</button>
    </span>
  );
}

export function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [t, setT] = useState(initial);
  return (
    <div className="edit-box">
      <textarea autoFocus rows={2} value={t} onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (t.trim()) onSave(t.trim()); } if (e.key === "Escape") onCancel(); }} />
      <div><button className="link" onClick={() => t.trim() && onSave(t.trim())}>Save</button> <button className="link" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}