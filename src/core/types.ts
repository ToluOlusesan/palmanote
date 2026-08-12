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
