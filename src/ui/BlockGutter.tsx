import { DotsSixVertical, Plus } from '@phosphor-icons/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import {
  blockAt,
  blockFrom,
  currentBlock,
  insertBlockAfter,
  isCarryable,
  isListItem,
  LIST_ITEM_DRAG_TYPE,
  runBlockCommand,
  selectBlock,
  type BlockInfo,
} from '../editor/blocks.ts';
import { BlockMenu } from './BlockMenu.tsx';
import { carryBlock, clearLifts } from './blockLift.ts';

/** Where the handle sits when a block's own line height cannot be read. */
const FALLBACK_LINE = 1.5;

/**
 * The `dragend` event is asked one question only: did anything happen.
 *
 * Not where it happened. `dragend` carries coordinates and they cannot be
 * trusted — under a browser driven by the smoke suite they are the point the
 * drag *started* from rather than the point it ended at, which is enough to
 * make any position read there confidently wrong. The document, by contrast, is
 * the same object it was unless a step changed it.
 */
function movedSomething(before: PMNode | null, editor: Editor): boolean {
  return before !== null && editor.state.doc !== before;
}

interface Spot {
  /** The block this is about, so a scroll can re-measure the same one. */
  pos: number;
  top: number;
  /** Null until measured; the stylesheet's own `left` stands in until then. */
  left: number | null;
}

/**
 * The edge a block's controls belong beside.
 *
 * For everything else that is the block itself. A list item is the exception,
 * and measuring it is the trap: an item's box begins *after* its marker, so
 * putting the handle against that edge lands it squarely on top of the bullet.
 * The list is the column the item lives in, and its edge is the one with
 * nothing drawn against it.
 *
 * This is also what makes the handle step in with the indent instead of staying
 * pinned to the measure — a level-three bullet used to be seventy-five pixels
 * away from a control that was supposed to belong to it. Stepping in is safe
 * for the same reason: each level's marker column is the previous level's empty
 * space, and the handle is only ever on one row.
 */
function columnOf(dom: HTMLElement): HTMLElement {
  return dom.tagName === 'LI' ? (dom.parentElement ?? dom) : dom;
}

/**
 * The element whose first line the handle should centre on.
 *
 * Usually the block itself, but a list item is a wrapper: a plain one holds a
 * paragraph, and a task item holds a checkbox label and a div before it gets
 * to one. The item's own box starts above that paragraph, so centring on the
 * item put the handle six pixels high beside every task — the same error as
 * measuring the wrong edge horizontally, in the other direction. The first
 * paragraph inside is the text, and the text is what a reader lines it up with.
 */
function lineOf(dom: HTMLElement): HTMLElement {
  return dom.tagName === 'LI' ? (dom.querySelector('p') ?? dom) : dom;
}

/**
 * The two controls that appear beside the block under the pointer.
 *
 * One gutter that moves, rather than a pair of controls rendered per block.
 * A page of four hundred paragraphs is four hundred blocks and would be eight
 * hundred buttons, all but two of them invisible; this is two buttons that
 * follow the pointer, and the cost of a hover is one `posAtCoords` and one
 * `getBoundingClientRect`.
 *
 * It is pointer-only on purpose and is out of the tab order. Everything it does
 * has a chord — Alt+Shift with an arrow, or D — and a control that is invisible
 * until hovered but still takes focus would put two tab stops in front of every
 * paragraph on the way to the writing.
 */
export function BlockGutter({ editor }: { editor: Editor | null }) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Typing hides it. The pointer is nowhere near the gutter while a sentence is
  // being written, and a control hovering beside the line you are typing is a
  // thing in the corner of your eye that has nothing to say.
  const [quiet, setQuiet] = useState(false);
  // Anything that moves the block a measured gutter is beside.
  const [moved, setMoved] = useState(0);
  // A block is in the air. Separate from `dragging` because the gutter has to
  // go quiet for it, and a ref does not repaint.
  const [lifting, setLifting] = useState(false);
  const gutter = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  /** The document as it was when the handle was taken hold of. */
  const grabbedDoc = useRef<PMNode | null>(null);

  /**
   * The block beside a point.
   *
   * Beside rather than under, and that word is the whole of it. `posAtCoords`
   * answers about the text, and the strip this control lives in is not text —
   * it is the forty pixels of margin between the sheet's edge and the start of
   * the measure. Asked about a point out there it returns nothing, and nothing
   * used to mean "hide", so reaching diagonally for the handle crossed the
   * margin just below it and put it out exactly as the hand arrived. The strip
   * was unreachable by any path that did not come at it dead level.
   *
   * Pulling the question back onto the near edge of the text makes the whole
   * margin live: what matters out there is the line you are level with, and
   * that is the one thing the horizontal position has nothing to say about.
   */
  const blockUnder = useCallback(
    (x: number, y: number): BlockInfo | null => {
      if (!editor) return null;
      const text = editor.view.dom.getBoundingClientRect();
      const onto = Math.min(Math.max(x, text.left + 1), text.right - 1);
      const found = editor.view.posAtCoords({ left: onto, top: y });
      if (!found) return null;
      return blockAt(editor.state, found.pos);
    },
    [editor],
  );

  /**
   * Put the gutter beside a block.
   *
   * A block of `null` leaves it where it was rather than taking it away. Inside
   * the card there is always a nearest block, so no answer means the question
   * was badly aimed — above the first line, in the space under the last one —
   * and blinking the control out on the way past is the same flicker as above.
   * Leaving the card is what hides it, and `mouseleave` says so plainly.
   */
  const placeAt = useCallback((block: BlockInfo | null) => {
    setSpot((current) =>
      block === null || current?.pos === block.pos
        ? current
        : { pos: block.pos, top: current?.top ?? 0, left: current?.left ?? null },
    );
  }, []);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const host = dom.closest('.editor-host') ?? dom;

    const onMove = (event: MouseEvent) => {
      if (dragging.current) return;
      setQuiet(false);
      // Moving onto the gutter itself must not re-ask where the pointer is: it
      // sits left of the text, and the answer there is whatever block happens
      // to be nearest, which is how a handle ends up jumping to its neighbour
      // as you reach for it.
      if (gutter.current?.contains(event.target as Node)) return;
      /*
        Above the first line or below the last one is beside nothing at all.

        The card runs to the bottom of the window and the writing usually does
        not, so most of it is blank — and since `placeAt` holds its position
        rather than blinking out, without this the handle sits pointing at
        whichever block it last saw while the pointer is an inch of empty page
        away from it. The horizontal question is answered by pulling the point
        onto the text; the vertical one has no answer to pull it to.
      */
      const text = dom.getBoundingClientRect();
      if (event.clientY < text.top || event.clientY > text.bottom) {
        setSpot(null);
        return;
      }
      // Returning `current` unchanged when the pointer is still over the same
      // block is what makes a mousemove free. Every setter in this handler is a
      // no-op in that case, so crossing a paragraph costs one `posAtCoords` and
      // no render — and the re-measure below is driven by `spot` changing
      // identity rather than by a counter bumped on every event.
      placeAt(blockUnder(event.clientX, event.clientY));
    };

    // Only when the pointer has left the card entirely. The gutter lives inside
    // it, so reaching for the handle is not leaving.
    const onLeave = () => {
      if (!dragging.current) setSpot(null);
    };
    const onType = () => setQuiet(true);

    host.addEventListener('mousemove', onMove as EventListener);
    host.addEventListener('mouseleave', onLeave);
    dom.addEventListener('keydown', onType);
    return () => {
      host.removeEventListener('mousemove', onMove as EventListener);
      host.removeEventListener('mouseleave', onLeave);
      dom.removeEventListener('keydown', onType);
    };
  }, [editor, blockUnder, placeAt]);

  // A drag that is abandoned by unmount — the page is closed mid-gesture —
  // leaves the card dimmed and a carrier standing.
  useEffect(
    () => () => {
      clearLifts();
      document.querySelector('.editor-host')?.classList.remove('is-lifting');
    },
    [],
  );

  // The document moves under a gutter that is already up — a block above this
  // one grows a line, an image finishes loading, the sheet scrolls.
  useEffect(() => {
    if (!editor || !spot) return;
    const bump = () => setMoved((n) => n + 1);
    editor.on('transaction', bump);
    window.addEventListener('scroll', bump, true);
    window.addEventListener('resize', bump);
    return () => {
      editor.off('transaction', bump);
      window.removeEventListener('scroll', bump, true);
      window.removeEventListener('resize', bump);
    };
  }, [editor, spot]);

  /*
    Measured against the sheet rather than the window, because that is what it
    is positioned inside — and the sheet scrolls, so a viewport coordinate would
    be right for exactly one frame.

    The handle centres on the block's first line rather than on the block, which
    is the difference between a handle beside a heading and a handle beside the
    middle of a four-line paragraph. `lineHeight` is `normal` often enough to
    need the fallback, and `normal` is roughly 1.2–1.5 of the font size in every
    engine this runs on.

    Vertically it follows the block; horizontally it follows the block's column,
    which is a different element for a list item — see `columnOf`. For every
    top-level block the two are the same and this lands exactly where the
    stylesheet's own `left` had it.
  */
  useLayoutEffect(() => {
    if (!editor || !spot) return;
    const block = blockFrom(editor.state, spot.pos);
    const dom = block ? editor.view.nodeDOM(block.pos) : null;
    const sheet = editor.view.dom.closest('.sheet');
    if (!(dom instanceof HTMLElement) || !(sheet instanceof HTMLElement)) return;

    const line1 = lineOf(dom);
    const box = line1.getBoundingClientRect();
    const frame = sheet.getBoundingClientRect();
    const style = window.getComputedStyle(line1);
    const parsed = Number.parseFloat(style.lineHeight);
    const line = Number.isFinite(parsed)
      ? parsed
      : Number.parseFloat(style.fontSize) * FALLBACK_LINE;

    const top = box.top - frame.top + line / 2;
    const left = columnOf(dom).getBoundingClientRect().left - frame.left;
    setSpot((current) => {
      if (!current) return current;
      const moved = Math.abs(current.top - top) > 0.5 || current.left === null
        || Math.abs(current.left - left) > 0.5;
      return moved ? { ...current, top, left } : current;
    });
  }, [editor, spot, moved]);

  if (!editor) return null;

  const block = spot ? blockFrom(editor.state, spot.pos) : null;
  const hidden = !spot || !block || (quiet && !menu);
  const carryable = block !== null && isCarryable(block);

  const press = (run: () => void) => (event: ReactMouseEvent) => {
    event.preventDefault();
    run();
  };

  /** Under the handle, wherever it currently is. Two gestures arrive here. */
  const openMenu = () => {
    const box = gutter.current?.getBoundingClientRect();
    if (box) setMenu({ x: box.left, y: box.bottom + 6 });
  };

  return (
    <>
      <div
        /*
          `is-lifting` fades it rather than unmounting it: the handle is the
          drag source, and a source removed from the document mid-gesture
          cancels the drag in every engine this runs on.
        */
        className={`block-gutter${hidden ? '' : ' is-shown'}${lifting ? ' is-lifting' : ''}`}
        ref={gutter}
        style={{ top: spot?.top ?? 0, left: spot?.left ?? undefined }}
        aria-hidden="true"
        /*
          No `preventDefault` on mousedown here, unlike every other control that
          floats over the writing.

          The menus do it to keep the caret, because a menu about where the
          caret is must not take it. This one must not: preventing the default
          on mousedown is exactly what stops the browser starting a native drag,
          so the handle would open its menu perfectly and never move anything.

          Nothing is lost by leaving it out. Neither control reads the caret —
          the `+` is told which block it is beside, and the handle selects one
          outright — and `runBlockCommand` puts focus back before either acts.
        */
      >
        <button
          type="button"
          className="block-btn"
          tabIndex={-1}
          title="Add a block below"
          onClick={press(() => {
            if (!block) return;
            runBlockCommand(editor, insertBlockAfter(true, block));
          })}
        >
          <Plus size={14} weight="bold" />
        </button>
        <button
          type="button"
          className="block-btn block-handle"
          tabIndex={-1}
          title={carryable ? 'Drag to move, click for actions' : 'Click for actions'}
          /*
            `false`, not absent. React writes `draggable="false"` for it, which
            is what the stylesheet reads to drop the grab cursor — a control
            that says it can be picked up and then cannot is worse than one that
            never offered.
          */
          draggable={carryable}
          onClick={press(() => {
            if (!block) return;
            runBlockCommand(editor, selectBlock(block));
            openMenu();
          })}
          onDragStart={(event) => {
            // Belt to the `draggable` braces: a stray `draggable` attribute
            // from anywhere else would otherwise reopen the gesture silently.
            if (!block || !carryable) {
              event.preventDefault();
              return;
            }
            dragging.current = true;
            setLifting(true);
            const view = editor.view;
            // Held as an object first, so the page makes clear which block has
            // left it.
            runBlockCommand(editor, selectBlock(block));
            // After the selection, not before: holding a block is a transaction
            // too, and only steps that change the document replace this object.
            grabbedDoc.current = view.state.doc;
            const slice = view.state.selection.content();
            event.dataTransfer.effectAllowed = 'move';
            // Something has to be on the transfer or the drag never starts, and
            // the text is what a drop outside this window should produce.
            event.dataTransfer.setData('text/plain', block.node.textContent);
            const dom = view.nodeDOM(block.pos);
            if (dom instanceof HTMLElement) {
              // Grabbed where the pointer actually is, so the block lifts off
              // the page instead of jumping to meet the cursor.
              carryBlock(event.dataTransfer, view.dom, dom, event.clientX, event.clientY);
            }
            // The page reads as having a hole in it where the block was. Set on
            // the card rather than on the editor's own element, whose class
            // list ProseMirror owns and rewrites.
            view.dom.closest('.editor-host')?.classList.add('is-lifting');
            if (isListItem(block)) {
              // List siblings need a precise before/after target. The editor's
              // generic drop handler cannot describe that slot, so its own
              // handleDrop reads this marker and performs the move directly.
              event.dataTransfer.setData(LIST_ITEM_DRAG_TYPE, String(block.pos));
              return;
            }
            // The whole of the move: prosemirror-view's drop handler reads this
            // and does the rest, and prosemirror-dropcursor reads it to snap the
            // indicator to a position the block can actually go.
            view.dragging = { slice, move: true };
          }}
          onDragEnd={() => {
            dragging.current = false;
            setLifting(false);
            clearLifts();
            editor.view.dom.closest('.editor-host')?.classList.remove('is-lifting');
            // A drop outside the editor never reaches the handler that would
            // have cleared this, and a stale one would move the wrong block on
            // the next drag.
            editor.view.dragging = null;

            const before = grabbedDoc.current;
            grabbedDoc.current = null;

            /*
              Nothing moved, so the gesture was a press that the hand did not
              hold quite still.

              The browser calls anything past about four pixels a drag, and once
              it has decided that it sends no `click` at all — which is how
              reaching for the handle used to hold the block, open nothing, and
              then take the handle away with it. The block is held either way,
              since that happens at `dragstart`; the menu is the missing half.
              A drag abandoned halfway lands here too, and a menu is a fair
              answer to picking a block up and putting it back.
            */
            if (!movedSomething(before, editor)) {
              openMenu();
              return;
            }

            /*
              It did move, and no mousemove has fired since the drag began — so
              the gutter is still measured against a position that now holds
              somebody else's block. The block that was just dropped is where
              the hand is, and it is the one thing here that is known rather
              than guessed.

              Read now rather than a frame later. `drop` has already run by the
              time this fires, so the state is current — and a `requestAnimation
              Frame` scheduled from inside `dragend` is not reliably called at
              all, which is a quiet way for the gutter to stay where the drag
              began. Measuring is the layout effect's job and it has its own
              turn after the commit.
            */
            placeAt(currentBlock(editor.state));
          }}
        >
          <DotsSixVertical size={15} weight="bold" />
        </button>
      </div>

      {menu && (
        <BlockMenu editor={editor} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}
    </>
  );
}
