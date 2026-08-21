import {
  CaretDown,
  ChatTeardropText,
  Code,
  Highlighter,
  ListBullets,
  ListChecks,
  ListNumbers,
  TextB,
  TextItalic,
  TextStrikethrough,
  type Icon,
} from '@phosphor-icons/react';
import type { ChainedCommands, Editor } from '@tiptap/react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { BLOCK_TYPES } from '../editor/blockTypes.ts';
import { activeHighlight, HIGHLIGHT_LABELS, HIGHLIGHT_TONES } from '../editor/Highlight.ts';
import { insertMenu } from '../editor/slash.ts';

/** The gap between the words and the bar that acts on them. */
const CLEARANCE = 10;

/**
 * Long enough to read as leaving, short enough never to be in the way. It has
 * to outlast the exit in the stylesheet, or the bar is unmounted mid-animation.
 */
const CLOSE_MS = 130;

interface Held {
  from: number;
  to: number;
}

interface Spot {
  left: number;
  top: number;
  above: boolean;
}

/**
 * The block types the dropdown offers, from the shared vocabulary in
 * [blockTypes.ts](../editor/blockTypes.ts).
 *
 * The three list types are filtered out because the bar already carries them as
 * buttons of their own a few controls to the right, and a control that appears
 * twice in one row is a row you have to read twice. The menu the drag handle
 * opens has no such buttons and offers all nine.
 */
const STYLES = BLOCK_TYPES.filter((type) => !type.isList);

/**
 * The bar that meets a selection.
 *
 * It reads the same plugin the `/` menu does — [slash.ts](../editor/slash.ts)
 * owns the hard part, which is deciding that a selection is finished, is words
 * rather than a picture, and has not been waved away with Escape. This file is
 * only what that decision looks like.
 *
 * It arrives assembled rather than all at once: the surface settles first and
 * the controls follow it in, a couple of frames apart each. That ordering is
 * the whole trick — a panel that fades in as one flat rectangle reads as a
 * thing that was already there and is now visible, while one whose parts land
 * in sequence reads as a thing that came to you.
 */
export function SelectionBar({
  editor,
  onComment,
}: {
  editor: Editor | null;
  /**
   * A comment on the held words.
   *
   * It belongs in this bar and not in the `/` menu for the reason the bar
   * exists at all: it is something done *to* words that are already there,
   * rather than something put down where the caret is. It also does not eat
   * the selection the way a sticker or a picture would — it marks it and
   * leaves it exactly where it was, which is the rule that keeps images and
   * stickers out of here.
   */
  onComment: (editor: Editor) => void;
}) {
  // What the editor says right now, and what is on screen. They differ for one
  // beat: when a selection is dropped, the bar stays to animate itself out.
  const [live, setLive] = useState<Held | null>(null);
  const [shown, setShown] = useState<Held | null>(null);
  const [open, setOpen] = useState<'style' | 'tone' | null>(null);
  const [spot, setSpot] = useState<Spot>({ left: 0, top: 0, above: true });
  // Anything that moves the words under a bar that is already up.
  const [moved, setMoved] = useState(0);
  // Marks toggle under a selection that has not moved, so the pressed states
  // have to follow the document rather than the range.
  const [, bump] = useState(0);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      const menu = insertMenu(editor.state);
      const next = menu?.kind === 'selection' ? { from: menu.from, to: menu.to } : null;
      // A new object per transaction would re-place the bar on every keystroke
      // whether or not the words under it had moved.
      setLive((current) => {
        if (next === null || current === null) return next === current ? current : next;
        return current.from === next.from && current.to === next.to ? current : next;
      });
      if (next) bump((n) => n + 1);
    };
    refresh();
    editor.on('transaction', refresh);
    return () => {
      editor.off('transaction', refresh);
    };
  }, [editor]);

  // The one place the two diverge. A bar that vanished on mouseup would be a
  // flicker; this lets the exit be as deliberate as the entrance.
  useEffect(() => {
    if (live) {
      setShown(live);
      return;
    }
    if (!shown) return;
    const timer = window.setTimeout(() => setShown(null), CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [live, shown]);

  // A dropdown belongs to the selection that opened it.
  useEffect(() => {
    setOpen(null);
  }, [live]);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!bar.current?.contains(event.target as Node)) setOpen(null);
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);

  /*
    Above the words, or below them when there is no room above.

    Never over them: the selection is the reason the bar is open, and covering
    the thing it acts on is the one place it must not be. The horizontal
    centre comes from the selection itself on a single line, and from the
    column when it spans several — a bar centred on the tail of a
    four-line selection points at nothing in particular.
  */
  useLayoutEffect(() => {
    const node = bar.current;
    if (!editor || !shown || !node) return;
    try {
      const start = editor.view.coordsAtPos(shown.from);
      const end = editor.view.coordsAtPos(shown.to);
      const box = node.getBoundingClientRect();
      const host = editor.view.dom.getBoundingClientRect();
      const oneLine = Math.abs(start.top - end.top) < 4;
      const centre = oneLine ? (start.left + end.left) / 2 : (host.left + host.right) / 2;
      const above = Math.min(start.top, end.top) - box.height - CLEARANCE;
      const below = Math.max(start.bottom, end.bottom) + CLEARANCE;
      const goAbove = above >= 8;
      setSpot({
        left: Math.max(8, Math.min(centre - box.width / 2, window.innerWidth - box.width - 8)),
        top: goAbove ? above : Math.min(below, window.innerHeight - box.height - 8),
        above: goAbove,
      });
    } catch {
      // The document moved out from under a range we were still holding —
      // which only happens on the way out, where the last spot is the right
      // one anyway.
    }
  }, [editor, shown, moved]);

  // The sheet scrolls under the bar, and the window can be resized with one up.
  // Capture, because the scroller is the editor host rather than the window.
  useEffect(() => {
    if (!shown) return;
    const nudge = () => setMoved((n) => n + 1);
    window.addEventListener('scroll', nudge, true);
    window.addEventListener('resize', nudge);
    return () => {
      window.removeEventListener('scroll', nudge, true);
      window.removeEventListener('resize', nudge);
    };
  }, [shown]);

  if (!editor || !shown) return null;

  const chain = () => editor.chain().focus();
  const tone = activeHighlight(editor);
  const style = STYLES.find((entry) => entry.is(editor)) ?? STYLES[0]!;

  // Every control takes its turn from where it sits in the row, counted as the
  // row is written. Separators take one too: the gap between two groups is
  // part of the shape arriving, not a thing that should snap into place ahead
  // of it.
  let order = 0;
  const turn = () => ({ '--turn': order++ }) as CSSProperties;

  const button = (
    label: string,
    hint: string,
    active: boolean,
    Glyph: Icon,
    act: (chain: ChainedCommands) => ChainedCommands,
  ) => (
    <button
      key={label}
      type="button"
      className={`bubble-btn${active ? ' is-active' : ''}`}
      style={turn()}
      aria-label={label}
      aria-pressed={active}
      title={`${label} — ${hint}`}
      onClick={() => act(chain()).run()}
    >
      <Glyph size={16} weight={active ? 'bold' : 'regular'} />
    </button>
  );

  const separator = (key: string) => <span key={key} className="bubble-sep" style={turn()} />;

  return (
    <div
      className={`bubble${live ? '' : ' is-closing'}`}
      ref={bar}
      role="toolbar"
      aria-label="Formatting"
      data-placement={spot.above ? 'above' : 'below'}
      style={{ left: spot.left, top: spot.top }}
      // The editor must not lose the selection to the bar that acts on it.
      onMouseDown={(event) => event.preventDefault()}
    >
      <Dropdown
        className="bubble-style"
        label={style.label}
        title="Turn into"
        turn={turn()}
        open={open === 'style'}
        onToggle={() => setOpen((current) => (current === 'style' ? null : 'style'))}
      >
        {STYLES.map((entry, at) => (
          <button
            key={entry.id}
            type="button"
            role="menuitemradio"
            aria-checked={entry.id === style.id}
            className={`bubble-item${entry.id === style.id ? ' is-active' : ''}`}
            style={{ '--turn': at } as CSSProperties}
            onClick={() => {
              entry.run(chain()).run();
              setOpen(null);
            }}
          >
            <entry.glyph size={16} />
            <span className="bubble-item-label">{entry.label}</span>
            {entry.hint && <span className="menu-hint">{entry.hint}</span>}
          </button>
        ))}
      </Dropdown>

      {separator('marks')}

      {button('Bold', 'Ctrl+B', editor.isActive('bold'), TextB, (c) => c.toggleBold())}
      {button('Italic', 'Ctrl+I', editor.isActive('italic'), TextItalic, (c) => c.toggleItalic())}
      {button('Strikethrough', 'Ctrl+Shift+X', editor.isActive('strike'), TextStrikethrough, (c) =>
        c.toggleStrike(),
      )}
      {button('Code', 'Ctrl+E', editor.isActive('code'), Code, (c) => c.toggleCode())}

      {separator('comment')}

      {/* Not a mark the writer toggles, so it is written by hand rather than
          through `button` above: it has no pressed state to show and its work
          is done outside the editor, in the rail. */}
      <button
        type="button"
        className="bubble-btn"
        style={turn()}
        aria-label="Comment"
        title="Comment — Ctrl+Alt+M"
        onClick={() => onComment(editor)}
      >
        <ChatTeardropText size={16} />
      </button>

      {separator('lists')}

      {button('Bullet list', '- ', editor.isActive('bulletList'), ListBullets, (c) =>
        c.toggleBulletList(),
      )}
      {button('Numbered list', '1. ', editor.isActive('orderedList'), ListNumbers, (c) =>
        c.toggleOrderedList(),
      )}
      {button('Task list', '[] ', editor.isActive('taskList'), ListChecks, (c) => c.toggleTaskList())}

      {separator('highlight')}

      <Dropdown
        className={`bubble-tone${tone ? ` is-on tone-${tone}` : ''}`}
        label={
          // The pen carries the colour it is holding underneath it, the way a
          // real one shows through its barrel. It is the only control in the
          // row whose state is a colour rather than on or off.
          <span className="bubble-pen">
            <Highlighter size={16} weight={tone ? 'bold' : 'regular'} />
            <span className="bubble-tone-bar" aria-hidden="true" />
          </span>
        }
        title="Highlight"
        turn={turn()}
        open={open === 'tone'}
        onToggle={() => setOpen((current) => (current === 'tone' ? null : 'tone'))}
      >
        {HIGHLIGHT_TONES.map((colour, at) => (
          <button
            key={colour}
            type="button"
            role="menuitemradio"
            aria-checked={tone === colour}
            className={`bubble-item tone-${colour}${tone === colour ? ' is-active' : ''}`}
            style={{ '--turn': at } as CSSProperties}
            onClick={() => {
              chain().toggleHighlight(colour).run();
              setOpen(null);
            }}
          >
            <span className="tone-swatch" aria-hidden="true" />
            <span className="bubble-item-label">{HIGHLIGHT_LABELS[colour]}</span>
          </button>
        ))}
        <button
          type="button"
          role="menuitem"
          className="bubble-item is-clear"
          style={{ '--turn': HIGHLIGHT_TONES.length } as CSSProperties}
          onClick={() => {
            chain().clearHighlight().run();
            setOpen(null);
          }}
        >
          <span className="bubble-item-label">None</span>
        </button>
      </Dropdown>
    </div>
  );
}

/**
 * A control in the row that opens a short list under itself.
 *
 * The list staggers the way the row does, one beat per entry, so a menu opened
 * from the bar behaves like the bar it came from.
 */
function Dropdown({
  className,
  label,
  title,
  turn,
  open,
  onToggle,
  children,
}: {
  className: string;
  label: ReactNode;
  title: string;
  turn: CSSProperties;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="bubble-group" style={turn}>
      <button
        type="button"
        className={`bubble-btn ${className}${open ? ' is-open' : ''}`}
        aria-label={title}
        aria-expanded={open}
        title={title}
        onClick={onToggle}
      >
        {label}
        <CaretDown className="bubble-caret" size={11} weight="bold" />
      </button>
      {open && (
        <div className="bubble-menu" role="menu" aria-label={title}>
          {children}
        </div>
      )}
    </div>
  );
}
