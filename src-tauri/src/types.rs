//! Wire types. These mirror `src/core/types.ts` and `src/data/store.ts` field
//! for field — the renderer is shared between shells, so the JSON crossing the
//! bridge has to look identical whichever one is underneath.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMeta {
    pub id: String,
    pub parent_id: Option<String>,
    pub position: String,
    pub title: String,
    pub kind: String,
    pub favorite: bool,
    pub icon: Option<String>,
    /// Asset id of the page's banner, or none. The same ids `put_asset` writes,
    /// which is why `collect_assets` has to count this reference too.
    pub cover: Option<String>,
    /// Which band of the banner to show, 0–100 down the image. 50 is centred.
    pub cover_offset: i64,
    pub word_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    #[serde(flatten)]
    pub meta: DocumentMeta,
    pub content: Option<Value>,
}

/// One page's references to another. Mirrors `Backlink` in `src/core/types.ts`
/// — the id alone, because the renderer already holds every page's metadata
/// and a copy sent from here would be stale the moment the page is renamed.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub id: String,
    pub count: i64,
    pub context: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RevisionRecord {
    pub id: String,
    pub document_id: String,
    pub content: Option<Value>,
    pub word_count: i64,
    pub created_at: i64,
}

/// A thought stuck to the side of a page. Mirrors `StickyNote` in
/// `src/core/types.ts` — deliberately not part of the document, so it does not
/// export, does not count towards the page's words, and is not in a revision.
///
/// `anchor` holds the id of the comment mark it is attached to, or None for a
/// sticky, which is attached to the page and to nothing in it.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StickyNote {
    pub id: String,
    pub document_id: String,
    pub text: String,
    pub colour: String,
    #[serde(default)]
    pub anchor: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// One day of writing. Mirrors `ActivityDay` in `src/core/types.ts`: `words`
/// is words *touched* rather than gained, and `seconds` is time accrued from
/// the gaps between edits.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDay {
    pub day: String,
    pub words: i64,
    pub seconds: i64,
    pub last_at: i64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecordActivityInput {
    /// Local calendar day, `YYYY-MM-DD`. Worked out by the renderer, which is
    /// the side that knows what day the person thinks it is.
    pub day: String,
    pub words: i64,
    pub at: i64,
}

/// An image, keyed by the SHA-256 of its own bytes.
///
/// `data` is base64 on this side too: the renderer hashes and encodes, and
/// what crosses `invoke` is JSON, where a byte array costs four characters a
/// byte. Decoding happens here only to get the blob into SQLite.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AssetRecord {
    pub id: String,
    pub mime: String,
    pub data: String,
    pub width: i64,
    pub height: i64,
    pub created_at: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AssetMeta {
    pub id: String,
    pub mime: String,
    pub width: i64,
    pub height: i64,
    pub created_at: i64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PutAssetInput {
    pub id: String,
    pub mime: String,
    pub data: String,
    pub width: i64,
    pub height: i64,
}

/// `afterId` carries three meanings, and they are not the same:
/// absent means "append at the end", `null` means "make it the first child",
/// and a string means "put it after that sibling". Serde collapses the first
/// two unless told not to, which is what this is for.
pub fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CreateDocumentInput {
    pub parent_id: Option<String>,
    pub kind: Option<String>,
    pub title: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub after_id: Option<Option<String>>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MoveDocumentInput {
    pub id: String,
    pub parent_id: Option<String>,
    pub after_id: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveContentInput {
    pub id: String,
    pub content: Value,
    pub word_count: i64,
    #[serde(default)]
    pub snapshot: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportFile {
    pub path: String,
    /// A string for text, an array of bytes for anything else. Splitting on a
    /// flag rather than a union keeps the TypeScript side honest about which.
    pub data: Value,
    pub binary: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteExportRequest {
    pub folder: Option<String>,
    pub files: Vec<ExportFile>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    pub written: usize,
    pub location: Option<String>,
    pub cancelled: bool,
}

impl WriteOutcome {
    pub fn cancelled() -> Self {
        Self { written: 0, location: None, cancelled: true }
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IncomingFile {
    /// Relative to whatever was chosen, `/` separated.
    pub path: String,
    pub text: Option<String>,
    /// Bytes, for the formats that are not text. Sent as an array of numbers
    /// because that is what survives the IPC boundary unchanged.
    pub bytes: Option<Vec<u8>>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    pub path: String,
    pub name: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub maximized: bool,
    pub full_screen: bool,
}
