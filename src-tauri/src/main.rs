#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The desktop shell. Window, database, filesystem — the renderer touches none
//! of them directly, only the commands registered at the bottom of this file.
//!
//! This is the Tauri half of what `electron/main.ts` does. It exists because
//! Electron shipped a 215 MB browser to host a 1.1 MB app; WebView2 is already
//! on the machine.

#[cfg(windows)]
mod clipboard;
mod frac_index;
mod store;
mod types;

use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use store::Store;
use types::*;

/// Nightly, and once shortly after launch so a machine that is never left on
/// still gets one.
const SNAPSHOT_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const WINDOW_STATE_FILE: &str = "window-state.json";

struct App {
    store: Arc<Store>,
    data_directory: PathBuf,
}

type Db<'a> = State<'a, App>;

// ------------------------------------------------------------------ documents

#[tauri::command]
fn list_documents(app: Db<'_>) -> Result<Vec<DocumentMeta>, String> {
    app.store.list_documents()
}

#[tauri::command]
fn get_document(app: Db<'_>, id: String) -> Result<Option<DocumentRecord>, String> {
    app.store.get_document(&id)
}

#[tauri::command]
fn create_document(app: Db<'_>, input: CreateDocumentInput) -> Result<DocumentMeta, String> {
    app.store.create_document(input)
}

#[tauri::command]
fn rename_document(app: Db<'_>, id: String, title: String) -> Result<DocumentMeta, String> {
    app.store.rename_document(&id, &title)
}

#[tauri::command]
fn set_kind(app: Db<'_>, id: String, kind: String) -> Result<DocumentMeta, String> {
    app.store.set_kind(&id, &kind)
}

#[tauri::command]
fn set_favorite(app: Db<'_>, id: String, favorite: bool) -> Result<DocumentMeta, String> {
    app.store.set_favorite(&id, favorite)
}

#[tauri::command]
fn set_icon(app: Db<'_>, id: String, icon: Option<String>) -> Result<DocumentMeta, String> {
    app.store.set_icon(&id, icon)
}

#[tauri::command]
fn set_cover(
    app: Db<'_>,
    id: String,
    cover: Option<String>,
    offset: i64,
) -> Result<DocumentMeta, String> {
    app.store.set_cover(&id, cover, offset)
}

#[tauri::command]
fn save_content(app: Db<'_>, input: SaveContentInput) -> Result<DocumentMeta, String> {
    app.store.save_content(input)
}

#[tauri::command]
fn move_document(app: Db<'_>, input: MoveDocumentInput) -> Result<DocumentMeta, String> {
    app.store.move_document(input)
}

#[tauri::command]
fn archive_document(app: Db<'_>, id: String) -> Result<DocumentMeta, String> {
    app.store.archive_document(&id)
}

#[tauri::command]
fn restore_document(app: Db<'_>, id: String) -> Result<DocumentMeta, String> {
    app.store.restore_document(&id)
}

#[tauri::command]
fn delete_document(app: Db<'_>, id: String) -> Result<Vec<String>, String> {
    app.store.delete_document(&id)
}

#[tauri::command]
fn list_revisions(app: Db<'_>, document_id: String) -> Result<Vec<RevisionRecord>, String> {
    app.store.list_revisions(&document_id)
}

#[tauri::command]
fn prune_revisions(app: Db<'_>) -> Result<usize, String> {
    app.store.prune_revisions()
}

#[tauri::command]
fn backlinks(app: Db<'_>, id: String) -> Result<Vec<Backlink>, String> {
    app.store.backlinks(&id)
}

/// The one thing in the app that leaves it, and the reason it is a command of
/// ours rather than the opener plugin's: what arrives here was typed or pasted
/// into a document, so it is checked before it is handed to the shell.
///
/// Three schemes and no others. `file:` would turn a pasted line into a
/// double-click on anything the account can reach; `javascript:` and `data:`
/// are not addresses at all. Anything else is refused rather than guessed at.
///
/// This opens the machine's browser. It is not the app making a request — the
/// app still holds to `default-src 'self'` and fetches nothing, which is why
/// links are plain links here and never preview cards.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| format!("not a URL: {url}"))?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err(format!("refusing to open a {} link", parsed.scheme()));
    }
    tauri_plugin_opener::open_url(parsed.as_str(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn put_asset(app: Db<'_>, asset: PutAssetInput) -> Result<AssetMeta, String> {
    app.store.put_asset(asset)
}

#[tauri::command]
fn get_asset(app: Db<'_>, id: String) -> Result<Option<AssetRecord>, String> {
    app.store.get_asset(&id)
}

#[tauri::command]
fn collect_assets(app: Db<'_>) -> Result<usize, String> {
    app.store.collect_assets()
}

/// The extension an exported copy of an asset should carry. Mirrors
/// `extensionFor` in `src/editor/assets.ts`.
#[cfg(windows)]
fn extension_for(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "png",
    }
}

/// Puts a gallery's pictures on the clipboard as files.
///
/// The renderer sends ids, not bytes: they are already in the database on this
/// side, and a round trip through base64 for something that is about to be
/// written to disk would be work done twice for no one.
///
/// The files go to a folder of ours under the system temp directory, which is
/// emptied first. What is on the clipboard is a path, so the file has to
/// outlive this call — until the next copy, or until Windows cleans up, which
/// is the same deal every application that copies a file makes.
#[cfg(windows)]
#[tauri::command]
fn copy_images(app: Db<'_>, ids: Vec<String>) -> Result<usize, String> {
    let directory = std::env::temp_dir().join("palmanote-clipboard");
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;

    let mut paths = Vec::new();
    for (index, id) in ids.iter().enumerate() {
        // An asset that has gone is skipped rather than faked: better five
        // files than four files and an empty one.
        let Some((mime, bytes)) = app.store.asset_bytes(id)? else { continue };
        let path = directory.join(format!("palmanote-{}.{}", index + 1, extension_for(&mime)));
        fs::write(&path, bytes).map_err(|e| e.to_string())?;
        paths.push(path);
    }

    if paths.is_empty() {
        return Ok(0);
    }
    clipboard::copy_files(&paths)?;
    Ok(paths.len())
}

/// Everywhere else the renderer's own clipboard write is the whole story.
#[cfg(not(windows))]
#[tauri::command]
fn copy_images(_app: Db<'_>, _ids: Vec<String>) -> Result<usize, String> {
    Err("Copying pictures as files is a Windows shell feature.".into())
}

#[tauri::command]
fn data_directory(app: Db<'_>) -> String {
    app.data_directory.to_string_lossy().to_string()
}

// ---------------------------------------------------------------------- files

fn write_one(target: &PathBuf, file: &ExportFile) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if file.binary {
        let bytes: Vec<u8> = match &file.data {
            Value::Array(items) => items.iter().filter_map(|n| n.as_u64().map(|b| b as u8)).collect(),
            _ => return Err("binary export file did not arrive as bytes".into()),
        };
        fs::write(target, bytes).map_err(|e| e.to_string())
    } else {
        let text = file.data.as_str().ok_or("text export file did not arrive as a string")?;
        fs::write(target, text).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn write_export(
    window: WebviewWindow,
    request: WriteExportRequest,
) -> Result<WriteOutcome, String> {
    let documents = window
        .path()
        .document_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    match &request.folder {
        // A single file: ask where to put it.
        None => {
            let Some(first) = request.files.first() else { return Ok(WriteOutcome::cancelled()) };
            let chosen = window
                .dialog()
                .file()
                .set_title("Export")
                .set_directory(&documents)
                .set_file_name(&first.path)
                .blocking_save_file();
            let Some(path) = chosen.and_then(|p| p.into_path().ok()) else {
                return Ok(WriteOutcome::cancelled());
            };
            write_one(&path, first)?;
            Ok(WriteOutcome {
                written: 1,
                location: Some(path.to_string_lossy().to_string()),
                cancelled: false,
            })
        }
        // A tree: ask for a folder to create it in.
        Some(folder) => {
            let chosen = window
                .dialog()
                .file()
                .set_title("Choose a folder to export into")
                .set_directory(&documents)
                .blocking_pick_folder();
            let Some(root) = chosen.and_then(|p| p.into_path().ok()) else {
                return Ok(WriteOutcome::cancelled());
            };
            let base = root.join(folder);
            for file in &request.files {
                write_one(&base.join(&file.path), file)?;
            }
            Ok(WriteOutcome {
                written: request.files.len(),
                location: Some(base.to_string_lossy().to_string()),
                cancelled: false,
            })
        }
    }
}

/// Text formats are read as UTF-8; anything else comes back as bytes.
fn read_incoming(root: &PathBuf, path: &PathBuf) -> Option<IncomingFile> {
    let name = path.file_name()?.to_string_lossy().to_lowercase();
    if name.starts_with('.') {
        return None;
    }
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/");

    if name.ends_with(".docx") {
        return fs::read(path).ok().map(|bytes| IncomingFile {
            path: relative,
            text: None,
            bytes: Some(bytes),
        });
    }
    if name.ends_with(".md") || name.ends_with(".markdown") || name.ends_with(".txt") || name.ends_with(".json") {
        return fs::read_to_string(path).ok().map(|text| IncomingFile {
            path: relative,
            text: Some(text),
            bytes: None,
        });
    }
    None
}

fn walk(root: &PathBuf, directory: &PathBuf, out: &mut Vec<IncomingFile>) {
    let Ok(entries) = fs::read_dir(directory) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(root, &path, out);
        } else if let Some(file) = read_incoming(root, &path) {
            out.push(file);
        }
    }
}

#[tauri::command]
async fn pick_import(window: WebviewWindow, folder: bool) -> Result<Vec<IncomingFile>, String> {
    let documents = window.path().document_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut out = Vec::new();

    if folder {
        let chosen = window
            .dialog()
            .file()
            .set_title("Choose a folder to import")
            .set_directory(&documents)
            .blocking_pick_folder();
        let Some(root) = chosen.and_then(|p| p.into_path().ok()) else { return Ok(out) };
        walk(&root, &root, &mut out);
    } else {
        let chosen = window
            .dialog()
            .file()
            .set_title("Choose files to import")
            .set_directory(&documents)
            .add_filter("Documents", &["md", "markdown", "txt", "docx", "json"])
            .blocking_pick_files();
        let Some(paths) = chosen else { return Ok(out) };
        for handle in paths {
            let Ok(path) = handle.into_path() else { continue };
            let root = path.parent().map(PathBuf::from).unwrap_or_default();
            if let Some(file) = read_incoming(&root, &path) {
                out.push(file);
            }
        }
    }

    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Copies a snapshot over the live library and restarts.
///
/// The other half of a promise already made: thirty nightly copies are only a
/// backup if there is a way to open one. The current library is set aside
/// first — a restore that destroys what it replaces is not a restore.
#[tauri::command]
async fn restore_snapshot(app: tauri::AppHandle, window: WebviewWindow) -> Result<String, String> {
    let snapshots = window
        .path()
        .document_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("Springboard Snapshots");

    let chosen = window
        .dialog()
        .file()
        .set_title("Open a snapshot")
        .set_directory(&snapshots)
        .add_filter("PalmaNote library", &["sqlite"])
        .blocking_pick_file();
    let Some(source) = chosen.and_then(|p| p.into_path().ok()) else { return Ok(String::new()) };

    let data_directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let live = data_directory.join("springboard.sqlite");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let aside = data_directory.join(format!("palmanote-replaced-{stamp}.sqlite"));

    if live.exists() {
        fs::copy(&live, &aside).map_err(|e| e.to_string())?;
    }
    fs::copy(&source, &live).map_err(|e| e.to_string())?;
    // The write-ahead log belongs to the file it was replaced from.
    let _ = fs::remove_file(data_directory.join("springboard.sqlite-wal"));
    let _ = fs::remove_file(data_directory.join("springboard.sqlite-shm"));

    let message = aside.to_string_lossy().to_string();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        app.restart();
    });
    Ok(message)
}

/// Chooses a PDF and grants the webview permission to read that one file.
///
/// It is rendered in the main window by the viewer already inside WebView2 —
/// `mspdf.dll` ships with the runtime — so zoom, search, print and page
/// navigation all come free and cost nothing to carry. Bundling pdf.js would
/// have been about half the size of the whole application.
///
/// Deliberately a reader and not a reading *feature*: no annotation, no text
/// extraction, no PDFs in the tree. The scope is widened one file at a time,
/// by the person who picked it, rather than opened to the disk.
#[tauri::command]
async fn pick_pdf(window: WebviewWindow, app: tauri::AppHandle) -> Result<Option<OpenedFile>, String> {
    let documents = window.path().document_dir().unwrap_or_else(|_| PathBuf::from("."));
    let chosen = window
        .dialog()
        .file()
        .set_title("Open a PDF")
        .set_directory(&documents)
        .add_filter("PDF", &["pdf"])
        .blocking_pick_file();
    let Some(path) = chosen.and_then(|p| p.into_path().ok()) else { return Ok(None) };

    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;

    Ok(Some(OpenedFile {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "PDF".into()),
        path: path.to_string_lossy().to_string(),
    }))
}

/// Gives the window an icon at the size the shell will actually draw.
///
/// Windows asks the *window* for its taskbar icon, not the file on disk, and
/// scales whatever it is handed. Left alone, Tauri passes on the first frame
/// of whatever `bundle.icon` names first — a 256 or a 16 depending on the
/// order — and the taskbar resamples it to 24. Both look soft, in opposite
/// ways. Handing over the 32 drawn for this purpose makes it a gentle
/// downscale instead, which is the difference the eye actually notices.
fn set_window_icon(window: &WebviewWindow) {
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")) {
        let _ = window.set_icon(icon);
    }
}

// ----------------------------------------------------------------- the window

#[tauri::command]
fn window_state(window: WebviewWindow) -> WindowState {
    WindowState {
        maximized: window.is_maximized().unwrap_or(false),
        full_screen: window.is_fullscreen().unwrap_or(false),
    }
}

#[tauri::command]
fn minimize_window(window: WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
fn toggle_maximize(window: WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
fn close_window(window: WebviewWindow) {
    let _ = window.close();
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

fn restore_bounds(window: &WebviewWindow, path: &PathBuf) {
    let Ok(raw) = fs::read_to_string(path) else { return };
    let Ok(bounds) = serde_json::from_str::<Bounds>(&raw) else { return };
    if bounds.width >= 640 && bounds.height >= 480 {
        let _ = window.set_size(tauri::PhysicalSize::new(bounds.width, bounds.height));
        let _ = window.set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y));
    }
    if bounds.maximized {
        let _ = window.maximize();
    }
}

fn save_bounds(window: &WebviewWindow, path: &PathBuf) {
    let maximized = window.is_maximized().unwrap_or(false);
    // Record where the window sits when it is *not* maximised, so unmaximising
    // after a restart puts it back where it was rather than somewhere default.
    if maximized {
        if let Ok(raw) = fs::read_to_string(path) {
            if let Ok(mut previous) = serde_json::from_str::<Bounds>(&raw) {
                previous.maximized = true;
                let _ = fs::write(path, serde_json::to_string(&previous).unwrap_or_default());
                return;
            }
        }
        return;
    }
    let (Ok(size), Ok(position)) = (window.inner_size(), window.outer_position()) else { return };
    let bounds = Bounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: false,
    };
    let _ = fs::write(path, serde_json::to_string(&bounds).unwrap_or_default());
}

// ------------------------------------------------------------------ boot

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_documents,
            get_document,
            create_document,
            rename_document,
            set_kind,
            set_favorite,
            set_icon,
            set_cover,
            save_content,
            move_document,
            archive_document,
            restore_document,
            delete_document,
            list_revisions,
            prune_revisions,
            backlinks,
            open_external,
            put_asset,
            get_asset,
            collect_assets,
            copy_images,
            data_directory,
            write_export,
            pick_import,
            pick_pdf,
            restore_snapshot,
            window_state,
            minimize_window,
            toggle_maximize,
            close_window,
        ])
        .setup(|app| {
            let data_directory = app.path().app_data_dir()?;
            fs::create_dir_all(&data_directory)?;

            let store = match Store::open(&data_directory.join("springboard.sqlite")) {
                Ok(store) => Arc::new(store),
                Err(error) => {
                    // Without a database there is nothing to show, and a window
                    // that never appears is the worst way to say so.
                    use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind};
                    app.dialog()
                        .message(format!(
                            "{error}\n\nThe library lives at\n{}",
                            data_directory.display()
                        ))
                        .kind(MessageDialogKind::Error)
                        .title("PalmaNote cannot open its library")
                        .buttons(MessageDialogButtons::Ok)
                        .blocking_show();
                    std::process::exit(1);
                }
            };
            let _ = store.prune_revisions();

            // Nightly whole-database copy into Documents.
            let snapshots = app
                .path()
                .document_dir()
                .unwrap_or_else(|_| data_directory.clone())
                .join("Springboard Snapshots");
            let for_thread = store.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(60));
                loop {
                    if let Err(error) = for_thread.snapshot_to(&snapshots) {
                        eprintln!("snapshot failed: {error}");
                    }
                    std::thread::sleep(SNAPSHOT_INTERVAL);
                }
            });

            let window = app.get_webview_window("main").expect("main window");

            set_window_icon(&window);

            let state_path = data_directory.join(WINDOW_STATE_FILE);
            restore_bounds(&window, &state_path);

            // The renderer draws its own caption buttons, so it has to be told
            // when the window is maximised by snapping or by a double-click on
            // the drag region rather than by pressing one of them.
            let watcher = window.clone();
            let watched_path = state_path.clone();
            window.on_window_event(move |event| {
                if matches!(
                    event,
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)
                ) {
                    let _ = watcher.emit(
                        "window:state",
                        WindowState {
                            maximized: watcher.is_maximized().unwrap_or(false),
                            full_screen: watcher.is_fullscreen().unwrap_or(false),
                        },
                    );
                    save_bounds(&watcher, &watched_path);
                }
            });

            app.manage(App { store, data_directory });
            let _ = window.show();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("PalmaNote failed to start");
}
