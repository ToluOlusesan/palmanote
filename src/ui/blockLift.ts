/**
 * The picture a block makes while it is in the air.
 *
 * A drag is the one gesture where the app has to draw the thing being moved
 * itself — the browser will happily use the live element, but only ever grabbed
 * at a point you name in advance, and the point that matters here is wherever
 * the pointer happened to be when the handle was pressed. Naming a constant
 * instead makes the block jump sideways at the instant of the grab, which is
 * the difference between picking something up and having it snatched.
 *
 * So: a clone, in a carrier sized to reach back under the pointer, handed to
 * the browser as the drag image and thrown away on the next frame.
 */

/** Breathing room around the clone, so the card has an edge and not just prose. */
const PAD = 8;

/** Left behind if a drag ends before the frame that would have swept it. */
export const LIFT_CLASS = 'block-lift';

/** Remove any carrier still standing. Safe to call when there is none. */
export function clearLifts(): void {
  for (const stale of document.querySelectorAll(`.${LIFT_CLASS}`)) stale.remove();
}

/**
 * Hand the browser a picture of `dom` grabbed at (`x`, `y`).
 *
 * The carrier is built off-screen rather than over the block it copies. On
 * Windows a drag runs inside a nested message loop, which can hold off the
 * frame that would have removed it until the drop — off-screen, that costs
 * nothing; over the block, it would sit there for the whole drag hiding the
 * hole the block left behind.
 */
export function carryBlock(
  transfer: DataTransfer,
  host: HTMLElement,
  dom: HTMLElement,
  x: number,
  y: number,
): void {
  clearLifts();

  // No list-item case here on purpose. An item used to be cloned back into a
  // list of one so its marker survived the trip, and that code was correct and
  // is gone: list items are not carried by hand at all — see `isCarryable` in
  // src/editor/blocks.ts for why. A branch kept for a gesture that cannot
  // happen is a claim that it can.
  const box = dom.getBoundingClientRect();

  // The pointer is on the handle, which sits outside the block to its left, and
  // a drag image cannot be grabbed at a point outside itself. This is how far
  // the picture has to reach back to take that point in.
  const reachX = Math.max(0, box.left - x) + PAD;
  const reachY = Math.max(0, box.top - y) + PAD;

  const carrier = document.createElement('div');
  // Every prose rule in the sheet is a descendant of `.body`, so the clone only
  // looks like the page it came from if the carrier stands in for it. The
  // state classes are left behind — `ProseMirror-focused` on a picture of a
  // paragraph is a caret drawn into a thing that cannot be typed in.
  carrier.className = [LIFT_CLASS, ...host.classList]
    .filter((name) => !name.startsWith('ProseMirror-'))
    .join(' ');
  /*
    Placed from here rather than from the stylesheet, all of it.

    Wearing the editor's classes is what makes the clone look like the page, and
    it is also what makes a stylesheet unsafe to rely on: prosemirror-view
    injects its own `.ProseMirror { position: relative }` at runtime, into a tag
    that lands after ours, and at equal weight the last rule wins. That one
    silently turned this from a card at a known place into a relative box ten
    thousand pixels left of the end of the document — off-screen by luck rather
    than by instruction. `.body`'s twenty-rem `min-height` is the same story: it
    exists so an empty page is something to click into, and around one paragraph
    it is a blank card the height of a screen trailing the pointer.
  */
  carrier.style.position = 'fixed';
  carrier.style.top = '0';
  carrier.style.left = '-10000px';
  carrier.style.minHeight = '0';
  carrier.style.boxSizing = 'border-box';
  carrier.style.pointerEvents = 'none';
  carrier.style.width = `${box.width + reachX * 2}px`;
  carrier.style.padding = `${reachY}px ${reachX}px`;

  const clone = dom.cloneNode(true) as HTMLElement;
  // It was selected to be picked up; in the air it is just the block.
  clone.classList.remove('ProseMirror-selectednode');
  // The block's own margin is outside the box that was measured, so keeping it
  // would push the clone off the position the offsets below assume.
  clone.style.margin = '0';

  carrier.append(clone);

  document.body.append(carrier);
  transfer.setDragImage(carrier, x - (box.left - reachX), y - (box.top - reachY));
  // The browser takes its picture once this event has finished, so the carrier
  // only has to outlive the turn. `dragend` sweeps whatever this misses.
  requestAnimationFrame(clearLifts);
}
