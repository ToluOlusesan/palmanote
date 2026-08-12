import assert from 'node:assert/strict';
import { test } from 'node:test';

import { whatToCallYou } from './writingSettings.ts';

/**
 * What the app calls you when you have not said.
 *
 * One line of a greeting, and the whole reason it is a function rather than a
 * `||` at the call site: every one of these is a way of saying nothing, and
 * all of them have to come out as the same word. A greeting reading "Hey ,"
 * is the kind of thing that ships.
 */

test('a name is used as given', () => {
  assert.equal(whatToCallYou('Sesan'), 'Sesan');
});

test('nothing typed becomes “you”', () => {
  assert.equal(whatToCallYou(''), 'you');
});

test('and so does whitespace, which is nothing typed carefully', () => {
  assert.equal(whatToCallYou('   '), 'you');
  assert.equal(whatToCallYou('\t\n'), 'you');
});

test('a name is trimmed rather than rejected', () => {
  assert.equal(whatToCallYou('  Tolu  '), 'Tolu');
});

test('a name is left alone otherwise — spacing, case and all', () => {
  assert.equal(whatToCallYou('mary-jane'), 'mary-jane');
  assert.equal(whatToCallYou('Ada Lovelace'), 'Ada Lovelace');
  assert.equal(whatToCallYou('you'), 'you');
});
