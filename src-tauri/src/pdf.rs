//! PDF export, written by WebView2 itself — no print dialog.
//!
//! The page lays out what is being exported in a print root and switches the
//! print stylesheet onto it; this asks where to save, and then has the engine
//! that drew it write it to that file. The old route was `window.print()` with
//! "Save as PDF" preselected, under a note that Tauri exposed nothing better.
//! It does: `with_webview` hands over the WebView2 controller, and
//! `ICoreWebView2_7::PrintToPdf` writes a file directly.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::types::WriteOutcome;

/// Long enough for a library of a few hundred pages to lay out.
const PRINT_TIMEOUT: Duration = Duration::from_secs(180);

#[tauri::command]
pub async fn print_pdf(window: WebviewWindow, file_name: String) -> Result<WriteOutcome, String> {
    let documents = window.path().document_dir().unwrap_or_else(|_| PathBuf::from("."));
    let chosen = window
        .dialog()
        .file()
        .set_title("Export as PDF")
        .set_directory(&documents)
        .set_file_name(&file_name)
        .add_filter("PDF", &["pdf"])
        .blocking_save_file();
    let Some(path) = chosen.and_then(|p| p.into_path().ok()) else {
        return Ok(WriteOutcome::cancelled());
    };
    print_to(&window, &path).await?;
    Ok(WriteOutcome {
        written: 1,
        location: Some(path.to_string_lossy().to_string()),
        cancelled: false,
    })
}

#[cfg(windows)]
async fn print_to(window: &WebviewWindow, path: &Path) -> Result<(), String> {
    use std::sync::mpsc;
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7};
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};

    let (done, finished) = mpsc::channel::<Result<(), String>>();
    let target = HSTRING::from(path.as_os_str());

    window
        .with_webview(move |webview| {
            let failed = done.clone();
            // Everything here runs on the window's own thread, which is the
            // only thread WebView2 will talk to; the answer comes back on it
            // too, later, through the handler.
            let started = (|| -> windows::core::Result<()> {
                unsafe {
                    let core: ICoreWebView2_7 = webview.controller().CoreWebView2()?.cast()?;
                    let environment: ICoreWebView2Environment6 = webview.environment().cast()?;
                    let settings = environment.CreatePrintSettings()?;
                    // The URL and date in the margins are a browser's habit,
                    // not a document's.
                    settings.SetShouldPrintHeaderAndFooter(false)?;
                    // Highlights and covers are backgrounds.
                    settings.SetShouldPrintBackgrounds(true)?;
                    // Inches, which is what WebView2 takes them in.
                    settings.SetMarginTop(0.8)?;
                    settings.SetMarginBottom(0.8)?;
                    settings.SetMarginLeft(0.8)?;
                    settings.SetMarginRight(0.8)?;
                    let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
                        let _ = done.send(match result {
                            Ok(()) if ok => Ok(()),
                            Ok(()) => Err("WebView2 could not write the PDF there.".into()),
                            Err(error) => Err(error.to_string()),
                        });
                        Ok(())
                    }));
                    core.PrintToPdf(&target, &settings, &handler)
                }
            })();
            if let Err(error) = started {
                let _ = failed.send(Err(error.to_string()));
            }
        })
        .map_err(|error| error.to_string())?;

    tauri::async_runtime::spawn_blocking(move || finished.recv_timeout(PRINT_TIMEOUT))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|_| "Writing the PDF took too long and was given up on.".to_string())?
}

#[cfg(not(windows))]
async fn print_to(_window: &WebviewWindow, _path: &Path) -> Result<(), String> {
    Err("PDF export is written by WebView2, which is Windows only.".into())
}
