mod db;
mod groups;
mod edits;
mod ollama;
mod imagegen;
mod life;
mod voice;
mod economy;
mod databackup;

use db::{Character, Db, Memory, Message, Settings};
use groups::{Group, GroupMessage};
use edits::Template;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

type R<T> = Result<T, String>;

#[tauri::command]
fn list_characters(db: State<Db>) -> R<Vec<Character>> { db.list_characters() }
#[tauri::command]
fn save_character(db: State<Db>, character: Character) -> R<Character> { db.save_character(character) }
#[tauri::command]
fn delete_character(db: State<Db>, id: String) -> R<()> { db.delete_character(&id)?; db.remove_member_everywhere(&id) }
#[tauri::command]
fn list_groups(db: State<Db>) -> R<Vec<Group>> { db.list_groups() }
#[tauri::command]
fn save_group(db: State<Db>, group: Group) -> R<Group> { db.save_group(group) }
#[tauri::command]
fn delete_group(db: State<Db>, id: String) -> R<()> { db.delete_group(&id) }
#[tauri::command]
fn list_group_messages(db: State<Db>, group_id: String) -> R<Vec<GroupMessage>> { db.list_group_messages(&group_id) }
#[tauri::command]
fn add_group_message(db: State<Db>, group_id: String, speaker_id: Option<String>, content: String, is_error: bool) -> R<GroupMessage> {
    db.add_group_message(&group_id, speaker_id.as_deref(), &content, is_error)
}
#[tauri::command]
fn clear_group_messages(db: State<Db>, group_id: String) -> R<()> { db.clear_group_messages(&group_id) }
#[tauri::command]
fn list_messages(db: State<Db>, character_id: String) -> R<Vec<Message>> { db.list_messages(&character_id) }
#[tauri::command]
fn add_message(db: State<Db>, character_id: String, role: String, content: String, is_error: bool) -> R<Message> {
    db.add_message(&character_id, &role, &content, is_error)
}
#[tauri::command]
fn add_proactive_message(db: State<Db>, character_id: String, content: String) -> R<Message> { db.add_proactive_message(&character_id, &content) }
#[tauri::command]
fn recent_messages(db: State<Db>, character_id: String, limit: i64) -> R<Vec<Message>> { db.recent_messages(&character_id, limit) }
#[tauri::command]
fn mark_read(db: State<Db>, character_id: String) -> R<()> { db.mark_read(&character_id) }
#[tauri::command]
fn unread_counts(db: State<Db>) -> R<std::collections::HashMap<String, i64>> { db.unread_counts() }
#[tauri::command]
fn set_mood(db: State<Db>, id: String, mood: String, closeness: i64, personal_message: Option<String>) -> R<Character> { db.set_mood(&id, &mood, closeness, personal_message.as_deref()) }
#[tauri::command]
fn set_summarized_upto(db: State<Db>, id: String, message_id: i64) -> R<()> { db.set_summarized_upto(&id, message_id) }
#[tauri::command]
fn list_memories(db: State<Db>, character_id: String) -> R<Vec<Memory>> { db.list_memories(&character_id) }
#[tauri::command]
fn add_memory(db: State<Db>, character_id: String, content: String, pinned: bool, source: Option<String>) -> R<Option<Memory>> {
    db.add_memory(&character_id, &content, pinned, source.as_deref().unwrap_or(""))
}
#[tauri::command]
fn group_summary_upto(db: State<Db>, group_id: String, character_id: String) -> R<i64> { db.group_summary_upto(&group_id, &character_id) }
#[tauri::command]
fn set_group_summary_upto(db: State<Db>, group_id: String, character_id: String, upto: i64) -> R<()> { db.set_group_summary_upto(&group_id, &character_id, upto) }
#[tauri::command]
fn update_memory(db: State<Db>, id: i64, content: String, pinned: bool) -> R<()> { db.update_memory(id, &content, pinned) }
#[tauri::command]
fn delete_memory(db: State<Db>, id: i64) -> R<()> { db.delete_memory(id) }
#[tauri::command]
fn clear_messages(db: State<Db>, character_id: String) -> R<()> { db.clear_messages(&character_id) }
#[tauri::command]
fn get_settings(db: State<Db>) -> R<Settings> { db.get_settings() }
#[tauri::command]
fn save_settings(db: State<Db>, settings: Settings) -> R<()> { db.save_settings(&settings) }
#[tauri::command]
fn import_avatar(db: State<Db>, src_path: String) -> R<String> { db.import_avatar(&src_path) }
#[tauri::command]
fn avatar_data_url(path: String) -> R<String> { db::avatar_data_url(&path) }
#[tauri::command]
fn export_character(db: State<Db>, id: String, path: String) -> R<()> { db.export_character(&id, &path) }
#[tauri::command]
fn import_character(db: State<Db>, path: String) -> R<Character> { db.import_character(&path) }
#[tauri::command]
fn set_reaction(db: State<Db>, id: i64, reaction: String) -> R<()> { db.set_reaction(id, &reaction) }
#[tauri::command]
fn update_message(db: State<Db>, id: i64, content: String, alternates: Vec<String>, alt_index: i64) -> R<Message> { db.update_message(id, &content, &alternates, alt_index) }
#[tauri::command]
fn delete_message(db: State<Db>, id: i64) -> R<()> { db.delete_message(id) }
#[tauri::command]
fn delete_messages_after(db: State<Db>, character_id: String, id: i64) -> R<usize> { db.delete_messages_after(&character_id, id) }
#[tauri::command]
fn set_group_reaction(db: State<Db>, id: i64, reaction: String, reactor_id: Option<String>) -> R<()> { db.set_group_reaction(id, &reaction, reactor_id.as_deref()) }
#[tauri::command]
fn update_group_message(db: State<Db>, id: i64, content: String, alternates: Vec<String>, alt_index: i64) -> R<GroupMessage> { db.update_group_message(id, &content, &alternates, alt_index) }
#[tauri::command]
fn delete_group_message(db: State<Db>, id: i64) -> R<()> { db.delete_group_message(id) }
#[tauri::command]
fn delete_group_messages_after(db: State<Db>, group_id: String, id: i64) -> R<usize> { db.delete_group_messages_after(&group_id, id) }
#[tauri::command]
fn list_templates(db: State<Db>) -> R<Vec<Template>> { db.list_templates() }
#[tauri::command]
fn save_template(db: State<Db>, name: String, data: serde_json::Value) -> R<Template> { db.save_template(&name, data) }
#[tauri::command]
fn delete_template(db: State<Db>, id: i64) -> R<()> { db.delete_template(id) }
#[tauri::command]
fn set_tray_tooltip(app: AppHandle, text: String) { if let Some(t) = app.tray_by_id("main") { let _ = t.set_tooltip(Some(text)); } }
#[tauri::command]
fn show_main_window(app: AppHandle) { show_main(&app) }
#[tauri::command]
fn set_message_image(db: State<Db>, id: i64, path: Option<String>) -> R<()> { db.set_message_image(id, path.as_deref()) }
#[tauri::command]
fn set_group_message_image(db: State<Db>, id: i64, path: Option<String>) -> R<()> { db.set_group_message_image(id, path.as_deref()) }
#[tauri::command]
fn export_image(src: String, dest: String) -> R<()> { std::fs::copy(&src, &dest).map(|_| ()).map_err(|x| x.to_string()) }

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.unminimize(); let _ = w.set_focus(); }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Kindred", true, None::<&str>)?;
    let online = MenuItem::with_id(app, "status:online", "Online", true, None::<&str>)?;
    let away = MenuItem::with_id(app, "status:away", "Away", true, None::<&str>)?;
    let busy = MenuItem::with_id(app, "status:busy", "Busy", true, None::<&str>)?;
    let offline = MenuItem::with_id(app, "status:offline", "Appear offline", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let (s1, s2) = (PredefinedMenuItem::separator(app)?, PredefinedMenuItem::separator(app)?);
    let menu = Menu::with_items(app, &[&open, &s1, &online, &away, &busy, &offline, &s2, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main").tooltip("Kindred").menu(&menu).show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            id => if let Some(status) = id.strip_prefix("status:") { let _ = app.emit("tray-status", status); },
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev { show_main(tray.app_handle()); }
        });
    if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
    tray.build(app)?;
    Ok(())
}

#[tauri::command]
fn data_dir(db: State<Db>) -> String { db.dir.display().to_string() }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .on_window_event(|w, ev| {
            if let WindowEvent::CloseRequested { api, .. } = ev {
                let s = w.state::<Db>().get_settings();
                if let Ok(s) = s {
                    if s.close_to_tray {
                        api.prevent_close();
                        let _ = w.hide();
                        if !s.tray_hint_shown { let _ = w.emit("hidden-to-tray", ()); }
                    }
                }
            }
        })
        .setup(|app| {
            let dir = db::default_data_dir(app.path().app_data_dir().ok());
            let db = Db::open(dir).map_err(|e| Box::<dyn std::error::Error>::from(e))?;
            app.manage(db);
            build_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ollama::ollama_models, ollama::ollama_chat, ollama::ollama_json,
            list_groups, save_group, delete_group, list_group_messages, add_group_message, clear_group_messages, group_summary_upto, set_group_summary_upto,
            set_mood, set_summarized_upto, list_memories, add_memory, update_memory, delete_memory,
            list_characters, save_character, delete_character,
            list_messages, add_message, clear_messages,
            add_proactive_message, recent_messages, mark_read, unread_counts,
            get_settings, save_settings, import_avatar, avatar_data_url,
            export_character, import_character, data_dir,
            set_reaction, update_message, delete_message, delete_messages_after,
            set_group_reaction, update_group_message, delete_group_message, delete_group_messages_after,
            list_templates, save_template, delete_template, set_tray_tooltip, show_main_window, set_message_image, set_group_message_image, export_image,
            imagegen::sd_engine_info, imagegen::sd_default_engine, imagegen::sd_scan_models, imagegen::sd_busy, imagegen::sd_cancel, imagegen::sd_generate,
            imagegen::kv_get, imagegen::kv_set,
            voice::voice_info, voice::voice_start, voice::voice_stop, voice::voice_tts, voice::voice_stt, voice::set_call_active,
            life::list_milestones, life::add_milestone, life::delete_milestone, life::list_feed, life::add_feed_post, life::set_feed_image,
            life::set_feed_reaction, life::mark_feed_read, life::delete_feed_post, life::add_feed_comment, life::list_album, life::remove_album_item, imagegen::list_images, imagegen::image_for_path, imagegen::delete_image, imagegen::open_images_folder,
            economy::econ_balance, economy::econ_add, economy::econ_history, economy::econ_earned_since, economy::shop_get, economy::shop_set,
            economy::shop_buy, economy::mall_checkout, economy::inventory_update_text, economy::inventory_list, economy::gift_item, economy::sell_item, economy::offer_create, economy::offer_list, economy::offer_resolve, databackup::backup_now, databackup::backup_auto, databackup::backup_list, databackup::backup_restore, databackup::backup_folder, economy::selfie_log
        ])
        .build(tauri::generate_context!())
        .expect("error while building Kindred")
        .run(|_, e| if let tauri::RunEvent::Exit = e { voice::shutdown(); });
}