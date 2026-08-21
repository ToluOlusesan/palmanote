/**
 * IndexedDB implementation of PalmaNoteStore.
 *
 * Row shapes match schema.sql exactly. One deliberate divergence: document
 * bodies live in a separate `contents` object store keyed by document id,
 * because IndexedDB has no column projection and the tree must not drag a
 * novel's worth of JSON into memory to render a list of titles. In SQLite the
 * same split is just `SELECT` without the content column.
 */

import { accrueSeconds } from '../core/activity.ts';
import { referencesTo } from '../core/backlinks.ts';
import { keyBetween } from '../core/fracIndex.ts';
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
} from '../core/types.ts';
import { getAll, openDatabase, promisify, txDone } from './idb.ts';
import type {
  CreateDocumentInput,
  MoveDocumentInput,
  RecordActivityInput,
  SaveContentInput,
  PalmaNoteStore,
} from './store.ts';

/*
  Still the old name, and it stays that way.

  The app was renamed to PalmaNote on 13 August 2026; an IndexedDB database is
  addressed by its name, so changing this would open an empty second database
  next to the one holding every page anyone has written in a browser. The name
  is where the writing lives rather than what the app is called.
*/
const DB_NAME = 'springboard';
// 2 added `assets`, 3 added `activity`, 4 added `stickies`. `onupgradeneeded`
// runs every intermediate version, so bumping this is additive rather than a
// migration.
const DB_VERSION = 4;

const DOCUMENTS = 'documents';
const CONTENTS = 'contents';
const REVISIONS = 'revisions';
const ASSETS = 'assets';
const ACTIVITY = 'activity';
const STICKIES = 'stickies';

/** One snapshot per document per window of active editing; see notes in README. */
const REVISION_COALESCE_MS = 2 * 60 * 1000;

interface ContentRow {
  id: string;
  content: PMDoc | null;
}

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Fills in fields a row predates.
 *
 * IndexedDB stores whole objects rather than columns, so a document written
 * before covers existed simply has no `cover` key and would arrive as
 * `undefined` — which React would then hand to an `<img>`. The SQLite shells
 * get the same defaults from `ALTER TABLE`; this is that migration.
 */
function normalize(row: DocumentMeta): DocumentMeta {
  return {
    ...row,
    favorite: row.favorite ?? false,
    icon: row.icon ?? null,
    cover: row.cover ?? null,
    coverOffset: row.coverOffset ?? 50,
  };
}

export class IdbStore implements PalmaNoteStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly name: string;

  /** The name is a parameter only so tests can run against isolated databases. */
  constructor(name: string = DB_NAME) {
    this.name = name;
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDatabase(this.name, DB_VERSION, (db) => {
      if (!db.objectStoreNames.contains(DOCUMENTS)) {
        db.createObjectStore(DOCUMENTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CONTENTS)) {
        db.createObjectStore(CONTENTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(REVISIONS)) {
        const revisions = db.createObjectStore(REVISIONS, { keyPath: 'id' });
        revisions.createIndex('byDocument', ['documentId', 'createdAt']);
      }
      if (!db.objectStoreNames.contains(ASSETS)) {
        db.createObjectStore(ASSETS, { keyPath: 'id' });
      }
      // Keyed by the day itself. `YYYY-MM-DD` sorts chronologically as text,
      // so the key order is the reading order and a range over it is "since".
      if (!db.objectStoreNames.contains(ACTIVITY)) {
        db.createObjectStore(ACTIVITY, { keyPath: 'day' });
      }
      if (!db.objectStoreNames.contains(STICKIES)) {
        const stickies = db.createObjectStore(STICKIES, { keyPath: 'id' });
        stickies.createIndex('byDocument', ['documentId', 'createdAt']);
      }
    });
    return this.dbPromise;
  }

  async listDocuments(): Promise<DocumentMeta[]> {
    const db = await this.db();
    const rows = await getAll<DocumentMeta>(
      db.transaction(DOCUMENTS, 'readonly').objectStore(DOCUMENTS),
    );
    // Rows written before these fields existed do not carry them.
    return rows.map(normalize);
  }

  async getDocument(id: string): Promise<DocumentRecord | null> {
    const db = await this.db();
    const tx = db.transaction([DOCUMENTS, CONTENTS], 'readonly');
    const meta = await promisify<DocumentMeta | undefined>(tx.objectStore(DOCUMENTS).get(id));
    if (!meta) return null;
    const row = await promisify<ContentRow | undefined>(tx.objectStore(CONTENTS).get(id));
    return { ...normalize(meta), content: row?.content ?? null };
  }

  async createDocument(input: CreateDocumentInput): Promise<DocumentMeta> {
    const db = await this.db();
    const all = await this.listDocuments();
    const position = positionFor(all, input.parentId, input.afterId);
    const now = Date.now();
    const meta: DocumentMeta = {
      id: newId(),
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
    const tx = db.transaction(DOCUMENTS, 'readwrite');
    tx.objectStore(DOCUMENTS).put(meta);
    await txDone(tx);
    return meta;
  }

  async renameDocument(id: string, title: string): Promise<DocumentMeta> {
    return this.patch(id, (meta) => ({ ...meta, title }));
  }

  async setKind(id: string, kind: DocumentKind): Promise<DocumentMeta> {
    return this.patch(id, (meta) => ({ ...meta, kind }));
  }

  async setFavorite(id: string, favorite: boolean): Promise<DocumentMeta> {
    return this.patch(id, (meta) => ({ ...meta, favorite }));
  }

  async setIcon(id: string, icon: string | null): Promise<DocumentMeta> {
    return this.patch(id, (meta) => ({ ...meta, icon }));
  }

  async setCover(id: string, cover: string | null, offset: number): Promise<DocumentMeta> {
    // Clamped here rather than trusted from the caller: the offset arrives
    // from a pointer being dragged, and a drag that leaves the element would
    // otherwise store a band the image does not have.
    const clamped = Math.max(0, Math.min(100, Math.round(offset)));
    return this.patch(id, (meta) => ({ ...meta, cover, coverOffset: clamped }));
  }

  async archiveDocument(id: string): Promise<DocumentMeta> {
    return this.patch(id, (meta) => ({ ...meta, archivedAt: Date.now() }));
  }

  async restoreDocument(id: string): Promise<DocumentMeta> {
    const all = await this.listDocuments();
    const meta = all.find((d) => d.id === id);
    // If the document was archived while its parent was later archived too,
    // restoring it into a hidden branch would lose it. Lift it to the root.
    const parentAlive =
      meta?.parentId == null || all.some((d) => d.id === meta.parentId && d.archivedAt === null);
    return this.patch(id, (current) => ({
      ...current,
      archivedAt: null,
      parentId: parentAlive ? current.parentId : null,
      position: parentAlive
        ? current.position
        : positionFor(all.filter((d) => d.id !== id), null),
    }));
  }

  async deleteDocument(id: string): Promise<string[]> {
    const all = await this.listDocuments();
    // Descendants of an archived page keep archivedAt null and are simply
    // unreachable, so the subtree has to be walked rather than filtered.
    const doomed: string[] = [];
    const collect = (parentId: string) => {
      doomed.push(parentId);
      for (const doc of all) if (doc.parentId === parentId) collect(doc.id);
    };
    collect(id);

    const db = await this.db();
    const tx = db.transaction([DOCUMENTS, CONTENTS, REVISIONS, STICKIES], 'readwrite');
    const revisions = tx.objectStore(REVISIONS);
    // The two SQLite shells get this from `ON DELETE CASCADE`; IndexedDB has no
    // such thing, so the notes have to be swept by hand or they outlive the
    // page they were stuck to.
    const stickies = tx.objectStore(STICKIES);
    for (const doomedId of doomed) {
      tx.objectStore(DOCUMENTS).delete(doomedId);
      tx.objectStore(CONTENTS).delete(doomedId);
      const rows = await getAll<RevisionRecord>(
        revisions.index('byDocument'),
        documentRange(doomedId),
      );
      for (const row of rows) revisions.delete(row.id);
      const notes = await getAll<StickyNote>(stickies.index('byDocument'), documentRange(doomedId));
      for (const note of notes) stickies.delete(note.id);
    }
    await txDone(tx);
    return doomed;
  }

  // -------------------------------------------------------------- assets

  async putAsset(asset: Omit<AssetRecord, 'createdAt'>): Promise<AssetMeta> {
    const db = await this.db();
    const tx = db.transaction(ASSETS, 'readwrite');
    const store = tx.objectStore(ASSETS);
    const existing = await promisify<AssetRecord | undefined>(store.get(asset.id));
    // The id *is* the bytes. If it is already here, it is already right.
    const row: AssetRecord = existing ?? { ...asset, createdAt: Date.now() };
    if (!existing) store.put(row);
    await txDone(tx);
    const { data: _data, ...meta } = row;
    return meta;
  }

  async getAsset(id: string): Promise<AssetRecord | null> {
    const db = await this.db();
    const row = await promisify<AssetRecord | undefined>(
      db.transaction(ASSETS, 'readonly').objectStore(ASSETS).get(id),
    );
    return row ?? null;
  }

  async collectAssets(): Promise<number> {
    const db = await this.db();
    const contents = await getAll<ContentRow>(
      db.transaction(CONTENTS, 'readonly').objectStore(CONTENTS),
    );
    const revisions = await getAll<RevisionRecord>(
      db.transaction(REVISIONS, 'readonly').objectStore(REVISIONS),
    );
    // Covers are the one reference to an asset that is not a node in a
    // document. Left out of this, the first permanent delete would take every
    // page banner in the library with it.
    const documents = await getAll<DocumentMeta>(
      db.transaction(DOCUMENTS, 'readonly').objectStore(DOCUMENTS),
    );
    const live = new Set<string>();
    for (const row of contents) collectAssetIds(row.content, live);
    for (const row of revisions) collectAssetIds(row.content, live);
    for (const row of documents) if (row.cover) live.add(row.cover);

    const tx = db.transaction(ASSETS, 'readwrite');
    const store = tx.objectStore(ASSETS);
    const rows = await getAll<AssetMeta>(store);
    let dropped = 0;
    for (const row of rows) {
      if (live.has(row.id)) continue;
      store.delete(row.id);
      dropped++;
    }
    await txDone(tx);
    return dropped;
  }

  async moveDocument({ id, parentId, afterId }: MoveDocumentInput): Promise<DocumentMeta> {
    const all = await this.listDocuments();
    const position = positionFor(all.filter((d) => d.id !== id), parentId, afterId);
    return this.patch(id, (meta) => ({ ...meta, parentId, position }));
  }

  async saveContent({ id, content, wordCount, snapshot }: SaveContentInput): Promise<DocumentMeta> {
    const db = await this.db();
    const now = Date.now();

    const tx = db.transaction([DOCUMENTS, CONTENTS], 'readwrite');
    const documents = tx.objectStore(DOCUMENTS);
    const existing = await promisify<DocumentMeta | undefined>(documents.get(id));
    if (!existing) throw new Error(`saveContent: no document ${id}`);
    const meta: DocumentMeta = { ...existing, wordCount, updatedAt: now };
    documents.put(meta);
    tx.objectStore(CONTENTS).put({ id, content } satisfies ContentRow);
    await txDone(tx);

    // Revisions are for time travel, not crash recovery — the row above is
    // already durable. Coalesce so a two-hour session leaves a readable
    // history instead of two thousand near-identical snapshots.
    if (snapshot || (await this.needsSnapshot(id, now))) {
      await this.writeRevision({ id: newId(), documentId: id, content, wordCount, createdAt: now });
    }
    return meta;
  }

  async listRevisions(documentId: string): Promise<RevisionRecord[]> {
    const db = await this.db();
    const index = db.transaction(REVISIONS, 'readonly').objectStore(REVISIONS).index('byDocument');
    const rows = await getAll<RevisionRecord>(index, documentRange(documentId));
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * A pass over every body, which is the honest cost of not keeping an index.
   *
   * IndexedDB cannot filter inside a stored object, so unlike SQLite there is
   * no cheap pre-filter to run first — every content row is read and walked.
   * At the size one person writes that is a few milliseconds, and it is always
   * right, which a link table maintained through import and undo would not
   * reliably be.
   */
  async backlinks(id: string): Promise<Backlink[]> {
    if (!id) return [];
    const db = await this.db();
    const rows = await getAll<ContentRow>(
      db.transaction(CONTENTS, 'readonly').objectStore(CONTENTS),
    );
    const out: Backlink[] = [];
    for (const row of rows) {
      // A page linking to itself is a table of contents pointing at its own
      // heading, not a reference worth listing under it.
      if (row.id === id) continue;
      const found = referencesTo(row.content, id);
      if (found) out.push({ id: row.id, ...found });
    }
    return out;
  }

  /**
   * Retention: everything from the last 24h, then hourly for a week, then
   * daily — and never fewer than one revision per document per day, nor the
   * newest revision of any document.
   */
  async pruneRevisions(): Promise<number> {
    const db = await this.db();
    const rows = await getAll<RevisionRecord>(
      db.transaction(REVISIONS, 'readonly').objectStore(REVISIONS),
    );
    const now = Date.now();
    const DAY = 86_400_000;
    const HOUR = 3_600_000;

    const keep = new Set<string>();
    const byDocument = new Map<string, RevisionRecord[]>();
    for (const row of rows) {
      const bucket = byDocument.get(row.documentId);
      if (bucket) bucket.push(row);
      else byDocument.set(row.documentId, [row]);
    }

    for (const bucket of byDocument.values()) {
      bucket.sort((a, b) => b.createdAt - a.createdAt);
      const newest = bucket[0];
      if (newest) keep.add(newest.id);
      const seenBuckets = new Set<string>();
      for (const row of bucket) {
        const age = now - row.createdAt;
        if (age <= DAY) {
          keep.add(row.id);
          continue;
        }
        const granularity = age <= 7 * DAY ? HOUR : DAY;
        const slot = `${Math.floor(row.createdAt / granularity)}`;
        if (!seenBuckets.has(slot)) {
          seenBuckets.add(slot);
          keep.add(row.id);
        }
      }
    }

    const doomed = rows.filter((row) => !keep.has(row.id));
    if (doomed.length === 0) return 0;
    const tx = db.transaction(REVISIONS, 'readwrite');
    const store = tx.objectStore(REVISIONS);
    for (const row of doomed) store.delete(row.id);
    await txDone(tx);
    return doomed.length;
  }

  /**
   * Read, add, write — inside one transaction, so two saves landing in the
   * same tick cannot both read 400 and both write 900.
   */
  async recordActivity({ day, words, at }: RecordActivityInput): Promise<ActivityDay> {
    const db = await this.db();
    const tx = db.transaction(ACTIVITY, 'readwrite');
    const store = tx.objectStore(ACTIVITY);
    const existing = await promisify<ActivityDay | undefined>(store.get(day));
    const next: ActivityDay = existing
      ? {
          day,
          words: existing.words + words,
          seconds: existing.seconds + accrueSeconds(existing.lastAt, at),
          lastAt: at,
        }
      : { day, words, seconds: 0, lastAt: at };
    store.put(next);
    await txDone(tx);
    return next;
  }

  async listStickies(documentId: string): Promise<StickyNote[]> {
    const db = await this.db();
    const rows = await getAll<StickyNote>(
      db.transaction(STICKIES, 'readonly').objectStore(STICKIES).index('byDocument'),
      documentRange(documentId),
    );
    // A note written before comments existed has no `anchor` key at all, and
    // `undefined` is not the same as "attached to nothing" to anything reading
    // it. The SQLite shells get this from `ALTER TABLE`; this is that migration.
    return rows.map((row) => ({ ...row, anchor: row.anchor ?? null }));
  }

  async putSticky(note: StickyNote): Promise<StickyNote> {
    const db = await this.db();
    const tx = db.transaction(STICKIES, 'readwrite');
    tx.objectStore(STICKIES).put(note);
    await txDone(tx);
    return note;
  }

  async deleteSticky(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(STICKIES, 'readwrite');
    tx.objectStore(STICKIES).delete(id);
    await txDone(tx);
  }

  async listActivity(sinceDay: string): Promise<ActivityDay[]> {
    const db = await this.db();
    const rows = await getAll<ActivityDay>(
      db.transaction(ACTIVITY, 'readonly').objectStore(ACTIVITY),
      IDBKeyRange.lowerBound(sinceDay),
    );
    return rows.sort((a, b) => a.day.localeCompare(b.day));
  }

  private async needsSnapshot(documentId: string, now: number): Promise<boolean> {
    const db = await this.db();
    const index = db.transaction(REVISIONS, 'readonly').objectStore(REVISIONS).index('byDocument');
    const cursor = await promisify(
      index.openCursor(documentRange(documentId), 'prev'),
    );
    const latest = cursor?.value as RevisionRecord | undefined;
    return !latest || now - latest.createdAt >= REVISION_COALESCE_MS;
  }

  private async writeRevision(revision: RevisionRecord): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(REVISIONS, 'readwrite');
    tx.objectStore(REVISIONS).put(revision);
    await txDone(tx);
  }

  private async patch(
    id: string,
    apply: (meta: DocumentMeta) => DocumentMeta,
  ): Promise<DocumentMeta> {
    const db = await this.db();
    const tx = db.transaction(DOCUMENTS, 'readwrite');
    const store = tx.objectStore(DOCUMENTS);
    const existing = await promisify<DocumentMeta | undefined>(store.get(id));
    if (!existing) throw new Error(`no document ${id}`);
    const next = { ...apply(existing), updatedAt: Date.now() };
    store.put(next);
    await txDone(tx);
    return next;
  }
}

/**
 * All [documentId, createdAt] keys for one document. An empty array sorts
 * above every scalar key in IndexedDB, which makes it the natural upper bound.
 */
function documentRange(documentId: string): IDBKeyRange {
  return IDBKeyRange.bound([documentId], [documentId, []]);
}

/** Fractional key for a new or moved child of `parentId`, placed after `afterId`. */
function positionFor(
  all: DocumentMeta[],
  parentId: string | null,
  afterId?: string | null,
): string {
  const siblings = all
    .filter((d) => d.parentId === parentId && d.archivedAt === null)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));

  if (afterId === undefined) {
    return keyBetween(siblings.at(-1)?.position ?? null, null);
  }
  if (afterId === null) {
    return keyBetween(null, siblings[0]?.position ?? null);
  }
  const index = siblings.findIndex((d) => d.id === afterId);
  if (index === -1) return keyBetween(siblings.at(-1)?.position ?? null, null);
  return keyBetween(siblings[index]!.position, siblings[index + 1]?.position ?? null);
}

/** Every asset id an image node in this document points at. */
function collectAssetIds(doc: PMDoc | null, into: Set<string>): void {
  const visit = (node: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
    if (node.type === 'image' && typeof node.attrs?.id === 'string') into.add(node.attrs.id);
    for (const child of (node.content ?? []) as typeof node[]) visit(child);
  };
  if (doc) visit(doc);
}
