import { Node, mergeAttributes } from '@tiptap/core';

import { stickerById } from './stickers.ts';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sticker: {
      insertSticker: (id: string) => ReturnType;
    };
  }
}

/**
 * A piece of art from the set that ships with the app.
 *
 * The node stores an id and nothing else — no bytes, no path, no size. The
 * file is looked up when it renders, exactly as a page link looks up its
 * title, and for the same reason: there is then only one copy of the art, and
 * replacing it updates every page that used it. It also means a document with
 * fifty stickers in it costs fifty short strings, which matters more here than
 * it looks, because `revisions` keeps a whole copy of `content` per snapshot.
 *
 * This is deliberately not an image node. Images are arbitrary bytes that have
 * to be stored, deduplicated and exported; stickers are a closed set that is
 * already on disk. Sharing a node type between them would drag the first
 * problem into the second.
 *
 * Inline rather than block, so a sticker can end a sentence or stand alone in
 * its own paragraph. A sticker whose art has left the set renders as its id in
 * a box rather than disappearing — the same call PageLink makes about a page
 * that is no longer there.
 */
export const Sticker = Node.create({
  name: 'sticker',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-sticker') ?? '',
        renderHTML: (attributes) => ({ 'data-sticker': attributes.id }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[data-sticker]' }, { tag: 'span[data-sticker]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const id = String(node.attrs.id ?? '');
    const sticker = stickerById(id);
    if (!sticker) {
      return ['span', mergeAttributes(HTMLAttributes, { class: 'sticker is-missing' }), id];
    }
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        class: 'sticker',
        src: sticker.src,
        alt: sticker.label,
        // Dragging is the node's job — and the way ProseMirror does that job
        // is by marking this element draggable itself, so saying otherwise
        // here takes the ability away rather than tidying it up.
      }),
    ];
  },

  addCommands() {
    return {
      insertSticker:
        (id: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { id } }),
    };
  },
});
