import { useEffect, useState } from "react";
import { Appearance, appearanceOf, Character, MIN_AGE } from "./types";
import { ageRuleError, isProtectedMinor, PROTECTED_NOTE } from "./protect";
import { imageApi, ModelFile } from "./imagegen";
import { buildSelfiePrompt, timeSlot } from "./selfie";
import { Spark } from "./Spark";
import type { GenCtl } from "./genctl";
import type { GenField } from "./autogen";

/** "Appearance & selfies" section of the contact editor. */
export function AppearanceEditor({ c, onChange, gen }: { c: Character; onChange: (a: Appearance) => void; gen?: GenCtl }) {
  const a = appearanceOf(c);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<ModelFile[]>([]);
  const [preview, setPreview] = useState(false);
  useEffect(() => { if (open) imageApi.getConfig().then((cfg) => imageApi.scan(cfg.extraFolders)).then(setFiles).catch(() => {}); }, [open]);
  const set = <K extends keyof Appearance>(k: K, v: Appearance[K]) => onChange({ ...a, [k]: v });
  const txt = (k: keyof Appearance, label: string, ph = "") =>
    <label>{label}<Spark f={`a.${k}` as GenField} gen={gen} /><input value={a[k] as string} placeholder={ph} onChange={(e) => set(k, e.target.value as never)} /></label>;
  const txtPlain = (k: keyof Appearance, label: string, ph = "") =>
    <label>{label}<input value={a[k] as string} placeholder={ph} onChange={(e) => set(k, e.target.value as never)} /></label>;
  const models = files.filter((f) => f.kind === "model"), loras = files.filter((f) => f.kind === "lora");
  const minor = isProtectedMinor(c);
  const ageInput = <input type="number" min={1} max={99} value={a.age} onChange={(e) => set("age", Math.max(1, Math.min(99, Math.round(+e.target.value) || MIN_AGE)))} />;
  return (
    <div className="appearance-box">
      <button className="link" onClick={() => setOpen((o) => !o)}>{open ? "\u25BE" : "\u25B8"} Appearance &amp; selfies</button>
      {open && minor && <>
        <small>{PROTECTED_NOTE} Their looks and picture settings are not used.</small>
        <div className="grid2"><label>Age{ageInput}</label></div>
        {ageRuleError(c) && <div className="ed-error">{"\u26D4"} {ageRuleError(c)}</div>}
      </>}
      {open && !minor && <>
        <small>Used when {c.name || "they"} sends you a selfie. Pictures are only ever of adults ({MIN_AGE}+). Under {MIN_AGE} is possible only for family (e.g. a son, daughter or younger sibling), who are protected and never pictured.</small>
        <div className="grid2">
          <label>Age<Spark f="a.age" gen={gen} />{ageInput}</label>
          {txt("body", "Gender / body", "woman, slim, tall")}
          {txt("face", "Face, hair, eyes", "freckles, long auburn hair, green eyes")}
          {txt("features", "Distinguishing features", "round glasses, small nose stud")}
        </div>
        {txt("style", "Style keywords", "anime style, soft lighting, pastel colours")}
        <div className="opt-row">Outfits and places by time of day</div>
        <div className="grid2">
          {txt("outfitDay", "Morning / day outfit", "cream jumper and jeans")}{txt("placeDay", "Day setting", "cafe by the window")}
          {txt("outfitEvening", "Evening outfit", "oversized hoodie")}{txt("placeEvening", "Evening setting", "living room, fairy lights")}
          {txt("outfitNight", "Night / pyjamas", "flannel pyjamas")}{txt("placeNight", "Night setting", "in bed, bedside lamp")}
        </div>
        <div className="opt-row">Picture settings</div>
        <label>Image model<select value={a.imageModel} onChange={(e) => set("imageModel", e.target.value)}>
          <option value="">Whatever Image Studio used last</option>
          {a.imageModel && !models.some((m) => m.path === a.imageModel) && <option value={a.imageModel}>{a.imageModel} (not found)</option>}
          {models.map((m) => <option key={m.path} value={m.path}>{m.name} ({m.arch})</option>)}</select></label>
        <small>Its Image Studio preset (sampler, steps, encoder, VAE) is used too.</small>
        {txt("extraTags", "Extra positive tags", "masterpiece, detailed eyes")}
        {txtPlain("negativeTags", "Extra negative tags", "hat")}
        <div className="grid2">
          <label>Seed (-1 = random)<input type="number" value={a.seed} onChange={(e) => set("seed", Math.trunc(+e.target.value))} /></label>
          <label>LoRA<select value={a.lora} onChange={(e) => set("lora", e.target.value)}>
            <option value="">None</option>{loras.map((l) => <option key={l.path} value={l.path}>{l.name}</option>)}</select></label>
          {a.lora && <label>LoRA strength <b>{a.loraStrength.toFixed(2)}</b><input type="range" min={0} max={1.5} step={0.05} value={a.loraStrength} onChange={(e) => set("loraStrength", +e.target.value)} /></label>}
        </div>
        <label className="switch-row">
          <span className={`switch${a.selfiesUnprompted ? " on" : ""}`} role="switch" aria-checked={a.selfiesUnprompted} tabIndex={0} onClick={() => set("selfiesUnprompted", !a.selfiesUnprompted)}><i /></span>
          Can send selfies unprompted (only when "Can message me first" is on)
        </label>
        <button className="link" onClick={() => setPreview((p) => !p)}>{preview ? "Hide" : "Preview"} selfie prompt ({timeSlot()})</button>
        {preview && <pre className="prompt-preview">{(() => { const p = buildSelfiePrompt({ ...c, appearance: a }, "smiling"); return `${p.prompt}\n\nNegative: ${p.negative}`; })()}</pre>}
      </>}
    </div>
  );
}
