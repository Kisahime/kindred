//! v1.3 character cards: read Tavern/SillyTavern cards (PNG with a `chara`/`ccv3` text chunk, or JSON)
//! and write V2 PNG cards. Only .png and .json files are touched; nothing leaves the PC.
use crate::db::e;
use base64::Engine;
use serde::Serialize;

type R<T> = Result<T, String>;
const MAX_CARD: u64 = 40 * 1024 * 1024;
const SIG: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardFile { pub kind: String, pub json: String, pub thumb: Option<String> }

fn crc_table() -> [u32; 256] {
    let mut t = [0u32; 256];
    for n in 0..256u32 { let mut c = n; for _ in 0..8 { c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 }; } t[n as usize] = c; }
    t
}
fn crc32(parts: &[&[u8]]) -> u32 {
    let t = crc_table();
    let mut c = 0xFFFF_FFFFu32;
    for p in parts { for &b in *p { c = t[((c ^ b as u32) & 0xFF) as usize] ^ (c >> 8); } }
    c ^ 0xFFFF_FFFF
}

/// (type, data) of every chunk; errors on anything that isn't a well-formed PNG.
pub fn png_chunks(b: &[u8]) -> R<Vec<([u8; 4], Vec<u8>)>> {
    if b.len() < 8 || b[..8] != SIG { return Err("Not a PNG file".into()); }
    let mut out = Vec::new();
    let mut i = 8;
    while i + 12 <= b.len() {
        let len = u32::from_be_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as usize;
        let ty = [b[i + 4], b[i + 5], b[i + 6], b[i + 7]];
        if i + 12 + len > b.len() { return Err("The PNG file is cut short".into()); }
        out.push((ty, b[i + 8..i + 8 + len].to_vec()));
        i += 12 + len;
        if &ty == b"IEND" { break; }
    }
    Ok(out)
}

/// Text chunks by keyword (tEXt, and uncompressed iTXt).
fn text_chunks(chunks: &[([u8; 4], Vec<u8>)]) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (ty, d) in chunks {
        if ty == b"tEXt" {
            if let Some(z) = d.iter().position(|&x| x == 0) {
                out.push((String::from_utf8_lossy(&d[..z]).to_string(), String::from_utf8_lossy(&d[z + 1..]).to_string()));
            }
        } else if ty == b"iTXt" {
            if let Some(z) = d.iter().position(|&x| x == 0) {
                if d.len() > z + 2 && d[z + 1] == 0 {
                    let rest = &d[z + 3..];
                    let mut parts = rest.splitn(3, |&x| x == 0);
                    let (_lang, _tk, text) = (parts.next(), parts.next(), parts.next());
                    if let Some(t) = text { out.push((String::from_utf8_lossy(&d[..z]).to_string(), String::from_utf8_lossy(t).to_string())); }
                }
            }
        }
    }
    out
}

/// The card JSON inside a PNG: `ccv3` wins over `chara`; both are base64 (plain JSON is accepted too).
pub fn card_from_png(b: &[u8]) -> R<String> {
    let texts = text_chunks(&png_chunks(b)?);
    let pick = texts.iter().find(|(k, _)| k == "ccv3").or_else(|| texts.iter().find(|(k, _)| k == "chara"))
        .ok_or("This picture has no character card inside it")?;
    let raw = pick.1.trim();
    let json = match base64::engine::general_purpose::STANDARD.decode(raw.as_bytes()) {
        Ok(bytes) => String::from_utf8(bytes).map_err(|_| "The card text isn't readable".to_string())?,
        Err(_) if raw.starts_with('{') => raw.to_string(),
        Err(_) => return Err("The card inside this picture is damaged".into()),
    };
    serde_json::from_str::<serde_json::Value>(&json).map_err(|x| format!("The card inside this picture is damaged: {x}"))?;
    Ok(json)
}

/// Re-encodes a PNG with one `chara` tEXt chunk (base64 card JSON) before IEND; old card chunks are dropped.
pub fn png_with_card(png: &[u8], card_json: &str) -> R<Vec<u8>> {
    let chunks = png_chunks(png)?;
    let mut out = SIG.to_vec();
    let mut put = |ty: &[u8; 4], d: &[u8]| {
        out.extend_from_slice(&(d.len() as u32).to_be_bytes());
        out.extend_from_slice(ty);
        out.extend_from_slice(d);
        out.extend_from_slice(&crc32(&[ty, d]).to_be_bytes());
    };
    let mut text = b"chara\0".to_vec();
    text.extend_from_slice(base64::engine::general_purpose::STANDARD.encode(card_json.as_bytes()).as_bytes());
    for (ty, d) in &chunks {
        let is_card = (ty == b"tEXt" || ty == b"iTXt" || ty == b"zTXt") && (d.starts_with(b"chara\0") || d.starts_with(b"ccv3\0"));
        if is_card { continue; }
        if ty == b"IEND" { put(b"tEXt", &text); }
        put(ty, d);
    }
    Ok(out)
}

fn thumb_of(bytes: &[u8]) -> Option<String> {
    let img = image::load_from_memory(bytes).ok()?;
    let t = img.thumbnail(256, 256);
    let mut buf = std::io::Cursor::new(Vec::new());
    t.write_to(&mut buf, image::ImageFormat::Png).ok()?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(buf.into_inner())))
}

fn ext_of(path: &str) -> String { std::path::Path::new(path).extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase() }

pub fn read_card(path: &str) -> R<CardFile> {
    let ext = ext_of(path);
    if ext != "png" && ext != "json" { return Err("Pick a .png card or a .json file".into()); }
    if std::fs::metadata(path).map_err(e)?.len() > MAX_CARD { return Err("That file is too big to be a character card".into()); }
    let bytes = std::fs::read(path).map_err(e)?;
    if ext == "json" {
        let json = String::from_utf8(bytes).map_err(|_| "That file isn't readable text".to_string())?;
        serde_json::from_str::<serde_json::Value>(&json).map_err(|x| format!("Not a valid character file: {x}"))?;
        return Ok(CardFile { kind: "json".into(), json, thumb: None });
    }
    let json = card_from_png(&bytes)?;
    Ok(CardFile { kind: "png".into(), json, thumb: thumb_of(&bytes) })
}

fn hex_rgb(s: &str) -> [u8; 3] {
    let h = s.trim_start_matches('#');
    let p = |i: usize| u8::from_str_radix(h.get(i..i + 2).unwrap_or("cc"), 16).unwrap_or(0xcc);
    if h.len() >= 6 { [p(0), p(2), p(4)] } else { [0x9f, 0xd0, 0xf2] }
}

/// Writes `json` as a V2 card: a PNG of the avatar (or a plain colour card) with the card embedded, or plain JSON.
pub fn write_card(path: &str, json: &str, avatar_path: Option<&str>, color: &str) -> R<()> {
    serde_json::from_str::<serde_json::Value>(json).map_err(e)?;
    match ext_of(path).as_str() {
        "json" => std::fs::write(path, json).map_err(e),
        "png" => {
            let img = avatar_path.and_then(|p| image::open(p).ok()).unwrap_or_else(|| {
                let [r, g, b] = hex_rgb(color);
                image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(400, 600, image::Rgb([r, g, b])))
            });
            let mut buf = std::io::Cursor::new(Vec::new());
            img.write_to(&mut buf, image::ImageFormat::Png).map_err(e)?;
            std::fs::write(path, png_with_card(&buf.into_inner(), json)?).map_err(e)
        }
        _ => Err("Save the card as .png or .json".into()),
    }
}

#[tauri::command] pub fn card_read(path: String) -> R<CardFile> { read_card(&path) }
#[tauri::command] pub fn card_write(path: String, json: String, avatar_path: Option<String>, color: String) -> R<()> { write_card(&path, &json, avatar_path.as_deref(), &color) }

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_png() -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(4, 6, image::Rgb([10, 20, 30]))).write_to(&mut buf, image::ImageFormat::Png).unwrap();
        buf.into_inner()
    }

    #[test]
    fn crc_matches_png_spec() { assert_eq!(crc32(&[b"IEND"]), 0xAE42_6082); }

    #[test]
    fn png_card_round_trip_and_v3_preference() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("Mira.png");
        let card = r#"{"spec":"chara_card_v2","data":{"name":"Mira"}}"#;
        write_card(p.to_str().unwrap(), card, None, "#ff8800").unwrap();
        let back = read_card(p.to_str().unwrap()).unwrap();
        assert_eq!(back.kind, "png");
        assert_eq!(back.json, card);
        assert!(back.thumb.unwrap().starts_with("data:image/png;base64,"));
        let bytes = std::fs::read(&p).unwrap();
        assert!(image::load_from_memory(&bytes).is_ok(), "still a valid picture");
        // writing again replaces the card instead of adding a second one
        let again = png_with_card(&bytes, r#"{"name":"Other"}"#).unwrap();
        assert_eq!(text_chunks(&png_chunks(&again).unwrap()).len(), 1);
        // a V3 chunk wins over the V2 one
        let mut v3 = png_with_card(&tiny_png(), card).unwrap();
        let v3json = r#"{"spec":"chara_card_v3","data":{"name":"Mira3"}}"#;
        let mut d = b"ccv3\0".to_vec();
        d.extend_from_slice(base64::engine::general_purpose::STANDARD.encode(v3json).as_bytes());
        let iend = v3.len() - 12;
        let mut chunk = (d.len() as u32).to_be_bytes().to_vec();
        chunk.extend_from_slice(b"tEXt"); chunk.extend_from_slice(&d); chunk.extend_from_slice(&crc32(&[b"tEXt", &d]).to_be_bytes());
        v3.splice(iend..iend, chunk);
        assert_eq!(card_from_png(&v3).unwrap(), v3json);
    }

    #[test]
    fn rejects_non_cards() {
        assert!(card_from_png(b"not a png").is_err());
        assert!(card_from_png(&tiny_png()).unwrap_err().contains("no character card"));
        let t = tempfile::tempdir().unwrap();
        let j = t.path().join("c.json");
        std::fs::write(&j, "{nope").unwrap();
        assert!(read_card(j.to_str().unwrap()).is_err());
        let x = t.path().join("c.exe");
        std::fs::write(&x, "{}").unwrap();
        assert!(read_card(x.to_str().unwrap()).is_err());
        assert!(write_card(x.to_str().unwrap(), "{}", None, "").is_err());
        let ok = t.path().join("c.json");
        write_card(ok.to_str().unwrap(), r#"{"a":1}"#, None, "").unwrap();
        assert_eq!(read_card(ok.to_str().unwrap()).unwrap().json, r#"{"a":1}"#);
    }
}
