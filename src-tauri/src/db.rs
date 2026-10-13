use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_MODEL: &str = "qwen3:8b";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Character {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub avatar: String,
    #[serde(default)]
    pub avatar_path: Option<String>,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub personal_message: String,
    #[serde(default)]
    pub personality: String,
    #[serde(default)]
    pub backstory: String,
    #[serde(default)]
    pub speaking_style: String,
    #[serde(default)]
    pub greeting: String,
    #[serde(default)]
    pub example_messages: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default)]
    pub proactive_enabled: bool,
    #[serde(default = "default_freq")]
    pub proactive_frequency: String,
    #[serde(default = "default_mood")]
    pub baseline_mood: String,
    #[serde(default = "default_mood")]
    pub mood: String,
    #[serde(default = "default_closeness")]
    pub closeness: i64,
    #[serde(default)]
    pub mood_updated_at: i64,
    #[serde(default)]
    pub summarized_upto: i64,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
    /// Looks + image settings (JSON object, owned by the frontend). Used for selfies.
    #[serde(default = "empty_obj")]
    pub appearance: Value,
    /// Relationship, schedule, nickname etc. (JSON object, owned by the frontend).
    #[serde(default = "empty_obj")]
    pub life: Value,
}
fn empty_obj() -> Value { Value::Object(Default::default()) }
fn default_color() -> String { "#9fd0f2".into() }
fn default_status() -> String { "online".into() }
fn default_model() -> String { DEFAULT_MODEL.into() }
fn default_freq() -> String { "sometimes".into() }
fn default_mood() -> String { "cosy".into() }
fn default_closeness() -> i64 { 30 }
pub const MOODS: &[&str] = &["happy", "cosy", "playful", "sad", "annoyed", "sleepy", "excited"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: i64,
    pub character_id: String,
    pub content: String,
    pub created_at: i64,
    pub pinned: bool,
    /// "" = learned in the 1:1 chat, otherwise the group chat name.
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: i64,
    pub character_id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
    pub is_error: bool,
    pub is_unread: bool,
    pub is_proactive: bool,
    /// On a character message: the user's reaction. On a user message: the character's reaction.
    pub reaction: String,
    /// All generated versions of this reply; `content` is the chosen one (alternates[alt_index]).
    pub alternates: Vec<String>,
    pub alt_index: i64,
    /// Picture attached to this message (selfies), absolute path in data/images.
    #[serde(default)]
    pub image_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub user_name: String,
    pub status: String,
    pub personal_message: String,
    /// "HH:MM"; quiet when the local time is inside [start, end) (may wrap midnight). Equal = no quiet hours.
    #[serde(default = "default_qs")]
    pub quiet_start: String,
    #[serde(default = "default_qe")]
    pub quiet_end: String,
    #[serde(default = "default_true")]
    pub sound: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_volume")]
    pub volume: i64,
    /// Comma-separated sound events that are switched off.
    #[serde(default)]
    pub muted_sounds: String,
    #[serde(default = "default_true")]
    pub emoticons: bool,
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    #[serde(default)]
    pub tray_hint_shown: bool,
}
fn default_theme() -> String { "aero".into() }
fn default_volume() -> i64 { 70 }
fn default_qs() -> String { "23:00".into() }
fn default_qe() -> String { "08:00".into() }
fn default_true() -> bool { true }

pub struct Db {
    pub(crate) conn: Mutex<Connection>,
    pub dir: PathBuf,
}

/// Developer working folder (only used when it already exists on this PC; release builds leave it empty).
pub const LEGACY_WORK_DIR: &str = "";
/// KINDRED_DATA overrides; then an existing developer working folder; otherwise <app data>\data.
pub fn default_data_dir(app_data: Option<PathBuf>) -> PathBuf {
    if let Ok(p) = std::env::var("KINDRED_DATA") { if !p.trim().is_empty() { return PathBuf::from(p); } }
    if !LEGACY_WORK_DIR.is_empty() && Path::new(LEGACY_WORK_DIR).is_dir() { return Path::new(LEGACY_WORK_DIR).join("data"); }
    app_data.map(|a| a.join("data")).unwrap_or_else(|| PathBuf::from("data"))
}
/// Folder that holds data\, engine\ and backups-data\: the parent when the data folder is called "data", else the data folder itself.
pub fn layout_root(data: &Path) -> PathBuf {
    match (data.file_name().and_then(|n| n.to_str()), data.parent()) {
        (Some(n), Some(p)) if n.eq_ignore_ascii_case("data") && !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => data.to_path_buf(),
    }
}

pub(crate) fn now() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0) }
pub(crate) fn new_id() -> String {
    let n = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("c{:x}", n)
}
pub(crate) fn e<E: std::fmt::Display>(err: E) -> String { err.to_string() }

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '', avatar_path TEXT,
  color TEXT NOT NULL DEFAULT '#9fd0f2', status TEXT NOT NULL DEFAULT 'online',
  personal_message TEXT NOT NULL DEFAULT '', personality TEXT NOT NULL DEFAULT '',
  backstory TEXT NOT NULL DEFAULT '', speaking_style TEXT NOT NULL DEFAULT '',
  greeting TEXT NOT NULL DEFAULT '', example_messages TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, is_error INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_char ON messages(character_id, id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  content TEXT NOT NULL, created_at INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memories_char ON memories(character_id, id);
"#;

/// Additive migrations: (table, column, definition). Existing rows get the defaults.
const MIGRATIONS: &[(&str, &str, &str)] = &[
    ("characters", "appearance", "TEXT NOT NULL DEFAULT '{}'"),
    ("characters", "life", "TEXT NOT NULL DEFAULT '{}'"),
    ("messages", "image_path", "TEXT"),
    ("group_messages", "image_path", "TEXT"),
    ("characters", "proactive_enabled", "INTEGER NOT NULL DEFAULT 0"),
    ("characters", "proactive_frequency", "TEXT NOT NULL DEFAULT 'sometimes'"),
    ("messages", "is_unread", "INTEGER NOT NULL DEFAULT 0"),
    ("messages", "is_proactive", "INTEGER NOT NULL DEFAULT 0"),
    ("characters", "baseline_mood", "TEXT NOT NULL DEFAULT 'cosy'"),
    ("characters", "mood", "TEXT NOT NULL DEFAULT 'cosy'"),
    ("characters", "closeness", "INTEGER NOT NULL DEFAULT 30"),
    ("characters", "mood_updated_at", "INTEGER NOT NULL DEFAULT 0"),
    ("characters", "summarized_upto", "INTEGER NOT NULL DEFAULT 0"),
    ("memories", "source", "TEXT NOT NULL DEFAULT ''"),
    ("messages", "reaction", "TEXT NOT NULL DEFAULT ''"),
    ("messages", "alternates", "TEXT NOT NULL DEFAULT '[]'"),
    ("messages", "alt_index", "INTEGER NOT NULL DEFAULT 0"),
    ("group_messages", "reaction", "TEXT NOT NULL DEFAULT ''"),
    ("group_messages", "reactor_id", "TEXT"),
    ("group_messages", "alternates", "TEXT NOT NULL DEFAULT '[]'"),
    ("group_messages", "alt_index", "INTEGER NOT NULL DEFAULT 0"),
    ("images", "source", "TEXT NOT NULL DEFAULT ''"),
    ("images", "char_id", "TEXT NOT NULL DEFAULT ''"),
    ("images", "gift", "TEXT NOT NULL DEFAULT ''"),
    ("images", "adult", "INTEGER NOT NULL DEFAULT 0"),
    ("images", "recorded", "INTEGER NOT NULL DEFAULT 1"),
];

/// All tables + column migrations (start-up and after a restore).
pub(crate) fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(SCHEMA).map_err(e)?;
    crate::groups::init_schema(conn).map_err(e)?;
    crate::edits::init_schema(conn).map_err(e)?;
    crate::imagegen::init_schema(conn).map_err(e)?;
    crate::life::init_schema(conn).map_err(e)?;
    crate::economy::init_schema(conn).map_err(e)?;
    migrate(conn).map_err(e)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    for (table, col, def) in MIGRATIONS {
        let mut st = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let cols: Vec<String> = st.query_map([], |r| r.get::<_, String>(1))?.collect::<rusqlite::Result<_>>()?;
        if !cols.iter().any(|c| c == col) {
            conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {col} {def}"), [])?;
        }
    }
    Ok(())
}

const COLS: &str = "id,name,avatar,avatar_path,color,status,personal_message,personality,backstory,speaking_style,greeting,example_messages,model,created_at,updated_at,proactive_enabled,proactive_frequency,baseline_mood,mood,closeness,mood_updated_at,summarized_upto,appearance,life";
const MSG_COLS: &str = "id,character_id,role,content,created_at,is_error,is_unread,is_proactive,reaction,alternates,alt_index,image_path";

fn row_char(r: &Row) -> rusqlite::Result<Character> {
    Ok(Character {
        id: r.get(0)?, name: r.get(1)?, avatar: r.get(2)?, avatar_path: r.get(3)?, color: r.get(4)?,
        status: r.get(5)?, personal_message: r.get(6)?, personality: r.get(7)?, backstory: r.get(8)?,
        speaking_style: r.get(9)?, greeting: r.get(10)?, example_messages: r.get(11)?, model: r.get(12)?,
        created_at: r.get(13)?, updated_at: r.get(14)?,
        proactive_enabled: r.get::<_, i64>(15)? != 0, proactive_frequency: r.get(16)?,
        baseline_mood: r.get(17)?, mood: r.get(18)?, closeness: r.get(19)?, mood_updated_at: r.get(20)?, summarized_upto: r.get(21)?,
        appearance: serde_json::from_str(&r.get::<_, String>(22)?).unwrap_or_else(|_| empty_obj()),
        life: serde_json::from_str(&r.get::<_, String>(23)?).unwrap_or_else(|_| empty_obj()),
    })
}
fn row_msg(r: &Row) -> rusqlite::Result<Message> {
    Ok(Message {
        id: r.get(0)?, character_id: r.get(1)?, role: r.get(2)?, content: r.get(3)?, created_at: r.get(4)?,
        is_error: r.get::<_, i64>(5)? != 0, is_unread: r.get::<_, i64>(6)? != 0, is_proactive: r.get::<_, i64>(7)? != 0,
        reaction: r.get(8)?, alternates: serde_json::from_str(&r.get::<_, String>(9)?).unwrap_or_default(), alt_index: r.get(10)?,
        image_path: r.get(11)?,
    })
}

fn seed() -> Vec<Character> {
    let mk = |id: &str, name: &str, avatar: &str, color: &str, status: &str, pm: &str, pers: &str, back: &str, style: &str, greet: &str| Character {
        id: id.into(), name: name.into(), avatar: avatar.into(), avatar_path: None, color: color.into(), status: status.into(),
        personal_message: pm.into(), personality: pers.into(), backstory: back.into(), speaking_style: style.into(), appearance: empty_obj(), life: empty_obj(),
        greeting: greet.into(), example_messages: String::new(), model: DEFAULT_MODEL.into(),
        proactive_enabled: false, proactive_frequency: default_freq(), baseline_mood: default_mood(), mood: default_mood(),
        closeness: default_closeness(), mood_updated_at: 0, summarized_upto: 0, created_at: 0, updated_at: 0,
    };
    vec![
        mk("mira", "Mira", "\u{1F338}", "#f6a5c0", "online", "brewing chamomile & reading poetry \u{2615}",
           "Warm, gentle, a little shy, loves books and tea.",
           "In her twenties, runs a tiny tea shop on a rainy high street.",
           "Short casual messages, lowercase is fine, occasional :) or <3.",
           "heyy :) the shop just closed, finally some quiet. how was your day?"),
        mk("rex", "Rex", "\u{1F3AE}", "#7fb8ff", "busy", "ranked grind, do not disturb (pls disturb)",
           "Sarcastic but big-hearted gamer and amateur coder.",
           "Streams games at night, works in IT support by day.",
           "Short bursts, playful teasing, gaming slang.",
           "yo. you're alive. was about to send a search party lol"),
        mk("elowen", "Elowen", "\u{1F52E}", "#b9a3f0", "away", "Away - reading the stars \u{2728}",
           "Mysterious, whimsical, kind and curious about the user.",
           "A travelling fortune-teller who keeps a cottage full of candles and cats.",
           "A little poetic, but keeps messages short like instant messaging.", ""),
    ]
}

impl Db {
    pub fn open(dir: PathBuf) -> Result<Db, String> {
        std::fs::create_dir_all(dir.join("avatars")).map_err(e)?;
        let conn = Connection::open(dir.join("kindred.db")).map_err(e)?;
        Db::init(conn, dir)
    }

    pub fn init(conn: Connection, dir: PathBuf) -> Result<Db, String> {
        ensure_schema(&conn)?;
        crate::imagegen::ensure_dirs(&dir).map_err(e)?;
        let db = Db { conn: Mutex::new(conn), dir };
        if let Err(x) = db.backfill_images() { eprintln!("[images] backfill: {x}"); }
        let seeded: Option<String> = db.setting("seeded")?;
        if seeded.is_none() {
            for c in seed() { db.save_character(c)?; }
            db.set_setting("seeded", "1")?;
        }
        Ok(db)
    }

    fn setting(&self, key: &str) -> Result<Option<String>, String> {
        let c = self.conn.lock().unwrap();
        c.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0)).optional().map_err(e)
    }
    fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value]).map_err(e)?;
        Ok(())
    }

    pub fn get_settings(&self) -> Result<Settings, String> {
        Ok(Settings {
            user_name: self.setting("user_name")?.unwrap_or_else(|| "You".into()),
            status: self.setting("status")?.unwrap_or_else(|| "online".into()),
            personal_message: self.setting("personal_message")?.unwrap_or_else(|| "cosy evening \u{2728}".into()),
            quiet_start: self.setting("quiet_start")?.unwrap_or_else(default_qs),
            quiet_end: self.setting("quiet_end")?.unwrap_or_else(default_qe),
            sound: self.setting("sound")?.map(|v| v == "1").unwrap_or(true),
            theme: self.setting("theme")?.unwrap_or_else(default_theme),
            volume: self.setting("volume")?.and_then(|v| v.parse().ok()).unwrap_or(70),
            muted_sounds: self.setting("muted_sounds")?.unwrap_or_default(),
            emoticons: self.setting("emoticons")?.map(|v| v == "1").unwrap_or(true),
            close_to_tray: self.setting("close_to_tray")?.map(|v| v == "1").unwrap_or(true),
            tray_hint_shown: self.setting("tray_hint_shown")?.map(|v| v == "1").unwrap_or(false),
        })
    }
    pub fn save_settings(&self, s: &Settings) -> Result<(), String> {
        self.set_setting("user_name", &s.user_name)?;
        self.set_setting("status", &s.status)?;
        self.set_setting("personal_message", &s.personal_message)?;
        self.set_setting("quiet_start", &s.quiet_start)?;
        self.set_setting("quiet_end", &s.quiet_end)?;
        self.set_setting("sound", if s.sound { "1" } else { "0" })?;
        self.set_setting("theme", &s.theme)?;
        self.set_setting("volume", &s.volume.clamp(0, 100).to_string())?;
        self.set_setting("muted_sounds", &s.muted_sounds)?;
        self.set_setting("emoticons", if s.emoticons { "1" } else { "0" })?;
        self.set_setting("close_to_tray", if s.close_to_tray { "1" } else { "0" })?;
        self.set_setting("tray_hint_shown", if s.tray_hint_shown { "1" } else { "0" })
    }

    pub fn list_characters(&self) -> Result<Vec<Character>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare(&format!("SELECT {COLS} FROM characters ORDER BY created_at, name")).map_err(e)?;
        let rows = st.query_map([], row_char).map_err(e)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(e)
    }

    pub fn get_character(&self, id: &str) -> Result<Option<Character>, String> {
        let c = self.conn.lock().unwrap();
        c.query_row(&format!("SELECT {COLS} FROM characters WHERE id=?1"), [id], row_char).optional().map_err(e)
    }

    /// Insert or update. Blank id = new character.
    pub fn save_character(&self, mut ch: Character) -> Result<Character, String> {
        if ch.name.trim().is_empty() { return Err("Name is required".into()); }
        if ch.id.trim().is_empty() { ch.id = new_id(); }
        if ch.model.trim().is_empty() { ch.model = DEFAULT_MODEL.into(); }
        if !matches!(ch.proactive_frequency.as_str(), "rarely" | "sometimes" | "often") { ch.proactive_frequency = default_freq(); }
        if !MOODS.contains(&ch.baseline_mood.as_str()) { ch.baseline_mood = default_mood(); }
        if !MOODS.contains(&ch.mood.as_str()) { ch.mood = ch.baseline_mood.clone(); }
        ch.closeness = ch.closeness.clamp(0, 100);
        let t = now();
        let existing = self.get_character(&ch.id)?;
        ch.created_at = existing.map(|x| x.created_at).unwrap_or(if ch.created_at > 0 { ch.created_at } else { t });
        ch.updated_at = t;
        let c = self.conn.lock().unwrap();
        c.execute(&format!("INSERT INTO characters({COLS}) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name, avatar=excluded.avatar, avatar_path=excluded.avatar_path,
            color=excluded.color, status=excluded.status, personal_message=excluded.personal_message,
            personality=excluded.personality, backstory=excluded.backstory, speaking_style=excluded.speaking_style,
            greeting=excluded.greeting, example_messages=excluded.example_messages, model=excluded.model,
            proactive_enabled=excluded.proactive_enabled, proactive_frequency=excluded.proactive_frequency,
            baseline_mood=excluded.baseline_mood, appearance=excluded.appearance, life=excluded.life,
            updated_at=excluded.updated_at"),
            params![ch.id, ch.name, ch.avatar, ch.avatar_path, ch.color, ch.status, ch.personal_message, ch.personality,
                    ch.backstory, ch.speaking_style, ch.greeting, ch.example_messages, ch.model, ch.created_at, ch.updated_at,
                    ch.proactive_enabled as i64, ch.proactive_frequency, ch.baseline_mood, ch.mood, ch.closeness,
                    ch.mood_updated_at, ch.summarized_upto, ch.appearance.to_string(), ch.life.to_string()]).map_err(e)?;
        drop(c);
        // mood/closeness/summary progress are owned by the background updaters, not the editor
        self.get_character(&ch.id)?.ok_or_else(|| "save failed".to_string())
    }

    /// Background mood update. Mood must be a known mood; closeness is clamped to 0-100.
    pub fn set_mood(&self, id: &str, mood: &str, closeness: i64, personal_message: Option<&str>) -> Result<Character, String> {
        if !MOODS.contains(&mood) { return Err(format!("unknown mood {mood}")); }
        {
            let c = self.conn.lock().unwrap();
            c.execute("UPDATE characters SET mood=?2, closeness=?3, mood_updated_at=?4 WHERE id=?1",
                params![id, mood, closeness.clamp(0, 100), now()]).map_err(e)?;
            if let Some(pm) = personal_message.map(str::trim).filter(|p| !p.is_empty()) {
                c.execute("UPDATE characters SET personal_message=?2 WHERE id=?1", params![id, pm]).map_err(e)?;
            }
        }
        self.get_character(id)?.ok_or_else(|| "Character not found".to_string())
    }

    pub fn set_summarized_upto(&self, id: &str, message_id: i64) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("UPDATE characters SET summarized_upto=MAX(summarized_upto, ?2) WHERE id=?1", params![id, message_id]).map_err(e)?;
        Ok(())
    }

    pub fn list_memories(&self, character_id: &str) -> Result<Vec<Memory>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare("SELECT id,character_id,content,created_at,pinned,source FROM memories WHERE character_id=?1 ORDER BY pinned DESC, id DESC").map_err(e)?;
        let rows = st.query_map([character_id], |r| Ok(Memory {
            id: r.get(0)?, character_id: r.get(1)?, content: r.get(2)?, created_at: r.get(3)?, pinned: r.get::<_, i64>(4)? != 0, source: r.get(5)?,
        })).map_err(e)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(e)
    }

    /// Adds a memory unless an identical one (case-insensitive) exists. Returns None for duplicates/empty.
    pub fn add_memory(&self, character_id: &str, content: &str, pinned: bool, source: &str) -> Result<Option<Memory>, String> {
        let content = content.trim();
        if content.is_empty() { return Ok(None); }
        let c = self.conn.lock().unwrap();
        let dup: Option<i64> = c.query_row("SELECT id FROM memories WHERE character_id=?1 AND lower(content)=lower(?2)",
            params![character_id, content], |r| r.get(0)).optional().map_err(e)?;
        if dup.is_some() { return Ok(None); }
        let t = now();
        c.execute("INSERT INTO memories(character_id,content,created_at,pinned,source) VALUES(?1,?2,?3,?4,?5)",
            params![character_id, content, t, pinned as i64, source.trim()]).map_err(e)?;
        Ok(Some(Memory { id: c.last_insert_rowid(), character_id: character_id.into(), content: content.into(), created_at: t, pinned, source: source.trim().into() }))
    }

    pub fn update_memory(&self, id: i64, content: &str, pinned: bool) -> Result<(), String> {
        if content.trim().is_empty() { return Err("Memory cannot be empty".into()); }
        let c = self.conn.lock().unwrap();
        c.execute("UPDATE memories SET content=?2, pinned=?3 WHERE id=?1", params![id, content.trim(), pinned as i64]).map_err(e)?;
        Ok(())
    }

    pub fn delete_memory(&self, id: i64) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM memories WHERE id=?1", [id]).map_err(e)?;
        Ok(())
    }

    pub fn delete_character(&self, id: &str) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM messages WHERE character_id=?1", [id]).map_err(e)?;
        c.execute("DELETE FROM memories WHERE character_id=?1", [id]).map_err(e)?;
        c.execute("DELETE FROM characters WHERE id=?1", [id]).map_err(e)?;
        Ok(())
    }

    pub fn list_messages(&self, character_id: &str) -> Result<Vec<Message>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare(&format!("SELECT {MSG_COLS} FROM messages WHERE character_id=?1 ORDER BY id")).map_err(e)?;
        let rows = st.query_map([character_id], row_msg).map_err(e)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(e)
    }

    pub fn add_message(&self, character_id: &str, role: &str, content: &str, is_error: bool) -> Result<Message, String> {
        self.insert_message(character_id, role, content, is_error, false)
    }

    /// A message the character sent on its own: stored unread.
    pub fn add_proactive_message(&self, character_id: &str, content: &str) -> Result<Message, String> {
        if content.trim().is_empty() { return Err("empty proactive message".into()); }
        self.insert_message(character_id, "assistant", content.trim(), false, true)
    }

    fn insert_message(&self, character_id: &str, role: &str, content: &str, is_error: bool, proactive: bool) -> Result<Message, String> {
        if !matches!(role, "user" | "assistant") { return Err(format!("bad role {role}")); }
        let t = now();
        let c = self.conn.lock().unwrap();
        c.execute("INSERT INTO messages(character_id,role,content,created_at,is_error,is_unread,is_proactive) VALUES(?1,?2,?3,?4,?5,?6,?6)",
            params![character_id, role, content, t, is_error as i64, proactive as i64]).map_err(e)?;
        Ok(Message { id: c.last_insert_rowid(), character_id: character_id.into(), role: role.into(), content: content.into(),
            created_at: t, is_error, is_unread: proactive, is_proactive: proactive, reaction: String::new(), alternates: vec![], alt_index: 0, image_path: None })
    }

    pub fn mark_read(&self, character_id: &str) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("UPDATE messages SET is_unread=0 WHERE character_id=?1 AND is_unread=1", [character_id]).map_err(e)?;
        Ok(())
    }

    pub fn unread_counts(&self) -> Result<HashMap<String, i64>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare("SELECT character_id, COUNT(*) FROM messages WHERE is_unread=1 GROUP BY character_id").map_err(e)?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).map_err(e)?;
        rows.collect::<rusqlite::Result<HashMap<_, _>>>().map_err(e)
    }

    /// Recent non-error messages (oldest first) for proactive context.
    pub fn recent_messages(&self, character_id: &str, limit: i64) -> Result<Vec<Message>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare(&format!("SELECT {MSG_COLS} FROM messages WHERE character_id=?1 AND is_error=0 ORDER BY id DESC LIMIT ?2")).map_err(e)?;
        let mut v = st.query_map(params![character_id, limit], row_msg).map_err(e)?.collect::<rusqlite::Result<Vec<_>>>().map_err(e)?;
        v.reverse();
        Ok(v)
    }

    pub fn clear_messages(&self, character_id: &str) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM messages WHERE character_id=?1", [character_id]).map_err(e)?;
        c.execute("UPDATE characters SET summarized_upto=0 WHERE id=?1", [character_id]).map_err(e)?;
        Ok(())
    }

    /// Copies an image into data/avatars and returns the stored absolute path.
    pub fn import_avatar(&self, src: &str) -> Result<String, String> {
        let src = Path::new(src);
        let ext = src.extension().and_then(|x| x.to_str()).unwrap_or("png").to_lowercase();
        if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp") { return Err("Unsupported image type".into()); }
        let dir = self.dir.join("avatars");
        std::fs::create_dir_all(&dir).map_err(e)?;
        // Non-square stills become a 512px square (centre crop, biased towards the top where faces are).
        // The source file is never modified. Anything that fails to decode (or GIFs) is copied as-is.
        if ext != "gif" {
            if let Ok(img) = image::open(src) {
                let dest = dir.join(format!("{}.png", new_id()));
                square_avatar(&img).save_with_format(&dest, image::ImageFormat::Png).map_err(e)?;
                return Ok(dest.display().to_string());
            }
        }
        let dest = dir.join(format!("{}.{ext}", new_id()));
        std::fs::copy(src, &dest).map_err(e)?;
        Ok(dest.display().to_string())
    }

    pub fn export_character(&self, id: &str, path: &str) -> Result<(), String> {
        let mut ch = self.get_character(id)?.ok_or("Character not found")?;
        let img = ch.avatar_path.take().and_then(|p| avatar_data_url(&p).ok());
        let mut v = serde_json::to_value(&ch).map_err(e)?;
        v["format"] = "kindred/1".into();
        if let Some(img) = img { v["avatarImage"] = img.into(); }
        std::fs::write(path, serde_json::to_string_pretty(&v).map_err(e)?).map_err(e)
    }

    /// Imports keep the frequency but always arrive with "message me first" OFF.
    pub fn import_character(&self, path: &str) -> Result<Character, String> {
        let text = std::fs::read_to_string(path).map_err(e)?;
        let v: serde_json::Value = serde_json::from_str(&text).map_err(|x| format!("Not a valid character file: {x}"))?;
        let mut ch: Character = serde_json::from_value(v.clone()).map_err(|x| format!("Not a valid character file: {x}"))?;
        ch.id = String::new();
        ch.avatar_path = None;
        ch.proactive_enabled = false;
        ch.mood = ch.baseline_mood.clone();
        ch.closeness = default_closeness();
        ch.mood_updated_at = 0;
        ch.summarized_upto = 0;
        if let Some(url) = v["avatarImage"].as_str() {
            if let Some((head, data)) = url.split_once(",") {
                let ext = head.trim_start_matches("data:image/").split(';').next().unwrap_or("png").replace("jpeg", "jpg");
                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data) {
                    let dest = self.dir.join("avatars").join(format!("{}.{ext}", new_id()));
                    if std::fs::write(&dest, bytes).is_ok() { ch.avatar_path = Some(dest.display().to_string()); }
                }
            }
        }
        self.save_character(ch)
    }
}

/// Square crop: full width/height of the short side, 15% down from the top on portraits, centred on landscapes; max 512px.
pub fn square_avatar(img: &image::DynamicImage) -> image::DynamicImage {
    let (w, h) = (img.width(), img.height());
    let side = w.min(h);
    let x = (w - side) / 2;
    let y = ((h - side) as f32 * 0.15) as u32;
    let sq = img.crop_imm(x, y, side, side);
    if side > 512 { sq.resize_exact(512, 512, image::imageops::FilterType::Lanczos3) } else { sq }
}

pub fn avatar_data_url(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(e)?;
    let ext = Path::new(path).extension().and_then(|x| x.to_str()).unwrap_or("png").to_lowercase();
    let mime = match ext.as_str() { "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp", "bmp" => "image/bmp", _ => "image/png" };
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> (Db, tempfile::TempDir) {
        let t = tempfile::tempdir().unwrap();
        (Db::open(t.path().to_path_buf()).unwrap(), t)
    }

    #[test]
    fn seeds_once_and_persists() {
        let t = tempfile::tempdir().unwrap();
        { let db = Db::open(t.path().into()).unwrap(); assert_eq!(db.list_characters().unwrap().len(), 3); db.delete_character("rex").unwrap(); }
        let db = Db::open(t.path().into()).unwrap();
        assert_eq!(db.list_characters().unwrap().len(), 2, "deleted seed must not come back");
        assert!(db.list_characters().unwrap().iter().all(|c| !c.proactive_enabled));
    }

    #[test]
    fn migrates_old_database_keeping_data() {
        let t = tempfile::tempdir().unwrap();
        {
            let conn = Connection::open(t.path().join("kindred.db")).unwrap();
            conn.execute_batch(SCHEMA).unwrap();
            conn.execute("INSERT INTO characters(id,name,model,created_at,updated_at) VALUES('lily','Lily','m',1,1)", []).unwrap();
            conn.execute("INSERT INTO messages(character_id,role,content,created_at) VALUES('lily','user','hi',1)", []).unwrap();
            conn.execute("INSERT INTO settings(key,value) VALUES('seeded','1')", []).unwrap();
        }
        let db = Db::open(t.path().into()).unwrap();
        let lily = db.get_character("lily").unwrap().unwrap();
        assert!(!lily.proactive_enabled);
        assert_eq!(lily.proactive_frequency, "sometimes");
        let m = db.list_messages("lily").unwrap();
        assert_eq!(m.len(), 1); assert!(!m[0].is_unread);
        drop(db);
        Db::open(t.path().into()).unwrap(); // migration is idempotent
    }

    #[test]
    fn character_crud_and_messages() {
        let (db, _t) = temp_db();
        let mut c = db.list_characters().unwrap()[0].clone();
        let mut new = c.clone(); new.id = String::new(); new.name = "Test".into();
        let saved = db.save_character(new).unwrap();
        assert!(!saved.id.is_empty());
        c.personal_message = "changed".into();
        c.proactive_enabled = true; c.proactive_frequency = "often".into();
        db.save_character(c.clone()).unwrap();
        let back = db.get_character(&c.id).unwrap().unwrap();
        assert_eq!(back.personal_message, "changed");
        assert!(back.proactive_enabled); assert_eq!(back.proactive_frequency, "often");
        db.add_message(&saved.id, "user", "hi", false).unwrap();
        db.add_message(&saved.id, "assistant", "oops", true).unwrap();
        let m = db.list_messages(&saved.id).unwrap();
        assert_eq!(m.len(), 2); assert!(m[1].is_error);
        assert!(db.add_message(&saved.id, "system", "x", false).is_err());
        db.clear_messages(&saved.id).unwrap();
        assert!(db.list_messages(&saved.id).unwrap().is_empty());
        db.add_message(&saved.id, "user", "again", false).unwrap();
        db.delete_character(&saved.id).unwrap();
        assert!(db.list_messages(&saved.id).unwrap().is_empty());
        assert!(db.save_character(Character { name: " ".into(), ..c }).is_err());
    }

    #[test]
    fn proactive_messages_unread_flow() {
        let (db, _t) = temp_db();
        db.add_message("mira", "user", "hello", false).unwrap();
        db.add_message("mira", "assistant", "err", true).unwrap();
        let p = db.add_proactive_message("mira", "  thinking of you :)  ").unwrap();
        assert!(p.is_unread && p.is_proactive && p.content == "thinking of you :)");
        assert!(db.add_proactive_message("mira", "  ").is_err());
        assert_eq!(db.unread_counts().unwrap().get("mira"), Some(&1));
        let recent = db.recent_messages("mira", 10).unwrap();
        assert_eq!(recent.len(), 2, "errors excluded");
        assert_eq!(recent[1].content, "thinking of you :)");
        db.mark_read("mira").unwrap();
        assert!(db.unread_counts().unwrap().is_empty());
    }

    #[test]
    fn memories_and_mood() {
        let (db, _t) = temp_db();
        let m = db.add_memory("mira", " Alex has an exam on Friday ", false, "").unwrap().unwrap();
        assert!(db.add_memory("mira", "alex has an exam on friday", false, "Tea Club").unwrap().is_none(), "dedupe across sources");
        assert!(db.add_memory("mira", "  ", false, "").unwrap().is_none());
        db.add_memory("mira", "Alex likes chamomile", true, "Tea Club").unwrap();
        assert_eq!(db.list_memories("mira").unwrap()[0].source, "Tea Club");
        let list = db.list_memories("mira").unwrap();
        assert_eq!(list.len(), 2); assert!(list[0].pinned, "pinned first");
        db.update_memory(m.id, "Alex passed her exam", true).unwrap();
        assert!(db.update_memory(m.id, " ", true).is_err());
        db.delete_memory(list[0].id).unwrap();
        assert_eq!(db.list_memories("mira").unwrap()[0].content, "Alex passed her exam");

        let c = db.set_mood("mira", "excited", 140, Some("so happy today!")).unwrap();
        assert_eq!((c.mood.as_str(), c.closeness), ("excited", 100));
        assert_eq!(c.personal_message, "so happy today!");
        assert!(c.mood_updated_at > 0);
        assert!(db.set_mood("mira", "furious", 10, None).is_err());
        // editor saves must not clobber background mood state
        let mut edit = c.clone(); edit.mood = "sad".into(); edit.closeness = 0; edit.baseline_mood = "playful".into();
        let saved = db.save_character(edit).unwrap();
        assert_eq!((saved.mood.as_str(), saved.closeness, saved.baseline_mood.as_str()), ("excited", 100, "playful"));
        db.set_summarized_upto("mira", 42).unwrap();
        db.set_summarized_upto("mira", 7).unwrap();
        assert_eq!(db.get_character("mira").unwrap().unwrap().summarized_upto, 42);
        db.clear_messages("mira").unwrap();
        assert_eq!(db.get_character("mira").unwrap().unwrap().summarized_upto, 0);
        db.delete_character("mira").unwrap();
        assert!(db.list_memories("mira").unwrap().is_empty());
    }

    #[test]
    fn settings_roundtrip() {
        let (db, _t) = temp_db();
        let d = db.get_settings().unwrap();
        assert_eq!(d.user_name, "You"); assert!(d.sound); assert_eq!(d.quiet_start, "23:00");
        let s = Settings { user_name: "S".into(), status: "busy".into(), personal_message: "pm".into(),
            quiet_start: "22:30".into(), quiet_end: "07:00".into(), sound: false,
            theme: "night".into(), volume: 40, muted_sounds: "sent,nudge".into(), emoticons: false, close_to_tray: false, tray_hint_shown: true };
        db.save_settings(&s).unwrap();
        assert_eq!(db.get_settings().unwrap(), s);
    }

    #[test]
    fn avatar_import_crops_to_square() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().to_path_buf()).unwrap();
        let src = dir.path().join("portrait.png");
        let mut img = image::RgbImage::new(832, 1216);
        for (_, y, p) in img.enumerate_pixels_mut() { *p = if y < 200 { image::Rgb([255, 0, 0]) } else { image::Rgb([0, 0, 255]) }; }
        img.save(&src).unwrap();
        let before = std::fs::read(&src).unwrap();
        let out = db.import_avatar(src.to_str().unwrap()).unwrap();
        let a = image::open(&out).unwrap().to_rgb8();
        assert_eq!((a.width(), a.height()), (512, 512));
        // crop starts at y = 0.15 * (1216 - 832) = 57, so the red band (y < 200) is still at the top
        assert_eq!(a.get_pixel(256, 10)[0], 255);
        assert_eq!(a.get_pixel(256, 500)[2], 255);
        assert_eq!(std::fs::read(&src).unwrap(), before, "original untouched");
    }

    #[test]
    fn export_import_with_avatar() {
        let (db, t) = temp_db();
        let img = t.path().join("a.png");
        std::fs::write(&img, [137u8, 80, 78, 71]).unwrap();
        let mut c = db.get_character("mira").unwrap().unwrap();
        c.avatar_path = Some(db.import_avatar(img.to_str().unwrap()).unwrap());
        c.proactive_enabled = true; c.proactive_frequency = "rarely".into();
        db.save_character(c).unwrap();
        let out = t.path().join("mira.json");
        db.export_character("mira", out.to_str().unwrap()).unwrap();
        let json = std::fs::read_to_string(&out).unwrap();
        assert!(json.contains("\"proactiveEnabled\": true") && json.contains("\"proactiveFrequency\": \"rarely\""));
        let imp = db.import_character(out.to_str().unwrap()).unwrap();
        assert_ne!(imp.id, "mira");
        assert_eq!(imp.name, "Mira");
        assert!(!imp.proactive_enabled, "imports arrive with proactive OFF");
        assert_eq!(imp.proactive_frequency, "rarely");
        assert_eq!(std::fs::read(imp.avatar_path.unwrap()).unwrap(), vec![137u8, 80, 78, 71]);
        assert_eq!(db.list_characters().unwrap().len(), 4);
    }

    #[test]
    fn layout_root_keeps_dev_layout_and_installed_layout() {
        let dev = std::path::Path::new(r"D:\Apps\Messenger\data");
        assert_eq!(layout_root(dev), std::path::Path::new(r"D:\Apps\Messenger"));
        let installed = std::path::Path::new(r"C:\Users\x\AppData\Roaming\app.id\data");
        assert_eq!(layout_root(installed), std::path::Path::new(r"C:\Users\x\AppData\Roaming\app.id"));
        let custom = std::path::Path::new(r"D:\stuff\mychats");
        assert_eq!(layout_root(custom), custom);
        assert_eq!(layout_root(std::path::Path::new("data")), std::path::Path::new("data"));
    }
}
