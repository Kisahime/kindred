import { RefObject, useEffect, useRef, useState } from "react";
import { EMOJI_CATEGORIES, shortcutFor } from "./emoticons";

/** Smiley button + Messenger-style popover; inserts at the textarea cursor. */
export function EmojiPicker({ target, value, onChange }: { target: RefObject<HTMLTextAreaElement>; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const insert = (em: string) => {
    const ta = target.current;
    const s = ta?.selectionStart ?? value.length, e = ta?.selectionEnd ?? value.length;
    onChange(value.slice(0, s) + em + value.slice(e));
    requestAnimationFrame(() => { if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = s + em.length; } });
  };

  return (
    <div className="emoji-picker" ref={box}>
      <button type="button" className="emoji-toggle" title="Emoticons" onClick={() => setOpen((o) => !o)}>{"\u{1F642}"}</button>
      {open && (
        <div className="emoji-pop">
          <div className="emoji-tabs">
            {EMOJI_CATEGORIES.map((c, i) => <button key={c.name} type="button" className={i === cat ? "sel" : ""} title={c.name} onClick={() => setCat(i)}>{c.icon}</button>)}
          </div>
          <div className="emoji-grid">
            {EMOJI_CATEGORIES[cat].emoji.map((em, i) => {
              const sc = shortcutFor(em);
              return <button key={`${em}${i}`} type="button" title={sc ? `${em}  ${sc}` : em} onClick={() => insert(em)}>{em}</button>;
            })}
          </div>
          <div className="emoji-foot">{EMOJI_CATEGORIES[cat].name} {"\u00B7"} tip: type :) (L) (Y) and more</div>
        </div>
      )}
    </div>
  );
}