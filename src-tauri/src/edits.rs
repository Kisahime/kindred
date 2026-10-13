//! Reactions, alternates (regenerate/swipe), edits, deletes and character templates.
use crate::db::{e, now, Db, Message};
use crate::groups::{row_gm, GroupMessage, GM_COLS};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: i64,
    pub name: String,
    /// Character fields (same shape as an exported character).
    pub data: Value,
    pub created_at: i64,
}

pub fn init_schema(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);")
}

fn alt_state(content: &str, alternates: &[String], alt_index: i64) -> Result<(String, String, i64), String> {
    if alternates.is_empty() { return Ok((content.to_string(), "[]".into(), 0)); }
    let i = alt_index.clamp(0, alternates.len() as i64 - 1);
    Ok((alternates[i as usize].clone(), serde_json::to_string(alternates).map_err(e)?, i))
}

impl Db {
    pub fn set_message_image(&self, id: i64, path: Option<&str>) -> Result<(), String> {
        self.conn.lock().unwrap().execute("UPDATE messages SET image_path=?2 WHERE id=?1", params![id, path]).map_err(e)?; Ok(())
    }
    pub fn set_group_message_image(&self, id: i64, path: Option<&str>) -> Result<(), String> {
        self.conn.lock().unwrap().execute("UPDATE group_messages SET image_path=?2 WHERE id=?1", params![id, path]).map_err(e)?; Ok(())
    }
    pub fn get_message(&self, id: i64) -> Result<Option<Message>, String> {
        Ok(self.list_messages_where("id=?1", params![id])?.pop())
    }
    fn list_messages_where(&self, cond: &str, p: impl rusqlite::Params) -> Result<Vec<Message>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare(&format!("SELECT id,character_id,role,content,created_at,is_error,is_unread,is_proactive,reaction,alternates,alt_index,image_path FROM messages WHERE {cond} ORDER BY id")).map_err(e)?;
        let rows = st.query_map(p, |r| Ok(Message {
            id: r.get(0)?, character_id: r.get(1)?, role: r.get(2)?, content: r.get(3)?, created_at: r.get(4)?,
            is_error: r.get::<_, i64>(5)? != 0, is_unread: r.get::<_, i64>(6)? != 0, is_proactive: r.get::<_, i64>(7)? != 0,
            reaction: r.get(8)?, alternates: serde_json::from_str(&r.get::<_, String>(9)?).unwrap_or_default(), alt_index: r.get(10)?,
            image_path: r.get(11)?,
        })).map_err(e)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(e)
    }

    pub fn set_reaction(&self, id: i64, reaction: &str) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("UPDATE messages SET reaction=?2 WHERE id=?1", params![id, reaction.trim()]).map_err(e)?;
        Ok(())
    }

    /// Replace content (and optionally the list of alternates + chosen index). Content follows the chosen alternate.
    pub fn update_message(&self, id: i64, content: &str, alternates: &[String], alt_index: i64) -> Result<Message, String> {
        let (content, alts, i) = alt_state(content, alternates, alt_index)?;
        if content.trim().is_empty() { return Err("Message cannot be empty".into()); }
        {
            let c = self.conn.lock().unwrap();
            c.execute("UPDATE messages SET content=?2, alternates=?3, alt_index=?4, is_error=0 WHERE id=?1", params![id, content, alts, i]).map_err(e)?;
        }
        self.get_message(id)?.ok_or_else(|| "Message not found".into())
    }

    pub fn delete_message(&self, id: i64) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM messages WHERE id=?1", [id]).map_err(e)?;
        Ok(())
    }

    /// Deletes every message after `id` in this chat (used when editing and regenerating).
    pub fn delete_messages_after(&self, character_id: &str, id: i64) -> Result<usize, String> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM messages WHERE character_id=?1 AND id>?2", params![character_id, id]).map_err(e)
    }

    // ---- groups ----
    pub fn get_group_message(&self, id: i64) -> Result<Option<GroupMessage>, String> {
        let c = self.conn.lock().unwrap();
        c.query_row(&format!("SELECT {GM_COLS} FROM group_messages WHERE id=?1"), [id], row_gm).optional().map_err(e)
    }
    pub fn set_group_reaction(&self, id: i64, reaction: &str, reactor_id: Option<&str>) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("UPDATE group_messages SET reaction=?2, reactor_id=?3 WHERE id=?1", params![id, reaction.trim(), reactor_id]).map_err(e)?;
        Ok(())
    }
    pub fn update_group_message(&self, id: i64, content: &str, alternates: &[String], alt_index: i64) -> Result<GroupMessage, String> {
        let (content, alts, i) = alt_state(content, alternates, alt_index)?;
        if content.trim().is_empty() { return Err("Message cannot be empty".into()); }
        {
            let c = self.conn.lock().unwrap();
            c.execute("UPDATE group_messages SET content=?2, alternates=?3, alt_index=?4, is_error=0 WHERE id=?1", params![id, content, alts, i]).map_err(e)?;
        }
        self.get_group_message(id)?.ok_or_else(|| "Message not found".into())
    }
    pub fn delete_group_message(&self, id: i64) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM group_messages WHERE id=?1", [id]).map_err(e)?;
        Ok(())
    }
    pub fn delete_group_messages_after(&self, group_id: &str, id: i64) -> Result<usize, String> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM group_messages WHERE group_id=?1 AND id>?2", params![group_id, id]).map_err(e)
    }

    // ---- templates ----
    pub fn list_templates(&self) -> Result<Vec<Template>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare("SELECT id,name,data,created_at FROM templates ORDER BY name").map_err(e)?;
        let rows = st.query_map([], |r| Ok(Template { id: r.get(0)?, name: r.get(1)?,
            data: serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or(Value::Null), created_at: r.get(3)? })).map_err(e)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(e)
    }
    /// Strips per-character state (id, mood, closeness, progress, timestamps) before storing.
    pub fn save_template(&self, name: &str, mut data: Value) -> Result<Template, String> {
        if name.trim().is_empty() { return Err("Template name is required".into()); }
        if let Some(o) = data.as_object_mut() {
            for k in ["id", "mood", "closeness", "moodUpdatedAt", "summarizedUpto", "createdAt", "updatedAt", "proactiveEnabled", "avatarPath"] { o.remove(k); }
        } else { return Err("Template data must be an object".into()); }
        let t = now();
        let c = self.conn.lock().unwrap();
        c.execute("INSERT INTO templates(name,data,created_at) VALUES(?1,?2,?3)", params![name.trim(), data.to_string(), t]).map_err(e)?;
        Ok(Template { id: c.last_insert_rowid(), name: name.trim().into(), data, created_at: t })
    }
    pub fn delete_template(&self, id: i64) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM templates WHERE id=?1", [id]).map_err(e)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::groups::Group;
    use serde_json::json;

    #[test]
    fn reactions_alternates_edit_delete() {
        let t = tempfile::tempdir().unwrap();
        let db = Db::open(t.path().into()).unwrap();
        let u = db.add_message("mira", "user", "hi", false).unwrap();
        let a = db.add_message("mira", "assistant", "hello", false).unwrap();
        db.add_message("mira", "user", "later", false).unwrap();
        db.set_reaction(a.id, "\u{2764}\u{FE0F}").unwrap();
        db.set_reaction(u.id, "\u{1F44D}").unwrap();
        assert_eq!(db.get_message(a.id).unwrap().unwrap().reaction, "\u{2764}\u{FE0F}");
        let alts = vec!["hello".to_string(), "heyy :)".to_string()];
        let m = db.update_message(a.id, "ignored", &alts, 5).unwrap();
        assert_eq!((m.content.as_str(), m.alt_index, m.alternates.len()), ("heyy :)", 1, 2), "content follows clamped choice");
        assert_eq!(db.update_message(u.id, "hi there", &[], 0).unwrap().content, "hi there");
        assert!(db.update_message(u.id, "  ", &[], 0).is_err());
        assert_eq!(db.delete_messages_after("mira", u.id).unwrap(), 2);
        assert_eq!(db.list_messages("mira").unwrap().len(), 1);
        db.delete_message(u.id).unwrap();
        assert!(db.list_messages("mira").unwrap().is_empty());
    }

    #[test]
    fn group_reactions_and_alternates() {
        let t = tempfile::tempdir().unwrap();
        let db = Db::open(t.path().into()).unwrap();
        let g = db.save_group(Group { id: String::new(), name: "G".into(), avatar: String::new(), color: String::new(),
            member_ids: vec!["mira".into(), "rex".into()], created_at: 0, updated_at: 0 }).unwrap();
        let u = db.add_group_message(&g.id, None, "hi", false).unwrap();
        let r = db.add_group_message(&g.id, Some("rex"), "yo", false).unwrap();
        db.set_group_reaction(u.id, "\u{1F602}", Some("rex")).unwrap();
        db.set_group_reaction(r.id, "\u{1F44D}", None).unwrap();
        let list = db.list_group_messages(&g.id).unwrap();
        assert_eq!(list[0].reactor_id.as_deref(), Some("rex")); assert_eq!(list[1].reactor_id, None);
        let m = db.update_group_message(r.id, "", &["yo".into(), "sup".into()], 1).unwrap();
        assert_eq!(m.content, "sup");
        assert_eq!(db.delete_group_messages_after(&g.id, u.id).unwrap(), 1);
        db.delete_group_message(u.id).unwrap();
        assert!(db.list_group_messages(&g.id).unwrap().is_empty());
    }

    #[test]
    fn templates_strip_state() {
        let t = tempfile::tempdir().unwrap();
        let db = Db::open(t.path().into()).unwrap();
        let tpl = db.save_template(" Cosy Baker ", json!({"id": "x", "name": "Bea", "mood": "sad", "closeness": 90, "personality": "kind", "proactiveEnabled": true})).unwrap();
        assert_eq!(tpl.name, "Cosy Baker");
        assert!(tpl.data.get("id").is_none() && tpl.data.get("closeness").is_none() && tpl.data.get("proactiveEnabled").is_none());
        assert_eq!(tpl.data["personality"], "kind");
        assert!(db.save_template("x", json!("nope")).is_err());
        assert_eq!(db.list_templates().unwrap().len(), 1);
        db.delete_template(tpl.id).unwrap();
        assert!(db.list_templates().unwrap().is_empty());
    }
}