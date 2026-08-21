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
import type { DocumentKind, PMDoc, PMNode } from '../core/types.ts';
import type { PalmaNoteStore } from '../data/store.ts';
import { parseMarkdown } from './markdown.ts';

export interface IncomingFile {
  /** Path relative to whatever was chosen, `/` separated. */
  path: string;
  /** Text for markdown and JSON, bytes for .docx and for pictures. */
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
  /**
   * The picture files this page's markdown pointed at, by the path written in
   * it — bytes rather than ids, because nothing is in the library yet and the
   * whole promise of the preview is that nothing is written until it has been
   * looked at. `runImport` is where these become assets.
   */
  images?: Map<string, Uint8Array>;
}

export interface ImportResult {
  created: number;
  firstId: string | null;
}

/** Puts bytes in the library and answers with an asset id, or null if it could not. */
export type StoreImage = (bytes: Uint8Array, path: string) => Promise<string | null>;

const KINDS: DocumentKind[] = ['folder', 'chapter', 'scene', 'note'];

/** What arrives as an asset rather than as a page. Mirrors `ACCEPTED` in editor/assets.ts. */
const PICTURE = /\.(png|jpe?g|gif|webp)$/i;

/** Turns chosen files into a tree of documents, without touching the store. */
export async function planImport(files: IncomingFile[]): Promise<ImportPlan[]> {
  const plans: ImportPlan[] = [];
  // Folders in the chosen set become documents too, so a nested export comes
  // back with the same shape it left with.
  const folders = new Map<string, number>();

  // Pictures are not pages. They are set aside before anything else looks at
  // the list, because a `.png` left in it would otherwise become an empty
  // document — and an `assets/` directory holding forty of them would become
  // an empty folder page holding forty more.
  const pictures = new Map<string, IncomingFile>();
  const byName = new Map<string, IncomingFile[]>();
  const documents: IncomingFile[] = [];
  for (const file of files) {
    if (!PICTURE.test(file.path) || !file.bytes) {
      documents.push(file);
      continue;
    }
    pictures.set(normalisePath(file.path), file);
    const name = baseName(file.path).toLowerCase();
    const sharing = byName.get(name);
    if (sharing) sharing.push(file);
    else byName.set(name, [file]);
  }

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
  const ordered = [...documents].sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { numeric: true }),
  );

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
      images: gatherPictures(parsed.doc, directory, pictures, byName),
    });
  }

  return plans;
}

/**
 * The bytes behind every `![…](path)` on a page, by the path as written.
 *
 * Three ways of looking, in order, because "the path as written" means
 * different things depending on who wrote it:
 *
 * 1. **Relative to the markdown file**, which is what markdown means and what
 *    our own export writes.
 * 2. **Relative to the root of what was chosen**, which is what a file written
 *    by hand against a project root usually means.
 * 3. **By filename, if exactly one file in the set has it.** This is the
 *    forgiving one, and it earns its place reading our own older exports:
 *    every page in those linked `assets/x.png` regardless of how deep it sat,
 *    so from the second level down neither of the first two finds anything.
 *    Only when the name is unambiguous — two `photo.png` in different folders
 *    is a guess, and a wrong picture is worse than a missing one.
 *
 * Anything with a scheme in front of it is skipped without being looked for.
 * The app fetches nothing, ever, so a `https://` picture is one we do not have
 * and will not go and get.
 */
function gatherPictures(
  doc: PMDoc,
  directory: string,
  byPath: Map<string, IncomingFile>,
  byName: Map<string, IncomingFile[]>,
): Map<string, Uint8Array> | undefined {
  const found = new Map<string, Uint8Array>();
  for (const src of imageSources(doc)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) continue;
    const named = byName.get(baseName(src).toLowerCase());
    const file =
      byPath.get(normalisePath(directory ? `${directory}/${src}` : src)) ??
      byPath.get(normalisePath(src)) ??
      (named?.length === 1 ? named[0] : undefined);
    if (file?.bytes) found.set(src, file.bytes);
  }
  return found.size > 0 ? found : undefined;
}

/** Every `src` the markdown reader left on an image node, deduplicated. */
function imageSources(doc: PMDoc): Set<string> {
  const out = new Set<string>();
  const visit = (node: PMNode) => {
    if (node.type === 'image' && typeof node.attrs?.src === 'string') out.add(node.attrs.src);
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return out;
}

/**
 * Turns every `{ src }` the reader left behind into the `{ id }` the schema
 * wants, storing the bytes on the way past.
 *
 * `parseMarkdown` is a pure function over a string with no filesystem and no
 * database, so it records the path a picture was written with and stops. This
 * is the other half, and it runs here rather than at plan time because storing
 * assets is writing — and nothing is written until the preview has been
 * accepted.
 *
 * A picture that could not be found is left as a *missing* image rather than
 * dropped, which is the same answer the app gives when an asset goes astray
 * anywhere else. A visible hole is better than a page that quietly came back
 * with one fewer thing in it than the file it was read from.
 */
async function resolveImages(
  doc: PMDoc,
  images: Map<string, Uint8Array> | undefined,
  storeImage: StoreImage | undefined,
): Promise<PMDoc> {
  const sources = imageSources(doc);
  if (sources.size === 0) return doc;

  const ids = new Map<string, string>();
  for (const src of sources) {
    const bytes = images?.get(src);
    if (!bytes || !storeImage) continue;
    // One failure is one missing picture, not a failed import.
    const id = await storeImage(bytes, src).catch(() => null);
    if (id) ids.set(src, id);
  }

  const visit = (node: PMNode): PMNode => {
    if (node.type === 'image' && typeof node.attrs?.src === 'string') {
      return { type: 'image', attrs: { id: ids.get(node.attrs.src) ?? '', alt: node.attrs.alt ?? '' } };
    }
    return node.content ? { ...node, content: node.content.map(visit) } : node;
  };
  return { ...doc, content: doc.content?.map(visit) };
}

/** `a/b/../c.png` → `a/c.png`. Leading `./` and empty segments go too. */
function normalisePath(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
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

/**
 * Writes a plan into the library, parents before children.
 *
 * `storeImage` is how pictures get in. It is a parameter rather than an import
 * for the same reason `store` and `countWords` are: this file is the shape of
 * an import, and hanging the canvas, the hasher and the asset table off it
 * directly would make that shape untestable.
 */
export async function runImport(
  store: PalmaNoteStore,
  plans: ImportPlan[],
  parentId: string | null,
  countWords: (doc: PMDoc) => number,
  storeImage?: StoreImage,
): Promise<ImportResult> {
  const ids: string[] = [];
  for (const plan of plans) {
    const under = plan.parent === null ? parentId : (ids[plan.parent] ?? parentId);
    const meta = await store.createDocument({ parentId: under, kind: plan.kind, title: plan.title });
    ids.push(meta.id);
    if (plan.icon) await store.setIcon(meta.id, plan.icon);
    // Always, even with no way to store one: an image node still carrying the
    // path it was written with is not something this schema can hold, so it
    // becomes a missing picture rather than a node the editor drops on load.
    const content = await resolveImages(plan.content, plan.images, storeImage);
    await store.saveContent({
      id: meta.id,
      content,
      wordCount: countWords(content),
      snapshot: true,
    });
  }
  return { created: ids.length, firstId: ids[0] ?? null };
}

/** `03 Chapter Three.md` came from our own exporter; drop the ordering prefix. */
function stripOrder(name: string): string {
  return name.replace(/^\d{1,3}[\s._-]+/, '').trim() || name;
}
