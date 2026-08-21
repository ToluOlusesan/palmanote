/**
 * Getting bytes onto disk.
 *
 * Three backends, tried in order:
 *   1. Electron — a real native save dialog and real `fs` writes.
 *   2. File System Access API — Chromium's directory picker, which is a
 *      genuine folder on disk, not a download.
 *   3. Downloads — the last resort in a plain browser, and one file rather
 *      than many: anything that would have been a folder is zipped first.
 *
 * Nothing above this file knows which one ran.
 */

import type { ExportResult } from '../export/index.ts';
import { bridge } from './bridge.ts';
import { zip } from './zip.ts';

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

  // One file, so one download: a .docx or a lone .md goes as itself, and
  // anything with a shape — a tree of markdown, an assets folder, the whole
  // escape hatch — goes as a zip of that shape. Firefox and Safari have no
  // directory picker, and forty separate download prompts is not an export.
  const [first] = result.files;
  if (!first) return { written: 0, location: null, cancelled: false };

  if (result.files.length === 1) {
    download(first.path, first.data);
    return { written: 1, location: 'your downloads', cancelled: false };
  }

  const name = result.folder ?? first.path.replace(/\.[^./]+$/, '');
  download(`${name}.zip`, await zip(result.files));
  // Named in the outcome rather than counted as one file: the export really
  // did write forty pages, and the writer should be told where the other
  // thirty-nine went.
  return { written: result.files.length, location: 'your downloads, as one .zip', cancelled: false };
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
  if (path.endsWith('.zip')) return 'application/zip';
  return 'text/plain;charset=utf-8';
}
