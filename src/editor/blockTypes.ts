import {
  Code,
  ListBullets,
  ListChecks,
  ListNumbers,
  Quotes,
  TextAa,
  TextHOne,
  TextHThree,
  TextHTwo,
  type Icon,
} from '@phosphor-icons/react';
import type { ChainedCommands } from '@tiptap/core';
import type { Editor } from '@tiptap/react';

/**
 * Everything a block can *become*, in the order it is offered.
 *
 * This is the turn-into vocabulary, and it is deliberately not the same list as
 * the one in SlashMenu.tsx. That one answers "what can I put here", and holds
 * things that are only ever inserted — a picture, a gallery, a sticker, a scene
 * break. This one answers "what is this block instead", which is a question you
 * can only ask about something that already has words in it. The two lists
 * overlap because a heading is both a thing you can insert and a thing a
 * paragraph can become; they are not one list because most of each is not in
 * the other.
 *
 * Two surfaces read this: the selection bar's style dropdown, and the menu the
 * drag handle opens. Before it existed they held the same nine entries twice,
 * which is exactly the kind of duplication that goes stale on one side only.
 *
 * `is` matters as much as `run`. A menu that offers "Heading" without saying
 * that this block already is one is a menu you have to read the document to
 * use.

 * The three of them are named Heading, Subheading and Small heading rather
 * than H1/H2/H3 — the levels are a fact about the markup, not about the
 * writing. Not "Title" for the first, which is the obvious pick and the wrong
 * one here: the page already has a title, in a field of its own above the
 * prose, and two things called that is worse than one with a duller name. The
 * old names still find them in the `/` menu.
 */
export interface BlockType {
  id: string;
  label: string;
  /** The faster route to the same thing — a chord, or what to type. */
  hint: string;
  glyph: Icon;
  /** True when the block the selection is in already is this. */
  is: (editor: Editor) => boolean;
  run: (chain: ChainedCommands) => ChainedCommands;
  /**
   * Lists are the three that wrap rather than replace, and the selection bar
   * gives them buttons of their own rather than a line in its dropdown — so it
   * needs to be able to leave them out. The block menu offers all nine.
   */
  isList?: true;
}

export const BLOCK_TYPES: BlockType[] = [
  {
    id: 'text',
    label: 'Text',
    hint: 'Ctrl+Alt+0',
    glyph: TextAa,
    is: (editor) => editor.isActive('paragraph'),
    run: (chain) => chain.setParagraph(),
  },
  {
    id: 'h1',
    label: 'Heading',
    hint: 'Ctrl+Alt+1',
    glyph: TextHOne,
    is: (editor) => editor.isActive('heading', { level: 1 }),
    run: (chain) => chain.toggleHeading({ level: 1 }),
  },
  {
    id: 'h2',
    label: 'Subheading',
    hint: 'Ctrl+Alt+2',
    glyph: TextHTwo,
    is: (editor) => editor.isActive('heading', { level: 2 }),
    run: (chain) => chain.toggleHeading({ level: 2 }),
  },
  {
    id: 'h3',
    label: 'Small heading',
    hint: 'Ctrl+Alt+3',
    glyph: TextHThree,
    is: (editor) => editor.isActive('heading', { level: 3 }),
    run: (chain) => chain.toggleHeading({ level: 3 }),
  },
  {
    id: 'bullets',
    label: 'Bulleted list',
    hint: '- ',
    glyph: ListBullets,
    isList: true,
    is: (editor) => editor.isActive('bulletList'),
    run: (chain) => chain.toggleBulletList(),
  },
  {
    id: 'numbers',
    label: 'Numbered list',
    hint: '1. ',
    glyph: ListNumbers,
    isList: true,
    is: (editor) => editor.isActive('orderedList'),
    run: (chain) => chain.toggleOrderedList(),
  },
  {
    id: 'tasks',
    label: 'To-do list',
    hint: '[] ',
    glyph: ListChecks,
    isList: true,
    is: (editor) => editor.isActive('taskList'),
    run: (chain) => chain.toggleTaskList(),
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: '> ',
    glyph: Quotes,
    is: (editor) => editor.isActive('blockquote'),
    run: (chain) => chain.toggleBlockquote(),
  },
  {
    id: 'code',
    label: 'Code block',
    hint: '``` ',
    glyph: Code,
    is: (editor) => editor.isActive('codeBlock'),
    run: (chain) => chain.toggleCodeBlock(),
  },
];

/**
 * What the block the caret is in currently is.
 *
 * Order matters: a paragraph inside a list item is both a paragraph and a
 * bulleted list, and the answer a writer means is the list. So the list types
 * are asked first, and `Text` is the fallback rather than a match — it is the
 * only entry whose `is` would otherwise claim half the document.
 */
export function activeBlockType(editor: Editor): BlockType {
  return (
    BLOCK_TYPES.find((type) => type.isList && type.is(editor)) ??
    BLOCK_TYPES.find((type) => type.id !== 'text' && type.is(editor)) ??
    BLOCK_TYPES[0]!
  );
}
