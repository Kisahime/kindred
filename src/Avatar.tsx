import { ReactNode, useEffect, useState } from "react";
import { api } from "./api";

const cache = new Map<string, string>();

export function Avatar(props: { emoji: string; path?: string | null; color?: string; big?: boolean; className?: string; children?: ReactNode }) {
  const { emoji, path, color, big, className, children } = props;
  const [src, setSrc] = useState<string | null>(path ? cache.get(path) ?? null : null);
  useEffect(() => {
    if (!path) { setSrc(null); return; }
    const hit = cache.get(path);
    if (hit) { setSrc(hit); return; }
    let live = true;
    api.avatarDataUrl(path).then((u) => { cache.set(path, u); if (live) setSrc(u); }).catch(() => live && setSrc(null));
    return () => { live = false; };
  }, [path]);
  return (
    <div className={`avatar${big ? " big" : ""} ${className ?? ""}`} style={{ background: color }}>
      {src ? <img src={src} alt="" /> : emoji}
      {children}
    </div>
  );
}