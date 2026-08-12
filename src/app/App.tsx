import {
  CircleHalf,
  ClockCounterClockwise,
  Export,
  Gear,
  Moon,
  Sidebar,
  Sun,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { isDesktop } from '../data/bridge.ts';
import { LibraryProvider, useLibrary } from '../state/library.tsx';
import { TabsProvider, useTabs } from '../state/tabs.tsx';
import { useTheme } from '../state/theme.ts';
import { writingSettings } from '../state/writingSettings.ts';
import { EditorPane } from '../ui/EditorPane.tsx';
import { ExportDialog } from '../ui/ExportDialog.tsx';
import { GuideDialog } from '../ui/GuideDialog.tsx';
import { ImportDialog } from '../ui/ImportDialog.tsx';
import { PdfReader, type OpenPdf } from '../ui/PdfReader.tsx';
import { SettingsDialog } from '../ui/SettingsDialog.tsx';
import { TabStrip } from '../ui/TabStrip.tsx';
import { TreePane } from '../ui/TreePane.tsx';
import { Palette } from '../ui/Palette.tsx';
import { Welcome } from '../ui/Welcome.tsx';
import { WindowControls } from '../ui/WindowControls.tsx';

export function App() {
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
  const { treeVisible, setTreeVisible, ready, totalWords, goBack, goForward } = library;
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
  const [pdf, setPdf] = useState<OpenPdf | null>(null);
  const theme = useTheme();

  useEffect(() => {
    if (ready && sessionBaseline === null) setSessionBaseline(totalWords);
  }, [ready, sessionBaseline, totalWords]);

  const focusEditor = useCallback(() => {
    hostRef.current?.querySelector<HTMLElement>('.body')?.focus();
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
        const parentId = library.selectedId
          ? (library.byId.get(library.selectedId)?.parentId ?? null)
          : null;
        void library.create({ parentId, afterId: library.selectedId }).then(() => {
          window.setTimeout(() => hostRef.current?.querySelector<HTMLInputElement>('.title')?.focus(), 30);
        });
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
    focusEditor,
    goBack,
    goForward,
    library,
    paletteOpen,
    setTreeVisible,
    tabs,
    treeVisible,
  ]);

  return (
    <div className={`workspace${treeVisible ? '' : ' tree-hidden'}`}>
      <TreePane
        onOpen={openedSomething}
        onPreview={leaveGreeting}
        onImport={() => setImporting(true)}
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
        <div className={`topstrip${isDesktop ? ' is-desktop' : ''}`}>
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

          <TabStrip onPick={openedSomething} />

          {/* The window's drag region: everything the tabs do not claim.
              Tauri reads the attribute, Electron reads the CSS property. */}
          <div className="drag-region" data-tauri-drag-region />

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
        <div className="editor-host" ref={hostRef}>
          {pdf && <PdfReader file={pdf} onClose={() => setPdf(null)} />}
          {ready && greeting && !pdf && (
            <Welcome onLeave={openedSomething} />
          )}
          {ready && !greeting && !pdf && (
            <EditorPane
              sessionBaseline={sessionBaseline ?? totalWords}
              hostRef={hostRef}
              historyOpen={historyOpen}
              onCloseHistory={() => setHistoryOpen(false)}
            />
          )}
        </div>
      </div>

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onOpenGuide={() => setGuideOpen(true)}
        />
      )}
      {guideOpen && <GuideDialog onClose={() => setGuideOpen(false)} />}
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
