/**
 * Import is only worth having if it is the exact inverse of export, so this
 * sends documents out through the markdown writer and back in through the
 * reader and checks what survived.
 *
 *   node --test src/import/markdown.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { PMDoc } from '../core/types.ts';
import { markdownFromDoc } from '../export/markdown.ts';
import { parseMarkdown } from './markdown.ts';

const roundTrip = (doc: PMDoc): PMDoc => parseMarkdown(markdownFromDoc(doc)).doc;

const paragraph = (...content: unknown[]): PMDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: content as never }],
});

test('marks survive a trip out and back', () => {
  const doc = paragraph(
    { type: 'text', text: 'plain then ' },
    { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
    { type: 'text', text: ' and ' },
    { type: 'text', text: 'slanted', marks: [{ type: 'italic' }] },
    { type: 'text', text: ' and ' },
    { type: 'text', text: 'cut', marks: [{ type: 'strike' }] },
  );
  assert.deepEqual(roundTrip(doc), doc);
});

test('a highlight survives, though markdown cannot say which colour', () => {
  const doc = paragraph({
    type: 'text',
    text: 'look again',
    marks: [{ type: 'highlight', attrs: { tone: 'blue' } }],
  });
  const back = roundTrip(doc);
  const mark = (back.content?.[0]?.content?.[0]?.marks ?? [])[0];
  assert.equal(mark?.type, 'highlight');
  assert.equal(mark?.attrs?.tone, 'yellow', 'the colour is lost, and lands on the first');
});

test('headings, quotes and scene breaks come back as themselves', () => {
  const doc: PMDoc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Before the tide' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'The rain came sideways.' }] },
      { type: 'sceneBreak' },
      {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It rained for three days.' }] }],
      },
    ],
  };
  assert.deepEqual(roundTrip(doc), doc);
});

test('lists keep their kind, their order and their ticks', () => {
  const doc: PMDoc = {
    type: 'doc',
    content: [
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
        ],
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }],
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'not done' }] }],
          },
        ],
      },
    ],
  };
  assert.deepEqual(roundTrip(doc), doc);
});

test('front matter carries the title back, and a lone H1 stands in for it', () => {
  const withFront = parseMarkdown('---\ntitle: "Chapter Nine"\nkind: chapter\nicon: "📖"\n---\n\nWords.\n');
  assert.equal(withFront.front.title, 'Chapter Nine');
  assert.equal(withFront.front.kind, 'chapter');
  assert.equal(withFront.front.icon, '📖');

  const withHeading = parseMarkdown('# Chapter Ten\n\nMore words.\n');
  assert.equal(withHeading.impliedTitle, 'Chapter Ten');
  assert.equal(
    withHeading.doc.content?.length,
    1,
    'the title heading is the title, not the first line of the body',
  );
});

test('escaped punctuation is not doubled on the way back', () => {
  const doc = paragraph({ type: 'text', text: 'a *literal* asterisk and a # hash' });
  assert.deepEqual(roundTrip(doc), doc);
});

test('a code block survives, fence and all', () => {
  const doc: PMDoc = {
    type: 'doc',
    content: [
      {
        type: 'codeBlock',
        attrs: { language: 'sql' },
        content: [{ type: 'text', text: 'SELECT *\nFROM documents\nWHERE id = ?;' }],
      },
    ],
  };
  assert.deepEqual(roundTrip(doc), doc);
});

test('a code block containing a fence is written with a longer one', () => {
  const doc: PMDoc = {
    type: 'doc',
    content: [
      {
        type: 'codeBlock',
        attrs: { language: null },
        content: [{ type: 'text', text: 'here is a fence:\n```\nnot the end\n```' }],
      },
    ],
  };
  const written = markdownFromDoc(doc);
  assert.ok(written.startsWith('````'), 'the outer fence grows past the inner one');
  assert.deepEqual(roundTrip(doc), doc);
});

test('markdown inside a code block is not markdown', () => {
  const doc: PMDoc = {
    type: 'doc',
    content: [
      {
        type: 'codeBlock',
        attrs: { language: null },
        content: [{ type: 'text', text: '**not bold** and *not italic* and [not a link](x)' }],
      },
    ],
  };
  assert.deepEqual(roundTrip(doc), doc);
});

test('inline code survives and takes nothing else with it', () => {
  const doc = paragraph(
    { type: 'text', text: 'run ' },
    { type: 'text', text: 'npm run **build**', marks: [{ type: 'code' }] },
    { type: 'text', text: ' first' },
  );
  assert.deepEqual(roundTrip(doc), doc);
});

test('inline code containing a backtick is fenced with two', () => {
  const doc = paragraph({ type: 'text', text: 'a ` tick', marks: [{ type: 'code' }] });
  assert.deepEqual(roundTrip(doc), doc);
});

test('links survive, with their text and their address', () => {
  const doc = paragraph(
    { type: 'text', text: 'see ' },
    {
      type: 'text',
      text: 'the issue',
      marks: [{ type: 'link', attrs: { href: 'https://github.com/o/r/issues/4127' } }],
    },
    { type: 'text', text: ' for why' },
  );
  assert.deepEqual(roundTrip(doc), doc);
});

test('a link whose address holds brackets goes out in angle brackets', () => {
  const href = 'https://example.com/a(b)c';
  const doc = paragraph({ type: 'text', text: 'odd', marks: [{ type: 'link', attrs: { href } }] });
  assert.ok(markdownFromDoc(doc).includes(`(<${href}>)`), 'angle brackets rather than escaping');
  assert.deepEqual(roundTrip(doc), doc);
});

test('a formatted link keeps both the formatting and the address', () => {
  const doc = paragraph({
    type: 'text',
    text: 'bold and linked',
    marks: [{ type: 'link', attrs: { href: 'https://example.com/x' } }, { type: 'bold' }],
  });
  const back = roundTrip(doc);
  const marks = (back.content?.[0]?.content?.[0]?.marks ?? []).map((mark) => mark.type).sort();
  assert.deepEqual(marks, ['bold', 'link']);
});
