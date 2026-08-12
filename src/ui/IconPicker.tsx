import { BookOpen, FolderSimple, Note, TextAlignLeft, type Icon } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { DocumentKind } from '../core/types.ts';
import { EMOJI_GROUPS, searchEmoji } from './emoji.ts';

/**
 * A document with no icon still needs to look deliberate rather than empty,
 * so a faint glyph derived from its kind stands in. These are the only icons
 * in the tree; everything else there is text and indentation.
 */
const KIND_GLYPHS: Record<DocumentKind, Icon> = {
  folder: FolderSimple,
  chapter: BookOpen,
  scene: TextAlignLeft,
  note: Note,
};

export function DocumentIcon({
  icon,
  kind,
  size = 16,
}: {
  icon: string | null;
  kind: DocumentKind;
  size?: number;
}) {
  if (icon) {
    return (
      <span className="doc-icon" style={{ fontSize: size }} aria-hidden="true">
        {icon}
      </span>
    );
  }
  const Glyph = KIND_GLYPHS[kind] ?? Note;
  return <Glyph className="doc-icon is-placeholder" size={size} aria-hidden="true" />;
}

/**
 * The picker. Curated rather than complete — see emoji.ts for why — with a
 * search box that matches the words a writer would actually type.
 */
export function IconPicker({
  x,
  y,
  current,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  current: string | null;
  onPick: (icon: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: y + height > window.innerHeight - 8 ? Math.max(8, y - height - 24) : y,
    });
    node.querySelector<HTMLInputElement>('input')?.focus();
  }, [x, y]);

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

  const results = searchEmoji(query);
  const searching = query.trim().length > 0;

  return (
    <div className="menu-scrim" onMouseDown={onClose}>
      <div
        className="picker"
        ref={panel}
        role="dialog"
        aria-label="Choose an icon"
        style={{ left: position.left, top: position.top }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="picker-head">
          <input
            type="text"
            className="picker-search"
            placeholder="Search"
            value={query}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
          {current && (
            <button type="button" className="ghost" onClick={() => onPick(null)}>
              Remove
            </button>
          )}
        </div>

        <div className="picker-body">
          {searching ? (
            results.length === 0 ? (
              <p className="picker-empty">Nothing matches “{query.trim()}”.</p>
            ) : (
              <div className="picker-grid">
                {results.map((glyph) => (
                  <Choice key={glyph} glyph={glyph} current={current} onPick={onPick} />
                ))}
              </div>
            )
          ) : (
            EMOJI_GROUPS.map((group) => (
              <section key={group.name}>
                <p className="picker-group">{group.name}</p>
                <div className="picker-grid">
                  {group.emoji.map(([glyph]) => (
                    <Choice key={`${group.name}-${glyph}`} glyph={glyph} current={current} onPick={onPick} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Choice({
  glyph,
  current,
  onPick,
}: {
  glyph: string;
  current: string | null;
  onPick: (icon: string) => void;
}) {
  return (
    <button
      type="button"
      className={`picker-choice${glyph === current ? ' is-active' : ''}`}
      aria-label={glyph}
      aria-pressed={glyph === current}
      onClick={() => onPick(glyph)}
    >
      {glyph}
    </button>
  );
}
