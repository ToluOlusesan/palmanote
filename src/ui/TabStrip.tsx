import { Plus, PushPin, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type DragEvent } from 'react';

import { useLibrary } from '../state/library.tsx';
import { DocumentIcon } from './IconPicker.tsx';
import { useTabs } from '../state/tabs.tsx';
import { RowMenu, type MenuItem } from './RowMenu.tsx';

export function TabStrip({ onPick, onNew }: { onPick?: () => void; onNew?: () => void }) {
  const { byId } = useLibrary();
  const tabs = useTabs();
  const stripRef = useRef<HTMLDivElement>(null);
  /**
   * A ref, not state, and that is the whole of it: `dragstart` and the first
   * `dragover` can land in the same commit, so a handler reading state would
   * still see the value from before the drag began, decline to
   * `preventDefault`, and get the drag rejected — which is the browser drawing
   * the no-drop cursor and never letting go of it.
   */
  const dragFrom = useRef<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ docId: string | null; x: number; y: number } | null>(null);

  // Keep the active tab in view when it changes by keyboard.
  useEffect(() => {
    if (!tabs.activeId) return;
    stripRef.current
      ?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(tabs.activeId)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tabs.activeId]);

  /**
   * Says yes to the drop, in the two ways a browser needs to hear it: cancel
   * the default — which is refusal — and name the effect, because with
   * `effectAllowed` set to move and `dropEffect` left alone the negotiation
   * can still resolve to none.
   */
  const allowDrop = (event: DragEvent<HTMLElement>): boolean => {
    if (dragFrom.current === null) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    return true;
  };

  const endDrag = () => {
    dragFrom.current = null;
    setDropAt(null);
  };

  /**
   * The `+` at the end of the run, which is where every browser keeps it.
   *
   * Rendered even when there are no tabs at all, because an empty strip is
   * exactly when a way to start one is worth having — and it is the only
   * visible route to a new page that does not go through the sidebar.
   */
  const newTab = onNew ? (
    <button
      type="button"
      className="tab-new"
      aria-label="New page"
      title="New page — Ctrl+T"
      onClick={onNew}
    >
      <Plus size={14} weight="bold" />
    </button>
  ) : null;

  const menuItems = (docId: string | null): MenuItem[] => {
    const at = docId ? tabs.tabs.findIndex((tab) => tab.docId === docId) : -1;
    const tab = at >= 0 ? tabs.tabs[at] : undefined;
    const closableOthers = docId
      ? tabs.tabs.some((candidate) => candidate.docId !== docId && !candidate.pinned)
      : false;
    const closableRight =
      at >= 0 && tabs.tabs.slice(at + 1).some((candidate) => !candidate.pinned);
    const items: MenuItem[] = [];

    if (onNew) items.push({ label: 'New tab', hint: 'Ctrl+T', onSelect: onNew });
    if (tab) {
      items.push(
        {
          label: tab.pinned ? 'Unpin tab' : 'Pin tab',
          onSelect: () => tabs.togglePin(tab.docId),
        },
        { label: 'Close tab', hint: 'Ctrl+W', onSelect: () => tabs.close(tab.docId) },
        {
          label: 'Close other tabs',
          disabled: !closableOthers,
          onSelect: () => tabs.closeOthers(tab.docId),
        },
        {
          label: 'Close tabs to the right',
          disabled: !closableRight,
          onSelect: () => tabs.closeToRight(tab.docId),
        },
      );
    }
    items.push(
      {
        label: 'Reopen closed tab',
        hint: 'Ctrl+Shift+T',
        disabled: !tabs.canReopen,
        onSelect: tabs.reopenLast,
      },
      {
        label: 'Close all tabs',
        disabled: tabs.tabs.length === 0,
        onSelect: tabs.closeAll,
      },
    );
    return items;
  };

  if (tabs.tabs.length === 0) {
    return (
      <div
        className="tabstrip"
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ docId: null, x: event.clientX, y: event.clientY });
        }}
      >
        {newTab}
        {menu && (
          <RowMenu
            x={menu.x}
            y={menu.y}
            items={menuItems(null)}
            onClose={() => setMenu(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="tabstrip"
      ref={stripRef}
      role="tablist"
      aria-label="Open documents"
      // The strip itself takes the drag too. Without this the gaps between
      // tabs, and the empty run to the right of the last one, are dead
      // ground — cross one and the cursor says no.
      onDragOver={allowDrop}
      onDrop={(event) => {
        if (!allowDrop(event)) return;
        tabs.moveTab(dragFrom.current!, tabs.tabs.length - 1);
        endDrag();
      }}
      onDragEnd={endDrag}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ docId: null, x: event.clientX, y: event.clientY });
      }}
    >
      {menu && (
        <RowMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.docId)}
          onClose={() => setMenu(null)}
        />
      )}
      {tabs.tabs.map((tab, index) => {
        const doc = byId.get(tab.docId);
        if (!doc) return null;
        const active = tab.docId === tabs.activeId;
        const label = doc.title || 'Untitled';
        return (
          <div
            key={tab.docId}
            data-tab={tab.docId}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={label}
            className={[
              'tab',
              active && 'is-active',
              tab.preview && 'is-preview',
              tab.pinned && 'is-pinned',
              dropAt === index && 'is-drop',
            ]
              .filter(Boolean)
              .join(' ')}
            draggable
            onDragStart={(event) => {
              dragFrom.current = index;
              event.dataTransfer.effectAllowed = 'move';
              // Firefox starts no drag at all without payload, and the id is
              // the honest thing to carry.
              event.dataTransfer.setData('text/plain', tab.docId);
            }}
            onDragEnter={(event) => {
              if (allowDrop(event)) setDropAt(index);
            }}
            onDragOver={(event) => {
              if (allowDrop(event)) setDropAt(index);
            }}
            onDragEnd={endDrag}
            onDrop={(event) => {
              if (!allowDrop(event)) return;
              // The strip below would otherwise also take this drop and send
              // the tab to the end.
              event.stopPropagation();
              tabs.moveTab(dragFrom.current!, index);
              endDrag();
            }}
            onClick={() => {
              tabs.open(tab.docId, 'preview');
              onPick?.();
            }}
            onDoubleClick={() => tabs.promote(tab.docId)}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                tabs.close(tab.docId);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenu({ docId: tab.docId, x: event.clientX, y: event.clientY });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                tabs.open(tab.docId, 'preview');
              }
            }}
          >
            {/* Pinned tabs shrink to the icon alone, which is what makes a
                document icon worth having when eight tabs are open. */}
            <DocumentIcon icon={doc?.icon ?? null} kind={doc?.kind ?? 'note'} size={tab.pinned ? 16 : 14} />
            {tab.pinned && !doc?.icon && <PushPin size={14} weight="fill" className="tab-pin" />}
            {!tab.pinned && <span className="tab-label">{label}</span>}

            {!tab.pinned && (
              <button
                type="button"
                className="tab-close"
                tabIndex={-1}
                aria-label={`Close ${label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  tabs.close(tab.docId);
                }}
              >
                <X size={14} weight="bold" />
              </button>
            )}
          </div>
        );
      })}

      {newTab}
    </div>
  );
}
