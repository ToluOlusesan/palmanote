/**
 * The way in.
 *
 * PalmaNote could already leave five ways and arrive none, which made the
 * escape hatch one-directional and made the nightly snapshots useful to
 * someone with a SQLite client rather than to the person who wrote them.
 *
 * Everything here lands as ProseMirror JSON in the schema the editor already
 * has, so an imported document is indistinguishable from a typed one.
 */

import { htmlToDoc } from '../editor/htmlToDoc.ts';
import type { DocumentKind, PMDoc } from '../core/types.ts';
import type { PalmaNoteStore } from '../data/store.ts';
import { parseMarkdown } from './markdown.ts';

export interface IncomingFile {
  /** Path relative to whatever was chosen, `/` separated. */
  path: string;
  /** Text for markdown and JSON, bytes for .docx. */
  text?: string;
  bytes?: Uint8Array;
}

export interface ImportPlan {
  title: string;
  kind: DocumentKind;
  icon: string | null;
  content: PMDoc;
  /** Index into `plans`, or null for a top-level document. */
  parent: number | null;
}

export interface ImportResult {
  created: number;
  firstId: string | null;
}

const KINDS: DocumentKind[] = ['folder', 'chapter', 'scene', 'note'];

/** Turns chosen files into a tree of documents, without touching the store. */
export async function planImport(files: IncomingFile[]): Promise<ImportPlan[]> {
  const plans: ImportPlan[] = [];
  // Folders in the chosen set become documents too, so a nested export comes
  // back with the same shape it left with.
  const folders = new Map<string, number>();

  const ensureFolder = (path: string): number | null => {
    if (path.length === 0) return null;
    const existing = folders.get(path);
    if (existing !== undefined) return existing;
    const cut = path.lastIndexOf('/');
    const parent = cut === -1 ? null : ensureFolder(path.slice(0, cut));
    const index = plans.length;
    plans.push({
      title: stripOrder(cut === -1 ? path : path.slice(cut + 1)),
      kind: 'folder',
      icon: null,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      parent,
    });
    folders.set(path, index);
    return index;
  };

  // Directories before their contents, so a parent always exists first.
  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));

  for (const file of ordered) {
    const cut = file.path.lastIndexOf('/');
    const directory = cut === -1 ? '' : file.path.slice(0, cut);
    const name = cut === -1 ? file.path : file.path.slice(cut + 1);
    const parent = ensureFolder(directory);

    if (/\.json$/i.test(name)) {
      plans.push(...planBundle(file.text ?? '', parent));
      continue;
    }

    if (/\.docx$/i.test(name)) {
      const { default: mammoth } = await import('mammoth');
      const converted = await mammoth.convertToHtml({
        arrayBuffer: (file.bytes ?? new Uint8Array()).buffer as ArrayBuffer,
      });
      plans.push({
        title: stripOrder(name.replace(/\.docx$/i, '')),
        kind: 'chapter',
        icon: null,
        // Word's HTML goes through the same schema filter as a paste, so
        // nothing arrives that the editor cannot represent.
        content: htmlToDoc(converted.value),
        parent,
      });
      continue;
    }

    const parsed = parseMarkdown(file.text ?? '');
    const fallback = stripOrder(name.replace(/\.(md|markdown|txt)$/i, ''));
    plans.push({
      title: parsed.front.title ?? parsed.impliedTitle ?? fallback,
      kind: KINDS.includes(parsed.front.kind as DocumentKind)
        ? (parsed.front.kind as DocumentKind)
        : 'note',
      icon: parsed.front.icon,
      content: parsed.doc,
      parent,
    });
  }

  return plans;
}

/** `palmanote-export.json` — our own format, so nothing is guessed at. */
function planBundle(raw: string, parent: number | null): ImportPlan[] {
  let parsed: { documents?: unknown };
  try {
    parsed = JSON.parse(raw) as { documents?: unknown };
  } catch {
    return [];
  }
  const documents = Array.isArray(parsed.documents) ? parsed.documents : [];
  const byId = new Map<string, number>();
  const plans: ImportPlan[] = [];

  // Two passes: rows first so every parent has an index, then re-point them.
  for (const entry of documents as Record<string, unknown>[]) {
    byId.set(String(entry.id), plans.length);
    plans.push({
      title: String(entry.title ?? ''),
      kind: KINDS.includes(entry.kind as DocumentKind) ? (entry.kind as DocumentKind) : 'note',
      icon: typeof entry.icon === 'string' ? entry.icon : null,
      content: (entry.content as PMDoc) ?? { type: 'doc', content: [{ type: 'paragraph' }] },
      parent,
    });
  }
  documents.forEach((entry, index) => {
    const parentId = (entry as Record<string, unknown>).parentId;
    if (typeof parentId === 'string' && byId.has(parentId)) {
      plans[index]!.parent = byId.get(parentId)!;
    }
  });
  return plans;
}

/** Writes a plan into the library, parents before children. */
export async function runImport(
  store: PalmaNoteStore,
  plans: ImportPlan[],
  parentId: string | null,
  countWords: (doc: PMDoc) => number,
): Promise<ImportResult> {
  const ids: string[] = [];
  for (const plan of plans) {
    const under = plan.parent === null ? parentId : (ids[plan.parent] ?? parentId);
    const meta = await store.createDocument({ parentId: under, kind: plan.kind, title: plan.title });
    ids.push(meta.id);
    if (plan.icon) await store.setIcon(meta.id, plan.icon);
    await store.saveContent({
      id: meta.id,
      content: plan.content,
      wordCount: countWords(plan.content),
      snapshot: true,
    });
  }
  return { created: ids.length, firstId: ids[0] ?? null };
}

/** `03 Chapter Three.md` came from our own exporter; drop the ordering prefix. */
function stripOrder(name: string): string {
  return name.replace(/^\d{1,3}[\s._-]+/, '').trim() || name;
}
