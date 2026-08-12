import type { DocumentMeta } from './types.ts';

/**
 * Finding a page by its title.
 *
 * Titles only, and that is a decision rather than a stopping point. The tree
 * holds every page's metadata in memory and deliberately leaves the bodies in
 * the database — which is what lets the sidebar draw a thousand pages without
 * reading a novel — so a title search is a pass over an array that is already
 * in hand, and runs between keystrokes without asking storage anything.
 * Searching the writing itself is a different feature with a different cost:
 * an FTS index on one side and a real one on the other.
 *
 * Ranking is four tiers and a tiebreak, in the order a writer means them:
 * the page you named exactly, then the one whose title starts that way, then
 * the one where some *word* does, then the one that merely contains it. Ties
 * go to whatever was touched most recently, because the page you are looking
 * for is usually the page you were just in.
 */

export const enum Rank {
  Exact = 0,
  Prefix = 1,
  Word = 2,
  Contains = 3,
}

export interface PageMatch {
  doc: DocumentMeta;
  /** Ancestor titles, outermost first. Empty for a page at the top. */
  trail: string[];
  rank: Rank;
}

export interface SearchOptions {
  /** Left out of the results — usually the page being written in. */
  exclude?: string | null;
  limit?: number;
}

const DEFAULT_LIMIT = 8;

export function searchPages(
  pages: readonly DocumentMeta[],
  byId: ReadonlyMap<string, DocumentMeta>,
  query: string,
  options: SearchOptions = {},
): PageMatch[] {
  const needle = query.trim().toLowerCase();
  const limit = options.limit ?? DEFAULT_LIMIT;

  const candidates = pages.filter((doc) => doc.id !== options.exclude);

  // Nothing typed yet is not "no answer" — it is "the ones you were just in",
  // which is the right first guess and makes the empty state useful.
  if (needle.length === 0) {
    return [...candidates]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((doc) => ({ doc, trail: trailOf(doc, byId), rank: Rank.Contains }));
  }

  const ranked: PageMatch[] = [];
  for (const doc of candidates) {
    const rank = rankOf(doc.title, needle);
    if (rank === null) continue;
    ranked.push({ doc, trail: trailOf(doc, byId), rank });
  }

  return ranked
    .sort((a, b) => a.rank - b.rank || b.doc.updatedAt - a.doc.updatedAt)
    .slice(0, limit);
}

function rankOf(title: string, needle: string): Rank | null {
  const lowered = title.toLowerCase();
  if (lowered === needle) return Rank.Exact;
  if (lowered.startsWith(needle)) return Rank.Prefix;
  const at = lowered.indexOf(needle);
  if (at < 0) return null;
  // A word boundary before it: "one" should find "Chapter One" well above
  // "Someone else", which contains the same three letters mid-word.
  return /[\s\-–—/(:]/.test(lowered[at - 1] ?? '') ? Rank.Word : Rank.Contains;
}

/** Titles of everything this page sits inside, outermost first. */
export function trailOf(doc: DocumentMeta, byId: ReadonlyMap<string, DocumentMeta>): string[] {
  const out: string[] = [];
  let parent = doc.parentId ? byId.get(doc.parentId) : undefined;
  // A cycle cannot happen through the UI, but a corrupt library should not
  // hang the search box while proving it.
  let guard = 0;
  while (parent && guard++ < 64) {
    out.unshift(parent.title || 'Untitled');
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return out;
}

/** True when some page is already called exactly this. */
export function titleTaken(pages: readonly DocumentMeta[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle.length > 0 && pages.some((doc) => doc.title.toLowerCase() === needle);
}
