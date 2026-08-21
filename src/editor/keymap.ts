import { Extension } from '@tiptap/core';
import type { Command, EditorState } from '@tiptap/pm/state';

import { duplicateBlock, moveBlock } from './blocks.ts';

/** Lists nest this deep and no deeper. */
export const MAX_LIST_DEPTH = 3;

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

function listContext(state: EditorState): { itemType: string | null; depth: number } {
  const { $from } = state.selection;
  let itemType: string | null = null;
  let depth = 0;
  for (let level = $from.depth; level > 0; level--) {
    const name = $from.node(level).type.name;
    if (LIST_TYPES.has(name)) depth++;
    if (!itemType && (name === 'taskItem' || name === 'listItem')) itemType = name;
  }
  return { itemType, depth };
}

/**
 * Windows bindings. Tiptap ships `Mod-Shift-s` for strikethrough; the owner
 * asked for Ctrl+Shift+X, which is also what Word and most editors use.
 *
 * Tab nests inside a list and does nothing elsewhere, so it still moves focus
 * out of the editor for keyboard users who need it to.
 */
export const Shortcuts = Extension.create({
  name: 'palmanoteKeymap',
  // Above the list extensions, which bind Tab to an uncapped sinkListItem.
  priority: 1000,

  addKeyboardShortcuts() {
    const heading = (level: 1 | 2 | 3) => () => this.editor.commands.toggleHeading({ level });
    // The block verbs are ProseMirror commands rather than Tiptap ones, because
    // the gutter needs the same six and a `Command` is what runs from both.
    const block = (command: Command) => () =>
      command(this.editor.state, this.editor.view.dispatch, this.editor.view);

    return {
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
      'Mod-Alt-1': heading(1),
      'Mod-Alt-2': heading(2),
      'Mod-Alt-3': heading(3),
      'Mod-Alt-0': () => this.editor.commands.setParagraph(),

      /*
        Blocks as objects, from the keyboard.

        Alt+Shift rather than Alt alone, which the tree already uses to reorder
        rows and which would mean two different things depending on where the
        focus was. Alt+Shift+arrow is also what VS Code and Word use for moving
        a line, so it is the chord most likely to be tried first.

        Deliberately not Ctrl+D for duplicate, which is the obvious one and is
        already favouriting the open page at the window level. A chord that
        does one thing in the sidebar and another in the writing is worse than
        a less obvious chord that always means the same.
      */
      'Alt-Shift-ArrowUp': block(moveBlock(-1)),
      'Alt-Shift-ArrowDown': block(moveBlock(1)),
      'Alt-Shift-d': block(duplicateBlock),

      /*
        Tab means three different things, and this is the only place that knows
        the order to ask in.

        This extension sits at priority 1000, above both the list extensions'
        uncapped `sinkListItem` and the table's `goToNextCell`, so whatever it
        declines falls through to them in that order. Declining is therefore a
        decision rather than a default, which is why the table case is written
        out here instead of being left to fall through: a list *inside* a table
        cell is still a list, and Tab in it has to nest rather than jump to the
        next cell.
      */
      Tab: () => {
        const { itemType, depth } = listContext(this.editor.state);
        if (itemType) {
          // At the limit, swallow the key rather than letting the list
          // extensions' own uncapped Tab handler sink another level.
          if (depth >= MAX_LIST_DEPTH) return true;
          return this.editor.commands.sinkListItem(itemType);
        }
        if (this.editor.isActive('table')) {
          // A new row off the end of the last cell, which is what every table
          // in every editor does and what makes one fillable without reaching
          // for the mouse. Tab is how you type a table, not how you leave one.
          return (
            this.editor.commands.goToNextCell() ||
            this.editor.chain().addRowAfter().goToNextCell().run()
          );
        }
        // Outside both, Tab keeps its usual job of moving focus onward.
        return false;
      },
    };
  },
});
