import {
  Highlighter,
  ListBullets,
  DotsThree,
  NoteBlank,
  ListChecks,
  ListNumbers,
  SquaresFour,
  TextB,
  TextHOne,
  TextHThree,
  TextHTwo,
  TextItalic,
  TextStrikethrough,
  type Icon,
} from '@phosphor-icons/react';
import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';

import { groupableImages } from '../editor/Gallery.ts';
import { activeHighlight, HIGHLIGHT_LABELS, HIGHLIGHT_TONES } from '../editor/Highlight.ts';

/**
 * Formatting, in the page bar.
 *
 * It shares a row with the breadcrumb rather than claiming one of its own, so
 * the writing surface loses no height to it. Every control here is also a
 * keyboard shortcut and, for the marks and lists, an input rule — this is the
 * discoverable copy, not the primary route.
 */
export interface RailControl {
  /** Shown in the tooltip, so a rail with notes still says how much is there. */
  count: number;
  /** Whether the rail is already occupying its column beside the page. */
  visible: boolean;
  /** Restores existing notes without making another one. */
  show: () => void;
  /** A page-level sticky: it opens the rail before putting a note in it. */
  add: () => void;
}

export function Toolbar({ editor, rail }: { editor: Editor | null; rail?: RailControl }) {
  // Marks toggle per keystroke, so the row has to re-render on every
  // transaction to keep its pressed states honest.
  const [, bump] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editor) return;
    const refresh = () => bump((n) => n + 1);
    editor.on('transaction', refresh);
    return () => {
      editor.off('transaction', refresh);
    };
  }, [editor]);

  useEffect(() => {
    if (!moreOpen) return;
    const dismiss = (event: MouseEvent) => {
      if (!more.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('keydown', escape);
    };
  }, [moreOpen]);

  if (!editor) return null;

  const grouping = groupableImages(editor.state);

  const button = (
    label: string,
    hint: string,
    active: boolean,
    Glyph: Icon,
    run: () => void,
  ) => (
    <button
      key={label}
      type="button"
      className={`tool${active ? ' is-active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={`${label} — ${hint}`}
      // Keep the selection: the editor must not lose focus to a toolbar.
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      <Glyph size={17} weight={active ? 'bold' : 'regular'} />
    </button>
  );

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {button('Bold', 'Ctrl+B', editor.isActive('bold'), TextB, () =>
        editor.chain().focus().toggleBold().run(),
      )}
      {button('Italic', 'Ctrl+I', editor.isActive('italic'), TextItalic, () =>
        editor.chain().focus().toggleItalic().run(),
      )}
      {button(
        'Strikethrough',
        'Ctrl+Shift+X',
        editor.isActive('strike'),
        TextStrikethrough,
        () => editor.chain().focus().toggleStrike().run(),
      )}

      <HighlightControl editor={editor} />

      <span className="tool-sep" />

      <div className="toolbar-more" ref={more}>
        <button
          type="button"
          className={`tool${moreOpen ? ' is-active' : ''}`}
          aria-label="More block styles"
          aria-expanded={moreOpen}
          title="More block styles"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <DotsThree size={18} weight="bold" />
        </button>
        {moreOpen && (
          <div className="toolbar-menu" role="menu" aria-label="Block styles">
            <ToolbarMenuItem icon={TextHOne} label="Heading" hint="Ctrl+Alt+1" onSelect={() => { editor.chain().focus().toggleHeading({ level: 1 }).run(); setMoreOpen(false); }} />
            <ToolbarMenuItem icon={TextHTwo} label="Subheading" hint="Ctrl+Alt+2" onSelect={() => { editor.chain().focus().toggleHeading({ level: 2 }).run(); setMoreOpen(false); }} />
            <ToolbarMenuItem icon={TextHThree} label="Small heading" hint="Ctrl+Alt+3" onSelect={() => { editor.chain().focus().toggleHeading({ level: 3 }).run(); setMoreOpen(false); }} />
            <span className="toolbar-menu-sep" />
            <ToolbarMenuItem icon={ListBullets} label="Bullet list" hint="-" onSelect={() => { editor.chain().focus().toggleBulletList().run(); setMoreOpen(false); }} />
            <ToolbarMenuItem icon={ListNumbers} label="Numbered list" hint="1." onSelect={() => { editor.chain().focus().toggleOrderedList().run(); setMoreOpen(false); }} />
            <ToolbarMenuItem icon={ListChecks} label="Task list" hint="[]" onSelect={() => { editor.chain().focus().toggleTaskList().run(); setMoreOpen(false); }} />
          </div>
        )}
      </div>

      {/* A new sticky, at the end of the row.
          It sat in the window's top bar beside settings and the theme, which
          is where the *window's* switches live — and this is not one of those.
          It belongs with bold and the headings: it is about the page you are
          looking at, and the notes are things you made in it. */}
      {rail && (
        <>
          <span className="tool-sep" />
          <button
            type="button"
            className="tool"
            aria-label={rail.count > 0 && !rail.visible ? 'Show notes' : 'New sticky note'}
            title={rail.count > 0 && !rail.visible
              ? `Show ${rail.count} note${rail.count === 1 ? '' : 's'} — Ctrl+Shift+Space`
              : `New sticky note${rail.count > 0 ? ` (${rail.count} on this page)` : ''} — Ctrl+Space`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => (rail.count > 0 && !rail.visible ? rail.show() : rail.add())}
          >
            <NoteBlank size={17} />
          </button>
        </>
      )}

      {/* Only when the selection is images and nothing else. A control that is
          there but refuses is worse than one that appears when it applies —
          and this is the only thing in the row that acts on whole blocks. */}
      {grouping >= 2 && (
        <>
          <span className="tool-sep" />
          {button(
            `Group ${grouping} images`,
            'into a gallery',
            false,
            SquaresFour,
            () => editor.chain().focus().groupImagesIntoGallery().run(),
          )}
        </>
      )}
    </div>
  );
}

function ToolbarMenuItem({ icon: Glyph, label, hint, onSelect }: { icon: Icon; label: string; hint: string; onSelect: () => void }) {
  return (
    <button type="button" role="menuitem" className="toolbar-menu-item" onMouseDown={(event) => event.preventDefault()} onClick={onSelect}>
      <Glyph size={16} />
      <span>{label}</span>
      <kbd>{hint}</kbd>
    </button>
  );
}

/**
 * One button that opens four. Not a colour picker — the four are fixed — but
 * they are named for the colour they are, because that is the one label a
 * writer does not have to be taught. See Highlight.ts.
 */
function HighlightControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  // Read off the mark rather than asked four times, so a page written before
  // the rename still lights the colour it is drawn in.
  const active = activeHighlight(editor);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="tool-group" ref={wrapper}>
      <button
        type="button"
        className={`tool${active ? ' is-active' : ''}`}
        aria-label="Highlight"
        aria-expanded={open}
        aria-pressed={Boolean(active)}
        title="Highlight"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        <Highlighter size={17} weight={active ? 'bold' : 'regular'} />
      </button>

      {open && (
        <div className="tones" role="menu" aria-label="Highlight">
          {HIGHLIGHT_TONES.map((tone) => (
            <button
              key={tone}
              type="button"
              role="menuitemradio"
              aria-checked={active === tone}
              className={`tone tone-${tone}${active === tone ? ' is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                editor.chain().focus().toggleHighlight(tone).run();
                setOpen(false);
              }}
            >
              <span className="tone-swatch" aria-hidden="true" />
              {HIGHLIGHT_LABELS[tone]}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="tone is-clear"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              editor.chain().focus().clearHighlight().run();
              setOpen(false);
            }}
          >
            None
          </button>
        </div>
      )}
    </div>
  );
}
