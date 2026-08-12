import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import type { DocumentMeta } from '../core/types.ts';

/**
 * Paints page links with the title and icon their target has *now*, and opens
 * the target when one is clicked.
 *
 * The node itself stores only an id, so this is where a link learns what it is
 * pointing at. A decoration rather than a node view: the document is never
 * touched, so nothing here reaches undo, autosave or export.
 */

export const pageLinkKey = new PluginKey('springboardPageLink');

export interface PageLinkContext {
  /** Current metadata for a page, or undefined once it is gone. */
  lookup: (id: string) => DocumentMeta | undefined;
  open: (id: string) => void;
}

/**
 * Tiptap wants an Extension, not a bare object with the right shape — passing
 * the latter registers nothing and fails silently, which is how a page link
 * ends up rendering its stale stored label instead of the live title.
 */
export const PageLinkView = Extension.create<PageLinkContext>({
  name: 'springboardPageLinkView',

  addOptions() {
    return { lookup: () => undefined, open: () => {} };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      pageLinkPlugin({
        lookup: (id) => options.lookup(id),
        open: (id) => options.open(id),
      }),
    ];
  },
});

export function pageLinkPlugin(context: PageLinkContext) {
  const decorate = (doc: import('@tiptap/pm/model').Node) => {
    const found: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name !== 'pageLink') return;
      const meta = context.lookup(String(node.attrs.id));
      found.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: meta ? 'page-link' : 'page-link is-missing',
          'data-icon': meta?.icon ?? '',
          'data-title': meta ? meta.title || 'Untitled' : 'Page no longer here',
        }),
      );
    });
    return DecorationSet.create(doc, found);
  };

  return new Plugin({
    key: pageLinkKey,
    state: {
      init: (_config, state) => decorate(state.doc),
      // Titles change outside this document, so the set is rebuilt rather than
      // mapped. Page links are few; walking them is cheaper than being wrong.
      apply: (tr) => decorate(tr.doc),
    },
    props: {
      decorations: (state) => pageLinkKey.getState(state) as DecorationSet,
      handleClickOn(_view, _pos, node) {
        if (node.type.name !== 'pageLink') return false;
        const id = String(node.attrs.id);
        if (context.lookup(id)) context.open(id);
        return true;
      },
    },
  });
}
