import { bridge, isDesktop, type OpenedDocument } from '../data/bridge.ts';
import { store } from '../data/index.ts';
import { wordCountOf } from '../core/pmText.ts';
import { fromBase64, mimeForName, storeImage } from '../editor/assets.ts';
import { buildExport } from '../export/index.ts';
import { planImport, runImport } from '../import/index.ts';
import type { OpenPdf } from '../ui/PdfReader.tsx';

/**
 * Pages that are files: opened from a .docx on disk and saved back over it.
 *
 * The page is still a page — it lives in the library, autosaves there, has
 * history and backlinks like any other — and the file is where Ctrl+S sends
 * it, the way Word's document is the file. Which page belongs to which file is
 * kept here, in this machine's storage; the shell keeps its own list of the
 * paths it has been handed and refuses any other (see documents.rs).
 */

const LINKS = 'palmanote:linked-files';

function links(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LINKS) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function writeLinks(next: Record<string, string>): void {
  try {
    localStorage.setItem(LINKS, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the page still saves to the library, and the
    // next Ctrl+S simply asks where again.
  }
}

/** The .docx a page saves to, if it has one. */
export function linkedPath(docId: string): string | null {
  return links()[docId] ?? null;
}

function link(docId: string, path: string): void {
  writeLinks({ ...links(), [docId]: path });
}

function pageFor(path: string, exists: (id: string) => boolean): string | null {
  const entry = Object.entries(links()).find(([id, linked]) => linked === path && exists(id));
  return entry?.[0] ?? null;
}

export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** The same door a paste and an import use for pictures. */
async function putImage(bytes: Uint8Array, path: string): Promise<string | null> {
  const stored = await storeImage(new Blob([bytes as unknown as BlobPart], { type: mimeForName(path) }));
  return stored.id;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // In slices: spreading a whole document into one call overflows the stack.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

export interface OpenTarget {
  /** True if a page with this id is in the tree. */
  exists: (id: string) => boolean;
  refresh: () => Promise<void>;
  select: (id: string) => void;
  openPdf: (file: OpenPdf) => void;
}

/**
 * A file handed over by the shell becomes the page it is.
 *
 * A PDF opens in the reader. A Word or markdown file becomes a page — unless a
 * page already came from that file, in which case that page opens, with
 * whatever has been written in it since. Reading the file over it again would
 * throw away edits that were never saved back, which is the one thing Word
 * would never do either.
 */
export async function openDocument(opened: OpenedDocument, target: OpenTarget): Promise<void> {
  if (opened.kind === 'pdf') {
    target.openPdf({ path: opened.path, name: opened.name });
    return;
  }
  const existing = pageFor(opened.path, target.exists);
  if (existing) {
    target.select(existing);
    return;
  }
  const plans = await planImport([
    opened.kind === 'docx'
      ? { path: opened.name, bytes: fromBase64(opened.bytes ?? '') }
      : { path: opened.name, text: opened.text ?? '' },
  ]);
  if (plans.length === 0) throw new Error(`Nothing in ${opened.name} could be read.`);
  const result = await runImport(store, plans, null, wordCountOf, putImage);
  if (!result.firstId) return;
  // Only a Word file is saved back over. Markdown keeps its own escape hatch —
  // Export — and writing .docx bytes into a .md would be vandalism.
  if (opened.kind === 'docx') link(result.firstId, opened.path);
  await target.refresh();
  target.select(result.firstId);
}

/** Ctrl+O: the shell's picker on desktop. */
export async function pickAndOpen(target: OpenTarget): Promise<void> {
  const opened = await bridge?.openDocument?.();
  if (opened) await openDocument(opened, target);
}

/**
 * Ctrl+S. Writes the page back over its .docx, or asks where to save it the
 * first time, after which it is that file's page.
 *
 * Returns what to tell the writer. In the browser there is no file to save
 * to, and the honest answer is that there was nothing to do.
 */
export async function saveToDisk(
  docId: string,
  title: string,
  flush: (() => Promise<void>) | null,
): Promise<string> {
  await flush?.();
  if (!isDesktop || !bridge?.saveDocument || !bridge.saveDocumentAs) {
    return 'Saved — PalmaNote saves as you type.';
  }
  const result = await buildExport(store, {
    format: 'docx',
    scope: { kind: 'document', id: docId },
    preset: 'file',
    details: { surname: '', title: '', author: '', contact: '' },
    name: title,
  });
  const bytes = toBase64(result.files[0]!.data as Uint8Array);
  const path = linkedPath(docId);
  if (path) {
    await bridge.saveDocument(path, bytes);
    return `Saved to ${baseName(path)}`;
  }
  const chosen = await bridge.saveDocumentAs(`${title.trim() || 'Untitled'}.docx`, bytes);
  if (!chosen) return '';
  link(docId, chosen);
  return `Saved to ${baseName(chosen)}`;
}
