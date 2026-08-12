import check from '../assets/stickers/check.png';
import checklist from '../assets/stickers/checklist.png';
import coin from '../assets/stickers/coin.png';
import heart from '../assets/stickers/heart.png';
import idea from '../assets/stickers/idea.png';
import lock from '../assets/stickers/lock.png';
import party from '../assets/stickers/party.png';
import person from '../assets/stickers/person.png';
import search from '../assets/stickers/search.png';

/**
 * The sticker set, hand-written rather than globbed off the folder.
 *
 * A document stores only the `id`, so an id is a promise: rename one and every
 * sticker already written with it goes blank. Globbing would tie that promise
 * to a filename, where a tidy-up would break it silently. Written out, the
 * mapping from id to file is a thing you can see and change on purpose —
 * repoint `src` freely, never touch `id`.
 *
 * The art is 320px square, which is twice the largest size anything draws it
 * at. The originals in `stickers/` at the repo root are 2048px and 27 MB
 * between them; those are the source, these are what ships.
 */
export interface Sticker {
  /** Stored in the document. Permanent. */
  id: string;
  label: string;
  /** Extra words the slash menu should match on, beyond the label. */
  keywords: string;
  src: string;
}

export const STICKERS: Sticker[] = [
  { id: 'check', label: 'Check', keywords: 'tick done yes correct approved green', src: check },
  { id: 'checklist', label: 'Checklist', keywords: 'list tasks todo done paper', src: checklist },
  { id: 'idea', label: 'Idea', keywords: 'lightbulb light bulb thought insight', src: idea },
  { id: 'search', label: 'Search', keywords: 'magnifying glass look find research', src: search },
  { id: 'heart', label: 'Heart', keywords: 'love like favourite favorite red', src: heart },
  { id: 'party', label: 'Party', keywords: 'popper confetti celebrate done shipped', src: party },
  { id: 'coin', label: 'Coin', keywords: 'money gold price cost budget', src: coin },
  { id: 'lock', label: 'Lock', keywords: 'padlock secure private locked secret', src: lock },
  { id: 'person', label: 'Person', keywords: 'profile character who someone avatar', src: person },
];

const BY_ID = new Map(STICKERS.map((sticker) => [sticker.id, sticker]));

/** Undefined for a sticker whose art has since left the set — see Sticker.ts. */
export function stickerById(id: string): Sticker | undefined {
  return BY_ID.get(id);
}
