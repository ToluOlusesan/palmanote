import { MagnifyingGlass } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { searchPages, type PageMatch } from '../core/search.ts';
import { useLibrary } from '../state/library.tsx';
import { useTabs } from '../state/tabs.tsx';
import { DocumentIcon } from './IconPicker.tsx';

const LIMIT = 8;

/**
 * One box, one keystroke, anywhere.
 *
 * The sidebar is where things live and the tab strip is what is open; both are
 * surfaces that cost screen whether or not you need them. This one costs
 * nothing until `Ctrl+K`, and it is what makes collapsing the sidebar a real
 * option rather than a way to lose your work.
 *
 * The matching is [searchPages](../core/search.ts) unchanged — the same four
 * tiers, the same recency tiebreak, the same breadcrumb trail that tells three
 * pages called "Notes" apart. It was already written and reachable only from
 * `@` inside the prose. An empty query returns the pages you were last in,
 * which is the recents list, placed behind a key rather than pinned to a
 * screen next to two other lists of the same pages.
 */
export function Palette({ onClose }: { onClose: () => void }) {
  const { docs, byId, archived } = useLibrary();
  const tabs = useTabs();
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Archived pages are not somewhere you can be taken by a search: they are
  // out of the tree, and landing in one would strand you outside it.
  const reachable = useMemo(() => {
    const gone = new Set(archived.map((doc) => doc.id));
    return docs.filter((doc) => !gone.has(doc.id) && doc.archivedAt === null);
  }, [docs, archived]);

  const matches: PageMatch[] = useMemo(
    () => searchPages(reachable, byId, query, { limit: LIMIT }),
    [reachable, byId, query],
  );

  // Typing moves the target under the selection; the highlight goes back to
  // the top rather than staying on whichever row happens to be third now.
  useEffect(() => {
    setAt(0);
  }, [query]);

  useLayoutEffect(() => {
    list.current?.children[at]?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const choose = (match: PageMatch | undefined) => {
    if (!match) return;
    // Permanent, not preview: you named this page and went to it, which is the
    // definition of not just browsing.
    tabs.open(match.doc.id, 'permanent');
    onClose();
  };

  return (
    <div
      className="palette-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Go to page">
        <div className="palette-field">
          <MagnifyingGlass size={17} className="palette-glass" />
          <input
            ref={input}
            type="text"
            className="palette-input"
            placeholder="Go to page"
            aria-label="Go to page"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setAt((current) => Math.min(current + 1, matches.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setAt((current) => Math.max(current - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(matches[at]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
          />
        </div>

        {matches.length === 0 ? (
          <p className="palette-empty">No page by that name.</p>
        ) : (
          <ul className="palette-list" ref={list} role="listbox" aria-label="Pages">
            {matches.map((match, index) => (
              <li key={match.doc.id} role="option" aria-selected={index === at}>
                <button
                  type="button"
                  className={`palette-row${index === at ? ' is-at' : ''}`}
                  // Mouse down rather than click: the input keeps focus, so a
                  // click never has to fight the blur it causes.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(match);
                  }}
                  onMouseEnter={() => setAt(index)}
                >
                  <DocumentIcon icon={match.doc.icon} kind={match.doc.kind} size={15} />
                  <span className="palette-title">{match.doc.title || 'Untitled'}</span>
                  {match.trail.length > 0 && (
                    <span className="palette-trail">{match.trail.join(' / ')}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
