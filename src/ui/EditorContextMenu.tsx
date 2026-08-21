import { TextSelection, type Selection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';

import { deleteBlock, duplicateBlock, runBlockCommand } from '../editor/blocks.ts';
import { RowMenu, type MenuItem } from './RowMenu.tsx';

/**
 * What a right-click on the writing gets.
 *
 * Every browser and every webview already draws a menu here, and each one is
 * different, none of them knows this app, and on Windows the one WebView2 draws
 * offers to reload the page — which in an app that *is* the page is an offer to
 * close the library. So this replaces it, and having replaced it, it owes the
 * writer the three verbs the system menu had.
 *
 * **Paste goes through the same door Ctrl+V does.** It reads the clipboard and
 * then dispatches a real paste event at the editor, rather than inserting the
 * content itself, because the insert path and the paste path are not the same
 * path: paste runs `handlePaste` (which turns image data into stored assets and
 * a `springboard://page/…` into a live page link) and then
 * `transformPastedHTML`, which is the strip that keeps a web page's `style` and
 * `class` attributes out of the document and unwraps tables drawn round a
 * layout. A menu item that inserted the HTML directly would be a second, dirtier
 * way in, and it would be the one nobody tested.
 *
 * Where the browser will not hand over the clipboard — Firefox without a
 * gesture it likes, a denied permission — the item is greyed and its shortcut
 * is right there next to it, which is the honest version of a menu item that
 * cannot work.
 */

/** True where the async clipboard exists at all. Permission is asked later. */
const CAN_READ_CLIPBOARD =
  typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function';

async function pasteFromClipboard(editor: Editor): Promise<void> {
  try {
    const items = await navigator.clipboard.read();
    const data = new DataTransfer();

    for (const item of items) {
      for (const type of item.types) {
        const blob = await item.getType(type);
        // An image is put on as a file, which is the shape `handlePaste` reads
        // when it decides whether something becomes an asset.
        if (type.startsWith('image/')) {
          data.items.add(new File([blob], `pasted.${type.split('/')[1] ?? 'png'}`, { type }));
        } else {
          data.setData(type, await blob.text());
        }
      }
    }

    editor.view.dom.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
    editor.commands.focus();
  } catch {
    // The browser declined, and it will have said so in its own words.
    // Ctrl+V is still there, and the menu said as much.
  }
}

export function EditorContextMenu({
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
  const hasSelection = !editor.state.selection.empty;

  // Through `document.execCommand` rather than the clipboard API: it is the
  // one route that fires the editor's own copy and cut handlers, so a run of
  // marked-up prose lands on the clipboard as the same HTML Ctrl+C puts there.
  const clip = (command: 'copy' | 'cut') => {
    editor.commands.focus();
    document.execCommand(command);
  };

  const items: MenuItem[] = [
    { label: 'Cut', hint: 'Ctrl+X', disabled: !hasSelection, onSelect: () => clip('cut') },
    { label: 'Copy', hint: 'Ctrl+C', disabled: !hasSelection, onSelect: () => clip('copy') },
    {
      label: 'Paste',
      hint: 'Ctrl+V',
      disabled: !CAN_READ_CLIPBOARD,
      onSelect: () => void pasteFromClipboard(editor),
    },
    {
      label: 'Duplicate block',
      hint: 'Alt+Shift+D',
      onSelect: () => runBlockCommand(editor, duplicateBlock),
    },
    {
      label: 'Delete block',
      destructive: true,
      onSelect: () => runBlockCommand(editor, deleteBlock),
    },
  ];

  return <RowMenu x={x} y={y} items={items} onClose={onClose} />;
}

export interface HeldSelection {
  from: number;
  to: number;
}

/**
 * What was selected a moment before the menu was asked for.
 *
 * Read on mousedown, in the capture phase, because by the time `contextmenu`
 * arrives it is too late: ProseMirror has already handled the right button's
 * mousedown and put the caret where the pointer is, which collapses the very
 * selection the writer right-clicked in order to copy. The menu would come up
 * with Cut and Copy greyed at exactly the moment they were wanted.
 */
export function selectionBefore(editor: Editor): HeldSelection | null {
  const { from, to, empty } = editor.state.selection;
  return empty ? null : { from, to };
}

/**
 * Where the caret goes when the menu opens.
 *
 * Right-clicking inside a selection keeps it — that is how every text editor
 * behaves, and taking it away would make Copy mean something nobody asked for.
 * Anywhere else the caret moves to the click, so the block verbs act on the
 * block that was pointed at rather than on wherever the caret was left.
 */
export function placeCaretForMenu(
  editor: Editor,
  clientX: number,
  clientY: number,
  held: HeldSelection | null,
): void {
  const view = editor.view;
  const at = view.posAtCoords({ left: clientX, top: clientY });

  /**
   * Dispatched straight at the view rather than through `editor.chain()`.
   *
   * Tiptap's `focus()` command is deferred — it lands in a later frame and
   * re-derives the selection from the DOM when it does, which is after this
   * has finished putting a selection into the state. The menu would then be
   * built from a selection that was about to be thrown away, and Cut and Copy
   * came up greyed roughly one time in three. A dispatch is synchronous and
   * there is nothing left in flight behind it.
   */
  const select = (selection: Selection) => {
    view.dispatch(view.state.tr.setSelection(selection));
    view.focus();
  };

  try {
    // Put back what the mousedown took, rather than merely leaving it alone.
    // Also the answer when the point resolves to nothing — between two lines,
    // in the padding beside a block — because a right-click landing a pixel
    // wide of the text is not a request to drop the selection.
    if (held && (!at || (at.pos >= held.from && at.pos <= held.to))) {
      select(TextSelection.create(view.state.doc, held.from, held.to));
      return;
    }
    if (!at) return;
    select(TextSelection.near(view.state.doc.resolve(at.pos)));
  } catch {
    // Some positions — inside an image, a sticker, a scene break — hold no
    // text selection. Leaving the caret where it was is better than throwing.
  }
}
