/**
 * better-sqlite3 implementation of PalmaNoteStore, main process only.
 *
 * Same row shapes and same behaviour as the IndexedDB one — the tests in
 * src/data/idbStore.test.ts describe both. Differences are only where SQL can
 * do something IndexedDB cannot: real column projection, so listing the tree
 * never touches document bodies, and retention pruning in one statement.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { accrueSeconds } from '../src/core/activity.ts';
import { referencesTo } from '../src/core/backlinks.ts';
import { keyBetween } from '../src/core/fracIndex.ts';
import type {
  ActivityDay,
  StickyNote,
  AssetMeta,
  AssetRecord,
  Backlink,
  DocumentKind,
  DocumentMeta,
  DocumentRecord,
  PMDoc,
  RevisionRecord,
} from '../src/core/types.ts';
import type {
  CreateDocumentInput,
  MoveDocumentInput,
  RecordActivityInput,
  SaveContentInput,
  PalmaNoteStore,
} from '../src/data/store.ts';

const REVISION_COALESCE_MS = 2 * 60 * 1000;
const SNAPSHOT_KEEP = 30;

interface DocumentRow {
  id: string;
  parent_id: string | null;
  position: string;
  title: string;
  kind: DocumentKind;
  favorite: number;
  icon: string | null;
  cover: string | null;
  cover_offset: number;
  word_count: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  content?: string | null;
}

interface StickyRow {
  id: string;
  document_id: string;
  text: string;
  colour: StickyNote['colour'];
  anchor: string | null;
  created_at: number;
  updated_at: number;
}

interface ActivityRow {
  day: string;
  words: number;
  seconds: number;
  last_at: number;
  document_ids: string;
}

function parseDocumentIds(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function toMeta(row: DocumentRow): DocumentMeta {
  return {
    id: row.id,
    parentId: row.parent_id,
    position: row.position,
    title: row.title,
    kind: row.kind,
    favorite: row.favorite === 1,
    icon: row.icon,
    cover: row.cover,
    coverOffset: row.cover_offset,
    wordCount: row.word_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

const SCHEMA = `
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
  day          TEXT PRIMARY KEY,
  words        INTEGER NOT NULL DEFAULT 0,
  seconds      INTEGER NOT NULL DEFAULT 0,
  last_at      INTEGER NOT NULL,
  document_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS sticky_notes (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  text        TEXT    NOT NULL DEFAULT '',
  colour      TEXT    NOT NULL,
  anchor      TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sticky_notes_document ON sticky_notes (document_id);
`;

const META_COLUMNS =
  'id, parent_id, position, title, kind, favorite, icon, cover, cover_offset, word_count, created_at, updated_at, archived_at';

export class SqliteStore implements PalmaNoteStore {
  private readonly db: Database.Database;

  constructor(private readonly file: string) {
    this.db = new Database(file);
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Adds columns introduced after a database was first created. */
  private migrate(): void {
    const columns = this.db
      .prepare<[], { name: string }>('PRAGMA table_info(documents)')
      .all()
      .map((column) => column.name);
    if (!columns.includes('favorite')) {
      this.db.exec('ALTER TABLE documents ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
    }
    if (!columns.includes('icon')) {
      this.db.exec('ALTER TABLE documents ADD COLUMN icon TEXT');
    }
    if (!columns.includes('cover')) {
      this.db.exec('ALTER TABLE documents ADD COLUMN cover TEXT');
    }
    if (!columns.includes('cover_offset')) {
      this.db.exec('ALTER TABLE documents ADD COLUMN cover_offset INTEGER NOT NULL DEFAULT 50');
    }

    // A library from before comments existed has stickies and no column to
    // hang one on. Null is a sticky, which is what every row in it already is.
    const stickyColumns = this.db
      .prepare<[], { name: string }>('PRAGMA table_info(sticky_notes)')
      .all()
      .map((column) => column.name);
    if (!stickyColumns.includes('anchor')) {
      this.db.exec('ALTER TABLE sticky_notes ADD COLUMN anchor TEXT');
    }

    const activityColumns = this.db
      .prepare<[], { name: string }>('PRAGMA table_info(activity)')
      .all()
      .map((column) => column.name);
    if (!activityColumns.includes('document_ids')) {
      this.db.exec("ALTER TABLE activity ADD COLUMN document_ids TEXT NOT NULL DEFAULT '[]'");
    }
  }

  async listDocuments(): Promise<DocumentMeta[]> {
    // Projection matters here: a novel's worth of JSON never leaves SQLite
    // just to render a list of titles.
    const rows = this.db.prepare<[], DocumentRow>(`SELECT ${META_COLUMNS} FROM documents`).all();
    return rows.map(toMeta);
  }

  async getDocument(id: string): Promise<DocumentRecord | null> {
    const row = this.db
      .prepare<[string], DocumentRow>(`SELECT ${META_COLUMNS}, content FROM documents WHERE id = ?`)
      .get(id);
    if (!row) return null;
    return { ...toMeta(row), content: row.content ? (JSON.parse(row.content) as PMDoc) : null };
  }

  async createDocument(input: CreateDocumentInput): Promise<DocumentMeta> {
    const position = this.positionFor(input.parentId, input.afterId);
    const now = Date.now();
    const meta: DocumentMeta = {
      id: randomUUID(),
      parentId: input.parentId,
      position,
      title: input.title ?? '',
      kind: input.kind ?? 'note',
      favorite: false,
      icon: null,
      cover: null,
      coverOffset: 50,
      wordCount: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO documents (id, parent_id, position, title, kind, favorite, cover, cover_offset, content, word_count, created_at, updated_at, archived_at)
         VALUES (@id, @parentId, @position, @title, @kind, 0, NULL, 50, NULL, 0, @createdAt, @updatedAt, NULL)`,
      )
      .run(meta);
    return meta;
  }

  async renameDocument(id: string, title: string): Promise<DocumentMeta> {
    return this.patch(id, 'title = ?', title);
  }

  async setKind(id: string, kind: DocumentKind): Promise<DocumentMeta> {
    return this.patch(id, 'kind = ?', kind);
  }

  async setFavorite(id: string, favorite: boolean): Promise<DocumentMeta> {
    return this.patch(id, 'favorite = ?', favorite ? 1 : 0);
  }

  async setIcon(id: string, icon: string | null): Promise<DocumentMeta> {
    return this.patch(id, 'icon = ?', icon);
  }

  /** The banner and the band of it to show; a reposition keeps the same id. */
  async setCover(id: string, cover: string | null, offset: number): Promise<DocumentMeta> {
    return this.patch(id, 'cover = ?, cover_offset = ?', cover, Math.max(0, Math.min(100, Math.round(offset))));
  }

  async archiveDocument(id: string): Promise<DocumentMeta> {
    return this.patch(id, 'archived_at = ?', Date.now());
  }

  async restoreDocument(id: string): Promise<DocumentMeta> {
    const row = this.db
      .prepare<[string], DocumentRow>(`SELECT ${META_COLUMNS} FROM documents WHERE id = ?`)
      .get(id);
    if (!row) throw new Error(`no document ${id}`);
    const parentAlive =
      row.parent_id === null ||
      this.db
        .prepare<[string], { alive: number }>(
          'SELECT (archived_at IS NULL) AS alive FROM documents WHERE id = ?',
        )
        .get(row.parent_id)?.alive === 1;

    if (parentAlive) return this.patch(id, 'archived_at = ?', null);
    // Restoring into a branch that was archived afterwards would lose it.
    this.db
      .prepare('UPDATE documents SET archived_at = NULL, parent_id = NULL, position = ?, updated_at = ? WHERE id = ?')
      .run(this.positionFor(null, undefined, id), Date.now(), id);
    return (await this.getMeta(id))!;
  }

  async deleteDocument(id: string): Promise<string[]> {
    // Children first: parent_id is ON DELETE RESTRICT, which is what stops a
    // stray delete from orphaning half a novel.
    const doomed = this.db
      .prepare<[string], { id: string }>(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM documents WHERE id = ?
           UNION ALL
           SELECT documents.id FROM documents JOIN subtree ON documents.parent_id = subtree.id
         )
         SELECT id FROM subtree`,
      )
      .all(id)
      .map((row) => row.id);

    const remove = this.db.prepare('DELETE FROM documents WHERE id = ?');
    this.db.transaction(() => {
      // Reverse order is leaves-first for a depth-first CTE walk.
      for (const doomedId of [...doomed].reverse()) remove.run(doomedId);
    })();
    return doomed;
  }

  async moveDocument({ id, parentId, afterId }: MoveDocumentInput): Promise<DocumentMeta> {
    const position = this.positionFor(parentId, afterId, id);
    this.db
      .prepare('UPDATE documents SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?')
      .run(parentId, position, Date.now(), id);
    return (await this.getMeta(id))!;
  }

  async saveContent({ id, content, wordCount, snapshot }: SaveContentInput): Promise<DocumentMeta> {
    const now = Date.now();
    const json = JSON.stringify(content);
    this.db
      .prepare('UPDATE documents SET content = ?, word_count = ?, updated_at = ? WHERE id = ?')
      .run(json, wordCount, now, id);

    const latest = this.db
      .prepare<[string], { created_at: number }>(
        'SELECT created_at FROM revisions WHERE document_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(id);
    if (snapshot || !latest || now - latest.created_at >= REVISION_COALESCE_MS) {
      this.db
        .prepare('INSERT INTO revisions (id, document_id, content, word_count, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), id, json, wordCount, now);
    }

    const meta = await this.getMeta(id);
    if (!meta) throw new Error(`saveContent: no document ${id}`);
    return meta;
  }

  async listRevisions(documentId: string): Promise<RevisionRecord[]> {
    return this.db
      .prepare<[string], { id: string; document_id: string; content: string | null; word_count: number; created_at: number }>(
        'SELECT * FROM revisions WHERE document_id = ? ORDER BY created_at DESC',
      )
      .all(documentId)
      .map((row) => ({
        id: row.id,
        documentId: row.document_id,
        content: row.content ? (JSON.parse(row.content) as PMDoc) : null,
        wordCount: row.word_count,
        createdAt: row.created_at,
      }));
  }

  /**
   * Read then write, wrapped in a transaction.
   *
   * The whole thing would go in one `ON CONFLICT DO UPDATE`, but the gap rule
   * would then be written a second time in SQL and could drift from the one in
   * core/activity.ts. better-sqlite3 is synchronous, so a transaction around a
   * read and a write costs nothing and keeps a single definition of what
   * counts as still writing.
   */
  async recordActivity({ day, words, at, documentId }: RecordActivityInput): Promise<ActivityDay> {
    return this.db.transaction(() => {
      const existing = this.db
        .prepare<[string], ActivityRow>('SELECT * FROM activity WHERE day = ?')
        .get(day);
      const existingIds = existing ? parseDocumentIds(existing.document_ids) : [];
      const documentIds = existingIds.includes(documentId)
        ? existingIds
        : [...existingIds, documentId];
      const next: ActivityDay = existing
        ? {
            day,
            words: existing.words + words,
            seconds: existing.seconds + accrueSeconds(existing.last_at, at),
            lastAt: at,
            documentIds,
          }
        : { day, words, seconds: 0, lastAt: at, documentIds };
      this.db
        .prepare(
          `INSERT INTO activity (day, words, seconds, last_at, document_ids) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(day) DO UPDATE SET
               words = excluded.words, seconds = excluded.seconds, last_at = excluded.last_at,
               document_ids = excluded.document_ids`,
        )
        .run(next.day, next.words, next.seconds, next.lastAt, JSON.stringify(next.documentIds));
      return next;
    })();
  }

  async listStickies(documentId: string): Promise<StickyNote[]> {
    return this.db
      .prepare<[string], StickyRow>(
        'SELECT * FROM sticky_notes WHERE document_id = ? ORDER BY created_at',
      )
      .all(documentId)
      .map((row) => ({
        id: row.id,
        documentId: row.document_id,
        text: row.text,
        colour: row.colour,
        anchor: row.anchor,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
  }

  async putSticky(note: StickyNote): Promise<StickyNote> {
    this.db
      .prepare(
        `INSERT INTO sticky_notes (id, document_id, text, colour, anchor, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             text = excluded.text, colour = excluded.colour, updated_at = excluded.updated_at`,
      )
      .run(
        note.id,
        note.documentId,
        note.text,
        note.colour,
        note.anchor,
        note.createdAt,
        note.updatedAt,
      );
    return note;
  }

  async deleteSticky(id: string): Promise<void> {
    this.db.prepare('DELETE FROM sticky_notes WHERE id = ?').run(id);
  }

  async listActivity(sinceDay: string): Promise<ActivityDay[]> {
    return this.db
      .prepare<[string], ActivityRow>('SELECT * FROM activity WHERE day >= ? ORDER BY day')
      .all(sinceDay)
      .map((row) => ({
        day: row.day,
        words: row.words,
        seconds: row.seconds,
        lastAt: row.last_at,
        documentIds: parseDocumentIds(row.document_ids),
      }));
  }

  /**
   * `LIKE` is a pre-filter rather than the answer: an id can appear in a body
   * for reasons other than a link, so what it matches is still parsed and
   * walked. What it buys is not parsing the pages that cannot match.
   *
   * Archived pages are left in — only a subtree root carries `archived_at`, so
   * reachability is a question about the tree, which lives in the renderer.
   */
  async backlinks(id: string): Promise<Backlink[]> {
    if (!id) return [];
    return this.db
      .prepare<[string, string], { id: string; content: string | null }>(
        'SELECT id, content FROM documents WHERE id <> ? AND content IS NOT NULL AND content LIKE ?',
      )
      .all(id, `%${id}%`)
      .flatMap((row) => {
        const content = row.content ? (JSON.parse(row.content) as PMDoc) : null;
        const found = referencesTo(content, id);
        return found ? [{ id: row.id, ...found }] : [];
      });
  }

  /**
   * Everything from the last day, hourly for a week, daily beyond, and never
   * the newest revision of a document. One statement: SQLite groups by time
   * bucket and keeps the newest row in each.
   */
  async pruneRevisions(): Promise<number> {
    const now = Date.now();
    const result = this.db
      .prepare(
        `DELETE FROM revisions WHERE id IN (
           SELECT id FROM (
             SELECT id,
                    ROW_NUMBER() OVER (
                      PARTITION BY document_id,
                        CASE
                          WHEN @now - created_at <= 86400000 THEN id
                          WHEN @now - created_at <= 604800000 THEN 'h' || (created_at / 3600000)
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
         )`,
      )
      .run({ now });
    return result.changes;
  }

  // ---------------------------------------------------------------- assets

  async putAsset(asset: Omit<AssetRecord, 'createdAt'>): Promise<AssetMeta> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO assets (id, mime, bytes, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(asset.id, asset.mime, Buffer.from(asset.data, 'base64'), asset.width, asset.height, Date.now());
    const row = this.db
      .prepare<[string], AssetMeta>(
        'SELECT id, mime, width, height, created_at AS createdAt FROM assets WHERE id = ?',
      )
      .get(asset.id);
    if (!row) throw new Error('Asset vanished on write.');
    return row;
  }

  async getAsset(id: string): Promise<AssetRecord | null> {
    const row = this.db
      .prepare<[string], { id: string; mime: string; bytes: Buffer; width: number; height: number; createdAt: number }>(
        'SELECT id, mime, bytes, width, height, created_at AS createdAt FROM assets WHERE id = ?',
      )
      .get(id);
    return row ? { ...row, data: row.bytes.toString('base64') } : null;
  }

  async collectAssets(): Promise<number> {
    const live = new Set<string>();
    const rows = this.db
      .prepare<[], { content: string | null }>(
        `SELECT content FROM documents WHERE content IS NOT NULL
         UNION ALL
         SELECT content FROM revisions WHERE content IS NOT NULL`,
      )
      .all();
    for (const row of rows) {
      if (!row.content) continue;
      try {
        collectAssetIds(JSON.parse(row.content), live);
      } catch {
        // A document that will not parse cannot be holding a reference we can
        // read, and refusing to sweep because of one is worse than sweeping.
      }
    }
    // Covers are the one reference to an asset that is not a node in a
    // document, so they have to be asked for separately or the sweep after a
    // permanent delete takes every page banner with it.
    for (const { cover } of this.db
      .prepare<[], { cover: string }>('SELECT cover FROM documents WHERE cover IS NOT NULL')
      .all()) {
      live.add(cover);
    }

    const ids = this.db.prepare<[], { id: string }>('SELECT id FROM assets').all();
    const drop = this.db.prepare('DELETE FROM assets WHERE id = ?');
    let dropped = 0;
    for (const { id } of ids) {
      if (live.has(id)) continue;
      drop.run(id);
      dropped++;
    }
    return dropped;
  }

  // ------------------------------------------------------------- internals

  private async getMeta(id: string): Promise<DocumentMeta | null> {
    const row = this.db
      .prepare<[string], DocumentRow>(`SELECT ${META_COLUMNS} FROM documents WHERE id = ?`)
      .get(id);
    return row ? toMeta(row) : null;
  }

  /** Variadic because a cover is two columns written as one decision. */
  private patch(id: string, assignment: string, ...values: unknown[]): Promise<DocumentMeta> {
    this.db
      .prepare(`UPDATE documents SET ${assignment}, updated_at = ? WHERE id = ?`)
      .run(...values, Date.now(), id);
    return this.getMeta(id).then((meta) => {
      if (!meta) throw new Error(`no document ${id}`);
      return meta;
    });
  }

  private positionFor(parentId: string | null, afterId?: string | null, excludeId?: string): string {
    const siblings = this.db
      .prepare<[string | null, string], { id: string; position: string }>(
        `SELECT id, position FROM documents
         WHERE parent_id IS ? AND archived_at IS NULL AND id != ?
         ORDER BY position`,
      )
      .all(parentId, excludeId ?? '');

    if (afterId === undefined) return keyBetween(siblings.at(-1)?.position ?? null, null);
    if (afterId === null) return keyBetween(null, siblings[0]?.position ?? null);
    const at = siblings.findIndex((sibling) => sibling.id === afterId);
    if (at === -1) return keyBetween(siblings.at(-1)?.position ?? null, null);
    return keyBetween(siblings[at]!.position, siblings[at + 1]?.position ?? null);
  }

  /**
   * A whole-database copy to the user's documents folder. This is the thing
   * that saves the novel when something else goes wrong.
   */
  snapshotTo(directory: string): string {
    mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const target = join(directory, `springboard-${stamp}.sqlite`);
    // VACUUM INTO takes a consistent copy without stopping writes.
    this.db.prepare('VACUUM INTO ?').run(target);
    this.pruneSnapshots(directory);
    return target;
  }

  private pruneSnapshots(directory: string): void {
    const files = readdirSync(directory)
      .filter((name) => name.startsWith('springboard-') && name.endsWith('.sqlite'))
      .map((name) => ({ name, at: statSync(join(directory, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    for (const file of files.slice(SNAPSHOT_KEEP)) {
      rmSync(join(directory, file.name), { force: true });
    }
  }

  /** Used once, when an older file needs moving aside before a risky change. */
  backupBeside(suffix: string): void {
    copyFileSync(this.file, `${this.file}.${suffix}`);
  }

  close(): void {
    this.db.close();
  }
}

/** Every asset id an image node in this document points at. */
function collectAssetIds(node: unknown, into: Set<string>): void {
  if (typeof node !== 'object' || node === null) return;
  const value = node as { type?: string; attrs?: { id?: unknown }; content?: unknown[] };
  if (value.type === 'image' && typeof value.attrs?.id === 'string') into.add(value.attrs.id);
  for (const child of value.content ?? []) collectAssetIds(child, into);
}
