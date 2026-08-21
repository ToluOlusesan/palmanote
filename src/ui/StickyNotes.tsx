import { ChatTeardropText, Plus, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { STICKY_COLOURS, type StickyColour, type StickyNote } from '../core/types.ts';
import type { Stickies } from '../state/stickies.ts';

/**
 * Thoughts stuck to the side of the page.
 *
 * A fixed rail down the right of the window, outside the scrolling paper — so
 * notes stay where they were put while the prose moves under them. The first
 * cut of this let them be dragged anywhere and it was wrong twice over: a
 * thought parked over the third paragraph is lost the moment the page is
 * edited above it, and a note that can be anywhere is a note you have to go
 * looking for.
 *
 * They are content rather than chrome, which is why they are allowed colour in
 * an app whose interface has exactly one. A sticky is an object the writer
 * made, like a highlight; the rule against a second hue is about the interface
 * having opinions, not about the page.
 */
export function StickyNotes({
  stickies,
  onGoToAnchor,
}: {
  stickies: Stickies;
  /**
   * Takes you to the words a comment is about. False when there is nothing
   * left to go to, which is how the rail learns a comment has been orphaned —
   * asked at the moment of the click rather than tracked, because the answer
   * changes with every keystroke and nothing should be watching the document
   * to keep a badge honest.
   */
  onGoToAnchor: (anchor: string) => boolean;
}) {
  if (stickies.notes.length === 0) return null;
  return (
    <aside className="stickies" aria-label="Notes and comments">
      <div className="stickies-rail">
        {stickies.notes.map((note) => (
          <Sticky key={note.id} note={note} stickies={stickies} onGoToAnchor={onGoToAnchor} />
        ))}
        <button
          type="button"
          className="stickies-add"
          title="New note — Ctrl+Space"
          aria-label="New sticky note"
          onClick={() => stickies.add()}
        >
          <Plus size={13} weight="bold" />
        </button>
      </div>
    </aside>
  );
}

function Sticky({
  note,
  stickies,
  onGoToAnchor,
}: {
  note: StickyNote;
  stickies: Stickies;
  onGoToAnchor: (anchor: string) => boolean;
}) {
  const text = useRef<HTMLTextAreaElement>(null);
  const [orphaned, setOrphaned] = useState(false);

  // A note grows to fit what is in it rather than scrolling: the whole point
  // is that you can see the thought without opening anything.
  useEffect(() => {
    const area = text.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }, [note.text]);

  // Freshly made notes are empty, and an empty note wants the caret.
  useEffect(() => {
    if (note.text === '' && Date.now() - note.createdAt < 1000) text.current?.focus();
    // Once, when it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
    Square to the grid, and no lean.

    A sub-degree tilt is what a real pad of these does and it looked right in a
    screenshot — but a rotated element is composited off the pixel grid, so
    every glyph inside it gets anti-aliased along the diagonal. Beside prose
    that is perfectly hinted, the note read as soft. The fold at the corner is
    what says "sticky note"; it does not need the lean as well.
  */
  return (
    <div
      className={`sticky is-${note.colour}${note.anchor ? ' is-comment' : ''}`}
      role="group"
      aria-label={note.anchor ? 'Comment' : 'Sticky note'}
    >
      {note.anchor && (
        <button
          type="button"
          className={`sticky-anchor${orphaned ? ' is-orphaned' : ''}`}
          title={orphaned ? 'The words this was about are gone' : 'Go to the words this is about'}
          onClick={() => setOrphaned(!onGoToAnchor(note.anchor!))}
        >
          <ChatTeardropText size={12} weight="fill" />
          {orphaned ? 'no longer in the page' : 'in the page'}
        </button>
      )}
      <textarea
        ref={text}
        className="sticky-text"
        value={note.text}
        rows={1}
        placeholder="…"
        aria-label={note.anchor ? 'Comment' : 'Sticky note'}
        spellCheck={false}
        onChange={(event) => stickies.patch(note.id, { text: event.target.value })}
        onKeyDown={(event) => {
          // Escape puts you back in the prose, which is where you were.
          if (event.key === 'Escape') {
            event.stopPropagation();
            event.preventDefault();
            (document.querySelector('.body') as HTMLElement | null)?.focus();
            return;
          }
          // An empty note is a note you did not want.
          if (event.key === 'Backspace' && note.text === '') {
            event.preventDefault();
            stickies.remove(note.id);
            (document.querySelector('.body') as HTMLElement | null)?.focus();
          }
        }}
      />

      <div className="sticky-foot">
        <div className="sticky-colours" role="group" aria-label="Note colour">
          {STICKY_COLOURS.map((colour) => (
            <button
              key={colour}
              type="button"
              className={`sticky-swatch is-${colour}${note.colour === colour ? ' is-on' : ''}`}
              aria-label={NAMES[colour]}
              aria-pressed={note.colour === colour}
              onClick={() => stickies.patch(note.id, { colour })}
            />
          ))}
        </div>
        <button
          type="button"
          className="sticky-remove"
          aria-label="Remove this note"
          onClick={() => stickies.remove(note.id)}
        >
          <X size={12} weight="bold" />
        </button>
      </div>

      {/* The peeled corner, drawn rather than shaded: two triangles, one the
          colour of what is behind the note and one the shadow the fold casts
          on itself. It is the whole reason a square of colour reads as a
          sticky note instead of as a card. */}
      <span className="sticky-fold" aria-hidden="true" />
    </div>
  );
}

const NAMES: Record<StickyColour, string> = {
  lime: 'Lime',
  orange: 'Orange',
  blue: 'Blue',
  pink: 'Pink',
};
