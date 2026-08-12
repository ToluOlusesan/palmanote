/**
 * Web links: what counts as one, and what it should read as.
 *
 * The app has never opened a socket and this does not change that. A link is
 * text with an address attached; following one hands the address to the
 * machine's browser and nothing comes back. There is no unfurling, no preview
 * card, no favicon fetched, no title looked up — every one of those would mean
 * the app quietly calling whatever domain you happened to paste, and the whole
 * point of `default-src 'self'` in tauri.conf.json is that it never does.
 *
 * The title, when there is one, comes off the clipboard instead: a browser
 * copying a link puts `<a href=…>The Page Title</a>` on it, so the name is
 * already in hand and no request is needed to learn it.
 */

/**
 * Three, and no others. `file:` would turn a pasted line into a double-click
 * on anything the account can read; `javascript:` and `data:` are not
 * addresses. Rust checks this again at the boundary — see `open_external` —
 * because the renderer is the side that could be talked into asking.
 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function isSafeLink(href: string): boolean {
  try {
    return SAFE_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

/**
 * What a bare URL should read as when there is no title to show instead.
 *
 * `https://github.com/owner/repo/issues/4127?utm_source=x#top` becomes
 * `github.com/owner/repo/issues/4127`. The scheme, the `www.`, the tracking
 * query and the fragment are all noise in prose; the host and the path are
 * the part a person recognises.
 */
export function tidyUrl(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (url.protocol === 'mailto:') return url.pathname;

  const host = url.host.replace(/^www\./, '');
  const path = url.pathname.replace(/\/$/, '');
  return `${host}${path}`;
}
