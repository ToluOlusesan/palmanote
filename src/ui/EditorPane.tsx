import { EditorContent, type Editor } from '@tiptap/react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

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
import { Toolbar } from './Toolbar.tsx';
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
function PageBar({ editor }: { editor: Editor | null }) {
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

      <Toolbar editor={editor} />
    </header>
  );
}

export function EditorPane({
  sessionBaseline,
  hostRef,
  historyOpen,
  onCloseHistory,
  flushRef,
}: {
  sessionBaseline: number;
  hostRef: RefObject<HTMLDivElement | null>;
  historyOpen: boolean;
  onCloseHistory: () => void;
  /**
   * Lent upwards so the window can save what is on screen *before* it takes
   * this pane away. Going back to the launch screen unmounts the editor, and
   * an unmount is the one leaving-the-page route the autosave has no hook for.
   */
  flushRef: RefObject<((snapshot: boolean) => Promise<void>) | null>;
}) {
  const library = useLibrary();
  const tabs = useTabs();
  const doc = library.selectedId ? library.byId.get(library.selectedId) : undefined;
  const scrollHost = useCallback(() => hostRef.current, [hostRef]);
  const { editor, characters, restore, flush } = useDocumentEditor(doc?.id ?? null, scrollHost);
  const title = useDebouncedTitle(doc?.id ?? null, doc?.title ?? '');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const heldSelection = useRef<HeldSelection | null>(null);

  useEffect(() => {
    flushRef.current = flush;
    return () => {
      flushRef.current = null;
    };
  }, [flush, flushRef]);

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
        <PageBar editor={null} />
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
    <main className="editor">
      <PageBar editor={editor} />

      {/* Outside the sheet on purpose: the measure is 40rem because that is
          how long a line should be to read, and a banner is not a line. */}
      <PageCover doc={doc} />

      <div
        className="sheet"
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
        />
      )}

      <SlashMenu editor={editor} />

      {/* The two never appear together: the `/` menu wants a caret and this
          one wants words held. Both read the same plugin. */}
      <SelectionBar editor={editor} />

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
            {formatCount(doc.wordCount)} {doc.wordCount === 1 ? 'word' : 'words'}
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
