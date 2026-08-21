import assert from 'node:assert/strict';
import test from 'node:test';

import type { PMDoc } from '../core/types.ts';
import { markdownFromDoc } from './markdown.ts';

/**
 * A gallery is a grid on the screen and a run of pictures everywhere else.
 *
 * Nothing in the markdown writer mentions galleries; it falls through to the
 * children of a block it does not recognise, which is the behaviour this pins
 * down. Worth a test precisely because it is behaviour nobody wrote: the day
 * that default branch changes, a gallery would export as a hole and no other
 * test would notice.
 */

const GALLERY: PMDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Before.' }] },
    {
      type: 'gallery',
      attrs: { columns: 3 },
      content: [
        { type: 'image', attrs: { id: 'a'.repeat(64), alt: 'first' } },
        { type: 'image', attrs: { id: 'b'.repeat(64), alt: 'second' } },
      ],
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'After.' }] },
  ],
};

test('a gallery exports as its pictures, in the order they are shown', () => {
  const out = markdownFromDoc(GALLERY);
  assert.equal(
    out,
    [
      'Before.',
      `![first](assets/${'a'.repeat(16)}.png)`,
      `![second](assets/${'b'.repeat(16)}.png)`,
      'After.',
    ].join('\n\n'),
  );
});

/**
 * `assets/` sits at the root of an export and pages sit at every depth under
 * it, so the link from a page has to climb before it descends. Every nested
 * page used to link `assets/x.png` as though it were a sibling of the folder,
 * which resolves to nothing from the second level down — an export that looked
 * right at the top and had holes in it everywhere else.
 */
test('a picture is linked relative to the page that points at it', () => {
  const doc: PMDoc = {
    type: 'doc',
    content: [{ type: 'image', attrs: { id: 'c'.repeat(64), alt: 'shot' } }],
  };
  const name = `assets/${'c'.repeat(16)}.png`;
  assert.equal(markdownFromDoc(doc), `![shot](${name})`, 'a page at the root links straight at it');
  assert.equal(markdownFromDoc(doc, '../../'), `![shot](../../${name})`, 'one two levels down climbs');
});

test('the climb reaches pictures inside quotes and lists too', () => {
  const doc: PMDoc = {
    type: 'doc',
    content: [
      {
        type: 'blockquote',
        content: [{ type: 'image', attrs: { id: 'd'.repeat(64), alt: '' } }],
      },
    ],
  };
  assert.ok(markdownFromDoc(doc, '../').includes(`> ![](../assets/${'d'.repeat(16)}.png)`));
});

test('an empty gallery leaves nothing behind', () => {
  const out = markdownFromDoc({
    type: 'doc',
    content: [
      { type: 'gallery', attrs: { columns: 3 }, content: [] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Only this.' }] },
    ],
  });
  assert.equal(out, 'Only this.');
});
