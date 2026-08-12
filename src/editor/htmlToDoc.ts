/**
 * HTML into the schema, using the schema itself as the filter.
 *
 * This is the same mechanism paste already relies on: ProseMirror cannot parse
 * a node type that does not exist, so anything Word puts in its HTML that
 * Springboard has no place for — tables, images, colours, fonts, comments —
 * has nowhere to land and is dropped. Nothing here maintains a list of what to
 * strip, which is why it cannot fall out of date with the schema.
 */

import { getSchema } from '@tiptap/core';
import { DOMParser } from '@tiptap/pm/model';

import type { PMDoc } from '../core/types.ts';
import { extensions } from './extensions.ts';

let cached: ReturnType<typeof getSchema> | null = null;

function schema() {
  cached ??= getSchema(extensions);
  return cached;
}

export function htmlToDoc(html: string): PMDoc {
  const container = document.implementation.createHTMLDocument('import');
  container.body.innerHTML = html
    // Word writes these on nearly every element and they survive parsing.
    .replace(/\s(style|class|lang|dir|id)="[^"]*"/gi, '');

  const doc = DOMParser.fromSchema(schema()).parse(container.body);
  const json = doc.toJSON() as PMDoc;
  if (!json.content || json.content.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  return json;
}
