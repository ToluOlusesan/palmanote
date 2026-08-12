import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  hint?: string;
  onSelect: () => void;
  /** Sets it apart and puts a rule above it. Delete is the only one. */
  destructive?: boolean;
  /** Present makes it a toggle: a tick appears in the gutter when true. */
  checked?: boolean;
  /** Shown under the label, for switches whose consequence is not obvious. */
  note?: string;
  /** Stays open after being chosen — for toggles you may want several of. */
  keepOpen?: boolean;
}

/**
 * A small menu anchored to a point, for tree rows.
 *
 * Deliberately not a general menu system: one level, no submenus, no icons.
 * It exists because archiving used to be reachable only by pressing Backspace
 * on a focused row, which is not a thing anyone discovers.
 */
export function RowMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [active, setActive] = useState(0);

  // Flip rather than overflow: a menu opened near the bottom of the window
  // grows upwards instead of off the screen.
  useLayoutEffect(() => {
    const node = menu.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    setPosition({
      left: Math.min(x, window.innerWidth - width - 8),
      top: y + height > window.innerHeight - 8 ? Math.max(8, y - height) : y,
    });
    node.focus();
  }, [x, y]);

  useEffect(() => {
    // Resize only. Listening for scroll in the capture phase closed the menu
    // whenever anything scrolled, and back when the editor still scrolled
    // itself that shut the menu the moment it opened. The scrim already stops
    // the writer from scrolling anything behind it.
    const dismiss = () => onClose();
    window.addEventListener('resize', dismiss);
    return () => window.removeEventListener('resize', dismiss);
  }, [onClose]);

  const choose = (item: MenuItem) => {
    if (!item.keepOpen) onClose();
    item.onSelect();
  };

  return (
    <div className="menu-scrim" onMouseDown={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div
        className="menu"
        role="menu"
        tabIndex={-1}
        ref={menu}
        style={{ left: position.left, top: position.top }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((current) => (current + 1) % items.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((current) => (current - 1 + items.length) % items.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const item = items[active];
            if (item) choose(item);
          }
        }}
      >
        {items.map((item, index) => (
          <button
            key={item.label}
            type="button"
            className={[
              'menu-item',
              item.destructive ? 'is-destructive' : '',
              index === active ? 'is-active' : '',
              item.checked !== undefined ? 'is-checkable' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(item)}
          >
            <span className="menu-label">
              {item.checked !== undefined && (
                <span className="menu-tick" aria-hidden="true">
                  {item.checked ? '✓' : ''}
                </span>
              )}
              <span>
                {item.label}
                {item.note && <span className="menu-note">{item.note}</span>}
              </span>
            </span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
