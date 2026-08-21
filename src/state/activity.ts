/**
 * The writing history, held once for the whole app.
 *
 * A year of days is a few hundred small rows, so it is read once and kept in
 * memory rather than fetched per chart — the compact strip on the welcome
 * screen and the full year in the panel are the same array, and an edit made
 * while both are open moves both.
 */

import { useEffect, useState } from 'react';

import { dayKey } from '../core/activity.ts';
import type { ActivityDay } from '../core/types.ts';
import { store } from '../data/index.ts';

/**
 * All of it, from the beginning.
 *
 * There was a window here — a year back — and it was quietly wrong: the month
 * picker offers every month since the first word was written, and a picker
 * whose older entries were all empty because the rows had never been read is
 * worse than one that does not go back at all. A day is four small numbers, so
 * ten years of them is a few hundred kilobytes and one read at launch.
 */
const SINCE_EVER = '0000-01-01';

let cache: ActivityDay[] = [];
let settled = false;
let reading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/** Reads the history once per launch; every later caller gets the same promise. */
function load(): Promise<void> {
  reading ??= (async () => {
    cache = await store.listActivity(SINCE_EVER);
    settled = true;
    announce();
  })();
  return reading;
}

/**
 * Records one edit against today.
 *
 * Called from the editor's save and nowhere else, which is the whole design:
 * importing a folder, planting a template and restoring an old version all go
 * through `saveContent` too, and none of them is a morning's writing. Putting
 * this in the store would have counted all three.
 *
 * Deliberately not awaited by its caller — a square on a chart must never be
 * in the way of the words reaching the disk — so it swallows its own failure.
 * The tally is the least important thing in the app; the save is the most.
 */
export async function noteWriting(words: number): Promise<void> {
  if (words <= 0) return;
  const at = Date.now();
  const day = dayKey(at);
  try {
    const row = await store.recordActivity({ day, words, at });
    // The array is replaced rather than mutated: React is watching it.
    const rest = cache.filter((entry) => entry.day !== day);
    cache = [...rest, row].sort((a, b) => a.day.localeCompare(b.day));
    announce();
  } catch {
    // A day that goes unrecorded is a lighter square, not a lost page.
  }
}

/** Every day the chart can see, oldest first. Empty until the first read lands. */
export function useActivity(): { days: ActivityDay[]; ready: boolean } {
  const [days, setDays] = useState(cache);
  // Already true on every mount after the first, so a chart opened later does
  // not flash its empty state at a history it is already holding.
  const [ready, setReady] = useState(settled);

  useEffect(() => {
    const refresh = () => setDays(cache);
    listeners.add(refresh);
    let cancelled = false;
    void load().then(() => {
      if (cancelled) return;
      setDays(cache);
      setReady(true);
    });
    return () => {
      cancelled = true;
      listeners.delete(refresh);
    };
  }, []);

  return { days, ready };
}
