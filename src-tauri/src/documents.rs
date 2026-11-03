//! Real files on disk: opening a Word document, a PDF or a markdown file the
//! way Word opens one, and writing a page back over the .docx it came from.
//!
//! The page never names an arbitrary path to read or write. It can reach a
//! file only once the person has handed it over — picked it in a dialog, saved
//! it under a name, or opened it from Explorer — and those paths are kept in
//! `linked-files.json` beside the library, so Ctrl+S on a page opened last week
//! still knows where it goes. The same rule the PDF reader already keeps, made
//! to outlive a restart.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::App;

const LINKED_FILES: &str = "linked-files.json";

/// What can be opened, by extension. A legacy `.doc` is not on it: its binary
/// format needs Word or a converter, and the page says so rather than guessing.
const OPENABLE: [&str; 5] = ["docx", "pdf", "md", "markdown", "txt"];

pub struct Files {
    known: Mutex<HashSet<PathBuf>>,
    record: PathBuf,
    /// Handed over on the command line at launch, waiting for the page to ask.
    launch: Mutex<Vec<PathBuf>>,
}

impl Files {
    pub fn load(data_directory: &Path, launch: Vec<PathBuf>) -> Self {
        let record = data_directory.join(LINKED_FILES);
        let mut known: HashSet<PathBuf> = fs::read_to_string(&record)
            .ok()
            .and_then(|text| serde_json::from_str::<Vec<PathBuf>>(&text).ok())
            .unwrap_or_default()
            .into_iter()
            .collect();
        known.extend(launch.iter().cloned());
        Self { known: Mutex::new(known), record, launch: Mutex::new(launch) }
    }

    pub fn remember(&self, path: &Path) {
        let Ok(mut known) = self.known.lock() else { return };
        if known.insert(path.to_path_buf()) {
            let list: Vec<&PathBuf> = known.iter().collect();
            let _ = fs::write(&self.record, serde_json::to_string(&list).unwrap_or_default());
        }
    }

    fn knows(&self, path: &Path) -> bool {
        self.known.lock().map(|known| known.contains(path)).unwrap_or(false)
    }
}

fn extension(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// The files a command line hands over — Explorer passes the path of a
/// double-clicked document as the first argument.
pub fn openable_arguments(args: impl IntoIterator<Item = String>) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .filter(|path| path.is_file() && OPENABLE.contains(&extension(path).as_str()))
        .collect()
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDocument {
    pub path: String,
    pub name: String,
    /// `docx`, `pdf` or `markdown`.
    pub kind: &'static str,
    /// A .docx, base64.
    pub bytes: Option<String>,
    /// Markdown or plain text.
    pub text: Option<String>,
}

fn read(app: &AppHandle, path: &Path) -> Result<OpenedDocument, String> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let shown = path.to_string_lossy().to_string();
    match extension(path).as_str() {
        "pdf" => {
            // Read by the webview's own viewer through the asset protocol,
            // widened to exactly this one file.
            app.asset_protocol_scope().allow_file(path).map_err(|e| e.to_string())?;
            Ok(OpenedDocument { path: shown, name, kind: "pdf", bytes: None, text: None })
        }
        "docx" => {
            let bytes = fs::read(path).map_err(|e| e.to_string())?;
            Ok(OpenedDocument { path: shown, name, kind: "docx", bytes: Some(BASE64.encode(bytes)), text: None })
        }
        "md" | "markdown" | "txt" => {
            let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
            Ok(OpenedDocument { path: shown, name, kind: "markdown", bytes: None, text: Some(text) })
        }
        _ => Err("PalmaNote opens Word (.docx), PDF and markdown files.".into()),
    }
}

/// Ctrl+O.
#[tauri::command]
pub async fn open_document(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, App>,
) -> Result<Option<OpenedDocument>, String> {
    let documents = window.path().document_dir().unwrap_or_else(|_| PathBuf::from("."));
    let chosen = window
        .dialog()
        .file()
        .set_title("Open")
        .set_directory(&documents)
        .add_filter("Documents", &OPENABLE)
        .add_filter("Word", &["docx"])
        .add_filter("PDF", &["pdf"])
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .blocking_pick_file();
    let Some(path) = chosen.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    state.files.remember(&path);
    read(&app, &path).map(Some)
}

/// The files PalmaNote was launched to open, handed over once.
#[tauri::command]
pub fn launch_documents(state: State<'_, App>) -> Vec<String> {
    state
        .files
        .launch
        .lock()
        .map(|mut launch| launch.drain(..).map(|p| p.to_string_lossy().to_string()).collect())
        .unwrap_or_default()
}

/// A file the page has already been handed — from the launch list, or from a
/// second launch forwarded to this window.
#[tauri::command]
pub fn read_document(app: AppHandle, state: State<'_, App>, path: String) -> Result<OpenedDocument, String> {
    let path = PathBuf::from(path);
    if !state.files.knows(&path) {
        return Err("That file was not opened here.".into());
    }
    read(&app, &path)
}

/// Ctrl+S on a page that came from a .docx: the bytes go back over it.
#[tauri::command]
pub fn save_document(state: State<'_, App>, path: String, bytes: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !state.files.knows(&path) || extension(&path) != "docx" {
        return Err("That file was not opened here.".into());
    }
    let bytes = BASE64.decode(bytes).map_err(|e| e.to_string())?;
    // Written beside and renamed over, so a save that dies halfway leaves the
    // document as it was rather than half of it.
    let partial = path.with_extension("docx.saving");
    fs::write(&partial, bytes).map_err(|e| e.to_string())?;
    fs::rename(&partial, &path).map_err(|e| {
        let _ = fs::remove_file(&partial);
        e.to_string()
    })
}

/// Ctrl+S on a page that has no file yet, which is Word's Save As.
#[tauri::command]
pub async fn save_document_as(
    window: WebviewWindow,
    state: State<'_, App>,
    file_name: String,
    bytes: String,
) -> Result<Option<String>, String> {
    let documents = window.path().document_dir().unwrap_or_else(|_| PathBuf::from("."));
    let chosen = window
        .dialog()
        .file()
        .set_title("Save as a Word document")
        .set_directory(&documents)
        .set_file_name(&file_name)
        .add_filter("Word", &["docx"])
        .blocking_save_file();
    let Some(path) = chosen.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let bytes = BASE64.decode(bytes).map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    state.files.remember(&path);
    Ok(Some(path.to_string_lossy().to_string()))
}
