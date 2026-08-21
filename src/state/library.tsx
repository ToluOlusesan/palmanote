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

import {
  buildTree,
  flattenAll,
  flattenVisible,
  treeWordCount,
  type TreeNode,
  type VisibleRow,
} from '../core/tree.ts';
import type { DocumentKind, DocumentMeta, PMDoc } from '../core/types.ts';
import { store } from '../data/index.ts';
import type { CreateDocumentInput, MoveDocumentInput } from '../data/store.ts';
import { wordCountOf } from '../core/pmText.ts';
import { recoverPending } from './pending.ts';

const UI_STATE_KEY = 'palmanote:ui';

/** How far back you can go. Long enough to never notice, short enough to bound. */
const NAV_LIMIT = 100;

interface Nav {
  stack: string[];
  index: number;
  /** Entries dropped off the front by NAV_LIMIT, so browser indices stay absolute. */
  base: number;
}

interface UiState {
  selectedId: string | null;
  expanded: string[];
  treeVisible: boolean;
  /** The rail of notes and comments down the right. */
  railVisible: boolean;
}

function readUiState(): UiState {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return { selectedId: null, expanded: [], treeVisible: true, railVisible: true };
    const parsed = JSON.parse(raw) as Partial<UiState>;
    return {
      selectedId: parsed.selectedId ?? null,
      expanded: Array.isArray(parsed.expanded) ? parsed.expanded : [],
      treeVisible: parsed.treeVisible ?? true,
      railVisible: parsed.railVisible ?? true,
    };
  } catch {
    return { selectedId: null, expanded: [], treeVisible: true, railVisible: true };
  }
}

export interface Library {
  ready: boolean;
  docs: DocumentMeta[];
  byId: ReadonlyMap<string, DocumentMeta>;
  tree: TreeNode[];
  visible: VisibleRow[];
  archived: DocumentMeta[];
  favorites: DocumentMeta[];
  totalWords: number;
  selectedId: string | null;
  /** Ancestors of the open page, outermost first, including the page itself. */
  trail: DocumentMeta[];
  canGoBack: boolean;
  canGoForward: boolean;
  expanded: ReadonlySet<string>;
  treeVisible: boolean;
  /** The rail of notes and comments down the right of the window. */
  railVisible: boolean;

  select(id: string | null): void;
  goBack(): void;
  goForward(): void;
  setExpanded(id: string, expanded: boolean): void;
  setTreeVisible(visible: boolean): void;
  setRailVisible(visible: boolean): void;

  /**
   * `follow` defaults to true: making a page normally means going to it. The
   * one caller that says otherwise is an `@` mention, which makes a page from
   * the middle of a sentence and has to leave the caret in that sentence.
   */
  create(input: CreateDocumentInput, options?: { follow?: boolean }): Promise<DocumentMeta>;
  /**
   * Fires after a page is created inside another. The open editor listens and
   * drops a link to the new page at the caret, so the parent keeps its own
   * table of contents without anyone maintaining one.
   */
  onSubpage(listener: (event: { parentId: string; id: string }) => void): () => void;
  rename(id: string, title: string): Promise<void>;
  setKind(id: string, kind: DocumentKind): Promise<void>;
  toggleFavorite(id: string): Promise<void>;
  setIcon(id: string, icon: string | null): Promise<void>;
  /**
   * The page's banner. `cover` is an asset id already in the library — the
   * picker stores the bytes first — and `offset` is the band of it to show,
   * 0–100. Passing null takes the banner off.
   */
  setCover(id: string, cover: string | null, offset?: number): Promise<void>;
  move(input: MoveDocumentInput): Promise<void>;
  archive(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  /** Permanent. Takes the subtree with it. Only reachable from the archive. */
  destroy(id: string): Promise<void>;
  /** Writes a body into a page the editor has not opened yet. */
  saveInitialContent(id: string, content: PMDoc): Promise<void>;
  /** Re-reads the whole library. For bulk writes, like an import. */
  refresh(): Promise<void>;
  /** The editor reports back after a save so the tree's word counts stay true. */
  applyMeta(meta: DocumentMeta): void;
}

const LibraryContext = createContext<Library | null>(null);

/**
 * Boot runs exactly once per page load, module-scoped rather than
 * effect-scoped: React's development double-mount would otherwise race the
 * first-run seed and create two documents.
 */
let bootPromise: Promise<DocumentMeta[]> | null = null;

function boot(): Promise<DocumentMeta[]> {
  bootPromise ??= (async () => {
    // Ask the browser not to evict the manuscript under storage pressure.
    void navigator.storage?.persist?.();
    await recoverPending();
    const loaded = await store.listDocuments();
    if (loaded.length > 0) return loaded;
    // First run opens on a blank page rather than an empty room.
    return [await store.createDocument({ parentId: null, title: '' })];
  })();
  return bootPromise;
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const initialUi = useRef(readUiState()).current;
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [ready, setReady] = useState(false);
  // Navigation history. The stack of visited page ids is ours; the browser's
  // own history mirrors it by index, so the back button, the mouse's back
  // button, and Alt+Left all end up in the same place. In the Electron build
  // the popstate half simply never fires and the rest works unchanged.
  const [nav, setNav] = useState<Nav>(() =>
    initialUi.selectedId
      ? { stack: [initialUi.selectedId], index: 0, base: 0 }
      : { stack: [], index: -1, base: 0 },
  );
  const selectedId = nav.index >= 0 ? (nav.stack[nav.index] ?? null) : null;
  const [expanded, setExpandedSet] = useState<ReadonlySet<string>>(() => new Set(initialUi.expanded));
  const [treeVisible, setTreeVisible] = useState(initialUi.treeVisible);
  // Kept here beside the sidebar's own visibility rather than in the notes
  // hook: this is where the window is laid out, and the hook is about storage.
  const [railVisible, setRailVisible] = useState(initialUi.railVisible);

  // The ref mirrors nav so navigation can read the current stack, touch
  // history, and set state in one go. Doing any of that inside a setState
  // updater would run it twice — React deliberately double-invokes updaters —
  // and every navigation would leave two browser entries behind.
  const navRef = useRef(nav);
  const commitNav = useCallback((next: Nav) => {
    navRef.current = next;
    setNav(next);
  }, []);

  useEffect(() => {
    history.replaceState({ navIndex: navRef.current.base + navRef.current.index }, '');
    const onPopState = (event: PopStateEvent) => {
      const absolute = (event.state as { navIndex?: number } | null)?.navIndex;
      if (typeof absolute !== 'number') return;
      const current = navRef.current;
      commitNav({
        ...current,
        index: Math.max(0, Math.min(absolute - current.base, current.stack.length - 1)),
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [commitNav]);

  const select = useCallback(
    (id: string | null) => {
      const current = navRef.current;
      const currentId = current.index >= 0 ? current.stack[current.index] : null;
      if (id === currentId) return;
      if (id === null) {
        commitNav({ stack: [], index: -1, base: current.base });
        return;
      }
      const merged = [...current.stack.slice(0, current.index + 1), id];
      const dropped = Math.max(0, merged.length - NAV_LIMIT);
      const stack = merged.slice(dropped);
      const base = current.base + dropped;
      const index = stack.length - 1;
      history.pushState({ navIndex: base + index }, '');
      commitNav({ stack, index, base });
    },
    [commitNav],
  );

  /** Swaps the current entry without adding to history — for corrections. */
  const replaceSelection = useCallback(
    (id: string | null) => {
      const current = navRef.current;
      if (id === null) {
        commitNav({ stack: [], index: -1, base: current.base });
        return;
      }
      if (current.index < 0) {
        history.replaceState({ navIndex: current.base }, '');
        commitNav({ stack: [id], index: 0, base: current.base });
        return;
      }
      if (current.stack[current.index] === id) return;
      const stack = current.stack.slice();
      stack[current.index] = id;
      commitNav({ ...current, stack });
    },
    [commitNav],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await boot();
      if (cancelled) return;
      setDocs(loaded);
      setReady(true);
      void store.pruneRevisions();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subpageListeners = useRef(new Set<(event: { parentId: string; id: string }) => void>());

  const applyMeta = useCallback((meta: DocumentMeta) => {
    setDocs((current) => {
      const index = current.findIndex((d) => d.id === meta.id);
      if (index === -1) return [...current, meta];
      const next = current.slice();
      next[index] = meta;
      return next;
    });
  }, []);

  const tree = useMemo(() => buildTree(docs), [docs]);
  const visible = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);
  const byId = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);
  const archived = useMemo(
    () => docs.filter((d) => d.archivedAt !== null).sort((a, b) => b.archivedAt! - a.archivedAt!),
    [docs],
  );
  const totalWords = useMemo(() => treeWordCount(tree), [tree]);

  const liveIds = useMemo(() => new Set(flattenAll(tree).map((node) => node.doc.id)), [tree]);

  // Favourites are only ever pages you could still reach in the tree.
  const favorites = useMemo(
    () =>
      docs
        .filter((doc) => doc.favorite && liveIds.has(doc.id))
        .sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled')),
    [docs, liveIds],
  );

  // Selection must always point at something reachable. Landing on an archived
  // page corrects in place rather than pushing another history entry.
  useEffect(() => {
    if (!ready || (selectedId && liveIds.has(selectedId))) return;
    // Archiving the open page lands you on its nearest surviving ancestor,
    // which is where you were looking, not at the top of the sidebar.
    let ancestor: string | null = null;
    let node = selectedId ? byId.get(selectedId) : undefined;
    while (node?.parentId) {
      if (liveIds.has(node.parentId)) {
        ancestor = node.parentId;
        break;
      }
      node = byId.get(node.parentId);
    }
    replaceSelection(ancestor ?? tree[0]?.doc.id ?? null);
  }, [ready, selectedId, liveIds, byId, tree, replaceSelection]);

  const trail = useMemo(() => {
    const out: DocumentMeta[] = [];
    let node = selectedId ? byId.get(selectedId) : undefined;
    while (node) {
      out.unshift(node);
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    return out;
  }, [selectedId, byId]);

  useEffect(() => {
    const state: UiState = { selectedId, expanded: [...expanded], treeVisible, railVisible };
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
  }, [selectedId, expanded, treeVisible, railVisible]);

  const setExpanded = useCallback((id: string, isExpanded: boolean) => {
    setExpandedSet((current) => {
      const next = new Set(current);
      if (isExpanded) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const value = useMemo<Library>(
    () => ({
      ready,
      docs,
      byId,
      tree,
      visible,
      archived,
      favorites,
      totalWords,
      selectedId,
      trail,
      canGoBack: nav.index > 0,
      canGoForward: nav.index < nav.stack.length - 1,
      expanded,
      treeVisible,
      railVisible,
      setRailVisible,
      select,
      goBack: () => history.back(),
      goForward: () => history.forward(),
      setExpanded,
      setTreeVisible,
      async create(input, options) {
        const follow = options?.follow !== false;
        const meta = await store.createDocument(input);
        applyMeta(meta);
        if (input.parentId) {
          setExpanded(input.parentId, true);
          // The subpage listener is what drops a link at the caret, and it is
          // only right when the caret is about to be left behind. A mention
          // writes its own link, with the title it just typed.
          if (follow) {
            for (const listener of subpageListeners.current) {
              listener({ parentId: input.parentId, id: meta.id });
            }
          }
        }
        if (follow) select(meta.id);
        return meta;
      },
      onSubpage(listener) {
        subpageListeners.current.add(listener);
        return () => subpageListeners.current.delete(listener);
      },
      async rename(id, title) {
        applyMeta(await store.renameDocument(id, title));
      },
      async setKind(id, kind) {
        applyMeta(await store.setKind(id, kind));
      },
      async setIcon(id, icon) {
        applyMeta(await store.setIcon(id, icon));
      },
      async setCover(id, cover, offset) {
        // Dropping a cover keeps the offset it had. Coming back to a picture
        // you took off should put it back where you had dragged it, and the
        // column costs nothing to leave alone.
        const current = byId.get(id);
        applyMeta(await store.setCover(id, cover, offset ?? current?.coverOffset ?? 50));
      },
      async toggleFavorite(id) {
        const current = byId.get(id);
        applyMeta(await store.setFavorite(id, !current?.favorite));
      },
      async move(input) {
        applyMeta(await store.moveDocument(input));
        if (input.parentId) setExpanded(input.parentId, true);
      },
      async archive(id) {
        applyMeta(await store.archiveDocument(id));
      },
      async restore(id) {
        const meta = await store.restoreDocument(id);
        applyMeta(meta);
        select(meta.id);
      },
      async destroy(id) {
        const gone = new Set(await store.deleteDocument(id));
        setDocs((current) => current.filter((doc) => !gone.has(doc.id)));
        // Deleting for good is the one thing that can orphan a lot of image
        // bytes at once, and the only moment it is safe to sweep them: an
        // asset is reachable from any document *or any revision*, so this has
        // to read the whole library to be sure, and it is not worth doing on a
        // timer for the sake of a picture nobody deleted.
        void store.collectAssets();
      },
      async saveInitialContent(id, content) {
        applyMeta(
          await store.saveContent({ id, content, wordCount: wordCountOf(content), snapshot: true }),
        );
      },
      async refresh() {
        setDocs(await store.listDocuments());
      },
      applyMeta,
    }),
    [
      ready,
      docs,
      byId,
      tree,
      visible,
      archived,
      favorites,
      totalWords,
      selectedId,
      trail,
      nav,
      expanded,
      treeVisible,
      railVisible,
      select,
      setExpanded,
      applyMeta,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): Library {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('useLibrary outside LibraryProvider');
  return value;
}
