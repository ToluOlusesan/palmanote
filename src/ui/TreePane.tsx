import { CaretRight, DotsThree, FilePlus, Star } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { findNode, isAncestor, siblingsOf, type TreeNode } from '../core/tree.ts';
import {
  copyPageLink,
  pageLinkHtml,
  pageUri,
  PAGE_DRAG_TYPE,
} from '../editor/pageLinkClipboard.ts';
import { useLibrary } from '../state/library.tsx';
import { useTabs } from '../state/tabs.tsx';
import { DocumentIcon, IconPicker } from './IconPicker.tsx';
import { RowMenu, type MenuItem } from './RowMenu.tsx';
import { PalmaMark } from './PalmaMark.tsx';

type DropZone = 'before' | 'after' | 'into';

interface DropTarget {
  id: string;
  zone: DropZone;
}

/**
 * `onOpen` is a page chosen outright — the caret goes with it. `onPreview` is
 * a page clicked while browsing, which shows it but leaves the focus here so
 * the arrow keys keep working. Both mean the greeting has been answered.
 */
export function TreePane({
  onOpen,
  onPreview,
  onImport,
  onHome,
}: {
  onOpen: () => void;
  onPreview: () => void;
  onImport: () => void;
  onHome: () => void;
}) {
  const library = useLibrary();
  const tabs = useTabs();
  const { tree, visible, selectedId } = library;
  const listRef = useRef<HTMLDivElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // Permanent deletion asks once, inline, rather than in a modal.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ id: string; x: number; y: number } | null>(null);

  const counts = useMemo(() => subtreeCounts(tree), [tree]);
  const index = useMemo(
    () => visible.findIndex((row) => row.doc.id === selectedId),
    [visible, selectedId],
  );

  const focusList = useCallback(() => listRef.current?.focus(), []);

  const drop = useCallback(
    (id: string, target: DropTarget) => {
      if (id === target.id || isAncestor(tree, id, target.id)) return;
      const node = findNode(tree, target.id);
      if (!node) return;
      if (target.zone === 'into') {
        void library.move({ id, parentId: target.id });
        return;
      }
      const siblings = siblingsOf(tree, node.doc.parentId);
      const at = siblings.findIndex((s) => s.doc.id === target.id);
      const afterId = target.zone === 'after' ? target.id : (siblings[at - 1]?.doc.id ?? null);
      void library.move({ id, parentId: node.doc.parentId, afterId });
    },
    [library, tree],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (renamingId) return;
      const row = index >= 0 ? visible[index] : undefined;
      const id = row?.doc.id;

      const step = (delta: number) => {
        const next = visible[Math.min(Math.max(index + delta, 0), visible.length - 1)];
        if (next) library.select(next.doc.id);
      };

      // Alt+Arrow reorders among siblings instead of navigating.
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        if (!row || !id) return;
        event.preventDefault();
        const siblings = siblingsOf(tree, row.doc.parentId);
        const at = siblings.findIndex((s) => s.doc.id === id);
        if (event.key === 'ArrowUp') {
          if (at <= 0) return;
          void library.move({ id, parentId: row.doc.parentId, afterId: siblings[at - 2]?.doc.id ?? null });
        } else {
          const next = siblings[at + 1];
          if (next) void library.move({ id, parentId: row.doc.parentId, afterId: next.doc.id });
        }
        return;
      }

      // Alt+Left/Right are back and forward, handled once at the window level.
      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          step(1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          step(-1);
          return;
        case 'ArrowRight':
          if (!row || !id) return;
          event.preventDefault();
          if (row.hasChildren && !row.expanded) library.setExpanded(id, true);
          else step(1);
          return;
        case 'ArrowLeft':
          if (!row || !id) return;
          event.preventDefault();
          if (row.hasChildren && row.expanded) library.setExpanded(id, false);
          else if (row.doc.parentId) library.select(row.doc.parentId);
          return;
        case 'Enter':
          if (!id) return;
          event.preventDefault();
          if (event.shiftKey) setRenamingId(id);
          else {
            tabs.open(id, 'permanent');
            onOpen();
          }
          return;
        case 'F2':
          if (!id) return;
          event.preventDefault();
          setRenamingId(id);
          return;
        case 'Tab': {
          if (!id || !row) return;
          event.preventDefault();
          if (event.shiftKey) {
            const parent = row.doc.parentId ? findNode(tree, row.doc.parentId) : null;
            if (parent) void library.move({ id, parentId: parent.doc.parentId, afterId: parent.doc.id });
          } else {
            const siblings = siblingsOf(tree, row.doc.parentId);
            const at = siblings.findIndex((s) => s.doc.id === id);
            const previous = siblings[at - 1];
            if (previous) void library.move({ id, parentId: previous.doc.id });
          }
          return;
        }
        case 'd':
        case 'D':
          if (!id || !event.ctrlKey) return;
          event.preventDefault();
          void library.toggleFavorite(id);
          return;
        case 'Backspace':
        case 'Delete':
          if (!id) return;
          event.preventDefault();
          void library.archive(id);
          return;
        default:
          return;
      }
    },
    [index, library, onOpen, renamingId, tabs, tree, visible],
  );

  useEffect(() => {
    if (!selectedId) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, visible.length]);

  const newDocument = useCallback(
    (asChild: boolean) => {
      const selected = selectedId ? library.byId.get(selectedId) : undefined;
      const parentId = asChild ? (selected?.id ?? null) : (selected?.parentId ?? null);
      void library
        .create({ parentId, afterId: asChild ? undefined : selectedId })
        .then((meta) => setRenamingId(meta.id));
    },
    [library, selectedId],
  );

  // Ctrl/Cmd+N makes a sibling, Ctrl/Cmd+Shift+N makes a child. Both open the
  // new page with its title ready to type, because a page without a name is
  // hard to find again.
  useEffect(() => {
    const onGlobalKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.key.toLowerCase() !== 'n') return;
      event.preventDefault();
      newDocument(event.shiftKey);
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, [newDocument]);

  const itemsFor = (id: string): MenuItem[] => {
    const doc = library.byId.get(id);
    if (!doc) return [];
    return [
      { label: 'Rename', hint: 'Enter', onSelect: () => setRenamingId(id) },
      {
        label: 'New page inside',
        hint: 'Ctrl+Shift+N',
        onSelect: () => {
          library.select(id);
          void library.create({ parentId: id }).then((meta) => setRenamingId(meta.id));
        },
      },
      {
        label: 'Copy link',
        onSelect: () => void copyPageLink(id, doc.title),
      },
      {
        label: doc.icon ? 'Change icon' : 'Add an icon',
        onSelect: () => {
          const node = listRef.current?.querySelector<HTMLElement>(`[data-id="${id}"] .row-icon`);
          const box = node?.getBoundingClientRect();
          setPicking({ id, x: box?.left ?? 200, y: (box?.bottom ?? 200) + 6 });
        },
      },
      {
        label: doc.favorite ? 'Remove from favourites' : 'Add to favourites',
        hint: 'Ctrl+D',
        onSelect: () => void library.toggleFavorite(id),
      },
      {
        label: 'Delete',
        hint: 'Backspace',
        destructive: true,
        onSelect: () => void library.archive(id),
      },
    ];
  };

  return (
    <nav className="tree" aria-label="Documents">
      {picking && (
        <IconPicker
          x={picking.x}
          y={picking.y}
          current={library.byId.get(picking.id)?.icon ?? null}
          onClose={() => setPicking(null)}
          onPick={(icon) => {
            setPicking(null);
            void library.setIcon(picking.id, icon);
          }}
        />
      )}

      {menu && (
        <RowMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={itemsFor(menu.id)}
        />
      )}

      {/* Draggable for the same reason the strip beside it is: it is the top
          edge of a frameless window, and until now the widest part of it did
          nothing. The two buttons inside are still buttons — see styles.css. */}
      <header className="tree-head" data-tauri-drag-region="deep">
        {/* The mark is the way back to the launch screen. Every app whose logo
            sits in a corner has taught that pressing it goes home, and this one
            has a home — the four starting points and the week's writing — that
            was previously reachable only by relaunching. */}
        <button
          type="button"
          className="tree-home"
          aria-label="Home — the launch screen"
          title="Home"
          onClick={onHome}
        >
          <PalmaMark size={22} />
        </button>
        <span className="visually-hidden">PalmaNote</span>
        <button
          type="button"
          className="ghost tree-import"
          title="Bring in markdown, Word documents, or a snapshot — Ctrl+Shift+I"
          onClick={onImport}
        >
          Import
        </button>
      </header>

      {library.favorites.length > 0 && (
        <>
          <p className="section">Favourites</p>
          <div className="favourites">
            {library.favorites.map((doc) => (
              <div
                key={doc.id}
                className={`row is-flat${doc.id === selectedId ? ' is-selected' : ''}`}
                onClick={() => {
                  tabs.open(doc.id, 'preview');
                  onPreview();
                  focusList();
                }}
                onDoubleClick={() => tabs.open(doc.id, 'permanent')}
              >
                <DocumentIcon icon={doc.icon} kind={doc.kind} size={15} />
                <span className="row-title">{doc.title || <span className="untitled">Untitled</span>}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="section">Pages</p>

      <div
        className="tree-list"
        role="tree"
        tabIndex={0}
        ref={listRef}
        onKeyDown={onKeyDown}
        onDragLeave={() => setDropTarget(null)}
      >
        {visible.map((row) => {
          const isSelected = row.doc.id === selectedId;
          const isDropping = dropTarget?.id === row.doc.id;
          return (
            <div
              key={row.doc.id}
              data-id={row.doc.id}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-selected={isSelected}
              aria-expanded={row.hasChildren ? row.expanded : undefined}
              className={[
                'row',
                isSelected && 'is-selected',
                draggingId === row.doc.id && 'is-dragging',
                isDropping && `drop-${dropTarget.zone}`,
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ paddingLeft: `${0.6 + row.depth * 0.9}rem` }}
              draggable={renamingId !== row.doc.id}
              onDragStart={(event) => {
                setDraggingId(row.doc.id);
                // Inside the tree this is a move; over the page the private
                // flavour becomes a live page link. The portable flavours are
                // honest when the drag leaves PalmaNote altogether.
                event.dataTransfer.effectAllowed = 'copyMove';
                event.dataTransfer.setData(PAGE_DRAG_TYPE, row.doc.id);
                event.dataTransfer.setData('text/plain', pageUri(row.doc.id));
                event.dataTransfer.setData('text/html', pageLinkHtml(row.doc.id, row.doc.title));
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDropTarget(null);
              }}
              onDragOver={(event) => {
                if (!draggingId || draggingId === row.doc.id) return;
                if (isAncestor(tree, draggingId, row.doc.id)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = (event.clientY - rect.top) / rect.height;
                setDropTarget({
                  id: row.doc.id,
                  zone: ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'into',
                });
              }}
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData(PAGE_DRAG_TYPE) || draggingId;
                if (id && dropTarget) drop(id, dropTarget);
                setDropTarget(null);
                setDraggingId(null);
              }}
              onClick={() => {
                tabs.open(row.doc.id, 'preview');
                onPreview();
                focusList();
              }}
              onDoubleClick={() => tabs.open(row.doc.id, 'permanent')}
              onContextMenu={(event) => {
                event.preventDefault();
                library.select(row.doc.id);
                setMenu({ id: row.doc.id, x: event.clientX, y: event.clientY });
              }}
            >
              {row.hasChildren ? (
                <button
                  type="button"
                  className={`twisty${row.expanded ? ' is-open' : ''}`}
                  tabIndex={-1}
                  aria-label={row.expanded ? 'Collapse' : 'Expand'}
                  onClick={(event) => {
                    event.stopPropagation();
                    library.setExpanded(row.doc.id, !row.expanded);
                  }}
                >
                  {/* One glyph that turns, rather than two that swap. The
                      rotation is the only thing that says which way the row
                      just went. */}
                  <CaretRight size={13} weight="bold" />
                </button>
              ) : (
                <span className="twisty" aria-hidden="true" />
              )}

              {renamingId === row.doc.id ? (
                <RenameField
                  initial={row.doc.title}
                  onCommit={(title) => {
                    void library.rename(row.doc.id, title);
                    setRenamingId(null);
                    focusList();
                  }}
                  onCancel={() => {
                    setRenamingId(null);
                    focusList();
                  }}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className="row-icon"
                    tabIndex={-1}
                    aria-label={row.doc.icon ? 'Change icon' : 'Add an icon'}
                    title={row.doc.icon ? 'Change icon' : 'Add an icon'}
                    onClick={(event) => {
                      event.stopPropagation();
                      const box = event.currentTarget.getBoundingClientRect();
                      setPicking({ id: row.doc.id, x: box.left, y: box.bottom + 6 });
                    }}
                  >
                    <DocumentIcon icon={row.doc.icon} kind={row.doc.kind} />
                  </button>
                  <span className={`row-title kind-${row.doc.kind}`}>
                    {row.doc.title || <span className="untitled">Untitled</span>}
                  </span>
                </>
              )}

              <button
                type="button"
                className={`row-star${row.doc.favorite ? ' is-on' : ''}`}
                tabIndex={-1}
                aria-label={row.doc.favorite ? 'Remove from favourites' : 'Add to favourites'}
                aria-pressed={row.doc.favorite}
                onClick={(event) => {
                  event.stopPropagation();
                  void library.toggleFavorite(row.doc.id);
                }}
              >
                <Star size={14} weight={row.doc.favorite ? 'fill' : 'regular'} />
              </button>
              <button
                type="button"
                className="row-add"
                tabIndex={-1}
                aria-label="Add a page inside"
                title="Add a page inside"
                onClick={(event) => {
                  event.stopPropagation();
                  library.select(row.doc.id);
                  void library.create({ parentId: row.doc.id }).then((meta) => setRenamingId(meta.id));
                }}
              >
                <FilePlus size={15} />
              </button>
              <button
                type="button"
                className="row-add"
                tabIndex={-1}
                aria-label="More actions"
                title="More actions"
                onClick={(event) => {
                  event.stopPropagation();
                  const box = event.currentTarget.getBoundingClientRect();
                  setMenu({ id: row.doc.id, x: box.left, y: box.bottom + 4 });
                }}
              >
                <DotsThree size={17} weight="bold" />
              </button>
              <span className="row-count">
                {(counts.get(row.doc.id) ?? 0) > 0 ? formatCount(counts.get(row.doc.id) ?? 0) : ''}
              </span>
            </div>
          );
        })}
      </div>

      <button type="button" className="add-row" title="New page — Ctrl+N" onClick={() => newDocument(false)}>
        <FilePlus size={18} />
        Add page
      </button>

      <footer className="tree-foot">
        <button
          type="button"
          className="ghost"
          aria-expanded={showArchive}
          onClick={() => setShowArchive((open) => !open)}
        >
          Archive{library.archived.length > 0 ? ` (${library.archived.length})` : ''}
        </button>
        <span className="total">{formatCount(library.totalWords)} words</span>
      </footer>

      {showArchive && (
        <div className="archive">
          {library.archived.length === 0 ? (
            <p className="archive-empty">
              Deleted pages leave the sidebar and wait here. Nothing goes for good until you say so.
            </p>
          ) : (
            library.archived.map((doc) => (
              <div className="archive-row" key={doc.id}>
                <span className="row-title">{doc.title || <span className="untitled">Untitled</span>}</span>
                {confirming === doc.id ? (
                  <>
                    <button
                      type="button"
                      className="ghost is-destructive"
                      onClick={() => {
                        setConfirming(null);
                        void library.destroy(doc.id);
                      }}
                    >
                      Delete for good
                    </button>
                    <button type="button" className="ghost" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="ghost" onClick={() => void library.restore(doc.id)}>
                      Restore
                    </button>
                    <button
                      type="button"
                      className="ghost is-destructive"
                      title="Delete permanently, with everything inside it"
                      onClick={() => setConfirming(doc.id)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </nav>
  );
}

function RenameField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      className="rename"
      autoFocus
      aria-label="Document title"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onCommit(value.trim())}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // No stopPropagation: the tree's own handler already stands down while
        // a rename is open, and swallowing the event here would also swallow
        // the window-level shortcuts.
        if (event.key === 'Enter') onCommit(value.trim());
        if (event.key === 'Escape') onCancel();
      }}
    />
  );
}

/** One bottom-up pass: each node reuses its children's totals. */
function subtreeCounts(tree: TreeNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      walk(node.children);
      const total = node.children.reduce((sum, child) => sum + (counts.get(child.doc.id) ?? 0), 0);
      counts.set(node.doc.id, node.doc.wordCount + total);
    }
  };
  walk(tree);
  return counts;
}

export function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}
