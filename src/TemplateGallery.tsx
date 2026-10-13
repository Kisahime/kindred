import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { Avatar } from "./Avatar";
import { STARTERS } from "./templates";
import { Character, Template } from "./types";

export function TemplateGallery({ onPick, onClose }: { onPick: (data: Partial<Character>) => void; onClose: () => void }) {
  const [custom, setCustom] = useState<Template[]>([]);
  const reload = () => api.listTemplates().then(setCustom).catch(() => {});
  useEffect(() => { reload(); }, []);
  const remove = async (t: Template) => {
    if (!(await ask(`Delete the template "${t.name}"? Contacts made from it are kept.`, { title: "Delete template", kind: "warning", okLabel: "Delete", cancelLabel: "Keep" }))) return;
    await api.deleteTemplate(t.id).catch(() => {}); reload();
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-title">Add a contact<button className="x" onClick={onClose}>{"\u2715"}</button></div>
        <div className="modal-body">
          <div className="tpl-grid">
            <button className="tpl-card blank" onClick={() => onPick({})}><span className="tpl-plus">{"\uFF0B"}</span><b>Blank contact</b><small>Start from scratch</small></button>
            {STARTERS.map(({ blurb, ...s }) => (
              <button key={s.name} className="tpl-card" onClick={() => onPick(s)}>
                <Avatar emoji={s.avatar} color={s.color} /><b>{s.name}</b><small>{blurb}</small>
              </button>
            ))}
          </div>
          {custom.length > 0 && <>
            <div className="opt-row">Your templates</div>
            <div className="tpl-grid">
              {custom.map((t) => (
                <div key={t.id} className="tpl-card custom" onClick={() => onPick(t.data)} role="button" tabIndex={0}>
                  <Avatar emoji={t.data.avatar || "\u{1F642}"} color={t.data.color} /><b>{t.name}</b><small>{t.data.personality?.slice(0, 50)}</small>
                  <span className="tpl-del" title="Delete template" onClick={(e) => { e.stopPropagation(); remove(t); }}>{"\u2715"}</span>
                </div>
              ))}
            </div>
          </>}
        </div>
      </div>
    </div>
  );
}