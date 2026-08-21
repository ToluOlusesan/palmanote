import { BookOpen, Kanban, Lightbulb, ListChecks, type Icon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { dayKey, formatWords, summarise, type Summary } from '../core/activity.ts';
import { useActivity } from '../state/activity.ts';
import { useLibrary } from '../state/library.tsx';
import { useTabs } from '../state/tabs.tsx';
import { PalmaBadge } from './PalmaMark.tsx';
import { project, story, thoughts, toDoList, type TemplateNode } from './templates.ts';
import { WeekStrip } from './WritingChart.tsx';

interface Start {
  label: string;
  glyph: Icon;
  /** Built from the typed name, when there is one. */
  build: (name: string) => TemplateNode;
}

const STARTS: Start[] = [
  { label: 'Make a to-do list', glyph: ListChecks, build: toDoList },
  { label: 'Draft a story', glyph: BookOpen, build: story },
  { label: 'Plan a project', glyph: Kanban, build: project },
  { label: 'Jot down thoughts', glyph: Lightbulb, build: thoughts },
];

/**
 * What launch looks like.
 *
 * The brief argued against a greeting on the grounds that a writer should
 * arrive already writing. This is the version that respects that: every route
 * out of it ends with a caret in a page, it never asks a second question, and
 * it can be switched off from the writing menu once it stops being useful.
 */
/**
 * The line under the seven squares.
 *
 * It said "9 days running" until the streak was taken out of the app. A chain
 * you can break is a reason not to stop rather than a reason to start, and
 * that is a different app from this one — so this reports the day and leaves
 * the pressure out.
 */
function caption(summary: Summary): string {
  const today = summary.today?.words ?? 0;
  if (today > 0) return `${formatWords(today)} words today`;
  return summary.days === 1 ? 'One day written' : `${summary.days} days written`;
}

export function Welcome({ onLeave, onOpenActivity }: {
  onLeave: () => void;
  onOpenActivity: () => void;
}) {
  const library = useLibrary();
  const tabs = useTabs();
  const { days } = useActivity();
  const today = dayKey(Date.now());
  const summary = summarise(days, today);
  // The page being named, not the person being greeted. The two are a word
  // apart and sit ten lines apart, so they are named apart.
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  /** Writes a template into the library, parents before children. */
  const build = async (node: TemplateNode, parentId: string | null): Promise<string | null> => {
    const meta = await library.create({ parentId, kind: node.kind, title: node.title });
    if (node.icon) await library.setIcon(meta.id, node.icon);
    await library.saveInitialContent(meta.id, node.content);

    let landing = node.open ? meta.id : null;
    for (const child of node.children ?? []) {
      landing = (await build(child, meta.id)) ?? landing;
    }
    return landing;
  };

  const begin = async (start: Start | null) => {
    if (busy) return;
    setBusy(true);
    const typed = name.trim();
    const landing = start
      ? await build(start.build(typed), null)
      : (await library.create({ parentId: null, kind: 'note', title: typed })).id;

    if (landing) {
      if (start) library.setExpanded(landing, true);
      tabs.open(landing, 'permanent');
      library.select(landing);
    }
    onLeave();
  };

  return (
    <div className="welcome">
      <div className="welcome-inner">
        {/* The badge is the one place inside the app the brand gradient shows
            — this is the closest thing to a splash, and the only moment the
            product introduces itself rather than getting out of the way. */}
        <PalmaBadge size={54} className="welcome-mark" />
        {/* Just the question. It was "Hey you," over "What do you want to do
            today?" — a heading and a subheading saying one thing between them
            — then the two joined into a greeting. The greeting was still the
            longer way to ask, and the name was doing nothing the app needs it
            for here. */}
        <h1 className="welcome-greeting">What do you want to do today?</h1>

        <form
          className="welcome-field"
          onSubmit={(event) => {
            event.preventDefault();
            void begin(null);
          }}
        >
          <input
            ref={input}
            type="text"
            className="welcome-input"
            placeholder="Name it, or just pick something below"
            aria-label="Name for a new page"
            spellCheck={false}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="welcome-go" disabled={busy || name.trim().length === 0}>
            Start
          </button>
        </form>

        <div className="welcome-starts">
          {STARTS.map((start) => (
            <button
              key={start.label}
              type="button"
              className="welcome-start"
              disabled={busy}
              onClick={() => void begin(start)}
            >
              <start.glyph size={19} />
              {start.label}
            </button>
          ))}
        </div>

        {/* Below the four starts, not above them: the question at the top is
            what to do next, and the answer to it should not have to be read
            around a record of what was done before. */}
        {summary.days > 0 && (
          <WeekStrip
            days={days}
            today={today}
            caption={caption(summary)}
            onOpen={onOpenActivity}
          />
        )}

        <button type="button" className="welcome-skip" onClick={onLeave}>
          Back to what I was writing
          <span className="welcome-hint">Esc</span>
        </button>
      </div>
    </div>
  );
}
