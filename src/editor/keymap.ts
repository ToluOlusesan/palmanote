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

      Tab: () => {
        const { itemType, depth } = listContext(this.editor.state);
        // Outside a list, Tab keeps its usual job of moving focus onward.
        if (!itemType) return false;
        // At the limit, swallow the key rather than letting the list
        // extensions' own uncapped Tab handler sink another level.
        if (depth >= MAX_LIST_DEPTH) return true;
        return this.editor.commands.sinkListItem(itemType);
      },
    };
  },
});
