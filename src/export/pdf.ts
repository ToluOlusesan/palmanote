import { generateHTML, type JSONContent } from '@tiptap/core';

import { bridge, type WriteExportOutcome } from '../data/bridge.ts';
import type { PalmaNoteStore } from '../data/store.ts';
import { preloadAssets, resolveAssetImages } from '../editor/assets.ts';
import { extensions } from '../editor/extensions.ts';
import { assetIdsIn, safeFileName, walkScope, type ExportScope } from './walk.ts';

/**
 * PDF, written by the engine that draws the pages — desktop only.
 *
 * The pages being exported are laid out in a print root of their own, from
 * their saved content rather than from whatever the editor happens to show,
 * so "this page and everything inside it" prints every page and not only the
 * open one. `is-printing` tells the print stylesheet to show that root and
 * nothing else; the shell then has WebView2 write it to a file with no print
 * dialog in between. See src-tauri/src/pdf.rs.
 *
 * Laid out with the editor's own schema through `generateHTML`, and given the
 * prose's own class, so the PDF is set exactly as the page is on screen —
 * colours, sizes, alignment and highlights included.
 */

/** Only the desktop shell can write a PDF without a print dialog. */
export const canExportPdf = typeof bridge?.printPdf === 'function';

/**
 * Lays the pages out in the print root and turns the print stylesheet onto it.
 * Returns the function that takes it all down again.
 */
export async function mountPrintRoot(store: PalmaNoteStore, scope: ExportScope): Promise<() => void> {
  const walk = await walkScope(store, scope);
  await preloadAssets(assetIdsIn(walk));

  const root = document.createElement('div');
  root.className = 'print-root';
  for (const entry of walk.documents) {
    const page = document.createElement('article');
    page.className = 'print-page';
    if (entry.meta.title) {
      const title = document.createElement(entry.depth === 0 ? 'h1' : 'h2');
      title.className = 'print-title';
      title.textContent = entry.meta.title;
      page.append(title);
    }
    const body = document.createElement('div');
    body.className = 'body';
    if (entry.content) body.innerHTML = generateHTML(entry.content as JSONContent, extensions);
    page.append(body);
    root.append(page);
  }
  resolveAssetImages(root);
  document.body.append(root);
  document.documentElement.classList.add('is-printing');
  // A picture that has not decoded prints as a hole.
  await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));

  return () => {
    root.remove();
    document.documentElement.classList.remove('is-printing');
  };
}

export async function exportPdf(
  store: PalmaNoteStore,
  scope: ExportScope,
  name: string,
): Promise<WriteExportOutcome> {
  if (!bridge?.printPdf) throw new Error('PDF export needs the desktop app.');
  const unmount = await mountPrintRoot(store, scope);
  try {
    return await bridge.printPdf(`${safeFileName(name, 'PalmaNote')}.pdf`);
  } finally {
    unmount();
  }
}
