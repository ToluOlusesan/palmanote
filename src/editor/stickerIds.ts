/**
 * The sticker ids, on their own, away from the art.
 *
 * `stickers.ts` is the real set — id, label, keywords and a PNG import each —
 * and importing it costs you those nine images. That is right in the editor and
 * wrong in two other places: the markdown reader, which only needs to know
 * whether `:party:` is a sticker or a colon somebody typed, and `node --test`,
 * which cannot load a PNG at all and would fail on the import rather than on
 * anything it was asked to check.
 *
 * `StickerId` is what keeps the two files honest. `Sticker.id` is typed as this
 * union, so a sticker added to the set without its id added here does not
 * compile — which is the same promise the hand-written mapping in `stickers.ts`
 * makes about ids never being renamed, enforced one level up.
 */
export const STICKER_IDS = [
  'check',
  'checklist',
  'idea',
  'search',
  'heart',
  'party',
  'coin',
  'lock',
  'person',
] as const;

export type StickerId = (typeof STICKER_IDS)[number];
