import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';

import { Gallery, groupableImages, imageIdsOf } from './Gallery.ts';
import { Image } from './Image.ts';

/**
 * The rule that decides whether "group these into a gallery" is offered.
 *
 * It is strict, and the strictness is the point: wrapping a range means
 * replacing it, so a paragraph caught between two pictures would be replaced
 * along with them. A gallery is one gesture to make again; a lost sentence is
 * not. These check that the refusals happen for that reason and not by
 * accident.
 */

// The real schema, minus the extensions that only add behaviour: what is
// being tested is a rule about node types, and a rule about node types tested
// against a made-up schema tests the made-up schema.
const schema = getSchema([StarterKit, Image, Gallery]);

function docWith(blocks: { type: string; attrs?: Record<string, unknown> }[]) {
  return schema.node(
    'doc',
    null,
    blocks.map((block) =>
      block.type === 'paragraph'
        ? schema.node('paragraph', null, [schema.text('some words')])
        : schema.node('image', { id: String(block.attrs?.id ?? 'a'), alt: '' }),
    ),
  );
}

/** A selection over every block in the document. */
function selectingEverything(doc: ReturnType<typeof docWith>) {
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 0, doc.content.size),
  });
}

test('two images side by side can be grouped', () => {
  const state = selectingEverything(
    docWith([{ type: 'image', attrs: { id: 'one' } }, { type: 'image', attrs: { id: 'two' } }]),
  );
  assert.equal(groupableImages(state), 2);
});

test('one image on its own is not a gallery', () => {
  const state = selectingEverything(docWith([{ type: 'image', attrs: { id: 'one' } }]));
  assert.equal(groupableImages(state), 0);
});

test('a paragraph among the pictures refuses the whole thing', () => {
  const state = selectingEverything(
    docWith([
      { type: 'image', attrs: { id: 'one' } },
      { type: 'paragraph' },
      { type: 'image', attrs: { id: 'two' } },
    ]),
  );
  assert.equal(groupableImages(state), 0);
});

test('a caret with nothing held groups nothing', () => {
  const doc = docWith([{ type: 'image', attrs: { id: 'one' } }, { type: 'image', attrs: { id: 'two' } }]);
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 0, 0) });
  assert.equal(groupableImages(state), 0);
});

test('a gallery reports its pictures in the order they are shown', () => {
  const gallery = schema.node('gallery', { columns: 3 }, [
    schema.node('image', { id: 'first', alt: '' }),
    schema.node('image', { id: 'second', alt: '' }),
  ]);
  assert.deepEqual(imageIdsOf(gallery), ['first', 'second']);
});
