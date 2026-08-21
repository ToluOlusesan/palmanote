/**
 * What a paste is allowed to bring with it.
 *
 * For most of this app's life the answer needed almost no code. The schema in
 * extensions.ts is the whole filter: ProseMirror cannot parse a node type that
 * does not exist, so a table, a form or a video pasted off a web page had
 * nowhere to land and fell away for free. All this file had to do was take the
 * styling attributes off the nodes that *did* exist.
 *
 * Tables changed that, and this is the cost of having them. `<table>` is two
 * different things wearing one tag: a grid of data, which is what somebody
 * pasting from a wiki or a spreadsheet means, and a box drawn around a page,
 * which is what a decade of HTML email and older sites use it for. The schema
 * can no longer tell them apart, because it now has somewhere to put both.
 *
 * The rule below is the one signal that separates them reliably: **a table
 * with one cell is not a table.** No one draws a grid with a single box in it;
 * a layout wrapper is exactly that, usually several deep. Cell counts of two
 * and up are left alone, because past one cell the guess stops being safe and
 * a real two-cell table is a thing people write.
 */

/** Cells belonging to this table rather than to a table nested inside it. */
function ownCells(table: Element): Element[] {
  return [...table.querySelectorAll('td, th')].filter((cell) => cell.closest('table') === table);
}

/**
 * Unwraps single-celled tables, keeping what was inside them.
 *
 * Repeated, because layout tables nest: unwrapping the inner one is what turns
 * its parent into a single-celled table in the first place. Bounded rather than
 * looped to stability, since this runs on the keystroke that pastes and a
 * pathological document is not worth a frozen window — four passes is deeper
 * than any real email and costs nothing when there is nothing to do.
 */
function unwrapLayoutTables(document: Document): void {
  for (let pass = 0; pass < 4; pass++) {
    const wrappers = [...document.querySelectorAll('table')].filter(
      (table) => ownCells(table).length <= 1,
    );
    if (wrappers.length === 0) return;
    for (const table of wrappers) {
      const cell = ownCells(table)[0];
      const replacement = document.createElement('div');
      replacement.innerHTML = cell?.innerHTML ?? '';
      table.replaceWith(replacement);
    }
  }
}

/**
 * The whole of what `transformPastedHTML` does.
 *
 * The attribute strip is belt to the schema's braces: `style`, `class`, `id`,
 * `lang` and `dir` ride on nodes that *do* exist here — a paragraph, a
 * heading — and would otherwise bring another site's typography in with the
 * words. Done as a string replace rather than over the parsed document because
 * it predates the parse and is cheaper than one; the parse below happens only
 * when there is a table to think about.
 */
export function cleanPastedHTML(html: string): string {
  const stripped = html.replace(/\s(style|class|id|lang|dir)="[^"]*"/gi, '');
  if (!/<table/i.test(stripped)) return stripped;

  const parsed = new DOMParser().parseFromString(stripped, 'text/html');
  unwrapLayoutTables(parsed);
  return parsed.body.innerHTML;
}
