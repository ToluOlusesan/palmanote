/**
 * One window at a time, in a browser.
 *
 * The desktop app is a single window over a single SQLite file. A browser tab
 * is not: nothing stops someone opening PalmaNote twice, and each tab holds
 * the whole library in memory and autosaves it back. Two tabs on one page mean
 * the second write wins — silently, with no conflict to notice and nothing in
 * the history to recover, because the losing tab never knew it lost.
 *
 * A Web Lock is the smallest true answer. The first tab takes it and holds it
 * for as long as its document lives; a later tab finds it taken and says so
 * instead of quietly racing. The browser releases a lock when the document is
 * destroyed, so closing the first tab frees the second on its own — no
 * heartbeat to leave running and no timeout to guess at.
 *
 * The second tab does not become the writer the moment the lock frees, even
 * though it could. Its copy of the library is whatever it read at boot, which
 * is now older than what the other tab spent the last hour writing. So it asks
 * to be reloaded, which is the one action that makes it correct.
 */

import { useSyncExternalStore } from 'react';

import { isDesktop } from '../data/bridge.ts';

export type TabClaim =
  /** Still asking. Nothing has touched storage yet. */
  | 'claiming'
  /** This tab owns the library. The only state in which the app is mounted. */
  | 'sole'
  /** Another tab owns it. */
  | 'duplicate'
  /** It owned it, then let go — this tab can have it, one reload from now. */
  | 'released';

const LOCK = 'palmanote-library';

let claim: TabClaim = 'claiming';
const listeners = new Set<() => void>();

function set(next: TabClaim): void {
  if (next === claim) return;
  claim = next;
  for (const listener of listeners) listener();
}

let started = false;

function start(): void {
  if (started) return;
  started = true;

  // The desktop shell is one window over one database, and the question does
  // not arise. Answered synchronously so the shipped build never waits.
  if (isDesktop || typeof navigator === 'undefined' || !navigator.locks) {
    // A browser too old for Web Locks is better served by opening than by
    // refusing: the race is a risk, and locking someone out of their own
    // library over a risk is worse than the risk.
    set('sole');
    return;
  }

  void navigator.locks
    .request(LOCK, { ifAvailable: true }, (lock) => {
      if (lock) {
        set('sole');
        // Never resolves: the lock is held for the life of this document.
        return new Promise<never>(() => {});
      }

      set('duplicate');
      // Queue behind whoever has it, purely to be told when they go.
      void navigator.locks.request(LOCK, () => {
        set('released');
      });
      return undefined;
    })
    .catch(() => {
      // A lock manager that throws is not a reason to withhold someone's
      // pages from them.
      set('sole');
    });
}

/**
 * Claimed once per document rather than once per mount — under StrictMode an
 * effect runs twice, and the second run would find the lock held by this very
 * tab and conclude it was a duplicate of itself.
 */
export function useTabClaim(): TabClaim {
  start();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => claim,
    () => 'sole' as const,
  );
}
