import { DotsSixVertical, Plus } from '@phosphor-icons/react';
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
  insertBlockAfter,
  runBlockCommand,
  selectBlock,
  type BlockInfo,
} from '../editor/blocks.ts';
import { BlockMenu } from './BlockMenu.tsx';

/** Where the handle sits when a block's own line height cannot be read. */
const FALLBACK_LINE = 1.5;

interface Spot {
  /** The block this is about, so a scroll can re-measure the same one. */
  pos: number;
  top: number;
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
  const gutter = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  /** The block under a point, or null if the point is not over one. */
  const blockUnder = useCallback(
    (x: number, y: number): BlockInfo | null => {
      if (!editor) return null;
      const found = editor.view.posAtCoords({ left: x, top: y });
      if (!found) return null;
      return blockAt(editor.state, found.pos);
    },
    [editor],
  );

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
      const block = blockUnder(event.clientX, event.clientY);
      // Returning `current` unchanged when the pointer is still over the same
      // block is what makes a mousemove free. Every setter in this handler is a
      // no-op in that case, so crossing a paragraph costs one `posAtCoords` and
      // no render — and the re-measure below is driven by `spot` changing
      // identity rather than by a counter bumped on every event.
      setSpot((current) =>
        block === null
          ? null
          : current?.pos === block.pos
            ? current
            : { pos: block.pos, top: current?.top ?? 0 },
      );
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
  }, [editor, blockUnder]);

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
  */
  useLayoutEffect(() => {
    if (!editor || !spot) return;
    const block = blockFrom(editor.state, spot.pos);
    const dom = block ? editor.view.nodeDOM(block.pos) : null;
    const sheet = editor.view.dom.closest('.sheet');
    if (!(dom instanceof HTMLElement) || !(sheet instanceof HTMLElement)) return;

    const box = dom.getBoundingClientRect();
    const frame = sheet.getBoundingClientRect();
    const style = window.getComputedStyle(dom);
    const parsed = Number.parseFloat(style.lineHeight);
    const line = Number.isFinite(parsed)
      ? parsed
      : Number.parseFloat(style.fontSize) * FALLBACK_LINE;

    const top = box.top - frame.top + line / 2;
    setSpot((current) =>
      current && Math.abs(current.top - top) > 0.5 ? { ...current, top } : current,
    );
  }, [editor, spot, moved]);

  if (!editor) return null;

  const block = spot ? blockFrom(editor.state, spot.pos) : null;
  const hidden = !spot || !block || (quiet && !menu);

  const press = (run: () => void) => (event: ReactMouseEvent) => {
    event.preventDefault();
    run();
  };

  return (
    <>
      <div
        className={`block-gutter${hidden ? '' : ' is-shown'}`}
        ref={gutter}
        style={{ top: spot?.top ?? 0 }}
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
          title="Drag to move, click for actions"
          draggable
          onClick={press(() => {
            if (!block) return;
            runBlockCommand(editor, selectBlock(block));
            const box = gutter.current?.getBoundingClientRect();
            if (box) setMenu({ x: box.left, y: box.bottom + 6 });
          })}
          onDragStart={(event) => {
            if (!block) return;
            dragging.current = true;
            const view = editor.view;
            // Held as an object first, so what leaves is the whole block and
            // ProseMirror's own drop handler has a selection to remove when it
            // lands. This is also what draws the block as chosen while it is in
            // the air.
            runBlockCommand(editor, selectBlock(block));
            const slice = view.state.selection.content();
            event.dataTransfer.effectAllowed = 'move';
            // Something has to be on the transfer or the drag never starts, and
            // the text is what a drop outside this window should produce.
            event.dataTransfer.setData('text/plain', block.node.textContent);
            const dom = view.nodeDOM(block.pos);
            if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 12, 12);
            // The whole of the move: prosemirror-view's drop handler reads this
            // and does the rest, and prosemirror-dropcursor reads it to snap the
            // indicator to a position the block can actually go.
            view.dragging = { slice, move: true };
          }}
          onDragEnd={() => {
            dragging.current = false;
            // A drop outside the editor never reaches the handler that would
            // have cleared this, and a stale one would move the wrong block on
            // the next drag.
            editor.view.dragging = null;
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
