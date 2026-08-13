import type { DocumentKind, PMDoc, PMNode } from '../core/types.ts';

/**
 * The four starting points, as documents rather than as blank pages.
 *
 * A template here is a small tree, not a single page — putting a chapter
 * inside a story is the fastest way to show what the sidebar is *for*, and it
 * is the shape a writer would have built by hand a minute later anyway.
 *
 * Every template stays under a screenful. They are somewhere to start, not a
 * form to fill in, and anything unwanted is one Backspace away.
 */

export interface TemplateNode {
  title: string;
  kind: DocumentKind;
  icon?: string;
  content: PMDoc;
  children?: TemplateNode[];
  /** Where the caret lands. Exactly one node per template sets it. */
  open?: boolean;
}

const p = (text = ''): PMNode =>
  text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };

const h = (level: 1 | 2 | 3, text: string): PMNode => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});

const tasks = (count: number, ...labels: string[]): PMNode => ({
  type: 'taskList',
  content: Array.from({ length: Math.max(count, labels.length) }, (_, index) => ({
    type: 'taskItem',
    attrs: { checked: false },
    content: [p(labels[index] ?? '')],
  })),
});

const doc = (...content: PMNode[]): PMDoc => ({ type: 'doc', content });

const today = () =>
  new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

export function toDoList(): TemplateNode {
  return {
    title: 'To do',
    kind: 'note',
    icon: '✅',
    open: true,
    content: doc(h(2, 'Today'), tasks(3), h(2, 'This week'), tasks(2)),
  };
}

export function story(name: string): TemplateNode {
  const title = name || 'Untitled story';
  return {
    title,
    kind: 'folder',
    icon: '📖',
    content: doc(
      h(2, 'What it is'),
      p('One or two lines, for when you come back to it in a month.'),
      h(2, 'People'),
      p(),
      h(2, 'Where it happens'),
      p(),
    ),
    children: [
      {
        title: 'Chapter One',
        kind: 'chapter',
        open: true,
        // A scene break in the template, because it is a typed node here and
        // nobody would guess that from an empty page.
        content: doc(p(), { type: 'sceneBreak' }, p()),
      },
    ],
  };
}

export function project(name: string): TemplateNode {
  return {
    title: name || 'New project',
    kind: 'folder',
    icon: '🗂️',
    open: true,
    content: doc(
      h(2, 'What it is'),
      p(),
      h(2, 'What are you trying to achieve'),
      p(),
      h(2, 'Next'),
      tasks(3),
    ),
    children: [
      { title: 'Notes', kind: 'note', icon: '🗒️', content: doc(p()) },
    ],
  };
}

export function thoughts(name: string): TemplateNode {
  return {
    title: name || `Thoughts, ${today()}`,
    kind: 'note',
    icon: '💡',
    open: true,
    // Nothing but a page. This one is a template for *not* having a template.
    content: doc(p()),
  };
}
