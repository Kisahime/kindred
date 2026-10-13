import { useEffect, useMemo, useRef, useState } from "react";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { Avatar } from "./Avatar";
import { Character } from "./types";
import {
  DEFAULT_PARAMS, EngineInfo, generateImage, GenParams, ImageConfig, imageApi, ImageRow, ModelFile, needsComponents,
  PRESET_KEYS, Progress, reuseParams, SIZE_PRESETS, tagged,
} from "./imagegen";
import { ImageDetails } from "./ImageDetails";

const FORGE: string = ""; // optional: a local Forge/A1111 models folder to offer as a one-click extra folder
const pick = (p: GenParams) => Object.fromEntries(PRESET_KEYS.map((k) => [k, p[k]])) as Partial<GenParams>;

function Thumb({ path, onClick, sel }: { path: string; onClick?: () => void; sel?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let live = true; api.avatarDataUrl(path).then((u) => live && setSrc(u)).catch(() => {}); return () => { live = false; }; }, [path]);
  return <div className={`thumb${sel ? " sel" : ""}`} onClick={onClick}>{src ? <img src={src} alt="" /> : "\u2026"}</div>;
}

const FILTERS: [string, string][] = [["", "All"], ["studio", "Studio"], ["selfie", "Selfies"], ["avatar", "Avatars"], ["album", "Album"]];

export function ImageStudio({ chars, onCharUpdated, onBanner, adult, load }: { chars: Character[]; onCharUpdated: (c: Character) => void; onBanner: (s: string) => void; adult: boolean; load?: { p: GenParams; n: number } | null }) {
  const [filter, setFilter] = useState("");
  const [cfg, setCfg] = useState<ImageConfig | null>(null);
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [files, setFiles] = useState<ModelFile[]>([]);
  const [p, setP] = useState<GenParams>(DEFAULT_PARAMS);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [sel, setSel] = useState<ImageRow | null>(null);
  const [prog, setProg] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [avatarFor, setAvatarFor] = useState("");
  const [defEngine, setDefEngine] = useState("");
  const started = useRef(0);

  const models = files.filter((f) => f.kind === "model");
  const loras = files.filter((f) => f.kind === "lora");
  const vaes = files.filter((f) => f.kind === "vae");
  const encoders = files.filter((f) => f.kind === "text_encoder");
  const current = files.find((f) => f.path === p.model);

  const reload = async (c: ImageConfig) => {
    imageApi.engineInfo().then(setInfo).catch((e) => setInfo({ ok: false, version: "", samplers: [], schedulers: [], clipSkip: false, error: String(e) }));
    setFiles(await imageApi.scan(c.extraFolders).catch(() => []));
  };
  useEffect(() => {
    imageApi.defaultEngine().then(setDefEngine).catch(() => {});
    imageApi.getConfig().then((c) => { setCfg(c); if (c.last && !load) setP({ ...DEFAULT_PARAMS, ...c.last }); reload(c); });
    imageApi.busy().then((b) => b && setProg({ phase: "sampling", step: 0, total: 0, line: "Another image is in progress\u2026" }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // History: 18+ pictures and their prompts only while the adult switch is on.
  useEffect(() => { imageApi.listImages(adult).then((im) => { setImages(im); setSel((s) => s && im.find((x) => x.id === s.id) ? s : null); }).catch(() => {}); }, [adult]);
  // "Reuse" from a chat photo's prompt panel.
  useEffect(() => { if (load) setP(load.p); }, [load]);

  const saveCfg = (c: ImageConfig) => { setCfg(c); imageApi.saveConfig(c).catch((e) => onBanner(String(e))); };
  const set = (x: Partial<GenParams>) => setP((o) => ({ ...o, ...x }));

  /** Picking a model loads its preset, or sensible defaults for its architecture. */
  const chooseModel = (path: string) => {
    const f = files.find((m) => m.path === path);
    const preset = cfg?.presets[path];
    if (preset) { set({ model: path, ...preset }); return; }
    const arch = f?.arch ?? "";
    const comp = needsComponents(arch);
    const te = comp ? (encoders.find((e) => /qwen_?3_?0?6b/i.test(e.name) && arch === "anima") ?? encoders[0])?.path ?? "" : "";
    const vae = comp ? (vaes.find((v) => arch === "anima" && /qwen_image|wan/i.test(v.name)) ?? vaes[0])?.path ?? "" : "";
    const sd15 = arch === "sd1/2";
    set({ model: path, modelKind: comp ? "diffusion" : "checkpoint", textEncoder: te, vae, cfg: arch === "anima" ? 4 : arch === "flux" ? 1 : 6,
      width: sd15 ? 512 : 1024, height: sd15 ? 512 : 1024, clipSkip: 0 });
  };
  const savePreset = () => {
    if (!cfg || !p.model) return;
    saveCfg({ ...cfg, presets: { ...cfg.presets, [p.model]: pick(p) } });
    onBanner(`Saved settings as the preset for ${current?.name ?? "this model"}.`);
  };

  const generate = async () => {
    if (!cfg || running) return;
    if (!p.prompt.trim()) { onBanner("Write a prompt first."); return; }
    saveCfg({ ...cfg, last: p });
    setRunning(true); setLog([]); started.current = Date.now();
    setProg({ phase: "queued", step: 0, total: 0, line: "Starting\u2026" });
    try {
      const rows = await generateImage(tagged(p, { source: "studio" }), (e) => {
        if (e.phase === "log") { if (e.line) setLog((l) => [...l.slice(-5), e.line]); return; }
        setProg(e);
      });
      const shown = rows.filter((r) => adult || !r.adult);
      setImages((im) => [...[...shown].reverse(), ...im]);
      if (shown.length < rows.length) onBanner("The new picture looks 18+, so it's hidden from the gallery while the adult switch is off.");
      setSel(shown[shown.length - 1] ?? null);
    } catch (e) {
      const msg = String(e);
      if (msg !== "Cancelled") onBanner(`Image failed: ${msg}`);
    } finally { setRunning(false); setProg(null); }
  };

  const reuse = (r: ImageRow, newSeed = false) => { setP(reuseParams(r, newSeed)); onBanner(newSeed ? "Settings loaded with a new random seed." : "Settings loaded into the form (same seed)."); };
  const charName = (id: string) => chars.find((c) => c.id === id)?.name;
  const remove = async (r: ImageRow) => {
    if (!(await ask("Delete this image from the gallery and disk?", { title: "Delete image", kind: "warning", okLabel: "Delete", cancelLabel: "Keep" }))) return;
    await imageApi.deleteImage(r.id).catch((e) => onBanner(String(e)));
    setImages((im) => im.filter((x) => x.id !== r.id)); if (sel?.id === r.id) setSel(null);
  };
  const setAvatar = async (r: ImageRow) => {
    const c = chars.find((x) => x.id === avatarFor);
    if (!c) return;
    try {
      const path = await api.importAvatar(r.path);
      const saved = await api.saveCharacter({ ...c, avatarPath: path });
      onCharUpdated(saved); onBanner(`${c.name} now uses this picture as their avatar.`);
    } catch (e) { onBanner(String(e)); }
  };
  const addFolder = async (dir?: string) => {
    if (!cfg) return;
    const d = dir ?? await openDialog({ directory: true, multiple: false });
    if (typeof d !== "string" || cfg.extraFolders.includes(d)) return;
    const c = { ...cfg, extraFolders: [...cfg.extraFolders, d] }; saveCfg(c); reload(c);
  };

  const pct = prog?.phase === "sampling" && prog.total ? Math.round(100 * prog.step / prog.total) : null;
  const phaseLabel = useMemo(() => !prog ? "" : prog.phase === "sampling" ? `Drawing\u2026 step ${prog.step}/${prog.total}`
    : prog.phase === "unloading" ? "Freeing the GPU (unloading the chat model)\u2026" : prog.phase === "loading" ? "Loading model\u2026"
    : prog.phase === "decoding" ? "Finishing the picture\u2026" : prog.line || "Waiting\u2026", [prog]);
  const engineOk = info?.ok;

  if (!cfg) return <div className="empty"><p>Loading Image Studio{"\u2026"}</p></div>;
  return (
    <>
      <header className="chat-head">
        <Avatar big emoji={"\u{1F3A8}"} color="#ffd6a5" />
        <div className="ch-info">
          <div className="ch-name">Image Studio <span className="ch-status">{engineOk ? `(${info!.version.replace("stable-diffusion.cpp ", "")})` : "(engine not ready)"}</span></div>
          <div className="ch-pm">Make pictures on your own GPU. Chat replies wait while an image is drawing.</div>
          <div className="ch-actions">
            <button className="link" onClick={() => imageApi.openFolder()}>Open images folder</button>
            <button className="link" onClick={() => reload(cfg)}>Rescan models</button>
            <button className="link" onClick={() => setShowSettings((s) => !s)}>{showSettings ? "Hide" : "Engine & folders"}</button>
          </div>
        </div>
      </header>
      <div className="studio">
        <div className="studio-form">
          {(showSettings || !engineOk) && <div className="studio-box">
            <label>Engine (sd-cli.exe)<input value={cfg.enginePath} placeholder={defEngine} onChange={(e) => setCfg({ ...cfg, enginePath: e.target.value })}
              onBlur={() => { saveCfg(cfg); reload(cfg); }} /></label>
            {info && !info.ok && <div className="ed-error">{info.error}</div>}
            <div className="opt-row">Model folders</div>
            <small>Always scanned: your data\models folder (checkpoints, diffusion_models, loras, vae, text_encoders).</small>
            {cfg.extraFolders.map((f) => <div key={f} className="folder-row"><span>{f}</span><button className="x" onClick={() => { const c = { ...cfg, extraFolders: cfg.extraFolders.filter((x) => x !== f) }; saveCfg(c); reload(c); }}>{"\u2715"}</button></div>)}
            <div className="row-btns"><button onClick={() => addFolder()}>Add folder{"\u2026"}</button>
              {FORGE && !cfg.extraFolders.includes(FORGE) && <button onClick={() => addFolder(FORGE)}>Use my Forge models</button>}</div>
          </div>}
          <label>Prompt<textarea rows={4} value={p.prompt} onChange={(e) => set({ prompt: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) generate(); }} placeholder="a cosy cat on a rainy windowsill, soft light" /></label>
          <label>Negative prompt<textarea rows={2} value={p.negative} onChange={(e) => set({ negative: e.target.value })} placeholder="blurry, lowres, watermark" /></label>
          <label>Model<select value={p.model} onChange={(e) => chooseModel(e.target.value)}>
            <option value="">{models.length ? "Choose a model\u2026" : "No models found: add a folder"}</option>
            {models.map((m) => <option key={m.path} value={m.path}>{m.name} ({m.arch}, {(m.sizeMb / 1024).toFixed(1)} GB){cfg.presets[m.path] ? " \u2605" : ""}</option>)}
          </select></label>
          {current?.note && <small className="warn-note">{current.note}</small>}
          <div className="grid2">
            <label>Load as<select value={p.modelKind} onChange={(e) => set({ modelKind: e.target.value as GenParams["modelKind"] })}>
              <option value="checkpoint">All-in-one checkpoint</option><option value="diffusion">Diffusion model + parts</option></select></label>
            <label>VAE<select value={p.vae} onChange={(e) => set({ vae: e.target.value })}>
              <option value="">{p.modelKind === "checkpoint" ? "Built into model" : "None"}</option>
              {vaes.map((v) => <option key={v.path} value={v.path}>{v.name}</option>)}</select></label>
          </div>
          {p.modelKind === "diffusion" && <label>Text encoder<select value={p.textEncoder} onChange={(e) => set({ textEncoder: e.target.value })}>
            <option value="">None</option>{encoders.map((v) => <option key={v.path} value={v.path}>{v.name} ({(v.sizeMb / 1024).toFixed(1)} GB)</option>)}</select></label>}
          <div className="opt-row">LoRAs <select value="" onChange={(e) => e.target.value && set({ loras: [...p.loras, { path: e.target.value, strength: 0.8 }] })}>
            <option value="">{loras.length ? "+ add LoRA" : "none found"}</option>{loras.filter((l) => !p.loras.some((x) => x.path === l.path)).map((l) => <option key={l.path} value={l.path}>{l.name}</option>)}</select></div>
          {p.loras.map((l, i) => <div key={l.path} className="lora-row"><span>{files.find((f) => f.path === l.path)?.name ?? l.path}</span>
            <input type="range" min={-1} max={2} step={0.05} value={l.strength} onChange={(e) => set({ loras: p.loras.map((x, j) => j === i ? { ...x, strength: +e.target.value } : x) })} />
            <b>{l.strength.toFixed(2)}</b><button className="x" onClick={() => set({ loras: p.loras.filter((_, j) => j !== i) })}>{"\u2715"}</button></div>)}
          <div className="grid2">
            <label>Sampler<select value={p.sampler} onChange={(e) => set({ sampler: e.target.value })}>
              <option value="">Model default</option>{info?.samplers.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Scheduler<select value={p.scheduler} onChange={(e) => set({ scheduler: e.target.value })}>
              <option value="">Model default</option>{info?.schedulers.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Steps <b>{p.steps}</b><input type="range" min={1} max={80} value={p.steps} onChange={(e) => set({ steps: +e.target.value })} /></label>
            <label>CFG <b>{p.cfg}</b><input type="range" min={1} max={15} step={0.5} value={p.cfg} onChange={(e) => set({ cfg: +e.target.value })} /></label>
          </div>
          <label>Size<select value={`${p.width}x${p.height}`} onChange={(e) => { const [w, h] = e.target.value.split("x").map(Number); set({ width: w, height: h }); }}>
            {!SIZE_PRESETS.some(([w, h]) => w === p.width && h === p.height) && <option value={`${p.width}x${p.height}`}>{p.width} {"\u00D7"} {p.height}</option>}
            {SIZE_PRESETS.map(([w, h, l]) => <option key={l} value={`${w}x${h}`}>{l}</option>)}</select></label>
          <div className="grid2">
            <label>Seed<span className="seed"><input type="number" value={p.seed} onChange={(e) => set({ seed: Math.trunc(+e.target.value) })} />
              <button title="Random each time" onClick={() => set({ seed: -1 })}>{"\u{1F3B2}"}</button></span></label>
            <label>Batch<input type="number" min={1} max={8} value={p.batch} onChange={(e) => set({ batch: Math.max(1, Math.min(8, +e.target.value || 1)) })} /></label>
            {info?.clipSkip && <label>Clip skip<select value={p.clipSkip} onChange={(e) => set({ clipSkip: +e.target.value })}>
              <option value={0}>Model default</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>}
          </div>
          <div className="row-btns">
            {running ? <button className="stop" onClick={() => imageApi.cancel()}>Cancel</button>
              : <button className="primary" disabled={!engineOk || !p.model} onClick={generate}>{"\u{1F3A8}"} Generate</button>}
            <button disabled={!p.model} onClick={savePreset} title="Remember these settings whenever this model is picked">Save as model preset</button>
          </div>
        </div>
        <div className="studio-view">
          {prog && <div className="studio-progress"><div>{phaseLabel}</div><div className="bar"><i style={{ width: `${pct ?? (prog.phase === "decoding" ? 100 : 5)}%` }} /></div></div>}
          {log.length > 0 && <pre className="studio-log">{log.join("\n")}</pre>}
          {sel ? <div className="studio-big">
            <Thumb path={sel.path} />
            <div className="studio-meta">
              <ImageDetails row={sel} charName={charName(sel.charId)} onReuse={() => reuse(sel)} onReuseNewSeed={() => reuse(sel, true)} />
              <div className="row-btns">
                <button onClick={() => remove(sel)}>Delete</button>
                <select value={avatarFor} onChange={(e) => setAvatarFor(e.target.value)}><option value="">Set as avatar for{"\u2026"}</option>
                  {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <button disabled={!avatarFor} onClick={() => setAvatar(sel)}>Set avatar</button>
              </div>
            </div>
          </div> : !prog && <div className="empty"><div className="empty-logo">{"\u{1F5BC}\uFE0F"}</div><p>Your pictures will appear here.</p></div>}
          <div className="gallery-filters">History: {FILTERS.map(([k, l]) => <button key={k} className={filter === k ? "sel" : ""} onClick={() => setFilter(k)}>{l} ({images.filter((r) => !k || r.source === k).length})</button>)}
            {!adult && <small> 18+ pictures hidden (adult switch off)</small>}</div>
          <div className="gallery">{images.filter((r) => !filter || r.source === filter).map((r) => <Thumb key={r.id} path={r.path} sel={sel?.id === r.id} onClick={() => setSel(r)} />)}</div>
        </div>
      </div>
    </>
  );
}