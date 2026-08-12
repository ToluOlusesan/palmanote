import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/** Longer than this and it stopped being a command and became a sentence. */
const MAX_QUERY = 24;

/** The characters that open a menu, and what each one opens. */
const TRIGGERS = { '/': 'slash', '@': 'mention' } as const;

/**
 * Three doors into the same decision.
 *
 * `slash` is a `/` typed into the document: there is a caret and nothing else,
 * so the menu inserts — and it filters as you type, and choosing an entry
 * takes the `/` and the query back out with it.
 *
 * `mention` is an `@`, and works the same way over a different list: pages
 * rather than blocks. Everything about the trigger is shared, which is the
 * point of it living here — the rule about what counts as a trigger, when it
 * closes, what Escape does and how a drag suppresses it were all decided once.
 *
 * `selection` is text held. There is nothing to insert *into* without
 * destroying what is held, so nothing about that one inserts: it opens the bar
 * that comes to the words — marks, block types and highlights, in a row above
 * them. It is drawn by ui/SelectionBar.tsx rather than by the menu, but the
 * decision about whether it should be open at all is the same decision, made
 * here, once.
 *
 * `from` means the same in all three: the position the menu is anchored to.
 */
export type InsertMenu =
  | { kind: 'slash'; from: number; query: string }
  | { kind: 'mention'; from: number; query: string }
  | { kind: 'selection'; from: number; to: number };

/** True for the two that are a character in the document with a query after it. */
export function isTyped(
  menu: InsertMenu,
): menu is Extract<InsertMenu, { query: string }> {
  return menu.kind !== 'selection';
}

interface SlashState {
  open: InsertMenu | null;
  /** What the writer has waved away; it stays shut until they leave it. */
  dismissed: { from: number; to: number } | null;
}

export const slashKey = new PluginKey<SlashState>('springboardSlash');

/**
 * `/` or a held selection opens the menu.
 *
 * The split here is deliberate: this file decides *whether* something should
 * be open and swallows the keys it owns while one is; SlashMenu.tsx and
 * SelectionBar.tsx decide what is in it. Detection has to live in a
 * ProseMirror plugin because it has to run on every transaction, including the
 * selection-only ones React never hears about, and key handling has to live
 * here because `handleKeyDown` is the only place that outranks the list
 * extensions' own Enter and Tab.
 *
 * Written by hand rather than with `@tiptap/suggestion` for the reason the
 * typography rules were: the packaged version brings decorations, its own
 * renderer lifecycle and a popup abstraction, and the part actually wanted is
 * the twenty lines below.
 */
export const Slash = Extension.create({
  name: 'springboardSlash',
  // Above the list extensions, whose Enter and Tab would otherwise win.
  priority: 1100,

  addProseMirrorPlugins() {
    return [
      new Plugin<SlashState>({
        key: slashKey,
        state: {
          init: () => ({ open: null, dismissed: null }),
          apply(tr, previous, _oldState, newState) {
            const dismissed = previous.dismissed && {
              from: tr.mapping.map(previous.dismissed.from),
              to: tr.mapping.map(previous.dismissed.to),
            };
            const meta = tr.getMeta(slashKey) as { dismiss?: boolean; fresh?: boolean } | undefined;
            // A gesture that has just ended is a deliberate new act of
            // selecting, whatever was refused before it. Without this, waving
            // a selection away with Escape and then making the same selection
            // again would be met with silence — the range matches the one
            // refused, and nothing in between ever cleared it.
            if (meta?.fresh) return { open: detect(newState), dismissed: null };

            const open = detect(newState);
            if (meta?.dismiss) {
              const shut = previous.open
                ? { from: previous.open.from, to: edgeOf(previous.open) }
                : dismissed;
              return { open: null, dismissed: shut ?? null };
            }
            // Nothing here to be open about, so nothing to keep shut either.
            // This is what lets a selection waved away with Escape come back
            // when it is made again: the drag that remakes it collapses the
            // old one first, and that is the moment the refusal expires.
            if (!open) return { open: null, dismissed: null };
            if (dismissed && open.from === dismissed.from && edgeOf(open) === dismissed.to) {
              return { open: null, dismissed };
            }
            return { open, dismissed: dismissed ?? null };
          },
        },
        view(view) {
          // A selection is only worth a menu once the writer has finished
          // making it. Without this the menu chases the pointer down the page
          // through the whole drag, over the words being selected.
          const down = () => {
            dragging = true;
          };
          // `dragend` as well as `mouseup`, and this is not belt and braces:
          // a mousedown *inside* an existing selection starts a text drag
          // rather than a new selection, and a text drag never delivers a
          // mouseup at all. Without this the flag stays raised and the menu
          // never speaks again.
          const up = () => {
            dragging = false;
            // ProseMirror reads the DOM selection after the event, so the
            // state worth looking at is next frame's, not this one's.
            requestAnimationFrame(() => {
              if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(slashKey, { fresh: true }));
            });
          };
          view.dom.addEventListener('mousedown', down);
          // On window, because a drag can end anywhere — including outside it.
          window.addEventListener('mouseup', up);
          window.addEventListener('dragend', up);
          return {
            destroy: () => {
              view.dom.removeEventListener('mousedown', down);
              window.removeEventListener('mouseup', up);
              window.removeEventListener('dragend', up);
              dragging = false;
            },
          };
        },
        props: {
          handleKeyDown(view, event) {
            if (!slashKey.getState(view.state)?.open) return false;
            // Escape shuts whatever is open, and it lives here rather than in
            // a component because it is the one key that means the same thing
            // to both surfaces. The two of them render in different files and
            // there is only one slot below; making them negotiate over Escape
            // would be a race for no gain.
            if (event.key === 'Escape') {
              event.preventDefault();
              // At the window level Escape means "back to the writing", and
              // the writing is where we already are.
              event.stopPropagation();
              dismissSlash(view);
              return true;
            }
            return keys ? keys(event) : false;
          },
        },
      }),
    ];
  },
});

/** The far end of a menu's anchor: a selection's `to`, a trigger's own position. */
function edgeOf(menu: InsertMenu): number {
  return menu.kind === 'selection' ? menu.to : menu.from;
}

/** True from mousedown in the editor until the button comes back up. */
let dragging = false;

/**
 * Where a menu should be.
 *
 * Held text is the simple case: anywhere with words in it, once the mouse has
 * let go of it. Words is the operative part — see below.
 *
 * A trigger character is the fussier one — it has to start a word, with
 * nothing but an unbroken run of characters between it and the caret. That
 * rule is what keeps this out of the way of ordinary prose. A date, a fraction
 * and a path all put a `/` mid-word, and an email address puts an `@` there;
 * none of them open a menu. Typing a space closes one that is open, so an
 * interrupted thought costs a keystroke rather than an Escape.
 *
 * When both characters are behind the caret the nearer one wins, so `/image`
 * inside a sentence that already mentioned `@someone` is still `/image`.
 */
function detect(state: EditorState): InsertMenu | null {
  const { selection } = state;
  if (!selection.empty) {
    if (dragging) return null;
    /*
      A node selection is a block held as an object, and this bar is for words.

      Clicking a picture selects it — a node selection is a selection like any
      other as far as ProseMirror is concerned — and a bar offering to make it
      bold, or a heading, is a bar about nothing. Same for a sticker and a
      scene break.

      This used to be asked as "is there any text in the range", which answered
      the picture correctly and by accident. Then the drag handle arrived, and
      a paragraph picked up by its handle is a node selection *with* text in it
      — so the bar came up over the block the writer had just chosen, covering
      it and swallowing the pointer. What was always meant is the sentence at
      the top: held words get the bar, a held block does not, and the two are
      told apart by what kind of selection it is rather than by what happens to
      be inside it. See ui/BlockGutter.tsx, which is where the other one goes.
    */
    if (selection instanceof NodeSelection) return null;

    /*
      Whitespace held is not held text. A paragraph with a picture in the
      middle of it still has words and still gets the bar; a range that is only
      a newline has nothing for a mark to attach to.
    */
    if (state.doc.textBetween(selection.from, selection.to, ' ').trim().length === 0) {
      return null;
    }
    return { kind: 'selection', from: selection.from, to: selection.to };
  }

  const { $from } = selection;
  if (!$from.parent.isTextblock) return null;

  // Atoms come back as one placeholder character each, so offsets into this
  // string are offsets into the block.
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');

  let at = -1;
  for (const character of Object.keys(TRIGGERS)) {
    at = Math.max(at, before.lastIndexOf(character));
  }
  if (at < 0) return null;
  if (at > 0 && !/[\s￼]/.test(before[at - 1] ?? '')) return null;

  const query = before.slice(at + 1);
  if (query.length > MAX_QUERY || /\s/.test(query)) return null;

  const kind = TRIGGERS[before[at] as keyof typeof TRIGGERS];
  return { kind, from: $from.start() + at, query };
}

export function insertMenu(state: EditorState): InsertMenu | null {
  return slashKey.getState(state)?.open ?? null;
}

/** Close the menu, leaving whatever the writer typed exactly as they left it. */
export function dismissSlash(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(slashKey, { dismiss: true }));
}

/**
 * The keys a menu claims while it is open, if there is one to claim them.
 *
 * A module-level slot rather than a plugin option because the whole app runs
 * one editor view — `useDocumentEditor` swaps documents through it rather than
 * building a second — so there is never a second menu to confuse this with.
 */
type SlashKeys = (event: KeyboardEvent) => boolean;

let keys: SlashKeys | null = null;

export function setSlashKeys(handler: SlashKeys | null): void {
  keys = handler;
}
