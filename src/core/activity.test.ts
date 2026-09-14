/**
 * The writing chart's arithmetic.
 *   node --test src/core/activity.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVE_GAP_MS,
  accrueSeconds,
  busyLevel,
  dayKey,
  daysApart,
  formatSpell,
  heatOf,
  monthOf,
  monthsUpTo,
  shiftDay,
  summarise,
  currentWeek,
  weekStart,
} from './activity.ts';
import type { ActivityDay } from './types.ts';

const day = (date: string, words: number, seconds = 0): ActivityDay => ({
  day: date,
  words,
  seconds,
  lastAt: 0,
  documentIds: [],
});

test('a pause inside the window is writing; a break is not', () => {
  const start = Date.now();
  assert.equal(accrueSeconds(start, start + 30_000), 30);
  assert.equal(accrueSeconds(start, start + ACTIVE_GAP_MS), Math.round(ACTIVE_GAP_MS / 1000));
  assert.equal(accrueSeconds(start, start + ACTIVE_GAP_MS + 1), 0, 'a break earns nothing');
  assert.equal(accrueSeconds(start, start), 0, 'the first edit of a session has no gap behind it');
  assert.equal(accrueSeconds(start, start - 5_000), 0, 'a clock that went backwards earns nothing');
});

test('a day key is the local day, not the UTC one', () => {
  // Eleven at night is still today, whatever UTC thinks.
  const late = new Date(2026, 7, 12, 23, 30);
  assert.equal(dayKey(late), '2026-08-12');
  const early = new Date(2026, 7, 12, 0, 15);
  assert.equal(dayKey(early), '2026-08-12');
});

test('day arithmetic survives the months and the year', () => {
  assert.equal(shiftDay('2026-08-31', 1), '2026-09-01');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDay('2024-02-28', 1), '2024-02-29', 'a leap year has a 29th');
  assert.equal(daysApart('2026-08-01', '2026-08-31'), 30);
  assert.equal(daysApart('2026-08-31', '2026-08-01'), -30);
  assert.equal(daysApart('2025-12-31', '2026-01-01'), 1);
});

test('day arithmetic survives the clocks changing', () => {
  // The last Sunday in March and October, when Europe shifts. Anchored at
  // noon, these are ordinary days a day apart.
  assert.equal(daysApart('2026-03-28', '2026-03-30'), 2);
  assert.equal(daysApart('2026-10-24', '2026-10-26'), 2);
  assert.equal(shiftDay('2026-03-29', 1), '2026-03-30');
});

test('a week starts on Monday, and Sunday is the end of one', () => {
  // 2026-08-12 is a Wednesday.
  assert.equal(weekStart('2026-08-12'), '2026-08-10');
  assert.equal(weekStart('2026-08-10'), '2026-08-10', 'Monday is its own start');
  assert.equal(weekStart('2026-08-16'), '2026-08-10', 'Sunday closes the week it began in');
});

test('a streak counts back from today, and survives a today not yet written', () => {
  const days = [day('2026-08-10', 300), day('2026-08-11', 400), day('2026-08-12', 500)];

  assert.equal(summarise(days, '2026-08-12').streak, 3, 'ending today');
  assert.equal(
    summarise(days, '2026-08-13').streak,
    3,
    'a chain is not broken at one minute past midnight',
  );
  assert.equal(
    summarise(days, '2026-08-14').streak,
    0,
    'it is broken once a whole day has gone by',
  );
});

test('the longest streak is the longest run there has ever been', () => {
  const days = [
    day('2026-01-01', 100),
    day('2026-01-02', 100),
    day('2026-01-03', 100),
    day('2026-01-04', 100),
    // a gap
    day('2026-02-01', 100),
    day('2026-02-02', 100),
  ];
  const summary = summarise(days, '2026-02-02');
  assert.equal(summary.longest, 4);
  assert.equal(summary.streak, 2);
  assert.equal(summary.days, 6);
});

test('a day recorded but not written on counts for nothing', () => {
  const days = [day('2026-08-10', 300), day('2026-08-11', 0), day('2026-08-12', 500)];
  const summary = summarise(days, '2026-08-12');
  assert.equal(summary.days, 2, 'an empty row is not a day of writing');
  assert.equal(summary.streak, 1, 'and it does not hold a streak together');
  assert.equal(summary.words, 800);
  assert.equal(summary.best, 500);
});

test('an empty history summarises to nothing rather than to NaN', () => {
  const summary = summarise([], '2026-08-12');
  assert.deepEqual(summary, { words: 0, days: 0, best: 0, streak: 0, longest: 0, today: null });
});

test('the busy level is the writer, not a number someone else chose', () => {
  const many = (words: number) =>
    Array.from({ length: 20 }, (_, index) => day(`2026-03-${String(index + 1).padStart(2, '0')}`, words));
  assert.equal(busyLevel(many(4000)), 4000, "a heavy writer's bar is high");
  assert.equal(busyLevel(many(60)), 500, 'but never lower than the floor');
  assert.equal(busyLevel([]), 500, 'a first launch has a scale too');
  assert.equal(busyLevel(many(0)), 500, 'days with nothing on them do not set it');
});

test('heat runs from showing up to a full day, and stops there', () => {
  assert.equal(heatOf(0, 1000), 0);
  assert.equal(heatOf(1, 1000), 1, 'showing up always shows');
  assert.equal(heatOf(240, 1000), 1);
  assert.equal(heatOf(260, 1000), 2);
  assert.equal(heatOf(600, 1000), 3);
  assert.equal(heatOf(1000, 1000), 4);
  assert.equal(heatOf(90_000, 1000), 4, 'one enormous day does not need a fifth shade');
});

test('the week strip is Monday to Sunday of the week today is in', () => {
  // 2026-08-12 is a Wednesday.
  const week = currentWeek([day('2026-08-10', 400), day('2026-08-12', 900)], '2026-08-12');

  assert.equal(week.length, 7);
  assert.equal(week[0]?.day, '2026-08-10', 'it opens on Monday');
  assert.equal(week[6]?.day, '2026-08-16', 'and closes on Sunday');
  assert.equal(week[0]?.words, 400);
  assert.equal(week[1]?.words, 0, 'a day passed over is a cold square');
  assert.equal(week[1]?.ahead, false, 'Tuesday already happened');
  assert.equal(week[2]?.today, true);
});

test('days later this week are still to come, not missed', () => {
  const week = currentWeek([], '2026-08-12');
  assert.deepEqual(
    week.map((cell) => cell.ahead),
    [false, false, false, true, true, true, true],
    'Thursday onwards has not happened yet',
  );
});

test('a month is a calendar, blank until it starts and after it ends', () => {
  // August 2026 opens on a Saturday and has 31 days.
  const rows = monthOf([day('2026-08-01', 900)], '2026-08', '2026-08-12', 1000);

  assert.equal(rows[0]?.length, 7, 'every row is a whole week');
  assert.deepEqual(
    rows[0]?.slice(0, 5).map((cell) => cell),
    [null, null, null, null, null],
    'Monday to Friday belong to July',
  );
  assert.equal(rows[0]?.[5]?.day, '2026-08-01', 'the 1st is the Saturday');
  assert.equal(rows[0]?.[5]?.heat, 3);

  const last = rows[rows.length - 1];
  const dates = rows.flat().filter((cell) => cell !== null);
  assert.equal(dates.length, 31, 'every day of the month is a square, and only those');
  assert.equal(dates[30]?.day, '2026-08-31');
  assert.equal(last?.length, 7, 'the final row is padded rather than short');
});

test('a month that is not this one has no today and nothing still to come', () => {
  const rows = monthOf([], '2026-03', '2026-08-12', 1000);
  const cells = rows.flat().filter((cell) => cell !== null);
  assert.equal(cells.length, 31, 'March has 31 days');
  assert.ok(!cells.some((cell) => cell.today), 'today is not in March');
  assert.ok(!cells.some((cell) => cell.ahead), 'and none of March is still to come');
});

test('February knows about leap years', () => {
  assert.equal(monthOf([], '2024-02', '2026-08-12', 1000).flat().filter(Boolean).length, 29);
  assert.equal(monthOf([], '2026-02', '2026-08-12', 1000).flat().filter(Boolean).length, 28);
});

test('the picker runs from the first word written to this month, gaps and all', () => {
  const months = monthsUpTo(
    [day('2026-05-20', 300), day('2026-08-02', 800)],
    '2026-08-12',
  );
  assert.deepEqual(
    months,
    ['2026-05', '2026-06', '2026-07', '2026-08'],
    'June and July were silent and are still offered',
  );
});

test('the picker crosses the new year, and survives an empty history', () => {
  assert.deepEqual(
    monthsUpTo([day('2025-11-30', 100)], '2026-02-03'),
    ['2025-11', '2025-12', '2026-01', '2026-02'],
  );
  assert.deepEqual(monthsUpTo([], '2026-08-12'), ['2026-08'], 'this month, and nothing before it');
  assert.deepEqual(
    monthsUpTo([day('2026-08-01', 0)], '2026-08-12'),
    ['2026-08'],
    'a recorded day with nothing on it does not open the history',
  );
});

test('a spell of writing is said the way a person would say it', () => {
  assert.equal(formatSpell(20), 'under a minute');
  assert.equal(formatSpell(60), '1 minute');
  assert.equal(formatSpell(47 * 60), '47 minutes');
  assert.equal(formatSpell(2 * 3600), '2h');
  assert.equal(formatSpell(2 * 3600 + 10 * 60), '2h 10m');
});
