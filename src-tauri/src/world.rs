//! v1.3 Living World: letters, replies and diary entries (SQLite).
use crate::db::{e, now, Db};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

type R<T> = Result<T, String>;

pub fn init_schema(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(r#"
CREATE TABLE IF NOT EXISTS letters (id INTEGER PRIMARY KEY AUTOINCREMENT, character_id TEXT NOT NULL, kind TEXT NOT NULL,
  from_user INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, reply_to INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, is_read INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS letters_char ON letters(character_id, kind, id);
"#)
}

/// kind: "letter" (from the character, or from the user when from_user), "diary" (the character's private diary).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Letter {
    pub id: i64, pub character_id: String, pub kind: String, pub from_user: bool, pub title: String, pub body: String,
    pub reply_to: i64, pub created_at: i64, pub is_read: bool,
}
const L_COLS: &str = "id,character_id,kind,from_user,title,body,reply_to,created_at,is_read";
fn row_letter(r: &rusqlite::Row) -> rusqlite::Result<Letter> {
    Ok(Letter { id: r.get(0)?, character_id: r.get(1)?, kind: r.get(2)?, from_user: r.get::<_, i64>(3)? != 0, title: r.get(4)?, body: r.get(5)?,
        reply_to: r.get(6)?, created_at: r.get(7)?, is_read: r.get::<_, i64>(8)? != 0 })
}

impl Db {
    pub fn add_letter(&self, character_id: &str, kind: &str, from_user: bool, title: &str, body: &str, reply_to: i64) -> R<Letter> {
        if !matches!(kind, "letter" | "diary") { return Err(format!("unknown letter kind {kind}")); }
        if body.trim().is_empty() { return Err("empty letter".into()); }
        let from_user = from_user && kind == "letter";
        let c = self.conn.lock().unwrap();
        let t = now();
        c.execute("INSERT INTO letters(character_id,kind,from_user,title,body,reply_to,created_at,is_read) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![character_id, kind, from_user as i64, title, body, reply_to, t, from_user as i64]).map_err(e)?;
        Ok(Letter { id: c.last_insert_rowid(), character_id: character_id.into(), kind: kind.into(), from_user, title: title.into(), body: body.into(),
            reply_to, created_at: t, is_read: from_user })
    }
    /// Newest first; optional filters.
    pub fn list_letters(&self, character_id: Option<&str>, kind: Option<&str>, limit: i64) -> R<Vec<Letter>> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare(&format!("SELECT {L_COLS} FROM letters WHERE (?1 IS NULL OR character_id=?1) AND (?2 IS NULL OR kind=?2) ORDER BY id DESC LIMIT ?3")).map_err(e)?;
        let out = st.query_map(params![character_id, kind, limit], row_letter).map_err(e)?.collect::<rusqlite::Result<Vec<_>>>().map_err(e)?;
        Ok(out)
    }
    pub fn mark_letters_read(&self, character_id: Option<&str>, kind: Option<&str>) -> R<()> {
        self.conn.lock().unwrap().execute("UPDATE letters SET is_read=1 WHERE is_read=0 AND (?1 IS NULL OR character_id=?1) AND (?2 IS NULL OR kind=?2)",
            params![character_id, kind]).map_err(e)?;
        Ok(())
    }
    pub fn delete_letter(&self, id: i64) -> R<()> {
        self.conn.lock().unwrap().execute("DELETE FROM letters WHERE id=?1", params![id]).map_err(e)?; Ok(())
    }
    /// Unread counts by kind ("letter", "diary").
    pub fn letters_unread(&self) -> R<HashMap<String, i64>> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare("SELECT kind, COUNT(*) FROM letters WHERE is_read=0 GROUP BY kind").map_err(e)?;
        let out = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).map_err(e)?.collect::<rusqlite::Result<HashMap<_, _>>>().map_err(e)?;
        Ok(out)
    }
}

#[tauri::command] pub fn letter_add(db: State<Db>, character_id: String, kind: String, from_user: bool, title: String, body: String, reply_to: Option<i64>) -> R<Letter> {
    db.add_letter(&character_id, &kind, from_user, &title, &body, reply_to.unwrap_or(0))
}
#[tauri::command] pub fn letters_list(db: State<Db>, character_id: Option<String>, kind: Option<String>, limit: Option<i64>) -> R<Vec<Letter>> {
    db.list_letters(character_id.as_deref(), kind.as_deref(), limit.unwrap_or(200))
}
#[tauri::command] pub fn letters_mark_read(db: State<Db>, character_id: Option<String>, kind: Option<String>) -> R<()> { db.mark_letters_read(character_id.as_deref(), kind.as_deref()) }
#[tauri::command] pub fn letter_delete(db: State<Db>, id: i64) -> R<()> { db.delete_letter(id) }
#[tauri::command] pub fn letters_unread(db: State<Db>) -> R<HashMap<String, i64>> { db.letters_unread() }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letters_replies_and_diaries() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().to_path_buf()).unwrap();
        let l = db.add_letter("mira", "letter", false, "Rainy Sunday", "Dear Alex, ...", 0).unwrap();
        assert!(!l.is_read);
        let r = db.add_letter("mira", "letter", true, "Re: Rainy Sunday", "Dear Mira, ...", l.id).unwrap();
        assert!(r.is_read && r.from_user && r.reply_to == l.id, "your own letters are read");
        db.add_letter("mira", "diary", false, "Tuesday", "Dear diary, ...", 0).unwrap();
        let d = db.add_letter("rex", "diary", true, "x", "a diary can't be from the user", 0).unwrap();
        assert!(!d.from_user);
        assert!(db.add_letter("rex", "spam", false, "", "x", 0).is_err());
        assert!(db.add_letter("rex", "letter", false, "", "  ", 0).is_err());
        let un = db.letters_unread().unwrap();
        assert_eq!((un.get("letter").copied(), un.get("diary").copied()), (Some(1), Some(2)));
        assert_eq!(db.list_letters(Some("mira"), None, 10).unwrap().len(), 3);
        assert_eq!(db.list_letters(None, Some("diary"), 10).unwrap().len(), 2);
        assert_eq!(db.list_letters(Some("mira"), Some("letter"), 10).unwrap()[0].id, r.id, "newest first");
        db.mark_letters_read(Some("mira"), Some("diary")).unwrap();
        assert_eq!(db.letters_unread().unwrap().get("diary").copied(), Some(1));
        db.mark_letters_read(None, None).unwrap();
        assert!(db.letters_unread().unwrap().is_empty());
        db.delete_letter(l.id).unwrap();
        assert_eq!(db.list_letters(None, None, 10).unwrap().len(), 3);
    }
}
