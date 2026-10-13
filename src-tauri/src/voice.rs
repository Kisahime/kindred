//! Local voice helper (Kokoro TTS + faster-whisper STT) in engine/voice, run as a localhost-only Python process.
use crate::db::Db;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;

pub const PORT: u16 = 8765;
static CHILD: Mutex<Option<Child>> = Mutex::new(None);
/// True while a phone call is open: image generation waits (GPU stays free for Whisper + Ollama).
pub static CALL_ACTIVE: AtomicBool = AtomicBool::new(false);

fn url(p: &str) -> String { format!("http://127.0.0.1:{PORT}{p}") }
pub fn voice_dir(db: &Db) -> PathBuf { crate::db::layout_root(&db.dir).join("engine").join("voice") }
fn python(dir: &std::path::Path) -> PathBuf { dir.join("venv").join("Scripts").join("python.exe") }
pub fn log_path(db: &Db) -> PathBuf { db.dir.join("logs").join("voice.log") }
/// Appends one timestamped line to data/logs/voice.log (shared with the helper's own output).
pub fn log_line(db: &Db, msg: &str) {
    use std::io::Write;
    let p = log_path(db);
    let _ = std::fs::create_dir_all(p.parent().unwrap_or(&p));
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let _ = writeln!(f, "[app {}] {msg}", chrono_like_now());
    }
}
fn chrono_like_now() -> String {
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("{:02}:{:02}:{:02} UTC", (s / 3600) % 24, (s / 60) % 60, s % 60)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInfo { installed: bool, running: bool, dir: String, health: Value }

async fn health() -> Option<Value> {
    let c = reqwest::Client::builder().timeout(Duration::from_secs(3)).build().ok()?;
    c.get(url("/health")).send().await.ok()?.json().await.ok()
}

#[tauri::command]
pub async fn voice_info(db: State<'_, Db>) -> Result<VoiceInfo, String> {
    let dir = voice_dir(&db);
    let h = health().await;
    Ok(VoiceInfo { installed: python(&dir).exists() && dir.join("server.py").exists(), running: h.is_some(), dir: dir.display().to_string(), health: h.unwrap_or(Value::Null) })
}

/// Starts the helper if needed and waits until both models are loaded (first start can take ~30-60 s).
#[tauri::command]
pub async fn voice_start(db: State<'_, Db>) -> Result<Value, String> {
    if let Some(h) = health().await { if h["ready"] == true { return Ok(h); } }
    let dir = voice_dir(&db);
    let py = python(&dir);
    if !py.exists() { let m = format!("Voice engine not installed ({} missing)", py.display()); log_line(&db, &m); return Err(m); }
    {
        let mut g = CHILD.lock().unwrap();
        let alive = g.as_mut().map(|c| matches!(c.try_wait(), Ok(None))).unwrap_or(false);
        if !alive {
            let mut cmd = Command::new(&py);
            cmd.arg("-u").arg(dir.join("server.py")).current_dir(&dir).env("VOICE_PORT", PORT.to_string()).env("PYTHONIOENCODING", "utf-8");
            log_line(&db, &format!("starting {} -u {}", py.display(), dir.join("server.py").display()));
            #[cfg(windows)] { use std::os::windows::process::CommandExt; cmd.creation_flags(0x0800_0000); }
            let lp = log_path(&db);
            let _ = std::fs::create_dir_all(lp.parent().unwrap_or(&lp));
            let log = std::fs::OpenOptions::new().create(true).append(true).open(&lp).map_err(|e| e.to_string())?;
            cmd.stdout(log.try_clone().map_err(|e| e.to_string())?).stderr(log);
            match cmd.spawn() {
                Ok(c) => *g = Some(c),
                Err(e) => { let m = format!("Could not start the voice engine: {e}"); log_line(&db, &m); return Err(m); }
            }
        }
    }
    for _ in 0..120 {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        if let Some(h) = health().await {
            if h["ready"] == true { log_line(&db, &format!("ready: whisper on {}", h["device"])); return Ok(h); }
            if !h["error"].is_null() && h["tts"] != true && h["stt"] != true { let m = format!("Voice engine failed: {}", h["error"]); log_line(&db, &m); return Err(m); }
        }
        let dead = CHILD.lock().unwrap().as_mut().map(|c| !matches!(c.try_wait(), Ok(None))).unwrap_or(true);
        if dead { let m = format!("Voice engine exited unexpectedly, see {}", log_path(&db).display()); log_line(&db, &m); return Err(m); }
    }
    log_line(&db, "timed out waiting for the voice engine");
    Err(format!("Voice engine took too long to load, see {}", log_path(&db).display()))
}

pub fn shutdown() {
    if let Some(mut c) = CHILD.lock().unwrap().take() { let _ = c.kill(); let _ = c.wait(); }
}
#[tauri::command]
pub fn voice_stop() { shutdown(); }

/// WAV bytes (24 kHz mono) for `text`.
#[tauri::command]
pub async fn voice_tts(text: String, voice: String, speed: f64) -> Result<tauri::ipc::Response, String> {
    let c = reqwest::Client::builder().timeout(Duration::from_secs(60)).build().map_err(|e| e.to_string())?;
    let r = c.post(url("/tts")).json(&json!({ "text": text, "voice": voice, "speed": speed.clamp(0.5, 2.0) })).send().await
        .map_err(|e| format!("Voice engine not reachable: {e}"))?;
    if !r.status().is_success() { return Err(r.text().await.unwrap_or_default()); }
    Ok(tauri::ipc::Response::new(r.bytes().await.map_err(|e| e.to_string())?.to_vec()))
}

/// Transcribes a WAV sent as the raw request body.
#[tauri::command]
pub async fn voice_stt(request: tauri::ipc::Request<'_>) -> Result<Value, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw WAV bytes".into()) };
    let c = reqwest::Client::builder().timeout(Duration::from_secs(60)).build().map_err(|e| e.to_string())?;
    let r = c.post(url("/stt")).header("Content-Type", "audio/wav").body(bytes.clone()).send().await
        .map_err(|e| format!("Voice engine not reachable: {e}"))?;
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    if let Some(e) = v.get("error") { return Err(e.to_string()); }
    Ok(v)
}

#[tauri::command]
pub fn set_call_active(active: bool) { CALL_ACTIVE.store(active, Ordering::SeqCst); }
pub fn call_active() -> bool { CALL_ACTIVE.load(Ordering::SeqCst) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_and_flag() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("data")).unwrap();
        assert!(voice_dir(&db).ends_with("engine\\voice") || voice_dir(&db).ends_with("engine/voice"));
        set_call_active(true); assert!(call_active()); set_call_active(false); assert!(!call_active());
    }
    /// Needs the real engine: cargo test -- --ignored live_voice
    #[tokio::test]
    #[ignore]
    async fn live_voice() {
        let h = health().await.expect("start engine/voice/server.py first");
        assert_eq!(h["ready"], true);
    }
}