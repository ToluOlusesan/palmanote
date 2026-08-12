import { PushPin, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type DragEvent } from 'react';

import { useLibrary } from '../state/library.tsx';
import { DocumentIcon } from './IconPicker.tsx';
import { useTabs } from '../state/tabs.tsx';

export function TabStrip({ onPick }: { onPick?: () => void }) {
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

  if (tabs.tabs.length === 0) return <div className="tabstrip" />;

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
    >
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
    </div>
  );
}
