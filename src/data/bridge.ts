/**
 * The desktop bridge, as seen from the renderer.
 *
 * This is the *only* place the renderer knows a desktop shell might exist.
 * When `bridge` is null the app is running in a browser and falls back to
 * IndexedDB and the File System Access API; everything above this file is
 * written once and runs in all three.
 *
 * Two shells implement this contract — Tauri over `invoke`, Electron over a
 * preload script — and neither is visible above this file. It is deliberately
 * narrow: documents in and out, files out, window controls. No filesystem, no
 * process spawning, no IPC primitive reaching the page.
 */

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
import type {
  CreateDocumentInput,
  MoveDocumentInput,
  RecordActivityInput,
  SaveContentInput,
} from './store.ts';
import { createTauriBridge, isTauri } from './tauriBridge.ts';

export interface WriteExportRequest {
  folder: string | null;
  files: { path: string; data: string | number[]; binary: boolean }[];
}

export interface WriteExportOutcome {
  written: number;
  location: string | null;
  cancelled: boolean;
}

export interface IncomingFileWire {
  path: string;
  text?: string | null;
  /** Bytes arrive as an array of numbers; that is what survives IPC intact. */
  bytes?: number[] | null;
}

export interface WindowState {
  maximized: boolean;
  fullScreen: boolean;
}

export interface PalmaNoteBridge {
  readonly platform: NodeJS.Platform;
  readonly dataDirectory: string;

  listDocuments(): Promise<DocumentMeta[]>;
  getDocument(id: string): Promise<DocumentRecord | null>;
  createDocument(input: CreateDocumentInput): Promise<DocumentMeta>;
  renameDocument(id: string, title: string): Promise<DocumentMeta>;
  setKind(id: string, kind: DocumentKind): Promise<DocumentMeta>;
  setFavorite(id: string, favorite: boolean): Promise<DocumentMeta>;
  setIcon(id: string, icon: string | null): Promise<DocumentMeta>;
  setCover(id: string, cover: string | null, offset: number): Promise<DocumentMeta>;
  saveContent(input: SaveContentInput): Promise<DocumentMeta>;
  moveDocument(input: MoveDocumentInput): Promise<DocumentMeta>;
  archiveDocument(id: string): Promise<DocumentMeta>;
  restoreDocument(id: string): Promise<DocumentMeta>;
  deleteDocument(id: string): Promise<string[]>;
  listRevisions(documentId: string): Promise<RevisionRecord[]>;
  pruneRevisions(): Promise<number>;
  recordActivity(input: RecordActivityInput): Promise<ActivityDay>;
  listActivity(sinceDay: string): Promise<ActivityDay[]>;
  listStickies(documentId: string): Promise<StickyNote[]>;
  putSticky(note: StickyNote): Promise<StickyNote>;
  deleteSticky(id: string): Promise<void>;
  backlinks(id: string): Promise<Backlink[]>;
  putAsset(asset: Omit<AssetRecord, 'createdAt'>): Promise<AssetMeta>;
  getAsset(id: string): Promise<AssetRecord | null>;
  collectAssets(): Promise<number>;

  /**
   * Writes these assets to a temporary folder and puts the files on the
   * clipboard, alongside markup pointing at them. Returns how many landed.
   *
   * Optional, and the only method here that is: a page cannot put files on the
   * clipboard, so this is the shell doing something the renderer genuinely
   * cannot, and the Electron build has no route to it — Chromium's clipboard
   * API has no file flavour to reach for. Callers fall back to the markup-only
   * copy, which is what the browser build does too. See editor/galleryClipboard.
   */
  copyImages?(ids: string[]): Promise<number>;

  writeExport(request: WriteExportRequest): Promise<WriteExportOutcome>;
  /** Native picker. Empty array means the writer changed their mind. */
  pickImport(folder: boolean): Promise<IncomingFileWire[]>;
  /** Replaces the library with a snapshot and restarts. '' means cancelled. */
  restoreSnapshot(): Promise<string>;
  /**
   * Chooses a PDF and grants the page permission to read that one file. Null
   * when the picker was dismissed.
   */
  pickPdf(): Promise<{ path: string; name: string } | null>;
  printToPDF(title: string): Promise<WriteExportOutcome>;

  /**
   * Hands a link to the machine's browser. Rejects anything that is not
   * http, https or mailto — the check is in Rust, not here, because this is
   * the boundary and the renderer is the side that could be talked into
   * asking. The app itself still fetches nothing.
   */
  openExternal(url: string): Promise<void>;

  windowState(): Promise<WindowState>;
  onWindowState(listener: (state: WindowState) => void): () => void;
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
}

declare global {
  interface Window {
    palmanote?: PalmaNoteBridge;
  }
}

function detect(): PalmaNoteBridge | null {
  if (typeof globalThis === 'undefined') return null;
  // Tauri first: it is the shell we ship.
  if (isTauri()) return createTauriBridge();
  // Electron exposes itself through the preload script.
  return (globalThis as { palmanote?: PalmaNoteBridge }).palmanote ?? null;
}

export const bridge: PalmaNoteBridge | null = detect();

/** True when running inside the desktop shell. */
export const isDesktop = bridge !== null;

/** Reserved because a pending PM document has to survive a crash either way. */
export type PendingContent = PMDoc;
