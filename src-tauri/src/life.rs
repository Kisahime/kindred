//! Relationship milestones, the "What's new" feed and the per-character photo album.
use crate::db::{e, now, Db};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

pub fn init_schema(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(r#"
CREATE TABLE IF NOT EXISTS milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, character_id TEXT NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, data TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS milestones_char ON milestones(character_id);
CREATE TABLE IF NOT EXISTS feed_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, character_id TEXT NOT NULL, content TEXT NOT NULL,
  image_path TEXT, reaction TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, is_unread INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS feed_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, from_user INTEGER NOT NULL,
  content TEXT NOT NULL, created_at INTEGER NOT NULL);
"#)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Milestone { pub id: i64, pub character_id: String, pub kind: String, pub title: String, pub data: String, pub created_at: i64 }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeedComment { pub id: i64, pub post_id: i64, pub from_user: bool, pub content: String, pub created_at: i64 }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeedPost { pub id: i64, pub character_id: String, pub content: String, pub image_path: Option<String>, pub reaction: String,
    pub created_at: i64, pub is_unread: bool, pub comments: Vec<FeedComment> }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlbumItem {
    /// "chat" | "group" | "feed"
    pub source: String,
    /// message / group message / post id
    pub ref_id: i64,
    /// group id for group items
    pub group_id: Option<String>,
    pub path: String, pub caption: String, pub created_at: i64,
}

impl Db {
    pub fn list_milestones(&self, character_id: Option<&str>) -> Result<Vec<Milestone>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare("SELECT id,character_id,kind,title,data,created_at FROM milestones WHERE (?1 IS NULL OR character_id=?1) ORDER BY created_at, id").map_err(e)?;
        let rows = st.query_map(params![character_id], |r| Ok(Milestone { id: r.get(0)?, character_id: r.get(1)?, kind: r.get(2)?, title: r.get(3)?, data: r.get(4)?, created_at: r.get(5)? })).map_err(e)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(e)
    }
    /// Adds a milestone. With `unique`, an existing (character, kind, data) row is returned instead of a duplicate.
    pub fn add_milestone(&self, character_id: &str, kind: &str, title: &str, data: &str, at: Option<i64>, unique: bool) -> Result<Milestone, String> {
        let c = self.conn.lock().unwrap();
        if unique {
            let found = c.query_row("SELECT id,character_id,kind,title,data,created_at FROM milestones WHERE character_id=?1 AND kind=?2 AND data=?3",
                params![character_id, kind, data], |r| Ok(Milestone { id: r.get(0)?, character_id: r.get(1)?, kind: r.get(2)?, title: r.get(3)?, data: r.get(4)?, created_at: r.get(5)? })).optional().map_err(e)?;
            if let Some(m) = found { return Ok(m); }
        }
        let t = at.unwrap_or_else(now);
        c.execute("INSERT INTO milestones(character_id,kind,title,data,created_at) VALUES(?1,?2,?3,?4,?5)", params![character_id, kind, title, data, t]).map_err(e)?;
        Ok(Milestone { id: c.last_insert_rowid(), character_id: character_id.into(), kind: kind.into(), title: title.into(), data: data.into(), created_at: t })
    }
    pub fn delete_milestone(&self, id: i64) -> Result<(), String> {
        self.conn.lock().unwrap().execute("DELETE FROM milestones WHERE id=?1", params![id]).map_err(e)?; Ok(())
    }

    pub fn list_feed(&self, limit: i64) -> Result<Vec<FeedPost>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare("SELECT id,character_id,content,image_path,reaction,created_at,is_unread FROM feed_posts ORDER BY id DESC LIMIT ?1").map_err(e)?;
        let mut posts = st.query_map(params![limit], |r| Ok(FeedPost { id: r.get(0)?, character_id: r.get(1)?, content: r.get(2)?, image_path: r.get(3)?,
            reaction: r.get(4)?, created_at: r.get(5)?, is_unread: r.get::<_, i64>(6)? != 0, comments: vec![] })).map_err(e)?
            .collect::<rusqlite::Result<Vec<_>>>().map_err(e)?;
        let mut cs = c.prepare("SELECT id,post_id,from_user,content,created_at FROM feed_comments WHERE post_id=?1 ORDER BY id").map_err(e)?;
        for p in posts.iter_mut() {
            p.comments = cs.query_map(params![p.id], |r| Ok(FeedComment { id: r.get(0)?, post_id: r.get(1)?, from_user: r.get::<_, i64>(2)? != 0, content: r.get(3)?, created_at: r.get(4)? }))
                .map_err(e)?.collect::<rusqlite::Result<Vec<_>>>().map_err(e)?;
        }
        Ok(posts)
    }
    pub fn add_feed_post(&self, character_id: &str, content: &str, image_path: Option<&str>) -> Result<FeedPost, String> {
        let c = self.conn.lock().unwrap();
        let t = now();
        c.execute("INSERT INTO feed_posts(character_id,content,image_path,created_at) VALUES(?1,?2,?3,?4)", params![character_id, content, image_path, t]).map_err(e)?;
        Ok(FeedPost { id: c.last_insert_rowid(), character_id: character_id.into(), content: content.into(), image_path: image_path.map(String::from), reaction: String::new(), created_at: t, is_unread: true, comments: vec![] })
    }
    pub fn set_feed_image(&self, id: i64, path: Option<&str>) -> Result<(), String> {
        self.conn.lock().unwrap().execute("UPDATE feed_posts SET image_path=?2 WHERE id=?1", params![id, path]).map_err(e)?; Ok(())
    }
    pub fn set_feed_reaction(&self, id: i64, reaction: &str) -> Result<(), String> {
        self.conn.lock().unwrap().execute("UPDATE feed_posts SET reaction=?2 WHERE id=?1", params![id, reaction]).map_err(e)?; Ok(())
    }
    pub fn mark_feed_read(&self) -> Result<(), String> {
        self.conn.lock().unwrap().execute("UPDATE feed_posts SET is_unread=0 WHERE is_unread=1", []).map_err(e)?; Ok(())
    }
    pub fn delete_feed_post(&self, id: i64) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM feed_comments WHERE post_id=?1", params![id]).map_err(e)?;
        c.execute("DELETE FROM feed_posts WHERE id=?1", params![id]).map_err(e)?; Ok(())
    }
    pub fn add_feed_comment(&self, post_id: i64, from_user: bool, content: &str) -> Result<FeedComment, String> {
        let c = self.conn.lock().unwrap();
        let t = now();
        c.execute("INSERT INTO feed_comments(post_id,from_user,content,created_at) VALUES(?1,?2,?3,?4)", params![post_id, from_user as i64, content, t]).map_err(e)?;
        Ok(FeedComment { id: c.last_insert_rowid(), post_id, from_user, content: content.into(), created_at: t })
    }

    /// Every picture this character has sent: 1:1 chat, group chats and feed posts, newest first.
    pub fn list_album(&self, character_id: &str) -> Result<Vec<AlbumItem>, String> {
        let c = self.conn.lock().unwrap();
        let mut out = vec![];
        let mut q = |sql: &str, source: &str| -> Result<(), String> {
            let mut st = c.prepare(sql).map_err(e)?;
            let rows = st.query_map(params![character_id], |r| Ok(AlbumItem { source: source.into(), ref_id: r.get(0)?, group_id: r.get(1)?, path: r.get(2)?, caption: r.get(3)?, created_at: r.get(4)? })).map_err(e)?;
            for r in rows { out.push(r.map_err(e)?); }
            Ok(())
        };
        q("SELECT id, NULL, image_path, content, created_at FROM messages WHERE character_id=?1 AND image_path IS NOT NULL", "chat")?;
        q("SELECT id, group_id, image_path, content, created_at FROM group_messages WHERE speaker_id=?1 AND image_path IS NOT NULL", "group")?;
        q("SELECT id, NULL, image_path, content, created_at FROM feed_posts WHERE character_id=?1 AND image_path IS NOT NULL", "feed")?;
        out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(out)
    }
    /// Removes a picture from where it was sent (the message stays). Deletes the file if it lives in data/images.
    pub fn remove_album_item(&self, source: &str, ref_id: i64) -> Result<(), String> {
        let table = match source { "chat" => "messages", "group" => "group_messages", "feed" => "feed_posts", _ => return Err("unknown album source".into()) };
        let path: Option<String> = {
            let c = self.conn.lock().unwrap();
            let p = c.query_row(&format!("SELECT image_path FROM {table} WHERE id=?1"), params![ref_id], |r| r.get::<_, Option<String>>(0)).optional().map_err(e)?.flatten();
            c.execute(&format!("UPDATE {table} SET image_path=NULL WHERE id=?1"), params![ref_id]).map_err(e)?;
            if let Some(p) = &p { c.execute("DELETE FROM images WHERE path=?1", params![p]).map_err(e)?; }
            p
        };
        if let Some(p) = path { let p = PathBuf::from(p); if p.starts_with(self.dir.join("images")) { let _ = std::fs::remove_file(p); } }
        Ok(())
    }
}

type R<T> = Result<T, String>;
#[tauri::command] pub fn list_milestones(db: State<Db>, character_id: Option<String>) -> R<Vec<Milestone>> { db.list_milestones(character_id.as_deref()) }
#[tauri::command] pub fn add_milestone(db: State<Db>, character_id: String, kind: String, title: String, data: String, at: Option<i64>, unique: bool) -> R<Milestone> { db.add_milestone(&character_id, &kind, &title, &data, at, unique) }
#[tauri::command] pub fn delete_milestone(db: State<Db>, id: i64) -> R<()> { db.delete_milestone(id) }
#[tauri::command] pub fn list_feed(db: State<Db>, limit: i64) -> R<Vec<FeedPost>> { db.list_feed(limit) }
#[tauri::command] pub fn add_feed_post(db: State<Db>, character_id: String, content: String, image_path: Option<String>) -> R<FeedPost> { db.add_feed_post(&character_id, &content, image_path.as_deref()) }
#[tauri::command] pub fn set_feed_image(db: State<Db>, id: i64, path: Option<String>) -> R<()> { db.set_feed_image(id, path.as_deref()) }
#[tauri::command] pub fn set_feed_reaction(db: State<Db>, id: i64, reaction: String) -> R<()> { db.set_feed_reaction(id, &reaction) }
#[tauri::command] pub fn mark_feed_read(db: State<Db>) -> R<()> { db.mark_feed_read() }
#[tauri::command] pub fn delete_feed_post(db: State<Db>, id: i64) -> R<()> { db.delete_feed_post(id) }
#[tauri::command] pub fn add_feed_comment(db: State<Db>, post_id: i64, from_user: bool, content: String) -> R<FeedComment> { db.add_feed_comment(post_id, from_user, &content) }
#[tauri::command] pub fn list_album(db: State<Db>, character_id: String) -> R<Vec<AlbumItem>> { db.list_album(&character_id) }
#[tauri::command] pub fn remove_album_item(db: State<Db>, source: String, ref_id: i64) -> R<()> { db.remove_album_item(&source, ref_id) }

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn milestones_unique_and_listed() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().to_path_buf()).unwrap();
        let a = db.add_milestone("c1", "first_met", "You met", "", Some(5), true).unwrap();
        let b = db.add_milestone("c1", "first_met", "dupe", "", None, true).unwrap();
        assert_eq!(a.id, b.id);
        db.add_milestone("c1", "anniversary", "1 month", "met:2026-11", None, true).unwrap();
        db.add_milestone("c2", "first_met", "x", "", None, true).unwrap();
        assert_eq!(db.list_milestones(Some("c1")).unwrap().len(), 2);
        assert_eq!(db.list_milestones(None).unwrap().len(), 3);
    }

    #[test]
    fn feed_and_album() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().to_path_buf()).unwrap();
        let mut c = db.list_characters().unwrap().remove(0);
        c.life = json!({"relationship": "best friend"});
        let c = db.save_character(c).unwrap();
        assert_eq!(c.life["relationship"], "best friend");
        let img = db.images_dir().join("a.png");
        std::fs::write(&img, b"x").unwrap();
        let p = db.add_feed_post(&c.id, "at the cafe", Some(img.to_str().unwrap())).unwrap();
        db.add_feed_comment(p.id, true, "cute!").unwrap();
        db.add_feed_comment(p.id, false, "thanks!").unwrap();
        db.set_feed_reaction(p.id, "\u{2764}").unwrap();
        let f = db.list_feed(10).unwrap();
        assert_eq!((f[0].comments.len(), f[0].reaction.as_str(), f[0].is_unread), (2, "\u{2764}", true));
        db.mark_feed_read().unwrap();
        assert!(!db.list_feed(10).unwrap()[0].is_unread);
        let m = db.add_message(&c.id, "assistant", "[selfie] hi", false).unwrap();
        db.set_message_image(m.id, Some("elsewhere.png")).unwrap();
        let al = db.list_album(&c.id).unwrap();
        assert_eq!(al.len(), 2);
        db.remove_album_item("feed", p.id).unwrap();
        assert!(!img.exists(), "file inside data/images removed");
        assert_eq!(db.list_album(&c.id).unwrap().len(), 1);
        db.delete_feed_post(p.id).unwrap();
        assert!(db.list_feed(10).unwrap().is_empty());
    }
}