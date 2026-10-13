// Data backups (Options): backups-data\<timestamp> folders made by the app (consistent SQLite copy).
import { invoke } from "@tauri-apps/api/core";
export interface BackupInfo { name: string; path: string; sizeBytes: number; files: number; reason: string; createdAt: number; }
/** Local time stamp "2026-10-13_150255" (folder name). */
export function backupStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
export const fmtSize = (b: number) => b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
/** "13 Oct 2026, 15:02:55" from the folder name. */
export function backupLabel(name: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(?:_(.*))?$/.exec(name);
  if (!m) return name;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const why = m[7] ? ({ auto: "automatic", manual: "manual", "before-restore": "safety copy before restore", ps: "data-backup.ps1" } as Record<string, string>)[m[7].replace(/-\d+$/, "")] ?? m[7] : "";
  return `${d.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}${why ? ` (${why})` : ""}`;
}
export const backupApi = {
  now: (reason = "manual") => invoke<BackupInfo>("backup_now", { stamp: backupStamp(), reason }),
  auto: () => invoke<BackupInfo | null>("backup_auto", { stamp: backupStamp() }),
  list: () => invoke<BackupInfo[]>("backup_list"),
  restore: (name: string) => invoke<number>("backup_restore", { name }),
  folder: () => invoke<string>("backup_folder"),
};
