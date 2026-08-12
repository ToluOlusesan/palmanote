-- Canonical Springboard schema.
--
-- Not executed by the web build (IndexedDB stands in for now — see idbStore.ts),
-- but kept here as the single source of truth for row shapes so the Electron
-- port with better-sqlite3 is an adapter swap rather than a redesign.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES documents(id) ON DELETE RESTRICT,
  position    TEXT    NOT NULL,           -- fractional index, lexicographic
  title       TEXT    NOT NULL DEFAULT '',
  kind        TEXT    NOT NULL CHECK (kind IN ('folder','chapter','scene','note')),
  favorite    INTEGER NOT NULL DEFAULT 0, -- 0/1
  icon        TEXT,                       -- one emoji, or NULL
  content     TEXT,                       -- ProseMirror JSON; NULL for empty containers
  word_count  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  archived_at INTEGER                     -- soft delete; set on subtree root only
);

CREATE INDEX IF NOT EXISTS documents_parent_position
  ON documents (parent_id, position);
CREATE INDEX IF NOT EXISTS documents_archived
  ON documents (archived_at);
CREATE INDEX IF NOT EXISTS documents_favorite
  ON documents (favorite) WHERE favorite = 1;

-- Images, addressed by content. `id` is the SHA-256 of `bytes`, so inserting
-- the same picture twice is an upsert rather than a second copy, and a
-- document references it by a string short enough to sit in a revision.
--
-- Not owned by any document on purpose: two pages can share one image, and a
-- revision from last Tuesday can still be rendered because the asset it points
-- at outlives the edit that removed it. `collect_assets` is what eventually
-- takes away the ones nothing points at any more.
CREATE TABLE IF NOT EXISTS assets (
  id         TEXT PRIMARY KEY,
  mime       TEXT    NOT NULL,
  bytes      BLOB    NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Append-only. Never updated, only inserted and pruned.
CREATE TABLE IF NOT EXISTS revisions (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content     TEXT,
  word_count  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS revisions_document_created
  ON revisions (document_id, created_at DESC);
