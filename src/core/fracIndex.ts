/**
 * Fractional indexing over base-62 strings.
 *
 * Sibling order is a string key; inserting between two siblings is one row
 * update and never renumbers anything. Strings rather than floats because
 * float midpoints exhaust double precision after ~50 consecutive inserts at
 * the same spot and then silently tie.
 *
 * A key is an integer part followed by a fractional part. The integer part
 * carries its own length in its first character, so appending at the end
 * increments an integer instead of subdividing towards a ceiling — without it,
 * 5000 appends produce a 1000-character key. Subdividing between two adjacent
 * keys still lengthens the fractional part, which is unavoidable and rare.
 *
 * This is the Figma / David Greenspan order-key scheme. The alphabet is in
 * ascending ASCII order, so plain lexicographic comparison — SQLite's default
 * for TEXT, and IndexedDB's key order — is the sort order.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0]!;
const LAST = DIGITS[DIGITS.length - 1]!;
const SMALLEST_INTEGER = 'A' + ZERO.repeat(26);

/**
 * Returns a key strictly between `a` and `b`.
 * `a === null` means "before everything", `b === null` means "after everything".
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) validateKey(a);
  if (b !== null) validateKey(b);
  if (a !== null && b !== null && a >= b) {
    throw new Error(`keyBetween: disordered bounds ${a} >= ${b}`);
  }

  if (a === null) {
    if (b === null) return 'a' + ZERO;
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const decremented = decrementInteger(ib);
    if (decremented === null) throw new Error('keyBetween: ran out of room below');
    return decremented;
  }

  if (b === null) {
    const ia = integerPart(a);
    const fa = a.slice(ia.length);
    const incremented = incrementInteger(ia);
    return incremented === null ? ia + midpoint(fa, null) : incremented;
  }

  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);

  const incremented = incrementInteger(ia);
  if (incremented === null) throw new Error('keyBetween: ran out of room above');
  if (incremented < b) return incremented;
  return ia + midpoint(fa, null);
}

/** Convenience: `count` keys in order, appended after `after`. */
export function keysAfter(after: string | null, count: number): string[] {
  const out: string[] = [];
  let previous = after;
  for (let i = 0; i < count; i++) {
    previous = keyBetween(previous, null);
    out.push(previous);
  }
  return out;
}

/** Midpoint of two fractional parts, exclusive of both. */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`midpoint: ${a} >= ${b}`);
  if (a.endsWith(ZERO) || b?.endsWith(ZERO)) throw new Error('midpoint: trailing zero');

  if (b !== null) {
    // Strip the longest common prefix and recurse on the remainder.
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }

  const digitA = a.length > 0 ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null && b.length > 0 ? DIGITS.indexOf(b[0]!) : DIGITS.length;

  if (digitB - digitA > 1) return DIGITS[Math.round(0.5 * (digitA + digitB))]!;
  // First digits are adjacent: borrow depth from whichever side has room.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

/**
 * The first character of the integer part encodes sign and length:
 * 'a'..'z' are positive with 2..27 characters, 'Z'..'A' negative with 2..27.
 */
function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
  throw new Error(`invalid order key head: ${head}`);
}

function integerPart(key: string): string {
  const length = integerLength(key[0]!);
  if (length > key.length) throw new Error(`invalid order key: ${key}`);
  return key.slice(0, length);
}

function validateKey(key: string): void {
  if (key === SMALLEST_INTEGER) throw new Error(`invalid order key: ${key}`);
  const integer = integerPart(key);
  if (key.slice(integer.length).endsWith(ZERO)) throw new Error(`invalid order key: ${key}`);
}

function incrementInteger(x: string): string | null {
  const head = x[0]!;
  const digits = x.slice(1).split('');
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const next = DIGITS.indexOf(digits[i]!) + 1;
    if (next === DIGITS.length) digits[i] = ZERO;
    else {
      digits[i] = DIGITS[next]!;
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');
  if (head === 'Z') return 'a' + ZERO;
  if (head === 'z') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push(ZERO);
  else digits.pop();
  return nextHead + digits.join('');
}

function decrementInteger(x: string): string | null {
  const head = x[0]!;
  const digits = x.slice(1).split('');
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const next = DIGITS.indexOf(digits[i]!) - 1;
    if (next === -1) digits[i] = LAST;
    else {
      digits[i] = DIGITS[next]!;
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join('');
  if (head === 'a') return 'Z' + LAST;
  if (head === 'A') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (nextHead < 'Z') digits.push(LAST);
  else digits.pop();
  return nextHead + digits.join('');
}
