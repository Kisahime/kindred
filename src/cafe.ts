// ☕ Café idle clicker. Pure maths (exported for tests) + one background engine that runs while the app is open (also minimised/in tray).
import { Character } from "./types";
import { earn, econApi, randomEvent, SPARK } from "./economy";

export type Category = "click" | "menu" | "machines" | "seating" | "decor" | "events" | "luck" | "staff" | "night";
export const CATEGORIES: { id: Category; label: string; emoji: string; blurb: string }[] = [
  { id: "click", label: "Brewing", emoji: "\u2615", blurb: "More Sparkles per brew" },
  { id: "menu", label: "Menu", emoji: "\u{1F4DC}", blurb: "Recipes that make everything worth more" },
  { id: "machines", label: "Machines", emoji: "\u2699\uFE0F", blurb: "Earn while you're away from the counter" },
  { id: "seating", label: "Seating", emoji: "\u{1FA91}", blurb: "Room for more customers: raises the passive limit" },
  { id: "decor", label: "Decor", emoji: "\u{1FAB4}", blurb: "Cosy touches: +% passive" },
  { id: "events", label: "Events", emoji: "\u{1F31F}", blurb: "Better golden customers and rush hours" },
  { id: "luck", label: "Luck", emoji: "\u{1F340}", blurb: "More events and lucky finds" },
  { id: "staff", label: "Staff", emoji: "\u{1F9D1}\u200D\u{1F373}", blurb: "Room for more characters behind the counter" },
  { id: "night", label: "Night", emoji: "\u{1F319}", blurb: "Earn for longer while the app is closed" },
];
export type Effect = "clickFlat" | "allPct" | "passiveFlat" | "passivePct" | "softCap" | "goldenMs" | "rushMs" | "eventFreq" | "goldenTip" | "luck" | "staffSlot" | "offlineH";
export interface Unlock { up?: [string, number]; branches?: number; }
export interface Upgrade { id: string; name: string; emoji: string; cat: Category; effect: Effect; base: number; value: number; blurb: string;
  max?: number; growth?: number; unlock?: Unlock; /** survives opening a new branch */ keep?: boolean; }
export const UPGRADES: Upgrade[] = [
  // brewing (click power)
  { id: "beans", name: "Better beans", emoji: "\u{1FAD8}", cat: "click", effect: "clickFlat", base: 25, value: 1, max: 25, blurb: "+1 per brew" },
  { id: "latteart", name: "Latte art lessons", emoji: "\u{1F33F}", cat: "click", effect: "clickFlat", base: 300, value: 4, max: 20, blurb: "+4 per brew", unlock: { up: ["beans", 3] } },
  { id: "roaster", name: "Home roaster", emoji: "\u{1F525}", cat: "click", effect: "clickFlat", base: 4000, value: 15, max: 15, blurb: "+15 per brew", unlock: { up: ["latteart", 3] } },
  { id: "grinder", name: "Golden grinder", emoji: "\u{1F451}", cat: "click", effect: "clickFlat", base: 40000, value: 50, max: 10, blurb: "+50 per brew", unlock: { branches: 1 } },
  // menu (recipes: +% to everything)
  { id: "buns", name: "Cinnamon buns", emoji: "\u{1F365}", cat: "menu", effect: "allPct", base: 500, value: 5, max: 10, growth: 1.3, blurb: "+5% all earnings", unlock: { up: ["beans", 5] } },
  { id: "seasonal", name: "Seasonal latte", emoji: "\u{1F383}", cat: "menu", effect: "allPct", base: 3000, value: 8, max: 10, growth: 1.3, blurb: "+8% all earnings", unlock: { up: ["buns", 3] } },
  { id: "secret", name: "Secret family recipe", emoji: "\u{1F4D6}", cat: "menu", effect: "allPct", base: 25000, value: 12, max: 5, growth: 1.4, blurb: "+12% all earnings", unlock: { branches: 1 } },
  // machines (passive)
  { id: "kettle", name: "Trusty kettle", emoji: "\u{1FAD6}", cat: "machines", effect: "passiveFlat", base: 15, value: 0.01, blurb: "+0.6 per minute" },
  { id: "espresso", name: "Espresso machine", emoji: "\u2615", cat: "machines", effect: "passiveFlat", base: 120, value: 0.05, blurb: "+3 per minute", unlock: { up: ["kettle", 1] } },
  { id: "pastry", name: "Pastry case", emoji: "\u{1F950}", cat: "machines", effect: "passiveFlat", base: 900, value: 0.2, blurb: "+12 per minute", unlock: { up: ["espresso", 3] } },
  { id: "barista", name: "Part-time barista", emoji: "\u{1F9D1}\u200D\u{1F373}", cat: "machines", effect: "passiveFlat", base: 6000, value: 0.8, blurb: "+48 per minute", unlock: { up: ["pastry", 5] } },
  { id: "oven", name: "Bakery oven", emoji: "\u{1F35E}", cat: "machines", effect: "passiveFlat", base: 40000, value: 3, blurb: "+180 per minute", unlock: { up: ["barista", 3] } },
  { id: "drive", name: "Drive-through window", emoji: "\u{1F697}", cat: "machines", effect: "passiveFlat", base: 250000, value: 12, blurb: "+720 per minute", unlock: { branches: 2 } },
  // seating (raises the passive soft cap)
  { id: "stools", name: "Window stools", emoji: "\u{1FA91}", cat: "seating", effect: "softCap", base: 400, value: 0.004, max: 5, growth: 1.5, blurb: "+14/h passive limit", unlock: { up: ["espresso", 1] } },
  { id: "sofa", name: "Sofa corner", emoji: "\u{1F6CB}\uFE0F", cat: "seating", effect: "softCap", base: 4000, value: 0.008, max: 3, growth: 1.6, blurb: "+29/h passive limit", unlock: { up: ["stools", 3] } },
  { id: "terrace", name: "Garden terrace", emoji: "\u{1F333}", cat: "seating", effect: "softCap", base: 30000, value: 0.016, max: 1, blurb: "+58/h passive limit", unlock: { branches: 1 } },
  // decor (+% passive)
  { id: "lights", name: "Fairy lights", emoji: "\u2728", cat: "decor", effect: "passivePct", base: 200, value: 10, max: 10, blurb: "+10% passive" },
  { id: "armchairs", name: "Squishy armchairs", emoji: "\u{1F6CB}\uFE0F", cat: "decor", effect: "passivePct", base: 1500, value: 15, max: 10, blurb: "+15% passive", unlock: { up: ["lights", 3] } },
  { id: "plants", name: "Hanging plants", emoji: "\u{1FAB4}", cat: "decor", effect: "passivePct", base: 5000, value: 20, max: 10, blurb: "+20% passive", unlock: { up: ["armchairs", 2] } },
  { id: "record", name: "Record player", emoji: "\u{1F4BF}", cat: "decor", effect: "passivePct", base: 12000, value: 25, max: 5, blurb: "+25% passive", unlock: { up: ["plants", 2] } },
  // events
  { id: "bell", name: "Bell on the door", emoji: "\u{1F514}", cat: "events", effect: "goldenMs", base: 800, value: 4000, max: 3, growth: 2, blurb: "Golden customers wait 4s longer" },
  { id: "tipjar", name: "Tip jar", emoji: "\u{1FAD9}", cat: "events", effect: "goldenTip", base: 1500, value: 25, max: 4, growth: 1.8, blurb: "+25% golden customer tips", unlock: { up: ["bell", 1] } },
  { id: "happyhour", name: "Happy hour board", emoji: "\u{1F4CB}", cat: "events", effect: "rushMs", base: 1200, value: 20000, max: 3, growth: 2, blurb: "Rush hours last 20s longer", unlock: { up: ["bell", 1] } },
  { id: "loyalty", name: "Loyalty cards", emoji: "\u{1F4B3}", cat: "events", effect: "eventFreq", base: 3000, value: 10, max: 4, growth: 2, blurb: "Events come 10% sooner", unlock: { up: ["happyhour", 1] } },
  // luck
  { id: "clover", name: "Four-leaf clover", emoji: "\u{1F340}", cat: "luck", effect: "luck", base: 1000, value: 0.1, max: 5, growth: 1.7, blurb: "+10% luck (events, lucky finds)", unlock: { up: ["bell", 1] } },
  { id: "luckycat", name: "Lucky cat", emoji: "\u{1F431}", cat: "luck", effect: "luck", base: 10000, value: 0.25, max: 2, growth: 2.5, blurb: "+25% luck", unlock: { up: ["clover", 3] } },
  // staff + night (kept when opening a new branch)
  { id: "counter", name: "Bigger counter", emoji: "\u{1F6E0}\uFE0F", cat: "staff", effect: "staffSlot", base: 2000, value: 1, max: 2, growth: 5, keep: true, blurb: "+1 staff slot (up to 5)", unlock: { up: ["espresso", 1] } },
  { id: "rota", name: "Night shift rota", emoji: "\u{1F319}", cat: "night", effect: "offlineH", base: 5000, value: 2, max: 2, growth: 4, keep: true, blurb: "+2h of away earnings (up to 12h)", unlock: { up: ["pastry", 1] } },
];
export const COST_GROWTH = 1.15;
/** Base away-earnings cap; Night shift rota adds up to 4h (12h). */
export const OFFLINE_CAP_MS = 8 * 3600_000;
/** Passive soft cap (Sparkles/s before the branch bonus): ~250/h. Seating adds up to +0.06/s, so ~470/h fully seated. */
export const SOFT_CAP = 0.07;
export const STAFF_SLOTS = 3;
export const RUSH_MS = 60_000;
export const GOLDEN_MS = 12_000;

export interface CafeState {
  levels: Record<string, number>; staff: string[]; branches: number;
  /** Sparkles earned but not yet paid into the wallet (fractional). */
  pending: number; branchEarned: number; lifetime: number; clicks: number;
  lastTick: number; rushUntil: number; golden: { until: number; reward: number } | null;
  nextEventAt: number;
}
export const blankCafe = (now = Date.now()): CafeState => ({ levels: {}, staff: [], branches: 0, pending: 0, branchEarned: 0, lifetime: 0, clicks: 0, lastTick: now, rushUntil: 0, golden: null, nextEventAt: now + 120_000 });

export const upgrade = (id: string) => UPGRADES.find((u) => u.id === id)!;
export const levelOf = (s: CafeState, id: string) => s.levels[id] ?? 0;
export const costOf = (u: Upgrade, level: number) => Math.ceil(u.base * Math.pow(u.growth ?? COST_GROWTH, level));
export const maxed = (u: Upgrade, level: number) => u.max !== undefined && level >= u.max;
/** Visible and buyable? Anything already owned stays unlocked (old saves). */
export function unlocked(s: CafeState, u: Upgrade): boolean {
  if (levelOf(s, u.id) > 0 || !u.unlock) return true;
  if (u.unlock.branches && s.branches < u.unlock.branches) return false;
  if (u.unlock.up && levelOf(s, u.unlock.up[0]) < u.unlock.up[1]) return false;
  return true;
}
export function unlockHint(u: Upgrade): string {
  const p: string[] = [];
  if (u.unlock?.up) { const r = upgrade(u.unlock.up[0]); p.push(`own ${r.name} \u00D7${u.unlock.up[1]}`); }
  if (u.unlock?.branches) p.push(`open ${u.unlock.branches} new branch${u.unlock.branches > 1 ? "es" : ""}`);
  return p.length ? `Unlocks when you ${p.join(" and ")}` : "";
}
/** Sum of value \u00D7 level for one effect. */
export const eff = (s: CafeState, e: Effect) => UPGRADES.reduce((n, u) => u.effect === e ? n + u.value * levelOf(s, u.id) : n, 0);
export const branchMult = (s: CafeState) => 1 + 0.25 * s.branches;
export const staffSlots = (s: CafeState) => STAFF_SLOTS + eff(s, "staffSlot");
export const offlineCap = (s: CafeState) => OFFLINE_CAP_MS + eff(s, "offlineH") * 3600_000;
export const softCap = (s: CafeState) => SOFT_CAP + eff(s, "softCap");
export const goldenMs = (s: CafeState) => GOLDEN_MS + eff(s, "goldenMs");
export const rushMs = (s: CafeState) => RUSH_MS + eff(s, "rushMs");
export const tipMult = (s: CafeState) => 1 + eff(s, "goldenTip") / 100;
/** Event interval multiplier (Loyalty cards), never below 0.5. */
export const eventGap = (s: CafeState) => Math.max(0.5, 1 - eff(s, "eventFreq") / 100);
export type StaffPerk = "passive" | "click" | "luck";
const PERKS: StaffPerk[] = ["passive", "click", "luck"];
export function staffPerk(id: string): StaffPerk { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PERKS[h % 3]; }
/** Boost of one staff member: up to +40% (at 100 closeness). */
export const staffBoost = (closeness: number) => 0.4 * Math.max(0, Math.min(100, closeness)) / 100;
function staffSum(s: CafeState, chars: Character[], perk: StaffPerk) {
  return s.staff.map((id) => chars.find((c) => c.id === id)).filter((c): c is Character => !!c && staffPerk(c.id) === perk).reduce((n, c) => n + staffBoost(c.closeness), 0);
}
export function rawRate(s: CafeState, chars: Character[] = []): number {
  return eff(s, "passiveFlat") * (1 + eff(s, "passivePct") / 100) * (1 + eff(s, "allPct") / 100) * (1 + staffSum(s, chars, "passive"));
}
/** Passive Sparkles per second after the soft cap (raised by seating) and branch bonus. */
export function rate(s: CafeState, chars: Character[] = []): number {
  const cap = softCap(s);
  return cap * Math.tanh(rawRate(s, chars) / cap) * branchMult(s);
}
export function clickValue(s: CafeState, chars: Character[] = [], now = Date.now()): number {
  const v = (1 + eff(s, "clickFlat")) * (1 + eff(s, "allPct") / 100) * (1 + staffSum(s, chars, "click")) * branchMult(s);
  return now < s.rushUntil ? v * 3 : v;
}
/** Event chance multiplier from luck upgrades and "luck" staff. */
export const luck = (s: CafeState, chars: Character[] = []) => 1 + eff(s, "luck") + staffSum(s, chars, "luck");
/** Earnings for an elapsed time, capped at the away limit (8h, up to 12h). */
export const passiveFor = (s: CafeState, chars: Character[], ms: number) => rate(s, chars) * Math.min(Math.max(0, ms), offlineCap(s)) / 1000;
export const prestigeNeed = (s: CafeState) => 3000 * (s.branches + 1);
export function prestige(s: CafeState, now = Date.now()): CafeState {
  if (s.branchEarned < prestigeNeed(s)) return s;
  const kept = Object.fromEntries(UPGRADES.filter((u) => u.keep && levelOf(s, u.id) > 0).map((u) => [u.id, levelOf(s, u.id)]));
  return { ...blankCafe(now), levels: kept, staff: s.staff, branches: s.branches + 1, lifetime: s.lifetime, clicks: s.clicks, pending: s.pending };
}
export function buy(s: CafeState, id: string): { s: CafeState; cost: number } {
  const u = upgrade(id);
  if (!unlocked(s, u)) throw new Error(unlockHint(u));
  if (maxed(u, levelOf(s, id))) throw new Error(`${u.name} is already at its best.`);
  return { s: { ...s, levels: { ...s.levels, [id]: levelOf(s, id) + 1 } }, cost: costOf(u, levelOf(s, id)) };
}

// ---- engine -------------------------------------------------------------------
type Sub = (s: CafeState) => void;
class CafeEngine {
  s: CafeState = blankCafe();
  chars: Character[] = [];
  loaded = false;
  offline = 0;
  private subs = new Set<Sub>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFlush = Date.now();
  private lastSave = 0;

  async start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000);
    const saved = await econApi.kvGet<CafeState>("cafe_state").catch(() => null);
    const now = Date.now();
    this.s = { ...blankCafe(now), ...(saved ?? {}) };
    if (saved) { this.offline = passiveFor(this.s, this.chars, now - this.s.lastTick); this.s.pending += this.offline; this.s.branchEarned += this.offline; this.s.lifetime += this.offline; }
    this.s.lastTick = now; this.s.golden = null;
    this.loaded = true;
    await this.flush(true);
    this.emit();
  }
  subscribe(f: Sub) { this.subs.add(f); f(this.s); return () => { this.subs.delete(f); }; }
  private emit() { this.subs.forEach((f) => f(this.s)); }
  setChars(cs: Character[]) { this.chars = cs; this.s = { ...this.s, staff: this.s.staff.filter((id) => cs.some((c) => c.id === id)) }; }

  tick(now = Date.now()) {
    if (!this.loaded) return;
    const dt = Math.min(now - this.s.lastTick, offlineCap(this.s));
    const got = passiveFor(this.s, this.chars, dt);
    const s = { ...this.s, pending: this.s.pending + got, branchEarned: this.s.branchEarned + got, lifetime: this.s.lifetime + got, lastTick: now };
    if (s.golden && now > s.golden.until) s.golden = null;
    if (now >= s.nextEventAt) {
      const r = Math.random() * luck(s, this.chars);
      if (r > 0.55) s.golden = { until: now + goldenMs(s), reward: Math.max(15, Math.round((rate(s, this.chars) * 120 + clickValue(s, this.chars, now) * 10) * tipMult(s))) };
      else if (r > 0.3) s.rushUntil = now + rushMs(s);
      s.nextEventAt = now + (180_000 + Math.random() * 300_000) * eventGap(s) / luck(s, this.chars);
      const ev = randomEvent(() => Math.random() / luck(s, this.chars));
      if (ev) earn(ev.amount, "event", ev.reason).catch(() => {});
    }
    this.s = s;
    if (now - this.lastFlush > 60_000) this.flush();
    else if (now - this.lastSave > 15_000) this.save();
    this.emit();
  }
  click() { const v = clickValue(this.s, this.chars); this.s = { ...this.s, pending: this.s.pending + v, branchEarned: this.s.branchEarned + v, lifetime: this.s.lifetime + v, clicks: this.s.clicks + 1 }; this.emit(); return v; }
  async catchGolden() {
    const g = this.s.golden; if (!g || Date.now() > g.until) return 0;
    this.s = { ...this.s, golden: null }; this.emit();
    await earn(g.reward, "cafe", "A golden customer left a big tip!");
    return g.reward;
  }
  /** Moves whole Sparkles from the till into the wallet. */
  async flush(quiet = false) {
    this.lastFlush = Date.now();
    const whole = Math.floor(this.s.pending);
    if (whole > 0) { this.s = { ...this.s, pending: this.s.pending - whole }; await earn(whole, "cafe", "Caf\u00E9 takings", !quiet && whole >= 25).catch(() => { this.s.pending += whole; }); }
    await this.save();
  }
  async save() { this.lastSave = Date.now(); await econApi.kvSet("cafe_state", this.s).catch(() => {}); }
  async buy(id: string) {
    await this.flush(true);
    const r = buy(this.s, id);
    const u = upgrade(id);
    await earn(-r.cost, "cafe_upgrade", `Caf\u00E9: ${u.name}`);
    this.s = r.s; await this.save(); this.emit();
  }
  async toggleStaff(id: string) {
    const has = this.s.staff.includes(id);
    if (!has && this.s.staff.length >= staffSlots(this.s)) throw new Error(`Only ${staffSlots(this.s)} staff fit behind the counter. Let someone go first.`);
    this.s = { ...this.s, staff: has ? this.s.staff.filter((x) => x !== id) : [...this.s.staff, id] };
    await this.save(); this.emit();
  }
  async openBranch() {
    await this.flush(true);
    const n = prestige(this.s);
    if (n === this.s) throw new Error(`Earn ${prestigeNeed(this.s)} ${SPARK} in this branch first.`);
    this.s = n; await this.save(); this.emit();
  }
}
export const cafe = new CafeEngine();

/** Short context line so characters sometimes mention the café. */
export function cafePrompt(s: CafeState, c: Character, userName: string, rand = Math.random): string {
  const working = s.staff.includes(c.id);
  if (!s.clicks && !Object.keys(s.levels).length) return "";
  if (!working && rand() > 0.2) return "";
  if (working && rand() > 0.35) return `(Background: you also help out part-time at ${userName}'s little caf\u00E9. Only mention it if it fits.)`;
  const busy = rate(s) > 0.03 ? "busy" : "quiet but cosy";
  return `(Background: ${userName} runs a little caf\u00E9${s.branches ? ` with ${s.branches + 1} branches` : ""}${working ? " where you work part-time" : ""}; lately it has been ${busy}. You may briefly mention the caf\u00E9 if it fits naturally.)`;
}
