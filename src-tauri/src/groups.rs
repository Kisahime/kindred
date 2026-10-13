use crate::db::{new_id, now, Db};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub avatar: String,
    #[serde(default)]
    pub color: String,
    pub member_ids: Vec<String>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GroupMessage {
    pub id: i64,
    pub group_id: String,
    /// None = the user.
    pub speaker_id: Option<String>,
    pub content: String,
    pub created_at: i64,
    pub is_error: bool,
    #[serde(default)]
    pub image_path: Option<String>,
    #[serde(default)]
    pub reaction: String,
    /// Who reacted (None = the user).
    #[serde(default)]
    pub reactor_id: Option<String>,
    #[serde(default)]
    pub alternates: Vec<String>,
    #[serde(default)]
    pub alt_index: i64,
}

pub(crate) const GM_COLS: &str = "id,group_id,speaker_id,content,created_at,is_error,reaction,reactor_id,alternates,alt_index,image_path";
pub(crate) fn row_gm(r: &Row) -> rusqlite::Result<GroupMessage> {
    Ok(GroupMessage { id: r.get(0)?, group_id: r.get(1)?, speaker_id: r.get(2)?, content: r.get(3)?, created_at: r.get(4)?,
        is_error: r.get::<_, i64>(5)? != 0, reaction: r.get(6)?, reactor_id: r.get(7)?,
        alternates: serde_json::from_str(&r.get::<_, String>(8)?).unwrap_or_default(), alt_index: r.get(9)?, image_path: r.get(10)? })
}

pub fn init_schema(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(r#"
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '#9fd0f2',
  member_ids TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS group_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  speaker_id TEXT, content TEXT NOT NULL, created_at INTEGER NOT NULL, is_error INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_group_messages ON group_messages(group_id, id);
CREATE TABLE IF NOT EXISTS group_summary (
  group_id TEXT NOT NULL, character_id TEXT NOT NULL, upto INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, character_id)
);
"#)
}

fn e<E: std::fmt::Display>(err: E) -> String { err.to_string() }

fn row_group(r: &Row) -> rusqlite::Result<Group> {
    let members: String = r.get(4)?;
    Ok(Group { id: r.get(0)?, name: r.get(1)?, avatar: r.get(2)?, color: r.get(3)?,
        member_ids: serde_json::from_str(&members).unwrap_or_default(), created_at: r.get(5)?, updated_at: r.get(6)? })
}
const GCOLS: &str = "id,name,avatar,color,member_ids,created_at,updated_at";

impl Db {
    pub fn list_groups(&self) -> Result<Vec<Group>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare(&format!("SELECT {GCOLS} FROM groups ORDER BY created_at, name")).map_err(e)?;
        let rows = st.query_map([], row_group).map_err(e)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(e)
    }

    pub fn get_group(&self, id: &str) -> Result<Option<Group>, String> {
        let c = self.conn.lock().unwrap();
        c.query_row(&format!("SELECT {GCOLS} FROM groups WHERE id=?1"), [id], row_group).optional().map_err(e)
    }

    pub fn save_group(&self, mut g: Group) -> Result<Group, String> {
        if g.name.trim().is_empty() { return Err("Group name is required".into()); }
        g.name = g.name.trim().into();
        let mut seen = std::collections::HashSet::new();
        g.member_ids.retain(|m| seen.insert(m.clone()));
        if g.member_ids.len() < 2 { return Err("Pick at least 2 contacts for a group".into()); }
        if g.id.trim().is_empty() { g.id = format!("g{}", new_id()); }
        if g.color.is_empty() { g.color = "#9fd0f2".into(); }
        let t = now();
        g.created_at = self.get_group(&g.id)?.map(|x| x.created_at).unwrap_or(t);
        g.updated_at = t;
        let members = serde_json::to_string(&g.member_ids).map_err(e)?;
        let c = self.conn.lock().unwrap();
        c.execute(&format!("INSERT INTO groups({GCOLS}) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, avatar=excluded.avatar, color=excluded.color, member_ids=excluded.member_ids, updated_at=excluded.updated_at"),
            params![g.id, g.name, g.avatar, g.color, members, g.created_at, g.updated_at]).map_err(e)?;
        Ok(g)
    }

    pub fn delete_group(&self, id: &str) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM group_messages WHERE group_id=?1", [id]).map_err(e)?;
        c.execute("DELETE FROM group_summary WHERE group_id=?1", [id]).map_err(e)?;
        c.execute("DELETE FROM groups WHERE id=?1", [id]).map_err(e)?;
        Ok(())
    }

    /// Called when a character is deleted. Groups keep their history; members list shrinks.
    pub fn remove_member_everywhere(&self, character_id: &str) -> Result<(), String> {
        for mut g in self.list_groups()? {
            if g.member_ids.iter().any(|m| m == character_id) {
                g.member_ids.retain(|m| m != character_id);
                let members = serde_json::to_string(&g.member_ids).map_err(e)?;
                let c = self.conn.lock().unwrap();
                c.execute("UPDATE groups SET member_ids=?2 WHERE id=?1", params![g.id, members]).map_err(e)?;
            }
        }
        Ok(())
    }

    pub fn list_group_messages(&self, group_id: &str) -> Result<Vec<GroupMessage>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare(&format!("SELECT {GM_COLS} FROM group_messages WHERE group_id=?1 ORDER BY id")).map_err(e)?;
        let rows = st.query_map([group_id], row_gm).map_err(e)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(e)
    }

    pub fn add_group_message(&self, group_id: &str, speaker_id: Option<&str>, content: &str, is_error: bool) -> Result<GroupMessage, String> {
        let t = now();
        let c = self.conn.lock().unwrap();
        c.execute("INSERT INTO group_messages(group_id,speaker_id,content,created_at,is_error) VALUES(?1,?2,?3,?4,?5)",
            params![group_id, speaker_id, content, t, is_error as i64]).map_err(e)?;
        Ok(GroupMessage { id: c.last_insert_rowid(), group_id: group_id.into(), speaker_id: speaker_id.map(String::from),
            content: content.into(), created_at: t, is_error, reaction: String::new(), reactor_id: None, alternates: vec![], alt_index: 0, image_path: None })
    }

    pub fn clear_group_messages(&self, group_id: &str) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM group_messages WHERE group_id=?1", [group_id]).map_err(e)?;
        c.execute("DELETE FROM group_summary WHERE group_id=?1", [group_id]).map_err(e)?;
        Ok(())
    }

    /// Last group message id already folded into this character's memories.
    pub fn group_summary_upto(&self, group_id: &str, character_id: &str) -> Result<i64, String> {
        let c = self.conn.lock().unwrap();
        c.query_row("SELECT upto FROM group_summary WHERE group_id=?1 AND character_id=?2", params![group_id, character_id], |r| r.get(0))
            .optional().map_err(e).map(|v| v.unwrap_or(0))
    }

    pub fn set_group_summary_upto(&self, group_id: &str, character_id: &str, upto: i64) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("INSERT INTO group_summary(group_id,character_id,upto) VALUES(?1,?2,?3)
            ON CONFLICT(group_id,character_id) DO UPDATE SET upto=MAX(upto, excluded.upto)", params![group_id, character_id, upto]).map_err(e)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_crud_messages_and_member_cleanup() {
        let t = tempfile::tempdir().unwrap();
        let db = Db::open(t.path().into()).unwrap();
        let bad = Group { id: String::new(), name: "Solo".into(), avatar: String::new(), color: String::new(),
            member_ids: vec!["mira".into(), "mira".into()], created_at: 0, updated_at: 0 };
        assert!(db.save_group(bad.clone()).is_err(), "needs 2 distinct members");
        let g = db.save_group(Group { name: " Tea Club ".into(), member_ids: vec!["mira".into(), "rex".into(), "elowen".into()], ..bad }).unwrap();
        assert!(g.id.starts_with('g')); assert_eq!(g.name, "Tea Club");
        db.add_group_message(&g.id, None, "hi all", false).unwrap();
        db.add_group_message(&g.id, Some("mira"), "hey!", false).unwrap();
        let m = db.list_group_messages(&g.id).unwrap();
        assert_eq!(m.len(), 2); assert_eq!(m[0].speaker_id, None); assert_eq!(m[1].speaker_id.as_deref(), Some("mira"));
        assert_eq!(db.group_summary_upto(&g.id, "mira").unwrap(), 0);
        db.set_group_summary_upto(&g.id, "mira", 2).unwrap();
        db.set_group_summary_upto(&g.id, "mira", 1).unwrap();
        assert_eq!(db.group_summary_upto(&g.id, "mira").unwrap(), 2);
        assert_eq!(db.group_summary_upto(&g.id, "rex").unwrap(), 0, "tracked per character");
        db.remove_member_everywhere("rex").unwrap();
        assert_eq!(db.get_group(&g.id).unwrap().unwrap().member_ids, vec!["mira".to_string(), "elowen".to_string()]);
        drop(db);
        let db = Db::open(t.path().into()).unwrap(); // persists + schema idempotent
        assert_eq!(db.list_groups().unwrap().len(), 1);
        db.clear_group_messages(&g.id).unwrap();
        assert!(db.list_group_messages(&g.id).unwrap().is_empty());
        assert_eq!(db.group_summary_upto(&g.id, "mira").unwrap(), 0, "clear resets summary progress");
        db.add_group_message(&g.id, None, "x", false).unwrap();
        db.delete_group(&g.id).unwrap();
        assert!(db.list_groups().unwrap().is_empty());
        assert!(db.list_group_messages(&g.id).unwrap().is_empty());
    }
}