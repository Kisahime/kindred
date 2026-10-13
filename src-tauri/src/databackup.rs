//! Data backups: <root>\backups-data\<YYYY-MM-DD_HHMMSS>[_reason]\ with a consistent SQLite copy
//! (online backup API, safe while the app runs) plus avatars, images and logs. Models are never copied.
//! Only folders this module made (timestamp name + manifest.json) are ever pruned.
use crate::db::{e, now, Db};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::State;

pub const KEEP: usize = 14;
const DIRS: &[&str] = &["avatars", "images", "logs"];
const MODEL_EXT: &[&str] = &["safetensors", "gguf", "ckpt", "pt", "pth", "bin", "onnx"];
const MAX_FILE: u64 = 500 * 1024 * 1024;
const MANIFEST: &str = "manifest.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo { pub name: String, pub path: String, pub size_bytes: u64, pub files: u64, pub reason: String, pub created_at: i64 }

pub fn root_for(data: &Path) -> PathBuf { crate::db::layout_root(data).join("backups-data") }

/// "2026-10-13_150255"
pub fn valid_stamp(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 17 && b.iter().enumerate().all(|(i, c)| match i { 4 | 7 => *c == b'-', 10 => *c == b'_', _ => c.is_ascii_digit() })
}
pub fn is_backup_name(n: &str) -> bool {
    n.len() >= 17 && n.is_char_boundary(17) && valid_stamp(&n[..17]) && (n.len() == 17 || n[17..].starts_with('_'))
        && n[17..].chars().all(|c| c == '_' || c == '-' || c.is_ascii_alphanumeric())
}
fn skipped(p: &Path, len: u64) -> bool {
    let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
    MODEL_EXT.contains(&ext.as_str()) || len > MAX_FILE
}
/// Copies files (adding/overwriting, never removing anything at the destination).
fn copy_tree(src: &Path, dst: &Path, files: &mut u64, bytes: &mut u64) -> std::io::Result<()> {
    if !src.is_dir() { return Ok(()); }
    std::fs::create_dir_all(dst)?;
    for ent in std::fs::read_dir(src)?.flatten() {
        let p = ent.path();
        let name = ent.file_name();
        let md = ent.metadata()?;
        if md.is_dir() {
            if name.to_string_lossy().starts_with('.') || name == "models" { continue; }
            copy_tree(&p, &dst.join(&name), files, bytes)?;
        } else if md.is_file() && !skipped(&p, md.len()) {
            std::fs::copy(&p, dst.join(&name))?;
            *files += 1; *bytes += md.len();
        }
    }
    Ok(())
}
fn dir_size(p: &Path) -> u64 {
    std::fs::read_dir(p).map(|rd| rd.flatten().map(|e| { let m = e.metadata().ok(); match m { Some(m) if m.is_dir() => dir_size(&e.path()), Some(m) => m.len(), None => 0 } }).sum()).unwrap_or(0)
}
fn sqlite_copy(src: &Connection, dst: &mut Connection) -> Result<(), String> {
    let b = rusqlite::backup::Backup::new(src, dst).map_err(e)?;
    b.run_to_completion(256, Duration::from_millis(2), None).map_err(e)
}

/// Makes one backup. `conn` is the live database connection (copied with the online backup API).
pub fn create(conn: &Connection, data: &Path, root: &Path, stamp: &str, reason: &str) -> Result<BackupInfo, String> {
    if !valid_stamp(stamp) { return Err("Bad backup timestamp".into()); }
    let reason: String = reason.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(24).collect::<String>().to_lowercase();
    std::fs::create_dir_all(root).map_err(e)?;
    let base = if reason.is_empty() { stamp.to_string() } else { format!("{stamp}_{reason}") };
    let mut name = base.clone();
    let mut n = 2;
    while root.join(&name).exists() { name = format!("{base}-{n}"); n += 1; }
    let tmp = root.join(format!(".partial-{name}"));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(e)?;
    let result = (|| -> Result<(u64, u64), String> {
        let mut dst = Connection::open(tmp.join("kindred.db")).map_err(e)?;
        sqlite_copy(conn, &mut dst)?;
        drop(dst);
        let (mut files, mut bytes) = (1u64, std::fs::metadata(tmp.join("kindred.db")).map(|m| m.len()).unwrap_or(0));
        for d in DIRS { copy_tree(&data.join(d), &tmp.join(d), &mut files, &mut bytes).map_err(e)?; }
        Ok((files, bytes))
    })();
    let (files, bytes) = match result { Ok(x) => x, Err(x) => { let _ = std::fs::remove_dir_all(&tmp); return Err(x); } };
    let info = BackupInfo { name: name.clone(), path: root.join(&name).display().to_string(), size_bytes: bytes, files, reason: reason.clone(), created_at: now() };
    std::fs::write(tmp.join(MANIFEST), serde_json::to_string_pretty(&info).map_err(e)?).map_err(e)?;
    std::fs::rename(&tmp, root.join(&name)).map_err(e)?;
    Ok(info)
}

/// Backups in `root`, newest first (only folders with our name pattern and a manifest).
pub fn list(root: &Path) -> Vec<BackupInfo> {
    let mut out: Vec<BackupInfo> = std::fs::read_dir(root).map(|rd| rd.flatten().filter_map(|ent| {
        let name = ent.file_name().to_string_lossy().to_string();
        if !is_backup_name(&name) || !ent.path().join(MANIFEST).is_file() { return None; }
        let m: Option<BackupInfo> = std::fs::read_to_string(ent.path().join(MANIFEST)).ok().and_then(|s| serde_json::from_str(&s).ok());
        Some(match m {
            Some(m) => BackupInfo { name: name.clone(), path: ent.path().display().to_string(), ..m },
            None => BackupInfo { name: name.clone(), path: ent.path().display().to_string(), size_bytes: dir_size(&ent.path()), files: 0, reason: String::new(), created_at: 0 },
        })
    }).collect()).unwrap_or_default();
    out.sort_by(|a, b| b.name.cmp(&a.name));
    out
}
/// Keeps the newest `keep` backups; removes only older folders that are ours. Returns the removed names.
pub fn prune(root: &Path, keep: usize) -> Vec<String> {
    let mut gone = vec![];
    for b in list(root).into_iter().skip(keep) {
        let p = root.join(&b.name);
        if is_backup_name(&b.name) && p.join(MANIFEST).is_file() && std::fs::remove_dir_all(&p).is_ok() { gone.push(b.name); }
    }
    gone
}
/// Start-up backup: at most one per calendar day (the stamp's date).
pub fn auto(conn: &Connection, data: &Path, root: &Path, stamp: &str) -> Result<Option<BackupInfo>, String> {
    if !valid_stamp(stamp) { return Err("Bad backup timestamp".into()); }
    if list(root).iter().any(|b| b.name.starts_with(&stamp[..10])) { return Ok(None); }
    let b = create(conn, data, root, stamp, "auto")?;
    prune(root, KEEP);
    Ok(Some(b))
}
/// Restores a backup into the live database (online backup API) and copies its pictures/logs back
/// (adding/overwriting; files made since are kept). Take a safety backup first.
pub fn restore(live: &mut Connection, data: &Path, root: &Path, name: &str) -> Result<u64, String> {
    if !is_backup_name(name) { return Err("Unknown backup".into()); }
    let dir = root.join(name);
    if !dir.join(MANIFEST).is_file() || !dir.join("kindred.db").is_file() { return Err("That backup is incomplete.".into()); }
    let src = Connection::open_with_flags(dir.join("kindred.db"), OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(e)?;
    let ok: String = src.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(e)?;
    if ok != "ok" { return Err(format!("The backup database is damaged ({ok}).")); }
    sqlite_copy(&src, live)?;
    crate::db::ensure_schema(live)?;
    let (mut files, mut bytes) = (0, 0);
    for d in DIRS { copy_tree(&dir.join(d), &data.join(d), &mut files, &mut bytes).map_err(e)?; }
    Ok(files)
}

impl Db {
    pub fn backup_root(&self) -> PathBuf { root_for(&self.dir) }
}
type R<T> = Result<T, String>;
#[tauri::command] pub fn backup_now(db: State<Db>, stamp: String, reason: String) -> R<BackupInfo> {
    let b = { let c = db.conn.lock().unwrap(); create(&c, &db.dir, &db.backup_root(), &stamp, &reason)? };
    prune(&db.backup_root(), KEEP);
    Ok(b)
}
#[tauri::command] pub fn backup_auto(db: State<Db>, stamp: String) -> R<Option<BackupInfo>> { let c = db.conn.lock().unwrap(); auto(&c, &db.dir, &db.backup_root(), &stamp) }
#[tauri::command] pub fn backup_list(db: State<Db>) -> Vec<BackupInfo> { list(&db.backup_root()) }
#[tauri::command] pub fn backup_restore(db: State<Db>, name: String) -> R<u64> { let mut c = db.conn.lock().unwrap(); restore(&mut c, &db.dir, &db.backup_root(), &name) }
#[tauri::command] pub fn backup_folder(db: State<Db>) -> String { db.backup_root().display().to_string() }

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    #[test]
    fn names_and_stamps() {
        assert!(valid_stamp("2026-10-13_150255") && !valid_stamp("2026-10-13 150255") && !valid_stamp("../../x"));
        assert!(is_backup_name("2026-10-13_150255") && is_backup_name("2026-10-13_150255_before-restore") && !is_backup_name("my stuff") && !is_backup_name("2026-10-13_150255x"));
    }

    #[test]
    fn backup_prune_restore_on_temp_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path().join("data");
        let db = Db::open(data.clone()).unwrap();
        let root = root_for(&data);
        std::fs::write(data.join("avatars").join("a.png"), b"avatar").unwrap();
        std::fs::create_dir_all(data.join("models").join("checkpoints")).unwrap();
        std::fs::write(data.join("models").join("checkpoints").join("big.safetensors"), b"model").unwrap();
        std::fs::write(data.join("images").join("stray.gguf"), b"model").unwrap();
        db.econ_add(100, "test", "before").unwrap();
        // unrelated folder in backups-data must survive pruning
        std::fs::create_dir_all(root.join("Alex's notes")).unwrap();
        let b = { let c = db.conn.lock().unwrap(); create(&c, &data, &root, "2026-10-01_090000", "manual").unwrap() };
        let bdir = root.join(&b.name);
        assert!(bdir.join("kindred.db").is_file() && bdir.join("avatars").join("a.png").is_file());
        assert!(!bdir.join("models").exists() && !bdir.join("images").join("stray.gguf").exists(), "no model files");
        assert!(b.size_bytes > 0 && b.files >= 2);
        // change live data, then restore
        db.econ_add(50, "test", "after").unwrap();
        std::fs::write(data.join("avatars").join("a.png"), b"changed").unwrap();
        std::fs::write(data.join("avatars").join("new.png"), b"new").unwrap();
        assert_eq!(db.econ_balance().unwrap(), 150);
        { let mut c = db.conn.lock().unwrap(); restore(&mut c, &data, &root, &b.name).unwrap(); }
        assert_eq!(db.econ_balance().unwrap(), 100, "database restored while open");
        assert_eq!(std::fs::read(data.join("avatars").join("a.png")).unwrap(), b"avatar");
        assert!(data.join("avatars").join("new.png").is_file(), "newer files are kept");
        db.conn.lock().unwrap().execute("INSERT INTO kv(key,value) VALUES('x','1')", params![]).unwrap();
        // auto: once per day
        { let c = db.conn.lock().unwrap();
          assert!(auto(&c, &data, &root, "2026-10-02_080000").unwrap().is_some());
          assert!(auto(&c, &data, &root, "2026-10-02_200000").unwrap().is_none(), "one per day"); }
        // keep newest 14, never touch other folders
        { let c = db.conn.lock().unwrap(); for d in 3..=20 { create(&c, &data, &root, &format!("2026-10-{d:02}_120000"), "").unwrap(); } }
        let gone = prune(&root, KEEP);
        let left = list(&root);
        assert_eq!(left.len(), KEEP);
        assert_eq!(left[0].name, "2026-10-20_120000");
        assert!(gone.contains(&"2026-10-01_090000_manual".to_string()));
        assert!(root.join("Alex's notes").is_dir(), "unrelated folders untouched");
        assert!(restore(&mut db.conn.lock().unwrap(), &data, &root, "../data").is_err());
    }
}
