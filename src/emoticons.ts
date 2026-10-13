// Classic text smileys -> Unicode emoji (display only; stored text is unchanged).
export const SMILEYS: [string, string][] = [
  [":-)", "\u{1F642}"], [":)", "\u{1F642}"], [":-D", "\u{1F604}"], [":D", "\u{1F604}"], [";-)", "\u{1F609}"], [";)", "\u{1F609}"],
  [":-P", "\u{1F61B}"], [":P", "\u{1F61B}"], [":p", "\u{1F61B}"], [":-(", "\u{1F641}"], [":(", "\u{1F641}"],
  [":'(", "\u{1F622}"], [":-O", "\u{1F62E}"], [":O", "\u{1F62E}"], [":o", "\u{1F62E}"], [":-|", "\u{1F610}"], [":|", "\u{1F610}"],
  [":-S", "\u{1F615}"], [":S", "\u{1F615}"], [":s", "\u{1F615}"], [":$", "\u{1F633}"], [":-$", "\u{1F633}"],
  [":@", "\u{1F620}"], [":-@", "\u{1F620}"], ["8-)", "\u{1F60E}"], ["(H)", "\u{1F60E}"], ["(h)", "\u{1F60E}"],
  ["(L)", "\u2764\uFE0F"], ["(l)", "\u2764\uFE0F"], ["<3", "\u2764\uFE0F"], ["(U)", "\u{1F494}"], ["(u)", "\u{1F494}"], ["</3", "\u{1F494}"],
  ["(Y)", "\u{1F44D}"], ["(y)", "\u{1F44D}"], ["(N)", "\u{1F44E}"], ["(n)", "\u{1F44E}"], ["(K)", "\u{1F48B}"], ["(k)", "\u{1F48B}"],
  ["(F)", "\u{1F339}"], ["(f)", "\u{1F339}"], ["(*)", "\u2B50"], ["(C)", "\u2615"], ["(c)", "\u2615"], ["(B)", "\u{1F37A}"], ["(b)", "\u{1F37A}"],
  ["(S)", "\u{1F319}"], ["(I)", "\u{1F4A1}"], ["(i)", "\u{1F4A1}"], ["(6)", "\u{1F608}"], ["(A)", "\u{1F607}"], ["(a)", "\u{1F607}"],
  ["(^)", "\u{1F382}"], ["(G)", "\u{1F381}"], ["(g)", "\u{1F381}"], ["(8)", "\u{1F3B5}"], ["(E)", "\u2709\uFE0F"], ["(e)", "\u2709\uFE0F"],
  ["^_^", "\u{1F60A}"], ["^^", "\u{1F60A}"], ["XD", "\u{1F606}"], ["xD", "\u{1F606}"], ["-_-", "\u{1F611}"], [":-*", "\u{1F618}"], [":*", "\u{1F618}"],
];

const MAP = new Map(SMILEYS);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// longest first so ":-)" wins over ":)"; must not touch letters/digits/slashes on either side
const RE = new RegExp(`(?<![\\p{L}\\p{N}/:\\\\])(${[...MAP.keys()].sort((a, b) => b.length - a.length).map(esc).join("|")})(?![\\p{L}\\p{N}/])`, "gu");
// URLs, emails, inline/fenced code and paths are left alone
const PROTECT = /(```[\s\S]*?```|`[^`\n]*`|\b(?:https?|ftp|file):\/\/\S+|\bwww\.\S+|\S+@\S+\.\S+|[A-Za-z]:\\\S*)/g;

export function convertSmileys(text: string): string {
  let out = "", last = 0;
  for (const m of text.matchAll(PROTECT)) {
    out += text.slice(last, m.index).replace(RE, (s) => MAP.get(s) ?? s) + m[0];
    last = m.index! + m[0].length;
  }
  return out + text.slice(last).replace(RE, (s) => MAP.get(s) ?? s);
}

export const EMOJI_CATEGORIES: { name: string; icon: string; emoji: string[] }[] = [
  { name: "Smileys", icon: "\u{1F642}", emoji: [..."\u{1F600}\u{1F603}\u{1F604}\u{1F601}\u{1F606}\u{1F605}\u{1F602}\u{1F923}\u{1F60A}\u{1F607}\u{1F642}\u{1F643}\u{1F609}\u{1F60C}\u{1F60D}\u{1F970}\u{1F618}\u{1F617}\u{1F61A}\u{1F60B}\u{1F61B}\u{1F61C}\u{1F92A}\u{1F61D}\u{1F917}\u{1F92D}\u{1F914}\u{1F928}\u{1F610}\u{1F611}\u{1F636}\u{1F60F}\u{1F612}\u{1F644}\u{1F62C}\u{1F60E}\u{1F913}\u{1F633}\u{1F97A}\u{1F622}\u{1F62D}\u{1F624}\u{1F620}\u{1F621}\u{1F631}\u{1F628}\u{1F630}\u{1F634}\u{1F971}\u{1F635}\u{1F92F}\u{1F973}\u{1F607}\u{1F608}"] },
  { name: "Love", icon: "\u2764\uFE0F", emoji: ["\u2764\uFE0F", "\u{1F9E1}", "\u{1F49B}", "\u{1F49A}", "\u{1F499}", "\u{1F49C}", "\u{1F90D}", "\u{1F5A4}", "\u{1F494}", "\u{1F495}", "\u{1F49E}", "\u{1F493}", "\u{1F497}", "\u{1F496}", "\u{1F498}", "\u{1F49D}", "\u{1F48B}", "\u{1F48C}", "\u{1F339}", "\u{1F490}", "\u{1F31F}", "\u2728", "\u{1F496}", "\u{1FAF6}"] },
  { name: "Gestures", icon: "\u{1F44B}", emoji: ["\u{1F44B}", "\u{1F44D}", "\u{1F44E}", "\u{1F44F}", "\u{1F64C}", "\u{1F450}", "\u{1F91D}", "\u{1F64F}", "\u270C\uFE0F", "\u{1F91E}", "\u{1F91F}", "\u{1F918}", "\u{1F44C}", "\u{1F90F}", "\u{1F448}", "\u{1F449}", "\u{1F446}", "\u{1F447}", "\u270B", "\u{1F44A}", "\u{1F4AA}", "\u{1F937}", "\u{1F926}", "\u{1F483}"] },
  { name: "Nature", icon: "\u{1F43B}", emoji: ["\u{1F431}", "\u{1F436}", "\u{1F98A}", "\u{1F43B}", "\u{1F43C}", "\u{1F428}", "\u{1F430}", "\u{1F439}", "\u{1F981}", "\u{1F984}", "\u{1F98B}", "\u{1F41D}", "\u{1F422}", "\u{1F427}", "\u{1F989}", "\u{1F338}", "\u{1F33B}", "\u{1F337}", "\u{1F340}", "\u{1F342}", "\u{1F335}", "\u{1F319}", "\u2600\uFE0F", "\u{1F308}", "\u2744\uFE0F", "\u{1F327}\uFE0F", "\u26A1", "\u{1F525}"] },
  { name: "Food", icon: "\u2615", emoji: ["\u2615", "\u{1F375}", "\u{1F9CB}", "\u{1F36A}", "\u{1F370}", "\u{1F382}", "\u{1F9C1}", "\u{1F369}", "\u{1F36B}", "\u{1F36D}", "\u{1F355}", "\u{1F354}", "\u{1F35F}", "\u{1F35C}", "\u{1F363}", "\u{1F353}", "\u{1F34E}", "\u{1F351}", "\u{1F95E}", "\u{1F377}", "\u{1F37A}", "\u{1F379}", "\u{1F95B}", "\u{1F37F}"] },
  { name: "Things", icon: "\u{1F3AE}", emoji: ["\u{1F3AE}", "\u{1F3B5}", "\u{1F3B8}", "\u{1F3A8}", "\u{1F4DA}", "\u{1F4D6}", "\u270F\uFE0F", "\u{1F4BB}", "\u{1F4F1}", "\u{1F4F7}", "\u{1F3AC}", "\u{1F381}", "\u{1F388}", "\u{1F389}", "\u{1F52E}", "\u{1F56F}\uFE0F", "\u{1F6CB}\uFE0F", "\u{1F6CF}\uFE0F", "\u{1F3E1}", "\u2708\uFE0F", "\u{1F697}", "\u26BD", "\u{1F3C6}", "\u{1F4A1}", "\u{1F4A4}", "\u{1F4AC}", "\u2709\uFE0F", "\u23F0"] },
];

/** Text shortcut for an emoji, for tooltips in the picker. */
export const shortcutFor = (emoji: string) => SMILEYS.find(([, e]) => e === emoji)?.[0];