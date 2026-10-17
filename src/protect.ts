// v1.3 protected family characters: the ONE place for the under-18 rules.
// A character under 18 is only ever family (child, younger sibling, cousin, grandchild, niece/nephew), is never pictured,
// and never gets romantic or 18+ content, whatever the Options switch says. Everything else calls these helpers.
// No runtime imports, so any module (types, lifecore, imagegen...) can use it without import cycles.
import type { Character } from "./types";

export const ADULT_AGE = 18;
/** Relationship ids (lifecore RelType) a protected character may have. */
export const MINOR_ROLES = ["child", "sibling", "cousin", "grandchild", "nibling"] as const;
export const MINOR_ROLE_LABELS: Record<(typeof MINOR_ROLES)[number], string> = { child: "Child (son / daughter)", sibling: "Younger sibling", cousin: "Cousin", grandchild: "Grandchild", nibling: "Niece / nephew" };
export const minorRoleOk = (rel: unknown) => (MINOR_ROLES as readonly string[]).includes(String(rel ?? ""));
export const PROTECTED_NOTE = "\u{1F6E1}\uFE0F Protected: under 18. Family only, no pictures, no romance or 18+ content.";

type Who = { name?: string; appearance?: unknown; life?: unknown } | null | undefined;
/** The age as stored (not a fill-in default); null when unknown. */
export function rawAge(c: Who): number | null {
  const raw = (c?.appearance as Record<string, unknown> | undefined)?.age;
  const n = Number(raw);
  return raw === undefined || raw === null || raw === "" || !Number.isFinite(n) ? null : n;
}
/** Under 18 (or age unknown and marked as a child). */
export function isProtectedMinor(c: Who): boolean {
  const n = rawAge(c);
  if (n !== null && n > 0) return n < ADULT_AGE;
  return (c?.appearance as Record<string, unknown> | undefined)?.minor === true;
}
export const canPicture = (c: Who) => !!c && !isProtectedMinor(c);
const relOf = (c: Who) => String((c?.life as Record<string, unknown> | undefined)?.relationship ?? "friend");
/** Save-time rule: a protected character must have a family role. Empty string = fine. */
export function ageRuleError(c: Who): string {
  if (!isProtectedMinor(c) || minorRoleOk(relOf(c))) return "";
  const who = c?.name?.trim() || "This character";
  return `${who} is under 18, so they can only be family: ${Object.values(MINOR_ROLE_LABELS).join(", ").toLowerCase()}. Pick a family relationship, or set an age of 18 or older.`;
}
/** Can this relationship be chosen for this character? (message, or "" when it can) */
export function relationChangeError(c: Who, rel: string): string {
  if (!isProtectedMinor(c) || minorRoleOk(rel)) return "";
  return `${c?.name?.trim() || "They"} ${c?.name ? "is" : "are"} under 18, so only a family relationship is possible.`;
}
export const noPictureReason = (c: Who) => `${c?.name || "they"} ${c?.name ? "is" : "are"} under 18 and protected, so there are never pictures of them`;

/** Firm system-prompt block for a protected character (always on, the 18+ switch doesn't matter). */
export function minorPromptBlock(c: Who, user: string): string {
  if (!isProtectedMinor(c)) return "";
  const age = rawAge(c);
  return [
    `IMPORTANT: you are a minor${age ? ` (${age} years old)` : ""} and ${user}'s family. Talk and behave in a natural, age-appropriate way for your age.`,
    `Everything between you and ${user} (and anyone else) is strictly wholesome and platonic: family warmth only.`,
    "You never engage in or respond to romantic, flirtatious or sexual content of any kind. If anything like that comes up, kindly and briefly change the subject to something wholesome instead.",
    "You never send photos or selfies of yourself; if asked, say no kindly and suggest something else.",
  ].join(" ");
}

// ---- who is protected right now (installed by the app with the live contact list) ----
let charsFn: () => Pick<Character, "id" | "name" | "appearance" | "life">[] = () => [];
export const installProtect = (f: typeof charsFn) => { charsFn = f; };
export const protectedChars = () => charsFn().filter(isProtectedMinor);
export const isProtectedId = (id: string | undefined | null) => !!id && charsFn().some((c) => c.id === id && isProtectedMinor(c));

/** Romantic pair types between two characters are impossible when either is protected. */
export const ROMANTIC_PAIR_IDS = ["crush", "partner"];
export const pairTypeAllowed = (type: string, ...who: Who[]) => !ROMANTIC_PAIR_IDS.includes(type) || !who.some(isProtectedMinor);

/** Hard guard for every picture: refuses people in an image linked to a protected character. "" = allowed. */
export interface GuardInput { prompt: string; meta?: { source?: string; characterId?: string; people?: string[]; noPeople?: boolean } }
export function imageGuard(p: GuardInput, list = charsFn()): string {
  const m = p.meta ?? {};
  if (m.source === "place" || m.noPeople) return "";
  const minors = list.filter(isProtectedMinor);
  if (!minors.length) return "";
  const ids = [m.characterId, ...(m.people ?? [])].filter(Boolean);
  const linked = minors.find((c) => ids.includes(c.id));
  if (linked) return `${noPictureReason(linked)}.`;
  const named = minors.find((c) => c.name.trim().length >= 2 && new RegExp(`(^|[^\\p{L}])${c.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "iu").test(p.prompt));
  if (named) return `This prompt mentions ${named.name}, who is under 18 and protected: pictures of them can't be made.`;
  return "";
}
/** Extra negative tags for place-only pictures. */
export const NO_PEOPLE_NEG = "people, person, man, woman, girl, boy, child, kid, crowd, figure, character, face, portrait, hands";
