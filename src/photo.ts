import { useEffect, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api";

/** Loads a local image as a data URL. */
export function useDataUrl(path?: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { if (!path) { setSrc(null); return; } let live = true; api.avatarDataUrl(path).then((u) => live && setSrc(u)).catch(() => live && setSrc(null)); return () => { live = false; }; }, [path]);
  return src;
}

export async function savePhotoAs(path: string, name: string) {
  const dest = await saveDialog({ defaultPath: `${name}.png`, filters: [{ name: "PNG image", extensions: ["png"] }] });
  if (dest) await api.exportImage(path, dest);
}