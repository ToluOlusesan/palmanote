import { DOMSerializer } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';

import type { PMDoc, RevisionRecord } from '../core/types.ts';
import { store } from '../data/index.ts';
import { resolveAssetImages } from '../editor/assets.ts';
import { formatCount } from './TreePane.tsx';

/**
 * Recent things get told in how long ago they were, older things in when they
 * happened. Nobody reads "417 hours ago"; nobody wants a date on something
 * from four minutes back.
 */
function when(stamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - stamp) / 1000));
  if (seconds < 60) return 'Moments ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(stamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const exactly = (stamp: number) => new Date(stamp).toLocaleString();

/**
 * Every saved state of one page.
 *
 * The history itself is not new — `revisions` has been filling up since the
 * schema was written, append-only, coalesced to one entry per two minutes of
 * writing and pruned to hourly for a week and daily beyond. This is the
 * window onto it, and it is per page on purpose: a writer looking for a
 * paragraph they cut knows which chapter they cut it from, and a library-wide
 * timeline would bury that under every other page they touched that morning.
 *
 * Versions are rendered, not diffed. A word-level diff of prose is a wall of
 * red and green that reads worse than either side of it — what you actually
 * want to know is "was that paragraph still here on Tuesday", which is a
 * question you answer by reading Tuesday.
 */
export function HistoryDialog({
  documentId,
  title,
  editor,
  onRestore,
  onClose,
}: {
  documentId: string;
  title: string;
  editor: Editor;
  onRestore: (content: PMDoc) => Promise<void>;
  onClose: () => void;
}) {
  const [revisions, setRevisions] = useState<RevisionRecord[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  // Fixed at open, so the list does not quietly re-word itself while it is read.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await store.listRevisions(documentId);
      if (cancelled) return;
      setRevisions(rows);
      setChosen(rows[0]?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const selected = revisions?.find((revision) => revision.id === chosen) ?? null;

  // Rendered through the editor's own schema and serializer, so a version
  // looks exactly like the page it came from — same marks, same scene breaks,
  // same sticker art — without a second renderer to keep in step with the
  // first.
  useEffect(() => {
    const host = preview.current;
    if (!host) return;
    host.replaceChildren();
    if (!selected?.content) return;
    try {
      const node = editor.schema.nodeFromJSON(selected.content);
      host.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(node.content));
      // `renderHTML` is synchronous and reading an image out of the library is
      // not, so a version's pictures arrive a frame after its words.
      resolveAssetImages(host);
    } catch {
      host.textContent = 'This version cannot be read.';
    }
    host.scrollTop = 0;
  }, [editor, selected]);

  const restore = async () => {
    if (!selected?.content || busy) return;
    setBusy(true);
    try {
      await onRestore(selected.content);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="dialog is-wide"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`History of ${title || 'Untitled'}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">History — {title || 'Untitled'}</h2>

        {revisions === null ? (
          <p className="dialog-body">Reading the history…</p>
        ) : revisions.length === 0 ? (
          <p className="dialog-body">
            Nothing yet. A version is kept every couple of minutes while you write, so this
            fills up on its own — there is nothing to remember to press.
          </p>
        ) : (
          <div className="history">
            <div className="history-list" role="listbox" aria-label="Versions">
              {revisions.map((revision, index) => {
                // Against the one before it in time, which is the next one
                // down the list — they arrive newest first.
                const older = revisions[index + 1];
                const delta = older ? revision.wordCount - older.wordCount : null;
                return (
                  <button
                    key={revision.id}
                    type="button"
                    role="option"
                    aria-selected={revision.id === chosen}
                    title={exactly(revision.createdAt)}
                    className={`history-entry${revision.id === chosen ? ' is-active' : ''}`}
                    onClick={() => setChosen(revision.id)}
                  >
                    <span className="history-when">{when(revision.createdAt, now)}</span>
                    <span className="history-count">
                      {formatCount(revision.wordCount)} words
                      {delta !== null && delta !== 0 && (
                        <span className={`history-delta${delta > 0 ? ' is-up' : ''}`}>
                          {delta > 0 ? '+' : '−'}
                          {formatCount(Math.abs(delta))}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="history-preview">
              <div className="body is-preview" ref={preview} />
            </div>
          </div>
        )}

        <div className="dialog-foot">
          <span className="dialog-note">
            {selected
              ? 'Restoring keeps where you are now as its own version.'
              : 'Versions are kept as you write.'}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn is-primary"
            disabled={!selected?.content || busy}
            onClick={() => void restore()}
          >
            {busy ? 'Restoring' : 'Restore this version'}
          </button>
        </div>
      </div>
    </div>
  );
}
