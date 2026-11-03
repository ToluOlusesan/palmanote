import { Plus, PushPin, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';

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
  const [dragWidth, setDragWidth] = useState(0);
  /** A drag that ended without a drop: the tabs slide home rather than snap. */
  const [returning, setReturning] = useState(false);
  const returnTimer = useRef<number | undefined>(undefined);
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

  const endDrag = (dropped: boolean) => {
    // A drop lands every tab where it was already drawn — the shifted ones are
    // already standing in their new places — so it must not animate. Anything
    // else slides back home.
    if (!dropped && dragFrom.current !== null) {
      setReturning(true);
      window.clearTimeout(returnTimer.current);
      returnTimer.current = window.setTimeout(() => setReturning(false), 450);
    }
    dragFrom.current = null;
    setDropAt(null);
    setDragWidth(0);
  };

  /**
   * The insertion index under a pointer: how many tabs it is past the middle of.
   *
   * Read from layout (`offsetLeft`), never from `getBoundingClientRect`. While a
   * tab is in the air its neighbours are slid aside by a transform, and a
   * transformed box moves under a pointer that has not — so measuring the
   * drawn boxes made the slot flip back and forth and the drop land one short.
   * Layout ignores transforms, so these midpoints stay put for the whole drag.
   */
  const dropIndexAt = (clientX: number): number => {
    const strip = stripRef.current;
    if (!strip) return tabs.tabs.length;
    const x = clientX - strip.getBoundingClientRect().left - strip.clientLeft + strip.scrollLeft;
    let index = 0;
    for (const el of strip.querySelectorAll<HTMLElement>('.tab[data-index]')) {
      if (el.offsetLeft + el.offsetWidth / 2 < x) index = Number(el.dataset.index) + 1;
    }
    return index;
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
      ref={stripRef}
      role="tablist"
      aria-label="Open documents"
      // The strip itself takes the drag too. Without this the gaps between
      // tabs, and the empty run to the right of the last one, are dead
      // ground — cross one and the cursor says no.
      className={`tabstrip${dragFrom.current !== null ? ' is-dragging' : ''}${returning ? ' is-returning' : ''}`}
      onDragOver={(event) => {
        if (!allowDrop(event)) return;
        const at = dropIndexAt(event.clientX);
        setDropAt((current) => (current === at ? current : at));
      }}
      onDrop={(event) => {
        if (!allowDrop(event)) return;
        const from = dragFrom.current!;
        const at = dropIndexAt(event.clientX);
        const target = at > from ? at - 1 : at;
        if (target !== from) tabs.moveTab(from, target);
        endDrag(true);
      }}
      onDragEnd={() => endDrag(false)}
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
        const shiftingLeft = dragFrom.current !== null && dropAt !== null && dragFrom.current < dropAt && index > dragFrom.current && index < dropAt;
        const shiftingRight = dragFrom.current !== null && dropAt !== null && dragFrom.current > dropAt && index >= dropAt && index < dragFrom.current;
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
              dragFrom.current === index && 'is-dragging',
              shiftingLeft && 'is-shifting-left',
              shiftingRight && 'is-shifting-right',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ '--tab-drag-width': `${dragWidth}px` } as CSSProperties}
            data-index={index}
            draggable
            onDragStart={(event) => {
              dragFrom.current = index;
              window.clearTimeout(returnTimer.current);
              setReturning(false);
              setDragWidth(event.currentTarget.getBoundingClientRect().width);
              event.dataTransfer.effectAllowed = 'move';
              // Firefox starts no drag at all without payload, and the id is
              // the honest thing to carry.
              event.dataTransfer.setData('text/plain', tab.docId);
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
