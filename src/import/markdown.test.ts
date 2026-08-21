/**
 * Import is only worth having if it is the exact inverse of export, so this
 * sends documents out through the markdown writer and back in through the
 * reader and checks what survived.
 *
 *   node --test src/import/markdown.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { PMDoc, PMNode } from '../core/types.ts';
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

// ------------------------------------------------- what the round trip lost
//
// Each of the next six was a document that came back from a file as something
// other than what went into it. They are grouped because they share a cause:
// the writer and the reader are two halves of one format and had drifted, each
// correct on its own and wrong about the other.

test('a literal ~~ or == in the prose does not come back as a mark', () => {
  const doc = paragraph({ type: 'text', text: 'about ~~50kg, and a == b' });
  assert.ok(markdownFromDoc(doc).includes('\\~~'), 'the pair is broken on the way out');
  assert.deepEqual(roundTrip(doc), doc);
});

test('a hard break comes back as a hard break and brings no spaces with it', () => {
  const doc = paragraph(
    { type: 'text', text: 'first line' },
    { type: 'hardBreak' },
    { type: 'text', text: 'second line' },
  );
  assert.deepEqual(roundTrip(doc), doc);
});

test('an underscore inside a word is an underscore, not emphasis', () => {
  const { doc } = parseMarkdown('run some_variable_name and _this_ is emphasis\n');
  assert.deepEqual(doc.content?.[0]?.content, [
    { type: 'text', text: 'run some_variable_name and ' },
    { type: 'text', text: 'this', marks: [{ type: 'italic' }] },
    { type: 'text', text: ' is emphasis' },
  ]);
});

test('a numbered list comes back at the number it started on', () => {
  const item = (text: string) => ({
    type: 'listItem',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
  const fifth: PMDoc = {
    type: 'doc',
    content: [{ type: 'orderedList', attrs: { start: 5 }, content: [item('fifth'), item('sixth')] }],
  };
  assert.deepEqual(roundTrip(fifth), fifth);

  // And one that starts at one carries no attribute at all, because the writer
  // omits it there — a reader that added one would stop round-tripping.
  const first: PMDoc = {
    type: 'doc',
    content: [{ type: 'orderedList', content: [item('one'), item('two')] }],
  };
  assert.deepEqual(roundTrip(first), first);
});

test('a sticker comes back as the sticker it was', () => {
  const doc = paragraph({ type: 'text', text: 'shipped ' }, { type: 'sticker', attrs: { id: 'party' } });
  assert.deepEqual(roundTrip(doc), doc);
});

test('a colon that is not a sticker is left where it is', () => {
  const { doc } = parseMarkdown('the 12:30:45 train and a :shrug: of a thing\n');
  assert.deepEqual(doc.content?.[0]?.content, [
    { type: 'text', text: 'the 12:30:45 train and a :shrug: of a thing' },
  ]);
});

// -------------------------------------------- markdown written somewhere else

test('a paragraph wrapped at eighty columns is one paragraph, not a column of lines', () => {
  const { doc } = parseMarkdown('The rain came sideways\nand did not stop\nfor three days.\n');
  assert.deepEqual(doc.content, [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'The rain came sideways and did not stop for three days.' }],
    },
  ]);
});

test('an underlined heading is a heading, not a paragraph and a scene break', () => {
  const { doc } = parseMarkdown('Intro.\n\nChapter One\n===\n\nWords.\n\nA section\n---\n\nMore.\n');
  assert.deepEqual(
    (doc.content ?? []).map((node) => `${node.type}${node.attrs?.level ?? ''}`),
    ['paragraph', 'heading1', 'paragraph', 'heading2', 'paragraph'],
  );
});

test('an underlined heading at the top is the title, exactly as a hash one is', () => {
  const parsed = parseMarkdown('Chapter Ten\n===========\n\nMore words.\n');
  assert.equal(parsed.impliedTitle, 'Chapter Ten');
  assert.equal(parsed.doc.content?.length, 1, 'the title is the title, not the first line of the body');
});

test('a rule with nothing above it is still a scene break', () => {
  const { doc } = parseMarkdown('Before.\n\n---\n\nAfter.\n');
  assert.equal(doc.content?.[1]?.type, 'sceneBreak');
});

test('headings past the third level arrive as the third', () => {
  const { doc } = parseMarkdown('#### Deep\n\n###### Deeper\n');
  assert.deepEqual(
    (doc.content ?? []).map((node) => node.attrs?.level),
    [3, 3],
  );
});

test('reference-style links find their address, and the definitions leave the prose', () => {
  const { doc } = parseMarkdown(
    'See [the issue][bug] and the [docs][].\n\n[bug]: https://example.com/4127\n[docs]: <https://example.com/docs>\n',
  );
  assert.equal(doc.content?.length, 1, 'the definitions are addresses, not a paragraph');
  const linked = (doc.content?.[0]?.content ?? []).filter((node) =>
    node.marks?.some((mark) => mark.type === 'link'),
  );
  assert.deepEqual(
    linked.map((node) => [node.text, node.marks?.find((m) => m.type === 'link')?.attrs?.href]),
    [
      ['the issue', 'https://example.com/4127'],
      ['docs', 'https://example.com/docs'],
    ],
  );
});

test('a line that looks like a link definition inside a code block is code', () => {
  const { doc } = parseMarkdown('```\n[bug]: https://example.com\n```\n');
  assert.equal(doc.content?.[0]?.type, 'codeBlock');
  assert.equal(doc.content?.[0]?.content?.[0]?.text, '[bug]: https://example.com');
});

test('an angle-bracketed URL is a link, and a bare one is deliberately left as text', () => {
  const { doc } = parseMarkdown('go to <https://example.com/a> or https://example.com/b\n');
  const linked = (doc.content?.[0]?.content ?? []).filter((node) =>
    node.marks?.some((mark) => mark.type === 'link'),
  );
  assert.deepEqual(
    linked.map((node) => node.text),
    ['https://example.com/a'],
    'linking a bare URL would relink one the writer had deliberately unlinked',
  );
});

test('a tab-indented sub-list nests as deep as it looks', () => {
  const { doc } = parseMarkdown('- one\n\t- two\n\t\t- three\n');
  const second = doc.content?.[0]?.content?.[0]?.content?.[1];
  assert.equal(second?.type, 'bulletList', 'one tab is one level, not one space');
  assert.equal(second?.content?.[0]?.content?.[1]?.type, 'bulletList');
});

// ------------------------------------------------------------------ pictures

test('a picture is a picture, and carries the path it was written with', () => {
  const { doc } = parseMarkdown('![a cat](assets/cat.png)\n');
  assert.deepEqual(doc.content, [
    { type: 'image', attrs: { src: 'assets/cat.png', alt: 'a cat' } },
  ]);
});

test('a picture in the middle of a sentence splits the paragraph around it', () => {
  const { doc } = parseMarkdown('before ![shot](a.png) after\n');
  assert.deepEqual(doc.content, [
    { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
    { type: 'image', attrs: { src: 'a.png', alt: 'shot' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
  ]);
});

test('a picture written inside a code span is punctuation, not a picture', () => {
  const { doc } = parseMarkdown('write `![alt](x.png)` for that\n');
  assert.deepEqual(
    (doc.content ?? []).map((node) => node.type),
    ['paragraph'],
  );
});

test('a picture in a heading becomes its alt text, because a heading holds no blocks', () => {
  const { doc } = parseMarkdown('## Look ![at this](x.png)\n');
  assert.deepEqual(doc.content?.[0]?.content, [
    { type: 'text', text: 'Look ' },
    { type: 'text', text: 'at this' },
  ]);
});

// -------------------------------------------------------------------- tables

const cell = (content: PMNode[], head = false): PMNode => ({
  type: head ? 'tableHeader' : 'tableCell',
  content: [content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }],
});

const words = (text: string, head = false): PMNode =>
  cell(text.length > 0 ? [{ type: 'text', text }] : [], head);

const table = (...rows: PMNode[][]): PMDoc => ({
  type: 'doc',
  content: [{ type: 'table', content: rows.map((content) => ({ type: 'tableRow', content })) }],
});

test('a table comes back as the table it was', () => {
  const doc = table(
    [words('Name', true), words('Role', true)],
    [words('Ada'), words('Engine')],
    [words('Grace'), words('Compiler')],
  );
  assert.equal(
    markdownFromDoc(doc),
    ['| Name | Role |', '| --- | --- |', '| Ada | Engine |', '| Grace | Compiler |'].join('\n'),
  );
  assert.deepEqual(roundTrip(doc), doc);
});

test('a table with no header row keeps every row it had', () => {
  // GFM has no table without a header, so the writer puts an empty one above
  // it rather than spending the first row on the format — and the reader takes
  // that same empty row back off.
  const doc = table([words('a'), words('b')], [words('c'), words('d')]);
  assert.deepEqual(roundTrip(doc), doc);
});

test('an empty cell stays empty rather than becoming a blank paragraph node', () => {
  const doc = table([words('a', true), words('', true)], [words(''), words('d')]);
  assert.deepEqual(roundTrip(doc), doc);
});

test('a cell may hold a pipe', () => {
  const doc = table([words('either | or', true)], [words('a || b')]);
  assert.ok(markdownFromDoc(doc).includes('either \\| or'), 'escaped on the way out');
  assert.deepEqual(roundTrip(doc), doc);
});

test('marks inside a cell survive the trip', () => {
  const doc = table(
    [cell([{ type: 'text', text: 'Heading', marks: [{ type: 'bold' }] }], true)],
    [
      cell([
        { type: 'text', text: 'see ' },
        { type: 'text', text: 'this', marks: [{ type: 'link', attrs: { href: 'https://x.test/a' } }] },
      ]),
    ],
  );
  assert.deepEqual(roundTrip(doc), doc);
});

test('a ragged row is squared off, because a ragged table will not load', () => {
  const ragged = table([words('a', true), words('b', true)], [words('c')]);
  assert.deepEqual(roundTrip(ragged), table([words('a', true), words('b', true)], [words('c'), words('')]));
});

test('a table is only a table when a delimiter row says so', () => {
  const { doc } = parseMarkdown('use a | b for that\n');
  assert.deepEqual(
    (doc.content ?? []).map((node) => node.type),
    ['paragraph'],
    'a pipe in a sentence is far commoner than a table',
  );
});

test('alignment colons are accepted and then let go', () => {
  const { doc } = parseMarkdown('| a | b | c |\n| :-- | :-: | --: |\n| d | e | f |\n');
  assert.equal(doc.content?.[0]?.type, 'table');
  assert.equal(doc.content?.[0]?.content?.length, 2);
  assert.deepEqual(
    doc.content?.[0]?.content?.[0]?.content?.map((node) => node.type),
    ['tableHeader', 'tableHeader', 'tableHeader'],
  );
});
