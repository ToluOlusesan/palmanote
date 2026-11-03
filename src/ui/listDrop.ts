import type { EditorView } from '@tiptap/pm/view';

import { listSlots, moveListItemTo, type ListSlot } from '../editor/blocks.ts';

/**
 * Dropping a bullet: where it would land, drawn while it is in the air, and the
 * move when it comes down.
 *
 * ProseMirror's own drop path cannot do this. It resolves a point between two
 * bullets to the list rather than to either of them, and its indicator is a
 * text caret — so a bullet dropped above its neighbour quietly went nowhere,
 * under a two-pixel vertical line that had promised nothing. Here the question
 * is asked of the slots `listSlots` offers, measured on screen, and the answer
 * is drawn as the line it will be.
 *
 * Everything runs in the capture phase on the document, ahead of ProseMirror's
 * own listeners, so the margin the handle lives in is droppable ground and the
 * editor never sees a drop it would mistake for pasted text.
 */

interface Placed extends ListSlot {
  /** Viewport y of the gap. */
  y: number;
  left: number;
  right: number;
}

interface Active {
  view: EditorView;
  sourcePos: number;
  chosen: Placed | null;
  line: HTMLDivElement;
  detach: () => void;
}

let active: Active | null = null;

/** How far above the first bullet or below the last one still counts as the list. */
const REACH = 48;

/** The first line of an item — where a reader sees it start. */
function lineBox(li: Element): DOMRect {
  return (li.querySelector(':scope > p, :scope > div > p') ?? li).getBoundingClientRect();
}

function measure(view: EditorView, sourcePos: number): Placed[] {
  const placed: Placed[] = [];
  for (const slot of listSlots(view.state, sourcePos)) {
    const list = view.nodeDOM(slot.listPos);
    if (!(list instanceof HTMLElement)) continue;
    const box = list.getBoundingClientRect();
    if (slot.beforePos !== null) {
      const li = view.nodeDOM(slot.beforePos);
      if (!(li instanceof HTMLElement)) continue;
      const own = li.getBoundingClientRect();
      const prev = li.previousElementSibling;
      // Halfway across the gap, so the line sits between two bullets rather
      // than on the text of either.
      const y = prev ? (prev.getBoundingClientRect().bottom + own.top) / 2 : own.top - 1;
      placed.push({ ...slot, y, left: lineBox(li).left, right: box.right });
    } else {
      const last = list.lastElementChild;
      const left = last ? lineBox(last).left : box.left;
      placed.push({ ...slot, y: box.bottom + 1, left, right: box.right });
    }
  }
  return placed;
}

/**
 * The slot nearest the pointer.
 *
 * Height chooses the gap. Where two gaps share a height — the end of a sub-list
 * and the slot after its parent are the same few pixels — the pointer's
 * horizontal position chooses the depth: the deepest column it has reached,
 * which is how an outliner reads a hand moving right as "inside".
 */
function pick(placed: Placed[], x: number, y: number): Placed | null {
  if (placed.length === 0) return null;
  const top = Math.min(...placed.map((p) => p.y)) - REACH;
  const bottom = Math.max(...placed.map((p) => p.y)) + REACH;
  if (y < top || y > bottom) return null;

  const best = Math.min(...placed.map((p) => Math.abs(p.y - y)));
  const near = placed.filter((p) => Math.abs(p.y - y) <= best + 6);
  const reached = near.filter((p) => x >= p.left - 8).sort((a, b) => b.left - a.left);
  return reached[0] ?? near.sort((a, b) => a.left - b.left)[0] ?? null;
}

function draw(line: HTMLDivElement, slot: Placed | null): void {
  if (!slot) {
    line.classList.remove('is-shown');
    return;
  }
  line.style.width = `${Math.max(24, slot.right - slot.left)}px`;
  line.style.transform = `translate(${slot.left}px, ${slot.y - 1}px)`;
  line.classList.add('is-shown');
}

/** Begin carrying the list item that starts at `sourcePos`. */
export function beginListDrag(view: EditorView, sourcePos: number): void {
  endListDrag();
  const line = document.createElement('div');
  line.className = 'list-drop-line';
  document.body.append(line);
  document.documentElement.classList.add('is-carrying-item');

  const host = view.dom.closest('.editor-host') ?? view.dom;

  const onOver = (event: DragEvent) => {
    if (!active) return;
    const frame = host.getBoundingClientRect();
    const over = event.clientX >= frame.left && event.clientX <= frame.right
      && event.clientY >= frame.top && event.clientY <= frame.bottom;
    active.chosen = over ? pick(measure(view, sourcePos), event.clientX, event.clientY) : null;
    draw(line, active.chosen);
    if (over) {
      // A drop is only delivered where the last dragover was cancelled.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = active.chosen ? 'move' : 'none';
    }
  };

  const onDrop = (event: DragEvent) => {
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
    const { chosen } = active;
    if (chosen) {
      view.focus();
      moveListItemTo(sourcePos, chosen.listPos, chosen.index)(view.state, view.dispatch, view);
    }
    endListDrag();
  };

  document.addEventListener('dragover', onOver, true);
  document.addEventListener('drop', onDrop, true);
  active = {
    view,
    sourcePos,
    chosen: null,
    line,
    detach: () => {
      document.removeEventListener('dragover', onOver, true);
      document.removeEventListener('drop', onDrop, true);
    },
  };
}

/** Put everything away. Safe to call when nothing is being carried. */
export function endListDrag(): void {
  if (!active) return;
  active.detach();
  active.line.remove();
  document.documentElement.classList.remove('is-carrying-item');
  active = null;
}
