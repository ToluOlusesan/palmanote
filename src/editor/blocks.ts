import type { Node as PMNode } from '@tiptap/pm/model';
import {
  NodeSelection,
  TextSelection,
  type Command,
  type EditorState,
  type Selection,
} from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';

/**
 * Blocks as things rather than as places.
 *
 * Everything else in the editor treats the document as a stream you type into:
 * the caret is somewhere, and what you do happens there. This file is the other
 * reading — that a page is a stack of objects, each of which can be picked up,
 * moved, copied and thrown away without the caret being involved at all.
 *
 * All of it is `Command`s over a plain `EditorState`, with no React and no DOM,
 * for two reasons. The gutter and the keymap are two doors onto the same six
 * verbs and should not each have their own version of "move this up". And a
 * rule about what happens to a document when you move its third bullet above
 * its second is a rule that can be tested, which the same rule expressed as a
 * drag handler cannot.
 *
 * What is not here: selecting several blocks at once. ProseMirror has no such
 * selection, and adding one means a custom `Selection` class that every command,
 * every serialiser and the clipboard would then have to understand. One block
 * at a time is the honest boundary of this pass.
 */

/**
 * The node types that are a block in their own right despite being nested.
 *
 * A list is one node holding six items, but nobody thinks of a bulleted list as
 * one thing — they think of six bullets, each of which is its own line to be
 * moved, retyped or thrown away. So an item is a block, and the list that holds
 * it is not.
 */
const ITEMS = new Set(['listItem', 'taskItem']);

/** Identifies a gutter drag that needs list-aware drop targeting. */
export const LIST_ITEM_DRAG_TYPE = 'application/x-palmanote-list-item';

export interface BlockInfo {
  /** The position immediately before the block. */
  pos: number;
  node: PMNode;
  /** Depth in the document; 1 is a direct child of the doc. */
  depth: number;
}

/**
 * Whether a block can be picked up and carried by pointer.
 *
 * The generic ProseMirror drop path cannot place a list item correctly, but
 * the gutter supplies a list-aware one — see `moveListItem`. It moves among
 * siblings in the same list rather than pretending a bullet can land anywhere
 * in a document.
 */
export function isCarryable(block: BlockInfo): boolean {
  return block.node.type.name !== 'table';
}

export function isListItem(block: BlockInfo): boolean {
  return ITEMS.has(block.node.type.name);
}

/** The far side of a block. */
export function endOf(block: BlockInfo): number {
  return block.pos + block.node.nodeSize;
}

/**
 * The block a position is in.
 *
 * Two rules, and the order of them is the whole function. The deepest list item
 * wins, so a bullet inside a bullet belongs to itself rather than to its
 * parent — otherwise dragging a sub-point would carry the point above it along.
 * Failing that, the outermost node under the doc wins, which is what puts the
 * handle beside a whole quote rather than beside each paragraph inside it.
 *
 * Depth 0 is the case worth naming: a position *between* top-level nodes rather
 * than inside one, which is where `posAtCoords` lands over a picture, a scene
 * break or a sticker, none of which have an inside to be in.
 */
export function blockAt(state: EditorState, pos: number): BlockInfo | null {
  const clamped = Math.max(0, Math.min(pos, state.doc.content.size));
  const $pos = state.doc.resolve(clamped);

  for (let depth = $pos.depth; depth >= 1; depth--) {
    if (ITEMS.has($pos.node(depth).type.name)) {
      return { pos: $pos.before(depth), node: $pos.node(depth), depth };
    }
  }

  if ($pos.depth >= 1) {
    return { pos: $pos.before(1), node: $pos.node(1), depth: 1 };
  }

  const after = $pos.nodeAfter;
  if (after) return { pos: clamped, node: after, depth: 1 };
  // The end of the document resolves to a depth-0 position with nothing after
  // it. The block meant is the last one.
  const before = $pos.nodeBefore;
  if (before) return { pos: clamped - before.nodeSize, node: before, depth: 1 };
  return null;
}

/**
 * The block that *starts* at a position, as opposed to the one containing it.
 *
 * These are two different questions and the difference is not academic. A
 * `BlockInfo.pos` is the position immediately before its block, which for a
 * bullet is a position inside the list — so asking `blockAt` what is there
 * answers "the list", and a handle that was beside one bullet comes back
 * holding all six of them. Anything that remembers a block across a repaint —
 * the gutter, which stores a position on hover and re-reads it on every scroll
 * and every keystroke — has to ask this one.
 */
export function blockFrom(state: EditorState, pos: number): BlockInfo | null {
  const clamped = Math.max(0, Math.min(pos, state.doc.content.size));
  const $pos = state.doc.resolve(clamped);
  const node = $pos.nodeAfter;
  if (node) return { pos: clamped, node, depth: $pos.depth + 1 };
  // Nothing starts here any more — the document moved under the position. The
  // containing block is the honest second answer.
  return blockAt(state, clamped);
}

/**
 * The block the caret or the current selection is in.
 *
 * A node selection is answered with the node it holds rather than by looking
 * the position up, and that is not a shortcut — it is the only correct answer.
 * A `listItem` selected as a node reports `from` as the position *before* it,
 * which resolves into the list rather than into the item, so asking `blockAt`
 * would hand back the whole list and every verb below would act on six bullets
 * instead of the one being held.
 */
export function currentBlock(state: EditorState): BlockInfo | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) {
    return {
      pos: selection.from,
      node: selection.node,
      depth: state.doc.resolve(selection.from).depth + 1,
    };
  }
  return blockAt(state, selection.from);
}

/**
 * Where a block sits among its siblings.
 *
 * Returned together because every caller needs both and resolving twice to get
 * them is how the two drift apart.
 */
function placeOf(state: EditorState, block: BlockInfo) {
  const $pos = state.doc.resolve(block.pos);
  return { $pos, index: $pos.index(), siblings: $pos.parent.childCount };
}

/**
 * A caret put back where it was, relative to a block that has moved.
 *
 * A selection is an offset into the block as much as it is a position in the
 * document, and it is the offset that should survive: move a paragraph you are
 * typing in and the caret should still be between the same two words. Node
 * selections stay node selections, because the block was picked up as an object
 * and should still be held as one when it lands.
 */
function followBlock(state: EditorState, doc: PMNode, from: number, landing: number): Selection {
  if (state.selection instanceof NodeSelection) {
    try {
      return NodeSelection.create(doc, landing);
    } catch {
      // The node stopped being selectable on the way — fall through to a caret,
      // which every position has.
    }
  }
  const offset = state.selection.from - from;
  return TextSelection.near(doc.resolve(Math.min(landing + offset, doc.content.size)));
}

/**
 * Move a block past the sibling above or below it.
 *
 * Only among its own siblings: a bullet moved down off the end of its list does
 * not climb out into the document, and a paragraph does not dive into the quote
 * beneath it. Both of those are plausible readings of "move down" and neither
 * is one a writer would expect from an arrow key — the block would vanish from
 * where they were looking and reappear somewhere with a different shape.
 */
export function moveBlock(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const block = currentBlock(state);
    if (!block) return false;
    const { $pos, index, siblings } = placeOf(state, block);
    const target = index + direction;
    if (target < 0 || target >= siblings) return false;
    if (!dispatch) return true;

    const from = block.pos;
    // The far side of the sibling being traded with, named before anything
    // moves: going up that is the position before it, going down it is the
    // position after it.
    const landing = direction < 0 ? $pos.posAtIndex(index - 1) : $pos.posAtIndex(index + 2);

    const tr = state.tr.delete(from, endOf(block));
    // Going up, the landing sits before the cut and is untouched by it. Going
    // down it sits after, and this is what takes the removed block's own size
    // back out of it.
    const at = tr.mapping.map(landing);
    tr.insert(at, block.node);
    tr.setSelection(followBlock(state, tr.doc, from, at));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Put one bullet immediately before or after another bullet in the same list.
 *
 * This is intentionally narrower than a general block drop. A list item's
 * parent has a `listItem+` content rule, so moving it across list boundaries
 * requires deciding whether to merge, split or convert lists. Reordering the
 * siblings the writer can see needs none of those guesses and is exact for
 * bullets, numbering and tasks alike.
 */
export function moveListItem(sourcePos: number, targetPos: number, after: boolean): Command {
  return (state, dispatch) => {
    const source = blockFrom(state, sourcePos);
    const target = blockFrom(state, targetPos);
    if (!source || !target || !isListItem(source) || !isListItem(target)) return false;
    if (source.pos === target.pos) return false;

    const sourceParent = state.doc.resolve(source.pos).parent;
    const targetParent = state.doc.resolve(target.pos).parent;
    if (sourceParent !== targetParent) return false;

    const from = source.pos;
    const to = endOf(source);
    let insertAt = after ? endOf(target) : target.pos;
    // Removing a sibling before the destination shifts its destination left.
    if (from < insertAt) insertAt -= source.node.nodeSize;
    // The item is already precisely where this drop asks it to be.
    if (insertAt === from) return false;
    if (!dispatch) return true;

    const tr = state.tr.delete(from, to).insert(insertAt, source.node);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(insertAt + 1, tr.doc.content.size))));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Put a second copy of a block directly under the first, and go to it.
 *
 * The caret moves into the copy rather than staying in the original, because
 * the reason to duplicate a block is almost always to change the copy. A
 * duplicate you then have to go and find is half a feature.
 */
export const duplicateBlock: Command = (state, dispatch) => {
  const block = currentBlock(state);
  if (!block) return false;
  if (!dispatch) return true;
  const at = endOf(block);
  const tr = state.tr.insert(at, block.node);
  tr.setSelection(followBlock(state, tr.doc, block.pos, at));
  dispatch(tr.scrollIntoView());
  return true;
};

/**
 * Take a block out.
 *
 * The guard at the end is not defensive coding: `doc` is `block+`, so removing
 * the last block of a one-block page would leave a document the schema says
 * cannot exist. An empty paragraph is what an empty page is made of anyway.
 */
export const deleteBlock: Command = (state, dispatch) => {
  const block = currentBlock(state);
  if (!block) return false;
  if (!dispatch) return true;
  const tr = state.tr.delete(block.pos, endOf(block));
  if (tr.doc.content.size === 0) {
    const paragraph = state.schema.nodes.paragraph?.createAndFill();
    if (paragraph) tr.insert(0, paragraph);
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(block.pos, tr.doc.content.size))));
  dispatch(tr.scrollIntoView());
  return true;
};

/**
 * A new empty block under this one, with the caret in it.
 *
 * `prompt` types a `/` into it. That is not decoration — it is exactly what the
 * insert menu reads, so the `+` opens the menu by the one route the menu has
 * ever had rather than by a second one that could disagree with it. Backspace
 * takes the `/` out and leaves an ordinary empty paragraph, which is the right
 * answer to pressing `+` and then changing your mind.
 *
 * A new sibling for a list item is another list item, not a paragraph: a
 * paragraph inside a `listItem+` list is not a document the schema allows, and
 * pressing `+` on a bullet means another bullet.
 */
export function insertBlockAfter(prompt: boolean, target?: BlockInfo): Command {
  return (state, dispatch) => {
    // The gutter names the block it is beside; the keyboard means the one the
    // caret is in. Passing it explicitly is what keeps the `+` from needing a
    // second transaction to move the caret before it can act.
    const block = target ?? currentBlock(state);
    if (!block) return false;
    const type = ITEMS.has(block.node.type.name)
      ? block.node.type
      : state.schema.nodes.paragraph;
    const fresh = type?.createAndFill();
    if (!fresh) return false;
    if (!dispatch) return true;
    const at = endOf(block);
    const tr = state.tr.insert(at, fresh);
    // `near` rather than the position itself: a list item's first text position
    // is two inside it, not one, and the difference is a schema detail this
    // does not need to know.
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at + 1, tr.doc.content.size))));
    if (prompt) tr.insertText('/');
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Hold the block itself, rather than a position in it.
 *
 * This is what the drag handle does on the way to dragging, and what makes the
 * whole block light up instead of a line of it. Not every node will accept it —
 * a `listItem` will, an atom will, and anything whose type says `selectable:
 * false` will not — so the failure is answered with a caret rather than
 * with nothing.
 */
export function selectBlock(block: BlockInfo): Command {
  return (state, dispatch) => {
    let selection: Selection;
    try {
      selection = NodeSelection.create(state.doc, block.pos);
    } catch {
      selection = TextSelection.near(state.doc.resolve(Math.min(block.pos + 1, state.doc.content.size)));
    }
    if (dispatch) dispatch(state.tr.setSelection(selection));
    return true;
  };
}

/** Put the caret inside a block without selecting it, for the commands that act at a caret. */
export function caretInto(block: BlockInfo): Command {
  return (state, dispatch) => {
    const at = Math.min(block.pos + 1, state.doc.content.size);
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(at))));
    return true;
  };
}

/**
 * Run one of the above against a live editor.
 *
 * The focus call is the point. Every one of these is reachable from a control
 * that is not the editor — a button in the gutter, an item in a menu — and a
 * document that acts on a caret it no longer has is a document that acts in the
 * wrong place.
 */
export function runBlockCommand(editor: Editor, command: Command): boolean {
  editor.view.focus();
  return command(editor.state, editor.view.dispatch, editor.view);
}
