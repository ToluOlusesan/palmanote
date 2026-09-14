import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useLibrary } from './library.tsx';

const TABS_KEY = 'palmanote:tabs';
const REOPEN_LIMIT = 20;
/** How long a pinned tab stays armed after the first Ctrl+W. */
const PIN_CONFIRM_MS = 1500;

export interface Tab {
  docId: string;
  /** Preview tabs are reused by the next single click, VS Code style. */
  preview: boolean;
  pinned: boolean;
}

interface PersistedTabs {
  tabs: { docId: string; pinned: boolean }[];
}

function readTabs(): Tab[] {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PersistedTabs>;
    if (!Array.isArray(parsed.tabs)) return [];
    return parsed.tabs.map((tab) => ({ docId: tab.docId, pinned: Boolean(tab.pinned), preview: false }));
  } catch {
    return [];
  }
}

export interface TabsApi {
  /** Already in display order: pinned first, insertion order within. */
  tabs: Tab[];
  activeId: string | null;
  /** `preview` reuses the temporary tab; `permanent` claims one of its own. */
  open(docId: string, mode: 'preview' | 'permanent'): void;
  /** Editing a previewed document is what makes it worth keeping. */
  promote(docId: string): void;
  close(docId: string): void;
  /** Browser-style group closes. Pinned tabs survive the relative variants. */
  closeOthers(docId: string): void;
  closeToRight(docId: string): void;
  closeAll(): void;
  closeActive(): void;
  canReopen: boolean;
  reopenLast(): void;
  cycle(direction: 1 | -1): void;
  jump(position: number): void;
  moveTab(from: number, to: number): void;
  /** Shifts the open tab one place. Declines to cross the pinned boundary. */
  moveActive(direction: 1 | -1): void;
  togglePin(docId: string): void;
}

const TabsContext = createContext<TabsApi | null>(null);

/** Pinned tabs sit left. A stable sort keeps insertion order inside each group. */
function sortPinned(tabs: Tab[]): Tab[] {
  return [...tabs].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export function TabsProvider({ children }: { children: ReactNode }) {
  const { selectedId, select, byId, ready } = useLibrary();

  const [tabs, setTabs] = useState<Tab[]>(() => sortPinned(readTabs()));
  // Actions read and write through the ref so they can also touch selection
  // and localStorage in the same breath. Doing that inside a setState updater
  // would run it twice, because React deliberately double-invokes updaters.
  const tabsRef = useRef(tabs);
  const commit = useCallback((next: Tab[]) => {
    const ordered = sortPinned(next);
    tabsRef.current = ordered;
    setTabs(ordered);
  }, []);

  const closed = useRef<{ docId: string; index: number }[]>([]);
  const [closedCount, setClosedCount] = useState(0);
  const pinnedCloseArmed = useRef<string | null>(null);

  // Selection is the single source of truth for which document is open; the
  // tab strip is the set of documents kept to hand. Anything that changes
  // selection without going through a tab — back, forward, the archive
  // fallback — is caught here and given a preview tab.
  useEffect(() => {
    if (!ready || !selectedId) return;
    if (tabsRef.current.some((tab) => tab.docId === selectedId)) return;
    commit(withPreview(tabsRef.current, { docId: selectedId, preview: true, pinned: false }));
  }, [ready, selectedId, commit]);

  // A tab whose document has been archived out of the tree stops existing.
  useEffect(() => {
    if (!ready) return;
    const live = tabsRef.current.filter((tab) => byId.get(tab.docId)?.archivedAt === null);
    if (live.length !== tabsRef.current.length) commit(live);
  }, [ready, byId, commit]);

  useEffect(() => {
    const payload: PersistedTabs = { tabs: tabs.map(({ docId, pinned }) => ({ docId, pinned })) };
    localStorage.setItem(TABS_KEY, JSON.stringify(payload));
  }, [tabs]);

  const open = useCallback(
    (docId: string, mode: 'preview' | 'permanent') => {
      const current = tabsRef.current;
      const existing = current.find((tab) => tab.docId === docId);
      if (existing) {
        if (mode === 'permanent' && existing.preview) {
          commit(current.map((tab) => (tab.docId === docId ? { ...tab, preview: false } : tab)));
        }
      } else {
        const tab: Tab = { docId, preview: mode === 'preview', pinned: false };
        commit(mode === 'preview' ? withPreview(current, tab) : [...current, tab]);
      }
      select(docId);
    },
    [commit, select],
  );

  const promote = useCallback(
    (docId: string) => {
      const current = tabsRef.current;
      if (!current.some((tab) => tab.docId === docId && tab.preview)) return;
      commit(current.map((tab) => (tab.docId === docId ? { ...tab, preview: false } : tab)));
    },
    [commit],
  );

  const close = useCallback(
    (docId: string) => {
      const current = tabsRef.current;
      const index = current.findIndex((tab) => tab.docId === docId);
      if (index === -1) return;
      closed.current = [{ docId, index }, ...closed.current].slice(0, REOPEN_LIMIT);
      setClosedCount(closed.current.length);
      const next = current.filter((tab) => tab.docId !== docId);
      commit(next);
      if (docId === selectedId) {
        const neighbour = next[Math.min(index, next.length - 1)];
        select(neighbour?.docId ?? null);
      }
    },
    [commit, select, selectedId],
  );

  /**
   * Closes a set as one operation and chooses the nearest tab that survived.
   * Keeping this here, rather than having the menu call `close` in a loop,
   * avoids walking selection through every intermediate tab and keeps the
   * closed-tab stack in the same visual order the strip had.
   */
  const closeWhere = useCallback(
    (shouldClose: (tab: Tab, index: number) => boolean) => {
      const current = tabsRef.current;
      const removed = current
        .map((tab, index) => ({ tab, index }))
        .filter(({ tab, index }) => shouldClose(tab, index));
      if (removed.length === 0) return;

      closed.current = [
        ...[...removed].reverse().map(({ tab, index }) => ({ docId: tab.docId, index })),
        ...closed.current,
      ].slice(0, REOPEN_LIMIT);
      setClosedCount(closed.current.length);
      const removedIds = new Set(removed.map(({ tab }) => tab.docId));
      const next = current.filter((tab) => !removedIds.has(tab.docId));
      const activeAt = current.findIndex((tab) => tab.docId === selectedId);
      commit(next);
      if (selectedId && removedIds.has(selectedId)) {
        const neighbour = next[Math.min(Math.max(activeAt, 0), next.length - 1)];
        select(neighbour?.docId ?? null);
      }
    },
    [commit, select, selectedId],
  );

  const closeOthers = useCallback(
    (docId: string) => closeWhere((tab) => tab.docId !== docId && !tab.pinned),
    [closeWhere],
  );

  const closeToRight = useCallback(
    (docId: string) => {
      const at = tabsRef.current.findIndex((tab) => tab.docId === docId);
      if (at === -1) return;
      closeWhere((tab, index) => index > at && !tab.pinned);
    },
    [closeWhere],
  );

  const closeAll = useCallback(() => {
    closeWhere(() => true);
    // Also covers the narrow race where navigation changed selection before
    // its preview tab was rendered: “all” must still leave no page selected.
    select(null);
  }, [closeWhere, select]);

  const closeActive = useCallback(() => {
    if (!selectedId) return;
    const tab = tabsRef.current.find((entry) => entry.docId === selectedId);
    if (!tab) return;
    if (tab.pinned && pinnedCloseArmed.current !== selectedId) {
      pinnedCloseArmed.current = selectedId;
      window.setTimeout(() => {
        if (pinnedCloseArmed.current === selectedId) pinnedCloseArmed.current = null;
      }, PIN_CONFIRM_MS);
      return;
    }
    pinnedCloseArmed.current = null;
    close(selectedId);
  }, [close, selectedId]);

  const reopenLast = useCallback(() => {
    const last = closed.current[0];
    if (!last) return;
    closed.current = closed.current.slice(1);
    setClosedCount(closed.current.length);
    if (byId.get(last.docId)?.archivedAt !== null) return;
    const current = tabsRef.current;
    if (!current.some((tab) => tab.docId === last.docId)) {
      const next = current.slice();
      next.splice(Math.min(last.index, next.length), 0, {
        docId: last.docId,
        preview: false,
        pinned: false,
      });
      commit(next);
    }
    select(last.docId);
  }, [byId, commit, select]);

  const cycle = useCallback(
    (direction: 1 | -1) => {
      const current = tabsRef.current;
      if (current.length === 0) return;
      const at = current.findIndex((tab) => tab.docId === selectedId);
      const next = current[(at + direction + current.length) % current.length];
      if (next) select(next.docId);
    },
    [select, selectedId],
  );

  const jump = useCallback(
    (position: number) => {
      const current = tabsRef.current;
      const tab = position === 9 ? current.at(-1) : current[position - 1];
      if (tab) select(tab.docId);
    },
    [select],
  );

  const moveTab = useCallback(
    (from: number, to: number) => {
      const current = tabsRef.current;
      const source = current[from];
      if (!source || from === to) return;
      const next = current.slice();
      next.splice(from, 1);
      next.splice(to, 0, source);
      commit(next);
    },
    [commit],
  );

  /**
   * Reordering without the mouse. The tree has `Alt+↑/↓` among siblings and
   * the strip had nothing, which made drag the only way to arrange it.
   *
   * A move that would carry a tab across the pinned boundary is declined
   * rather than attempted: `commit` sorts pinned tabs left on the way out, so
   * making the move would leave the strip exactly as it was and read as a
   * dropped keypress rather than as a refused one.
   */
  const moveActive = useCallback(
    (direction: 1 | -1) => {
      const current = tabsRef.current;
      const from = current.findIndex((tab) => tab.docId === selectedId);
      if (from === -1) return;
      const source = current[from];
      const target = current[from + direction];
      if (!source || !target || source.pinned !== target.pinned) return;
      moveTab(from, from + direction);
    },
    [moveTab, selectedId],
  );

  const togglePin = useCallback(
    (docId: string) => {
      commit(
        tabsRef.current.map((tab) =>
          tab.docId === docId ? { ...tab, pinned: !tab.pinned, preview: false } : tab,
        ),
      );
    },
    [commit],
  );

  const value = useMemo<TabsApi>(
    () => ({
      tabs,
      activeId: selectedId,
      open,
      promote,
      close,
      closeOthers,
      closeToRight,
      closeAll,
      closeActive,
      canReopen: closedCount > 0,
      reopenLast,
      cycle,
      jump,
      moveTab,
      moveActive,
      togglePin,
    }),
    [
      tabs,
      closedCount,
      selectedId,
      open,
      promote,
      close,
      closeOthers,
      closeToRight,
      closeAll,
      closeActive,
      reopenLast,
      cycle,
      jump,
      moveTab,
      moveActive,
      togglePin,
    ],
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsApi {
  const value = useContext(TabsContext);
  if (!value) throw new Error('useTabs outside TabsProvider');
  return value;
}

/** At most one preview tab exists; a new one takes the old one's place. */
function withPreview(tabs: Tab[], tab: Tab): Tab[] {
  const at = tabs.findIndex((entry) => entry.preview);
  if (at === -1) return [...tabs, tab];
  const next = tabs.slice();
  next[at] = tab;
  return next;
}
