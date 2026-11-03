/**
 * Reading a .docx, proved against the writer.
 *
 * The specification is the round trip, the same as for markdown: a page saved
 * over a Word file and opened again has to be the page that was saved, or
 * every save damages the document a little more. So most of these build a
 * document, write it with export/docx.ts, read it back with ./docx.ts and
 * require the same document.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { DocumentMeta, PMDoc, PMNode } from '../core/types.ts';
import { docxFromWalk, type ManuscriptDetails } from '../export/docx.ts';
import type { Walk } from '../export/walk.ts';
import { parseXml, readDocx } from './docx.ts';

const DETAILS: ManuscriptDetails = { surname: '', title: '', author: '', contact: '' };

function meta(title: string): DocumentMeta {
  return {
    id: title,
    parentId: null,
    position: 'a0',
    title,
    kind: 'note',
    favorite: false,
    icon: null,
    cover: null,
    coverOffset: 50,
    wordCount: 10,
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
  };
}

async function roundTrip(doc: PMDoc): Promise<PMDoc> {
  const walk: Walk = { title: 'Page', totalWords: 10, documents: [{ meta: meta('Page'), content: doc, depth: 0, path: [] }] };
  return (await readDocx(await docxFromWalk(walk, 'file', DETAILS))).doc;
}

/**
 * The shape that matters, without the defaults the two sides spell
 * differently — a null attribute and a missing one are the same document.
 */
function normal(node: PMNode): PMNode {
  const out: PMNode = { type: node.type };
  const attrs = Object.fromEntries(Object.entries(node.attrs ?? {}).filter(([, v]) => v !== null && v !== undefined));
  if (Object.keys(attrs).length > 0) out.attrs = attrs;
  if (node.text !== undefined) out.text = node.text;
  if (node.marks?.length) {
    out.marks = [...node.marks]
      .map((mark) => normal(mark as PMNode))
      .sort((a, b) => a.type.localeCompare(b.type)) as PMNode['marks'];
  }
  if (node.content) out.content = node.content.map(normal);
  return out;
}

const text = (value: string, ...marks: NonNullable<PMNode['marks']>): PMNode =>
  marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const p = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const item = (value: string, ...children: PMNode[]): PMNode => ({ type: 'listItem', content: [p(text(value)), ...children] });

test('marks, Word formatting and alignment come back as they went out', async () => {
  const doc: PMDoc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [text('A centred title')] },
      p(
        text('bold', { type: 'bold' }),
        text(' '),
        text('slant', { type: 'italic' }),
        text(' '),
        text('under', { type: 'underline' }),
        text(' '),
        text('cut', { type: 'strike' }),
        text(' '),
        text('red and big', { type: 'textStyle', attrs: { color: '#d1453b', fontSize: '18pt' } }),
        text(' '),
        text('marked', { type: 'highlight', attrs: { tone: 'green' } }),
        text(' '),
        text('linked', { type: 'link', attrs: { href: 'https://example.com/' } }),
        text(' '),
        text('code()', { type: 'code' }),
      ),
      { type: 'paragraph', attrs: { textAlign: 'right' }, content: [text('to the right')] },
      { type: 'paragraph', attrs: { textAlign: 'justify' }, content: [text('justified')] },
    ],
  };
  assert.deepEqual(normal(await roundTrip(doc)), normal(doc));
});

test('lists keep their kind and their nesting, tasks keep their ticks', async () => {
  const doc: PMDoc = {
    type: 'doc',
    content: [
      { type: 'bulletList', content: [item('one'), item('two', { type: 'bulletList', content: [item('kid')] }), item('three')] },
      { type: 'orderedList', content: [item('first'), item('second')] },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [p(text('done'))] },
          { type: 'taskItem', attrs: { checked: false }, content: [p(text('not yet'))] },
        ],
      },
    ],
  };
  const back = normal(await roundTrip(doc));
  // An ordered list's `start` is written as numbering, which Word owns.
  const ordered = back.content?.find((n) => n.type === 'orderedList');
  if (ordered) delete ordered.attrs;
  assert.deepEqual(back, normal(doc));
});

test('quotes, code, scene breaks and tables come back as themselves', async () => {
  const doc: PMDoc = {
    type: 'doc',
    content: [
      { type: 'blockquote', content: [p(text('quoted once')), p(text('and twice'))] },
      { type: 'codeBlock', content: [text('let a = 1;\nlet b = 2;')] },
      { type: 'sceneBreak' },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [p(text('Name'))] }, { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [p(text('Rate'))] }] },
          { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p(text('Ada'))] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p(text('12'))] }] },
        ],
      },
    ],
  };
  assert.deepEqual(normal(await roundTrip(doc)), normal(doc));
});

test('saving over a file adds nothing that opening it again would read', async () => {
  const doc: PMDoc = { type: 'doc', content: [p(text('only this'))] };
  const once = await roundTrip(doc);
  const twice = await roundTrip(once);
  // No title heading, no footer: the second trip is the first.
  assert.deepEqual(normal(twice), normal(doc));
});

test('the XML reader decodes entities and keeps self-closing tags empty', () => {
  const root = parseXml('<a x="1 &amp; 2"><b/><c>&lt;tag&gt; &#169;</c></a>');
  const a = root.children[0] as { attrs: Record<string, string>; children: unknown[] };
  assert.equal(a.attrs.x, '1 & 2');
  assert.equal(a.children.length, 2);
  assert.deepEqual((a.children[1] as { children: string[] }).children, ['<tag> ©']);
});
