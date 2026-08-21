import Code from '@tiptap/extension-code';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';

import { writingSettings } from '../state/writingSettings.ts';

import { Shortcuts } from './keymap.ts';
import { Caret } from './caret.ts';
import { Gallery } from './Gallery.ts';
import { Highlight } from './Highlight.ts';
import { Image } from './Image.ts';
import { PageLink } from './PageLink.ts';
import { SceneBreak } from './SceneBreak.ts';
import { Slash } from './slash.ts';
import { Sticker } from './Sticker.ts';
import { SmartTypography } from './typography.ts';

/**
 * The whole schema. Everything absent from this list is absent from the
 * document model, which is what makes paste-stripping free: ProseMirror
 * cannot parse a node type that does not exist.
 *
 * Deliberately not here: underline, text colour, alignment.
 * Highlighting is here but is four fixed colours rather than a colour picker —
 * see Highlight.ts.
 *
 * Code, code blocks and links were once on that list too, and were taken off
 * it. They were the right omissions for a manuscript and the wrong ones for
 * the workspace this became: a snippet, a shell command and a pasted URL are
 * the three things that turn up in notes that prose has nowhere to put.
 *
 * **Tables joined them, and the distinction is worth keeping straight.** What
 * is here is a grid of cells you type prose into — the thing Word and every
 * text editor has. What is still ruled out is a *database*: rows as records,
 * typed columns, filters, sorts, saved views. Those are a different product
 * living inside this one, and the decision against them stands. A table here
 * holds paragraphs and lists, exactly like every other cell of the document,
 * and knows nothing about what is in it.
 *
 * Adding one has a cost this file used to be able to claim it did not pay.
 * "Paste-stripping is free because ProseMirror cannot parse a node type that
 * does not exist" was true of tables until now, and every table on every web
 * page is suddenly something the document *can* hold — including the ones that
 * are page furniture rather than data. See `transformPastedHTML` in
 * useDocumentEditor.ts, which is where the layout-table case is answered.
 *
 * Stickers and images are both here and are both atoms holding an id: a
 * sticker names art that ships with the app, an image names bytes in the
 * library. Neither ever carries the picture itself, which is what keeps a
 * revision snapshot the size of the words in it.
 *
 * A gallery is several of those images in a grid. It holds nothing of its own
 * beyond a column count, so everything that already understood an image — the
 * exports, the asset sweep, the word count — understands the contents of one
 * without being told.
 *
 * Paste-stripping survives them. Both parse only from their own data
 * attribute, so an `<img src="https://…">` dragged in off a web page still has
 * nowhere to land — the paste handler in useDocumentEditor is what turns real
 * image *data* into an asset, and a remote URL is not data.
 */
/**
 * The marks that do not survive an Enter.
 *
 * Tiptap keeps whatever was active at the split, which is what a word processor
 * does and what these three should not: a highlight, a code span and a link all
 * describe a particular piece of text rather than a way of writing, so carrying
 * them means the next block starts already painted, already monospaced or
 * already pointing somewhere. Bold and italic are left alone — those really do
 * usually continue onto the next line. The fourth is Highlight.ts, which sets
 * the same flag on itself.
 *
 * They come out of the StarterKit and go back in extended, because
 * `keepOnSplit` is a property of the extension rather than one of its options
 * and there is no way to reach a kit's children to change it.
 */
const LEAVE_BEHIND = [
  Code.extend({ keepOnSplit: false }),
  /**
   * `openOnClick` is off because opening a link is not the editor's decision
   * to make — see the click handler in useDocumentEditor, which routes
   * through the shell so the URL is checked in Rust before anything opens.
   *
   * `linkOnPaste` is on: pasting a URL over a selection makes that selection
   * the link, which is the one thing everybody already knows how to do and
   * would otherwise have to be taught here.
   *
   * Nothing is fetched to decorate a link. When a browser is the source the
   * title is already on the clipboard as `<a href=…>Title</a>` and arrives
   * through the ordinary HTML paste; when it is not, the URL stands as
   * itself. See src/core/links.ts.
   */
  Link.extend({ keepOnSplit: false }).configure({
    openOnClick: false,
    linkOnPaste: true,
    autolink: true,
    protocols: ['mailto'],
    defaultProtocol: 'https',
    HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
  }),
];

export const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    // The typed scene break replaces the generic rule.
    horizontalRule: false,
    // No syntax highlighting, and no language picker to choose it with. A
    // monospace block that holds exactly what you pasted is the whole job;
    // colouring it would mean shipping a grammar for every language you might
    // paste, and getting it wrong in the ones we did not ship.
    codeBlock: { exitOnTripleEnter: true, exitOnArrowDown: true },
    // Both taken out of the kit and put back below, extended. See LEAVE_BEHIND.
    code: false,
    link: false,
    underline: false,
    trailingNode: { node: 'paragraph' },
    dropcursor: { width: 2, color: 'var(--accent)' },
    undoRedo: { depth: 300, newGroupDelay: 400 },
  }),
  ...LEAVE_BEHIND,
  Shortcuts,
  TaskList,
  TaskItem.configure({ nested: true }),
  SceneBreak,
  Highlight,
  PageLink,
  Sticker,
  Image,
  Gallery,
  /*
    A grid of prose, and nothing beyond that.

    `resizable` is off, and it is the one option here worth arguing about.
    Dragging a column border is the single most-asked-for thing about a table
    and it is also how a writing surface turns into a layout surface — the same
    argument that keeps images at one width (see Image.ts). Turning it on also
    means a `colwidth` array on every cell, which is a document attribute, which
    means it is copied into a revision snapshot every couple of minutes for as
    long as the page lives. Automatic layout sizes a column to what is in it,
    which is what a reader wants from a table of six words and a sentence.

    `allowTableNodeSelection` is on because the block gutter needs it: the drag
    handle works by putting a `NodeSelection` on the block it is beside, and
    without this a table is the one block in the document that cannot be picked
    up. See blocks.ts.
  */
  TableKit.configure({
    table: {
      resizable: false,
      allowTableNodeSelection: true,
      // A wrapper element, so a table wider than the measure scrolls inside
      // its own box. Without one the overflow belongs to the page, and a wide
      // table drags the whole column of prose sideways under the reader.
      renderWrapper: true,
    },
  }),
  Slash,
  Caret.configure(writingSettings()),
  SmartTypography,
  // Only ever on a wholly empty page. A per-node placeholder reappears on the
  // trailing paragraph of a finished document, which reads as an instruction
  // to someone who is already writing.
  Placeholder.configure({
    placeholder: ({ editor }) => (editor.isEmpty ? 'Start writing' : ''),
  }),
];
