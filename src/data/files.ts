/**
 * Getting bytes onto disk.
 *
 * Three backends, tried in order:
 *   1. Electron — a real native save dialog and real `fs` writes.
 *   2. File System Access API — Chromium's directory picker, which is a
 *      genuine folder on disk, not a download.
 *   3. Downloads — one file at a time, the last resort in a plain browser.
 *
 * Nothing above this file knows which one ran.
 */

import type { ExportResult } from '../export/index.ts';
import { bridge } from './bridge.ts';

export interface WriteOutcome {
  written: number;
  /** Where it landed, if we can say. */
  location: string | null;
  cancelled: boolean;
}

export async function writeExport(result: ExportResult): Promise<WriteOutcome> {
  if (bridge) {
    const outcome = await bridge.writeExport({
      folder: result.folder,
      files: result.files.map((file) => ({
        path: file.path,
        data: typeof file.data === 'string' ? file.data : Array.from(file.data),
        binary: typeof file.data !== 'string',
      })),
    });
    return outcome;
  }

  const picker = (
    window as unknown as {
      showDirectoryPicker?: (options?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;

  if (picker) {
    let root: FileSystemDirectoryHandle;
    try {
      root = await picker({ mode: 'readwrite' });
    } catch {
      return { written: 0, location: null, cancelled: true };
    }
    const base = result.folder ? await root.getDirectoryHandle(result.folder, { create: true }) : root;
    for (const file of result.files) await writeInto(base, file.path, file.data);
    return { written: result.files.length, location: `${root.name}/${result.folder ?? ''}`, cancelled: false };
  }

  for (const file of result.files) download(file.path, file.data);
  return { written: result.files.length, location: 'your downloads', cancelled: false };
}

async function writeInto(
  root: FileSystemDirectoryHandle,
  path: string,
  data: string | Uint8Array,
): Promise<void> {
  const parts = path.split('/');
  const name = parts.pop()!;
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data as FileSystemWriteChunkType);
  await writable.close();
}

function download(path: string, data: string | Uint8Array): void {
  const blob = new Blob([data as BlobPart], { type: guessType(path) });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = path.split('/').pop() ?? 'palmanote';
  anchor.click();
  URL.revokeObjectURL(url);
}

function guessType(path: string): string {
  if (path.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (path.endsWith('.json')) return 'application/json';
  return 'text/plain;charset=utf-8';
}
