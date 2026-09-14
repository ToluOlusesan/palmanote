import { useEffect, useRef, useState } from 'react';

import { GUIDE } from './guide.ts';
import { forgetTour } from './Tutorial.tsx';

/**
 * What everything does, in one place you can open mid-sentence.
 *
 * A reference rather than a tour. A tour arrives once, at the moment you know
 * least and care least, and cannot be consulted later — which is exactly when
 * the question actually turns up: halfway through a paragraph, wondering what
 * the key for a scene break was. So it is a list of topics you can jump around
 * and a search that goes straight to the answer.
 *
 * Escape closes it, and stops there rather than reaching the window handler,
 * which would take the writer somewhere they did not ask to go.
 */
export function GuideDialog({
  onClose,
  onReplayTour,
}: {
  onClose: () => void;
  /** Runs the first-launch tour again. Offered here because this is where
   *  somebody who has forgotten how the app works comes looking. */
  onReplayTour?: () => void;
}) {
  const [chosen, setChosen] = useState(GUIDE[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLInputElement>('.guide-search')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;

  // Searching shows every section that has anything to say about it, with the
  // rows that do not say it taken out. Reading a filtered section is faster
  // than being handed a list of matches with no idea what they belong to.
  const sections = GUIDE.map((section) => {
    if (!searching) return section;
    const rows = section.rows.filter(
      (row) =>
        row.what.toLowerCase().includes(needle) ||
        (row.keys ?? '').toLowerCase().includes(needle),
    );
    const itself =
      section.title.toLowerCase().includes(needle) || section.intro.toLowerCase().includes(needle);
    if (!itself && rows.length === 0) return null;
    return { ...section, rows: itself ? section.rows : rows };
  }).filter((section): section is (typeof GUIDE)[number] => section !== null);

  const jump = (id: string) => {
    setChosen(id);
    body.current?.querySelector(`[data-topic="${id}"]`)?.scrollIntoView({ block: 'start' });
  };

  // The topic rail is a reading position as much as it is navigation. A click
  // still jumps the body, but ordinary scrolling answers the inverse question:
  // "which part of the guide am I in now?" The first section whose top has
  // crossed the body's reading line is the active one.
  useEffect(() => {
    const host = body.current;
    if (!host || searching) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = host.getBoundingClientRect().top + 18;
        let active = GUIDE[0]?.id ?? '';
        for (const section of host.querySelectorAll<HTMLElement>('[data-topic]')) {
          if (section.getBoundingClientRect().top <= top) active = section.dataset.topic ?? active;
          else break;
        }
        setChosen((current) => (current === active ? current : active));
      });
    };
    sync();
    host.addEventListener('scroll', sync, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      host.removeEventListener('scroll', sync);
    };
  }, [searching]);

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="dialog is-wide"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Guide"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="guide-head">
          <h2 className="dialog-title">Everything, and what it does</h2>
          <input
            type="search"
            className="guide-search"
            placeholder="Search"
            aria-label="Search the guide"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="guide">
          <nav className="guide-topics" aria-label="Topics">
            {GUIDE.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`guide-topic${section.id === chosen && !searching ? ' is-active' : ''}`}
                disabled={searching && !sections.some((match) => match.id === section.id)}
                onClick={() => jump(section.id)}
              >
                {section.title}
              </button>
            ))}
          </nav>

          <div className="guide-body" ref={body}>
            {sections.length === 0 ? (
              <p className="picker-empty">Nothing in here matches “{query.trim()}”.</p>
            ) : (
              sections.map((section) => (
                <section key={section.id} data-topic={section.id} className="guide-section">
                  <h3>{section.title}</h3>
                  <p className="guide-intro">{section.intro}</p>

                  <dl className="guide-rows">
                    {section.rows.map((row) => (
                      <div className="guide-row" key={`${row.keys ?? ''}${row.what}`}>
                        <dt>{row.keys ? <kbd>{row.keys}</kbd> : null}</dt>
                        <dd>{row.what}</dd>
                      </div>
                    ))}
                  </dl>

                  {section.aside && <p className="guide-aside">{section.aside}</p>}
                </section>
              ))
            )}
          </div>
        </div>

        <div className="dialog-foot">
          <span className="dialog-note">Ctrl + , opens settings. Escape always goes back to the writing.</span>
          {onReplayTour && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                forgetTour();
                onReplayTour();
              }}
            >
              Show me around again
            </button>
          )}
          <button type="button" className="btn is-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
