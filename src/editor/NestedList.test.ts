import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { NestedList } from './NestedList.ts';

test('a nested list keeps its title, open state and ordinary block children', () => {
  const schema = getSchema([StarterKit, NestedList]);
  const nested = schema.node('nestedList', { title: 'Research', collapsed: true }, [
    schema.node('paragraph', null, [schema.text('First item')]),
  ]);
  const document = schema.node('doc', null, [nested]);

  assert.doesNotThrow(() => document.check());
  assert.equal(nested.attrs.title, 'Research');
  assert.equal(nested.attrs.collapsed, true);
  assert.equal(nested.child(0).type.name, 'paragraph');
});
