import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

import { pickImageFile, storeImage } from './assets.ts';
import { copyImages, describeCopy } from './galleryClipboard.ts';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    gallery: {
      /** A gallery holding the images given, or an empty one to drop into. */
      insertGallery: (images?: { id: string; alt?: string }[]) => ReturnType;
      /** Wraps the images the selection covers. Fails unless there are two. */
      groupImagesIntoGallery: () => ReturnType;
    };
  }
}

/**
 * Several pictures, shown as a grid rather than as a column.
 *
 * A real node holding real image children, rather than a rule that says "any
 * run of images draws as a grid". The difference is that a gallery is
 * something the writer made and can point at: it can be given a column count,
 * dropped into, copied out of, and taken apart again. A rule about adjacency
 * can do none of that, and would silently reformat two screenshots that just
 * happened to end up next to each other.
 *
 * The children are ordinary `image` nodes — same asset ids, same bytes, same
 * de-duplication — so every walk in the app already understands the contents
 * of a gallery even where it has never heard of one. The exports get this for
 * free: both fall through to the children of a block they do not recognise, so
 * a gallery exports as the pictures in it, in order.
 */

/** The counts on offer. Two is a pair, four is a contact sheet; past that the
 * pictures are too small to be looking at. */
export const GALLERY_COLUMNS = [2, 3, 4] as const;

const DEFAULT_COLUMNS = 3;

export const Gallery = Node.create({
  name: 'gallery',
  group: 'block',
  // `image*` and not `image+`: `/gallery` makes an empty one to drop pictures
  // into, and a node type that cannot be empty cannot be made empty-first.
  content: 'image*',
  draggable: true,
  // The grid is a place, and arrowing out of the side of it into the middle of
  // a neighbouring paragraph is not how a place behaves.
  isolating: true,

  addAttributes() {
    return {
      columns: {
        default: DEFAULT_COLUMNS,
        parseHTML: (element) => {
          const parsed = Number(element.getAttribute('data-columns'));
          return GALLERY_COLUMNS.includes(parsed as (typeof GALLERY_COLUMNS)[number])
            ? parsed
            : DEFAULT_COLUMNS;
        },
        renderHTML: (attributes) => ({ 'data-columns': String(attributes.columns) }),
      },
    };
  },

  parseHTML() {
    // The inner element is where the pictures are, in the static render and in
    // the node view alike, so a gallery that has been through the clipboard or
    // a revision snapshot comes back as itself.
    return [{ tag: 'div[data-gallery]', contentElement: '.gallery-grid' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-gallery': '', class: 'gallery' }),
      ['div', { class: 'gallery-grid' }, 0],
    ];
  },

  addCommands() {
    return {
      insertGallery:
        (images = []) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { columns: DEFAULT_COLUMNS },
            content: images.map((image) => ({
              type: 'image',
              attrs: { id: image.id, alt: image.alt ?? '' },
            })),
          }),

      groupImagesIntoGallery:
        () =>
        ({ state, tr, dispatch }) => {
          const run = imageRunIn(state);
          if (!run) return false;
          if (dispatch) {
            const gallery = state.schema.nodes.gallery?.createAndFill(
              { columns: DEFAULT_COLUMNS },
              run.nodes,
            );
            if (!gallery) return false;
            tr.replaceWith(run.from, run.to, gallery);
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      // The node handed in is a snapshot. Everything below reads `current`,
      // which `update` keeps pointed at the live one.
      let current = node;

      const dom = document.createElement('div');
      dom.className = 'gallery';
      dom.setAttribute('data-gallery', '');

      const grid = document.createElement('div');
      grid.className = 'gallery-grid';
      dom.append(grid);

      const chrome = document.createElement('div');
      chrome.className = 'gallery-chrome';
      // Not part of the document. Without this the browser would let a caret
      // into the buttons and ProseMirror would try to read them as content.
      chrome.contentEditable = 'false';
      dom.append(chrome);

      /** Where this gallery starts, or null once it has been taken out. */
      const at = (): number | null => {
        const pos = getPos();
        return typeof pos === 'number' ? pos : null;
      };

      const button = (label: string, title: string, run: () => void): HTMLButtonElement => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'gallery-button';
        element.textContent = label;
        element.title = title;
        // Keep the selection where the writer left it: a button in a node view
        // that steals focus takes the caret out of the document with it.
        element.addEventListener('mousedown', (event) => event.preventDefault());
        element.addEventListener('click', (event) => {
          event.preventDefault();
          run();
        });
        chrome.append(element);
        return element;
      };

      const columnButtons = GALLERY_COLUMNS.map((count) =>
        button(String(count), `${count} across`, () => {
          const pos = at();
          if (pos === null) return;
          editor.view.dispatch(
            editor.view.state.tr.setNodeMarkup(pos, undefined, {
              ...current.attrs,
              columns: count,
            }),
          );
        }),
      );

      button('Add', 'Add a picture to this gallery', () => {
        void (async () => {
          const file = await pickImageFile();
          if (!file) return;
          try {
            const stored = await storeImage(file);
            // Read again rather than trusting the position captured above: a
            // file dialog is a conversation, and the document may have moved
            // on while it was open.
            const pos = at();
            if (pos === null) return;
            const image = editor.schema.nodes.image?.create({ id: stored.id, alt: file.name });
            if (!image) return;
            const end = pos + current.nodeSize - 1;
            editor.view.dispatch(editor.view.state.tr.insert(end, image));
          } catch (error) {
            console.warn('Springboard could not read that image.', error);
          }
        })();
      });

      const copy = button('Copy all', 'Put every picture here on the clipboard', () => {
        const ids = imageIdsOf(current);
        if (ids.length === 0) return;
        copy.disabled = true;
        copy.textContent = 'Copying…';
        void copyImages(ids)
          .then((outcome) => {
            copy.textContent = describeCopy(outcome);
          })
          .catch(() => {
            copy.textContent = 'Could not copy';
          })
          .finally(() => {
            window.setTimeout(() => {
              copy.disabled = false;
              copy.textContent = 'Copy all';
            }, 1600);
          });
      });

      button('Ungroup', 'Put these pictures back in the page one after another', () => {
        const pos = at();
        if (pos === null) return;
        const { tr } = editor.view.state;
        // An empty gallery has nothing to put back, so ungrouping it is just
        // taking it out — which is the only way to be rid of one by hand.
        if (current.childCount === 0) tr.delete(pos, pos + current.nodeSize);
        else tr.replaceWith(pos, pos + current.nodeSize, current.content);
        editor.view.dispatch(tr);
      });

      const paint = () => {
        dom.setAttribute('data-columns', String(current.attrs.columns ?? DEFAULT_COLUMNS));
        grid.classList.toggle('is-empty', current.childCount === 0);
        for (const [index, element] of columnButtons.entries()) {
          element.classList.toggle('is-active', GALLERY_COLUMNS[index] === current.attrs.columns);
        }
      };
      paint();

      return {
        dom,
        contentDOM: grid,
        update(next) {
          if (next.type !== current.type) return false;
          current = next;
          paint();
          return true;
        },
        // The chrome is ours. Left to itself ProseMirror would read a click on
        // a button as a click into the document and move the selection.
        stopEvent: (event) => event.target instanceof globalThis.Node && chrome.contains(event.target),
        // Same again for the DOM those buttons change. The empty-state class
        // is written onto the content element itself, and an attribute we set
        // there is ours — left to ProseMirror it would read as the document
        // changing under it and re-parse the grid on every repaint.
        ignoreMutation: (mutation) => {
          if (!(mutation.target instanceof globalThis.Node)) return true;
          if (mutation.type === 'attributes' && mutation.target === grid) return true;
          return !grid.contains(mutation.target);
        },
      };
    };
  },
});

/** Every asset id in a gallery, in the order the pictures are shown. */
export function imageIdsOf(gallery: PMNode): string[] {
  const ids: string[] = [];
  gallery.forEach((child) => {
    if (child.type.name === 'image' && typeof child.attrs.id === 'string' && child.attrs.id) {
      ids.push(child.attrs.id);
    }
  });
  return ids;
}

/**
 * The run of top-level images the selection covers, or null when grouping them
 * would mean guessing.
 *
 * Strict on purpose. Every block the selection touches has to be an image, so
 * wrapping cannot swallow a paragraph that happened to sit between two
 * pictures — a gallery is easy to make again and a lost sentence is not.
 * Images nested in a list or already in a gallery are left where they are.
 */
function imageRunIn(state: EditorState): { from: number; to: number; nodes: PMNode[] } | null {
  const { from, to } = state.selection;
  if (from === to) return null;

  const nodes: PMNode[] = [];
  let start = -1;
  let end = -1;
  let touched = 0;

  state.doc.forEach((child, offset) => {
    const blockFrom = offset;
    const blockTo = offset + child.nodeSize;
    if (blockTo <= from || blockFrom >= to) return;
    touched++;
    if (child.type.name !== 'image') return;
    if (start === -1) start = blockFrom;
    end = blockTo;
    nodes.push(child);
  });

  if (nodes.length < 2 || nodes.length !== touched) return null;
  return { from: start, to: end, nodes };
}

/** How many images the selection would group. The toolbar asks before offering. */
export function groupableImages(state: EditorState): number {
  return imageRunIn(state)?.nodes.length ?? 0;
}
