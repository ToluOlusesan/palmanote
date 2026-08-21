import { CalendarBlank, PencilSimple, Question, TrendUp, X, type Icon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import type { ActivityDay } from '../core/types.ts';
import {
  busyLevel,
  dayKey,
  formatMonth,
  formatWords,
  monthKey,
  monthsUpTo,
  summarise,
} from '../core/activity.ts';
import { useActivity } from '../state/activity.ts';
import { MonthPicker } from './MonthPicker.tsx';
import { MonthChart } from './WritingChart.tsx';

interface Stat {
  key: string;
  glyph: Icon;
  value: string;
  label: string;
}

/**
 * A month of writing, and the two facts worth putting a number on.
 *
 * One month at a time rather than a year at once: thirty-one squares in the
 * shape of a calendar is something you read, and three hundred and sixty-five
 * in a block is something you skim past. The dropdown is what makes that a
 * narrowing rather than a loss — every month since the first word is in it,
 * including the empty ones, because a gap is a fact about the year worth being
 * able to look at.
 *
 * **Two cards, and neither of them ranks you.** There were four: these two,
 * plus a best day and a day streak. Both of those were doing competitive work
 * — a personal record to beat and a chain to avoid breaking — and a streak is
 * a retention mechanic borrowed from habit-loop apps, built on loss aversion.
 * "Keep it going" is a phrase designed to make stopping feel like losing
 * something. That is a different app from this one, which is for writing as
 * much as you want without worrying about things that do not matter.
 *
 * So the streak is gone as a *concept*, not merely hidden until it is big
 * enough to be flattering. `summarise` still computes it — it is cheap and
 * tested — and nothing reads it.
 *
 * The cards carry no subtext either. A number under a number is a comparison
 * asking to be made; the one line at the foot does the talking for the whole
 * panel, once, in a sentence.
 */
export function ActivityDialog({ onClose }: { onClose: () => void }) {
  const { days, ready } = useActivity();
  const today = dayKey(Date.now());
  const [month, setMonth] = useState(() => monthKey(today));
  // Collapsed. The method is worth being able to read and not worth reading
  // twice, so it is on demand and it floats rather than pushing the calendar
  // down every time the panel opens.
  const [explaining, setExplaining] = useState(false);

  const all = summarise(days, today);
  const inMonth = days.filter((day) => monthKey(day.day) === month);
  const scoped = summarise(inMonth, today);
  const months = monthsUpTo(days, today);
  // Over everything, never over the month on screen — otherwise two months of
  // the same chart could not be compared, and comparing them is the only
  // reason to be able to change which one is shown.
  const busy = busyLevel(days);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (explaining) {
        setExplaining(false);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [explaining, onClose]);

  const stats: Stat[] = [
    {
      key: 'words',
      glyph: PencilSimple,
      value: formatWords(scoped.words),
      label: 'Words this month',
    },
    {
      key: 'days',
      glyph: CalendarBlank,
      value: `${scoped.days}`,
      label: scoped.days === 1 ? 'Writing day' : 'Writing days',
    },
  ];

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="dialog is-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Your writing"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="panel-close" aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>

        <header className="panel-head">
          <div className="panel-title">
            <TrendUp size={20} weight="bold" />
            <div>
              <h2>Your writing</h2>
              <p>A quick look at your writing activity.</p>
            </div>
          </div>

          {ready && all.days > 0 && (
            <MonthPicker months={months} value={month} onChange={setMonth} />
          )}
        </header>

        {!ready ? (
          <p className="dialog-body">Counting…</p>
        ) : all.days === 0 ? (
          <p className="dialog-body">
            Nothing on it yet. Every square fills itself in as you write — there is nothing to
            start and nothing to remember to press.
          </p>
        ) : (
          <>
            <div className="stat-cards">
              {stats.map((stat) => (
                <div className="stat-card" key={stat.key}>
                  <span className="stat-badge">
                    <stat.glyph size={17} weight="bold" />
                  </span>
                  <span className="stat-value">{stat.value}</span>
                  <span className="stat-label">{stat.label}</span>
                </div>
              ))}
            </div>

            <MonthChart
              days={days}
              month={month}
              today={today}
              busy={busy}
              aside={
                <span className="panel-help">
                  <button
                    type="button"
                    className="panel-learn"
                    aria-expanded={explaining}
                    onClick={() => setExplaining((open) => !open)}
                  >
                    Learn more about stats
                    <Question size={14} />
                  </button>

                  {explaining && (
                    <span className="panel-explain" role="note">
                      A day counts words <strong>touched</strong> — added and deleted both, so an
                      afternoon spent cutting is not an empty square. The shade is set against
                      your own busiest days rather than a target.
                    </span>
                  )}
                </span>
              }
            />

            <div className="panel-foot">
              <span className="panel-brag">{shape(inMonth, scoped, month)}</span>
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The one line at the foot: what this month looked like.
 *
 * Describing rather than scoring, which is the whole brief for it — no target,
 * no comparison against last month, no "you are behind". And no number the
 * cards above already carry: the top of the panel says how many words and how
 * many days, so repeating either here would be the same sentence twice.
 *
 * What is left is shape — which part of the month the writing actually landed
 * in — and that is both true and the thing a person cannot read off a grid at
 * a glance.
 */
function shape(inMonth: ActivityDay[], scoped: { days: number }, month: string): string {
  const name = formatMonth(month).split(' ')[0] ?? 'this month';
  if (scoped.days === 0) return `Nothing in ${name} yet. The first word is the hard one.`;
  if (scoped.days === 1) return `One day so far in ${name}.`;

  // Which of the month's four-and-a-bit weeks carried the most.
  const byWeek = [0, 0, 0, 0, 0];
  let total = 0;
  for (const day of inMonth) {
    if (day.words <= 0) continue;
    const date = Number(day.day.slice(8));
    const week = Math.min(4, Math.floor((date - 1) / 7));
    byWeek[week] = (byWeek[week] ?? 0) + day.words;
    total += day.words;
  }
  if (total === 0) return `Nothing in ${name} yet. The first word is the hard one.`;

  const best = byWeek.indexOf(Math.max(...byWeek));
  const share = (byWeek[best] ?? 0) / total;
  if (share < 0.4) return `${name} is spread fairly evenly across the month.`;
  return `Most of ${name} landed in the ${ORDINALS[best] ?? 'first'} week.`;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'last'];
