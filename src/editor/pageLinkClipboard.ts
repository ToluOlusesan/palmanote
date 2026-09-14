/**
 * Copying a page so it can be pasted into another one.
 *
 * Two flavours go on the clipboard, and the pasting half of this feature is
 * already written because of it:
 *
 *   text/html   `<a data-page=… data-label=…>` — which is exactly what
 *               PageLink.parseHTML already looks for, so pasting inside
 *               PalmaNote produces a live link with no new code. The paste
 *               transform in useDocumentEditor strips style, class, id, lang
 *               and dir, and leaves data attributes alone.
 *   text/plain  A `springboard://page/<id>` URI. Honest outside the app —
 *               it says what it is and admits it needs PalmaNote to mean
 *               anything — and recognised on the way back in, for the paste
 *               that arrives without HTML (Ctrl+Shift+V, a plain-text field,
 *               a note passed through somewhere else).
 *
 * A link to a page in someone else's library, or one since deleted, is not an
 * error to guard against here: it parses into a page link that finds nothing,
 * and PageLink already draws that as visibly missing rather than dropping the
 * sentence that pointed at it.
 */

export const PAGE_URI = 'springboard://page/';
/** Private drag flavour used inside PalmaNote. The plain and HTML flavours
    travel beside it so dropping outside the app still produces a useful link. */
export const PAGE_DRAG_TYPE = 'application/x-palmanote-page';

export function pageUri(id: string): string {
  return `${PAGE_URI}${id}`;
}

/** The id in a `springboard://page/<id>`, or null if that is not what it is. */
export function idFromPageUri(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(PAGE_URI)) return null;
  const id = trimmed.slice(PAGE_URI.length);
  // One id and nothing after it: a paragraph that happens to begin with a page
  // URI is prose, not a link.
  return id.length > 0 && !/\s/.test(id) ? id : null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function pageLinkHtml(id: string, title: string): string {
  const label = title || 'Untitled';
  return `<a data-page="${escapeHtml(id)}" data-label="${escapeHtml(label)}">${escapeHtml(label)}</a>`;
}

/**
 * Writes both flavours, falling back to the plain one alone.
 *
 * `ClipboardItem` is the only way to put two representations on the clipboard
 * at once, and it is also the newer API of the two — so a failure here drops
 * to `writeText`, which loses the live link but never loses the reference.
 */
export async function copyPageLink(id: string, title: string): Promise<boolean> {
  const uri = pageUri(id);
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([pageLinkHtml(id, title)], { type: 'text/html' }),
          'text/plain': new Blob([uri], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch {
    // Falls through: a clipboard that refused the rich write may still take
    // the plain one, and a page reference is worth more than its formatting.
  }
  try {
    await navigator.clipboard.writeText(uri);
    return true;
  } catch {
    return false;
  }
}
