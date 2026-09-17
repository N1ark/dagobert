mod store;

use std::path::Path;
use store::{MetaPatch, Note, Project};

#[tauri::command]
fn open_project(path: String) -> Result<Project, String> {
    store::open(Path::new(&path))
}

#[tauri::command]
fn save_note(path: String, note: Note) -> Result<Note, String> {
    store::save_note(Path::new(&path), note)
}

#[tauri::command]
fn delete_note(path: String, file: String, deleted_at: String) -> Result<Option<Note>, String> {
    store::delete_note(Path::new(&path), &file, &deleted_at)
}

#[tauri::command]
fn discard_note(path: String, file: String) -> Result<(), String> {
    store::discard_note(Path::new(&path), &file)
}

#[tauri::command]
fn list_trash(path: String) -> Result<Vec<Note>, String> {
    store::list_trash(Path::new(&path))
}

#[tauri::command]
fn restore_note(path: String, file: String) -> Result<Note, String> {
    store::restore_note(Path::new(&path), &file)
}

#[tauri::command]
fn purge_trash(path: String, file: Option<String>) -> Result<(), String> {
    store::purge_trash(Path::new(&path), file.as_deref())
}

#[tauri::command]
fn save_meta(path: String, meta: MetaPatch) -> Result<(), String> {
    store::save_meta(Path::new(&path), meta)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_project,
            save_note,
            delete_note,
            discard_note,
            list_trash,
            restore_note,
            purge_trash,
            save_meta
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
