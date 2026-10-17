// Image generation API + types. Also the hook for characters sending selfies later.
import { Channel, invoke } from "@tauri-apps/api/core";
import { imageGuard } from "./protect";

export interface Lora { path: string; strength: number; }
export interface GenParams {
  model: string; modelKind: "checkpoint" | "diffusion"; textEncoder: string; vae: string; loras: Lora[];
  prompt: string; negative: string; steps: number; cfg: number; sampler: string; scheduler: string;
  seed: number; width: number; height: number; batch: number; clipSkip: number;
  /** Saved with the picture (not sent to the engine): where it's for, whose it is, what gift is worn, 18+. */
  meta?: ImageMeta;
}
export type ImageSource = "studio" | "selfie" | "avatar" | "album" | "place" | "scene";
export interface ImageMeta { source: ImageSource; characterId?: string; gift?: string; adult?: boolean;
  /** Characters drawn in the picture (group photos); and true for pictures with no people at all (checked by the protect guard, here and in Rust). */
  people?: string[]; noPeople?: boolean; }
export interface ModelFile { path: string; name: string; kind: "model" | "lora" | "vae" | "text_encoder"; sizeMb: number; arch: string; note: string; }
export interface EngineInfo { ok: boolean; version: string; samplers: string[]; schedulers: string[]; clipSkip: boolean; error: string; }
export interface Progress { phase: "queued" | "unloading" | "loading" | "sampling" | "decoding" | "log"; step: number; total: number; line: string; }
export interface ImageRow { id: number; path: string; params: GenParams; createdAt: number; source: ImageSource | ""; charId: string; gift: string; adult: boolean; recorded: boolean; }
export interface ImageConfig { enginePath: string; extraFolders: string[]; presets: Record<string, Partial<GenParams>>; last?: GenParams; }

export const DEFAULT_PARAMS: GenParams = {
  model: "", modelKind: "checkpoint", textEncoder: "", vae: "", loras: [], prompt: "", negative: "",
  steps: 25, cfg: 6, sampler: "", scheduler: "", seed: -1, width: 1024, height: 1024, batch: 1, clipSkip: 0,
};
export const SIZE_PRESETS: [number, number, string][] = [
  [1024, 1024, "1024 \u00D7 1024 square"], [896, 1152, "896 \u00D7 1152 portrait"], [832, 1216, "832 \u00D7 1216 portrait"],
  [768, 1344, "768 \u00D7 1344 tall"], [1152, 896, "1152 \u00D7 896 landscape"], [1216, 832, "1216 \u00D7 832 landscape"],
  [1344, 768, "1344 \u00D7 768 wide"], [768, 768, "768 \u00D7 768 (SD1.5 / fast)"], [512, 512, "512 \u00D7 512 (SD1.5)"],
];
/** Settings a model preset remembers. */
export const PRESET_KEYS: (keyof GenParams)[] = ["modelKind", "textEncoder", "vae", "steps", "cfg", "sampler", "scheduler", "width", "height", "clipSkip", "negative"];
export const needsComponents = (arch: string) => ["anima", "flux", "krea2", "unet"].includes(arch);

export const imageApi = {
  engineInfo: () => invoke<EngineInfo>("sd_engine_info"),
  defaultEngine: () => invoke<string>("sd_default_engine"),
  scan: (extra: string[]) => invoke<ModelFile[]>("sd_scan_models", { extra }),
  busy: () => invoke<boolean>("sd_busy"),
  cancel: () => invoke<void>("sd_cancel"),
  listImages: (includeAdult: boolean) => invoke<ImageRow[]>("list_images", { includeAdult }),
  /** Record for a chat/album picture; `{ hidden: true }` when it's 18+ and the switch is off, `{ hidden: false }` when unknown. */
  forPath: (path: string, includeAdult: boolean) => invoke<ImageRow | { hidden: boolean }>("image_for_path", { path, includeAdult }),
  deleteImage: (id: number) => invoke<void>("delete_image", { id }),
  openFolder: () => invoke<void>("open_images_folder"),
  getConfig: async (): Promise<ImageConfig> => ({ enginePath: "", extraFolders: [], presets: {}, ...((await invoke<ImageConfig | null>("kv_get", { key: "image_config" })) ?? {}) }),
  saveConfig: (value: ImageConfig) => invoke<void>("kv_set", { key: "image_config", value }),
};

/** Runs one job (queued behind any chat). Resolves with the saved images. */
export function generateImage(params: GenParams, onProgress: (p: Progress) => void): Promise<ImageRow[]> {
  const refused = imageGuard(params);
  if (refused) return Promise.reject(new Error(refused));
  const ch = new Channel<Progress>();
  ch.onmessage = onProgress;
  return invoke<ImageRow[]>("sd_generate", { params, onProgress: ch });
}

/** Adds where-it's-for info to a generation. */
export const tagged = (p: GenParams, meta: ImageMeta): GenParams => ({ ...p, meta: { ...p.meta, ...meta } });
/** Form settings from a saved picture (meta dropped); `newSeed` = random again. */
export function reuseParams(r: Pick<ImageRow, "params">, newSeed = false): GenParams {
  const { meta: _m, ...rest } = (r.params ?? {}) as GenParams;
  const p: GenParams = { ...DEFAULT_PARAMS, ...rest, batch: 1 };
  return newSeed ? { ...p, seed: -1 } : p;
}
export const SOURCE_LABEL: Record<string, string> = { studio: "Image Studio", selfie: "Chat selfie", avatar: "Avatar", album: "Album / feed photo", place: "Place background", scene: "Scene photo", "": "Unknown" };
const base = (path: string) => path.split(/[\\/]/).pop() ?? path;
/** Plain-words settings list for the details panel. */
export function settingsList(r: ImageRow): [string, string][] {
  const p = (r.params ?? {}) as Partial<GenParams>;
  if (!r.recorded) return [["Source", SOURCE_LABEL[r.source] ?? r.source]];
  return ([
    ["Source", SOURCE_LABEL[r.source] ?? r.source],
    ["Model", p.model ? base(p.model) : "?"],
    ["VAE", p.vae ? base(p.vae) : "built-in"],
    ["Text encoder", p.textEncoder ? base(p.textEncoder) : "built-in"],
    ["Steps", String(p.steps ?? "?")], ["CFG", String(p.cfg ?? "?")],
    ["Sampler", p.sampler || "model default"], ["Scheduler", p.scheduler || "model default"],
    ["Seed", p.seed == null || p.seed < 0 ? "random (not recorded)" : String(p.seed)],
    ["Size", `${p.width ?? "?"} \u00D7 ${p.height ?? "?"}`],
    ["LoRAs", p.loras?.length ? p.loras.map((l) => `${base(l.path)} (${l.strength})`).join(", ") : "none"],
    ...(p.clipSkip ? [["Clip skip", String(p.clipSkip)] as [string, string]] : []),
  ] as [string, string][]);
}
