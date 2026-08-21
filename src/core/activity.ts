/**
 * The maths behind the writing chart. No storage, no React — everything here
 * is a pure function of a list of days, which is what makes it testable and
 * what keeps the same rules from being re-derived, slightly differently, in
 * each of the three storage backends.
 *
 * The one idea worth stating plainly: a day's heat is words *touched*, not
 * words gained. Every edit contributes the size of its change, so cutting a
 * paragraph counts as much as writing one. Net growth would read a morning
 * spent tightening a chapter as an empty square, and that is precisely the
 * morning a chart like this exists to encourage.
 */

import type { ActivityDay } from './types.ts';

/**
 * How long a pause can be and still be writing.
 *
 * The editor saves when typing stops for half a second, so a working session
 * lands a save every few seconds to a minute — a pause to think, to reread, to
 * look something up. Three minutes is past all of those and into having got up,
 * which is the line this number draws: time is credited from the gaps between
 * edits, and a gap longer than this earns nothing at all.
 *
 * That is what stops an app left open overnight from claiming eight hours of
 * writing, without needing a timer, a focus listener, or anything watching the
 * person rather than the work.
 */
export const ACTIVE_GAP_MS = 3 * 60 * 1000;

/**
 * What one edit adds to the day's clock.
 *
 * Shared by the IndexedDB and better-sqlite3 stores, which can both import it;
 * the Rust store carries its own copy of these four lines with a note pointing
 * here. An edit that opens a session credits nothing, because there is no gap
 * behind it to credit — a session is therefore always undercounted by its
 * first burst, which is the right direction to be wrong in.
 */
export function accrueSeconds(lastAt: number, at: number): number {
  const gap = at - lastAt;
  if (gap <= 0 || gap > ACTIVE_GAP_MS) return 0;
  return Math.round(gap / 1000);
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The local calendar day an instant falls in, as `YYYY-MM-DD`.
 *
 * Local rather than UTC because a day is what the person writing it called a
 * day. Someone writing at eleven at night in Lagos is having Tuesday, and a
 * UTC key would file half their evening under Wednesday and break the streak
 * they can see with their own eyes.
 */
export function dayKey(at: number | Date): string {
  const date = at instanceof Date ? at : new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A day key back into a Date, fixed at midday.
 *
 * Midday, not midnight, and this is not fussiness: on the two days a year the
 * clocks move, midnight local either does not exist or exists twice, so date
 * arithmetic anchored there can land on the wrong day. Noon is twelve hours
 * from either edge and no daylight saving shift is that big.
 */
export function dayDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1, 12);
}

/** The day `count` days after this one; negative counts go backwards. */
export function shiftDay(day: string, count: number): string {
  const date = dayDate(day);
  date.setDate(date.getDate() + count);
  return dayKey(date);
}

/** Whole days from `from` to `to`, negative if `to` is earlier. */
export function daysApart(from: string, to: string): number {
  return Math.round((dayDate(to).getTime() - dayDate(from).getTime()) / 86_400_000);
}

/** Monday of the week this day falls in. */
export function weekStart(day: string): string {
  const date = dayDate(day);
  // getDay is 0 for Sunday, so Sunday is six days into its week, not before it.
  return shiftDay(day, -((date.getDay() + 6) % 7));
}

export interface Summary {
  /** Every word touched, ever. */
  words: number;
  /** How many days were written on at all. */
  days: number;
  /** The busiest single day's words. */
  best: number;
  /** Days written in a row, counting back from today. */
  streak: number;
  /** The longest run there has ever been. */
  longest: number;
  /** Today's row, if today has one. */
  today: ActivityDay | null;
}

/**
 * Reads the whole history into the handful of numbers worth putting on screen.
 *
 * `streak` counts back from yesterday rather than from today when today is
 * still empty, so a chain is not reported broken at one minute past midnight
 * by someone who has simply not started yet. It breaks at the end of the first
 * day actually missed, which is when it has genuinely been broken.
 */
export function summarise(days: ActivityDay[], today: string): Summary {
  const written = new Set<string>();
  let words = 0;
  let best = 0;
  let todayRow: ActivityDay | null = null;

  for (const day of days) {
    if (day.words <= 0) continue;
    written.add(day.day);
    words += day.words;
    if (day.words > best) best = day.words;
    if (day.day === today) todayRow = day;
  }

  let streak = 0;
  let cursor = written.has(today) ? today : shiftDay(today, -1);
  while (written.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }

  // `YYYY-MM-DD` sorts chronologically as text, which is the whole reason the
  // key is shaped that way.
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of [...written].sort()) {
    run = previous !== null && daysApart(previous, day) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = day;
  }

  return { words, days: written.size, best, streak, longest, today: todayRow };
}

/**
 * The floor under the busy level, in words touched in a day.
 *
 * Without one, a first week of three short days would set the scale at those
 * three days and every square after would be full strength — which tells the
 * writer nothing and flatters them for it.
 */
const BUSY_FLOOR = 500;

/**
 * The word count a day has to reach to be as dark as the chart goes.
 *
 * Measured against the writer rather than against a number someone else chose:
 * the 75th percentile of the days they actually wrote on, so roughly their top
 * quarter come out at full strength and the chart has real range whether they
 * write two hundred words a day or two thousand.
 *
 * Always fed the *whole* history, never only the days on screen. The scale has
 * to mean the same thing in March as it does in August, or two months of the
 * same chart cannot be compared — and comparing them is the only reason to be
 * able to change which one is shown.
 */
export function busyLevel(days: ActivityDay[]): number {
  const active = days
    .map((day) => day.words)
    .filter((words) => words > 0)
    .sort((a, b) => a - b);
  if (active.length === 0) return BUSY_FLOOR;
  const at = active[Math.floor(active.length * 0.75)] ?? active[active.length - 1] ?? 0;
  return Math.max(BUSY_FLOOR, at);
}

/** Which of the four shades a square earns. 0 is a week with nothing on it. */
export function heatOf(words: number, busy: number): 0 | 1 | 2 | 3 | 4 {
  if (words <= 0) return 0;
  const share = words / busy;
  if (share < 0.25) return 1;
  if (share < 0.5) return 2;
  if (share < 1) return 3;
  return 4;
}

/** One square: one day. */
export interface Cell {
  day: string;
  words: number;
  seconds: number;
  heat: 0 | 1 | 2 | 3 | 4;
  /** Today. */
  today: boolean;
  /** A day that has not happened yet — later this week, or later this month. */
  ahead: boolean;
}

function cellOf(byDay: Map<string, ActivityDay>, day: string, today: string, busy: number): Cell {
  const row = byDay.get(day);
  const words = row?.words ?? 0;
  return {
    day,
    words,
    seconds: row?.seconds ?? 0,
    heat: heatOf(words, busy),
    today: day === today,
    // Drawn, but drawn as not-yet: a Friday that has not arrived is not a
    // Friday that was missed, and colouring them the same would report a
    // failure that has not happened.
    ahead: daysApart(day, today) < 0,
  };
}

/**
 * The week today is in: seven squares, Monday to Sunday.
 *
 * This is the whole chart on the welcome screen. A year of days was three
 * hundred and sixty-five squares, which is a wall to read rather than a thing
 * to glance at — and a glance is the entire job of the one that greets you.
 * Seven is a thing you take in without reading.
 */
export function currentWeek(days: ActivityDay[], today: string): Cell[] {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const busy = busyLevel(days);
  const monday = weekStart(today);
  return Array.from({ length: 7 }, (_, offset) =>
    cellOf(byDay, shiftDay(monday, offset), today, busy),
  );
}

/** A calendar row. Null where the month has not started or has ended. */
export type MonthRow = (Cell | null)[];

/**
 * One month, laid out as a calendar — weeks down, weekdays across.
 *
 * The shape everyone already knows how to read, which is the point: a month is
 * twenty-eight to thirty-one squares, small enough to take in and long enough
 * to show a habit. The leading and trailing blanks are null rather than empty
 * squares, because a day belonging to another month is not a day missed in
 * this one.
 *
 * `busy` comes from the caller so it can be computed over the whole history
 * rather than over the month on screen — see `busyLevel`.
 */
export function monthOf(
  days: ActivityDay[],
  month: string,
  today: string,
  busy: number,
): MonthRow[] {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const first = `${month}-01`;
  const start = dayDate(first);
  const length = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  // Monday-first, so Sunday sits at the end of the week it began in.
  const lead = (start.getDay() + 6) % 7;

  const rows: MonthRow[] = [];
  let row: MonthRow = Array<Cell | null>(lead).fill(null);
  for (let date = 1; date <= length; date += 1) {
    row.push(cellOf(byDay, `${month}-${pad(date)}`, today, busy));
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length > 0) rows.push([...row, ...Array<Cell | null>(7 - row.length).fill(null)]);
  return rows;
}

/** The `YYYY-MM` a day belongs to. */
export function monthKey(day: string): string {
  return day.slice(0, 7);
}

/**
 * Every month worth offering in the picker: the one the first word was written
 * in, through this one.
 *
 * Months with nothing in them are included on purpose. A gap is a fact about
 * the year worth being able to look at, and a list that quietly skipped March
 * would make it hard to notice March had been skipped.
 */
export function monthsUpTo(days: ActivityDay[], today: string): string[] {
  const written = days.filter((day) => day.words > 0).map((day) => day.day).sort();
  const start = monthKey(written[0] ?? today);
  const end = monthKey(today);
  const months: string[] = [];
  for (let month = start; month <= end; month = nextMonth(month)) months.push(month);
  return months;
}

/** The `YYYY-MM` before this one. */
export function previousMonth(month: string): string {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(year ?? 1970, (index ?? 1) - 2, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function nextMonth(month: string): string {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(year ?? 1970, (index ?? 1) - 1 + 1, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** `August 2026`. */
export function formatMonth(month: string): string {
  return dayDate(`${month}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * The heads of the weekday row, Monday first, in the locale.
 *
 * `short` rather than `narrow`: narrow gives "M T W T F S S", where two pairs
 * are the same letter and the row stops being readable the moment anyone
 * actually uses it to find a column.
 */
export function weekdayHeads(): string[] {
  // Any Monday will do; this one is arbitrary and only its weekday is read.
  return Array.from({ length: 7 }, (_, offset) =>
    dayDate(shiftDay('2026-08-10', offset)).toLocaleDateString(undefined, { weekday: 'short' }),
  );
}

/** `1,240`. Matches how the rest of the app writes a count. */
export function formatWords(words: number): string {
  return words.toLocaleString();
}

/** Time as a person would say it: `47 minutes`, `2h 10m`, never `0.78 hours`. */
export function formatSpell(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** `Thursday, 12 August`. */
export function formatDay(day: string): string {
  return dayDate(day).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

