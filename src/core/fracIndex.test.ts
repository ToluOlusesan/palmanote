/**
 * Ordering invariants for sibling positions.
 *   node --test src/core/fracIndex.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { keyBetween, keysAfter } from './fracIndex.ts';

test('appending stays short — a novel appends thousands of times', () => {
  const keys = keysAfter(null, 5000);
  assert.deepEqual(keys, [...keys].sort(), 'appended keys sort in insertion order');
  assert.ok(Math.max(...keys.map((k) => k.length)) <= 8, 'append must not grow keys without bound');
});

test('prepending stays short', () => {
  const keys: string[] = [];
  let first: string | null = null;
  for (let i = 0; i < 5000; i++) {
    first = keyBetween(null, first);
    keys.push(first);
  }
  assert.deepEqual(keys, [...keys].sort().reverse());
  assert.ok(Math.max(...keys.map((k) => k.length)) <= 8);
});

test('random insertion keeps a strict total order', () => {
  const list = [keyBetween(null, null)];
  for (let i = 0; i < 5000; i++) {
    const at = Math.floor(Math.random() * (list.length + 1));
    const before = at === 0 ? null : list[at - 1]!;
    const after = at === list.length ? null : list[at]!;
    list.splice(at, 0, keyBetween(before, after));
  }
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i - 1]! < list[i]!, `out of order at ${i}: ${list[i - 1]} !< ${list[i]}`);
  }
  assert.equal(new Set(list).size, list.length, 'keys must be unique');
});

test('the same gap can be subdivided indefinitely — the case floats lose', () => {
  const low = keyBetween(null, null);
  let high = keyBetween(low, null);
  for (let i = 0; i < 1000; i++) {
    const mid = keyBetween(low, high);
    assert.ok(low < mid && mid < high, `subdivision ${i} collapsed`);
    high = mid;
  }
});

test('disordered bounds are rejected rather than silently accepted', () => {
  const a = keyBetween(null, null);
  const b = keyBetween(a, null);
  assert.throws(() => keyBetween(b, a));
});
