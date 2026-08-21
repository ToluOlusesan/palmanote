import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { crc32, zip } from './zip.ts';

/**
 * A zip written by hand is only worth having if something that did not write
 * it can read it back. So the assertions here are not about our own bytes:
 * they inflate the entries with zlib and compare the text, which is the same
 * question Explorer, macOS Archive Utility and every markdown editor will ask.
 */

const decoder = new TextDecoder();
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Walks the central directory, which is where a reader starts. */
function readDirectory(archive: Uint8Array) {
  const dv = view(archive);
  let end = archive.length - 22;
  while (end >= 0 && dv.getUint32(end, true) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'no end-of-central-directory record');

  const count = dv.getUint16(end + 10, true);
  let at = dv.getUint32(end + 16, true);
  const entries: { path: string; method: number; crc: number; body: Uint8Array; size: number }[] = [];

  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(at, true), 0x02014b50, 'central header signature');
    const method = dv.getUint16(at + 10, true);
    const crc = dv.getUint32(at + 16, true);
    const compressed = dv.getUint32(at + 20, true);
    const size = dv.getUint32(at + 24, true);
    const nameLength = dv.getUint16(at + 28, true);
    const local = dv.getUint32(at + 42, true);
    const path = decoder.decode(archive.subarray(at + 46, at + 46 + nameLength));

    // The local header repeats the name and may carry an extra field of its
    // own, so the body starts after both rather than at a fixed offset.
    assert.equal(dv.getUint32(local, true), 0x04034b50, 'local header signature');
    const bodyAt = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);

    entries.push({ path, method, crc, size, body: archive.subarray(bodyAt, bodyAt + compressed) });
    at += 46 + nameLength + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true);
  }
  return entries;
}

/** Raw deflate, with no zlib or gzip wrapper — which is what method 8 means here. */
const inflate = (entry: { method: number; body: Uint8Array }) =>
  entry.method === 0 ? entry.body : new Uint8Array(inflateRawSync(entry.body));

test('an export comes back out of the archive exactly as it went in', async () => {
  const prose = `# Chapter One\n\n${'The rain came sideways. '.repeat(80)}`;
  const picture = Uint8Array.from({ length: 512 }, (_, i) => (i * 37) % 251);

  const archive = await zip([
    { path: '01 Chapter One.md', data: prose },
    { path: 'assets/deadbeef.png', data: picture },
    { path: 'README.txt', data: 'PalmaNote export' },
  ]);

  const entries = readDirectory(archive);
  assert.deepEqual(
    entries.map((e) => e.path),
    ['01 Chapter One.md', 'assets/deadbeef.png', 'README.txt'],
  );

  assert.equal(decoder.decode(inflate(entries[0]!)), prose);
  assert.deepEqual(inflate(entries[1]!), picture);
  assert.equal(decoder.decode(inflate(entries[2]!)), 'PalmaNote export');
});

test('the checksum and the declared size describe the file before compression', async () => {
  const prose = 'The rain came sideways. '.repeat(80);
  const [entry] = readDirectory(await zip([{ path: 'a.md', data: prose }]));

  const raw = new TextEncoder().encode(prose);
  assert.equal(entry!.size, raw.length);
  assert.equal(entry!.crc, crc32(raw));
  // Eighty repetitions of one sentence had better compress, or the deflate
  // half is not running at all.
  assert.equal(entry!.method, 8);
  assert.ok(entry!.body.length < raw.length / 4);
});

test('a name outside ASCII survives the trip', async () => {
  const [entry] = readDirectory(await zip([{ path: 'Café notes/día.md', data: 'hola' }]));
  assert.equal(entry!.path, 'Café notes/día.md');
});

test('an empty library still produces a readable archive', async () => {
  assert.deepEqual(readDirectory(await zip([])), []);
});
