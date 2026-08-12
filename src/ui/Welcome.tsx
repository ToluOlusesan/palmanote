import { BookOpen, Kanban, Lightbulb, ListChecks, type Icon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { useLibrary } from '../state/library.tsx';
import { useTabs } from '../state/tabs.tsx';
import { useWritingSettings, whatToCallYou } from '../state/writingSettings.ts';
import { SpringMark } from './SpringMark.tsx';
import { project, story, thoughts, toDoList, type TemplateNode } from './templates.ts';

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
export function Welcome({ onLeave }: { onLeave: () => void }) {
  const library = useLibrary();
  const tabs = useTabs();
  const { settings } = useWritingSettings();
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
        <h1 className="welcome-greeting">
          <SpringMark size={34} className="welcome-mark" />
          <span>Hey {whatToCallYou(settings.name)},</span>
        </h1>
        <p className="welcome-question">What do you want to do today?</p>

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

        <button type="button" className="welcome-skip" onClick={onLeave}>
          Back to what I was writing
          <span className="welcome-hint">Esc</span>
        </button>
      </div>
    </div>
  );
}
