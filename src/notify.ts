import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Shakes the window like a classic nudge (falls back to a CSS shake when maximised/unavailable). */
export async function shakeWindow() {
  document.body.classList.remove("shake"); void document.body.offsetWidth; document.body.classList.add("shake");
  setTimeout(() => document.body.classList.remove("shake"), 600);
  try {
    const w = getCurrentWindow();
    if (await w.isMaximized()) return;
    const p = await w.outerPosition();
    for (const [dx, dy] of [[12, 0], [-12, 2], [10, -3], [-10, 3], [7, 0], [-7, -2], [4, 1], [-3, 0], [0, 0]]) {
      await w.setPosition(new PhysicalPosition(p.x + dx, p.y + dy));
      await sleep(32);
    }
  } catch (e) { console.warn("[nudge] window shake unavailable", e); }
}

/** Windows desktop notification (only used when the window isn't focused). */
export async function desktopNotify(title: string, body: string) {
  try {
    let ok = await isPermissionGranted();
    if (!ok) ok = (await requestPermission()) === "granted";
    if (ok) sendNotification({ title, body });
  } catch { /* notifications unavailable */ }
}