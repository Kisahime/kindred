//! ✨ Sparkles economy: wallet (transaction log), character shop stock, inventories.
use crate::db::{e, now, Db};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

pub fn init_schema(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(r#"
CREATE TABLE IF NOT EXISTS econ_tx (id INTEGER PRIMARY KEY AUTOINCREMENT, amount INTEGER NOT NULL, kind TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS econ_tx_kind ON econ_tx(kind, created_at);
CREATE TABLE IF NOT EXISTS shop_stock (character_id TEXT NOT NULL, day TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(character_id, day));
CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, name TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL DEFAULT 0, wearable INTEGER NOT NULL DEFAULT 0, from_char TEXT NOT NULL DEFAULT '',
  acquired_at INTEGER NOT NULL, gifted_at INTEGER);
CREATE INDEX IF NOT EXISTS inventory_owner ON inventory(owner);
CREATE TABLE IF NOT EXISTS char_offers (id INTEGER PRIMARY KEY AUTOINCREMENT, character_id TEXT NOT NULL, kind TEXT NOT NULL,
  item TEXT NOT NULL DEFAULT '{}', target_id INTEGER, sparkles INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
  message_id INTEGER, created_at INTEGER NOT NULL, resolved_at INTEGER);
CREATE INDEX IF NOT EXISTS char_offers_char ON char_offers(character_id, status);
"#)?;
    // stacks + tags (Shopping Centre); added to older databases without touching rows
    let cols: Vec<String> = c.prepare("PRAGMA table_info(inventory)")?.query_map([], |r| r.get::<_, String>(1))?.collect::<rusqlite::Result<_>>()?;
    if !cols.iter().any(|x| x == "qty") { c.execute("ALTER TABLE inventory ADD COLUMN qty INTEGER NOT NULL DEFAULT 1", [])?; }
    if !cols.iter().any(|x| x == "tags") { c.execute("ALTER TABLE inventory ADD COLUMN tags TEXT NOT NULL DEFAULT ''", [])?; }
    Ok(())
}

/// One basket line from the Shopping Centre (unit price).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BasketLine { pub name: String, pub emoji: String, pub description: String, pub price: i64, pub qty: i64, pub wearable: bool, pub tags: String,
    /// "mall" (default) or "afterdark"
    #[serde(default)] pub source: String }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tx { pub id: i64, pub amount: i64, pub kind: String, pub reason: String, pub created_at: i64 }

/// owner: "me", a character id, or "sold".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item { pub id: i64, pub owner: String, pub name: String, pub emoji: String, pub description: String, pub price: i64,
    pub wearable: bool, pub from_char: String, pub acquired_at: i64, pub gifted_at: Option<i64>, pub qty: i64, pub tags: String }

const ITEM_COLS: &str = "id,owner,name,emoji,description,price,wearable,from_char,acquired_at,gifted_at,qty,tags";
fn item_row(r: &rusqlite::Row) -> rusqlite::Result<Item> {
    Ok(Item { id: r.get(0)?, owner: r.get(1)?, name: r.get(2)?, emoji: r.get(3)?, description: r.get(4)?, price: r.get(5)?,
        wearable: r.get::<_, i64>(6)? != 0, from_char: r.get(7)?, acquired_at: r.get(8)?, gifted_at: r.get(9)?, qty: r.get(10)?, tags: r.get(11)? })
}
fn balance_of(c: &Connection) -> Result<i64, String> {
    c.query_row("SELECT COALESCE(SUM(amount),0) FROM econ_tx", [], |r| r.get(0)).map_err(e)
}
fn add_tx(c: &Connection, amount: i64, kind: &str, reason: &str) -> Result<i64, String> {
    let bal = balance_of(c)?;
    if bal + amount < 0 { return Err(format!("Not enough Sparkles (you have {bal}, need {})", -amount)); }
    if amount != 0 { c.execute("INSERT INTO econ_tx(amount,kind,reason,created_at) VALUES(?1,?2,?3,?4)", params![amount, kind, reason, now()]).map_err(e)?; }
    Ok(bal + amount)
}

/// Something a character offers Alex: a gift ("gift"), to buy one of her items ("buy") or to swap for it ("swap").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Offer { pub id: i64, pub character_id: String, pub kind: String, pub item: Value, pub target_id: Option<i64>, pub sparkles: i64,
    pub status: String, pub message_id: Option<i64>, pub created_at: i64, pub resolved_at: Option<i64> }
const OFFER_COLS: &str = "id,character_id,kind,item,target_id,sparkles,status,message_id,created_at,resolved_at";
fn offer_row(r: &rusqlite::Row) -> rusqlite::Result<Offer> {
    Ok(Offer { id: r.get(0)?, character_id: r.get(1)?, kind: r.get(2)?, item: serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or(Value::Null),
        target_id: r.get(4)?, sparkles: r.get(5)?, status: r.get(6)?, message_id: r.get(7)?, created_at: r.get(8)?, resolved_at: r.get(9)? })
}
fn get_item(c: &Connection, id: i64) -> Result<Option<Item>, String> {
    c.query_row(&format!("SELECT {ITEM_COLS} FROM inventory WHERE id=?1"), params![id], item_row).optional().map_err(e)
}
/// Moves one unit of Alex's item to `to` (splitting stacks). Returns the moved row id.
fn move_one(c: &Connection, it: &Item, to: &str) -> Result<i64, String> {
    if it.qty > 1 {
        c.execute("UPDATE inventory SET qty=qty-1 WHERE id=?1", params![it.id]).map_err(e)?;
        c.execute("INSERT INTO inventory(owner,name,emoji,description,price,wearable,from_char,acquired_at,gifted_at,qty,tags) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10)",
            params![to, it.name, it.emoji, it.description, it.price, it.wearable as i64, it.from_char, it.acquired_at, now(), it.tags]).map_err(e)?;
        return Ok(c.last_insert_rowid());
    }
    c.execute("UPDATE inventory SET owner=?2, gifted_at=?3 WHERE id=?1", params![it.id, to, now()]).map_err(e)?;
    Ok(it.id)
}
fn str_of<'a>(v: &'a Value, k: &str) -> &'a str { v.get(k).and_then(|x| x.as_str()).unwrap_or("") }
fn give_me(c: &Connection, item: &Value, from: &str) -> Result<i64, String> {
    let tags = match item.get("tags") { Some(Value::Array(a)) => a.iter().filter_map(|t| t.as_str()).collect::<Vec<_>>().join(","), Some(Value::String(s)) => s.clone(), _ => String::new() };
    c.execute("INSERT INTO inventory(owner,name,emoji,description,price,wearable,from_char,acquired_at,qty,tags) VALUES('me',?1,?2,?3,?4,?5,?6,?7,1,?8)",
        params![str_of(item, "name"), str_of(item, "emoji"), str_of(item, "description"), item.get("price").and_then(|x| x.as_i64()).unwrap_or(0).max(0),
            item.get("wearable").and_then(|x| x.as_bool()).unwrap_or(false) as i64, from, now(), tags]).map_err(e)?;
    Ok(c.last_insert_rowid())
}

impl Db {
    pub fn offer_create(&self, character_id: &str, kind: &str, item: &Value, target_id: Option<i64>, sparkles: i64, message_id: Option<i64>) -> Result<Offer, String> {
        let c = self.conn.lock().unwrap();
        match kind {
            "gift" => if str_of(item, "name").trim().is_empty() { return Err("A gift needs an item.".into()); },
            "buy" | "swap" => {
                let t = target_id.ok_or("Which item?")?;
                let it = get_item(&c, t)?.ok_or("Item not found")?;
                if it.owner != "me" { return Err("Alex doesn't have that item.".into()); }
                if kind == "buy" && !(1..=5000).contains(&sparkles) { return Err("Odd offer price.".into()); }
                if kind == "swap" && str_of(item, "name").trim().is_empty() { return Err("A swap needs an item.".into()); }
            }
            _ => return Err("Unknown offer kind".into()),
        }
        c.execute("INSERT INTO char_offers(character_id,kind,item,target_id,sparkles,message_id,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![character_id, kind, item.to_string(), target_id, sparkles.max(0), message_id, now()]).map_err(e)?;
        c.query_row(&format!("SELECT {OFFER_COLS} FROM char_offers WHERE id=?1"), params![c.last_insert_rowid()], offer_row).map_err(e)
    }
    pub fn offer_list(&self, character_id: Option<&str>) -> Result<Vec<Offer>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare(&format!("SELECT {OFFER_COLS} FROM char_offers WHERE ?1 IS NULL OR character_id=?1 ORDER BY id DESC LIMIT 500")).map_err(e)?;
        let rows = st.query_map(params![character_id], offer_row).map_err(e)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(e)
    }
    /// Accept or decline, all or nothing. An offer whose item Alex no longer has becomes "expired".
    pub fn offer_resolve(&self, id: i64, accept: bool, who: &str) -> Result<(Offer, i64), String> {
        let mut c = self.conn.lock().unwrap();
        let tx = c.transaction().map_err(e)?;
        let o = tx.query_row(&format!("SELECT {OFFER_COLS} FROM char_offers WHERE id=?1"), params![id], offer_row).optional().map_err(e)?.ok_or("Offer not found")?;
        if o.status != "pending" { return Err(format!("You already answered this ({}).", o.status)); }
        let mut status = if accept { "accepted" } else { "declined" };
        if accept {
            match o.kind.as_str() {
                "gift" => { give_me(&tx, &o.item, &o.character_id)?; }
                "buy" | "swap" => {
                    let it = match o.target_id { Some(t) => get_item(&tx, t)?, None => None };
                    match it.filter(|it| it.owner == "me") {
                        None => status = "expired",
                        Some(it) => {
                            move_one(&tx, &it, &o.character_id)?;
                            if o.kind == "buy" { add_tx(&tx, o.sparkles, "trade", &format!("Sold {} {} to {who}", it.emoji, it.name))?; }
                            else { give_me(&tx, &o.item, &o.character_id)?; }
                        }
                    }
                }
                _ => return Err("Unknown offer kind".into()),
            }
        }
        tx.execute("UPDATE char_offers SET status=?2, resolved_at=?3 WHERE id=?1", params![id, status, now()]).map_err(e)?;
        let o = tx.query_row(&format!("SELECT {OFFER_COLS} FROM char_offers WHERE id=?1"), params![id], offer_row).map_err(e)?;
        let bal = balance_of(&tx)?;
        tx.commit().map_err(e)?;
        Ok((o, bal))
    }
    pub fn econ_balance(&self) -> Result<i64, String> { balance_of(&self.conn.lock().unwrap()) }
    /// Adds (or spends, when negative) Sparkles. Never lets the balance go below zero.
    pub fn econ_add(&self, amount: i64, kind: &str, reason: &str) -> Result<i64, String> { add_tx(&self.conn.lock().unwrap(), amount, kind, reason) }
    pub fn econ_history(&self, limit: i64) -> Result<Vec<Tx>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare("SELECT id,amount,kind,reason,created_at FROM econ_tx ORDER BY id DESC LIMIT ?1").map_err(e)?;
        let rows = st.query_map(params![limit], |r| Ok(Tx { id: r.get(0)?, amount: r.get(1)?, kind: r.get(2)?, reason: r.get(3)?, created_at: r.get(4)? })).map_err(e)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(e)
    }
    /// Positive Sparkles of one kind earned since `since` (ms), for daily caps.
    pub fn econ_earned_since(&self, kind: &str, since: i64) -> Result<i64, String> {
        self.conn.lock().unwrap().query_row("SELECT COALESCE(SUM(amount),0) FROM econ_tx WHERE kind=?1 AND amount>0 AND created_at>=?2", params![kind, since], |r| r.get(0)).map_err(e)
    }
    pub fn shop_get(&self, character_id: &str, day: &str) -> Result<Option<Value>, String> {
        let c = self.conn.lock().unwrap();
        let s: Option<String> = c.query_row("SELECT data FROM shop_stock WHERE character_id=?1 AND day=?2", params![character_id, day], |r| r.get(0)).optional().map_err(e)?;
        Ok(s.and_then(|s| serde_json::from_str(&s).ok()))
    }
    /// Stores a day's stock; old days for that character are dropped (stock rotates daily).
    pub fn shop_set(&self, character_id: &str, day: &str, data: &Value) -> Result<(), String> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM shop_stock WHERE character_id=?1 AND day<>?2", params![character_id, day]).map_err(e)?;
        c.execute("INSERT INTO shop_stock(character_id,day,data) VALUES(?1,?2,?3) ON CONFLICT(character_id,day) DO UPDATE SET data=excluded.data",
            params![character_id, day, data.to_string()]).map_err(e)?;
        Ok(())
    }
    /// Buys stock item `index` at `price`: pays, marks it sold and puts it in Alex's inventory, all or nothing.
    pub fn shop_buy(&self, character_id: &str, day: &str, index: usize, price: i64) -> Result<(Item, i64), String> {
        let mut c = self.conn.lock().unwrap();
        let tx = c.transaction().map_err(e)?;
        let s: String = tx.query_row("SELECT data FROM shop_stock WHERE character_id=?1 AND day=?2", params![character_id, day], |r| r.get(0))
            .optional().map_err(e)?.ok_or("This stall's stock has changed, have another look.")?;
        let mut stock: Value = serde_json::from_str(&s).map_err(e)?;
        let it = stock["items"].get_mut(index).ok_or("That item isn't here any more.")?;
        if it["sold"].as_bool().unwrap_or(false) { return Err("Someone already bought that (you!).".into()); }
        it["sold"] = Value::Bool(true);
        let (name, emoji, desc) = (it["name"].as_str().unwrap_or("Item").to_string(), it["emoji"].as_str().unwrap_or("").to_string(), it["description"].as_str().unwrap_or("").to_string());
        let wearable = it["wearable"].as_bool().unwrap_or(false);
        let bal = add_tx(&tx, -price.max(0), "shop", &format!("Bought {emoji} {name}"))?;
        tx.execute("UPDATE shop_stock SET data=?3 WHERE character_id=?1 AND day=?2", params![character_id, day, stock.to_string()]).map_err(e)?;
        let t = now();
        tx.execute("INSERT INTO inventory(owner,name,emoji,description,price,wearable,from_char,acquired_at) VALUES('me',?1,?2,?3,?4,?5,?6,?7)",
            params![name, emoji, desc, price, wearable as i64, character_id, t]).map_err(e)?;
        let item = Item { id: tx.last_insert_rowid(), owner: "me".into(), name, emoji, description: desc, price, wearable, from_char: character_id.into(), acquired_at: t, gifted_at: None, qty: 1, tags: String::new() };
        tx.commit().map_err(e)?;
        Ok((item, bal))
    }
    /// Shopping Centre checkout: pays the total and stacks each line into Alex's inventory, all or nothing.
    pub fn mall_checkout(&self, lines: &[BasketLine]) -> Result<(Vec<Item>, i64), String> {
        if lines.is_empty() { return Err("Your basket is empty.".into()); }
        if lines.iter().any(|l| l.qty < 1 || l.qty > 99 || l.price < 0) { return Err("Odd basket quantity.".into()); }
        let total: i64 = lines.iter().map(|l| l.price * l.qty).sum();
        let mut c = self.conn.lock().unwrap();
        let tx = c.transaction().map_err(e)?;
        let n: i64 = lines.iter().map(|l| l.qty).sum();
        let bal = add_tx(&tx, -total, "mall", &format!("Shopping Centre: {n} item{}", if n == 1 { "" } else { "s" }))?;
        let mut ids = vec![];
        for l in lines {
            let src = if l.source == "afterdark" { "afterdark" } else { "mall" };
            let have: Option<i64> = tx.query_row("SELECT id FROM inventory WHERE owner='me' AND from_char=?3 AND name=?1 AND price=?2", params![l.name, l.price, src], |r| r.get(0)).optional().map_err(e)?;
            if let Some(id) = have { tx.execute("UPDATE inventory SET qty=qty+?2 WHERE id=?1", params![id, l.qty]).map_err(e)?; ids.push(id); }
            else {
                tx.execute("INSERT INTO inventory(owner,name,emoji,description,price,wearable,from_char,acquired_at,qty,tags) VALUES('me',?1,?2,?3,?4,?5,?9,?6,?7,?8)",
                    params![l.name, l.emoji, l.description, l.price, l.wearable as i64, now(), l.qty, l.tags, src]).map_err(e)?;
                ids.push(tx.last_insert_rowid());
            }
        }
        let items = ids.iter().map(|id| self.item(&tx, *id)).collect::<Result<Vec<_>, _>>()?;
        tx.commit().map_err(e)?;
        Ok((items, bal))
    }
    /// Clearer wording for a generated item; id, owner, price and quantity are kept.
    pub fn inventory_update_text(&self, id: i64, name: &str, emoji: &str, description: &str) -> Result<(), String> {
        self.conn.lock().unwrap().execute("UPDATE inventory SET name=?2, emoji=?3, description=?4 WHERE id=?1", params![id, name, emoji, description]).map_err(e)?;
        Ok(())
    }
    pub fn inventory_list(&self, owner: Option<&str>) -> Result<Vec<Item>, String> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare(&format!("SELECT {ITEM_COLS} FROM inventory WHERE owner<>'sold' AND (?1 IS NULL OR owner=?1) ORDER BY id DESC")).map_err(e)?;
        let rows = st.query_map(params![owner], item_row).map_err(e)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(e)
    }
    fn item(&self, c: &Connection, id: i64) -> Result<Item, String> {
        c.query_row(&format!("SELECT {ITEM_COLS} FROM inventory WHERE id=?1"), params![id], item_row).optional().map_err(e)?.ok_or_else(|| "Item not found".into())
    }
    /// Moves one of Alex's items to a character.
    pub fn gift_item(&self, id: i64, character_id: &str) -> Result<Item, String> {
        let c = self.conn.lock().unwrap();
        let it = self.item(&c, id)?;
        if it.owner != "me" { return Err("You don't have that item any more.".into()); }
        if it.qty > 1 {
            c.execute("UPDATE inventory SET qty=qty-1 WHERE id=?1", params![id]).map_err(e)?;
            c.execute("INSERT INTO inventory(owner,name,emoji,description,price,wearable,from_char,acquired_at,gifted_at,qty,tags) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10)",
                params![character_id, it.name, it.emoji, it.description, it.price, it.wearable as i64, it.from_char, it.acquired_at, now(), it.tags]).map_err(e)?;
            return self.item(&c, c.last_insert_rowid());
        }
        c.execute("UPDATE inventory SET owner=?2, gifted_at=?3 WHERE id=?1", params![id, character_id, now()]).map_err(e)?;
        self.item(&c, id)
    }
    /// Sells one of Alex's items for `price` (kept as owner 'sold' so history stays).
    pub fn sell_item(&self, id: i64, price: i64, to: &str) -> Result<i64, String> {
        let mut c = self.conn.lock().unwrap();
        let tx = c.transaction().map_err(e)?;
        let it = self.item(&tx, id)?;
        if it.owner != "me" { return Err("You don't have that item any more.".into()); }
        if it.qty > 1 { tx.execute("UPDATE inventory SET qty=qty-1 WHERE id=?1", params![id]).map_err(e)?; }
        else { tx.execute("UPDATE inventory SET owner='sold' WHERE id=?1", params![id]).map_err(e)?; }
        let bal = add_tx(&tx, price.max(0), "sell", &format!("Sold {} {} to {to}", it.emoji, it.name))?;
        tx.commit().map_err(e)?;
        Ok(bal)
    }
}

type R<T> = Result<T, String>;
#[tauri::command] pub fn econ_balance(db: State<Db>) -> R<i64> { db.econ_balance() }
#[tauri::command] pub fn econ_add(db: State<Db>, amount: i64, kind: String, reason: String) -> R<i64> { db.econ_add(amount, &kind, &reason) }
#[tauri::command] pub fn econ_history(db: State<Db>, limit: i64) -> R<Vec<Tx>> { db.econ_history(limit) }
#[tauri::command] pub fn econ_earned_since(db: State<Db>, kind: String, since: i64) -> R<i64> { db.econ_earned_since(&kind, since) }
#[tauri::command] pub fn shop_get(db: State<Db>, character_id: String, day: String) -> R<Option<Value>> { db.shop_get(&character_id, &day) }
#[tauri::command] pub fn shop_set(db: State<Db>, character_id: String, day: String, data: Value) -> R<()> { db.shop_set(&character_id, &day, &data) }
#[tauri::command] pub fn shop_buy(db: State<Db>, character_id: String, day: String, index: usize, price: i64) -> R<(Item, i64)> { db.shop_buy(&character_id, &day, index, price) }
#[tauri::command] pub fn mall_checkout(db: State<Db>, lines: Vec<BasketLine>) -> R<(Vec<Item>, i64)> { db.mall_checkout(&lines) }
#[tauri::command] pub fn inventory_update_text(db: State<Db>, id: i64, name: String, emoji: String, description: String) -> R<()> { db.inventory_update_text(id, &name, &emoji, &description) }
#[tauri::command] pub fn inventory_list(db: State<Db>, owner: Option<String>) -> R<Vec<Item>> { db.inventory_list(owner.as_deref()) }
#[tauri::command] pub fn gift_item(db: State<Db>, id: i64, character_id: String) -> R<Item> { db.gift_item(id, &character_id) }
#[tauri::command] pub fn offer_create(db: State<Db>, character_id: String, kind: String, item: Value, target_id: Option<i64>, sparkles: i64, message_id: Option<i64>) -> R<Offer> { db.offer_create(&character_id, &kind, &item, target_id, sparkles, message_id) }
#[tauri::command] pub fn offer_list(db: State<Db>, character_id: Option<String>) -> R<Vec<Offer>> { db.offer_list(character_id.as_deref()) }
#[tauri::command] pub fn offer_resolve(db: State<Db>, id: i64, accept: bool, who: String) -> R<(Offer, i64)> { db.offer_resolve(id, accept, &who) }
#[tauri::command] pub fn sell_item(db: State<Db>, id: i64, price: i64, to: String) -> R<i64> { db.sell_item(id, price, &to) }

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn wallet_never_negative() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().to_path_buf()).unwrap();
        assert_eq!(db.econ_add(50, "daily", "login").unwrap(), 50);
        assert!(db.econ_add(-60, "shop", "x").is_err());
        assert_eq!(db.econ_balance().unwrap(), 50);
        db.econ_add(5, "chat", "a").unwrap(); db.econ_add(5, "chat", "b").unwrap();
        assert_eq!(db.econ_earned_since("chat", 0).unwrap(), 10);
        assert_eq!(db.econ_history(10).unwrap().len(), 3);
    }

    #[test]
    fn mall_stacks_gift_and_sell() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().to_path_buf()).unwrap();
        let line = |q| BasketLine { name: "Rose bouquet".into(), emoji: "\u{1F339}".into(), description: "red".into(), price: 30, qty: q, wearable: false, tags: "romantic".into(), source: String::new() };
        assert!(db.mall_checkout(&[line(2)]).is_err(), "no money");
        assert_eq!(db.econ_balance().unwrap(), 0, "nothing charged");
        db.econ_add(200, "daily", "").unwrap();
        let (items, bal) = db.mall_checkout(&[line(2)]).unwrap();
        assert_eq!((bal, items[0].qty, items[0].tags.as_str()), (140, 2, "romantic"));
        let (items, _) = db.mall_checkout(&[line(1)]).unwrap();
        assert_eq!(items[0].qty, 3, "stacked");
        let g = db.gift_item(items[0].id, "c1").unwrap();
        assert_eq!((g.owner.as_str(), g.qty), ("c1", 1));
        assert_eq!(db.inventory_list(Some("me")).unwrap()[0].qty, 2);
        db.sell_item(items[0].id, 12, "the Shopping Centre").unwrap();
        db.sell_item(items[0].id, 12, "the Shopping Centre").unwrap();
        assert!(db.inventory_list(Some("me")).unwrap().is_empty());
        assert!(db.sell_item(items[0].id, 12, "x").is_err());
        assert!(db.mall_checkout(&[line(0)]).is_err());
        let mut ad = line(1); ad.name = "Silk blindfold".into(); ad.tags = "18+,romantic".into(); ad.source = "afterdark".into();
        let (it, _) = db.mall_checkout(&[ad]).unwrap();
        assert_eq!((it[0].from_char.as_str(), it[0].tags.as_str()), ("afterdark", "18+,romantic"));
        db.inventory_update_text(it[0].id, "Silk Blindfold", "\u{1F576}", "A black silk blindfold.").unwrap();
        let after = db.inventory_list(Some("me")).unwrap().into_iter().find(|x| x.id == it[0].id).unwrap();
        assert_eq!((after.name.as_str(), after.price, after.qty), ("Silk Blindfold", it[0].price, it[0].qty));
    }

    #[test]
    fn buy_gift_sell() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().to_path_buf()).unwrap();
        db.shop_set("c1", "2026-10-13", &json!({"items": [{"name": "Scarf", "emoji": "🧣", "description": "wool", "price": 40, "wearable": true}, {"name": "Book", "price": 999}]})).unwrap();
        assert!(db.shop_buy("c1", "2026-10-13", 0, 40).is_err(), "no money");
        db.econ_add(100, "daily", "").unwrap();
        let (it, bal) = db.shop_buy("c1", "2026-10-13", 0, 40).unwrap();
        assert_eq!((bal, it.wearable, it.owner.as_str()), (60, true, "me"));
        assert!(db.shop_buy("c1", "2026-10-13", 0, 40).is_err(), "sold once");
        assert_eq!(db.shop_get("c1", "2026-10-13").unwrap().unwrap()["items"][0]["sold"], true);
        let g = db.gift_item(it.id, "c1").unwrap();
        assert_eq!(g.owner, "c1");
        assert!(g.gifted_at.is_some());
        assert!(db.gift_item(it.id, "c2").is_err());
        assert_eq!(db.inventory_list(Some("c1")).unwrap().len(), 1);
        db.econ_add(100, "daily", "").unwrap();
        db.shop_set("c1", "2026-10-14", &json!({"items": [{"name": "Mug", "price": 20}]})).unwrap();
        assert!(db.shop_get("c1", "2026-10-13").unwrap().is_none(), "old day rotated out");
        let (m, _) = db.shop_buy("c1", "2026-10-14", 0, 20).unwrap();
        assert_eq!(db.sell_item(m.id, 10, "c1").unwrap(), 150);
        assert!(db.sell_item(m.id, 10, "c1").is_err());
        assert_eq!(db.inventory_list(Some("me")).unwrap().len(), 0);
    }
}

/// Appends one sanitised line to `<data>/logs/selfie.log` (fixed file name; newlines flattened, length capped).
pub fn append_selfie_log(dir: &std::path::Path, line: &str) -> std::io::Result<()> {
    use std::io::Write;
    let p = dir.join("logs").join("selfie.log");
    std::fs::create_dir_all(p.parent().unwrap_or(&p))?;
    let clean: String = line.replace(['\r', '\n'], " ").chars().take(8000).collect();
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&p)?;
    writeln!(f, "{clean}")
}

/// Selfie prompt log (with the resolved gift), written to data\logs\selfie.log.
#[tauri::command]
pub fn selfie_log(db: tauri::State<'_, crate::db::Db>, line: String) -> Result<(), String> {
    append_selfie_log(&db.dir, &line).map_err(|e| e.to_string())
}

#[cfg(test)]
mod selfie_log_tests {
    #[test]
    fn economy_selfie_log_appends_flat_lines() {
        let d = std::env::temp_dir().join(format!("cai_selfielog_{}", std::process::id()));
        super::append_selfie_log(&d, "a\nb").unwrap();
        super::append_selfie_log(&d, "c").unwrap();
        let s = std::fs::read_to_string(d.join("logs").join("selfie.log")).unwrap();
        assert_eq!(s.lines().collect::<Vec<_>>(), vec!["a b", "c"]);
        let _ = std::fs::remove_dir_all(&d);
    }
}


#[cfg(test)]
mod offer_tests {
    use crate::db::Db;
    use serde_json::json;
    #[test]
    fn economy_offers_gift_buy_swap() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().to_path_buf()).unwrap();
        db.econ_add(10, "test", "start").unwrap();
        // gift back: accept adds it to Alex's inventory once
        let g = db.offer_create("c1", "gift", &json!({"name": "Cookie tin", "emoji": "x", "price": 30, "tags": ["foodie"]}), None, 0, Some(5)).unwrap();
        let (g2, _) = db.offer_resolve(g.id, true, "Juniper").unwrap();
        assert_eq!(g2.status, "accepted");
        let mine = db.inventory_list(Some("me")).unwrap();
        assert!(mine.iter().any(|i| i.name == "Cookie tin" && i.from_char == "c1" && i.tags == "foodie"));
        assert!(db.offer_resolve(g.id, true, "Juniper").is_err(), "only once");
        // buy: needs Alex's item; accept moves one unit and pays
        let scarf = db.offer_create("c1", "gift", &json!({"name": "Scarf", "price": 40}), None, 0, None).unwrap();
        db.offer_resolve(scarf.id, true, "J").unwrap();
        let sid = db.inventory_list(Some("me")).unwrap().into_iter().find(|i| i.name == "Scarf").unwrap().id;
        assert!(db.offer_create("c2", "buy", &json!({}), Some(sid), 0, None).is_err(), "price required");
        let b = db.offer_create("c2", "buy", &json!({}), Some(sid), 55, None).unwrap();
        let (b2, bal) = db.offer_resolve(b.id, true, "Moss").unwrap();
        assert_eq!((b2.status.as_str(), bal), ("accepted", 65));
        assert!(db.inventory_list(Some("c2")).unwrap().iter().any(|i| i.name == "Scarf"));
        // swap on an item she no longer has -> expired, nothing changes
        let s = db.offer_create("c3", "swap", &json!({"name": "Mug"}), Some(sid), 0, None);
        assert!(s.is_err(), "can't offer for an item she doesn't own");
        let tin = db.inventory_list(Some("me")).unwrap().into_iter().find(|i| i.name == "Cookie tin").unwrap().id;
        let sw = db.offer_create("c3", "swap", &json!({"name": "Mug", "emoji": "m", "price": 20}), Some(tin), 0, None).unwrap();
        let dec = db.offer_create("c3", "buy", &json!({}), Some(tin), 10, None).unwrap();
        assert_eq!(db.offer_resolve(dec.id, false, "Ash").unwrap().0.status, "declined");
        db.gift_item(tin, "c9").unwrap();
        assert_eq!(db.offer_resolve(sw.id, true, "Ash").unwrap().0.status, "expired");
        assert!(!db.inventory_list(Some("me")).unwrap().iter().any(|i| i.name == "Mug"));
        assert_eq!(db.offer_list(Some("c3")).unwrap().len(), 2);
    }
}
