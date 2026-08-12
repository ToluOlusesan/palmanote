import Placeholder from '@tiptap/extension-placeholder';
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
 * Deliberately not here: underline, tables, text colour, alignment.
 * Highlighting is here but is four fixed colours rather than a colour picker —
 * see Highlight.ts.
 *
 * Code, code blocks and links were once on that list too, and were taken off
 * it. They were the right omissions for a manuscript and the wrong ones for
 * the workspace this became: a snippet, a shell command and a pasted URL are
 * the three things that turn up in notes that prose has nowhere to put.
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
    link: {
      openOnClick: false,
      linkOnPaste: true,
      autolink: true,
      protocols: ['mailto'],
      defaultProtocol: 'https',
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
    },
    underline: false,
    trailingNode: { node: 'paragraph' },
    dropcursor: { width: 2, color: 'var(--accent)' },
    undoRedo: { depth: 300, newGroupDelay: 400 },
  }),
  Shortcuts,
  TaskList,
  TaskItem.configure({ nested: true }),
  SceneBreak,
  Highlight,
  PageLink,
  Sticker,
  Image,
  Gallery,
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
