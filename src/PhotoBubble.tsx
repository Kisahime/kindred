import { useEffect } from "react";
import { savePhotoAs, useDataUrl } from "./photo";

/** Picture inside a chat bubble; click to enlarge. */
export function PhotoBubble({ path, caption, onOpen, onInfo }: { path: string; caption: string; onOpen: () => void; onInfo?: () => void }) {
  const src = useDataUrl(path);
  return (
    <div className="photo-bubble" onClick={onOpen} title="Click to enlarge">
      {src ? <img src={src} alt={caption} /> : <div className="photo-missing">{"\u{1F4F7}"} picture</div>}
      {caption && <div className="photo-cap">{caption}</div>}
      {onInfo && <button className="photo-info" title="Show the prompt used for this picture" onClick={(e) => { e.stopPropagation(); onInfo(); }}>{"\u2139\uFE0F"} Prompt</button>}
    </div>
  );
}

/** Full-size view with actions. */
export function Lightbox({ path, title, onClose, onAvatar, onRegen, busy }: { path: string; title: string; onClose: () => void; onAvatar?: () => void; onRegen?: () => void; busy?: boolean }) {
  const src = useDataUrl(path);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="modal-backdrop lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lightbox-inner">
        {src && <img src={src} alt="" />}
        <div className="row-btns">
          <button onClick={() => savePhotoAs(path, title.replace(/[^\w-]+/g, "_"))}>Save as{"\u2026"}</button>
          {onAvatar && <button onClick={onAvatar}>Set as their avatar</button>}
          {onRegen && <button disabled={busy} onClick={onRegen}>{"\u21BB"} Take another</button>}
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}