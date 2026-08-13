/**
 * Turns a scope into a set of files. Nothing here knows how files reach the
 * disk — that is the job of `src/data/files.ts`, which is native in Electron
 * and the File System Access API on the web.
 */

import { extensionFor, fromBase64 } from '../editor/assets.ts';
import type { PalmaNoteStore } from '../data/store.ts';
import type { DocxPreset, ManuscriptDetails } from './docx.ts';
import { markdownFromDoc } from './markdown.ts';
import {
  assetIdsIn,
  attachAssets,
  safeFileName,
  walkScope,
  type ExportScope,
  type Walk,
} from './walk.ts';

export type { ExportScope, DocxPreset, ManuscriptDetails };

export type ExportFormat = 'everything' | 'docx' | 'markdown' | 'markdown-folder';

export interface ExportFile {
  /** Relative path, `/` separated. Directories are implied. */
  path: string;
  data: string | Uint8Array;
}

export interface ExportRequest {
  format: ExportFormat;
  scope: ExportScope;
  preset: DocxPreset;
  details: ManuscriptDetails;
}

export interface ExportResult {
  /** Folder name to create, or null when the export is a single file. */
  folder: string | null;
  files: ExportFile[];
}

/**
 * Reads every image the walk points at, once.
 *
 * The bytes have to be in hand before anything is written: markdown needs the
 * file extension to name its link, docx needs the pixels to embed, and both
 * would otherwise be reaching into the database halfway through rendering a
 * paragraph.
 */
async function loadAssets(store: PalmaNoteStore, walk: Walk) {
  const entries = await Promise.all(
    assetIdsIn(walk).map(async (id) => [id, await store.getAsset(id)] as const),
  );
  const assets = new Map<string, { bytes: Uint8Array; width: number; height: number; extension: string }>();
  for (const [id, record] of entries) {
    // An image whose asset has gone is left out rather than faked. The
    // markdown link it leaves behind is dead, which is at least visible.
    if (!record) continue;
    assets.set(id, {
      bytes: fromBase64(record.data),
      width: record.width,
      height: record.height,
      extension: extensionFor(record.mime),
    });
  }
  return assets;
}

/** Named to match `assetPath` in walk.ts, which is what the markdown links. */
function assetFiles(assets: Awaited<ReturnType<typeof loadAssets>>): ExportFile[] {
  return [...assets].map(([id, asset]) => ({
    path: `assets/${id.slice(0, 16)}.${asset.extension}`,
    data: asset.bytes,
  }));
}

export async function buildExport(
  store: PalmaNoteStore,
  request: ExportRequest,
): Promise<ExportResult> {
  const raw = await walkScope(store, request.scope);
  const assets = await loadAssets(store, raw);
  const walk = attachAssets(
    raw,
    new Map([...assets].map(([id, asset]) => [id, asset.extension])),
  );
  const base = safeFileName(walk.title, 'PalmaNote');

  switch (request.format) {
    case 'docx': {
      // The docx writer is a third of the renderer bundle and is needed only
      // when somebody exports. Loading it here keeps it out of startup.
      const { docxFromWalk } = await import('./docx.ts');
      return {
        folder: null,
        files: [
          {
            path: `${base}${request.preset === 'manuscript' ? ' (manuscript)' : ''}.docx`,
            // The one format that swallows its pictures whole, so there is no
            // assets folder beside it to lose on the way to an editor.
            data: await docxFromWalk(walk, request.preset, request.details, assets),
          },
        ],
      };
    }

    case 'markdown':
      return {
        folder: null,
        files: [{ path: `${base}.md`, data: singleMarkdown(walk) }, ...assetFiles(assets)],
      };

    case 'markdown-folder':
      return { folder: base, files: [...markdownTree(walk), ...assetFiles(assets)] };

    case 'everything': {
      // The escape hatch: the tree as nested markdown, plus the complete raw
      // database. Someone with this folder and no PalmaNote can reconstruct
      // everything, by hand if they have to.
      const stamp = new Date().toISOString().slice(0, 10);
      return {
        folder: `${base} export ${stamp}`,
        files: [
          ...markdownTree(walk),
          ...assetFiles(assets),
          { path: 'palmanote-export.json', data: await rawBundle(store) },
          { path: 'README.txt', data: escapeHatchNote(walk.documents.length, assets.size) },
        ],
      };
    }
  }
}

function singleMarkdown(walk: Awaited<ReturnType<typeof walkScope>>): string {
  return walk.documents
    .map((entry) => {
      const heading = entry.meta.title
        ? `${'#'.repeat(Math.min(entry.depth + 1, 6))} ${entry.meta.title}\n\n`
        : '';
      return heading + markdownFromDoc(entry.content);
    })
    .filter((section) => section.trim().length > 0)
    .join('\n\n');
}

function markdownTree(walk: Awaited<ReturnType<typeof walkScope>>): ExportFile[] {
  // Numbered filenames so the folder reads in tree order rather than
  // alphabetically, which is the whole point of exporting a structure.
  const counters = new Map<string, number>();
  const paths = new Map<string, string>();

  return walk.documents.map((entry) => {
    const parentKey = entry.path.join('/');
    const next = (counters.get(parentKey) ?? 0) + 1;
    counters.set(parentKey, next);

    const dir = entry.meta.parentId ? (paths.get(entry.meta.parentId) ?? '') : '';
    const name = `${String(next).padStart(2, '0')} ${safeFileName(entry.meta.title)}`;
    paths.set(entry.meta.id, dir ? `${dir}/${name}` : name);

    const front = [
      '---',
      `title: ${JSON.stringify(entry.meta.title)}`,
      `kind: ${entry.meta.kind}`,
      `words: ${entry.meta.wordCount}`,
      `updated: ${new Date(entry.meta.updatedAt).toISOString()}`,
      `id: ${entry.meta.id}`,
      '---',
      '',
    ].join('\n');

    return {
      path: `${dir ? `${dir}/` : ''}${name}.md`,
      data: front + markdownFromDoc(entry.content) + '\n',
    };
  });
}

async function rawBundle(store: PalmaNoteStore): Promise<string> {
  const documents = await store.listDocuments();
  const records = await Promise.all(documents.map((doc) => store.getDocument(doc.id)));
  const revisions = (
    await Promise.all(documents.map((doc) => store.listRevisions(doc.id)))
  ).flat();
  return JSON.stringify(
    {
      format: 'palmanote-export/1',
      exportedAt: new Date().toISOString(),
      documents: records.filter(Boolean),
      revisions,
    },
    null,
    2,
  );
}

function escapeHatchNote(count: number, images: number): string {
  return [
    'PalmaNote export',
    '',
    `${count} document${count === 1 ? '' : 's'}, written twice over:`,
    '',
    '  * As nested folders of markdown, one file per document, numbered so the',
    '    directory reads in the same order as the tree. Each file carries its',
    '    own title, kind, word count and id in front matter.',
    '',
    '  * As palmanote-export.json, the complete raw database: every document',
    '    with its ProseMirror content, and every revision snapshot.',
    '',
    ...(images > 0
      ? [
          `Alongside them, assets/ holds the ${images} image${images === 1 ? '' : 's'} the pages link`,
          'to, each named by the hash of its own contents. The markdown points at',
          'them with ordinary relative links, so the folder reads correctly in any',
          'markdown editor with PalmaNote nowhere near it.',
          '',
        ]
      : []),
    'The markdown is for reading and for moving to another tool. The JSON is',
    'for rebuilding exactly what was here.',
    '',
  ].join('\n');
}
