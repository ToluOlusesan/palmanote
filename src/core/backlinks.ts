/**
 * Reading the link graph backwards.
 *
 * `@` and every page made inside another one leave a `pageLink` node in the
 * prose, so the library already holds a graph of which page points at which.
 * Until now it was only ever read forwards — the link takes you there and
 * nothing takes you back. This walks a document body looking for links to one
 * particular page, which is the half that was missing.
 *
 * The scan is deliberately not an index. A link table would have to be kept
 * true through every save, restore, import and undo, and the thing it would
 * buy is a pass over a corpus that is smaller than one of the app's own
 * screenshots. The Rust store mirrors this file for the desktop build; both
 * sides have to agree on what counts as a reference, so the rule is written
 * once here in prose: a `pageLink` node whose `id` attribute is the target,
 * anywhere in the document, and the block it sits in is the context.
 */

import type { Backlink, PMDoc, PMNode } from './types.ts';

/** Long enough for a sentence, short enough that a page of hits stays a list. */
export const CONTEXT_LIMIT = 240;

/** How many times this subtree links to `target`. */
function countLinks(node: PMNode, target: string): number {
  let found = node.type === 'pageLink' && node.attrs?.id === target ? 1 : 0;
  for (const child of node.content ?? []) found += countLinks(child, target);
  return found;
}

/**
 * The text of a block, with a linked page reading as its label rather than as
 * a hole. Mirrors `blockToText` in pmText, except that a link to the target
 * page is left out: a line that reads "see Harbour notes" is more useful as
 * "see" plus its neighbours than as the title you are already standing on.
 */
function textOf(node: PMNode, target: string): string {
  if (node.type === 'pageLink') {
    return node.attrs?.id === target ? '' : String(node.attrs?.label ?? '');
  }
  if (node.type === 'sceneBreak') return '';
  if (node.type === 'sticker' || node.type === 'image') return '';
  if (node.text !== undefined) return node.text;
  if (node.type === 'hardBreak') return ' ';
  if (!node.content) return '';
  return node.content.map((child) => textOf(child, target)).join('');
}

/** Collapses runs of whitespace and caps the length at a word boundary. */
export function tidyContext(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= CONTEXT_LIMIT) return flat;
  const cut = flat.slice(0, CONTEXT_LIMIT);
  const space = cut.lastIndexOf(' ');
  return `${(space > CONTEXT_LIMIT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * How one page references another, or null when it does not.
 *
 * The context comes from the first block that links, because that is the one
 * the writer would have scrolled to. Later hits raise the count and nothing
 * else — a page that mentions another eleven times does not want eleven rows.
 */
export function referencesTo(content: PMDoc | null, target: string): Omit<Backlink, 'id'> | null {
  if (!content?.content || target.length === 0) return null;
  let count = 0;
  let context = '';
  for (const block of content.content) {
    const hits = countLinks(block, target);
    if (hits === 0) continue;
    if (count === 0) context = tidyContext(textOf(block, target));
    count += hits;
  }
  return count === 0 ? null : { count, context };
}
