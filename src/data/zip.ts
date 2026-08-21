/**
 * A zip file, written by hand.
 *
 * Only the browser build needs this, and only when the browser has no
 * directory picker. Chromium hands the File System Access API a real folder
 * and the files land in it; Firefox and Safari have no such thing, so the
 * fallback is `<a download>` — one file at a time. A folder export of forty
 * pages plus its images is forty download prompts, which is not an export, it
 * is an argument with the browser.
 *
 * So the fallback gets one file instead. No dependency: a stored zip is a
 * length-prefixed concatenation with a table of contents at the end, and the
 * deflate half is `CompressionStream`, which every browser that can run this
 * app already has. Where it is missing, entries are stored uncompressed —
 * bigger, still a valid zip, still one file.
 *
 * Deliberately not zip64. These are documents; the format's 4 GB ceiling is
 * several hundred times the largest library this app has ever held.
 */

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

/** Bit 11: the name is UTF-8. Without it, an accented title unzips mangled. */
const UTF8 = 0x0800;

export interface ZipEntry {
  /** Relative path, `/` separated. Directories are implied by the name. */
  path: string;
  data: string | Uint8Array;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, which is what a zip header carries. Two seconds' resolution. */
function dosStamp(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    // 1980 is the epoch of the format, and a year before it cannot be written.
    date: ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  const Stream = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!Stream) return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new Stream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    // A browser that names the format but declines it still gets a valid zip.
    return null;
  }
}

/**
 * Builds the archive. Returns the bytes rather than writing them, because the
 * three places a file can go are already decided one level up in files.ts.
 */
export async function zip(entries: ZipEntry[], now = new Date()): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const stamp = dosStamp(now);

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const packed = await deflate(raw);
    // Compression that made the entry bigger is compression not worth having —
    // true of a small PNG surprisingly often.
    const useDeflate = packed !== null && packed.length < raw.length;
    const body = useDeflate ? packed : raw;
    const method = useDeflate ? 8 : 0;
    const sum = crc32(raw);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, UTF8, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, stamp.time, true);
    lv.setUint16(12, stamp.date, true);
    lv.setUint32(14, sum, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL, true);
    // Made by 3.0 on a Unix-ish host, so the external attributes below are read
    // as a mode rather than as DOS flags.
    cv.setUint16(4, 0x031e, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, UTF8, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, stamp.time, true);
    cv.setUint16(14, stamp.date, true);
    cv.setUint32(16, sum, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    // 0644, shifted into the high half where the mode lives.
    cv.setUint32(38, 0o644 << 16, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }

  const directory = centrals.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directory, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
