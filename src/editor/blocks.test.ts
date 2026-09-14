import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getSchema } from '@tiptap/core';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection, type Command } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';

import {
  blockAt,
  blockFrom,
  currentBlock,
  deleteBlock,
  duplicateBlock,
  insertBlockAfter,
  moveListItem,
  moveBlock,
} from './blocks.ts';

/**
 * What counts as a block, and what happens to a document when one is moved.
 *
 * These are the rules the gutter and the keymap both act on, and they are the
 * half of the feature that can be wrong without looking wrong: a drag that
 * lands a bullet one position further than it should still animates perfectly.
 *
 * The real schema rather than a made-up one, for the reason Gallery.test.ts
 * gives — most of these assertions are about what the schema permits, and a
 * schema invented for the test would permit whatever the test needed.
 */
const schema = getSchema([StarterKit, TaskList, TaskItem]);

const p = (text: string) => schema.node('paragraph', null, text ? [schema.text(text)] : []);
const doc = (...blocks: PMNode[]) => schema.node('doc', null, blocks);
const item = (text: string) => schema.node('listItem', null, [p(text)]);
const bullets = (...texts: string[]) => schema.node('bulletList', null, texts.map(item));

/** The first text position inside the block whose text is exactly this. */
function caretIn(document: PMNode, text: string): number {
  let found = -1;
  document.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isTextblock && node.textContent === text) {
      found = pos + 1;
      return false;
    }
    return true;
  });
  if (found < 0) throw new Error(`no block reading “${text}”`);
  return found;
}

function stateWith(document: PMNode, text: string): EditorState {
  return EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.near(document.resolve(caretIn(document, text))),
  });
}

/** Runs a command and returns the state it produced, or null if it declined. */
function apply(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null;
  const ran = command(state, (tr) => {
    next = state.apply(tr);
  });
  return ran ? next : null;
}

/** Every top-level block as its type name, or its text where it has some. */
function shapeOf(state: EditorState): string[] {
  const out: string[] = [];
  state.doc.forEach((node) => {
    out.push(node.isTextblock ? node.textContent : node.type.name);
  });
  return out;
}

/** The text of every list item, in order. */
function itemsOf(state: EditorState): string[] {
  const out: string[] = [];
  state.doc.descendants((node) => {
    if (node.type.name === 'listItem') out.push(node.textContent);
    return true;
  });
  return out;
}

function itemPosition(document: PMNode, text: string): number {
  let found = -1;
  document.descendants((node, pos) => {
    if (node.type.name === 'listItem' && node.textContent === text) {
      found = pos;
      return false;
    }
    return true;
  });
  if (found < 0) throw new Error(`no list item reading “${text}”`);
  return found;
}

// ------------------------------------------------------------------ what a block is

test('a top-level paragraph is its own block', () => {
  const state = stateWith(doc(p('one'), p('two')), 'two');
  const block = blockAt(state, state.selection.from);
  assert.equal(block?.node.type.name, 'paragraph');
  assert.equal(block?.node.textContent, 'two');
});

test('the block of a paragraph inside a quote is the quote', () => {
  const quote = schema.node('blockquote', null, [p('held')]);
  const state = stateWith(doc(p('before'), quote), 'held');
  assert.equal(blockAt(state, state.selection.from)?.node.type.name, 'blockquote');
});

test('but the block of a bullet is the item, not the list', () => {
  const state = stateWith(doc(bullets('first', 'second')), 'second');
  const block = blockAt(state, state.selection.from);
  assert.equal(block?.node.type.name, 'listItem');
  assert.equal(block?.node.textContent, 'second');
});

test('a bullet inside a bullet belongs to itself', () => {
  const nested = schema.node('listItem', null, [p('outer'), bullets('inner')]);
  const state = stateWith(doc(schema.node('bulletList', null, [nested])), 'inner');
  const block = blockAt(state, state.selection.from);
  assert.equal(block?.node.type.name, 'listItem');
  assert.equal(block?.node.textContent, 'inner');
});

test('a position between two blocks still names one', () => {
  const document = doc(p('one'), p('two'));
  const state = EditorState.create({ schema, doc: document });
  // 0 is before the first paragraph — a depth-0 position, which is where a
  // pointer over an atom lands.
  assert.equal(blockAt(state, 0)?.node.textContent, 'one');
});

test('a position past the end names the last block rather than nothing', () => {
  const document = doc(p('one'), p('last'));
  const state = EditorState.create({ schema, doc: document });
  assert.equal(blockAt(state, document.content.size)?.node.textContent, 'last');
});

// ------------------------------------------------------- remembering a block

/*
  The round trip the gutter makes on every scroll and every keystroke: it stores
  a block's position on hover and reads it back to re-measure.

  Reading it back with `blockAt` is wrong in a way that looks right almost
  everywhere. A block's own position is the position *before* it, which for a
  bullet is a position inside the list — so the question "what block is here"
  answers "the list", and the handle beside one bullet quietly comes to hold all
  of them. Paragraphs never show it, because the position before a top-level
  paragraph is in the doc and the answer is the paragraph either way.
*/
test('a remembered bullet is still that bullet and not its list', () => {
  const state = stateWith(doc(bullets('a', 'b', 'c')), 'b');
  const hovered = blockAt(state, state.selection.from)!;
  const again = blockFrom(state, hovered.pos);
  assert.equal(again?.node.type.name, 'listItem');
  assert.equal(again?.node.textContent, 'b');
});

test('and a remembered paragraph survives the same trip', () => {
  const state = stateWith(doc(p('one'), p('two')), 'two');
  const hovered = blockAt(state, state.selection.from)!;
  assert.equal(blockFrom(state, hovered.pos)?.node.textContent, 'two');
});

test('a remembered quote comes back as the quote, not its first paragraph', () => {
  const quote = schema.node('blockquote', null, [p('held')]);
  const state = stateWith(doc(p('before'), quote), 'held');
  const hovered = blockAt(state, state.selection.from)!;
  assert.equal(blockFrom(state, hovered.pos)?.node.type.name, 'blockquote');
});

test('a remembered position with nothing at it falls back to what contains it', () => {
  const document = doc(p('one'));
  const state = EditorState.create({ schema, doc: document });
  // Past the end of everything: the document moved under the position.
  assert.equal(blockFrom(state, document.content.size)?.node.textContent, 'one');
});

test('a block held as an object reports itself, not the list it sits in', () => {
  // The trap this exists for: a `listItem` selected as a node reports `from` as
  // the position before it, which resolves into the list. Looking it up rather
  // than reading it back would name the whole list, and every verb would then
  // act on three bullets instead of the one being held.
  const document = doc(bullets('a', 'b', 'c'));
  const state = EditorState.create({
    schema,
    doc: document,
    selection: NodeSelection.create(document, caretIn(document, 'b') - 2),
  });
  const block = currentBlock(state);
  assert.equal(block?.node.type.name, 'listItem');
  assert.equal(block?.node.textContent, 'b');
});

test('and moving it then moves that one bullet', () => {
  const document = doc(bullets('a', 'b', 'c'));
  const state = EditorState.create({
    schema,
    doc: document,
    selection: NodeSelection.create(document, caretIn(document, 'c') - 2),
  });
  assert.deepEqual(itemsOf(apply(state, moveBlock(-1))!), ['a', 'c', 'b']);
});

// ------------------------------------------------------------------------- moving

test('a block trades places with the one above it', () => {
  const state = stateWith(doc(p('one'), p('two'), p('three')), 'two');
  const moved = apply(state, moveBlock(-1));
  assert.deepEqual(shapeOf(moved!), ['two', 'one', 'three']);
});

test('and with the one below it', () => {
  const state = stateWith(doc(p('one'), p('two'), p('three')), 'two');
  const moved = apply(state, moveBlock(1));
  assert.deepEqual(shapeOf(moved!), ['one', 'three', 'two']);
});

test('the caret goes with the block rather than staying where it was', () => {
  const state = stateWith(doc(p('one'), p('two')), 'two');
  const moved = apply(state, moveBlock(-1))!;
  const landed = blockAt(moved, moved.selection.from);
  assert.equal(landed?.node.textContent, 'two');
});

test('the top block declines to move up', () => {
  const state = stateWith(doc(p('one'), p('two')), 'one');
  assert.equal(apply(state, moveBlock(-1)), null);
});

test('and the bottom one declines to move down', () => {
  const state = stateWith(doc(p('one'), p('two')), 'two');
  assert.equal(apply(state, moveBlock(1)), null);
});

test('a bullet moves among its own bullets', () => {
  const state = stateWith(doc(bullets('a', 'b', 'c')), 'c');
  const moved = apply(state, moveBlock(-1))!;
  assert.deepEqual(itemsOf(moved), ['a', 'c', 'b']);
  // Still one list, rather than two with a stray item between them.
  assert.deepEqual(shapeOf(moved), ['bulletList']);
});

test('the last bullet does not climb out of its list', () => {
  const state = stateWith(doc(bullets('a', 'b'), p('after')), 'b');
  assert.equal(apply(state, moveBlock(1)), null);
});

test('a list item can be dropped before a visible sibling', () => {
  const document = doc(bullets('a', 'b', 'c'));
  const state = stateWith(document, 'a');
  const moved = apply(state, moveListItem(itemPosition(document, 'c'), itemPosition(document, 'a'), false));
  assert.deepEqual(itemsOf(moved!), ['c', 'a', 'b']);
});

test('a list item can be dropped after a visible sibling', () => {
  const document = doc(bullets('a', 'b', 'c'));
  const state = stateWith(document, 'a');
  const moved = apply(state, moveListItem(itemPosition(document, 'a'), itemPosition(document, 'c'), true));
  assert.deepEqual(itemsOf(moved!), ['b', 'c', 'a']);
});

test('a list drop refuses to cross into another list', () => {
  const first = bullets('a', 'b');
  const second = bullets('c', 'd');
  const document = doc(first, second);
  const state = stateWith(document, 'a');
  assert.equal(apply(state, moveListItem(itemPosition(document, 'a'), itemPosition(document, 'c'), false)), null);
});

test('a quote moves as one thing, paragraphs and all', () => {
  const quote = schema.node('blockquote', null, [p('held one'), p('held two')]);
  const state = stateWith(doc(p('first'), quote), 'held one');
  const moved = apply(state, moveBlock(-1))!;
  assert.deepEqual(shapeOf(moved), ['blockquote', 'first']);
  assert.equal(moved.doc.child(0).childCount, 2);
});

// ---------------------------------------------------------------------- duplicating

test('a duplicate lands directly under the original', () => {
  const state = stateWith(doc(p('one'), p('two')), 'one');
  const copied = apply(state, duplicateBlock)!;
  assert.deepEqual(shapeOf(copied), ['one', 'one', 'two']);
});

test('and the caret is in the copy, not the original', () => {
  const state = stateWith(doc(p('one'), p('two')), 'one');
  const copied = apply(state, duplicateBlock)!;
  // Two blocks read "one"; the caret should be in the second of them.
  assert.equal(blockAt(copied, copied.selection.from)?.pos, copied.doc.child(0).nodeSize);
});

test('duplicating a bullet makes another bullet in the same list', () => {
  const state = stateWith(doc(bullets('a', 'b')), 'a');
  const copied = apply(state, duplicateBlock)!;
  assert.deepEqual(itemsOf(copied), ['a', 'a', 'b']);
  assert.deepEqual(shapeOf(copied), ['bulletList']);
});

// ------------------------------------------------------------------------ deleting

test('deleting a block takes the whole block', () => {
  const state = stateWith(doc(p('one'), p('two'), p('three')), 'two');
  const cut = apply(state, deleteBlock)!;
  assert.deepEqual(shapeOf(cut), ['one', 'three']);
});

test('deleting the only block leaves an empty paragraph rather than an empty doc', () => {
  const state = stateWith(doc(p('alone')), 'alone');
  const cut = apply(state, deleteBlock)!;
  assert.deepEqual(shapeOf(cut), ['']);
  // The schema says a doc is `block+`; an empty one is not a document.
  assert.doesNotThrow(() => cut.doc.check());
});

test('deleting a quote takes everything inside it', () => {
  const quote = schema.node('blockquote', null, [p('held one'), p('held two')]);
  const state = stateWith(doc(p('keep'), quote), 'held one');
  const cut = apply(state, deleteBlock)!;
  assert.deepEqual(shapeOf(cut), ['keep']);
});

// ----------------------------------------------------------------------- inserting

test('the new block lands under the one it came from', () => {
  const state = stateWith(doc(p('one'), p('two')), 'one');
  const added = apply(state, insertBlockAfter(false))!;
  assert.deepEqual(shapeOf(added), ['one', '', 'two']);
});

test('with the caret in it', () => {
  const state = stateWith(doc(p('one')), 'one');
  const added = apply(state, insertBlockAfter(false))!;
  assert.equal(blockAt(added, added.selection.from)?.node.textContent, '');
});

test('a prompted one has the "/" the insert menu reads', () => {
  const state = stateWith(doc(p('one')), 'one');
  const added = apply(state, insertBlockAfter(true))!;
  assert.deepEqual(shapeOf(added), ['one', '/']);
});

test('the new sibling of a bullet is a bullet, not a paragraph', () => {
  const state = stateWith(doc(bullets('a', 'b')), 'a');
  const added = apply(state, insertBlockAfter(false))!;
  assert.deepEqual(itemsOf(added), ['a', '', 'b']);
  // A paragraph among `listItem+` would be a document the schema forbids.
  assert.doesNotThrow(() => added.doc.check());
});

test('inserting after a quote puts the paragraph outside it', () => {
  const quote = schema.node('blockquote', null, [p('held')]);
  const state = stateWith(doc(quote), 'held');
  const added = apply(state, insertBlockAfter(false))!;
  assert.deepEqual(shapeOf(added), ['blockquote', '']);
});
