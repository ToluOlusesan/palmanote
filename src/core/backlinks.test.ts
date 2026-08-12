import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONTEXT_LIMIT, referencesTo, tidyContext } from './backlinks.ts';
import type { PMDoc, PMNode } from './types.ts';

const TARGET = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function link(id: string, label = 'Harbour notes'): PMNode {
  return { type: 'pageLink', attrs: { id, label } };
}

function para(...content: PMNode[]): PMNode {
  return { type: 'paragraph', content };
}

function doc(...content: PMNode[]): PMDoc {
  return { type: 'doc', content };
}

function text(value: string): PMNode {
  return { type: 'text', text: value };
}

test('a document with no links references nothing', () => {
  assert.equal(referencesTo(doc(para(text('nothing here'))), TARGET), null);
  assert.equal(referencesTo(null, TARGET), null);
  assert.equal(referencesTo(doc(para(link(OTHER))), TARGET), null);
});

test('an empty target matches nothing, rather than everything', () => {
  assert.equal(referencesTo(doc(para(link(TARGET))), ''), null);
});

test('counts every mention but reports the first block as context', () => {
  const found = referencesTo(
    doc(
      para(text('The tide chart lives in '), link(TARGET), text(' if you need it.')),
      para(text('Later, unrelated.')),
      para(text('See also '), link(TARGET), text('.')),
    ),
    TARGET,
  );
  assert.equal(found?.count, 2);
  assert.equal(found?.context, 'The tide chart lives in if you need it.');
});

test('finds links nested inside lists and quotes', () => {
  const found = referencesTo(
    doc({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [para(text('check '), link(TARGET))],
        },
      ],
    }),
    TARGET,
  );
  assert.equal(found?.count, 1);
  assert.equal(found?.context, 'check');
});

test('context keeps other pages by name and drops the target', () => {
  const found = referencesTo(
    doc(para(text('Between '), link(OTHER, 'Docks'), text(' and '), link(TARGET, 'Harbour'))),
    TARGET,
  );
  assert.equal(found?.context, 'Between Docks and');
});

test('pictures and stickers contribute nothing to context', () => {
  const found = referencesTo(
    doc(
      para(
        { type: 'image', attrs: { id: 'abc' } },
        text('caption '),
        { type: 'sticker', attrs: { name: 'star' } },
        link(TARGET),
      ),
    ),
    TARGET,
  );
  assert.equal(found?.context, 'caption');
});

test('tidyContext collapses whitespace and truncates at a word boundary', () => {
  assert.equal(tidyContext('  two   words\n here '), 'two words here');

  const long = `${'alpha '.repeat(80)}omega`;
  const cut = tidyContext(long);
  assert.ok(cut.length <= CONTEXT_LIMIT + 1, 'stays within the limit');
  assert.ok(cut.endsWith('…'), 'says it was cut');
  assert.ok(!cut.includes('alph…'), 'does not cut mid-word');
});
