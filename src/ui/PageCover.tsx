import { ImageSquare, Trash } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DocumentMeta } from '../core/types.ts';
import { assetUrl, cachedAssetUrl, pickImageFile, storeImage } from '../editor/assets.ts';
import { useLibrary } from '../state/library.tsx';

/**
 * The banner across the top of a page.
 *
 * A cover is an asset id on the document and nothing else — the same ids the
 * prose uses, stored the same way, deduplicated by the same hash. Using a
 * picture that is already in the page as its cover therefore costs nothing,
 * and the sweep in `collectAssets` knows to count this reference; see
 * `PalmaNoteStore.setCover`.
 *
 * It is deliberately not a block in the document. A cover belongs to the page
 * rather than to a position in it: it survives the writer selecting everything
 * and typing over it, it never lands in the middle of the prose after a bad
 * paste, and it stays out of the exports' block walk, where a banner is
 * decoration and not a paragraph.
 */

/** How far one arrow press moves the crop, as a percentage of the travel. */
const NUDGE = 4;

/**
 * Where a document's cover picture is, once it has been read.
 *
 * Assets come out of the library asynchronously, so the first frame of a page
 * with a cover has an id and no URL. Returning the cached URL when there is
 * one means an image already on screen — the usual case, since covers are
 * usually pictures the page has seen — draws immediately rather than blinking.
 */
function useCoverUrl(cover: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() => (cover ? (cachedAssetUrl(cover) ?? null) : null));

  useEffect(() => {
    if (!cover) {
      setUrl(null);
      return;
    }
    const ready = cachedAssetUrl(cover);
    if (ready) {
      setUrl(ready);
      return;
    }
    let cancelled = false;
    setUrl(null);
    void assetUrl(cover).then((found) => {
      if (!cancelled) setUrl(found);
    });
    return () => {
      cancelled = true;
    };
  }, [cover]);

  return url;
}

/** Stores the chosen file and points the page at it. Shared by both entries. */
function useChooseCover(doc: DocumentMeta): () => void {
  const library = useLibrary();
  return useCallback(() => {
    void (async () => {
      const file = await pickImageFile();
      if (!file) return;
      try {
        const stored = await storeImage(file);
        // A new picture starts centred even if the last one had been dragged.
        // The old offset was a fact about a different image.
        await library.setCover(doc.id, stored.id, 50);
      } catch (error) {
        console.warn('PalmaNote could not read that image.', error);
      }
    })();
  }, [doc.id, library]);
}

/**
 * The way in, shown above the title on a page that has no cover yet.
 *
 * Hidden until the page is hovered — see the stylesheet. A permanent button
 * over every untouched page would be an instruction to decorate it, and most
 * pages should not have a cover.
 */
export function AddCoverButton({ doc }: { doc: DocumentMeta }) {
  const choose = useChooseCover(doc);
  if (doc.cover) return null;
  return (
    <div className="sheet-tools">
      <button type="button" className="sheet-tool" onClick={choose}>
        <ImageSquare size={15} weight="regular" />
        Add cover
      </button>
    </div>
  );
}

export function PageCover({ doc }: { doc: DocumentMeta }) {
  const library = useLibrary();
  const choose = useChooseCover(doc);
  const url = useCoverUrl(doc.cover);
  const frame = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);

  // The offset being dragged, which is only the stored one until a drag
  // starts. Kept apart so a pointer moving over the image does not write to
  // the database sixty times a second.
  const [offset, setOffset] = useState(doc.coverOffset);
  const [dragging, setDragging] = useState(false);
  const commitTimer = useRef<number | null>(null);
  // Mirrors the state, so the pointer handlers can read the live offset and
  // write it without going through an updater. React deliberately calls
  // updaters twice, and a save inside one is a save that happens twice.
  const live = useRef(doc.coverOffset);
  const put = useCallback((next: number) => {
    live.current = next;
    setOffset(next);
  }, []);
  useEffect(() => {
    live.current = doc.coverOffset;
    setOffset(doc.coverOffset);
  }, [doc.id, doc.coverOffset]);

  const commit = useCallback(
    (next: number) => {
      if (commitTimer.current !== null) clearTimeout(commitTimer.current);
      commitTimer.current = window.setTimeout(() => {
        commitTimer.current = null;
        if (doc.cover) void library.setCover(doc.id, doc.cover, next);
      }, 150);
    },
    [doc.cover, doc.id, library],
  );

  useEffect(
    () => () => {
      if (commitTimer.current !== null) clearTimeout(commitTimer.current);
    },
    [],
  );

  /**
   * How many pixels of the picture are hidden above and below the band on
   * show. This is what makes a drag move the image with the pointer rather
   * than by some invented factor: `object-position` is a percentage of exactly
   * this distance, so dividing by it is the whole conversion.
   *
   * Zero when the image is not taller than the frame, which is when there is
   * nothing to reposition and the drag is refused rather than faked.
   */
  const travel = (): number => {
    const box = frame.current?.getBoundingClientRect();
    const image = picture.current;
    if (!box || !image?.naturalWidth) return 0;
    const drawn = (box.width * image.naturalHeight) / image.naturalWidth;
    return Math.max(0, drawn - box.height);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !url) return;
    const range = travel();
    if (range <= 0) return;
    const startY = event.clientY;
    const startOffset = offset;
    let moved = false;

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);

    const move = (event: PointerEvent) => {
      const delta = event.clientY - startY;
      if (Math.abs(delta) > 2) moved = true;
      // Dragging the picture down reveals what is above it, which is a
      // *smaller* percentage: object-position measures from the top.
      put(Math.max(0, Math.min(100, startOffset - (delta / range) * 100)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(false);
      // A click that never moved is not a reposition, and writing the offset
      // it already had would put a pointless entry in the page's updated_at.
      if (moved) commit(live.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowUp' ? -NUDGE : event.key === 'ArrowDown' ? NUDGE : 0;
    if (step === 0 || travel() <= 0) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(100, live.current + step));
    put(next);
    commit(next);
  };

  if (!doc.cover) return null;

  const adjustable = url !== null;

  return (
    <div className={`cover${dragging ? ' is-dragging' : ''}`}>
      <div
        ref={frame}
        className="cover-frame"
        role="img"
        aria-label="Page cover. Drag, or use the arrow keys, to reposition it."
        tabIndex={adjustable ? 0 : -1}
        title="Drag to reposition"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        {url ? (
          <img
            ref={picture}
            className="cover-image"
            src={url}
            alt=""
            draggable={false}
            style={{ objectPosition: `50% ${offset}%` }}
          />
        ) : (
          // The bytes are still coming out of the library, or they are gone.
          // Either way the band stays the height it will be, so the page does
          // not jump under the writer when the picture arrives.
          <div className="cover-empty" />
        )}
      </div>

      <div className="cover-actions">
        <button type="button" className="cover-action" onClick={choose}>
          Change cover
        </button>
        <button
          type="button"
          className="cover-action"
          onClick={() => void library.setCover(doc.id, null)}
          aria-label="Remove cover"
        >
          <Trash size={14} />
          Remove
        </button>
      </div>
    </div>
  );
}
