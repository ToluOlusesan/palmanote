/**
 * Shared row shapes. These mirror the SQLite schema in src/data/schema.sql
 * one-for-one so the Electron port is an adapter swap, not a rewrite.
 *
 * Timestamps are epoch milliseconds (INTEGER in SQLite).
 */

export type DocumentKind = 'folder' | 'chapter' | 'scene' | 'note';

export const DOCUMENT_KINDS: readonly DocumentKind[] = ['folder', 'chapter', 'scene', 'note'];

/** A ProseMirror document node. Deliberately loose: the schema lives in the editor. */
export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface PMDoc extends PMNode {
  type: 'doc';
  content?: PMNode[];
}

/** Everything about a document except its body. This is what the tree loads. */
export interface DocumentMeta {
  id: string;
  parentId: string | null;
  /** Fractional index; siblings sort by lexicographic comparison. */
  position: string;
  title: string;
  kind: DocumentKind;
  /** Pinned to the top of the sidebar. */
  favorite: boolean;
  /** A single emoji, chosen by the owner. Null falls back to a kind glyph. */
  icon: string | null;
  /**
   * The asset id of a banner across the top of the page, or null for none.
   *
   * An id like any other image's, which means a cover costs nothing when it is
   * a picture the page already contains — same bytes, same hash, one copy. It
   * also means the sweep in `collectAssets` has to look here as well as in the
   * prose, because this is the one reference to an asset that is *not* a node
   * in a document.
   */
  cover: string | null;
  /**
   * Which horizontal band of the cover to show, 0–100, as a percentage down
   * the image. 50 is the middle, which is where every cover starts.
   *
   * A banner is much wider than it is tall, so almost every photograph is
   * cropped by it and the crop is usually wrong — a face at the top, a horizon
   * at the bottom. This is the writer dragging it into place, and it is on the
   * document rather than the asset because the same picture can be the cover
   * of two pages and want a different band in each.
   */
  coverOffset: number;
  wordCount: number;
  createdAt: number;
  updatedAt: number;
  /** Soft delete. Set on the subtree root only; descendants are hidden by traversal. */
  archivedAt: number | null;
}

export interface DocumentRecord extends DocumentMeta {
  /** null for pure containers that have never been written in. */
  content: PMDoc | null;
}

/**
 * One page's references to another, read out of the prose rather than stored.
 *
 * Carries the linking page's id and nothing else about it: the tree already
 * holds every page's metadata in memory, so sending the title and icon back
 * across the bridge would be shipping a second copy of something the renderer
 * is already holding — and a stale one, the moment the page is renamed.
 */
export interface Backlink {
  /** The page holding the link. Look the rest up in the tree. */
  id: string;
  /** How many times it points at the target. */
  count: number;
  /** The block the first link sits in, flattened and trimmed. */
  context: string;
}

export interface RevisionRecord {
  id: string;
  documentId: string;
  content: PMDoc | null;
  wordCount: number;
  createdAt: number;
}

/** The four papers a sticky note comes on. */
export type StickyColour = 'lime' | 'orange' | 'blue' | 'pink';

export const STICKY_COLOURS: readonly StickyColour[] = ['lime', 'orange', 'blue', 'pink'];

/**
 * A thought stuck to the side of a page.
 *
 * Deliberately *not* part of the document. A sticky note is the aside you write
 * while writing something else — a reminder, a name to check, an argument with
 * yourself — and the whole point is that it is not in the draft: it does not
 * export, it does not count towards the page's words, it does not appear in a
 * revision, and deleting it takes nothing with it. Keeping them in the
 * ProseMirror doc would have made every one of those false.
 *
 * They have no position. Notes live in a fixed rail down the right of the
 * window and stack in the order they were written — which is why there is no
 * `x` or `y` here. A note that could be dragged anywhere was the first cut of
 * this and it was wrong: a thought parked over the third paragraph is a thought
 * you lose the moment the page is edited above it.
 */
export interface StickyNote {
  id: string;
  /** The page it is stuck to. Notes travel with their page, not the window. */
  documentId: string;
  text: string;
  colour: StickyColour;
  /**
   * The id of the `comment` mark this note is attached to, or null for a
   * sticky, which is attached to the page and to nothing in it.
   *
   * That one field is the whole difference between the two. Both are the aside
   * you write *while* writing something else, and both are kept out of the
   * document for the same reasons — neither exports, neither counts towards
   * the words, neither is in a revision. A comment simply also points at a run
   * of words, and the pointing is a mark in the prose rather than a position
   * stored here: a paragraph inserted above it would make a stored position
   * wrong, and a mark just moves.
   */
  anchor: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * One day of writing, as one row. The whole history of a working year is 365
 * of these, which is why it is kept as its own tiny table rather than derived
 * from `revisions` — those are pruned, and they carry a copy of the prose,
 * so counting a year out of them means reading a year of documents.
 *
 * `words` is words *touched*, not words gained: a save that cuts forty words
 * counts the same as one that adds forty. Net growth is the wrong measure of
 * a day's work — it reads a morning spent tightening a chapter as an empty
 * square, which is exactly the morning worth encouraging.
 *
 * `seconds` is time actually spent, accumulated from the gaps between edits
 * and only while those gaps stay short — see `ACTIVE_GAP_MS`. It is context
 * rather than score: it stops a window left open overnight from counting,
 * without becoming the number anyone is asked to chase.
 */
export interface ActivityDay {
  /** Local calendar day as `YYYY-MM-DD`. The primary key. */
  day: string;
  /** Words added and removed, both counted positively. */
  words: number;
  /** Seconds of active writing. */
  seconds: number;
  /**
   * When the last edit landed, epoch ms. Kept because the next edit's credit
   * is the gap since this one, so the row has to remember where it left off.
   */
  lastAt: number;
  /** Pages touched on this day, in the order they first appeared. */
  documentIds: string[];
}

/**
 * An image, addressed by what it is rather than by where it came from.
 *
 * `id` is the SHA-256 of the bytes, so the same picture pasted into six pages
 * is stored once and a document that references it holds nothing but a
 * sixty-four character string. That is what keeps `revisions` — which copies
 * a document's whole content on every snapshot — from turning one screenshot
 * into a hundred copies of one screenshot.
 *
 * The bytes cross the bridge as base64 rather than as an array of numbers,
 * because Tauri's `invoke` is JSON underneath and a JSON array of bytes costs
 * roughly four characters per byte to base64's one and a third.
 */
export interface AssetRecord {
  /** Lowercase hex SHA-256 of `data`, decoded. */
  id: string;
  mime: string;
  /** base64, no data-URL prefix. */
  data: string;
  width: number;
  height: number;
  createdAt: number;
}

/** Everything about an asset except the bytes. */
export type AssetMeta = Omit<AssetRecord, 'data'>;
