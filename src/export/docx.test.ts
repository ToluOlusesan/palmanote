/**
 * The docx export, checked at the XML level.
 *   node --test src/export/docx.test.ts
 *
 * A .docx that looks right and behaves like a brick is the failure mode here,
 * so these assertions are about *structure*: named styles rather than baked
 * formatting, real numbering definitions rather than typed bullet characters,
 * and the strikethrough run property that silently goes missing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { docFromPlainText } from '../core/pmText.ts';
import type { DocumentMeta, PMDoc } from '../core/types.ts';
import { docxFromWalk, type ManuscriptDetails } from './docx.ts';
import type { Walk, WalkedDocument } from './walk.ts';

/** Minimal reader for the one zip format we produce. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Locate the end-of-central-directory record by scanning back for its magic.
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  assert.ok(eocd >= 0, 'not a zip file');

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = new Map<string, string>();

  for (let index = 0; index < count; index++) {
    assert.equal(view.getUint32(offset, true), 0x02014b50, 'bad central directory header');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressedSize);
    const data = method === 0 ? raw : new Uint8Array(inflateRawSync(raw));
    files.set(name, new TextDecoder().decode(data));

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function meta(overrides: Partial<DocumentMeta>): DocumentMeta {
  return {
    id: overrides.id ?? 'id',
    parentId: null,
    position: 'a0',
    title: '',
    kind: 'chapter',
    favorite: false,
    icon: null,
    cover: null,
    coverOffset: 50,
    wordCount: 100,
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
    ...overrides,
  };
}

function entry(title: string, content: PMDoc, depth = 0): WalkedDocument {
  return { meta: meta({ id: title, title }), content, depth, path: [] };
}

const DETAILS: ManuscriptDetails = {
  surname: 'Okonkwo',
  title: 'The Estuary',
  author: 'Ada Okonkwo',
  contact: 'ada@example.com',
};

const RICH: PMDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'plain then ' },
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' then ' },
        { type: 'text', text: 'cut', marks: [{ type: 'strike' }] },
        { type: 'text', text: ' and 🙂 too.' },
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A sub-section' }] },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
      ],
    },
    {
      type: 'orderedList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
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
      ],
    },
    { type: 'sceneBreak' },
    { type: 'paragraph', content: [{ type: 'text', text: 'After the break.' }] },
  ],
};

const WALK: Walk = {
  title: 'The Estuary',
  totalWords: 240,
  documents: [entry('Chapter One', RICH), entry('Chapter Two', docFromPlainText('Second chapter.'))],
};

test('manuscript format is structured, not hand-formatted', async () => {
  const files = unzip(await docxFromWalk(WALK, 'manuscript', DETAILS));
  const document = files.get('word/document.xml')!;
  assert.ok(document, 'document.xml is present');

  // Named styles are what give Word's navigation pane its outline.
  assert.match(document, /w:pStyle w:val="Heading1"/);
  assert.match(document, /w:pStyle w:val="Heading2"/);
  assert.ok(!/w:sz w:val="48"/.test(document), 'heading size must come from the style, not the run');

  // Chapters begin on their own page.
  assert.match(document, /<w:pageBreakBefore\/>/);

  // The mark that silently disappears.
  assert.match(document, /<w:strike\/>/);
  assert.match(document, /<w:b\/>/);
  // Unset marks must stay unset rather than being switched explicitly off,
  // which would override the paragraph style.
  assert.ok(!/w:val="false"/.test(document), 'no run property is explicitly disabled');

  // Lists are lists, not paragraphs with bullet characters typed into them.
  assert.match(document, /w:pStyle w:val="ListParagraph"/);
  assert.match(document, /<w:numPr>/);
  assert.ok(!/>•</.test(document), 'no literal bullet characters in the body');

  // Emoji get a font that can draw them instead of a box.
  assert.match(document, /w:ascii="Segoe UI Emoji"/);

  // Scene breaks are a centred hash.
  assert.match(document, /<w:t[^>]*>#<\/w:t>/);
});

test('numbering definitions exist and are referenced', async () => {
  const files = unzip(await docxFromWalk(WALK, 'manuscript', DETAILS));
  const numbering = files.get('word/numbering.xml');
  assert.ok(numbering, 'numbering.xml is present — without it Word shows no list');
  assert.match(numbering, /w:numFmt w:val="bullet"/);
  assert.match(numbering, /w:numFmt w:val="decimal"/);

  const relationships = files.get('word/_rels/document.xml.rels')!;
  assert.match(relationships, /numbering\.xml/);
});

test('the running header carries surname, title and page number', async () => {
  const files = unzip(await docxFromWalk(WALK, 'manuscript', DETAILS));
  const header = [...files.entries()].find(([name]) => name.startsWith('word/header'))?.[1];
  assert.ok(header, 'manuscript format needs a header');
  assert.match(header, /Okonkwo \/ THE ESTUARY \//);
  assert.match(header, /PAGE/);
});

test('the title page comes from the metadata', async () => {
  const files = unzip(await docxFromWalk(WALK, 'manuscript', DETAILS));
  const document = files.get('word/document.xml')!;
  assert.match(document, /THE ESTUARY/);
  assert.match(document, /by Ada Okonkwo/);
  assert.match(document, /ada@example\.com/);
  assert.match(document, /about 200 words/);
});

test('reading copy shares the structure and drops the manuscript furniture', async () => {
  const files = unzip(await docxFromWalk(WALK, 'reading', DETAILS));
  const document = files.get('word/document.xml')!;
  assert.match(document, /w:pStyle w:val="Heading1"/);
  assert.match(document, /w:pStyle w:val="ListParagraph"/);
  assert.ok(!/<w:pageBreakBefore\/>/.test(document), 'reading copies do not force page breaks');
  assert.ok(!/by Ada Okonkwo/.test(document), 'reading copies have no title page');
  assert.ok(
    ![...files.keys()].some((name) => name.startsWith('word/header')),
    'reading copies have no running header',
  );
});

test('styles are declared once, in the styles part', async () => {
  const files = unzip(await docxFromWalk(WALK, 'manuscript', DETAILS));
  const styles = files.get('word/styles.xml')!;
  assert.match(styles, /w:styleId="ListParagraph"/);
  assert.match(styles, /w:styleId="Normal"/);
  assert.match(styles, /Times New Roman/);
  // Double spacing: 480 twentieths of a point per line.
  assert.match(styles, /w:line="480"/);
});

const CODE_AND_LINKS: PMDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'run ' },
        { type: 'text', text: 'npm run build', marks: [{ type: 'code' }] },
        { type: 'text', text: ' and see ' },
        {
          type: 'text',
          text: 'the issue',
          marks: [{ type: 'link', attrs: { href: 'https://example.com/issues/7' } }],
        },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'sh' },
      content: [{ type: 'text', text: 'cargo test\ncargo build --release' }],
    },
  ],
};

const CODE_WALK: Walk = {
  title: 'Notes',
  totalWords: 12,
  documents: [entry('Notes', CODE_AND_LINKS)],
};

test('a code block is one styled paragraph per line, not one with breaks', async () => {
  const files = unzip(await docxFromWalk(CODE_WALK, 'reading', DETAILS));
  const document = files.get('word/document.xml')!;

  // The named style rather than a hand-set monospace run, so an editor can
  // restyle every block in the file at once.
  assert.match(document, /w:pStyle w:val="HTMLPreformatted"/);
  const paragraphs = document.match(/w:pStyle w:val="HTMLPreformatted"/g) ?? [];
  assert.equal(paragraphs.length, 2, 'one paragraph per line of code');
  assert.match(document, /cargo build --release/);

  // Declared, so the file carries its own definition rather than depending on
  // whatever Normal happens to be in the reader's template.
  const styles = files.get('word/styles.xml')!;
  assert.match(styles, /w:styleId="HTMLPreformatted"/);
  assert.match(styles, /w:styleId="HTMLCode"/);
});

test('inline code is a character style, not just a font', async () => {
  const files = unzip(await docxFromWalk(CODE_WALK, 'reading', DETAILS));
  assert.match(files.get('word/document.xml')!, /w:rStyle w:val="HTMLCode"/);
});

test('a link is a real Word hyperlink with a relationship behind it', async () => {
  const files = unzip(await docxFromWalk(CODE_WALK, 'reading', DETAILS));
  const document = files.get('word/document.xml')!;

  // Not blue underlined text: an actual <w:hyperlink> pointing at a
  // relationship id, which is what makes it clickable in Word and what
  // survives the trip through Google Docs.
  assert.match(document, /<w:hyperlink[^>]+r:id="/);
  assert.match(document, /w:rStyle w:val="Hyperlink"/);

  const rels = files.get('word/_rels/document.xml.rels')!;
  assert.ok(rels, 'the document has a relationships part');
  assert.match(rels, /https:\/\/example\.com\/issues\/7/);
  assert.match(rels, /TargetMode="External"/);
});
