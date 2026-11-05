import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/**
 * Page view's page breaks, moved rather than drawn over.
 *
 * Page view used to only paint a band where each 11-inch page ends, and the
 * text ran straight through it, so a line could sit right on the cut. This
 * pushes whatever would cross a cut down to the top margin of the next page,
 * the way Word lays out Print Layout:
 *
 * - a paragraph (any textblock, at any depth) breaks between its lines: a
 *   block-level spacer is put inline at the start of the first line that
 *   would cross, so the lines above it stay where they were;
 * - anything that cannot be split (an image, a table, a gallery, a scene
 *   break) moves down whole, unless it is taller than a page, in which case
 *   it is left to run across the cut as before.
 *
 * Spacers are decorations, so nothing reaches the document, the exports or
 * the clipboard. They are worked out against the layout *without* spacers:
 * each pass takes the old ones out, measures, and puts new ones in, in the
 * same task, so nothing paints in between.
 */

type Spacer = { pos: number; height: number; block: boolean };

type PaginationState = { enabled: boolean; decorations: DecorationSet; spacers: Spacer[] };

type Meta = { enabled?: boolean; spacers?: Spacer[] };

const paginationKey = new PluginKey<PaginationState>('palmanotePagination');

/** CSS pixels to the inch. */
const INCH = 96;

/** Nodes moved whole. Everything else either holds text or holds blocks. */
function isUnit(node: PMNode): boolean {
  return node.isAtom || node.isLeaf || node.type.name === 'table';
}

function decorationsFor(state: EditorState, spacers: Spacer[]): DecorationSet {
  if (spacers.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    state.doc,
    spacers.map(({ pos, height, block }) =>
      Decoration.widget(
        pos,
        () => {
          const element = document.createElement(block ? 'div' : 'span');
          element.className = 'page-spacer';
          element.contentEditable = 'false';
          element.setAttribute('aria-hidden', 'true');
          element.style.height = `${height}px`;
          return element;
        },
        // Before the caret at this position, and keyed on the height so a
        // changed spacer is redrawn rather than reused.
        { side: -1, ignoreSelection: true, key: `page-spacer:${block}:${height}` },
      ),
    ),
  );
}

function sameSpacers(a: Spacer[], b: Spacer[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, i) => {
      const t = b[i];
      return t !== undefined && s.pos === t.pos && s.block === t.block && Math.abs(s.height - t.height) < 0.5;
    })
  );
}

function inches(value: string, fallback: number): number {
  const match = /^\s*([\d.]+)\s*(in|px)?\s*$/.exec(value);
  if (!match) return fallback;
  const n = parseFloat(match[1] ?? '');
  return match[2] === 'px' ? n : n * INCH;
}

/** Where the breaks fall, measured on a layout that has none. */
function measure(view: EditorView): Spacer[] {
  const sheet = view.dom.closest<HTMLElement>('.sheet');
  if (!sheet) return [];
  const sheetStyle = getComputedStyle(sheet);
  const pageLength = inches(sheetStyle.getPropertyValue('--page-length'), 11 * INCH);
  const margin = parseFloat(sheetStyle.paddingTop) || INCH;
  const contentHeight = pageLength - 2 * margin;
  if (contentHeight <= 0) return [];
  const origin = sheet.getBoundingClientRect().top;

  /** The bottom of the writing area on the page that `y` falls on. */
  const page = (y: number) => Math.max(0, Math.floor((y - origin) / pageLength));
  const contentBottom = (k: number) => origin + k * pageLength + pageLength - margin;
  const nextContentTop = (k: number) => origin + (k + 1) * pageLength + margin;

  const spacers: Spacer[] = [];
  // How far everything has moved down so far, on top of the measured layout.
  let shift = 0;

  const textblock = (node: PMNode, pos: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    if (rect.height === 0) return;
    const style = getComputedStyle(element);
    const lineHeight = parseFloat(style.lineHeight);
    const start = pos + 1;
    const end = pos + 1 + node.content.size;

    /** The line box around position `p`, as laid out without spacers. */
    const line = (p: number) => {
      const c = view.coordsAtPos(p, 1);
      const lead = Number.isFinite(lineHeight) ? Math.max(0, (lineHeight - (c.bottom - c.top)) / 2) : 0;
      return { top: c.top - lead, bottom: c.bottom + lead };
    };

    // An empty paragraph has no text to measure; its own box is its line.
    if (node.content.size === 0) {
      const top = rect.top + parseFloat(style.paddingTop) + shift;
      const k = page(top);
      const bottom = rect.bottom - parseFloat(style.paddingBottom) + shift;
      if (bottom > contentBottom(k)) {
        const height = nextContentTop(k) - top;
        spacers.push({ pos: start, height, block: false });
        shift += height;
      }
      return;
    }

    let from = start;
    // A paragraph longer than a page crosses more than one cut, so this
    // repeats; every pass moves at least one line onto the next page.
    for (let guard = 0; guard < 1000 && from <= end; guard++) {
      const k = page(line(from).top + shift);
      const cut = contentBottom(k);
      // Line bottoms only go down through a paragraph, so the first line to
      // reach past this page's cut can be bisected for.
      if (line(end).bottom + shift <= cut) return;
      let lo = from;
      let hi = end;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (line(mid).bottom + shift > cut) hi = mid;
        else lo = mid + 1;
      }
      const top = line(lo).top + shift;
      const height = nextContentTop(k) - top;
      if (height <= 0) {
        // Already past this page; look again from the page it is on.
        if (lo === from) return;
        from = lo;
        continue;
      }
      spacers.push({ pos: lo, height, block: false });
      shift += height;
      from = lo;
    }
  };

  const unit = (element: HTMLElement, pos: number) => {
    const rect = element.getBoundingClientRect();
    if (rect.height === 0 || rect.height > contentHeight) return;
    const top = rect.top + shift;
    const k = page(top);
    if (rect.bottom + shift <= contentBottom(k)) return;
    const height = nextContentTop(k) - top;
    if (height <= 0) return;
    // A block spacer sits between this and the block before it, which
    // separates their collapsed margins: the smaller one comes back.
    const marginTop = parseFloat(getComputedStyle(element).marginTop) || 0;
    const previous = element.previousElementSibling;
    const marginBottom = previous ? parseFloat(getComputedStyle(previous).marginBottom) || 0 : 0;
    spacers.push({ pos, height, block: true });
    shift += height + Math.max(0, Math.min(marginTop, marginBottom));
  };

  view.state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const element = view.nodeDOM(pos);
      if (element instanceof HTMLElement) textblock(node, pos, element);
      return false;
    }
    if (isUnit(node)) {
      const element = view.nodeDOM(pos);
      if (element instanceof HTMLElement) unit(element, pos);
      return false;
    }
    return true;
  });

  return spacers.map((s) => ({ ...s, height: Math.round(s.height * 100) / 100 }));
}

class PaginationView {
  private frame: number | null = null;
  private readonly observer: ResizeObserver;

  constructor(private readonly view: EditorView) {
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(view.dom);
    // The sheet's width and padding spring when page view turns on.
    view.dom.closest('.sheet')?.addEventListener('transitionend', this.schedule);
    void document.fonts?.ready.then(() => this.schedule());
  }

  update(view: EditorView, previous: EditorState) {
    const now = paginationKey.getState(view.state);
    const before = paginationKey.getState(previous);
    if (view.state.doc !== previous.doc || now?.enabled !== before?.enabled) this.schedule();
  }

  schedule = () => {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.run();
    });
  };

  private run() {
    const { view } = this;
    const state = paginationKey.getState(view.state);
    if (!state) return;
    if (!state.enabled) {
      if (state.spacers.length) this.set([]);
      return;
    }
    const scroller = view.dom.closest<HTMLElement>('.sheet')?.parentElement ?? null;
    const scrollTop = findScroller(scroller)?.scrollTop;
    const old = state.spacers;
    if (old.length) this.set([]);
    const next = measure(view);
    if (sameSpacers(old, next)) {
      if (old.length) this.set(old);
    } else {
      this.set(next);
    }
    const host = findScroller(scroller);
    if (host && scrollTop !== undefined && host.scrollTop !== scrollTop) host.scrollTop = scrollTop;
  }

  private set(spacers: Spacer[]) {
    const meta: Meta = { spacers };
    this.view.dispatch(this.view.state.tr.setMeta(paginationKey, meta).setMeta('addToHistory', false));
  }

  destroy() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.view.dom.closest('.sheet')?.removeEventListener('transitionend', this.schedule);
  }
}

function findScroller(from: HTMLElement | null): HTMLElement | null {
  for (let element = from; element; element = element.parentElement) {
    const overflow = getComputedStyle(element).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && element.scrollHeight > element.clientHeight) {
      return element;
    }
  }
  return null;
}

export const Pagination = Extension.create({
  name: 'palmanotePagination',

  addProseMirrorPlugins() {
    return [
      new Plugin<PaginationState>({
        key: paginationKey,
        state: {
          init: () => ({ enabled: false, decorations: DecorationSet.empty, spacers: [] }),
          apply(tr, value, _old, state) {
            const meta = tr.getMeta(paginationKey) as Meta | undefined;
            if (meta?.enabled !== undefined && meta.enabled !== value.enabled) {
              // Turning it off drops the spacers at once; turning it on
              // waits for the view to measure.
              return meta.enabled
                ? { ...value, enabled: true }
                : { enabled: false, decorations: DecorationSet.empty, spacers: [] };
            }
            if (meta?.spacers) {
              return { ...value, spacers: meta.spacers, decorations: decorationsFor(state, meta.spacers) };
            }
            if (!tr.docChanged) return value;
            // Until the next measurement, the old breaks ride along with the
            // text they were in front of.
            const spacers = value.spacers
              .map((s) => ({ ...s, pos: tr.mapping.map(s.pos, -1) }))
              .filter((s) => s.pos <= state.doc.content.size);
            return { ...value, spacers, decorations: value.decorations.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations: (state) => paginationKey.getState(state)?.decorations,
        },
        view: (view) => new PaginationView(view),
      }),
    ];
  },
});

/** Page view on or off, for this editor. */
export function setPagination(editor: Editor, enabled: boolean) {
  if (editor.isDestroyed) return;
  const current = paginationKey.getState(editor.state);
  if (current?.enabled === enabled) return;
  const meta: Meta = { enabled };
  editor.view.dispatch(editor.state.tr.setMeta(paginationKey, meta).setMeta('addToHistory', false));
}
