//! SQLite, via rusqlite. The port of `electron/sqliteStore.ts`.
//!
//! The schema and every statement are the same as the Electron build's —
//! including the recursive-CTE delete and the window-function retention pass,
//! which are plain SQLite rather than better-sqlite3 idioms and needed no
//! rethinking. A database written by one shell opens in the other.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;

use crate::frac_index::key_between;
use crate::types::{
    ActivityDay, AssetMeta, StickyNote, AssetRecord, Backlink, CreateDocumentInput, DocumentMeta,
    DocumentRecord, MoveDocumentInput, PutAssetInput, RecordActivityInput, RevisionRecord,
    SaveContentInput,
};

const REVISION_COALESCE_MS: i64 = 2 * 60 * 1000;
const SNAPSHOT_KEEP: usize = 30;

/// How long a pause can be and still be writing.
///
/// The third copy of this rule, and the only one that cannot import the other
/// two — `ACTIVE_GAP_MS` and `accrueSeconds` in `src/core/activity.ts` are the
/// definition, and the reasoning for three minutes is written there. If that
/// number moves, this one moves with it.
const ACTIVE_GAP_MS: i64 = 3 * 60 * 1000;

fn accrue_seconds(last_at: i64, at: i64) -> i64 {
    let gap = at - last_at;
    if gap <= 0 || gap > ACTIVE_GAP_MS {
        return 0;
    }
    (gap as f64 / 1000.0).round() as i64
}

const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES documents(id) ON DELETE RESTRICT,
  position    TEXT    NOT NULL,
  title       TEXT    NOT NULL DEFAULT '',
  kind        TEXT    NOT NULL CHECK (kind IN ('folder','chapter','scene','note')),
  favorite    INTEGER NOT NULL DEFAULT 0,
  icon        TEXT,
  cover       TEXT,
  cover_offset INTEGER NOT NULL DEFAULT 50,
  content     TEXT,
  word_count  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS documents_parent_position ON documents (parent_id, position);
CREATE INDEX IF NOT EXISTS documents_archived ON documents (archived_at);

CREATE TABLE IF NOT EXISTS revisions (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content     TEXT,
  word_count  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS revisions_document_created ON revisions (document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assets (
  id         TEXT PRIMARY KEY,
  mime       TEXT    NOT NULL,
  bytes      BLOB    NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  day      TEXT PRIMARY KEY,
  words    INTEGER NOT NULL DEFAULT 0,
  seconds  INTEGER NOT NULL DEFAULT 0,
  last_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sticky_notes (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  text        TEXT    NOT NULL DEFAULT '',
  colour      TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sticky_notes_document ON sticky_notes (document_id);
";

const META_COLUMNS: &str = "id, parent_id, position, title, kind, favorite, icon, cover, cover_offset, word_count, created_at, updated_at, archived_at";

pub type Result<T> = std::result::Result<T, String>;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn parse_content(raw: Option<String>) -> Option<Value> {
    raw.and_then(|text| serde_json::from_str(&text).ok())
}

/// Every asset id an image node in this document points at.
fn collect_asset_ids(node: &Value, into: &mut std::collections::HashSet<String>) {
    if node.get("type").and_then(Value::as_str) == Some("image") {
        if let Some(id) = node.pointer("/attrs/id").and_then(Value::as_str) {
            into.insert(id.to_string());
        }
    }
    if let Some(children) = node.get("content").and_then(Value::as_array) {
        for child in children {
            collect_asset_ids(child, into);
        }
    }
}

/// Long enough for a sentence, short enough that a page of hits stays a list.
/// Matches `CONTEXT_LIMIT` in `src/core/backlinks.ts`.
const CONTEXT_LIMIT: usize = 240;

/// How many times this subtree links to `target`.
fn count_links(node: &Value, target: &str) -> i64 {
    let mut found = i64::from(
        node.get("type").and_then(Value::as_str) == Some("pageLink")
            && node.pointer("/attrs/id").and_then(Value::as_str) == Some(target),
    );
    if let Some(children) = node.get("content").and_then(Value::as_array) {
        for child in children {
            found += count_links(child, target);
        }
    }
    found
}

/// The text of a block, with a link to some *other* page reading as its label.
/// A link to the target itself contributes nothing: the context is there to
/// say what was written around the reference, and repeating the title of the
/// page you are already standing on says nothing.
fn text_of(node: &Value, target: &str, out: &mut String) {
    match node.get("type").and_then(Value::as_str) {
        Some("pageLink") => {
            if node.pointer("/attrs/id").and_then(Value::as_str) != Some(target) {
                out.push_str(node.pointer("/attrs/label").and_then(Value::as_str).unwrap_or(""));
            }
            return;
        }
        // Not words. The same omission the word count makes.
        Some("sceneBreak") | Some("sticker") | Some("image") => return,
        Some("hardBreak") => {
            out.push(' ');
            return;
        }
        _ => {}
    }
    if let Some(text) = node.get("text").and_then(Value::as_str) {
        out.push_str(text);
        return;
    }
    if let Some(children) = node.get("content").and_then(Value::as_array) {
        for child in children {
            text_of(child, target, out);
        }
    }
}

/// Collapses runs of whitespace and caps the length at a word boundary.
fn tidy_context(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= CONTEXT_LIMIT {
        return flat;
    }
    let cut: String = flat.chars().take(CONTEXT_LIMIT).collect();
    let kept = match cut.rfind(' ') {
        Some(at) if at > CONTEXT_LIMIT / 2 => &cut[..at],
        _ => cut.as_str(),
    };
    format!("{}…", kept.trim_end())
}

/// How one body references `target`, or None when it does not.
///
/// The context comes from the first block that links, because that is the one
/// the writer would have scrolled to. Later hits raise the count and nothing
/// else. Mirrors `referencesTo` in `src/core/backlinks.ts`.
fn references_to(content: &Value, target: &str) -> Option<(i64, String)> {
    let blocks = content.get("content")?.as_array()?;
    let mut count = 0;
    let mut context = String::new();
    for block in blocks {
        let hits = count_links(block, target);
        if hits == 0 {
            continue;
        }
        if count == 0 {
            let mut text = String::new();
            text_of(block, target, &mut text);
            context = tidy_context(&text);
        }
        count += hits;
    }
    (count > 0).then_some((count, context))
}

fn meta_from_row(row: &Row<'_>) -> rusqlite::Result<DocumentMeta> {
    Ok(DocumentMeta {
        id: row.get("id")?,
        parent_id: row.get("parent_id")?,
        position: row.get("position")?,
        title: row.get("title")?,
        kind: row.get("kind")?,
        favorite: row.get::<_, i64>("favorite")? == 1,
        icon: row.get("icon")?,
        cover: row.get("cover")?,
        cover_offset: row.get("cover_offset")?,
        word_count: row.get("word_count")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        archived_at: row.get("archived_at")?,
    })
}

/// Adds columns introduced after a library was first created, so an older
/// database opens rather than erroring.
fn migrate(db: &Connection) -> rusqlite::Result<()> {
    let mut statement = db.prepare("PRAGMA table_info(documents)")?;
    let columns: Vec<String> = statement
        .query_map([], |row| row.get::<_, String>("name"))?
        .collect::<rusqlite::Result<_>>()?;
    if !columns.iter().any(|name| name == "icon") {
        db.execute_batch("ALTER TABLE documents ADD COLUMN icon TEXT")?;
    }
    if !columns.iter().any(|name| name == "cover") {
        db.execute_batch("ALTER TABLE documents ADD COLUMN cover TEXT")?;
    }
    if !columns.iter().any(|name| name == "cover_offset") {
        db.execute_batch("ALTER TABLE documents ADD COLUMN cover_offset INTEGER NOT NULL DEFAULT 50")?;
    }
    Ok(())
}

pub struct Store {
    connection: Mutex<Connection>,
}

impl Store {
    pub fn open(file: &Path) -> Result<Self> {
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let connection = Connection::open(file).map_err(|e| e.to_string())?;
        connection.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        migrate(&connection).map_err(|e| e.to_string())?;
        Ok(Self { connection: Mutex::new(connection) })
    }

    fn with<T>(&self, run: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T> {
        let guard = self.connection.lock().map_err(|e| e.to_string())?;
        run(&guard).map_err(|e| e.to_string())
    }

    // ------------------------------------------------------------ reading

    pub fn list_documents(&self) -> Result<Vec<DocumentMeta>> {
        // Projection matters: a novel's worth of JSON never leaves SQLite just
        // to render a list of titles.
        self.with(|db| {
            let mut statement = db.prepare(&format!("SELECT {META_COLUMNS} FROM documents"))?;
            let rows = statement.query_map([], meta_from_row)?;
            rows.collect()
        })
    }

    pub fn get_document(&self, id: &str) -> Result<Option<DocumentRecord>> {
        self.with(|db| {
            db.query_row(
                &format!("SELECT {META_COLUMNS}, content FROM documents WHERE id = ?1"),
                params![id],
                |row| {
                    Ok(DocumentRecord {
                        meta: meta_from_row(row)?,
                        content: parse_content(row.get("content")?),
                    })
                },
            )
            .optional()
        })
    }

    /// Adds one edit to a day's tally and returns the day as it now stands.
    ///
    /// Read then write, both inside one `with` — the mutex is held across the
    /// pair, so two saves landing together cannot each read the same total and
    /// each write it back. The gap rule is `accrue_seconds` above rather than
    /// SQL, so the arithmetic matches the other two shells exactly.
    pub fn record_activity(&self, input: RecordActivityInput) -> Result<ActivityDay> {
        self.with(|db| {
            let existing = db
                .query_row(
                    "SELECT words, seconds, last_at FROM activity WHERE day = ?1",
                    params![input.day],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
                )
                .optional()?;

            let next = match existing {
                Some((words, seconds, last_at)) => ActivityDay {
                    day: input.day.clone(),
                    words: words + input.words,
                    seconds: seconds + accrue_seconds(last_at, input.at),
                    last_at: input.at,
                },
                None => ActivityDay {
                    day: input.day.clone(),
                    words: input.words,
                    seconds: 0,
                    last_at: input.at,
                },
            };

            db.execute(
                "INSERT INTO activity (day, words, seconds, last_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(day) DO UPDATE SET
                   words = excluded.words, seconds = excluded.seconds, last_at = excluded.last_at",
                params![next.day, next.words, next.seconds, next.last_at],
            )?;
            Ok(next)
        })
    }

    pub fn list_stickies(&self, document_id: &str) -> Result<Vec<StickyNote>> {
        self.with(|db| {
            let mut statement = db.prepare(
                "SELECT id, document_id, text, colour, created_at, updated_at
                 FROM sticky_notes WHERE document_id = ?1 ORDER BY created_at",
            )?;
            let rows = statement.query_map(params![document_id], |row| {
                Ok(StickyNote {
                    id: row.get("id")?,
                    document_id: row.get("document_id")?,
                    text: row.get("text")?,
                    colour: row.get("colour")?,
                    created_at: row.get("created_at")?,
                    updated_at: row.get("updated_at")?,
                })
            })?;
            rows.collect()
        })
    }

    pub fn put_sticky(&self, note: StickyNote) -> Result<StickyNote> {
        self.with(|db| {
            db.execute(
                "INSERT INTO sticky_notes (id, document_id, text, colour, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                   text = excluded.text, colour = excluded.colour,
                   updated_at = excluded.updated_at",
                params![
                    note.id,
                    note.document_id,
                    note.text,
                    note.colour,
                    note.created_at,
                    note.updated_at
                ],
            )?;
            Ok(note)
        })
    }

    pub fn delete_sticky(&self, id: &str) -> Result<()> {
        self.with(|db| {
            db.execute("DELETE FROM sticky_notes WHERE id = ?1", params![id])?;
            Ok(())
        })
    }

    pub fn list_activity(&self, since_day: &str) -> Result<Vec<ActivityDay>> {
        self.with(|db| {
            let mut statement = db.prepare(
                "SELECT day, words, seconds, last_at FROM activity WHERE day >= ?1 ORDER BY day",
            )?;
            let rows = statement.query_map(params![since_day], |row| {
                Ok(ActivityDay {
                    day: row.get("day")?,
                    words: row.get("words")?,
                    seconds: row.get("seconds")?,
                    last_at: row.get("last_at")?,
                })
            })?;
            rows.collect()
        })
    }

    pub fn list_revisions(&self, document_id: &str) -> Result<Vec<RevisionRecord>> {
        self.with(|db| {
            let mut statement = db.prepare(
                "SELECT id, document_id, content, word_count, created_at
                 FROM revisions WHERE document_id = ?1 ORDER BY created_at DESC",
            )?;
            let rows = statement.query_map(params![document_id], |row| {
                Ok(RevisionRecord {
                    id: row.get("id")?,
                    document_id: row.get("document_id")?,
                    content: parse_content(row.get("content")?),
                    word_count: row.get("word_count")?,
                    created_at: row.get("created_at")?,
                })
            })?;
            rows.collect()
        })
    }

    /// Every page whose prose links to this one.
    ///
    /// `LIKE` is a pre-filter rather than the answer. An id can appear in a
    /// body for reasons other than a link — inside an asset hash, or as
    /// ordinary text somebody pasted — so what it matches still has to be
    /// parsed and walked. What it buys is not having to parse the pages that
    /// cannot possibly match, which is nearly all of them.
    ///
    /// Archived pages are left in. Only a subtree *root* carries `archived_at`,
    /// so filtering here would keep a page archived inside a folder and drop
    /// the folder itself; reachability is a question about the tree, and the
    /// tree lives in the renderer.
    pub fn backlinks(&self, id: &str) -> Result<Vec<Backlink>> {
        if id.is_empty() {
            return Ok(Vec::new());
        }
        self.with(|db| {
            let mut statement = db.prepare(
                "SELECT id, content FROM documents
                 WHERE id <> ?1 AND content IS NOT NULL AND content LIKE ?2",
            )?;
            let rows = statement.query_map(params![id, format!("%{id}%")], |row| {
                Ok((row.get::<_, String>("id")?, row.get::<_, Option<String>>("content")?))
            })?;
            let mut out = Vec::new();
            for row in rows {
                let (doc_id, raw) = row?;
                let Some(content) = parse_content(raw) else { continue };
                if let Some((count, context)) = references_to(&content, id) {
                    out.push(Backlink { id: doc_id, count, context });
                }
            }
            Ok(out)
        })
    }

    // ------------------------------------------------------------ writing

    pub fn create_document(&self, input: CreateDocumentInput) -> Result<DocumentMeta> {
        let position = self.position_for(input.parent_id.as_deref(), &input.after_id, None)?;
        let stamp = now();
        let meta = DocumentMeta {
            id: new_id(),
            parent_id: input.parent_id,
            position,
            title: input.title.unwrap_or_default(),
            kind: input.kind.unwrap_or_else(|| "note".into()),
            favorite: false,
            icon: None,
            cover: None,
            cover_offset: 50,
            word_count: 0,
            created_at: stamp,
            updated_at: stamp,
            archived_at: None,
        };
        self.with(|db| {
            db.execute(
                "INSERT INTO documents
                   (id, parent_id, position, title, kind, favorite, icon, cover, cover_offset, content, word_count, created_at, updated_at, archived_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, NULL, NULL, 50, NULL, 0, ?6, ?7, NULL)",
                params![
                    meta.id,
                    meta.parent_id,
                    meta.position,
                    meta.title,
                    meta.kind,
                    meta.created_at,
                    meta.updated_at
                ],
            )
        })?;
        Ok(meta)
    }

    pub fn rename_document(&self, id: &str, title: &str) -> Result<DocumentMeta> {
        self.patch(id, "title = ?1", params![title])
    }

    pub fn set_kind(&self, id: &str, kind: &str) -> Result<DocumentMeta> {
        self.patch(id, "kind = ?1", params![kind])
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<DocumentMeta> {
        self.patch(id, "favorite = ?1", params![if favorite { 1 } else { 0 }])
    }

    pub fn set_icon(&self, id: &str, icon: Option<String>) -> Result<DocumentMeta> {
        self.patch(id, "icon = ?1", params![icon])
    }

    /// The banner and the band of it to show, written together because
    /// choosing a picture and choosing where it sits are the same decision
    /// made twice — a reposition is this call with the id it already had.
    pub fn set_cover(&self, id: &str, cover: Option<String>, offset: i64) -> Result<DocumentMeta> {
        self.patch(id, "cover = ?1, cover_offset = ?2", params![cover, offset.clamp(0, 100)])
    }

    pub fn archive_document(&self, id: &str) -> Result<DocumentMeta> {
        self.patch(id, "archived_at = ?1", params![now()])
    }

    pub fn restore_document(&self, id: &str) -> Result<DocumentMeta> {
        let parent: Option<String> = self.with(|db| {
            db.query_row("SELECT parent_id FROM documents WHERE id = ?1", params![id], |row| {
                row.get(0)
            })
        })?;

        let parent_alive = match parent.as_deref() {
            None => true,
            Some(parent_id) => self.with(|db| {
                db.query_row(
                    "SELECT archived_at IS NULL FROM documents WHERE id = ?1",
                    params![parent_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
            })? == Some(1),
        };

        if parent_alive {
            return self.patch(id, "archived_at = NULL, position = position", params![]);
        }

        // Restoring into a branch that was archived afterwards would lose it.
        let position = self.position_for(None, &None, Some(id))?;
        self.with(|db| {
            db.execute(
                "UPDATE documents SET archived_at = NULL, parent_id = NULL, position = ?1, updated_at = ?2 WHERE id = ?3",
                params![position, now(), id],
            )
        })?;
        self.meta(id)
    }

    pub fn move_document(&self, input: MoveDocumentInput) -> Result<DocumentMeta> {
        let position = self.position_for(
            input.parent_id.as_deref(),
            &Some(input.after_id.clone()),
            Some(&input.id),
        )?;
        self.with(|db| {
            db.execute(
                "UPDATE documents SET parent_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
                params![input.parent_id, position, now(), input.id],
            )
        })?;
        self.meta(&input.id)
    }

    pub fn save_content(&self, input: SaveContentInput) -> Result<DocumentMeta> {
        let stamp = now();
        let json = serde_json::to_string(&input.content).map_err(|e| e.to_string())?;

        self.with(|db| {
            db.execute(
                "UPDATE documents SET content = ?1, word_count = ?2, updated_at = ?3 WHERE id = ?4",
                params![json, input.word_count, stamp, input.id],
            )
        })?;

        // Revisions are for time travel, not crash recovery — the row above is
        // already durable. Coalesce so a two-hour session leaves a readable
        // history instead of two thousand near-identical snapshots.
        let latest: Option<i64> = self.with(|db| {
            db.query_row(
                "SELECT created_at FROM revisions WHERE document_id = ?1 ORDER BY created_at DESC LIMIT 1",
                params![input.id],
                |row| row.get(0),
            )
            .optional()
        })?;

        let due = latest.map_or(true, |at| stamp - at >= REVISION_COALESCE_MS);
        if input.snapshot || due {
            self.with(|db| {
                db.execute(
                    "INSERT INTO revisions (id, document_id, content, word_count, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![new_id(), input.id, json, input.word_count, stamp],
                )
            })?;
        }

        self.meta(&input.id)
    }

    /// The only destructive operation. Children first, because `parent_id` is
    /// `ON DELETE RESTRICT` — the constraint exists so a bad delete fails
    /// loudly instead of orphaning half a novel.
    pub fn delete_document(&self, id: &str) -> Result<Vec<String>> {
        let doomed: Vec<String> = self.with(|db| {
            let mut statement = db.prepare(
                "WITH RECURSIVE subtree(id) AS (
                   SELECT id FROM documents WHERE id = ?1
                   UNION ALL
                   SELECT documents.id FROM documents JOIN subtree ON documents.parent_id = subtree.id
                 )
                 SELECT id FROM subtree",
            )?;
            let rows = statement.query_map(params![id], |row| row.get::<_, String>(0))?;
            rows.collect()
        })?;

        self.with(|db| {
            let transaction = db.unchecked_transaction()?;
            // Reverse order is leaves-first for a depth-first CTE walk.
            for doomed_id in doomed.iter().rev() {
                transaction.execute("DELETE FROM documents WHERE id = ?1", params![doomed_id])?;
            }
            transaction.commit()
        })?;

        Ok(doomed)
    }

    /// Everything from the last day, hourly for a week, daily beyond, and
    /// never the newest revision of a document.
    pub fn prune_revisions(&self) -> Result<usize> {
        let stamp = now();
        self.with(|db| {
            db.execute(
                "DELETE FROM revisions WHERE id IN (
                   SELECT id FROM (
                     SELECT id,
                            ROW_NUMBER() OVER (
                              PARTITION BY document_id,
                                CASE
                                  WHEN ?1 - created_at <= 86400000 THEN id
                                  WHEN ?1 - created_at <= 604800000 THEN 'h' || (created_at / 3600000)
                                  ELSE 'd' || (created_at / 86400000)
                                END
                              ORDER BY created_at DESC
                            ) AS rank
                     FROM revisions
                   )
                   WHERE rank > 1
                 )
                 AND id NOT IN (
                   SELECT id FROM (
                     SELECT id, ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY created_at DESC) AS rank
                     FROM revisions
                   ) WHERE rank = 1
                 )",
                params![stamp],
            )
        })
    }

    // ------------------------------------------------------------- assets

    /// Writes an image under the hash of its own bytes, or does nothing if
    /// that hash is already here. The renderer computes the id, which is safe
    /// for the same reason it is convenient: it is the only caller, and it has
    /// the bytes in hand already.
    pub fn put_asset(&self, input: PutAssetInput) -> Result<AssetMeta> {
        let bytes = BASE64.decode(&input.data).map_err(|e| e.to_string())?;
        let stamp = now();
        self.with(|db| {
            db.execute(
                "INSERT OR IGNORE INTO assets (id, mime, bytes, width, height, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![input.id, input.mime, bytes, input.width, input.height, stamp],
            )
        })?;
        self.asset_meta(&input.id)
    }

    pub fn get_asset(&self, id: &str) -> Result<Option<AssetRecord>> {
        self.with(|db| {
            db.query_row(
                "SELECT id, mime, bytes, width, height, created_at FROM assets WHERE id = ?1",
                params![id],
                |row| {
                    let bytes: Vec<u8> = row.get("bytes")?;
                    Ok(AssetRecord {
                        id: row.get("id")?,
                        mime: row.get("mime")?,
                        data: BASE64.encode(bytes),
                        width: row.get("width")?,
                        height: row.get("height")?,
                        created_at: row.get("created_at")?,
                    })
                },
            )
            .optional()
        })
    }

    /// Drops images nothing points at. Deliberately not a `WHERE NOT EXISTS`:
    /// what references an asset is a string buried in a ProseMirror document,
    /// so the only honest way to ask is to read every document and every
    /// revision and see. Which is why this runs after a permanent delete and
    /// not on a timer.
    pub fn collect_assets(&self) -> Result<usize> {
        let mut live: std::collections::HashSet<String> = std::collections::HashSet::new();
        let contents: Vec<Option<String>> = self.with(|db| {
            let mut statement = db.prepare(
                "SELECT content FROM documents WHERE content IS NOT NULL
                 UNION ALL
                 SELECT content FROM revisions WHERE content IS NOT NULL",
            )?;
            // Bound rather than chained: the rows borrow the statement, and a
            // temporary would be dropped while that borrow is still live.
            let rows = statement.query_map([], |row| row.get(0))?;
            rows.collect()
        })?;
        for raw in contents.into_iter().flatten() {
            if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                collect_asset_ids(&value, &mut live);
            }
        }

        // A cover is the one reference to an asset that is not a node in a
        // document, so it has to be asked for separately. Without this, the
        // sweep after a permanent delete would take every page banner in the
        // library with it.
        let covers: Vec<String> = self.with(|db| {
            let mut statement = db.prepare("SELECT cover FROM documents WHERE cover IS NOT NULL")?;
            let rows = statement.query_map([], |row| row.get(0))?;
            rows.collect()
        })?;
        live.extend(covers);

        let ids: Vec<String> =
            self.with(|db| {
                let mut statement = db.prepare("SELECT id FROM assets")?;
                let rows = statement.query_map([], |row| row.get(0))?;
                rows.collect()
            })?;

        let mut dropped = 0;
        for id in ids {
            if live.contains(&id) {
                continue;
            }
            self.with(|db| db.execute("DELETE FROM assets WHERE id = ?1", params![id]))?;
            dropped += 1;
        }
        Ok(dropped)
    }

    /// The bytes themselves, for the one caller that wants files on disk
    /// rather than a picture on a page. Base64 is how an asset crosses the
    /// bridge, and it would be a waste to encode these only to decode them
    /// again on the other side of a function call in the same process.
    pub fn asset_bytes(&self, id: &str) -> Result<Option<(String, Vec<u8>)>> {
        self.with(|db| {
            db.query_row(
                "SELECT mime, bytes FROM assets WHERE id = ?1",
                params![id],
                |row| Ok((row.get("mime")?, row.get("bytes")?)),
            )
            .optional()
        })
    }

    fn asset_meta(&self, id: &str) -> Result<AssetMeta> {
        self.with(|db| {
            db.query_row(
                "SELECT id, mime, width, height, created_at FROM assets WHERE id = ?1",
                params![id],
                |row| {
                    Ok(AssetMeta {
                        id: row.get("id")?,
                        mime: row.get("mime")?,
                        width: row.get("width")?,
                        height: row.get("height")?,
                        created_at: row.get("created_at")?,
                    })
                },
            )
        })
    }

    /// A whole-database copy to the user's documents folder. This is the thing
    /// that saves the novel when something else goes wrong.
    pub fn snapshot_to(&self, directory: &Path) -> Result<PathBuf> {
        fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        let stamp = filename_stamp();
        let target = directory.join(format!("springboard-{stamp}.sqlite"));
        // VACUUM INTO takes a consistent copy without stopping writes.
        self.with(|db| {
            db.execute("VACUUM INTO ?1", params![target.to_string_lossy()])?;
            Ok(())
        })?;
        prune_snapshots(directory);
        Ok(target)
    }

    // ------------------------------------------------------------ helpers

    fn meta(&self, id: &str) -> Result<DocumentMeta> {
        self.with(|db| {
            db.query_row(
                &format!("SELECT {META_COLUMNS} FROM documents WHERE id = ?1"),
                params![id],
                meta_from_row,
            )
        })
    }

    fn patch(
        &self,
        id: &str,
        assignment: &str,
        values: &[&dyn rusqlite::ToSql],
    ) -> Result<DocumentMeta> {
        let next_index = values.len() + 1;
        let sql = format!(
            "UPDATE documents SET {assignment}, updated_at = ?{next_index} WHERE id = ?{}",
            next_index + 1
        );
        let stamp = now();
        self.with(|db| {
            let mut bound: Vec<&dyn rusqlite::ToSql> = values.to_vec();
            bound.push(&stamp);
            bound.push(&id);
            db.execute(&sql, bound.as_slice())
        })?;
        self.meta(id)
    }

    /// Fractional key for a new or moved child of `parent_id`.
    ///
    /// `after` distinguishes three cases the way the TypeScript store does:
    /// `None` appends, `Some(None)` makes it first, `Some(Some(id))` places it
    /// after that sibling.
    fn position_for(
        &self,
        parent_id: Option<&str>,
        after: &Option<Option<String>>,
        exclude: Option<&str>,
    ) -> Result<String> {
        let siblings: Vec<(String, String)> = self.with(|db| {
            let mut statement = db.prepare(
                "SELECT id, position FROM documents
                 WHERE parent_id IS ?1 AND archived_at IS NULL AND id IS NOT ?2
                 ORDER BY position",
            )?;
            let rows = statement.query_map(params![parent_id, exclude], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            rows.collect()
        })?;

        Ok(match after {
            None => key_between(siblings.last().map(|(_, p)| p.as_str()), None),
            Some(None) => key_between(None, siblings.first().map(|(_, p)| p.as_str())),
            Some(Some(target)) => match siblings.iter().position(|(id, _)| id == target) {
                None => key_between(siblings.last().map(|(_, p)| p.as_str()), None),
                Some(at) => key_between(
                    Some(siblings[at].1.as_str()),
                    siblings.get(at + 1).map(|(_, p)| p.as_str()),
                ),
            },
        })
    }
}

fn filename_stamp() -> String {
    // Enough of an ISO timestamp to sort, without pulling in a date crate.
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = seconds / 86_400;
    let time = seconds % 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{year:04}-{month:02}-{day:02}-{:02}-{:02}-{:02}",
        time / 3600,
        (time % 3600) / 60,
        time % 60
    )
}

/// Howard Hinnant's days-to-civil algorithm.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

fn prune_snapshots(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else { return };
    let mut files: Vec<(PathBuf, SystemTime)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy().to_string();
            if !name.starts_with("springboard-") || !name.ends_with(".sqlite") {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((path, modified))
        })
        .collect();
    files.sort_by(|a, b| b.1.cmp(&a.1));
    for (path, _) in files.into_iter().skip(SNAPSHOT_KEEP) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const TARGET: &str = "11111111-1111-4111-8111-111111111111";
    const OTHER: &str = "22222222-2222-4222-8222-222222222222";

    fn link(id: &str, label: &str) -> Value {
        json!({ "type": "pageLink", "attrs": { "id": id, "label": label } })
    }

    fn text(value: &str) -> Value {
        json!({ "type": "text", "text": value })
    }

    fn para(content: Vec<Value>) -> Value {
        json!({ "type": "paragraph", "content": content })
    }

    fn doc(content: Vec<Value>) -> Value {
        json!({ "type": "doc", "content": content })
    }

    /// A library from before covers existed, written with the schema of the
    /// day. The point is to open one, not to make one.
    fn old_library() -> PathBuf {
        let file = std::env::temp_dir().join(format!("palmanote-migrate-{}.sqlite", new_id()));
        let db = Connection::open(&file).expect("a database");
        db.execute_batch(
            "CREATE TABLE documents (
               id TEXT PRIMARY KEY, parent_id TEXT, position TEXT NOT NULL,
               title TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'note',
               favorite INTEGER NOT NULL DEFAULT 0, content TEXT,
               word_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL, archived_at INTEGER
             );
             INSERT INTO documents (id, position, title, created_at, updated_at)
             VALUES ('old', 'a0', 'Written before covers', 0, 0);",
        )
        .expect("the old schema");
        file
    }

    #[test]
    fn a_library_from_before_covers_still_opens() {
        let file = old_library();
        let store = Store::open(&file).expect("opens");

        let documents = store.list_documents().expect("lists");
        assert_eq!(documents.len(), 1);
        // The columns are added rather than demanded, and the row that predates
        // them reads as a page with no banner sitting in the middle.
        assert_eq!(documents[0].cover, None);
        assert_eq!(documents[0].cover_offset, 50);

        let updated = store.set_cover("old", Some("abc".into()), 130).expect("sets");
        assert_eq!(updated.cover.as_deref(), Some("abc"));
        // Out of range is brought back into it rather than stored as given.
        assert_eq!(updated.cover_offset, 100);

        let _ = fs::remove_file(&file);
    }

    #[test]
    fn the_sweep_leaves_covers_alone() {
        let file = std::env::temp_dir().join(format!("palmanote-sweep-{}.sqlite", new_id()));
        let store = Store::open(&file).expect("a database");
        let page = store
            .create_document(CreateDocumentInput {
                parent_id: None,
                kind: None,
                title: None,
                after_id: None,
            })
            .expect("a page");

        // One picture on the page, one only used as its banner, one loose.
        for id in ["inprose", "oncover", "orphan"] {
            store
                .put_asset(PutAssetInput {
                    id: id.into(),
                    mime: "image/png".into(),
                    data: String::new(),
                    width: 1,
                    height: 1,
                })
                .expect("stored");
        }
        store
            .save_content(SaveContentInput {
                id: page.id.clone(),
                content: doc(vec![json!({ "type": "image", "attrs": { "id": "inprose" } })]),
                word_count: 0,
                snapshot: false,
            })
            .expect("saved");
        store.set_cover(&page.id, Some("oncover".into()), 50).expect("cover");

        assert_eq!(store.collect_assets().expect("swept"), 1);
        assert!(store.get_asset("inprose").expect("read").is_some());
        // The one nothing but a cover points at is the whole reason this test
        // exists: it is the only reference that is not a node in a document.
        assert!(store.get_asset("oncover").expect("read").is_some());
        assert!(store.get_asset("orphan").expect("read").is_none());

        let _ = fs::remove_file(&file);
    }

    #[test]
    fn a_document_without_the_link_references_nothing() {
        assert!(references_to(&doc(vec![para(vec![text("nothing here")])]), TARGET).is_none());
        assert!(references_to(&doc(vec![para(vec![link(OTHER, "Docks")])]), TARGET).is_none());
    }

    #[test]
    fn counts_every_mention_and_reports_the_first_block() {
        let content = doc(vec![
            para(vec![
                text("The tide chart lives in "),
                link(TARGET, "Harbour"),
                text(" if you need it."),
            ]),
            para(vec![text("Later, unrelated.")]),
            para(vec![text("See also "), link(TARGET, "Harbour")]),
        ]);
        let (count, context) = references_to(&content, TARGET).expect("a reference");
        assert_eq!(count, 2);
        assert_eq!(context, "The tide chart lives in if you need it.");
    }

    #[test]
    fn finds_links_nested_in_lists() {
        let content = doc(vec![json!({
            "type": "bulletList",
            "content": [{
                "type": "listItem",
                "content": [para(vec![text("check "), link(TARGET, "Harbour")])],
            }],
        })]);
        let (count, context) = references_to(&content, TARGET).expect("a reference");
        assert_eq!(count, 1);
        assert_eq!(context, "check");
    }

    #[test]
    fn context_keeps_other_pages_by_name_and_drops_the_target() {
        let content = doc(vec![para(vec![
            text("Between "),
            link(OTHER, "Docks"),
            text(" and "),
            link(TARGET, "Harbour"),
        ])]);
        let (_, context) = references_to(&content, TARGET).expect("a reference");
        assert_eq!(context, "Between Docks and");
    }

    #[test]
    fn pictures_and_stickers_contribute_nothing() {
        let content = doc(vec![para(vec![
            json!({ "type": "image", "attrs": { "id": "abc" } }),
            text("caption "),
            json!({ "type": "sticker", "attrs": { "name": "star" } }),
            link(TARGET, "Harbour"),
        ])]);
        let (_, context) = references_to(&content, TARGET).expect("a reference");
        assert_eq!(context, "caption");
    }

    #[test]
    fn context_collapses_whitespace_and_cuts_at_a_word_boundary() {
        assert_eq!(tidy_context("  two   words\n here "), "two words here");

        let long = format!("{}omega", "alpha ".repeat(80));
        let cut = tidy_context(&long);
        assert!(cut.chars().count() <= CONTEXT_LIMIT + 1, "stays within the limit");
        assert!(cut.ends_with('…'), "says it was cut");
        assert!(!cut.contains("alph…"), "does not cut mid-word");
    }

    #[test]
    fn backlinks_reads_the_graph_backwards() {
        let file = std::env::temp_dir().join(format!("palmanote-backlinks-{}.sqlite", new_id()));
        let store = Store::open(&file).expect("a store");

        let target = store
            .create_document(CreateDocumentInput {
                parent_id: None,
                kind: None,
                title: Some("Harbour".into()),
                after_id: None,
            })
            .expect("the target page");
        let source = store
            .create_document(CreateDocumentInput {
                parent_id: None,
                kind: None,
                title: Some("Monday".into()),
                after_id: None,
            })
            .expect("the linking page");

        assert!(store.backlinks(&target.id).expect("no links yet").is_empty());

        store
            .save_content(SaveContentInput {
                id: source.id.clone(),
                content: doc(vec![para(vec![
                    text("tide chart in "),
                    link(&target.id, "Harbour"),
                ])]),
                word_count: 4,
                snapshot: true,
            })
            .expect("a saved body");

        let found = store.backlinks(&target.id).expect("backlinks");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, source.id);
        assert_eq!(found[0].count, 1);
        assert_eq!(found[0].context, "tide chart in");

        // A page never counts as a reference to itself.
        assert!(store.backlinks(&source.id).expect("backlinks").is_empty());

        let _ = fs::remove_file(&file);
    }
}
