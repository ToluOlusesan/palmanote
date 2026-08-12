import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageLink: {
      insertPageLink: (id: string) => ReturnType;
    };
  }
}

/**
 * A reference to another page, inline in the prose.
 *
 * Making a page inside another one puts one of these where the caret is, so
 * the parent reads as a table of contents you wrote by accident. The node
 * stores only an id — the title and the icon are looked up when it renders, so
 * renaming a chapter updates every mention of it and there is no second copy
 * of the title to fall out of step.
 *
 * A dead link is left visible rather than removed. A page you archived is
 * something you might want back, and silently deleting the sentence that
 * pointed at it is worse than showing that it is gone.
 */
export const PageLink = Node.create({
  name: 'pageLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-page') ?? '',
        renderHTML: (attributes) => ({ 'data-page': attributes.id }),
      },
      /**
       * Written at insertion and never read by the app — it is what a copy of
       * this document carries into a file, an export or another editor, where
       * the id means nothing.
       */
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-label') ?? '',
        renderHTML: (attributes) => ({ 'data-label': attributes.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-page]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, { class: 'page-link', href: '#' }),
      String(node.attrs.label || 'Untitled'),
    ];
  },

  addCommands() {
    return {
      insertPageLink:
        (id: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { id, label: '' } }),
    };
  },
});
