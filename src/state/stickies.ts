/**
 * The sticky notes on the page that is open.
 *
 * One page's worth at a time, unlike the writing chart's history: notes belong
 * to a page and there is no view that wants all of them at once, so they are
 * read when a page opens and dropped when it closes.
 *
 * Writes are debounced but never lost. Typing in a note changes the copy in
 * memory immediately — that is what the textarea is bound to — and the write
 * follows once the typing stops, the same deal the prose gets.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { STICKY_COLOURS, type StickyColour, type StickyNote } from '../core/types.ts';
import { store } from '../data/index.ts';

/** Long enough that a sentence is one write, short enough to survive a close. */
const SETTLE_MS = 400;


export interface Stickies {
  notes: StickyNote[];
  /**
   * Adds one to the rail and returns it, so the caller can focus it.
   *
   * With an `anchor` it is a comment — the id of the mark in the prose it is
   * about. Without one it is a sticky, attached to the page and to nothing in
   * it. Everything after this point treats them identically, which is the
   * point of them being one thing.
   */
  add: (anchor?: string | null) => StickyNote | null;
  patch: (id: string, change: Partial<Pick<StickyNote, 'text' | 'colour'>>) => void;
  remove: (id: string) => void;
}

export function useStickies(documentId: string | null): Stickies {
  const [notes, setNotes] = useState<StickyNote[]>([]);
  // The writes still owed, by id. A note edited and then deleted before its
  // timer fires must not be written back after it is gone, which is why this
  // is a map of timers rather than one timer with the last change on it.
  const timers = useRef(new Map<string, number>());
  const latest = useRef(new Map<string, StickyNote>());

  useEffect(() => {
    let cancelled = false;
    setNotes([]);
    if (!documentId) return;
    void store.listStickies(documentId).then((rows) => {
      if (!cancelled) setNotes(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // Anything still owed goes out when the page changes or the window closes.
  const flush = useCallback(() => {
    for (const [id, timer] of timers.current) {
      clearTimeout(timer);
      const note = latest.current.get(id);
      if (note) void store.putSticky(note).catch(() => {});
    }
    timers.current.clear();
    latest.current.clear();
  }, []);

  useEffect(() => {
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [documentId, flush]);

  const schedule = useCallback((note: StickyNote) => {
    latest.current.set(note.id, note);
    const running = timers.current.get(note.id);
    if (running !== undefined) clearTimeout(running);
    timers.current.set(
      note.id,
      window.setTimeout(() => {
        timers.current.delete(note.id);
        const pending = latest.current.get(note.id);
        latest.current.delete(note.id);
        if (pending) void store.putSticky(pending).catch(() => {});
      }, SETTLE_MS),
    );
  }, []);

  const add = useCallback((anchor: string | null = null): StickyNote | null => {
      if (!documentId) return null;
      const now = Date.now();
      const note: StickyNote = {
        id: crypto.randomUUID(),
        documentId,
        text: '',
        anchor,
        // Cycled rather than random, so a page of them comes out looking like
        // a set instead of a bag of sweets.
        colour: STICKY_COLOURS[notes.length % STICKY_COLOURS.length] as StickyColour,
        createdAt: now,
        updatedAt: now,
      };
      setNotes((current) => [...current, note]);
      // Written immediately rather than debounced: an empty note is still a
      // note, and one that vanished because the app closed in the four hundred
      // milliseconds after it appeared would be a bug nobody could reproduce.
      void store.putSticky(note).catch(() => {});
      return note;
    },
    [documentId, notes],
  );

  const patch = useCallback(
    (id: string, change: Partial<Pick<StickyNote, 'text' | 'colour'>>) => {
      setNotes((current) =>
        current.map((note) => {
          if (note.id !== id) return note;
          const next = { ...note, ...change, updatedAt: Date.now() };
          schedule(next);
          return next;
        }),
      );
    },
    [schedule],
  );

  const remove = useCallback((id: string) => {
    const running = timers.current.get(id);
    if (running !== undefined) clearTimeout(running);
    timers.current.delete(id);
    latest.current.delete(id);
    setNotes((current) => current.filter((note) => note.id !== id));
    void store.deleteSticky(id).catch(() => {});
  }, []);

  return { notes, add, patch, remove };
}


