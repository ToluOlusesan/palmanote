import type { AssetRecord } from '../core/types.ts';
import { store } from '../data/index.ts';

/**
 * Images: getting them in, and getting them back out again.
 *
 * The rule that shapes all of this is that a document holds an id and never
 * bytes. `revisions` copies a document's whole content on every snapshot, so
 * a picture pasted inline would be re-copied every two minutes of writing
 * for as long as the page lived — that is how a 200KB screenshot becomes
 * fifty megabytes without anybody doing anything wrong.
 *
 * The id is the SHA-256 of the bytes, so the same picture used in six places
 * is stored once and moving a page between documents costs nothing.
 */

/** Formats a browser can decode and Word can embed. */
export const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * Bigger than this in either direction and the picture is scaled down before
 * it is stored.
 *
 * A phone camera writes 4000px images; nothing in this app draws one wider
 * than about 600 CSS pixels, and the library is a single SQLite file the owner
 * has to back up. 2400 is comfortably past twice the largest size anything
 * displays, which is the point at which more pixels stop being visible and
 * start being weight.
 */
const MAX_EDGE = 2400;

/** Refused outright. A file this size is a mistake, not a decision. */
const MAX_BYTES = 32 * 1024 * 1024;

/** GIFs are the one format where re-encoding would throw away the animation. */
const NEVER_RESIZE = new Set(['image/gif']);

export interface StoredImage {
  id: string;
  width: number;
  height: number;
}

/** Object URLs, kept for the session. Assets are few and each is used often. */
const urls = new Map<string, string>();
/** In-flight reads, so ten copies of one image on a page cost one round trip. */
const pending = new Map<string, Promise<string | null>>();

// ------------------------------------------------------------------ writing

/**
 * Puts a file in the library and returns what a document should point at.
 *
 * Throws with something a person can read, because every caller here is a
 * gesture the writer just made — a paste, a drop, a file they chose — and
 * "nothing happened" is the worst possible answer to any of them.
 */
export async function storeImage(file: Blob): Promise<StoredImage> {
  if (!ACCEPTED.includes(file.type)) {
    throw new Error('That is not an image Springboard can read.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('That image is over 32MB.');
  }

  const prepared = await prepare(file);
  const bytes = new Uint8Array(await prepared.blob.arrayBuffer());
  const id = await sha256(bytes);

  await store.putAsset({
    id,
    mime: prepared.blob.type,
    data: toBase64(bytes),
    width: prepared.width,
    height: prepared.height,
  });

  // Fill the cache from what is already in hand, so the image draws on the
  // next frame rather than after a round trip to the database it just left.
  if (!urls.has(id)) urls.set(id, URL.createObjectURL(prepared.blob));

  return { id, width: prepared.width, height: prepared.height };
}

/**
 * Asks for a picture from disk. Null when the writer changed their mind.
 *
 * A plain file input rather than a native dialog through the bridge:
 * `<input type="file">` opens the same Windows picker inside WebView2 that a
 * Tauri command would, needs no new permission in `capabilities/default.json`,
 * and works unchanged in the browser build. The one thing it cannot do is
 * remember which folder you were last in, which is the shell's business anyway.
 *
 * It lives beside `storeImage` because every caller does one immediately after
 * the other, and two copies of a picker is how two pickers end up accepting
 * different files.
 */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED.join(',');
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    });
    // A dismissed dialog fires nothing in some webviews, so the element is
    // cleaned up on the next focus rather than left in the document forever.
    window.addEventListener('focus', () => window.setTimeout(() => input.remove(), 400), {
      once: true,
    });
    input.click();
  });
}

/**
 * Measures, and scales down if it has to.
 *
 * An image already inside the limit is passed through untouched — same bytes,
 * same format, same hash it would have had anywhere else. Only the oversized
 * ones are re-encoded, and never a GIF.
 */
async function prepare(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));

  if (scale === 1 || NEVER_RESIZE.has(file.type)) {
    bitmap.close();
    return { blob: file, width, height };
  }

  const target = { width: Math.round(width * scale), height: Math.round(height * scale) };
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    return { blob: file, width, height };
  }
  context.drawImage(bitmap, 0, 0, target.width, target.height);
  bitmap.close();

  // PNG keeps transparency and everything else; JPEG would flatten a cut-out
  // onto black. Photographs pay for that in bytes, and are still smaller than
  // the 4000px original they arrived as.
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, type === 'image/jpeg' ? 0.9 : undefined),
  );
  return blob ? { blob, ...target } : { blob: file, width, height };
}

// ------------------------------------------------------------------ reading

/** The object URL for an asset, reading it out of the library if need be. */
export function assetUrl(id: string): Promise<string | null> {
  const ready = urls.get(id);
  if (ready) return Promise.resolve(ready);

  const already = pending.get(id);
  if (already) return already;

  const read = store
    .getAsset(id)
    .then((record) => {
      if (!record) return null;
      const bytes = fromBase64(record.data);
      const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: record.mime }));
      urls.set(id, url);
      return url;
    })
    .catch(() => null)
    .finally(() => pending.delete(id));

  pending.set(id, read);
  return read;
}

/** Already in hand, for the render that would otherwise flash empty first. */
export function cachedAssetUrl(id: string): string | undefined {
  return urls.get(id);
}

/**
 * Fills in the `src` of every image under `root` that is still missing one.
 *
 * Both places that draw a document use this — the editor and the version
 * preview in the history — because a node's `renderHTML` is synchronous and
 * reading bytes out of SQLite is not. An image whose asset has gone is left
 * without a src and marked, rather than removed: see Image.ts.
 */
export function resolveAssetImages(root: ParentNode): void {
  for (const element of root.querySelectorAll<HTMLImageElement>('img[data-asset]:not([src])')) {
    const id = element.getAttribute('data-asset');
    if (!id) continue;
    void assetUrl(id).then((url) => {
      if (url) element.src = url;
      else element.classList.add('is-missing');
    });
  }
}

/** Warms the cache for a whole document before it is drawn. */
export async function preloadAssets(ids: Iterable<string>): Promise<void> {
  await Promise.all([...new Set(ids)].map((id) => assetUrl(id)));
}

// ------------------------------------------------------------------ plumbing

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** In chunks: `String.fromCharCode(...)` on a megabyte blows the call stack. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = '';
  for (let at = 0; at < bytes.length; at += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(out);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

/** The extension an exported copy of this asset should carry. */
export function extensionFor(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

export type { AssetRecord };
