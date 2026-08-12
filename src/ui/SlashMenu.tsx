import {
  Code,
  DotsThree,
  ListBullets,
  ListChecks,
  ListNumbers,
  FilePlus,
  ImageSquare,
  Quotes,
  SquaresFour,
  TextAa,
  TextHOne,
  TextHThree,
  TextHTwo,
  type Icon,
} from '@phosphor-icons/react';
import type { ChainedCommands } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { searchPages, titleTaken } from '../core/search.ts';
import type { DocumentMeta } from '../core/types.ts';
import { flattenAll } from '../core/tree.ts';
import { pickImageFile, storeImage } from '../editor/assets.ts';
import { insertMenu, isTyped, setSlashKeys, type InsertMenu } from '../editor/slash.ts';
import { STICKERS } from '../editor/stickers.ts';
import { useLibrary } from '../state/library.tsx';
import { DocumentIcon } from './IconPicker.tsx';

interface Entry {
  id: string;
  label: string;
  group: string;
  /** Beyond the label. Lowercase, space-separated. */
  keywords: string;
  hint?: string;
  glyph?: Icon;
  thumb?: string;
  /** Anything the glyph slot cannot say with an icon — a page's own icon. */
  glyphNode?: ReactNode;
  /** Where a page sits, so two called "Notes" can be told apart. */
  note?: string;
  /** Runs on a chain that has already removed the `/`, so it is one undo step. */
  run: (chain: ChainedCommands) => ChainedCommands;
}

/**
 * Everything the menu can insert, in the order it offers it.
 *
 * Only what the schema actually has. There is no code block, no table and no
 * link here because there is none in `extensions.ts`, and a menu that offers
 * what the document cannot hold is worse than no menu.
 *
 * The hints are not decoration: every block here already had a shortcut and an
 * input rule before this menu existed. `/` is the discoverable route to them,
 * so it is also where a writer finds out the faster one exists.
 */
const BLOCKS: Entry[] = [
  {
    id: 'text',
    label: 'Text',
    group: 'Blocks',
    keywords: 'paragraph body plain normal',
    hint: 'Ctrl+Alt+0',
    glyph: TextAa,
    run: (chain) => chain.setParagraph(),
  },
  {
    id: 'h1',
    label: 'Heading 1',
    group: 'Blocks',
    keywords: 'title big',
    hint: 'Ctrl+Alt+1',
    glyph: TextHOne,
    run: (chain) => chain.toggleHeading({ level: 1 }),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    group: 'Blocks',
    keywords: 'subtitle section',
    hint: 'Ctrl+Alt+2',
    glyph: TextHTwo,
    run: (chain) => chain.toggleHeading({ level: 2 }),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    group: 'Blocks',
    keywords: 'subsection small',
    hint: 'Ctrl+Alt+3',
    glyph: TextHThree,
    run: (chain) => chain.toggleHeading({ level: 3 }),
  },
  {
    id: 'bullets',
    label: 'Bulleted list',
    group: 'Blocks',
    keywords: 'unordered points dashes',
    hint: '- ',
    glyph: ListBullets,
    run: (chain) => chain.toggleBulletList(),
  },
  {
    id: 'numbers',
    label: 'Numbered list',
    group: 'Blocks',
    keywords: 'ordered steps',
    hint: '1. ',
    glyph: ListNumbers,
    run: (chain) => chain.toggleOrderedList(),
  },
  {
    id: 'tasks',
    label: 'To-do list',
    group: 'Blocks',
    keywords: 'checkbox task checklist tick',
    hint: '[] ',
    glyph: ListChecks,
    run: (chain) => chain.toggleTaskList(),
  },
  {
    id: 'quote',
    label: 'Quote',
    group: 'Blocks',
    keywords: 'blockquote citation epigraph',
    hint: '> ',
    glyph: Quotes,
    run: (chain) => chain.toggleBlockquote(),
  },
  {
    id: 'code',
    label: 'Code block',
    group: 'Blocks',
    keywords: 'snippet monospace terminal command shell json sql',
    hint: '``` ',
    glyph: Code,
    run: (chain) => chain.toggleCodeBlock(),
  },
  {
    id: 'scene',
    label: 'Scene break',
    group: 'Blocks',
    keywords: 'divider rule separator section asterisks',
    hint: '***',
    glyph: DotsThree,
    run: (chain) => chain.setSceneBreak(),
  },
  {
    id: 'image',
    label: 'Image',
    group: 'Blocks',
    keywords: 'picture photo screenshot png jpg',
    glyph: ImageSquare,
    // The picker is a file dialog, and a file dialog is a conversation. The
    // chain has to be spent now — on nothing — so the `/image` that opened it
    // is cleared whether or not a file comes back.
    run: (chain) => {
      void pickImage();
      return chain;
    },
  },
  {
    id: 'gallery',
    label: 'Image gallery',
    group: 'Blocks',
    keywords: 'gallery grid images photos pictures album contact sheet',
    glyph: SquaresFour,
    // Empty, with a hint in it. The other way in is to paste or drop several
    // pictures at once, which makes one already full — this is for the writer
    // who wants somewhere to put them first.
    run: (chain) => chain.insertGallery(),
  },
];

/**
 * The shared picker, plus the hand-off the menu needs on top of it.
 *
 * The insert cannot be done by whoever awaited this: the menu is gone the
 * moment the `/image` is deleted, and the dialog is still on screen. So the
 * file goes to whatever is holding `chosenImage` — see the effect below.
 */
function pickImage(): Promise<File | null> {
  return pickImageFile().then((file) => {
    if (file) chosenImage?.(file);
    return file;
  });
}

/** Set by the menu while it is mounted; there is only ever one editor. */
let chosenImage: ((file: File) => void) | null = null;

const STICKER_ENTRIES: Entry[] = STICKERS.map((sticker) => ({
  id: `sticker:${sticker.id}`,
  label: sticker.label,
  group: 'Stickers',
  keywords: `sticker ${sticker.keywords}`,
  thumb: sticker.src,
  run: (chain) => chain.insertSticker(sticker.id),
}));

/**
 * What a `/` opens onto.
 *
 * A `/` is typed at the end of what you have written: there is a caret and
 * nothing else, so everything here puts something new down. Marks and
 * highlights are absent because a mark with nothing under it has nothing to do
 * — those belong to held text, and held text gets the bar that comes to it
 * rather than a list. See SelectionBar.tsx.
 */
function entriesFor(): Entry[] {
  return [...BLOCKS, ...STICKER_ENTRIES];
}

/**
 * Pages, for an `@`.
 *
 * Built per keystroke rather than once, because the list *is* the query — and
 * it costs a pass over an array the tree already holds in memory. Archived
 * pages are absent: they are absent from the tree, and a link to one would
 * render as visibly missing the moment it was made.
 */
function mentionEntries(
  query: string,
  pages: DocumentMeta[],
  byId: ReadonlyMap<string, DocumentMeta>,
  here: string | null,
  makePage: (title: string) => void,
): Entry[] {
  const found = searchPages(pages, byId, query, { exclude: here });
  const entries: Entry[] = found.map((match) => ({
    id: `page:${match.doc.id}`,
    label: match.doc.title || 'Untitled',
    group: 'Pages',
    keywords: '',
    note: match.trail.join(' / '),
    glyphNode: <DocumentIcon icon={match.doc.icon} kind={match.doc.kind} size={16} />,
    run: (chain) =>
      chain.insertContent({
        type: 'pageLink',
        attrs: { id: match.doc.id, label: match.doc.title },
      }),
  }));

  // The row that makes this more than a picker: you are mid-sentence, the page
  // you are referring to does not exist yet, and saying so is enough to make
  // it. Withheld when a page already answers to exactly that name, because
  // then the thing above is the thing you meant.
  const wanted = query.trim();
  if (wanted.length > 0 && !titleTaken(pages, wanted)) {
    entries.push({
      id: 'page:new',
      label: `Create “${wanted}”`,
      group: 'Pages',
      keywords: '',
      note: 'inside this page',
      glyph: FilePlus,
      run: (chain) => {
        makePage(wanted);
        return chain;
      },
    });
  }
  return entries;
}

function matching(entries: Entry[], query: string): Entry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return entries;
  return entries.filter(
    (entry) => entry.label.toLowerCase().includes(needle) || entry.keywords.includes(needle),
  );
}

/** The two doors that are a character in the document: `/` and `@`. */
type TypedMenu = Extract<InsertMenu, { query: string }>;

/**
 * The menu, whichever character opened it.
 *
 * It owns the list and which line of it is selected; slash.ts owns whether it
 * is open at all and hands over the keys that mean something here. Nothing is
 * touched until something is chosen, so a `/` that turned out to be a fraction
 * costs a space bar and no undo.
 *
 * Held text is the third door slash.ts knows about and is not this one's:
 * a list of every verb is the right shape for "put something here" and the
 * wrong shape for "do something to this". That one gets a bar that comes to
 * the words — see SelectionBar.tsx.
 */
export function SlashMenu({ editor }: { editor: Editor | null }) {
  const library = useLibrary();
  const [menu, setMenu] = useState<TypedMenu | null>(null);
  const [index, setIndex] = useState(0);
  // Anything that moves the caret under a menu that is already open.
  const [moved, setMoved] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState({ left: 0, top: 0 });

  // A new object per transaction would re-render the menu on every keystroke
  // whether or not anything about it changed.
  useEffect(() => {
    if (!editor) return;
    const refresh = () =>
      setMenu((current) => {
        const open = insertMenu(editor.state);
        const next = open && isTyped(open) ? open : null;
        if (!next || !current) return next === current ? current : next;
        if (next.kind !== current.kind || next.from !== current.from) return next;
        // Same door, same anchor — so the only thing left that can have
        // changed is what has been typed since. Checking that for `/` alone
        // was what left an `@` list frozen on whatever it opened with.
        return next.query === current.query ? current : next;
      });
    refresh();
    editor.on('transaction', refresh);
    return () => {
      editor.off('transaction', refresh);
    };
  }, [editor]);

  const query = menu?.query ?? '';
  const kind = menu?.kind;

  // Only what is reachable in the tree. `library.docs` still carries archived
  // pages and their descendants, and an `@` should not offer to link to
  // something the sidebar says is gone.
  const pages = useMemo(
    () => flattenAll(library.tree).map((node) => node.doc),
    [library.tree],
  );

  // Made from the current query rather than in an effect, so the row a keypress
  // lands on is the row that was on screen when it was pressed.
  const makePage = (title: string) => {
    if (!editor) return;
    void library
      .create({ parentId: library.selectedId, title }, { follow: false })
      .then((meta) =>
        editor
          .chain()
          .focus()
          .insertContent({ type: 'pageLink', attrs: { id: meta.id, label: meta.title } })
          .run(),
      );
  };

  const items = useMemo(
    () =>
      menu === null
        ? []
        : menu.kind === 'mention'
          ? mentionEntries(query, pages, library.byId, library.selectedId, makePage)
          : matching(entriesFor(), query),
    // The list depends on which door the menu came through and what has been
    // typed since, not on where it is anchored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, query, pages, library.byId, library.selectedId],
  );
  // The list shortens as the query grows, so the selected line has to be
  // pulled back into it rather than left pointing past the end.
  const active = items.length === 0 ? -1 : Math.min(index, items.length - 1);

  useEffect(() => {
    setIndex(0);
  }, [kind, query]);

  const choose = (entry: Entry | undefined) => {
    if (!editor || !entry) return;
    const current = insertMenu(editor.state);
    if (!current || !isTyped(current)) return;
    // The trigger character and everything typed after it go out with the
    // entry that was chosen, on the same chain, so it is one undo step.
    const chain = editor
      .chain()
      .focus()
      .deleteRange({ from: current.from, to: editor.state.selection.from });
    entry.run(chain).run();
    // Nothing closes the menu explicitly: it shuts because the `/` it was
    // reading has just been deleted.
  };

  // The handler is registered once and reads what it needs at the moment a key
  // arrives; re-registering per keystroke would race the plugin.
  const live = useRef({ items, active, choose });
  live.current = { items, active, choose };

  // The file picker outlives the menu that opened it — the menu is gone the
  // moment the `/image` is deleted, and the dialog is still on screen.
  useEffect(() => {
    if (!editor) return;
    chosenImage = (file) => {
      void storeImage(file)
        .then((stored) => editor.chain().focus().insertImage({ id: stored.id, alt: file.name }).run())
        .catch((error: unknown) => console.warn('Springboard could not read that image.', error));
    };
    return () => {
      chosenImage = null;
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    setSlashKeys((event) => {
      const { items: entries, active: at, choose: pick } = live.current;
      // Empty is also how a selection reaches this: that door renders nothing
      // here, so the arrows, Enter and Tab stay with the held text, where they
      // already mean replace, indent and collapse. Escape belongs to slash.ts,
      // which keeps it for all three doors.
      if (entries.length === 0) return false;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setIndex((n) => (Math.max(Math.min(n, entries.length - 1), 0) + 1) % entries.length);
          return true;
        case 'ArrowUp':
          event.preventDefault();
          setIndex(
            (n) => (Math.max(Math.min(n, entries.length - 1), 0) + entries.length - 1) % entries.length,
          );
          return true;
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          pick(entries[at] ?? entries[0]);
          return true;
        default:
          return false;
      }
    });
    return () => setSlashKeys(null);
  }, [editor]);

  // It drops below the caret, because below the caret is where the writing has
  // not happened yet — and goes above only when there is no room for it there.
  useLayoutEffect(() => {
    const node = panel.current;
    if (!editor || !menu || !node) return;
    const anchor = editor.view.coordsAtPos(menu.from);
    const { width, height } = node.getBoundingClientRect();
    const below = anchor.bottom + 6;
    const above = anchor.top - height - 6;
    const fitsAbove = above >= 8;
    const fitsBelow = below + height <= window.innerHeight - 8;
    const goAbove = !fitsBelow && fitsAbove;
    setSpot({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
      top: goAbove ? above : Math.max(8, Math.min(below, window.innerHeight - height - 8)),
    });
  }, [editor, menu, items.length, moved]);

  // The sheet scrolls under the menu, and the window can be resized with one
  // open. Capture, because the scroller is the editor host, not the window.
  useEffect(() => {
    if (!menu) return;
    const bump = () => setMoved((n) => n + 1);
    window.addEventListener('scroll', bump, true);
    window.addEventListener('resize', bump);
    return () => {
      window.removeEventListener('scroll', bump, true);
      window.removeEventListener('resize', bump);
    };
  }, [menu]);

  useEffect(() => {
    panel.current
      ?.querySelector<HTMLElement>('.slash-item.is-active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, items]);

  // No menu rather than an empty one: a `/` that matches nothing is a `/` that
  // was never a command.
  if (!editor || !menu || items.length === 0) return null;

  let group = '';

  return (
    <div
      className="slash"
      ref={panel}
      role="listbox"
      aria-label="Insert"
      style={{ left: spot.left, top: spot.top }}
      // The editor must not lose the caret to a menu about where the caret is.
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.map((entry, at) => {
        const heading = entry.group === group ? null : (group = entry.group);
        return (
          <div key={entry.id}>
            {heading && <p className="slash-group">{heading}</p>}
            <button
              type="button"
              role="option"
              aria-selected={at === active}
              className={`slash-item${at === active ? ' is-active' : ''}`}
              onMouseEnter={() => setIndex(at)}
              onClick={() => choose(entry)}
            >
              {/* One slot, whatever goes in it, so every label starts at the
                  same place whether it is preceded by an icon, a sticker or
                  nothing at all. */}
              <span className="slash-glyph" aria-hidden="true">
                {entry.glyphNode ?? (entry.thumb ? (
                  <img className="slash-thumb" src={entry.thumb} alt="" />
                ) : entry.glyph ? (
                  <entry.glyph size={17} />
                ) : null)}
              </span>
              <span className="slash-label">{entry.label}</span>
              {entry.note && <span className="slash-note">{entry.note}</span>}
              {entry.hint && <span className="menu-hint">{entry.hint}</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
