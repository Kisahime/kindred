//! v1.3 protected family characters (under 18): the Rust side of the picture guard. Mirrors src/protect.ts.
//! Every image job passes through `guard`: no picture with people in it may be linked to a protected character,
//! and place-only pictures always carry the no-people negative prompt and no character LoRA.
use crate::imagegen::GenParams;
use serde_json::Value;

pub const NO_PEOPLE_NEG: &str = "people, person, man, woman, girl, boy, child, kid, crowd, figure, character, face, portrait, hands";

/// Under 18 (or no age stored and marked as a child).
pub fn is_protected_minor(appearance: &Value) -> bool {
    match appearance.get("age") {
        Some(v) if !v.is_null() && v.as_str() != Some("") => {
            let n = v.as_f64().or_else(|| v.as_str().and_then(|s| s.trim().parse::<f64>().ok()));
            match n { Some(n) if n > 0.0 => n < 18.0, _ => appearance.get("minor").and_then(|m| m.as_bool()) == Some(true) }
        }
        _ => appearance.get("minor").and_then(|m| m.as_bool()) == Some(true),
    }
}

fn mentions(prompt: &str, name: &str) -> bool {
    let name = name.trim().to_lowercase();
    if name.chars().count() < 2 { return false; }
    let p = prompt.to_lowercase();
    let mut start = 0;
    while let Some(i) = p[start..].find(&name) {
        let a = start + i;
        let b = a + name.len();
        let before = p[..a].chars().next_back().map_or(true, |c| !c.is_alphabetic());
        let after = p[b..].chars().next().map_or(true, |c| !c.is_alphabetic());
        if before && after { return true; }
        start = a + name.len().max(1);
        while start < p.len() && !p.is_char_boundary(start) { start += 1; }
    }
    false
}

/// `minors` = (id, name) of the protected characters. Returns the params to run (place-only ones hardened), or why not.
pub fn guard(params: GenParams, minors: &[(String, String)]) -> Result<GenParams, String> {
    if minors.is_empty() { return Ok(params); }
    let meta = params.meta.clone().unwrap_or(Value::Null);
    let no_people = meta.get("source").and_then(|v| v.as_str()) == Some("place") || meta.get("noPeople").and_then(|v| v.as_bool()) == Some(true);
    if no_people {
        let mut p = params;
        if !p.negative.contains(NO_PEOPLE_NEG) { p.negative = [p.negative.as_str(), NO_PEOPLE_NEG].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join(", "); }
        p.loras.clear();
        return Ok(p);
    }
    let mut ids: Vec<String> = meta.get("characterId").and_then(|v| v.as_str()).map(|s| vec![s.to_string()]).unwrap_or_default();
    if let Some(arr) = meta.get("people").and_then(|v| v.as_array()) { ids.extend(arr.iter().filter_map(|v| v.as_str().map(String::from))); }
    if let Some((_, name)) = minors.iter().find(|(id, _)| ids.contains(id)) {
        return Err(format!("{name} is under 18 and protected, so there are never pictures of them."));
    }
    if let Some((_, name)) = minors.iter().find(|(_, n)| mentions(&params.prompt, n)) {
        return Err(format!("This prompt mentions {name}, who is under 18 and protected: pictures of them can't be made."));
    }
    Ok(params)
}

pub fn minors_of(chars: &[crate::db::Character]) -> Vec<(String, String)> {
    chars.iter().filter(|c| is_protected_minor(&c.appearance)).map(|c| (c.id.clone(), c.name.clone())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn p(prompt: &str, meta: Value) -> GenParams { GenParams { prompt: prompt.into(), negative: "blurry".into(), meta: Some(meta), loras: vec![crate::imagegen::Lora { path: "x".into(), strength: 1.0 }], ..Default::default() } }
    fn kids() -> Vec<(String, String)> { vec![("k1".into(), "Tom".into())] }

    #[test]
    fn ages() {
        assert!(is_protected_minor(&json!({"age": 9})));
        assert!(is_protected_minor(&json!({"age": "12"})));
        assert!(!is_protected_minor(&json!({"age": 18})));
        assert!(!is_protected_minor(&json!({})));
        assert!(is_protected_minor(&json!({"minor": true})));
    }

    #[test]
    fn refuses_people_pictures_of_protected_characters() {
        assert!(guard(p("portrait", json!({"source": "selfie", "characterId": "k1"})), &kids()).unwrap_err().contains("Tom is under 18"));
        assert!(guard(p("group", json!({"source": "scene", "people": ["a1", "k1"]})), &kids()).is_err());
        assert!(guard(p("Tom playing in the park", json!({"source": "studio"})), &kids()).unwrap_err().contains("mentions Tom"));
        assert!(guard(p("tomato soup still life", json!({"source": "studio"})), &kids()).is_ok(), "word match only");
        assert!(guard(p("portrait of Ella", json!({"source": "selfie", "characterId": "a1"})), &kids()).is_ok());
        assert!(guard(p("Tom", json!({"source": "studio"})), &[]).is_ok(), "no protected characters: unchanged");
    }

    #[test]
    fn place_only_pictures_are_hardened() {
        let out = guard(p("empty park", json!({"source": "scene", "characterId": "k1", "noPeople": true})), &kids()).unwrap();
        assert!(out.negative.contains(NO_PEOPLE_NEG)); assert!(out.loras.is_empty());
        let bg = guard(p("cafe", json!({"source": "place"})), &kids()).unwrap();
        assert!(bg.negative.starts_with("blurry, people"));
    }
}
