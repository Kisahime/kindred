// 🙋 Alex's "Me" profile: what characters may know about the user. Stored in SQLite (kv "user_profile"), so it's in every data backup.
import { invoke } from "@tauri-apps/api/core";
import type { Character, Settings } from "./types";
import { setUserBlock } from "./types";

export interface PField { value: string; share: boolean; }
export const FIELDS = [
  ["displayName", "Display name", "Alex"], ["nicknames", "Nicknames characters may use", "Al, Lex"], ["pronouns", "Pronouns", "she/her"],
  ["birthday", "Birthday", ""], ["town", "Town / region", "Your town"], ["timezone", "Timezone", "e.g. Europe/Paris"],
  ["job", "Job / studies", "nurse, studying part-time"], ["hobbies", "Hobbies", "gaming, baking"], ["likes", "Likes", "rainy days, cats"],
  ["dislikes", "Dislikes", "loud chewing"], ["food", "Favourite food", "pasta"], ["music", "Favourite music", "lo-fi, Taylor Swift"],
  ["films", "Favourite films / shows", "Studio Ghibli"], ["about", "About me", "A few sentences about you"], ["traits", "Personality traits", "shy at first, silly with friends"],
  ["boundaries", "Boundaries / topics to avoid", "my ex, politics"],
  ["photoLook", "My appearance for photos (optional; only used for photos of you both, never sent to chats)", "e.g. adult woman, shoulder-length auburn hair, green eyes, freckles, casual style"],
  ["picture", "Profile picture", ""],
] as const;
export type FieldId = typeof FIELDS[number][0];
export interface UserProfile { v: 1; fields: Record<FieldId, PField>; perChar: Record<string, string>; }

export function blankProfile(name = ""): UserProfile {
  const fields = Object.fromEntries(FIELDS.map(([id]) => [id, { value: "", share: id !== "picture" && id !== "photoLook" }])) as Record<FieldId, PField>;
  fields.displayName.value = name;
  return { v: 1, fields, perChar: {} };
}
/** Fills gaps from older/partial data; migrates the old header name. */
export function normalizeProfile(raw: unknown, settings?: Pick<Settings, "userName">): UserProfile {
  const p = blankProfile(settings?.userName ?? "");
  const r = (raw ?? {}) as Partial<UserProfile>;
  for (const [id] of FIELDS) {
    const f = r.fields?.[id];
    if (f && typeof f.value === "string") p.fields[id] = { value: f.value.slice(0, 1000), share: f.share !== false };
  }
  if (!p.fields.displayName.value && settings?.userName) p.fields.displayName.value = settings.userName;
  if (r.perChar && typeof r.perChar === "object") for (const [k, v] of Object.entries(r.perChar)) if (typeof v === "string" && v.trim()) p.perChar[k] = v.trim().slice(0, 60);
  return p;
}

// ---- birthday: "YYYY-MM-DD" or "--MM-DD" (year optional) ----
export function parseBirthday(s: string): { y: number | null; m: number; d: number } | null {
  const x = /^(\d{4}-|--)(\d{2})-(\d{2})$/.exec(s.trim());
  if (!x) return null;
  const m = +x[2], d = +x[3];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y: x[1] === "--" ? null : +x[1].slice(0, 4), m, d };
}
export function isBirthday(s: string, now = new Date()): boolean {
  const b = parseBirthday(s);
  if (!b) return false;
  const leap = b.m === 2 && b.d === 29 && !(new Date(now.getFullYear(), 1, 29).getDate() === 29);
  return now.getMonth() + 1 === b.m && now.getDate() === (leap ? 28 : b.d);
}
export function ageOn(s: string, now = new Date()): number | null {
  const b = parseBirthday(s);
  if (!b?.y) return null;
  return now.getFullYear() - b.y - (now.getMonth() + 1 < b.m || (now.getMonth() + 1 === b.m && now.getDate() < b.d) ? 1 : 0);
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const birthdayText = (s: string) => { const b = parseBirthday(s); return b ? `${b.d} ${MONTHS[b.m - 1]}${b.y ? ` ${b.y}` : ""}` : ""; };

/** What this character calls her: their own override, else her nicknames, else her name. */
export function callName(p: UserProfile, charId?: string): string {
  return (charId && p.perChar[charId]) || "";
}
const cut = (s: string, n = 200) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "\u2026" : t; };
/** Compact "About the user" block from shared fields only. */
export function aboutUserBlock(p: UserProfile, c?: Pick<Character, "id" | "name">, now = new Date()): string {
  const f = (id: FieldId) => p.fields[id].share ? cut(p.fields[id].value) : "";
  const name = f("displayName") || "the user";
  const lines: string[] = [];
  const own = callName(p, c?.id);
  if (own) lines.push(`You call them "${own}" (your own name for them).${f("nicknames") ? ` Other nicknames they like: ${f("nicknames")}.` : ""}`);
  else if (f("nicknames")) lines.push(`Nicknames you may use for them: ${f("nicknames")}.`);
  if (f("pronouns")) lines.push(`Pronouns: ${f("pronouns")} (always use these when talking about them).`);
  if (f("birthday") && parseBirthday(f("birthday"))) {
    const age = ageOn(f("birthday"), now);
    lines.push(`Birthday: ${birthdayText(f("birthday")).replace(/ \d{4}$/, "")}${age !== null ? ` (${age} years old)` : ""}.`);
  }
  const place = [f("town"), f("timezone")].filter(Boolean).join(", ");
  if (place) {
    let local = "";
    if (f("timezone")) try { local = ` (their local time is ${now.toLocaleTimeString([], { timeZone: f("timezone"), hour: "2-digit", minute: "2-digit" })})`; } catch { /* unknown zone */ }
    lines.push(`Lives in: ${place}${local}.`);
  }
  const rows: [FieldId, string][] = [["job", "Job/studies"], ["hobbies", "Hobbies"], ["likes", "Likes"], ["dislikes", "Dislikes"], ["food", "Favourite food"],
    ["music", "Favourite music"], ["films", "Favourite films/shows"], ["traits", "Personality"], ["about", "About them"]];
  for (const [id, label] of rows) if (f(id)) lines.push(`${label}: ${f(id)}.`);
  if (f("boundaries")) lines.push(`BOUNDARIES (always respect): avoid these topics and never push on them: ${f("boundaries")}.`);
  if (f("birthday") && isBirthday(f("birthday"), now)) lines.push(`TODAY IS ${name.toUpperCase()}'S BIRTHDAY! Wish them a happy birthday warmly if you haven't yet today.`);
  if (!lines.length && name === "the user") return "";
  return `About the user (${name}${f("pronouns") ? `, ${f("pronouns")}` : ""}): call them by their name or a nickname.\n${lines.map((l) => `- ${l}`).join("\n")}`.replace(/\n$/, "");
}

// ---- cache + storage ----
let cache: UserProfile = blankProfile("");
export const profile = () => cache;
export function useProfileInPrompts(p: UserProfile) { cache = p; setUserBlock((c, now) => aboutUserBlock(cache, c, now)); }
export const profileApi = {
  load: async (settings: Settings) => {
    const raw = await invoke<unknown>("kv_get", { key: "user_profile" }).catch(() => null);
    const p = normalizeProfile(raw, settings);
    if (!raw) await invoke("kv_set", { key: "user_profile", value: p }).catch(() => {}); // first run: migrate the header name
    useProfileInPrompts(p);
    return p;
  },
  save: async (p: UserProfile) => { await invoke("kv_set", { key: "user_profile", value: p }); useProfileInPrompts(p); },
};
