import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/**
 * A caret that slides.
 *
 * Word slides its cursor between positions instead of jumping. A browser
 * cannot animate the native caret, so the only way to do this is to hide it
 * and draw our own.
 *
 * That is a genuinely risky trade in a writing app: if our caret ever fails to
 * paint, there is no cursor at all. So the native one is only hidden *after*
 * ours has been positioned once, and it comes back on blur, on IME
 * composition, and if anything throws. A visible native caret is always
 * better than no caret.
 *
 * This plugin used to move the page as well as the caret — typewriter
 * scrolling, holding the active line in a band above centre. It is gone. The
 * band was supposed to be the humane version of it, moving only once the
 * caret had drifted 90px out, but what a band actually buys you is a page
 * that sits perfectly still and then jumps a third of a screen without being
 * asked. Nothing scrolls the page now except the writer.
 */

export const caretKey = new PluginKey('palmanoteCaret');

export interface CaretOptions {
  animatedCaret: boolean;
}

class CaretView {
  private element: HTMLDivElement | null = null;
  private raf = 0;
  private composing = false;
  private painted = false;

  constructor(
    private readonly view: EditorView,
    private options: CaretOptions,
  ) {
    this.onFocus = this.onFocus.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.onCompositionStart = this.onCompositionStart.bind(this);
    this.onCompositionEnd = this.onCompositionEnd.bind(this);
    this.onScroll = this.onScroll.bind(this);

    const dom = view.dom;
    dom.addEventListener('focus', this.onFocus);
    dom.addEventListener('blur', this.onBlur);
    dom.addEventListener('compositionstart', this.onCompositionStart);
    dom.addEventListener('compositionend', this.onCompositionEnd);
    window.addEventListener('resize', this.onScroll);
    this.scroller()?.addEventListener('scroll', this.onScroll, { passive: true });

    this.schedule();
  }

  setOptions(options: CaretOptions) {
    this.options = options;
    if (!options.animatedCaret) this.teardownCaret();
    this.schedule();
  }

  update() {
    this.schedule();
  }

  destroy() {
    const dom = this.view.dom;
    dom.removeEventListener('focus', this.onFocus);
    dom.removeEventListener('blur', this.onBlur);
    dom.removeEventListener('compositionstart', this.onCompositionStart);
    dom.removeEventListener('compositionend', this.onCompositionEnd);
    window.removeEventListener('resize', this.onScroll);
    this.scroller()?.removeEventListener('scroll', this.onScroll);
    cancelAnimationFrame(this.raf);
    this.teardownCaret();
  }

  // ------------------------------------------------------------ internals

  private scroller(): HTMLElement | null {
    return this.view.dom.closest('.editor-host');
  }

  private onFocus() {
    this.schedule();
  }

  private onBlur() {
    // No focus, no caret to draw — and the native one is the safe default.
    this.teardownCaret();
  }

  private onCompositionStart() {
    this.composing = true;
    // IME candidate windows anchor to the *native* caret. Ours would be a lie.
    this.teardownCaret();
  }

  private onCompositionEnd() {
    this.composing = false;
    this.schedule();
  }

  private onScroll() {
    if (this.element) this.place(false);
  }

  private schedule() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      try {
        this.run();
      } catch {
        // Never let a measurement failure leave the writer without a cursor.
        this.teardownCaret();
      }
    });
  }

  private run() {
    const { state } = this.view;
    const active = this.view.hasFocus() && state.selection.empty && !this.composing;

    if (this.options.animatedCaret && active) {
      this.place(true);
    } else if (this.options.animatedCaret) {
      this.teardownCaret();
    }
  }

  private place(animate: boolean) {
    const { state } = this.view;
    if (!state.selection.empty) {
      this.teardownCaret();
      return;
    }
    const coords = this.view.coordsAtPos(state.selection.head);
    const host = this.scroller();
    if (!host) return;
    const frame = host.getBoundingClientRect();

    if (!this.element) {
      const element = document.createElement('div');
      element.className = 'caret';
      element.setAttribute('aria-hidden', 'true');
      host.appendChild(element);
      this.element = element;
      // First paint jumps rather than slides; there is nowhere to slide from.
      animate = false;
    }

    const element = this.element;
    element.classList.toggle('is-still', !animate);
    element.style.height = `${Math.max(coords.bottom - coords.top, 12)}px`;
    element.style.transform = `translate(${coords.left - frame.left + host.scrollLeft}px, ${
      coords.top - frame.top + host.scrollTop
    }px)`;

    if (!this.painted) {
      this.painted = true;
      // Only now is it safe to take the real one away.
      this.view.dom.classList.add('caret-hidden');
    }
  }

  private teardownCaret() {
    this.view.dom.classList.remove('caret-hidden');
    this.painted = false;
    this.element?.remove();
    this.element = null;
  }
}

export const Caret = Extension.create<CaretOptions>({
  name: 'palmanoteCaret',

  addOptions() {
    return { animatedCaret: true };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: caretKey,
        view(view) {
          const instance = new CaretView(view, options);
          // The extension's options object is mutated in place when settings
          // change, so re-reading it on every update is enough.
          return {
            update: () => {
              instance.setOptions({ ...options });
              instance.update();
            },
            destroy: () => instance.destroy(),
          };
        },
      }),
    ];
  },
});
