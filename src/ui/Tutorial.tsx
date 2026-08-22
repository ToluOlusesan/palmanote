import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The first launch, taught on the real interface.
 *
 * Five coachmarks, each dimming the window except a cutout around the actual
 * control it is about — the shape Palma Canvas uses, because a tour that draws
 * its own picture of a button teaches you a picture. The writer looks at the
 * sidebar, the tab strip, the page, the notes switch and the guide, in that
 * order, and every one of them is still there afterwards.
 *
 * It ends by handing over to the guide rather than trying to be one. Five
 * cards cannot hold thirty shortcuts and should not try: this teaches the
 * shape of the room, and F1 holds the detail for the rest of the time you use
 * the app.
 *
 * Shown once. Leaving is one press and is offered on every card, because a
 * tour you cannot get out of is a modal dialog wearing a friendly hat.
 */

const SEEN = 'palmanote:tour';

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN) === 'done';
  } catch {
    // Storage refused — a private window. Better to skip the tour than to run
    // it again on every launch.
    return true;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN, 'done');
  } catch {
    /* Nothing to do, and nothing worth failing over. */
  }
}

/** Puts the tour back, for a writer who asks to see it again. */
export function forgetTour(): void {
  try {
    localStorage.removeItem(SEEN);
  } catch {
    /* As above. */
  }
}

interface Stop {
  /** The live control this card is about. */
  selector: string;
  title: string;
  body: string;
  /** The faster way to the same thing, once you know it is there. */
  keys?: string;
}

const TOUR: Stop[] = [
  {
    selector: '.tree-list',
    title: 'Everything is a page',
    body: 'Pages live here, and pages go inside other pages — drag one onto another to file it, or between two to reorder. The mark above goes back to the launch screen.',
    keys: 'Ctrl + N',
  },
  {
    selector: '.tabstrip',
    title: 'Open pages keep a tab',
    body: 'Clicking a page in the sidebar previews it in one reusable tab, so browsing does not bury you. Write in it and the tab becomes permanent. The + starts a new page.',
    keys: 'Ctrl + T',
  },
  {
    selector: '.sheet',
    title: 'Type / for anything',
    body: 'Headings, lists, quotes, pictures and stickers, without leaving the keyboard. Reach into the margin beside any paragraph for a handle to drag it, and a + to add one underneath.',
    keys: '/',
  },
  {
    selector: '.toolbar .tool[aria-label$="notes"]',
    title: 'Notes beside the writing',
    body: 'A sticky is a thought about the page. Select words and comment to attach one to them. Both sit in a rail down the right, and neither goes into what you export.',
    keys: 'Ctrl + Space',
  },
  {
    selector: '.chrome-btn[aria-label="Guide"]',
    title: 'And everything else is in here',
    body: 'Every shortcut and every corner of the app, searchable, openable mid-sentence. Nothing else needs remembering now — that does.',
    keys: 'F1',
  },
];

const CARD = 320;
/** Between the cutout and the card, around the cutout, and off the edges. */
const GAP = 14;
const PAD = 8;
const MARGIN = 12;
/** A tall target is cut to this, or the "cutout" is the window and dims nothing. */
const TALLEST = 320;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function boxOf(selector: string): Box | null {
  const node = document.querySelector(selector);
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: Math.min(rect.height, TALLEST),
  };
}

/**
 * Where the card goes: under the target, over it, or beside it — whichever
 * fits — then clamped inside the window. A card half off the screen is worse
 * than a card in the wrong place.
 */
function place(target: Box | null, height: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!target) return { left: (vw - CARD) / 2, top: (vh - height) / 2 };

  const bottom = target.top + target.height;
  const right = target.left + target.width;
  let left: number;
  let top: number;

  if (bottom + GAP + height <= vh - MARGIN) {
    top = bottom + GAP;
    left = target.left + target.width / 2 - CARD / 2;
  } else if (target.top - GAP - height >= MARGIN) {
    top = target.top - GAP - height;
    left = target.left + target.width / 2 - CARD / 2;
  } else {
    left = right + GAP + CARD <= vw - MARGIN ? right + GAP : target.left - GAP - CARD;
    top = target.top + target.height / 2 - height / 2;
  }

  return {
    left: Math.min(Math.max(left, MARGIN), vw - CARD - MARGIN),
    top: Math.min(Math.max(top, MARGIN), vh - height - MARGIN),
  };
}

export function Tutorial({ onDone }: { onDone: () => void }) {
  const [at, setAt] = useState(0);
  const [target, setTarget] = useState<Box | null>(null);
  const [spot, setSpot] = useState({ left: -9999, top: -9999 });
  const card = useRef<HTMLDivElement>(null);

  const stop = TOUR[at]!;
  const last = at === TOUR.length - 1;

  const finish = () => {
    markSeen();
    onDone();
  };

  // Measured with retries while it mounts: the toolbar arrives a frame or two
  // after the workspace, and a card that gave up would sit in the middle of
  // the screen pointing at nothing.
  useLayoutEffect(() => {
    let frame = 0;
    let tries = 0;
    const measure = () => {
      const box = boxOf(stop.selector);
      if (box) setTarget(box);
      else if (tries++ < 60) frame = requestAnimationFrame(measure);
      else setTarget(null);
    };
    measure();
    const remeasure = () => setTarget(boxOf(stop.selector));
    window.addEventListener('resize', remeasure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', remeasure);
    };
  }, [stop.selector]);

  // Placed once the card has a height, because where it fits depends on how
  // tall it turned out to be.
  useLayoutEffect(() => {
    setSpot(place(target, card.current?.getBoundingClientRect().height ?? 200));
  }, [target, at]);

  // Capture, and every key: the tour is in front of the app, so nothing behind
  // it should be answering the keyboard while it is up.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish();
      } else if (event.key === 'Enter' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        if (last) finish();
        else setAt((current) => current + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        setAt((current) => Math.max(0, current - 1));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="A quick tour">
      {/* The cutout is a transparent box wearing an enormous shadow, so the
          control being talked about stays lit while the rest goes under. */}
      <div
        className="tour-hole"
        style={
          target
            ? {
                left: target.left - PAD,
                top: target.top - PAD,
                width: target.width + PAD * 2,
                height: target.height + PAD * 2,
              }
            : { left: '50%', top: '50%', width: 0, height: 0 }
        }
      />

      <div className="tour-card" ref={card} style={{ left: spot.left, top: spot.top }}>
        <p className="tour-step">
          {at + 1} of {TOUR.length}
        </p>
        <h2 className="tour-title">{stop.title}</h2>
        <p className="tour-body">{stop.body}</p>
        {stop.keys && (
          <p className="tour-keys">
            <kbd>{stop.keys}</kbd>
          </p>
        )}

        <div className="tour-foot">
          <button type="button" className="btn" onClick={finish}>
            {last ? 'Close' : 'Skip'}
          </button>
          <button
            type="button"
            className="btn is-primary"
            onClick={() => (last ? finish() : setAt((current) => current + 1))}
          >
            {last ? 'Start writing' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
