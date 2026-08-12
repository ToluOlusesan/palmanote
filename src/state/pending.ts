/**
 * Last-resort crash cushion.
 *
 * IndexedDB writes started inside `beforeunload` are not guaranteed to finish.
 * localStorage writes are synchronous and do. So on unload we stash whatever
 * has not reached the database yet, and replay it on the next launch. This is
 * the web stand-in for the durability the Electron build gets from a
 * synchronous better-sqlite3 write on window close.
 */

import { wordCountOf } from '../core/pmText.ts';
import type { PMDoc } from '../core/types.ts';
import { store } from '../data/index.ts';

const PENDING_KEY = 'springboard:pending';

interface PendingWrite {
  id: string;
  content: PMDoc;
  at: number;
}

export function stashPending(id: string, content: PMDoc): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ id, content, at: Date.now() } satisfies PendingWrite));
  } catch {
    // A full quota is not a reason to break the unload.
  }
}

export function clearPending(): void {
  localStorage.removeItem(PENDING_KEY);
}

/** Replays a stashed write if it is newer than what the database holds. */
export async function recoverPending(): Promise<void> {
  const raw = localStorage.getItem(PENDING_KEY);
  if (!raw) return;
  clearPending();
  let pending: PendingWrite;
  try {
    pending = JSON.parse(raw) as PendingWrite;
  } catch {
    return;
  }
  const existing = await store.getDocument(pending.id);
  if (!existing || existing.updatedAt >= pending.at) return;
  await store.saveContent({
    id: pending.id,
    content: pending.content,
    wordCount: wordCountOf(pending.content),
    snapshot: true,
  });
}
