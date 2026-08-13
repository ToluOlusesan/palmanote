/**
 * The one tree walk every export shares.
 *
 * Depth-first, in tree order, flattened into a continuous list. docx, PDF,
 * markdown and the escape hatch all consume this — so if two exports ever
 * disagree about ordering, they are both wrong in the same way, which is the
 * only kind of disagreement worth having.
 */

import { buildTree, findNode, flattenAll, type TreeNode } from '../core/tree.ts';
import type { DocumentMeta, DocumentRecord, PMDoc, PMNode } from '../core/types.ts';
import type { PalmaNoteStore } from '../data/store.ts';

export type ExportScope =
  | { kind: 'all' }
  | { kind: 'subtree'; rootId: string }
  | { kind: 'document'; id: string };

export interface WalkedDocument {
  meta: DocumentMeta;
  content: PMDoc | null;
  /** 0 for the top of the exported scope, not of the whole library. */
  depth: number;
  /** Path of ancestor titles inside the scope, for directory mirroring. */
  path: string[];
}

export interface Walk {
  documents: WalkedDocument[];
  /** Title of the exported scope: the root document, or the library. */
  title: string;
  totalWords: number;
}

export async function walkScope(store: PalmaNoteStore, scope: ExportScope): Promise<Walk> {
  const all = await store.listDocuments();
  const tree = buildTree(all);

  let roots: TreeNode[];
  let title: string;
  if (scope.kind === 'all') {
    roots = tree;
    title = 'PalmaNote';
  } else {
    const node = findNode(tree, scope.kind === 'subtree' ? scope.rootId : scope.id);
    if (!node) throw new Error('That page is no longer in the tree.');
    roots = [node];
    title = node.doc.title || 'Untitled';
  }

  const nodes =
    scope.kind === 'document' ? roots : roots.flatMap((root) => flattenAll([root]));
  const baseDepth = nodes[0]?.depth ?? 0;

  const titles = new Map(all.map((doc) => [doc.id, doc.title || 'Untitled']));
  const documents: WalkedDocument[] = [];
  const pathOf = new Map<string, string[]>();
  for (const node of nodes) {
    const record: DocumentRecord | null = await store.getDocument(node.doc.id);
    const parentPath = node.doc.parentId ? (pathOf.get(node.doc.parentId) ?? []) : [];
    const path = [...parentPath, node.doc.title || 'Untitled'];
    pathOf.set(node.doc.id, path);
    documents.push({
      meta: node.doc,
      content: resolvePageLinks(record?.content ?? null, titles),
      depth: node.depth - baseDepth,
      path: path.slice(0, -1),
    });
  }

  return {
    documents,
    title,
    totalWords: documents.reduce((sum, entry) => sum + entry.meta.wordCount, 0),
  };
}

/**
 * Page links store an id and a label written when they were made. The id is
 * the truth in the app; outside it means nothing, so every export gets the
 * title the page has *now* written into the label first. Done once here rather
 * than in each exporter, so markdown and docx cannot disagree.
 */
function resolvePageLinks(doc: PMDoc | null, titles: Map<string, string>): PMDoc | null {
  if (!doc) return null;
  const visit = (node: PMNode): PMNode => {
    const next: PMNode =
      node.type === 'pageLink'
        ? {
            ...node,
            attrs: {
              ...node.attrs,
              label: titles.get(String(node.attrs?.id)) ?? node.attrs?.label ?? 'Untitled',
            },
          }
        : node;
    return next.content ? { ...next, content: next.content.map(visit) } : next;
  };
  return { ...doc, content: doc.content?.map(visit) };
}

/**
 * Where an exported copy of an image lives, relative to the markdown that
 * points at it. Written in one place so the file the exporter emits and the
 * link the markdown writes cannot drift apart.
 *
 * The mime type is carried on the node during a walk — see `attachAssets` —
 * because the document itself only knows the id.
 */
export function assetPath(node: PMNode): string {
  const id = String(node.attrs?.id ?? 'missing');
  const extension = String(node.attrs?.exportExtension ?? 'png');
  return `assets/${id.slice(0, 16)}.${extension}`;
}

/**
 * Every asset id an image in these documents points at.
 *
 * Depth-first over the same walk everything else uses, so an export cannot
 * write a file for a picture it did not also link, or link one it did not
 * write.
 */
export function assetIdsIn(walk: Walk): string[] {
  const found = new Set<string>();
  const visit = (node: PMNode) => {
    if (node.type === 'image' && typeof node.attrs?.id === 'string') found.add(node.attrs.id);
    for (const child of node.content ?? []) visit(child);
  };
  for (const entry of walk.documents) {
    for (const node of entry.content?.content ?? []) visit(node);
  }
  return [...found];
}

/**
 * Writes each image's file extension onto its node, so the markdown writer can
 * name the file it links without going back to the database mid-render.
 */
export function attachAssets(walk: Walk, extensions: Map<string, string>): Walk {
  const visit = (node: PMNode): PMNode => {
    const next: PMNode =
      node.type === 'image'
        ? {
            ...node,
            attrs: {
              ...node.attrs,
              exportExtension: extensions.get(String(node.attrs?.id)) ?? 'png',
            },
          }
        : node;
    return next.content ? { ...next, content: next.content.map(visit) } : next;
  };
  return {
    ...walk,
    documents: walk.documents.map((entry) => ({
      ...entry,
      content: entry.content ? { ...entry.content, content: entry.content.content?.map(visit) } : null,
    })),
  };
}

/** A filename that survives Windows, macOS and being emailed to an editor. */
export function safeFileName(title: string, fallback = 'Untitled'): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '');
  return cleaned.length > 0 ? cleaned.slice(0, 80) : fallback;
}
