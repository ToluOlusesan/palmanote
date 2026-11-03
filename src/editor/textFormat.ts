import type { Editor } from '@tiptap/react';

/**
 * The Word half of the formatting: colour, size and alignment.
 *
 * Short lists on purpose. Word's colour picker has sixteen million entries and
 * every document that has been through enough hands uses forty of them; a
 * palette of seven is what keeps a page looking like one person wrote it. The
 * same goes for sizes — the steps Word's own dropdown leads with, not a box
 * that takes 13.5.
 *
 * Colours are stored as the hex that is drawn, because that is what a .docx
 * holds (`w:color`) and what a pasted span carries. Sizes are stored in points
 * for the same reason: Word counts in half-points, and a page that said `18px`
 * would have to be converted on every trip out and back.
 */

export interface TextColour {
  id: string;
  label: string;
  /** Mid-tones, legible on the white page and on the dark one. */
  value: string;
}

export const TEXT_COLOURS: TextColour[] = [
  { id: 'grey', label: 'Grey', value: '#7d8590' },
  { id: 'red', label: 'Red', value: '#d1453b' },
  { id: 'orange', label: 'Orange', value: '#d9730d' },
  { id: 'green', label: 'Green', value: '#2e9d5b' },
  { id: 'blue', label: 'Blue', value: '#2f6fe0' },
  { id: 'purple', label: 'Purple', value: '#8a4fd8' },
  { id: 'pink', label: 'Pink', value: '#d6337f' },
];

/** The body is 16px, which is 12pt — so 12 is "normal" and is not stored. */
export const BODY_POINTS = 12;

export const FONT_SIZES = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48];

export type Alignment = 'left' | 'center' | 'right' | 'justify';

export const ALIGNMENTS: { id: Alignment; label: string; hint: string }[] = [
  { id: 'left', label: 'Align left', hint: 'Ctrl+Shift+L' },
  { id: 'center', label: 'Centre', hint: 'Ctrl+Shift+E' },
  { id: 'right', label: 'Align right', hint: 'Ctrl+Shift+R' },
  { id: 'justify', label: 'Justify', hint: 'Ctrl+Shift+J' },
];

/** The colour on the selection, or null for the ink the theme draws in. */
export function activeColour(editor: Editor): string | null {
  const colour = editor.getAttributes('textStyle').color;
  return typeof colour === 'string' && colour.length > 0 ? colour : null;
}

/**
 * A stored size in points, from whatever unit it arrived in.
 *
 * Points are what this app writes; pixels are what a paste from the web
 * carries. Anything else is not a size this app can honour on a page or in
 * a Word file, and reads as no size at all.
 */
export function pointsOf(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^\s*([\d.]+)\s*(pt|px)?\s*$/i.exec(value);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]!);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return match[2]?.toLowerCase() === 'px' ? Math.round(amount * 0.75 * 2) / 2 : amount;
}

/** The size on the selection in points, or null for the body's own. */
export function activeSize(editor: Editor): number | null {
  return pointsOf(editor.getAttributes('textStyle').fontSize);
}

export function activeAlignment(editor: Editor): Alignment {
  for (const { id } of ALIGNMENTS) {
    if (editor.isActive({ textAlign: id })) return id;
  }
  return 'left';
}
