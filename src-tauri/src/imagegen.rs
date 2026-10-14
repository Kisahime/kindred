//! Built-in image generator: drives the stable-diffusion.cpp CLI (sd-cli.exe) as a child process.
//! One job at a time; chat calls to Ollama wait on the same GPU lock, so chat and images never collide.
use crate::db::{e, now, Db};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncReadExt;
use tokio::sync::{Mutex, Notify};

/// Held by an image job for its whole run, and briefly by every Ollama chat/JSON call.
pub static GPU: Mutex<()> = Mutex::const_new(());
static CANCEL: Notify = Notify::const_new();
static BUSY: AtomicBool = AtomicBool::new(false);
const MODEL_EXT: [&str; 4] = ["safetensors", "ckpt", "gguf", "sft"];

pub fn init_schema(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS images (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, params TEXT NOT NULL, created_at INTEGER NOT NULL);",
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageRow {
    pub id: i64, pub path: String, pub params: Value, pub created_at: i64,
    /// studio / selfie / avatar / album
    #[serde(default)] pub source: String,
    #[serde(default)] pub char_id: String,
    /// Gift item worn in the picture (name), if any.
    #[serde(default)] pub gift: String,
    /// 18+ picture: hidden when the adult switch is off.
    #[serde(default)] pub adult: bool,
    /// false = the prompt was never saved (old picture).
    #[serde(default)] pub recorded: bool,
}

const IMG_COLS: &str = "id,path,params,created_at,source,char_id,gift,adult,recorded";
fn img_row(r: &rusqlite::Row) -> rusqlite::Result<ImageRow> {
    Ok(ImageRow { id: r.get(0)?, path: r.get(1)?, params: serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or(Value::Null), created_at: r.get(3)?,
        source: r.get(4)?, char_id: r.get(5)?, gift: r.get(6)?, adult: r.get::<_, i64>(7)? != 0, recorded: r.get::<_, i64>(8)? != 0 })
}

/// Words that mark a prompt as 18+ (lingerie / boudoir); used with the explicit meta flag.
pub fn looks_adult(prompt: &str) -> bool {
    const W: &[&str] = &["lingerie", "boudoir", "bra", "bras", "knicker", "knickers", "bodysuit", "chemise", "negligee", "garter", "garters", "stockings",
        "thong", "corset", "babydoll", "camisole", "suspenders", "nsfw", "nude", "naked", "topless"];
    prompt.to_lowercase().split(|ch: char| !ch.is_alphanumeric()).any(|w| W.contains(&w))
}

/// One selfie.log line -> (prompt, gift name, gift is 18+, worn).
pub fn parse_selfie_log(line: &str) -> Option<(String, String, bool, bool)> {
    let gift = line.split(" | gift: ").nth(1)?.split(" | caption: ").next()?.trim();
    let prompt = line.split(" | prompt: ").nth(1)?.split(" | negative: ").next()?.trim();
    if gift == "none" || prompt.is_empty() { return Some((prompt.into(), String::new(), false, false)); }
    let name = gift.split(" (#").next().unwrap_or(gift).trim().to_string();
    Some((prompt.into(), name, gift.contains("18+"), gift.ends_with("WORN")))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelFile { pub path: String, pub name: String, pub kind: String, pub size_mb: u64, pub arch: String, pub note: String }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Lora { pub path: String, pub strength: f64 }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GenParams {
    pub model: String,
    /// "checkpoint" (-m, all-in-one) or "diffusion" (--diffusion-model + separate encoder/VAE).
    pub model_kind: String,
    pub text_encoder: String,
    pub vae: String,
    pub loras: Vec<Lora>,
    pub prompt: String,
    pub negative: String,
    pub steps: i64,
    pub cfg: f64,
    pub sampler: String,
    pub scheduler: String,
    pub seed: i64,
    pub width: i64,
    pub height: i64,
    pub batch: i64,
    pub clip_skip: i64,
    /// Where the picture is for: {source, characterId, gift, adult}. Saved with the image, not passed to the engine.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo { pub ok: bool, pub version: String, pub samplers: Vec<String>, pub schedulers: Vec<String>, pub clip_skip: bool, pub error: String }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress { pub phase: String, pub step: i64, pub total: i64, pub line: String }

impl Db {
    pub fn kv_get(&self, key: &str) -> Result<Option<Value>, String> {
        let c = self.conn.lock().unwrap();
        let s: Option<String> = c.query_row("SELECT value FROM kv WHERE key=?1", params![key], |r| r.get(0)).optional().map_err(e)?;
        Ok(s.and_then(|s| serde_json::from_str(&s).ok()))
    }
    pub fn kv_set(&self, key: &str, value: &Value) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("INSERT INTO kv(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, value.to_string()]).map_err(e)?;
        Ok(())
    }
    pub fn add_image(&self, path: &str, p: &Value) -> Result<ImageRow, String> {
        let c = self.conn.lock().unwrap();
        let t = now();
        let m = p.get("meta").cloned().unwrap_or(Value::Null);
        let s = |k: &str| m.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let source = Some(s("source")).filter(|x| !x.is_empty()).unwrap_or_else(|| "studio".into());
        let prompt = p.get("prompt").and_then(|v| v.as_str()).unwrap_or("");
        let adult = m.get("adult").and_then(|v| v.as_bool()).unwrap_or(false) || looks_adult(prompt);
        c.execute("INSERT INTO images(path,params,created_at,source,char_id,gift,adult,recorded) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![path, p.to_string(), t, source, s("characterId"), s("gift"), adult as i64, (!prompt.is_empty()) as i64]).map_err(e)?;
        Ok(ImageRow { id: c.last_insert_rowid(), path: path.into(), params: p.clone(), created_at: t, source, char_id: s("characterId"), gift: s("gift"), adult, recorded: !prompt.is_empty() })
    }
    #[cfg(test)]
    pub fn list_images(&self) -> Result<Vec<ImageRow>, String> { self.list_images_for(true) }
    /// Newest first; 18+ pictures only when `adult` is on. Missing files are skipped.
    pub fn list_images_for(&self, adult: bool) -> Result<Vec<ImageRow>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare(&format!("SELECT {IMG_COLS} FROM images WHERE ?1 OR adult=0 ORDER BY id DESC")).map_err(e)?;
        let all = st.query_map(params![adult], img_row).map_err(e)?.collect::<rusqlite::Result<Vec<_>>>().map_err(e)?;
        Ok(all.into_iter().filter(|i| Path::new(&i.path).exists()).collect())
    }
    /// The record for one picture file (chat photo bubbles). 18+ rows are withheld when `adult` is off.
    pub fn image_for_path(&self, path: &str, adult: bool) -> Result<Option<ImageRow>, String> {
        let c = self.conn.lock().unwrap();
        c.query_row(&format!("SELECT {IMG_COLS} FROM images WHERE path=?1 AND (?2 OR adult=0) ORDER BY id DESC LIMIT 1"), params![path, adult], img_row).optional().map_err(e)
    }
    /// Is this picture marked 18+? (so a hidden one can say so instead of "not recorded")
    pub fn image_is_adult(&self, path: &str) -> bool {
        let c = self.conn.lock().unwrap();
        c.query_row("SELECT adult FROM images WHERE path=?1 ORDER BY id DESC LIMIT 1", params![path], |r| r.get::<_, i64>(0)).map(|a| a != 0).unwrap_or(false)
    }
    /// Fills source/character/gift/18+ for pictures made before prompts were tracked (idempotent: only rows with no source).
    /// Chat/group photos and feed (album) photos without any row get one marked "prompt not recorded".
    pub fn backfill_images(&self) -> Result<usize, String> {
        let log: Vec<(String, String, bool, bool)> = std::fs::read_to_string(self.dir.join("logs").join("selfie.log")).unwrap_or_default()
            .lines().filter_map(parse_selfie_log).collect();
        let c = self.conn.lock().unwrap();
        let mut n = 0;
        let linked = [
            ("SELECT image_path, character_id, created_at FROM messages WHERE image_path IS NOT NULL AND image_path<>''", "selfie"),
            ("SELECT image_path, COALESCE(speaker_id,''), created_at FROM group_messages WHERE image_path IS NOT NULL AND image_path<>''", "selfie"),
            ("SELECT image_path, character_id, created_at FROM feed_posts WHERE image_path IS NOT NULL AND image_path<>''", "album"),
        ];
        for (sql, src) in linked {
            let rows: Vec<(String, String, i64)> = match c.prepare(sql) {
                Ok(mut st) => { let v = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(e)?.collect::<rusqlite::Result<_>>().map_err(e)?; v }
                Err(_) => continue,
            };
            for (path, ch, t) in rows {
                let has: bool = c.query_row("SELECT COUNT(*) FROM images WHERE path=?1", params![path], |r| r.get::<_, i64>(0)).map_err(e)? > 0;
                if has { n += c.execute("UPDATE images SET source=?2, char_id=?3 WHERE path=?1 AND source=''", params![path, src, ch]).map_err(e)?; }
                else { c.execute("INSERT INTO images(path,params,created_at,source,char_id,recorded) VALUES(?1,'{}',?2,?3,?4,0)", params![path, t, src, ch]).map_err(e)?; n += 1; }
            }
        }
        let rest: Vec<(i64, String)> = { let mut st = c.prepare("SELECT id, params FROM images WHERE source='' OR (recorded=1 AND gift='' AND source='selfie')").map_err(e)?;
            let v = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(e)?.collect::<rusqlite::Result<_>>().map_err(e)?; v };
        for (id, p) in rest {
            let p: Value = serde_json::from_str(&p).unwrap_or(Value::Null);
            let prompt = p.get("prompt").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let source = if prompt.contains("close-up portrait, head and shoulders") { "avatar" } else if prompt.starts_with("selfie,") || prompt.starts_with("mirror selfie") { "selfie" } else { "studio" };
            let hit = log.iter().rev().find(|l| !prompt.is_empty() && l.0 == prompt);
            let gift = hit.filter(|l| l.3).map(|l| l.1.clone()).unwrap_or_default();
            let adult = looks_adult(&prompt) || hit.map(|l| l.3 && l.2).unwrap_or(false);
            n += c.execute("UPDATE images SET source=CASE WHEN source='' THEN ?2 ELSE source END, gift=?3, adult=MAX(adult, ?4), recorded=?5 WHERE id=?1",
                params![id, source, gift, adult as i64, (!prompt.is_empty()) as i64]).map_err(e)?;
        }
        Ok(n)
    }
    /// Deletes the row and the file (only files inside data/images).
    pub fn delete_image(&self, id: i64) -> Result<(), String> {
        let path: Option<String> = { let c = self.conn.lock().unwrap();
            c.query_row("SELECT path FROM images WHERE id=?1", params![id], |r| r.get(0)).optional().map_err(e)? };
        if let Some(p) = path {
            let p = PathBuf::from(p);
            if p.starts_with(self.dir.join("images")) { let _ = std::fs::remove_file(&p); }
        }
        self.conn.lock().unwrap().execute("DELETE FROM images WHERE id=?1", params![id]).map_err(e)?;
        Ok(())
    }
    pub fn images_dir(&self) -> PathBuf { self.dir.join("images") }
    pub fn models_dir(&self) -> PathBuf { self.dir.join("models") }
    /// Default engine: <root>/engine/sd-cuda12/sd-cli.exe (root = the folder holding data\).
    pub fn default_engine(&self) -> String {
        crate::db::layout_root(&self.dir).join("engine").join("sd-cuda12").join("sd-cli.exe").display().to_string()
    }
}

pub fn ensure_dirs(dir: &Path) -> std::io::Result<()> {
    for d in ["images", "models/checkpoints", "models/diffusion_models", "models/loras", "models/vae", "models/text_encoders"] {
        std::fs::create_dir_all(dir.join(d))?;
    }
    Ok(())
}

/// Parses `sd-cli --help` so the UI only offers what this engine build accepts.
pub fn parse_help(help: &str) -> EngineInfo {
    let flat = help.split_whitespace().collect::<Vec<_>>().join(" ");
    let list = |flag: &str| -> Vec<String> {
        let start = match flat.find(&format!(" {flag} ")) { Some(i) => i, None => return vec![] };
        let rest = &flat[start..];
        let open = match rest.find("one of [") { Some(i) => i + 8, None => return vec![] };
        let close = rest[open..].find(']').map(|c| open + c).unwrap_or(open);
        rest[open..close].split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
    };
    let version = help.lines().next().unwrap_or("").trim().to_string();
    let samplers = list("--sampling-method");
    let schedulers = list("--scheduler");
    EngineInfo { ok: !samplers.is_empty(), version, clip_skip: flat.contains("--clip-skip"), samplers, schedulers,
        error: String::new() }
}

/// Reads a safetensors header and guesses the architecture.
pub fn sniff(path: &Path) -> (String, String) {
    let ext = path.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
    if ext != "safetensors" && ext != "sft" { return (if ext == "gguf" { "gguf".into() } else { "unknown".into() }, String::new()); }
    let read = || -> Option<Value> {
        use std::io::Read;
        let mut f = std::fs::File::open(path).ok()?;
        let mut n = [0u8; 8]; f.read_exact(&mut n).ok()?;
        let n = u64::from_le_bytes(n);
        if n > 200_000_000 { return None; }
        let mut buf = vec![0u8; n as usize]; f.read_exact(&mut buf).ok()?;
        serde_json::from_slice(&buf).ok()
    };
    let Some(Value::Object(h)) = read() else { return ("unknown".into(), String::new()) };
    let has = |s: &str| h.keys().any(|k| k.contains(s));
    let quant = h.iter().any(|(k, v)| k.ends_with("weight_scale") || k.ends_with("weight_scale_2") || v["dtype"] == "U8" && k.ends_with(".weight"));
    let arch = if has("lora_") || has("lora_up") || has("lora_A") { "lora" }
        else if has("conditioner.embedders.1") { "sdxl" }
        else if has("cond_stage_model.transformer") || has("cond_stage_model.model") { "sd1/2" }
        else if has("double_blocks") { "flux" }
        else if has("adaln_modulation_cross_attn") { "anima" }
        else if has("attn.gate") && has("attn.wk") { "krea2" }
        else if has("decoder.conv_in") || has("decoder.up") { "vae" }
        else if has("model.diffusion_model.input_blocks") || has("input_blocks.0") { "unet" }
        else { "unknown" };
    let note = if quant { "pre-quantised (int4/NVFP4/svdquant) weights: stable-diffusion.cpp can't load these".to_string() }
        else if arch == "anima" { "diffusion model only: pick a text encoder (qwen_3_06b) and the qwen_image VAE".into() }
        else if arch == "flux" || arch == "krea2" { "diffusion model only: needs a separate text encoder and VAE".into() }
        else { String::new() };
    (arch.into(), note)
}

fn kind_for(path: &Path, arch: &str) -> String {
    let p = path.display().to_string().to_lowercase().replace('/', "\\");
    if arch == "lora" || p.contains("\\lora") { "lora" }
    else if arch == "vae" || p.contains("\\vae") { "vae" }
    else if p.contains("text_encoder") || p.contains("\\clip") || p.contains("\\t5") || p.contains("\\llm") { "text_encoder" }
    else { "model" }.into()
}

pub fn scan(roots: &[PathBuf]) -> Vec<ModelFile> {
    fn walk(d: &Path, depth: u32, out: &mut Vec<PathBuf>) {
        if depth > 5 { return; }
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for ent in rd.flatten() {
            let p = ent.path();
            let name = ent.file_name().to_string_lossy().to_lowercase();
            if p.is_dir() { if !name.starts_with('.') && name != "adetailer" && name != "diffusers" { walk(&p, depth + 1, out); } }
            else if p.extension().and_then(|x| x.to_str()).map(|x| MODEL_EXT.contains(&x.to_lowercase().as_str())).unwrap_or(false) { out.push(p); }
        }
    }
    let mut files = vec![];
    for r in roots { walk(r, 0, &mut files); }
    files.sort(); files.dedup();
    files.into_iter().map(|p| {
        let (arch, note) = sniff(&p);
        ModelFile { kind: kind_for(&p, &arch), name: p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
            size_mb: std::fs::metadata(&p).map(|m| m.len() / 1_048_576).unwrap_or(0), path: p.display().to_string(), arch, note }
    }).collect()
}

/// Builds the sd-cli argument list. `lora_dir` holds hard links named l0, l1, ...
pub fn build_args(p: &GenParams, out_pattern: &str, lora_dir: Option<&Path>) -> Vec<String> {
    let mut a: Vec<String> = vec![];
    let mut push = |k: &str, v: String| { a.push(k.into()); a.push(v); };
    push(if p.model_kind == "diffusion" { "--diffusion-model" } else { "-m" }, p.model.clone());
    if !p.text_encoder.is_empty() { push("--llm", p.text_encoder.clone()); }
    if !p.vae.is_empty() { push("--vae", p.vae.clone()); }
    let mut prompt = p.prompt.clone();
    if let Some(d) = lora_dir {
        for (i, l) in p.loras.iter().enumerate() { prompt.push_str(&format!(" <lora:l{i}:{}>", l.strength)); }
        push("--lora-model-dir", d.display().to_string());
    }
    push("-p", prompt);
    if !p.negative.is_empty() { push("-n", p.negative.clone()); }
    push("--steps", p.steps.clamp(1, 150).to_string());
    push("--cfg-scale", format!("{}", p.cfg));
    if !p.sampler.is_empty() { push("--sampling-method", p.sampler.clone()); }
    if !p.scheduler.is_empty() { push("--scheduler", p.scheduler.clone()); }
    push("-s", p.seed.to_string());
    push("-W", (p.width.clamp(64, 2048) / 8 * 8).to_string());
    push("-H", (p.height.clamp(64, 2048) / 8 * 8).to_string());
    push("-b", p.batch.clamp(1, 8).to_string());
    if p.clip_skip > 0 { push("--clip-skip", p.clip_skip.to_string()); }
    push("-o", out_pattern.into());
    a.push("--vae-tiling".into());
    a.push("--diffusion-fa".into());
    a
}

/// Parses one console line from sd-cli into a progress update.
pub fn parse_line(line: &str) -> Option<Progress> {
    let l = line.trim();
    if l.is_empty() { return None; }
    if l.contains("s/it") || l.contains("it/s") {
        let core = l.split('|').nth(2).unwrap_or(l).trim();
        let frac = core.split_whitespace().next().unwrap_or("");
        let mut it = frac.split('/');
        if let (Some(a), Some(b)) = (it.next().and_then(|x| x.parse().ok()), it.next().and_then(|x| x.parse().ok())) {
            return Some(Progress { phase: "sampling".into(), step: a, total: b, line: String::new() });
        }
    }
    if l.contains("MB/s") || l.contains("loading") { return Some(Progress { phase: "loading".into(), step: 0, total: 0, line: String::new() }); }
    if l.contains("decoding") { return Some(Progress { phase: "decoding".into(), step: 0, total: 0, line: String::new() }); }
    if l.starts_with("[E]") || l.starts_with("[W]") { return Some(Progress { phase: "log".into(), step: 0, total: 0, line: l.into() }); }
    None
}

/// Asks Ollama to unload every resident model (keep_alive 0) so the GPU is free.
pub async fn unload_ollama() -> Vec<String> {
    let c = reqwest::Client::builder().timeout(Duration::from_secs(20)).build().unwrap_or_default();
    let ps: Value = match c.get("http://127.0.0.1:11434/api/ps").send().await { Ok(r) => r.json().await.unwrap_or(Value::Null), Err(_) => return vec![] };
    let mut done = vec![];
    for m in ps["models"].as_array().cloned().unwrap_or_default() {
        if let Some(name) = m["name"].as_str() {
            let _ = c.post("http://127.0.0.1:11434/api/generate").json(&json!({"model": name, "keep_alive": 0})).send().await;
            done.push(name.to_string());
        }
    }
    if !done.is_empty() { tokio::time::sleep(Duration::from_millis(800)).await; }
    done
}

fn engine_path(db: &Db) -> String {
    db.kv_get("image_config").ok().flatten().and_then(|v| v["enginePath"].as_str().map(String::from))
        .filter(|s| !s.trim().is_empty()).unwrap_or_else(|| db.default_engine())
}

fn hidden(cmd: &mut tokio::process::Command) {
    #[cfg(windows)] { cmd.creation_flags(0x0800_0000); }
    #[cfg(not(windows))] { let _ = cmd; }
}

#[tauri::command]
pub async fn sd_engine_info(db: State<'_, Db>) -> Result<EngineInfo, String> {
    let exe = engine_path(&db);
    if !Path::new(&exe).exists() { return Ok(EngineInfo { error: format!("Engine not found at {exe}"), ..Default::default() }); }
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.arg("--help").stdin(Stdio::null());
    hidden(&mut cmd);
    let out = cmd.output().await.map_err(|x| format!("Could not start {exe}: {x}"))?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let mut info = parse_help(&text);
    if !info.ok { info.error = "Engine ran but its --help output was not recognised".into(); }
    Ok(info)
}

#[tauri::command]
pub fn sd_default_engine(db: State<Db>) -> String { db.default_engine() }

#[tauri::command]
pub fn sd_scan_models(db: State<Db>, extra: Vec<String>) -> Vec<ModelFile> {
    let mut roots = vec![db.models_dir()];
    roots.extend(extra.into_iter().filter(|s| !s.trim().is_empty()).map(PathBuf::from));
    scan(&roots)
}

#[tauri::command]
pub fn sd_busy() -> bool { BUSY.load(Ordering::SeqCst) }

#[tauri::command]
pub fn sd_cancel() { CANCEL.notify_waiters(); }

#[tauri::command]
pub fn kv_get(db: State<Db>, key: String) -> Result<Option<Value>, String> { db.kv_get(&key) }
#[tauri::command]
pub fn kv_set(db: State<Db>, key: String, value: Value) -> Result<(), String> { db.kv_set(&key, &value) }
#[tauri::command]
pub fn list_images(db: State<Db>, include_adult: Option<bool>) -> Result<Vec<ImageRow>, String> { db.list_images_for(include_adult.unwrap_or(false)) }
#[tauri::command]
pub fn image_for_path(db: State<Db>, path: String, include_adult: Option<bool>) -> Result<Value, String> {
    let adult = include_adult.unwrap_or(false);
    Ok(match db.image_for_path(&path, adult)? { Some(r) => serde_json::to_value(r).map_err(e)?, None => json!({ "hidden": !adult && db.image_is_adult(&path) }) })
}
#[tauri::command]
pub fn delete_image(db: State<Db>, id: i64) -> Result<(), String> { db.delete_image(id) }
#[tauri::command]
pub fn open_images_folder(db: State<Db>) -> Result<(), String> {
    std::process::Command::new("explorer").arg(db.images_dir()).spawn().map(|_| ()).map_err(e)
}

/// Runs one generation job. Progress goes over `on_progress`; "gpu-status" is broadcast for the rest of the UI.
#[tauri::command]
pub async fn sd_generate(app: AppHandle, db: State<'_, Db>, params: GenParams, on_progress: Channel<Progress>) -> Result<Vec<ImageRow>, String> {
    let send = |phase: &str, line: &str| { let _ = on_progress.send(Progress { phase: phase.into(), step: 0, total: 0, line: line.into() }); };
    if params.model.is_empty() || !Path::new(&params.model).exists() { return Err("Pick a model first.".into()); }
    if crate::voice::call_active() { return Err("You're on a call: pictures will work again after you hang up.".into()); }
    crate::voice::shutdown(); // frees Whisper's VRAM; it restarts in a few seconds when next needed
    let exe = engine_path(&db);
    if !Path::new(&exe).exists() { return Err(format!("Image engine not found at {exe}. Set the engine path in Image Studio settings.")); }
    if GPU.try_lock().is_err() { send("queued", "Waiting for the chat to finish\u{2026}"); }
    let _gpu = GPU.lock().await;
    BUSY.store(true, Ordering::SeqCst);
    let _ = app.emit("gpu-status", "image");
    let result = run_job(&db, &exe, &params, &on_progress).await;
    BUSY.store(false, Ordering::SeqCst);
    let _ = app.emit("gpu-status", "idle");
    result
}

/// A concrete seed for "random" (-1) so every picture records the seed it was really made with.
pub fn concrete_seed(seed: i64) -> i64 {
    if seed >= 0 { return seed; }
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    ((n ^ (n >> 31)) % 2_147_483_000) as i64
}

async fn run_job(db: &Db, exe: &str, params: &GenParams, ch: &Channel<Progress>) -> Result<Vec<ImageRow>, String> {
    let resolved = GenParams { seed: concrete_seed(params.seed), ..params.clone() };
    let params = &resolved;
    let send = |phase: &str, line: &str| { let _ = ch.send(Progress { phase: phase.into(), step: 0, total: 0, line: line.into() }); };
    send("unloading", "Freeing the GPU (unloading chat model)\u{2026}");
    let unloaded = unload_ollama().await;
    if !unloaded.is_empty() { send("log", &format!("Unloaded {}", unloaded.join(", "))); }

    // LoRAs: hard-link the chosen files into one run folder so a single --lora-model-dir works.
    let lora_dir = db.models_dir().join(".lora-run");
    let _ = std::fs::remove_dir_all(&lora_dir);
    let use_loras = !params.loras.is_empty();
    if use_loras {
        std::fs::create_dir_all(&lora_dir).map_err(e)?;
        for (i, l) in params.loras.iter().enumerate() {
            let src = Path::new(&l.path);
            let ext = src.extension().and_then(|x| x.to_str()).unwrap_or("safetensors");
            let dst = lora_dir.join(format!("l{i}.{ext}"));
            if std::fs::hard_link(src, &dst).is_err() { std::fs::copy(src, &dst).map_err(|x| format!("LoRA {}: {x}", l.path))?; }
        }
    }
    let stamp = now();
    // place backgrounds (together3) are cached in data\images\places; everything else in data\images
    let is_place = params.meta.as_ref().and_then(|m| m.get("source")).and_then(|v| v.as_str()) == Some("place");
    let out_dir = if is_place { db.images_dir().join("places") } else { db.images_dir() };
    std::fs::create_dir_all(&out_dir).map_err(e)?;
    let prefix = format!("img_{stamp}_");
    let pattern = out_dir.join(format!("{prefix}%02d.png")).display().to_string();
    let args = build_args(params, &pattern, use_loras.then_some(lora_dir.as_path()));

    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(&args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    if let Some(d) = Path::new(exe).parent() { cmd.current_dir(d); }
    hidden(&mut cmd);
    let mut child = cmd.spawn().map_err(|x| format!("Could not start the engine: {x}"))?;
    send("loading", "Loading model\u{2026}");
    let errors = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let pump = |mut r: Box<dyn tokio::io::AsyncRead + Unpin + Send>, ch: Channel<Progress>, errs: std::sync::Arc<std::sync::Mutex<Vec<String>>>| async move {
        let mut buf = [0u8; 4096];
        let mut line = Vec::<u8>::new();
        while let Ok(n) = r.read(&mut buf).await {
            if n == 0 { break; }
            for &b in &buf[..n] {
                if b == b'\r' || b == b'\n' {
                    let s = String::from_utf8_lossy(&line).replace("\u{1b}[K", "");
                    if let Some(p) = parse_line(&s) {
                        if p.phase == "log" && s.contains("[E]") { errs.lock().unwrap().push(s.trim().to_string()); }
                        let _ = ch.send(p);
                    }
                    line.clear();
                } else { line.push(b); }
            }
        }
    };
    let out = child.stdout.take().map(|s| tokio::spawn(pump(Box::new(s), ch.clone(), errors.clone())));
    let err = child.stderr.take().map(|s| tokio::spawn(pump(Box::new(s), ch.clone(), errors.clone())));
    let status = tokio::select! {
        s = child.wait() => Some(s.map_err(e)?),
        _ = CANCEL.notified() => { let _ = child.kill().await; None }
    };
    if let Some(h) = out { let _ = h.await; }
    if let Some(h) = err { let _ = h.await; }
    let _ = std::fs::remove_dir_all(&lora_dir);
    let mut files: Vec<PathBuf> = std::fs::read_dir(&out_dir).map_err(e)?.flatten().map(|d| d.path())
        .filter(|p| p.file_name().map(|n| n.to_string_lossy().starts_with(&prefix)).unwrap_or(false)).collect();
    files.sort();
    let Some(status) = status else {
        for f in files { let _ = std::fs::remove_file(f); }
        return Err("Cancelled".into());
    };
    if !status.success() || files.is_empty() {
        let errs = errors.lock().unwrap().clone();
        let tail = errs.iter().rev().take(3).rev().cloned().collect::<Vec<_>>().join("\n");
        return Err(if tail.is_empty() { format!("The engine stopped ({status}) without saving an image.") } else { tail });
    }
    let base = serde_json::to_value(params).map_err(e)?;
    let mut rows = vec![];
    for (i, f) in files.iter().enumerate() {
        let mut p = base.clone();
        // sd-cli advances the seed by one per batch image
        if params.seed >= 0 { p["seed"] = json!(params.seed + i as i64); }
        rows.push(db.add_image(&f.display().to_string(), &p)?);
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_help_lists() {
        let help = "stable-diffusion.cpp version unknown, commit d637cfb\n  --clip-skip <int>  ignore\n  --sampling-method                        sampling method, one of [euler, euler_a,\n     dpm++2m, lcm], default: euler\n  --scheduler   denoiser sigma scheduler, one of [discrete, karras,\n   simple], alias: normal=discrete\n";
        let i = parse_help(help);
        assert!(i.ok && i.clip_skip);
        assert_eq!(i.samplers, vec!["euler", "euler_a", "dpm++2m", "lcm"]);
        assert_eq!(i.schedulers, vec!["discrete", "karras", "simple"]);
        assert!(i.version.contains("d637cfb"));
    }

    #[test]
    fn parses_progress() {
        let p = parse_line("  |====>      | 8/20 - 1.26s/it").unwrap();
        assert_eq!((p.phase.as_str(), p.step, p.total), ("sampling", 8, 20));
        assert_eq!(parse_line("  |####| 104/104 - 668.74MB/s").unwrap().phase, "loading");
        assert_eq!(parse_line("[E] bad thing").unwrap().phase, "log");
        assert!(parse_line("").is_none());
    }

    #[test]
    fn builds_args_with_loras() {
        let p = GenParams { model: "m.safetensors".into(), model_kind: "diffusion".into(), text_encoder: "te".into(), prompt: "cat".into(),
            loras: vec![Lora { path: "x".into(), strength: 0.8 }], steps: 20, cfg: 4.0, seed: 7, width: 1023, height: 1024, batch: 2, clip_skip: 2, ..Default::default() };
        let a = build_args(&p, "out_%02d.png", Some(Path::new("ld")));
        let at = |k: &str| a[a.iter().position(|x| x == k).unwrap() + 1].clone();
        assert_eq!(at("--diffusion-model"), "m.safetensors");
        assert_eq!(at("-p"), "cat <lora:l0:0.8>");
        assert_eq!(at("-W"), "1016");
        assert_eq!(at("--clip-skip"), "2");
        assert_eq!(at("--lora-model-dir"), "ld");
        assert!(!a.contains(&"--scheduler".to_string()));
    }

    #[test]
    fn kv_and_images_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().to_path_buf()).unwrap();
        db.kv_set("image_config", &json!({"enginePath": "x"})).unwrap();
        assert_eq!(db.kv_get("image_config").unwrap().unwrap()["enginePath"], "x");
        let f = db.images_dir().join("a.png");
        std::fs::write(&f, b"png").unwrap();
        let r = db.add_image(&f.display().to_string(), &json!({"seed": 1})).unwrap();
        assert_eq!(db.list_images().unwrap().len(), 1);
        db.delete_image(r.id).unwrap();
        assert!(!f.exists() && db.list_images().unwrap().is_empty());
        assert!(db.models_dir().join("loras").is_dir());
    }

    #[test]
    fn image_prompts_saved_filtered_and_backfilled() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().to_path_buf()).unwrap();
        let mk = |n: &str| { let f = db.images_dir().join(n); std::fs::write(&f, b"png").unwrap(); f.display().to_string() };
        // new pictures: meta is stored in columns; lingerie prompts are 18+ even without the flag
        let a = db.add_image(&mk("a.png"), &json!({"prompt": "a cat", "negative": "blurry", "seed": 5, "meta": {"source": "studio"}})).unwrap();
        let b = db.add_image(&mk("b.png"), &json!({"prompt": "mirror selfie, (wearing blue satin bra & knicker set:1.3)", "seed": 9,
            "meta": {"source": "selfie", "characterId": "c1", "gift": "Celestial Set", "adult": true}})).unwrap();
        assert!(!a.adult && a.recorded && a.source == "studio");
        assert!(b.adult && b.gift == "Celestial Set" && b.char_id == "c1");
        assert_eq!(db.list_images_for(false).unwrap().len(), 1, "18+ hidden when off");
        assert_eq!(db.list_images_for(true).unwrap().len(), 2);
        assert!(db.image_for_path(&b.path, false).unwrap().is_none() && db.image_is_adult(&b.path));
        assert_eq!(db.image_for_path(&b.path, true).unwrap().unwrap().params["seed"], 9);
        // old pictures: plain rows + a feed photo with no row + a selfie.log entry
        let c = db.images_dir().join("c.png"); std::fs::write(&c, b"png").unwrap();
        let old_prompt = "selfie, phone selfie, adult, 26 year old, (wearing red velvet chemise:1.3)";
        { let cn = db.conn.lock().unwrap();
          cn.execute("INSERT INTO images(path,params,created_at) VALUES(?1,?2,1)", params![c.display().to_string(), json!({"prompt": old_prompt}).to_string()]).unwrap();
          cn.execute("INSERT INTO images(path,params,created_at) VALUES(?1,'{}',1)", params![mk("d.png")]).unwrap();
          cn.execute("INSERT INTO feed_posts(character_id,content,image_path,created_at) VALUES('c2','hi',?1,1)", params![mk("e.png")]).unwrap(); }
        std::fs::create_dir_all(dir.path().join("logs")).unwrap();
        std::fs::write(dir.path().join("logs").join("selfie.log"), format!("2026 | Lily | gift: Red Chemise (#4, 18+) WORN | caption: x | prompt: {old_prompt} | negative: nsfw\n")).unwrap();
        db.backfill_images().unwrap();
        let all = db.list_images_for(true).unwrap();
        let get = |n: &str| all.iter().find(|r| r.path.ends_with(n)).unwrap().clone();
        let (c, d, e) = (get("c.png"), get("d.png"), get("e.png"));
        assert!(c.source == "selfie" && c.gift == "Red Chemise" && c.adult && c.recorded);
        assert!(d.source == "studio" && !d.recorded, "no prompt -> not recorded");
        assert!(e.source == "album" && e.char_id == "c2" && !e.recorded);
        db.backfill_images().unwrap();
        assert_eq!(db.list_images_for(true).unwrap().len(), 5, "backfill is idempotent");
    }

    #[test]
    fn image_prompt_helpers() {
        assert!(looks_adult("tasteful boudoir, (wearing lace bodysuit:1.3)") && !looks_adult("zebra print scarf, bracelet"));
        let l = parse_selfie_log("t | Lily | gift: Hoodie (#2) BLOCKED | caption: c | prompt: selfie, x | negative: n").unwrap();
        assert_eq!((l.0.as_str(), l.1.as_str(), l.2, l.3), ("selfie, x", "Hoodie", false, false));
        assert_eq!(concrete_seed(42), 42);
        let s = concrete_seed(-1); assert!((0..2_147_483_000).contains(&s));
    }

    /// Live check with the real engine: set SD_MODELS (folder with Stable-diffusion\model.safetensors, text_encoder\, VAE\) and SD_CLI, then run `cargo test live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_generate() {
        let m = std::env::var("SD_MODELS").expect("set SD_MODELS to a models folder");
        let p = GenParams { model: format!(r"{m}\Stable-diffusion\model.safetensors"), model_kind: "diffusion".into(),
            text_encoder: format!(r"{m}\text_encoder\qwen_3_06b_base.safetensors"), vae: format!(r"{m}\VAE\qwen_image_vae.safetensors"),
            prompt: "a cosy cat on a rainy windowsill, anime style".into(), steps: 12, cfg: 4.0, sampler: "euler".into(), scheduler: "simple".into(),
            seed: 5, width: 832, height: 1216, batch: 1, ..Default::default() };
        let out = std::env::temp_dir().join("sd_live_%02d.png");
        let exe = std::env::var("SD_CLI").expect("set SD_CLI to sd-cli.exe"); let exe = exe.as_str();
        let o = std::process::Command::new(exe).args(build_args(&p, &out.display().to_string(), None)).output().unwrap();
        let text = String::from_utf8_lossy(&o.stdout).to_string() + &String::from_utf8_lossy(&o.stderr);
        let steps = text.split(['\r', '\n']).filter_map(parse_line).filter(|x| x.phase == "sampling").count();
        println!("status {} sampling updates {steps}", o.status);
        assert!(o.status.success() && steps > 0, "{}", &text[text.len().saturating_sub(1500)..]);
        assert!(std::env::temp_dir().join("sd_live_00.png").exists());
    }

    /// End-to-end through the app's job path (Ollama unload + engine + DB row). Set SD_PROMPT; run with --ignored.
    #[test]
    #[ignore]
    fn live_selfie_job() {
        tauri::async_runtime::block_on(async {
            let c = reqwest::Client::new();
            let _ = c.post("http://127.0.0.1:11434/api/generate").json(&json!({"model": crate::db::DEFAULT_MODEL, "prompt": "hi", "stream": false, "keep_alive": "5m", "options": {"num_predict": 1}})).send().await;
            let ps = |c: reqwest::Client| async move { c.get("http://127.0.0.1:11434/api/ps").send().await.unwrap().json::<Value>().await.unwrap()["models"].as_array().map(|a| a.len()).unwrap_or(0) };
            let before = ps(c.clone()).await;
            let dir = tempfile::tempdir().unwrap();
            let db = Db::open(dir.path().to_path_buf()).unwrap();
            let m = std::env::var("SD_MODELS").expect("set SD_MODELS to a models folder");
            let p = GenParams { model: format!(r"{m}\Stable-diffusion\model.safetensors"), model_kind: "diffusion".into(),
                text_encoder: format!(r"{m}\text_encoder\qwen_3_06b_base.safetensors"), vae: format!(r"{m}\VAE\qwen_image_vae.safetensors"),
                prompt: std::env::var("SD_PROMPT").unwrap_or_else(|_| "selfie, adult woman".into()), negative: std::env::var("SD_NEG").unwrap_or_default(),
                steps: 20, cfg: 4.0, sampler: "euler".into(), scheduler: "simple".into(), seed: -1, width: 832, height: 1216, batch: 1, ..Default::default() };
            let n = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let n2 = n.clone();
            let ch: Channel<Progress> = Channel::new(move |_| { n2.fetch_add(1, Ordering::SeqCst); Ok(()) });
            let t = std::time::Instant::now();
            let rows = run_job(&db, &std::env::var("SD_CLI").expect("set SD_CLI"), &p, &ch).await.unwrap();
            let after = ps(c.clone()).await;
            println!("ollama models before {before}, after unload {after}; {} progress events; {:.1}s; {}", n.load(Ordering::SeqCst), t.elapsed().as_secs_f32(), rows[0].path);
            assert!(before > 0 && after == 0);
            assert!(Path::new(&rows[0].path).exists() && db.list_images().unwrap().len() == 1);
            if let Ok(keep) = std::env::var("SD_KEEP") { std::fs::copy(&rows[0].path, keep).unwrap(); }
        });
    }

    #[test]
    fn appearance_and_message_images_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().to_path_buf()).unwrap();
        let mut c = db.list_characters().unwrap().remove(0);
        assert!(c.appearance.is_object());
        c.appearance = json!({"age": 30, "outfitNight": "pyjamas"});
        let s = db.save_character(c.clone()).unwrap();
        assert_eq!(s.appearance["outfitNight"], "pyjamas");
        let out = dir.path().join("c.json");
        db.export_character(&s.id, out.to_str().unwrap()).unwrap();
        let imp = db.import_character(out.to_str().unwrap()).unwrap();
        assert_eq!(imp.appearance["age"], 30);
        let m = db.add_message(&s.id, "assistant", "[selfie] waving", false).unwrap();
        db.set_message_image(m.id, Some("x.png")).unwrap();
        assert_eq!(db.list_messages(&s.id).unwrap().iter().find(|x| x.id == m.id).unwrap().image_path.as_deref(), Some("x.png"));
        let t = db.save_template("T", serde_json::to_value(&s).unwrap()).unwrap();
        assert_eq!(t.data["appearance"]["outfitNight"], "pyjamas");
    }

    #[test]
    fn scans_and_sniffs() {
        let dir = tempfile::tempdir().unwrap();
        let lora = dir.path().join("Lora");
        std::fs::create_dir_all(&lora).unwrap();
        let hdr = br#"{"lora_unet_x.lora_up.weight":{"dtype":"F16","shape":[1],"data_offsets":[0,2]}}"#;
        let mut bytes = (hdr.len() as u64).to_le_bytes().to_vec(); bytes.extend_from_slice(hdr); bytes.extend_from_slice(&[0, 0]);
        std::fs::write(lora.join("style.safetensors"), &bytes).unwrap();
        std::fs::write(dir.path().join("notes.txt"), b"x").unwrap();
        let m = scan(&[dir.path().to_path_buf()]);
        assert_eq!(m.len(), 1);
        assert_eq!((m[0].kind.as_str(), m[0].arch.as_str(), m[0].name.as_str()), ("lora", "lora", "style"));
    }
}