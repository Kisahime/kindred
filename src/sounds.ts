// Original, synthesised sounds (no audio files, nothing copied from Messenger).
import { Settings } from "./types";

export type SoundEvent = "received" | "sent" | "signin" | "nudge" | "proactive";
export const SOUND_EVENTS: { id: SoundEvent; label: string }[] = [
  { id: "received", label: "Message received" }, { id: "sent", label: "Message sent" },
  { id: "signin", label: "Contact signs in / comes online" }, { id: "nudge", label: "Nudge" },
  { id: "proactive", label: "Someone messages you first" },
];

type Tone = [freq: number, start: number, dur: number, type?: OscillatorType, endFreq?: number, gain?: number];
const PATTERNS: Record<SoundEvent, Tone[]> = {
  received: [[660, 0, 0.14], [990, 0.08, 0.22]],
  sent: [[587, 0, 0.08, "triangle", 740, 0.6]],
  signin: [[523, 0, 0.16], [659, 0.09, 0.16], [784, 0.18, 0.16], [1047, 0.27, 0.35]],
  nudge: [[140, 0, 0.09, "square", 90, 0.35], [120, 0.1, 0.09, "square", 80, 0.35], [140, 0.2, 0.09, "square", 90, 0.35], [880, 0.32, 0.18, "sine", 1320]],
  proactive: [[880, 0, 0.22], [1320, 0.09, 0.25]],
};

let cfg = { on: true, volume: 0.7, muted: new Set<string>() };
export function configureSounds(s: Pick<Settings, "sound" | "volume" | "mutedSounds">) {
  cfg = { on: s.sound, volume: Math.max(0, Math.min(100, s.volume)) / 100, muted: new Set(s.mutedSounds.split(",").filter(Boolean)) };
}

let ctx: AudioContext | null = null;
export function play(ev: SoundEvent, preview = false) {
  if (!preview && (!cfg.on || cfg.muted.has(ev))) return;
  if (cfg.volume <= 0) return;
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime + 0.01;
    for (const [f, start, dur, type = "sine", endF, g = 1] of PATTERNS[ev]) {
      const o = ctx.createOscillator(), gain = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t + start);
      if (endF) o.frequency.exponentialRampToValueAtTime(endF, t + start + dur);
      const peak = 0.22 * cfg.volume * g;
      gain.gain.setValueAtTime(0.0001, t + start);
      gain.gain.exponentialRampToValueAtTime(peak, t + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      o.connect(gain).connect(ctx.destination);
      o.start(t + start); o.stop(t + start + dur + 0.02);
    }
  } catch { /* audio unavailable */ }
}