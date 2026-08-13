/**
 * The whole storage surface. Nothing above this layer knows what the storage
 * engine is.
 *
 * Every method is async and every argument and return value is structured-clone
 * safe, because in the Electron build this becomes the preload IPC contract
 * verbatim: renderer calls `window.palmanote.<method>()`, main process runs
 * better-sqlite3 against schema.sql. Keeping that constraint now means the port
 * touches one file.
 */

import type {
  AssetMeta,
  AssetRecord,
  Backlink,
  DocumentKind,
  DocumentMeta,
  DocumentRecord,
  PMDoc,
  RevisionRecord,
} from '../core/types.ts';

export interface CreateDocumentInput {
  parentId: string | null;
  kind?: DocumentKind;
  title?: string;
  /** Insert after this sibling. null = first child, omitted = last child. */
  afterId?: string | null;
}

export interface MoveDocumentInput {
  id: string;
  parentId: string | null;
  /** Place after this sibling. null = first child, omitted = last child. */
  afterId?: string | null;
}

export interface SaveContentInput {
  id: string;
  content: PMDoc;
  wordCount: number;
  /** Force a revision snapshot regardless of the coalescing window. */
  snapshot?: boolean;
}

export interface PalmaNoteStore {
  /** Metadata for every document, archived included. The tree loads this once. */
  listDocuments(): Promise<DocumentMeta[]>;
  getDocument(id: string): Promise<DocumentRecord | null>;

  createDocument(input: CreateDocumentInput): Promise<DocumentMeta>;
  renameDocument(id: string, title: string): Promise<DocumentMeta>;
  setKind(id: string, kind: DocumentKind): Promise<DocumentMeta>;
  setFavorite(id: string, favorite: boolean): Promise<DocumentMeta>;
  setIcon(id: string, icon: string | null): Promise<DocumentMeta>;
  /**
   * Points a page at a banner image, or at nothing.
   *
   * `cover` is an asset id that went through `putAsset` like any other picture,
   * so a cover is subject to the same de-duplication and the same sweep — see
   * `collectAssets`, which has to count this reference too. `offset` is the
   * band of the image to show, 0–100; repositioning is this call with the id
   * it already had.
   */
  setCover(id: string, cover: string | null, offset: number): Promise<DocumentMeta>;
  saveContent(input: SaveContentInput): Promise<DocumentMeta>;
  moveDocument(input: MoveDocumentInput): Promise<DocumentMeta>;

  archiveDocument(id: string): Promise<DocumentMeta>;
  restoreDocument(id: string): Promise<DocumentMeta>;
  /**
   * The only destructive operation in the app. Takes the document and
   * everything beneath it — content and revision history included — and
   * returns the ids that are gone. Reachable from the archive alone.
   */
  deleteDocument(id: string): Promise<string[]>;

  listRevisions(documentId: string): Promise<RevisionRecord[]>;
  /** Coarse retention pass. Runs at startup, off the critical path. */
  pruneRevisions(): Promise<number>;

  /**
   * Every page whose prose links to this one, unordered and unfiltered.
   *
   * Archived pages are included on purpose. Only a subtree *root* carries
   * `archivedAt`, so reachability is a question about the tree, and the tree
   * lives in the renderer — this layer would have to rebuild it to answer
   * badly what the caller can answer exactly.
   */
  backlinks(id: string): Promise<Backlink[]>;

  /**
   * Stores an image under the hash of its own bytes. Storing one that is
   * already there is a no-op, which is what makes pasting the same picture
   * into six pages cost one copy.
   */
  putAsset(asset: Omit<AssetRecord, 'createdAt'>): Promise<AssetMeta>;
  getAsset(id: string): Promise<AssetRecord | null>;
  /**
   * Drops images that nothing points at any more — no document, no revision.
   * Only worth running after the one operation that can orphan a lot at once.
   */
  collectAssets(): Promise<number>;
}
