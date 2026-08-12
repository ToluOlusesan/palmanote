import { Mark, mergeAttributes, type Editor } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlight: {
      toggleHighlight: (tone: HighlightTone) => ReturnType;
      clearHighlight: () => ReturnType;
    };
  }
}

/**
 * Four highlights, named for the colour they are.
 *
 * They were once named for what they meant — "Check this", "Might cut" — which
 * asked everyone to learn a private vocabulary before they could mark a
 * sentence. A colour is the one label nobody has to be taught: you pick yellow
 * because you want yellow, and what yellow means is yours to decide. The set is
 * still fixed rather than a colour picker, so a highlight stays a thing you can
 * find again rather than an arbitrary shade.
 *
 * Each maps to one of Word's named highlight colours on export, so a marked run
 * arrives in an editor's copy as a real Word highlight they can clear from the
 * ribbon.
 */
export const HIGHLIGHT_TONES = ['yellow', 'green', 'blue', 'pink'] as const;
export type HighlightTone = (typeof HIGHLIGHT_TONES)[number];

export const HIGHLIGHT_LABELS: Record<HighlightTone, string> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
};

/**
 * What the tones used to be called.
 *
 * Documents are stored as ProseMirror JSON, so pages written before the rename
 * still carry the old names in the database and always will — nothing rewrites
 * a document it was not asked to change. Every route out of the attribute goes
 * through `toneOf`, which means an old highlight draws, exports and toggles as
 * the colour it always was on screen.
 */
const RENAMED: Record<string, HighlightTone> = {
  check: 'yellow',
  cut: 'pink',
  continuity: 'blue',
  note: 'green',
};

/** Whatever is on the mark, as one of the four. */
export function toneOf(value: unknown): HighlightTone {
  if (typeof value === 'string') {
    if ((HIGHLIGHT_TONES as readonly string[]).includes(value)) return value as HighlightTone;
    const renamed = RENAMED[value];
    if (renamed) return renamed;
  }
  return 'yellow';
}

/** The colour under the selection, if there is one. */
export function activeHighlight(editor: Editor): HighlightTone | null {
  if (!editor.isActive('highlight')) return null;
  return toneOf(editor.getAttributes('highlight').tone);
}

export const Highlight = Mark.create({
  name: 'highlight',
  // Highlights sit under other marks so bold text can still be highlighted.
  priority: 900,

  addAttributes() {
    return {
      tone: {
        default: 'yellow' as HighlightTone,
        parseHTML: (element) => toneOf(element.getAttribute('data-tone')),
        // Normalised on the way out rather than on the way in, so the styles
        // and the exports only ever have four names to know about.
        renderHTML: (attributes) => ({ 'data-tone': toneOf(attributes.tone) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark[data-tone]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      toggleHighlight:
        (tone: HighlightTone) =>
        ({ chain, editor }) => {
          // Clicking the colour a run already has removes it; clicking a
          // different one recolours in place rather than nesting marks.
          if (activeHighlight(editor) === tone) {
            return chain().unsetMark(this.name).run();
          }
          return chain().unsetMark(this.name).setMark(this.name, { tone }).run();
        },
      clearHighlight:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name).run(),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-h': () => this.editor.commands.toggleHighlight('yellow'),
    };
  },
});
