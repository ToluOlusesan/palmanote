import { CalendarBlank, CaretDown, Check } from '@phosphor-icons/react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { formatMonth } from '../core/activity.ts';

/**
 * The month the writing panel is showing.
 *
 * A listbox of ours rather than a `<select>`. The native control draws its
 * popup with the operating system, which means the app's one dark surface gets
 * a white list with a Windows-blue highlight sitting on top of it — the one
 * piece of the interface the stylesheet cannot reach.
 *
 * Everything a `<select>` gives away for free has to be put back by hand, and
 * this is the list of it: `listbox`/`option` roles, arrow keys, Home and End,
 * Enter and Escape, focus returned to the button on close, the open list
 * scrolled to the current month, and a click anywhere else dismissing it.
 */
export function MonthPicker({
  months,
  value,
  onChange,
}: {
  /** Oldest first, as `monthsUpTo` returns them. */
  months: string[];
  value: string;
  onChange: (month: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, months.indexOf(value)));
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();

  // Opening lands on the month being shown, wherever it is in the list.
  useEffect(() => {
    if (open) setActive(Math.max(0, months.indexOf(value)));
  }, [months, open, value]);

  /**
   * The newest month is at the bottom, so a list of two years opens scrolled to
   * the end rather than at a January nobody asked about.
   *
   * `scrollTop` by hand rather than `scrollIntoView`, which scrolls *every*
   * scrollable ancestor: the panel itself scrolls when the window is short, so
   * asking the browser to bring an option into view took the whole dialog with
   * it and pushed its own header off the top of the screen.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const box = list.current;
    const chosen = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (box && chosen) {
      const above = chosen.offsetTop;
      const below = above + chosen.offsetHeight;
      if (below > box.scrollTop + box.clientHeight) box.scrollTop = below - box.clientHeight;
      else if (above < box.scrollTop) box.scrollTop = above;
    }
    box?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!button.current?.parentElement?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', dismiss);
    return () => window.removeEventListener('mousedown', dismiss);
  }, [open]);

  const choose = (index: number) => {
    const month = months[index];
    if (month) onChange(month);
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: months.length - 1,
    };
    if (event.key === 'Escape') {
      // Stopped here, or the panel behind this would close with it.
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(active);
      return;
    }
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(Math.max(0, Math.min(months.length - 1, next)));
  };

  return (
    <div className="monthpick">
      <button
        type="button"
        ref={button}
        className={`monthpick-button${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Month: ${formatMonth(value)}`}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <CalendarBlank size={15} />
        <span>{formatMonth(value)}</span>
        <CaretDown size={13} />
      </button>

      {open && (
        <ul
          className="monthpick-list"
          id={listId}
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-label="Month"
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onKeyDown}
        >
          {months.map((month, index) => (
            <li
              key={month}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={month === value}
              className={`monthpick-option${index === active ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              {formatMonth(month)}
              {month === value && <Check size={13} weight="bold" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
