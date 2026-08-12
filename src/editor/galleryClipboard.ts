import { bridge } from '../data/bridge.ts';
import { store } from '../data/index.ts';

/**
 * Copying a whole gallery.
 *
 * The system clipboard holds one image. Handing `navigator.clipboard.write`
 * six `image/png` items does not put six pictures down — it puts the last one
 * down — and no amount of care on this side changes that, because a clipboard
 * with several pictures in it is not a thing the format can express.
 *
 * What it can express is a *document* containing six pictures, and a *list of
 * files* that happen to be pictures. So a copy puts down both, and the place
 * you paste into decides which it wanted:
 *
 *   - An HTML fragment, which Word, a mail composer, Google Docs and a rich
 *     note-taker all read as "six images, in this order".
 *   - A file list, which Explorer, an upload box and an image editor read as
 *     six files. This one needs the shell — a page cannot put files on the
 *     clipboard, and no browser API pretends otherwise — so the desktop build
 *     goes through Rust and the browser build simply does not have it.
 *
 * See `copy_images` in src-tauri/src/main.rs for the other half.
 */

export interface CopyOutcome {
  /** Pictures actually put down. Ones whose bytes have gone are skipped. */
  count: number;
  /** True when the shell wrote real files as well as the markup. */
  asFiles: boolean;
}

export async function copyImages(ids: string[]): Promise<CopyOutcome> {
  if (ids.length === 0) return { count: 0, asFiles: false };

  if (bridge?.copyImages) {
    try {
      const written = await bridge.copyImages(ids);
      if (written > 0) return { count: written, asFiles: true };
    } catch (error) {
      // The shell could not have the clipboard — something else was holding
      // it, most likely. The page's own write is a worse copy but a real one,
      // so it is tried rather than reported.
      console.warn('Springboard could not copy those images as files.', error);
    }
  }

  await writeMarkup(ids);
  return { count: ids.length, asFiles: false };
}

/**
 * Puts the pictures down as HTML, with the bytes inline as data URIs.
 *
 * The items are promises rather than blobs on purpose: `write` has to be
 * called while the click that asked for it is still recent, and reading a
 * dozen images out of the database first would spend that. Handing over
 * promises lets the browser start the write now and wait for the bytes.
 */
async function writeMarkup(ids: string[]): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('This browser will not take more than one image at a time.');
  }

  const markup = buildMarkup(ids);
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': markup.then((html) => new Blob([html], { type: 'text/html' })),
      // Somewhere to land when the target takes text only. There is no honest
      // plain-text form of six photographs; saying how many beats saying
      // nothing, which is what an absent flavour looks like when pasted.
      'text/plain': markup.then(
        () =>
          new Blob([`${ids.length} image${ids.length === 1 ? '' : 's'} from Springboard`], {
            type: 'text/plain',
          }),
      ),
    }),
  ]);
}

async function buildMarkup(ids: string[]): Promise<string> {
  const assets = await Promise.all(ids.map((id) => store.getAsset(id)));
  const images = assets
    .filter((asset): asset is NonNullable<typeof asset> => asset !== null)
    .map((asset) => `<img src="data:${asset.mime};base64,${asset.data}">`);
  return `<div>${images.join('')}</div>`;
}

/** What the button says once it is done. */
export function describeCopy(outcome: CopyOutcome): string {
  if (outcome.count === 0) return 'Nothing to copy';
  return outcome.asFiles ? `Copied ${outcome.count} files` : `Copied ${outcome.count}`;
}
