import { useCallback, useRef, useState } from 'react';

import {
  currentWeek,
  formatDay,
  formatMonth,
  formatSpell,
  formatWords,
  monthOf,
  weekdayHeads,
  type Cell,
} from '../core/activity.ts';
import type { ActivityDay } from '../core/types.ts';

/**
 * The writing chart, in its two sizes.
 *
 * Neither is a year. A year of days is three hundred and sixty-five squares,
 * which is a wall to read rather than a thing to glance at, and a glance is
 * the whole job. So the launch strip is the week you are in — seven squares,
 * taken in without reading — and the panel is one month at a time, in the
 * calendar shape everyone can already read, with a dropdown to go back through
 * them.
 *
 * Colour is the one channel doing work in both, so it follows the one rule
 * that matters for magnitude: a single hue, four steps, light to dark,
 * anchored on the page in light and flipped to anchor on the card in dark.
 * Never a second hue, never a rainbow — see `--heat-1` in styles.css. The
 * scale behind it is the writer's own whole history, not the days on screen,
 * so August and March mean the same thing.
 */

/** One square, and the two states that are not a word count. */
function Square({
  cell,
  interactive,
  date,
  ...rest
}: {
  cell: Cell;
  interactive: boolean;
  /** Writes the day of the month on the square. The month view does; the week
      strip does not — its seven squares are labelled by weekday underneath. */
  date?: boolean;
} & React.HTMLAttributes<HTMLSpanElement>) {
  const marks = [
    `chart-cell is-heat-${cell.heat}`,
    cell.today ? ' is-now' : '',
    cell.ahead ? ' is-ahead' : '',
  ].join('');
  return (
    <span className={marks} aria-label={interactive ? describe(cell) : undefined} {...rest}>
      {date ? Number(cell.day.slice(8)) : null}
    </span>
  );
}

/**
 * The week you are in, under the greeting.
 *
 * The whole strip is one control that opens the panel — the squares are not
 * separately clickable, because at seven of them the interesting question is
 * "how is the week going", and the answer to that is the strip rather than any
 * one day in it.
 */
export function WeekStrip({
  days,
  today,
  caption,
  onOpen,
}: {
  days: ActivityDay[];
  today: string;
  /** The line under the squares. */
  caption: string;
  onOpen: () => void;
}) {
  const week = currentWeek(days, today);
  const heads = weekdayHeads();

  return (
    <div
      className="chart is-compact"
      role="button"
      tabIndex={0}
      aria-label={`Your writing this week: ${caption}. Opens your writing.`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen();
      }}
    >
      <div className="chart-strip" aria-hidden="true">
        {week.map((cell, index) => (
          <span className="chart-stack" key={cell.day}>
            <Square cell={cell} interactive={false} />
            <span className="chart-head">{heads[index]}</span>
          </span>
        ))}
      </div>
      <span className="chart-detail">{caption}</span>
    </div>
  );
}

/**
 * One month, and a way back through the others.
 *
 * Arrow keys walk the calendar, and only the square holding the cursor is
 * tabbable — a month costs one Tab stop rather than thirty-one.
 */
export function MonthChart({
  days,
  month,
  today,
  busy,
  aside,
  onActivate,
}: {
  days: ActivityDay[];
  /** `YYYY-MM`. */
  month: string;
  today: string;
  /** The scale, over the whole history rather than this month. */
  busy: number;
  /** Goes at the end of the legend row — the panel's own "learn more". */
  aside?: React.ReactNode;
  /** Opens the pages behind a written day. Silent and future days do nothing. */
  onActivate?: (cell: Cell) => void;
}) {
  const rows = monthOf(days, month, today, busy);
  const heads = weekdayHeads();
  const grid = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Cell | null>(null);

  // Starts on today when today is in view, and on the 1st otherwise, so the
  // cursor is always somewhere that exists.
  const opening =
    rows.flat().findIndex((cell) => cell?.day === today) >= 0
      ? rows.flat().findIndex((cell) => cell?.day === today)
      : rows.flat().findIndex((cell) => cell !== null);
  const [cursor, setCursor] = useState(opening);
  const flat = rows.flat();
  const at = flat[cursor] ? cursor : opening;

  const move = useCallback(
    (to: number) => {
      if (!rows.flat()[to]) return;
      setCursor(to);
      setShown(rows.flat()[to] ?? null);
      grid.current?.querySelector<HTMLElement>(`[data-at="${to}"]`)?.focus();
    },
    [rows],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.key === 'Enter' || event.key === ' ') && onActivate) {
      const cell = flat[at];
      if (cell && cell.words > 0 && !cell.ahead) {
        event.preventDefault();
        onActivate(cell);
      }
      return;
    }
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    move(at + step);
  };

  // Never empty, so nothing below it moves when the pointer arrives. With
  // nothing hovered it falls back to today, which is the day anyone opening
  // this was most likely about to look for.
  const resting = flat.find((cell) => cell?.day === today) ?? null;
  const detail = shown ?? resting;

  return (
    <div className="chart">
      <div className="chart-heads" aria-hidden="true">
        {heads.map((head, index) => (
          <span key={index}>{head}</span>
        ))}
      </div>

      <div
        className="chart-month"
        ref={grid}
        role="grid"
        aria-label={`${formatMonth(month)}, a square a day`}
        onKeyDown={onKeyDown}
        onMouseLeave={() => setShown(null)}
      >
        {rows.map((row, rowIndex) => (
          <div className="chart-week" role="row" key={rowIndex}>
            {row.map((cell, columnIndex) => {
              const index = rowIndex * 7 + columnIndex;
              if (!cell) return <span className="chart-cell is-blank" key={columnIndex} />;
              return (
                <Square
                  key={cell.day}
                  cell={cell}
                  interactive
                  date
                  role="gridcell"
                  data-at={index}
                  tabIndex={at === index ? 0 : -1}
                  aria-label={`${describe(cell)}${
                    cell.words > 0 && !cell.ahead ? '. Open the pages written that day' : ''
                  }`}
                  title={
                    cell.words > 0 && !cell.ahead
                      ? 'Open the pages written that day'
                      : undefined
                  }
                  onClick={() => {
                    if (cell.words > 0 && !cell.ahead) onActivate?.(cell);
                  }}
                  onMouseEnter={() => setShown(cell)}
                  onFocus={() => setShown(cell)}
                  onBlur={() => setShown(null)}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Hidden from screen readers: the square it belongs to is already
          labelled with the same sentence, and saying it twice is how a chart
          becomes tiring to listen to. */}
      <div className="chart-foot">
        <span className="chart-detail">
          {detail ? `${formatDay(detail.day)} · ${sentence(detail)}` : ''}
        </span>
        <span className="chart-keys">
          <span className="chart-legend">
            Less writing
            {[0, 1, 2, 3, 4].map((heat) => (
              <span className={`chart-cell is-heat-${heat}`} key={heat} />
            ))}
            More writing
          </span>
          {aside}
        </span>
      </div>
    </div>
  );
}

/** What one square says out loud. */
function describe(cell: Cell): string {
  return `${formatDay(cell.day)}. ${sentence(cell)}`;
}

function sentence(cell: Cell): string {
  if (cell.ahead) return 'Still to come';
  if (cell.words <= 0) return 'Nothing written';
  const words = `${formatWords(cell.words)} word${cell.words === 1 ? '' : 's'}`;
  // A day whose edits all opened their own session has words but no measured
  // gap, and "0 minutes" would read as a contradiction of the words.
  return cell.seconds > 0 ? `${words} · ${formatSpell(cell.seconds)}` : words;
}
