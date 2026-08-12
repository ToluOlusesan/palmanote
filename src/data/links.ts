/**
 * Following a web link, whichever shell is underneath.
 *
 * On the desktop it crosses the bridge and is checked again in Rust before the
 * machine's browser sees it; in a browser build there is no bridge and the tab
 * opens directly. Both refuse anything that is not http, https or mailto —
 * this side because it is cheap and stops the obvious cases, the Rust side
 * because that is the boundary and the renderer is the half that could be
 * talked into asking.
 *
 * Nothing here fetches the target. The app opens links; it does not read them.
 */

import { isSafeLink } from '../core/links.ts';
import { bridge } from './bridge.ts';

export function openLink(href: string): void {
  if (!isSafeLink(href)) return;
  if (bridge) {
    // A link that will not open is not worth a dialog over the page someone
    // is writing on. It either opened or it did not.
    void bridge.openExternal(href).catch(() => {});
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}
