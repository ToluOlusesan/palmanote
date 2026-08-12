/**
 * Flat rows -> tree, and the traversals the UI needs.
 *
 * Archiving marks the subtree root only. Descendants keep archivedAt null and
 * simply become unreachable, so archive and restore are each a single row
 * update with no cascade to get wrong.
 */

import type { DocumentMeta } from './types.ts';

export interface TreeNode {
  doc: DocumentMeta;
  depth: number;
  children: TreeNode[];
}

export interface VisibleRow {
  doc: DocumentMeta;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

export function buildTree(docs: DocumentMeta[]): TreeNode[] {
  const live = docs.filter((d) => d.archivedAt === null);
  const byParent = new Map<string | null, DocumentMeta[]>();
  for (const doc of live) {
    const bucket = byParent.get(doc.parentId);
    if (bucket) bucket.push(doc);
    else byParent.set(doc.parentId, [doc]);
  }
  for (const bucket of byParent.values()) {
    bucket.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  }

  // Anything under an archived ancestor is simply never reached.
  const build = (parentId: string | null, depth: number): TreeNode[] =>
    (byParent.get(parentId) ?? []).map((doc) => ({
      doc,
      depth,
      children: build(doc.id, depth + 1),
    }));

  return build(null, 0);
}

export function flattenVisible(nodes: TreeNode[], expanded: ReadonlySet<string>): VisibleRow[] {
  const out: VisibleRow[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      const isExpanded = expanded.has(node.doc.id);
      out.push({
        doc: node.doc,
        depth: node.depth,
        hasChildren: node.children.length > 0,
        expanded: isExpanded,
      });
      if (isExpanded) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** Depth-first order of the whole live tree — the order every export walks. */
export function flattenAll(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.doc.id === id) return node;
    const hit = findNode(node.children, id);
    if (hit) return hit;
  }
  return null;
}

export function subtreeWordCount(node: TreeNode): number {
  return node.doc.wordCount + node.children.reduce((sum, c) => sum + subtreeWordCount(c), 0);
}

export function treeWordCount(nodes: TreeNode[]): number {
  return nodes.reduce((sum, n) => sum + subtreeWordCount(n), 0);
}

/** True if `maybeAncestor` is at or above `id` — guards illegal drops. */
export function isAncestor(nodes: TreeNode[], maybeAncestor: string, id: string): boolean {
  const node = findNode(nodes, maybeAncestor);
  if (!node) return false;
  return node.doc.id === id || findNode(node.children, id) !== null;
}

export function siblingsOf(nodes: TreeNode[], parentId: string | null): TreeNode[] {
  if (parentId === null) return nodes;
  return findNode(nodes, parentId)?.children ?? [];
}
