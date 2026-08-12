//! Putting several pictures on the Windows clipboard at once.
//!
//! The clipboard holds one bitmap. That is not a limitation of the app or of
//! the web platform — it is what `CF_BITMAP` is, one image — and it is why
//! "copy these six pictures" cannot be six calls to the ordinary copy.
//!
//! What can hold six is a *file list*: `CF_HDROP` is what Explorer puts down
//! when you copy files, and what every file field, upload box and image editor
//! reads. So the pictures are written to a temporary folder and the clipboard
//! is given their paths. Alongside it, in the same clipboard session, goes an
//! `HTML Format` fragment pointing at those same files, which is what Word,
//! Outlook and a mail composer read — paste there and the pictures arrive
//! inline rather than as attachments.
//!
//! Both formats, one write: a clipboard can hold a piece in as many flavours
//! as it likes, and the target picks. Writing them separately would mean the
//! second `EmptyClipboard` threw the first away.

use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use windows::core::w;
use windows::Win32::Foundation::{HANDLE, POINT};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::CF_HDROP;
use windows::Win32::UI::Shell::DROPFILES;

/// Puts the files down as a file list and as inline HTML.
pub fn copy_files(paths: &[PathBuf]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let drop = hdrop(paths);
    let html = html_fragment(paths);

    unsafe {
        // `None` takes the clipboard without naming an owner window. Another
        // process can be holding it — a paste in flight elsewhere — and the
        // honest answer then is to say so rather than to spin.
        OpenClipboard(None).map_err(|error| format!("The clipboard is busy ({error})."))?;

        let outcome = (|| {
            EmptyClipboard().map_err(|error| error.to_string())?;
            put(u32::from(CF_HDROP.0), &drop)?;
            // A registered format rather than a numbered one; the id it comes
            // back with differs per session, which is why it is asked for here
            // and not written down as a constant.
            let html_format = RegisterClipboardFormatW(w!("HTML Format"));
            if html_format != 0 {
                put(html_format, &html)?;
            }
            Ok(())
        })();

        let _ = CloseClipboard();
        outcome
    }
}

/// Hands one flavour to the clipboard, which then owns the memory.
///
/// Deliberately no free on the failure path: after `SetClipboardData` succeeds
/// the block belongs to the system and freeing it would be a double free, and
/// the only way to reach the other branch is a clipboard that has already gone
/// wrong once. A few kilobytes is the right price for not guessing which.
unsafe fn put(format: u32, bytes: &[u8]) -> Result<(), String> {
    let block = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|error| error.to_string())?;
    let target = GlobalLock(block);
    if target.is_null() {
        return Err("Windows would not lend the clipboard any memory.".into());
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), target.cast::<u8>(), bytes.len());
    // Returns false — and so `Err` here — when the lock count reaches zero,
    // which is the ordinary case and not a failure.
    let _ = GlobalUnlock(block);
    SetClipboardData(format, Some(HANDLE(block.0))).map_err(|error| error.to_string())?;
    Ok(())
}

/// A `DROPFILES` header followed by wide paths, each ended with a NUL and the
/// whole list ended with one more. This is the shape Explorer itself writes.
fn hdrop(paths: &[PathBuf]) -> Vec<u8> {
    let header = DROPFILES {
        pFiles: std::mem::size_of::<DROPFILES>() as u32,
        pt: POINT { x: 0, y: 0 },
        fNC: false.into(),
        fWide: true.into(),
    };

    let mut bytes = Vec::new();
    bytes.extend_from_slice(unsafe {
        std::slice::from_raw_parts(
            std::ptr::from_ref(&header).cast::<u8>(),
            std::mem::size_of::<DROPFILES>(),
        )
    });
    for path in paths {
        for unit in path.as_os_str().encode_wide() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes.extend_from_slice(&0u16.to_le_bytes());
    }
    bytes.extend_from_slice(&0u16.to_le_bytes());
    bytes
}

/// The `HTML Format` payload: a header of byte offsets, then the markup.
///
/// The offsets are counted in bytes from the start of this buffer, and they
/// have to be right — a reader trusts them over the markup. Ten fixed digits
/// each, so writing the real numbers cannot change the length of the header
/// they are being measured against.
fn html_fragment(paths: &[PathBuf]) -> Vec<u8> {
    let mut fragment = String::from("<div>");
    for path in paths {
        fragment.push_str(&format!("<img src=\"{}\">", file_url(path)));
    }
    fragment.push_str("</div>");

    let prefix = "<html><body>\r\n<!--StartFragment-->";
    let suffix = "<!--EndFragment-->\r\n</body></html>";
    let header = |start_html: usize, end_html: usize, start: usize, end: usize| {
        format!(
            "Version:0.9\r\nStartHTML:{start_html:010}\r\nEndHTML:{end_html:010}\r\nStartFragment:{start:010}\r\nEndFragment:{end:010}\r\n"
        )
    };

    let length = header(0, 0, 0, 0).len();
    let start_fragment = length + prefix.len();
    let end_fragment = start_fragment + fragment.len();
    let end_html = end_fragment + suffix.len();

    let mut out =
        header(length, end_html, start_fragment, end_fragment).into_bytes();
    out.extend_from_slice(prefix.as_bytes());
    out.extend_from_slice(fragment.as_bytes());
    out.extend_from_slice(suffix.as_bytes());
    // Readers expect this to be a C string; the offsets above exclude it.
    out.push(0);
    out
}

/// `file:///C:/…`, with everything a URL cannot carry percent-encoded.
///
/// The temporary folder sits under the account's own name, which can be
/// anything at all — a space, an accent, a character outside Latin-1 — and a
/// path written raw into an `src` would break on every one of them.
fn file_url(path: &Path) -> String {
    let mut out = String::from("file:///");
    for byte in path.to_string_lossy().replace('\\', "/").bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' | b':' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_offsets_point_at_the_fragment() {
        let bytes = html_fragment(&[PathBuf::from("C:\\tmp\\one.png")]);
        let text = String::from_utf8(bytes[..bytes.len() - 1].to_vec()).expect("utf-8");

        let read = |label: &str| -> usize {
            let at = text.find(label).expect("label") + label.len();
            text[at..at + 10].parse().expect("number")
        };

        // What the header promises is where the fragment actually is.
        assert_eq!(&text[read("StartFragment:")..read("EndFragment:")], "<div><img src=\"file:///C:/tmp/one.png\"></div>");
        assert_eq!(read("EndHTML:"), text.len());
        assert!(text[read("StartHTML:")..].starts_with("<html>"));
    }

    #[test]
    fn awkward_paths_survive_the_url() {
        assert_eq!(
            file_url(Path::new("C:\\Users\\Ana Lú\\one two.png")),
            "file:///C:/Users/Ana%20L%C3%BA/one%20two.png"
        );
    }

    #[test]
    fn a_drop_list_ends_with_two_nulls() {
        let bytes = hdrop(&[PathBuf::from("C:\\a.png"), PathBuf::from("C:\\b.png")]);
        assert_eq!(&bytes[bytes.len() - 4..], &[0, 0, 0, 0]);
        // The header says where the names start, and nothing may sit between.
        assert_eq!(
            u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize,
            std::mem::size_of::<DROPFILES>()
        );
    }
}
