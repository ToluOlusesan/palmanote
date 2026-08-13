import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

import { cachedAssetUrl, resolveAssetImages } from './assets.ts';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      insertImage: (attributes: { id: string; alt?: string }) => ReturnType;
    };
  }
}

/**
 * A picture the writer put in a page.
 *
 * The node holds the asset's id and an alt text — never the bytes, and never a
 * path. See assets.ts for why: everything a document contains is copied into a
 * revision every couple of minutes, and bytes in the document would be bytes
 * in every snapshot of it.
 *
 * Block rather than inline, which is the line between this and a sticker. A
 * sticker is punctuation — small, decorative, sits inside a sentence. An image
 * is a thing you stop reading to look at, so it gets its own place in the
 * stack and its own place in the exports, where it is a paragraph rather than
 * a run.
 *
 * Nothing about it is resizable. That is not an omission to fix later: a
 * writing app that lets you drag pictures to arbitrary sizes has quietly
 * become a layout app, and the measure is 40rem for the same reason the prose
 * is one column.
 */
export const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-asset') ?? '',
        renderHTML: (attributes) => ({ 'data-asset': attributes.id }),
      },
      alt: {
        default: '',
        parseHTML: (element) => element.getAttribute('alt') ?? '',
        renderHTML: (attributes) => (attributes.alt ? { alt: attributes.alt } : {}),
      },
    };
  },

  parseHTML() {
    // `data-asset` and nothing else. An `<img src="https://...">` pasted from
    // a web page has no asset behind it and must not parse into this node —
    // it would render as a hole and export as a hole. The paste handler in
    // useDocumentEditor is what turns real image data into one of these.
    return [{ tag: 'img[data-asset]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const cached = cachedAssetUrl(String(node.attrs.id ?? ''));
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        class: 'image',
        // Nothing sets `draggable` here on purpose. ProseMirror moves a
        // `draggable: true` node by riding the browser's own drag, and it
        // marks the element up itself to do it — writing `draggable="false"`
        // over the top disables the exact mechanism the node spec above asks
        // for, which is a picture you cannot move.
        // Only when it is already in hand. Everything else is filled in by the
        // plugin below, one frame later, which is the difference between a
        // picture appearing and a picture blinking.
        ...(cached ? { src: cached } : {}),
      }),
    ];
  },

  addCommands() {
    return {
      insertImage:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: attributes }),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('palmanoteImageSrc'),
        view: (view) => {
          const fill = () => resolveAssetImages(view.dom);
          fill();
          return { update: fill };
        },
      }),
    ];
  },
});
