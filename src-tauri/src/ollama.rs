use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::ipc::Channel;

const OLLAMA: &str = "http://127.0.0.1:11434";

#[derive(Clone, Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "lowercase")]
pub enum ChatEvent {
    Token(String),
    Thinking(String),
    Done(String),
    Error(String),
}

#[tauri::command]
pub async fn ollama_models() -> Result<Vec<String>, String> {
    let v: Value = reqwest::Client::new()
        .get(format!("{OLLAMA}/api/tags"))
        .timeout(Duration::from_secs(10))
        .send().await.map_err(|e| format!("Ollama not reachable: {e}"))?
        .json().await.map_err(|e| e.to_string())?;
    Ok(v["models"].as_array().into_iter().flatten()
        .filter_map(|m| m["name"].as_str().map(String::from)).collect())
}

/// Streams /api/chat as NDJSON and forwards events to the frontend over a Channel.
#[tauri::command]
pub async fn ollama_chat(model: String, messages: Value, think: bool, on_event: Channel<ChatEvent>) -> Result<(), String> {
    let _gpu = crate::imagegen::GPU.lock().await; // wait while an image is being generated
    match run_chat(&model, messages, think, &on_event).await {
        Ok(full) => { let _ = on_event.send(ChatEvent::Done(full)); }
        Err(e) => { let _ = on_event.send(ChatEvent::Error(e)); }
    }
    Ok(())
}

/// Sampling options for JSON calls. Seed / top_p only when given (autogen wants variety; background jobs stay deterministic-ish).
pub fn json_options(temperature: Option<f64>, seed: Option<i64>, top_p: Option<f64>) -> Value {
    let mut o = json!({ "temperature": temperature.unwrap_or(0.2).clamp(0.0, 1.5) });
    if let Some(s) = seed { o["seed"] = json!(s); }
    if let Some(p) = top_p { o["top_p"] = json!(p.clamp(0.05, 1.0)); }
    o
}

#[cfg(test)]
mod json_options_tests {
    #[test]
    fn options_include_seed_and_top_p_only_when_given() {
        let o = super::json_options(None, None, None);
        assert_eq!(o["temperature"], 0.2); assert!(o.get("seed").is_none()); assert!(o.get("top_p").is_none());
        let o = super::json_options(Some(0.85), Some(42), Some(0.95));
        assert_eq!(o["temperature"], 0.85); assert_eq!(o["seed"], 42); assert_eq!(o["top_p"], 0.95);
    }
}

/// Appends the exact options sent to Ollama to data/logs/ollama.log (only seeded = generation calls).
fn log_sampling(db: &crate::db::Db, model: &str, options: &Value) {
    use std::io::Write;
    let p = db.dir.join("logs").join("ollama.log");
    let _ = std::fs::create_dir_all(p.parent().unwrap_or(&p));
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let _ = writeln!(f, "[{secs}] ollama_json model={model} options={options}");
    }
}

/// Non-streaming JSON-mode call for background jobs (memory summaries, mood). Returns message content.
#[tauri::command]
pub async fn ollama_json(db: tauri::State<'_, crate::db::Db>, model: String, messages: Value, temperature: Option<f64>, seed: Option<i64>, top_p: Option<f64>) -> Result<String, String> {
    let _gpu = crate::imagegen::GPU.lock().await;
    let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(240))
        .build().map_err(|e| e.to_string())?;
    let body = json!({ "model": model, "messages": messages, "stream": false, "think": false, "format": "json",
                       "options": json_options(temperature, seed, top_p) });
    if seed.is_some() { log_sampling(&db, &model, &body["options"]); }
    let resp = client.post(format!("{OLLAMA}/api/chat")).json(&body).send().await
        .map_err(|e| format!("Could not reach Ollama: {e}"))?;
    let status = resp.status();
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(format!("Ollama returned {status}: {}", v["error"].as_str().unwrap_or(""))); }
    Ok(v["message"]["content"].as_str().unwrap_or("").to_string())
}

async fn run_chat(model: &str, messages: Value, think: bool, ch: &Channel<ChatEvent>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(180))
        .build().map_err(|e| e.to_string())?;
    let body = json!({ "model": model, "messages": messages, "stream": true, "think": think });
    let resp = client.post(format!("{OLLAMA}/api/chat")).json(&body).send().await
        .map_err(|e| format!("Could not reach Ollama: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama returned {s}: {t}"));
    }
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut full = String::new();
    let handle = |line: &[u8], full: &mut String| -> Result<bool, String> {
        let line = String::from_utf8_lossy(line);
        let line = line.trim();
        if line.is_empty() { return Ok(false); }
        let v: Value = serde_json::from_str(line).map_err(|e| format!("Bad JSON from Ollama: {e}"))?;
        if let Some(err) = v["error"].as_str() { return Err(err.to_string()); }
        if let Some(t) = v["message"]["thinking"].as_str() { if !t.is_empty() { let _ = ch.send(ChatEvent::Thinking(t.into())); } }
        if let Some(t) = v["message"]["content"].as_str() { if !t.is_empty() { full.push_str(t); let _ = ch.send(ChatEvent::Token(t.into())); } }
        Ok(v["done"].as_bool().unwrap_or(false))
    };
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream interrupted: {e}"))?;
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            if handle(&line, &mut full)? { return Ok(full); }
        }
    }
    if !buf.is_empty() { handle(&buf, &mut full)?; }
    Ok(full)
}