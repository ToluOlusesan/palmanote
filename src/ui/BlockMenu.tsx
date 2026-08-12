import { ArrowDown, ArrowUp, CopySimple, Trash } from '@phosphor-icons/react';
import type { Editor } from '@tiptap/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import {
  currentBlock,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  runBlockCommand,
} from '../editor/blocks.ts';
import { activeBlockType, BLOCK_TYPES } from '../editor/blockTypes.ts';

/**
 * What the drag handle opens onto.
 *
 * Deliberately not [RowMenu](RowMenu.tsx), which says of itself that it is not
 * a general menu system — one level, no submenus, no icons. That was the right
 * shape for a tree row and is the wrong one here: this menu is two lists, and
 * the second of them is nine block types that are unreadable without their
 * icons and meaningless without a tick saying which one you are already in. It
 * borrows the `.menu` surface and the scrim, because a second kind of small
 * menu that looked different would be a worse answer than either.
 *
 * Every verb acts on the current selection rather than on a block handed to it,
 * and that is on purpose: pressing the handle selects the block first, so what
 * the menu acts on is what the page is visibly showing as held. A menu that
 * carried its own idea of the target could act on something the writer could
 * not see was chosen.
 */
export function BlockMenu({
  editor,
  x,
  y,
  onClose,
}: {
  editor: Editor;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Flip rather than overflow — the same rule the row menu uses, for the same
  // reason: a handle near the bottom of the window is exactly where a menu is
  // most likely to be opened and least likely to fit.
  useLayoutEffect(() => {
    const node = menu.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    setPosition({
      left: Math.min(x, window.innerWidth - width - 8),
      top: y + height > window.innerHeight - 8 ? Math.max(8, y - height) : y,
    });
    node.focus();
  }, [x, y]);

  useEffect(() => {
    const dismiss = () => onClose();
    window.addEventListener('resize', dismiss);
    return () => window.removeEventListener('resize', dismiss);
  }, [onClose]);

  const block = currentBlock(editor.state);
  const place = block && editor.state.doc.resolve(block.pos);
  // Greyed rather than hidden: a menu whose items move between openings is a
  // menu you have to read every time.
  const canMoveUp = place ? place.index() > 0 : false;
  const canMoveDown = place ? place.index() < place.parent.childCount - 1 : false;
  const style = activeBlockType(editor);

  const act = (run: () => void) => {
    onClose();
    run();
  };

  const action = (
    label: string,
    hint: string | undefined,
    glyph: ReactNode,
    enabled: boolean,
    run: () => void,
    destructive?: boolean,
  ) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      className={`menu-item block-item${destructive ? ' is-destructive' : ''}`}
      disabled={!enabled}
      onClick={() => act(run)}
    >
      <span className="menu-label">
        <span className="block-glyph" aria-hidden="true">
          {glyph}
        </span>
        <span>{label}</span>
      </span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );

  return (
    <div className="menu-scrim" onMouseDown={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div
        className="menu block-menu"
        role="menu"
        aria-label="Block"
        tabIndex={-1}
        ref={menu}
        style={{ left: position.left, top: position.top }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        {action(
          'Duplicate',
          'Alt+Shift+D',
          <CopySimple size={16} />,
          true,
          () => runBlockCommand(editor, duplicateBlock),
        )}
        {action(
          'Move up',
          'Alt+Shift+↑',
          <ArrowUp size={16} />,
          canMoveUp,
          () => runBlockCommand(editor, moveBlock(-1)),
        )}
        {action(
          'Move down',
          'Alt+Shift+↓',
          <ArrowDown size={16} />,
          canMoveDown,
          () => runBlockCommand(editor, moveBlock(1)),
        )}
        {action(
          'Delete',
          undefined,
          <Trash size={16} />,
          true,
          () => runBlockCommand(editor, deleteBlock),
          true,
        )}

        <p className="menu-group">Turn into</p>
        {BLOCK_TYPES.map((type) => {
          const active = type.id === style.id;
          return (
            <button
              key={type.id}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`menu-item block-item${active ? ' is-active' : ''}`}
              onClick={() =>
                act(() => {
                  // Through the editor's own chain rather than a command here,
                  // so turning a block into a heading is the same operation
                  // whether it was asked for from this menu, the selection bar
                  // or Ctrl+Alt+1.
                  type.run(editor.chain().focus()).run();
                })
              }
            >
              <span className="menu-label">
                <span className="block-glyph" aria-hidden="true">
                  <type.glyph size={16} weight={active ? 'bold' : 'regular'} />
                </span>
                <span>{type.label}</span>
              </span>
              <span className="menu-hint">{type.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
