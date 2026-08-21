import { Mark, mergeAttributes } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';

/**
 * The words a comment is about.
 *
 * A mark rather than a stored position, and that is the whole design. A
 * position recorded when the comment was written is wrong the moment a
 * paragraph is inserted above it; a mark is carried by the text it is on, so it
 * survives editing, reordering, undo and a restore from history without
 * anything having to keep it in step.
 *
 * It holds nothing but an id. The comment itself — its text, its colour, when
 * it was written — is a row in `sticky_notes` beside the sticky notes, because
 * a comment and a sticky are the same object with one difference: whether it
 * points at words. See `StickyNote.anchor` in core/types.ts.
 *
 * That split is also what keeps the promise the stickies made. The comment's
 * *text* is not in the document, so it does not export, does not count towards
 * the page's words, and does not ride along in every revision snapshot. What is
 * in the document is a marked run of prose and a 36-character id.
 *
 * `inclusive: false` so typing at either end of a commented run does not
 * silently extend the comment over the new words — a comment is about the words
 * that were there when it was written.
 */
export const Comment = Mark.create({
  name: 'comment',
  inclusive: false,
  // Under the other marks, like a highlight: a commented run can still be bold.
  priority: 60,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment'),
        renderHTML: (attributes) =>
          attributes.id ? { 'data-comment': attributes.id as string } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'commented' }), 0];
  },
});

/** Every run wearing this comment's id, in document order. */
function rangesOf(editor: Editor, id: string): { from: number; to: number }[] {
  const type = editor.state.schema.marks.comment;
  if (!type) return [];
  const found: { from: number; to: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    if (node.marks.some((mark) => mark.type === type && mark.attrs.id === id)) {
      found.push({ from: pos, to: pos + node.nodeSize });
    }
  });
  return found;
}

/**
 * Takes the mark off the words, wherever they ended up.
 *
 * Ranges rather than a stored position, because by now the writer may have cut
 * the commented sentence in half, moved one part and bolded the other — which
 * is a run of two marked pieces, not one.
 */
export function clearComment(editor: Editor, id: string): void {
  const type = editor.state.schema.marks.comment;
  const ranges = rangesOf(editor, id);
  if (!type || ranges.length === 0) return;
  const tr = editor.state.tr;
  for (const range of ranges) tr.removeMark(range.from, range.to, type);
  editor.view.dispatch(tr);
}

/**
 * Goes to the words a comment is about, and holds them.
 *
 * False when there is nothing left to go to — the writer deleted the sentence
 * the comment was about, and the note is now an orphan. The rail says so rather
 * than the click doing nothing.
 */
export function selectComment(editor: Editor, id: string): boolean {
  const ranges = rangesOf(editor, id);
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (!first || !last) return false;
  const { state, dispatch } = editor.view;
  dispatch(
    state.tr
      .setSelection(TextSelection.create(state.doc, first.from, last.to))
      .scrollIntoView(),
  );
  editor.view.focus();
  return true;
}

/** Whether the words a comment was about are still in the page. */
export function commentIsAttached(editor: Editor, id: string): boolean {
  return rangesOf(editor, id).length > 0;
}
