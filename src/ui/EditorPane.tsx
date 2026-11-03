import { EditorContent, type Editor } from '@tiptap/react';
import { CaretLeft, CaretRight, ClockCounterClockwise, FileText } from '@phosphor-icons/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { useDocumentEditor } from '../editor/useDocumentEditor.ts';
import { useLibrary } from '../state/library.tsx';
import { useTabs } from '../state/tabs.tsx';
import { Backlinks } from './Backlinks.tsx';
import { BlockGutter } from './BlockGutter.tsx';
import {
  EditorContextMenu,
  placeCaretForMenu,
  selectionBefore,
  type HeldSelection,
} from './EditorContextMenu.tsx';
import { HistoryDialog } from './HistoryDialog.tsx';
import { AddCoverButton, PageCover } from './PageCover.tsx';
import { SelectionBar } from './SelectionBar.tsx';
import { SlashMenu } from './SlashMenu.tsx';
import { Toolbar, type RailControl } from './Toolbar.tsx';
import { formatCount } from './TreePane.tsx';

/**
 * Titles commit 300ms after typing stops, so the sidebar and the tab stay
 * live without a database write per keystroke.
 */
function useDebouncedTitle(id: string | null, stored: string) {
  const library = useLibrary();
  const [value, setValue] = useState(stored);
  const draft = useRef(stored);
  const timer = useRef<number | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    setValue(stored);
    draft.current = stored;
    dirty.current = false;
  }, [id, stored]);

  const commit = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!id || !dirty.current) return;
    dirty.current = false;
    void library.rename(id, draft.current);
  };

  return {
    value,
    set(next: string) {
      setValue(next);
      draft.current = next;
      dirty.current = true;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = window.setTimeout(commit, 300);
    },
    commit,
  };
}

/**
 * Back, forward, where you are, and how to format it.
 *
 * The formatting controls share this row rather than taking one of their own,
 * so nothing was given up to make room for them.
 */
const PAGE_VIEW = 'palmanote:page-view';

/**
 * Page view: the writing as a sheet of US Letter, at true size, with Word's
 * default inch of margin and a mark wherever a page would end.
 *
 * Word calls it Print Layout and puts it on Ctrl+Alt+P, so this does too. It
 * draws where the pages fall rather than paginating the text — a page break
 * inside a paragraph is shown, not moved — because live pagination in an
 * editable surface is a typesetter, and what the mode is for is knowing what
 * the .docx and the PDF will look like before sending them. Remembered on this
 * machine, like the sidebar.
 */
function usePageView(): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(PAGE_VIEW) === 'on';
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setOn((current) => {
      try {
        localStorage.setItem(PAGE_VIEW, current ? 'off' : 'on');
      } catch {
        // Not remembered, and still switched.
      }
      return !current;
    });
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && !event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
  return [on, toggle];
}

function PageBar({
  editor,
  rail,
  pageView,
  onOpenHistory,
}: {
  editor: Editor | null;
  rail?: RailControl;
  pageView?: { on: boolean; toggle: () => void };
  /** The page's own history. Here because it is about the page. */
  onOpenHistory?: () => void;
}) {
  const { trail, canGoBack, canGoForward, goBack, goForward, select } = useLibrary();
  return (
    <header className="pagebar">
      <button
        type="button"
        className="navbtn"
        disabled={!canGoBack}
        onClick={goBack}
        aria-label="Back"
        title="Back — Alt+Left"
      >
        <CaretLeft size={17} />
      </button>
      <button
        type="button"
        className="navbtn"
        disabled={!canGoForward}
        onClick={goForward}
        aria-label="Forward"
        title="Forward — Alt+Right"
      >
        <CaretRight size={17} />
      </button>

      <nav className="crumbs" aria-label="Location">
        {trail.map((page, index) => {
          const last = index === trail.length - 1;
          const label = page.title || 'Untitled';
          return (
            <span key={page.id}>
              {index > 0 && <span className="crumb-sep">/</span>}
              {last ? (
                <span className="crumb is-current">{label}</span>
              ) : (
                <button type="button" className="crumb" onClick={() => select(page.id)}>
                  {label}
                </button>
              )}
            </span>
          );
        })}
      </nav>

      <Toolbar editor={editor} rail={rail} />

      {onOpenHistory && (
        <button
          type="button"
          className="tool"
          aria-label="History"
          title="History — Ctrl+Shift+H"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onOpenHistory}
        >
          <ClockCounterClockwise size={17} />
        </button>
      )}
      {pageView && (
        <button
          type="button"
          className={`tool page-view-toggle${pageView.on ? ' is-active' : ''}`}
          aria-label="Page view"
          aria-pressed={pageView.on}
          title="Page view — Ctrl+Alt+P"
          onMouseDown={(event) => event.preventDefault()}
          onClick={pageView.toggle}
        >
          <FileText size={17} weight={pageView.on ? 'bold' : 'regular'} />
        </button>
      )}
    </header>
  );
}

export function EditorPane({
  sessionBaseline,
  hostRef,
  historyOpen,
  onCloseHistory,
  onOpenHistory,
  flushRef,
  editorRef,
  onComment,
  onSticky,
  rail,
}: {
  sessionBaseline: number;
  hostRef: RefObject<HTMLDivElement | null>;
  historyOpen: boolean;
  onCloseHistory: () => void;
  onOpenHistory: () => void;
  /**
   * Lent upwards so the window can save what is on screen *before* it takes
   * this pane away. Going back to the launch screen unmounts the editor, and
   * an unmount is the one leaving-the-page route the autosave has no hook for.
   */
  flushRef: RefObject<((snapshot: boolean) => Promise<void>) | null>;
  /** Lent upwards for the same reason: the notes rail lives outside this pane. */
  editorRef: RefObject<Editor | null>;
  onComment: (editor: Editor) => void;
  onSticky: () => void;
  rail: RailControl;
}) {
  const library = useLibrary();
  const tabs = useTabs();
  const doc = library.selectedId ? library.byId.get(library.selectedId) : undefined;
  const scrollHost = useCallback(() => hostRef.current, [hostRef]);
  const { editor, characters, words: liveWords, restore, flush } = useDocumentEditor(doc?.id ?? null, scrollHost);
  const title = useDebouncedTitle(doc?.id ?? null, doc?.title ?? '');
  const [pageView, togglePageView] = usePageView();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const heldSelection = useRef<HeldSelection | null>(null);

  useEffect(() => {
    flushRef.current = flush;
    editorRef.current = editor;
    return () => {
      flushRef.current = null;
      editorRef.current = null;
    };
  }, [editor, editorRef, flush, flushRef]);

  /*
    A page arrives rather than being swapped in.

    The editor is one instance that has its content replaced, so nothing
    remounts and nothing would animate on its own — switching tabs was a single
    frame of every word changing at once. The same rise the menus use, played
    on the sheet through the Web Animations API, because restarting a CSS
    animation on an element that never leaves the page means forcing a reflow.
  */
  const sheetRef = useRef<HTMLDivElement>(null);
  const arrivingId = doc?.id ?? null;
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet || !arrivingId) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const spring = getComputedStyle(document.documentElement).getPropertyValue('--spring').trim();
    const motion = sheet.animate(
      [
        { opacity: 0, translate: '0 6px' },
        { opacity: 1, translate: '0 0' },
      ],
      { duration: 400, easing: spring || 'ease-out' },
    );
    return () => motion.cancel();
  }, [arrivingId]);

  // Editing a previewed document is what makes it worth a permanent tab.
  const promote = tabs.promote;
  useEffect(() => {
    if (!editor || !doc) return;
    const onUpdate = () => promote(doc.id);
    editor.on('update', onUpdate);
    return () => {
      editor.off('update', onUpdate);
    };
  }, [editor, doc, promote]);

  if (!doc) {
    return (
      <main className="editor">
        <PageBar editor={null} rail={rail} />
        <div className="empty">
          <p>No page open.</p>
          <button type="button" className="ghost" onClick={() => void library.create({ parentId: null })}>
            Start one
          </button>
        </div>
      </main>
    );
  }

  const sessionDelta = library.totalWords - sessionBaseline;

  return (
    <main className={`editor${pageView ? ' is-page-view' : ''}`}>
      <PageBar
        editor={editor}
        rail={rail}
        pageView={{ on: pageView, toggle: togglePageView }}
        onOpenHistory={onOpenHistory}
      />

      {/* Outside the sheet on purpose: the measure is 40rem because that is
          how long a line should be to read, and a banner is not a line. */}
      <PageCover doc={doc} />

      <div
        className="sheet"
        ref={sheetRef}
        // Capture, and mousedown rather than contextmenu: ProseMirror answers
        // the right button by moving the caret, so this is the last moment the
        // selection the writer is pointing at still exists.
        onMouseDownCapture={(event) => {
          if (event.button === 2 && editor) heldSelection.current = selectionBefore(editor);
        }}
        onContextMenu={(event) => {
          if (!editor) return;
          // Not over a picture's own controls, a sticky or the gutter: those
          // carry their own handles, and a menu about the prose would be the
          // wrong menu there.
          if ((event.target as HTMLElement).closest('.gallery-chrome, .cover-actions, .blockgutter')) {
            return;
          }
          event.preventDefault();
          placeCaretForMenu(editor, event.clientX, event.clientY, heldSelection.current);
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <AddCoverButton doc={doc} />
        <input
          className="title"
          value={title.value}
          placeholder="Untitled"
          aria-label="Document title"
          spellCheck={false}
          onChange={(event) => title.set(event.target.value)}
          onBlur={title.commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'ArrowDown') {
              event.preventDefault();
              title.commit();
              editor?.commands.focus('start');
            }
          }}
        />
        <EditorContent editor={editor} />
        <Backlinks documentId={doc.id} />

        {/* Inside the sheet because it is positioned against it — the block it
            points at scrolls, and so must it. */}
        <BlockGutter editor={editor} />
      </div>


      {contextMenu && editor && (
        <EditorContextMenu
          editor={editor}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onComment={onComment}
          onSticky={onSticky}
        />
      )}

      <SlashMenu editor={editor} />

      {/* The two never appear together: the `/` menu wants a caret and this
          one wants words held. Both read the same plugin. */}
      <SelectionBar editor={editor} onComment={onComment} />

      {/* Here rather than beside the other dialogs in App, because restoring a
          version has to go through the editor that holds the live one. */}
      {historyOpen && editor && (
        <HistoryDialog
          documentId={doc.id}
          title={doc.title}
          editor={editor}
          onRestore={restore}
          onClose={onCloseHistory}
        />
      )}

      <footer className="status">
        <span className="status-counts">
          <span className="words">
            {formatCount(liveWords ?? doc.wordCount)} {(liveWords ?? doc.wordCount) === 1 ? 'word' : 'words'}
          </span>
          <span className="dot">·</span>
          <span>{formatCount(characters)} chars</span>
          <span className="dot">·</span>
          <span>
            {sessionDelta >= 0 ? '+' : '−'}
            {formatCount(Math.abs(sessionDelta))} this session
          </span>
        </span>
      </footer>
    </main>
  );
}
