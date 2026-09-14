import {
  CircleHalf,
  ClockCounterClockwise,
  Export,
  Gear,
  GridFour,
  Moon,
  Question,
  Sidebar,
  Sun,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Editor } from '@tiptap/react';

import { clearComment, selectComment } from '../editor/Comment.ts';
import { isDesktop } from '../data/bridge.ts';
import { ActivityDialog } from '../ui/ActivityDialog.tsx';
import { LibraryProvider, useLibrary } from '../state/library.tsx';
import { useTabClaim } from '../state/soleTab.ts';
import { TabsProvider, useTabs } from '../state/tabs.tsx';
import { useStickies } from '../state/stickies.ts';
import { useTheme } from '../state/theme.ts';
import { writingSettings } from '../state/writingSettings.ts';
import { EditorPane } from '../ui/EditorPane.tsx';
import { ExportDialog } from '../ui/ExportDialog.tsx';
import { GuideDialog } from '../ui/GuideDialog.tsx';
import { ImportDialog } from '../ui/ImportDialog.tsx';
import { PdfReader, type OpenPdf } from '../ui/PdfReader.tsx';
import { SettingsDialog } from '../ui/SettingsDialog.tsx';
import { StickyNotes } from '../ui/StickyNotes.tsx';
import { TabStrip } from '../ui/TabStrip.tsx';
import { TreePane } from '../ui/TreePane.tsx';
import { Tutorial, tourSeen } from '../ui/Tutorial.tsx';
import { Palette } from '../ui/Palette.tsx';
import { Welcome } from '../ui/Welcome.tsx';
import { WindowControls } from '../ui/WindowControls.tsx';
import { DuplicateTab, NarrowScreen, StorageNote, useNarrowScreen } from '../ui/WebShell.tsx';

/**
 * Two questions the browser build has to answer before anything reads the
 * library: is this the only tab, and is there room to work.
 *
 * Both are settled above the providers on purpose. A tab that is not going to
 * be allowed to write should never have loaded a library in the first place —
 * and on the desktop both resolve synchronously to yes, so the shipped app
 * mounts exactly as it always did.
 */
export function App() {
  const claim = useTabClaim();
  const narrow = useNarrowScreen();
  const [anyway, setAnyway] = useState(false);

  if (claim === 'claiming') return null;
  if (claim !== 'sole') return <DuplicateTab claim={claim} />;
  if (narrow && !anyway) return <NarrowScreen onContinue={() => setAnyway(true)} />;

  return (
    <LibraryProvider>
      <TabsProvider>
        <Workspace />
      </TabsProvider>
    </LibraryProvider>
  );
}

/**
 * Windows bindings throughout: Ctrl, never Cmd. Anything reachable by mouse in
 * this app is reachable from here too.
 */
function Workspace() {
  const library = useLibrary();
  const tabs = useTabs();
  const { treeVisible, setTreeVisible, railVisible, setRailVisible, ready, totalWords, goBack, goForward } =
    library;
  const hostRef = useRef<HTMLDivElement>(null);
  const [sessionBaseline, setSessionBaseline] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  // Read once: turning the switch off should not close a greeting mid-use, and
  // turning it on should wait for the next launch, which is what it says.
  const [greeting, setGreeting] = useState(() => writingSettings().welcome);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  // Read once, at mount: whether this is somebody's first time here. Shown
  // only after the greeting is answered, because the tour is about the room
  // and the greeting is the door.
  const [touring, setTouring] = useState(() => !tourSeen());
  const [pdf, setPdf] = useState<OpenPdf | null>(null);
  const theme = useTheme();
  // Owned here rather than in the editor pane: the rail is a fixed column
  // beside the paper, not something inside it, so it has to live outside the
  // element that scrolls.
  const rawStickies = useStickies(library.selectedId);

  /**
   * Removing a comment has to take its mark out of the prose as well, or the
   * words stay underlined with nothing behind them. Wrapped here rather than
   * inside the hook, because the hook is about storage and knows nothing about
   * a document — and a sticky, which has no anchor, falls straight through.
   */
  const stickies = useMemo(
    () => ({
      ...rawStickies,
      remove: (id: string) => {
        const note = rawStickies.notes.find((candidate) => candidate.id === id);
        if (note?.anchor && editorRef.current) clearComment(editorRef.current, note.anchor);
        rawStickies.remove(id);
      },
    }),
    [rawStickies],
  );

  /**
   * A note about *these words*: mark them, then open a note in the rail
   * carrying the mark's id. The id is the only thing that goes into the
   * document — the comment's text stays beside the stickies, so it does not
   * export, does not count towards the page, and is not copied into every
   * revision snapshot.
   */
  const commentOnSelection = useCallback(
    (editor: Editor) => {
      const id = crypto.randomUUID();
      editor.chain().focus().setMark('comment', { id }).run();
      stickies.add(id);
    },
    [stickies],
  );

  useEffect(() => {
    if (ready && sessionBaseline === null) setSessionBaseline(totalWords);
  }, [ready, sessionBaseline, totalWords]);

  /** The open editor's save, lent upwards by EditorPane while it is mounted. */
  const flushRef = useRef<((snapshot: boolean) => Promise<void>) | null>(null);
  /**
   * And the editor itself, for the same reason: the rail of notes is rendered
   * here, outside the scrolling paper, but a *comment* in that rail is about
   * words that only the editor can find.
   */
  const editorRef = useRef<Editor | null>(null);

  const focusEditor = useCallback(() => {
    hostRef.current?.querySelector<HTMLElement>('.body')?.focus();
  }, []);

  /**
   * A new page, in a new tab, with the caret in its title. What Ctrl+T does and
   * what the `+` at the end of the tab strip does — one function, so the two
   * can never come to mean slightly different things.
   *
   * It lands beside the open page rather than at the top of the tree: a new
   * page while you are in a chapter almost always belongs next to that chapter.
   */
  const newPage = useCallback(() => {
    const parentId = library.selectedId
      ? (library.byId.get(library.selectedId)?.parentId ?? null)
      : null;
    void library.create({ parentId, afterId: library.selectedId }).then(() => {
      window.setTimeout(() => hostRef.current?.querySelector<HTMLInputElement>('.title')?.focus(), 30);
    });
  }, [library]);

  /**
   * Back to the launch screen.
   *
   * The flush is not optional. Showing the greeting unmounts the editor, and
   * an unmount is the one way of leaving a page that the autosave has no hook
   * for — it saves on a document swap, on blur, on tab-hide and on unload, none
   * of which this is. `save` reads the document synchronously before it awaits
   * anything, so calling it here catches the text even though the pane is about
   * to go.
   */
  const goHome = useCallback(() => {
    void flushRef.current?.(true);
    setGreeting(true);
  }, []);

  const bootFocused = useRef(false);

  // Choosing an existing tab or page is an answer to "what do you want to do
  // today" as much as any of the four buttons is. Anything that changes what
  // is open puts the greeting away.
  const leaveGreeting = useCallback(() => {
    // Answering the greeting spends the launch focus below: from here on the
    // thing that answered it decides where the caret goes, and for some of
    // them the answer is "leave it where it is".
    bootFocused.current = true;
    setGreeting(false);
  }, []);

  // Where the answer was deliberate — a tab, Enter on a row, one of the four
  // buttons — the caret follows it into the page. Clicking a row in the
  // sidebar is browsing, and browsing keeps the focus in the sidebar so the
  // arrow keys still work; the greeting goes away all the same.
  const openedSomething = useCallback(() => {
    leaveGreeting();
    window.setTimeout(focusEditor, 30);
  }, [focusEditor, leaveGreeting]);

  // Launching lands the caret in the page. Writing is the resting state, so
  // nothing else asks for focus unless the writer goes looking for it.
  //
  // The editor mounts a frame or two after `ready`, and how many depends on
  // how much there is to load, so this waits for the element rather than
  // guessing at a delay. It waits for a page that is never coming while the
  // greeting is up, which is why that is checked here and not only above:
  // otherwise a greeting answered inside the first second would find the
  // caret pulled into the editor behind it.
  useEffect(() => {
    if (!ready || greeting || bootFocused.current) return;
    bootFocused.current = true;
    let frames = 0;
    const attempt = () => {
      const body = hostRef.current?.querySelector<HTMLElement>('.body');
      if (body) body.focus();
      else if (frames++ < 60) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }, [greeting, ready]);

  // History is per page, and there is no page behind the greeting or under the
  // PDF reader. The button says so rather than opening onto nothing.
  const canBrowseHistory = ready && !greeting && !pdf && library.selectedId !== null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey && !event.altKey;
      const key = event.key;

      if (ctrl && key === 'Tab') {
        event.preventDefault();
        tabs.cycle(event.shiftKey ? -1 : 1);
        return;
      }
      if (ctrl && !event.shiftKey && key >= '1' && key <= '9') {
        event.preventDefault();
        tabs.jump(Number(key));
        return;
      }
      // What every browser binds to the same job. Alt+arrows would read more
      // like the tree's own Alt+↑/↓, but they are already back and forward.
      if (ctrl && event.shiftKey && (key === 'PageUp' || key === 'PageDown')) {
        event.preventDefault();
        tabs.moveActive(key === 'PageUp' ? -1 : 1);
        return;
      }
      if (ctrl && key.toLowerCase() === 'w') {
        event.preventDefault();
        tabs.closeActive();
        return;
      }
      if (ctrl && event.shiftKey && key.toLowerCase() === 't') {
        event.preventDefault();
        tabs.reopenLast();
        return;
      }
      if (ctrl && !event.shiftKey && key.toLowerCase() === 't') {
        event.preventDefault();
        newPage();
        return;
      }
      if (ctrl && event.shiftKey && key.toLowerCase() === 'e') {
        event.preventDefault();
        setExporting(true);
        return;
      }
      if (ctrl && key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }
      // F1, which is what every application on this platform has meant by help
      // for thirty years, and the one key nothing in the editor wants.
      if (key === 'F1') {
        event.preventDefault();
        setGuideOpen((open) => !open);
        return;
      }
      // Toggles rather than only opening, so the chord that summons it also
      // dismisses it without a reach for Escape.
      if (ctrl && !event.shiftKey && key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (ctrl && event.shiftKey && key.toLowerCase() === 'i') {
        event.preventDefault();
        setImporting(true);
        return;
      }
      if (ctrl && event.shiftKey && key.toLowerCase() === 'h') {
        event.preventDefault();
        if (canBrowseHistory) setHistoryOpen(true);
        return;
      }
      // A note, in the rail. Not routed through the editor's keymap: a sticky
      // is not something the document can hold, and this has to work while the
      // sidebar or the title field has the focus too.
      if (ctrl && !event.shiftKey && key === ' ') {
        event.preventDefault();
        // Adding a note to a rail that is put away would be writing into a
        // drawer, so this opens it first.
        setRailVisible(true);
        stickies.add();
        return;
      }
      // And the chord that puts the column away, paired with the one above it.
      if (ctrl && event.shiftKey && key === ' ') {
        event.preventDefault();
        setRailVisible(!railVisible);
        return;
      }
      // A comment on the held words — Word's chord for the same thing. Tested
      // separately from `ctrl` above, which deliberately excludes Alt.
      if (event.ctrlKey && event.altKey && key.toLowerCase() === 'm') {
        event.preventDefault();
        const editor = editorRef.current;
        if (editor && !editor.state.selection.empty) commentOnSelection(editor);
        return;
      }
      // Not Ctrl+Shift+W, however well it fits "writing": the tab-close above
      // does not check Shift, so that chord already means something and would
      // mean it first. Toggles, like the palette — the chord that summons it
      // dismisses it.
      if (ctrl && event.shiftKey && key.toLowerCase() === 'y') {
        event.preventDefault();
        setActivityOpen((open) => !open);
        return;
      }
      if (ctrl && (key === '\\' || key === '/')) {
        event.preventDefault();
        setTreeVisible(!treeVisible);
        return;
      }
      if (event.altKey && key === 'ArrowLeft') {
        event.preventDefault();
        goBack();
        return;
      }
      if (event.altKey && key === 'ArrowRight') {
        event.preventDefault();
        goForward();
        return;
      }
      if (key === 'Escape') {
        // The palette closes itself; leaving the greeting is what Escape means
        // everywhere else, and doing both at once would skip a step nobody
        // asked to skip.
        if (paletteOpen) return;
        // Escape always returns to the writing.
        setGreeting(false);
        focusEditor();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    canBrowseHistory,
    commentOnSelection,
    focusEditor,
    goBack,
    goForward,
    library,
    newPage,
    paletteOpen,
    railVisible,
    setRailVisible,
    setTreeVisible,
    stickies,
    tabs,
    treeVisible,
  ]);

  return (
    <div className={`workspace${treeVisible ? '' : ' tree-hidden'}`}>
      <TreePane
        onOpen={openedSomething}
        onPreview={leaveGreeting}
        onImport={() => setImporting(true)}
        onHome={goHome}
      />

      {/* A quiet strip at the window edge brings the sidebar back without a shortcut. */}
      <button
        type="button"
        className="tree-handle"
        aria-label="Show pages"
        title="Pages — Ctrl+\"
        onClick={() => setTreeVisible(true)}
      />

      <div className="main">
        {/* The title bar of a window with no frame. `deep` means a press
            anywhere in here drags, except where Tauri stops of its own accord:
            it walks up from what was pressed and gives up at the first button,
            so the tabs and the icons keep their clicks. See styles.css. */}
        <div
          className={`topstrip${isDesktop ? ' is-desktop' : ''}`}
          data-tauri-drag-region="deep"
        >
          <button
            type="button"
            className="chrome-btn"
            aria-label={treeVisible ? 'Hide pages' : 'Show pages'}
            aria-pressed={treeVisible}
            title="Pages — Ctrl+\"
            onClick={() => setTreeVisible(!treeVisible)}
          >
            <Sidebar size={18} />
          </button>

          <TabStrip onPick={openedSomething} onNew={newPage} />

          {/* Reserved title bar. The strip around it drags too; this is the
              part kept clear on purpose, so there is always a stretch of bar
              with nothing in it to take hold of.

              `deep` rather than the bare attribute, and it matters: bare means
              "only when this element is the topmost thing under the pointer",
              which stops being true the moment anything is laid over the
              window — the first-run tour dims from an `inset: 0` panel, and
              under it the one part of the bar meant for dragging was the one
              part that would not drag. Bare also *ends* the walk, so it
              masked the `deep` on the strip behind it. */}
          <div className="drag-region" data-tauri-drag-region="deep" />

          <button
            type="button"
            className="chrome-btn"
            aria-label="History"
            title="History — Ctrl+Shift+H"
            disabled={!canBrowseHistory}
            onClick={() => setHistoryOpen(true)}
          >
            <ClockCounterClockwise size={18} />
          </button>
          <button
            type="button"
            className="chrome-btn"
            aria-label="Your writing"
            title="Your writing — Ctrl+Shift+Y"
            onClick={() => setActivityOpen(true)}
          >
            <GridFour size={18} />
          </button>
          {/* The notes switch is *not* here. It sat beside settings and the
              theme for a version, which is where the window's own switches
              live — and it is not one of those. It is in the page bar with
              bold and the headings, because it is about the page in front of
              you. See Toolbar.tsx. */}
          {/* The guide, on the bar rather than two levels down inside Settings.
              A list of thirty shortcuts is worth nothing if finding it needs a
              shortcut you would have had to read the list to know. */}
          <button
            type="button"
            className="chrome-btn"
            aria-label="Guide"
            title="What everything does — F1"
            onClick={() => setGuideOpen(true)}
          >
            <Question size={18} />
          </button>
          <button
            type="button"
            className="chrome-btn"
            aria-label="Settings"
            title="Settings — Ctrl+,"
            onClick={() => setSettingsOpen(true)}
          >
            <Gear size={18} />
          </button>
          <button
            type="button"
            className="chrome-btn"
            aria-label="Export"
            title="Export — Ctrl+Shift+E"
            onClick={() => setExporting(true)}
          >
            <Export size={18} />
          </button>
          <button
            type="button"
            className="chrome-btn"
            aria-label={`Theme: ${theme.choice}`}
            title={`Theme: ${theme.choice} — click to change`}
            onClick={theme.cycle}
          >
            {theme.choice === 'system' ? (
              <CircleHalf size={18} />
            ) : theme.choice === 'light' ? (
              <Sun size={18} />
            ) : (
              <Moon size={18} />
            )}
          </button>

          <WindowControls />
        </div>
        {/* Beside the paper rather than on it, and outside the element that
            scrolls, so the notes hold still while the prose moves. */}
        {ready && !greeting && !pdf && railVisible && (
          <StickyNotes
            stickies={stickies}
            onHide={() => setRailVisible(false)}
            onGoToAnchor={(anchor) =>
              editorRef.current ? selectComment(editorRef.current, anchor) : false
            }
          />
        )}

        {/* The way back, and only when there is something to come back to. The
            same shape as the sidebar's edge handle, on the other side: a thin
            strip that answers a pointer rather than a control taking space. */}
        {ready && !greeting && !pdf && !railVisible && stickies.notes.length > 0 && (
          <button
            type="button"
            className="rail-handle"
            aria-label="Show notes"
            title={`${stickies.notes.length} note${stickies.notes.length === 1 ? '' : 's'} — Ctrl+Shift+Space`}
            onClick={() => setRailVisible(true)}
          />
        )}

        <div className="editor-host" ref={hostRef}>
          {pdf && <PdfReader file={pdf} onClose={() => setPdf(null)} />}
          {ready && greeting && !pdf && (
            <Welcome onLeave={openedSomething} onOpenActivity={() => setActivityOpen(true)} />
          )}
          {ready && !greeting && !pdf && (
            <EditorPane
              sessionBaseline={sessionBaseline ?? totalWords}
              hostRef={hostRef}
              historyOpen={historyOpen}
              onCloseHistory={() => setHistoryOpen(false)}
              flushRef={flushRef}
              editorRef={editorRef}
              onComment={commentOnSelection}
              onSticky={() => {
                setRailVisible(true);
                stickies.add();
              }}
              rail={{
                count: stickies.notes.length,
                add: () => {
                  setRailVisible(true);
                  stickies.add();
                },
              }}
            />
          )}
        </div>
      </div>

      {/* Last in the tree so it is over everything, and only once there is
          something to point at: it teaches the writing surface, and the
          greeting is still covering it until it is answered. */}
      {touring && ready && !greeting && !pdf && <Tutorial onDone={() => setTouring(false)} />}

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onOpenGuide={() => setGuideOpen(true)}
        />
      )}
      {guideOpen && (
        <GuideDialog
          onClose={() => setGuideOpen(false)}
          onReplayTour={() => {
            setGuideOpen(false);
            setTouring(true);
          }}
        />
      )}
      {activityOpen && (
        <ActivityDialog
          onClose={() => setActivityOpen(false)}
          onOpenPages={openedSomething}
        />
      )}
      {paletteOpen && (
        <Palette
          onClose={() => {
            setPaletteOpen(false);
            // Straight back to the sentence, whether a page was chosen or not.
            setGreeting(false);
            focusEditor();
          }}
        />
      )}
      {/* Where the work is kept — said once, in the build where the answer is
          not "a file you could point at". Not while the tour is up: two things
          introducing themselves at once is neither of them being read. */}
      {!isDesktop && ready && !touring && <StorageNote onExport={() => setExporting(true)} />}

      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onOpenPdf={(file) => {
            setGreeting(false);
            setPdf(file);
          }}
        />
      )}
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}
