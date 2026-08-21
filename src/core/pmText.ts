/**
 * Plain text <-> ProseMirror JSON.
 *
 * Phase 1 edits in a textarea but stores the real ProseMirror document model,
 * so nothing written today needs migrating when Tiptap lands in phase 2.
 * A blank line separates paragraphs; single newlines are hard breaks.
 */

import type { PMDoc, PMNode } from './types.ts';

export const EMPTY_DOC: PMDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

export function docFromPlainText(text: string): PMDoc {
  const blocks = text.split(/\n{2,}/);
  const content: PMNode[] = blocks.map((block) => {
    const lines = block.split('\n');
    const inline: PMNode[] = [];
    lines.forEach((line, i) => {
      if (i > 0) inline.push({ type: 'hardBreak' });
      if (line.length > 0) inline.push({ type: 'text', text: line });
    });
    return inline.length > 0 ? { type: 'paragraph', content: inline } : { type: 'paragraph' };
  });
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

export function plainTextFromDoc(doc: PMDoc | null): string {
  if (!doc?.content) return '';
  return doc.content.map(blockToText).join('\n\n');
}

/**
 * The nodes whose children are a run of text rather than a stack of blocks.
 *
 * Everything else holds blocks, and blocks need something between them or the
 * last word of one is glued to the first word of the next and the pair counts
 * once. That was quietly true of a quote holding two paragraphs; a table makes
 * it loud, because a row of six cells would otherwise be one word.
 */
const INLINE_PARENTS = new Set(['paragraph', 'heading']);

function blockToText(node: PMNode): string {
  if (node.type === 'sceneBreak') return '#';
  if (node.type === 'pageLink') return String(node.attrs?.label ?? '');
  // Nothing, on purpose. This walk is what the word and character counts are
  // made of, and a picture is not words — counting one would make the session
  // total lie about how much was written.
  if (node.type === 'sticker' || node.type === 'image') return '';
  if (node.text !== undefined) return node.text;
  if (node.type === 'hardBreak') return '\n';
  if (!node.content) return '';
  return node.content.map(blockToText).join(INLINE_PARENTS.has(node.type) ? '' : '\n');
}

/** All text in a document, blocks joined by newline. Used for counting. */
export function textOf(doc: PMDoc | null): string {
  if (!doc?.content) return '';
  return doc.content.map(blockToText).join('\n');
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

export function wordCountOf(doc: PMDoc | null): number {
  return countWords(textOf(doc));
}
