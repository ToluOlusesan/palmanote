/**
 * The Tauri shell, wearing the same face as the Electron one.
 *
 * Everything above `bridge.ts` calls the identical twenty methods whichever
 * shell is underneath. Here they become `invoke` calls to the Rust commands in
 * `src-tauri/src/main.rs`; the argument and return shapes match because both
 * sides serialise the types in `src/core/types.ts`.
 *
 * The one place the two shells genuinely differ is PDF, and it is handled
 * where it shows rather than faked here — see `printToPDF` below.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import type { PalmaNoteBridge, WindowState, WriteExportRequest } from './bridge.ts';

/** Tauri injects this before any of our code runs. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function createTauriBridge(): PalmaNoteBridge {
  return {
    platform: 'win32',
    dataDirectory: '',

    listDocuments: () => invoke('list_documents'),
    getDocument: (id) => invoke('get_document', { id }),
    createDocument: (input) => invoke('create_document', { input }),
    renameDocument: (id, title) => invoke('rename_document', { id, title }),
    setKind: (id, kind) => invoke('set_kind', { id, kind }),
    setFavorite: (id, favorite) => invoke('set_favorite', { id, favorite }),
    setIcon: (id, icon) => invoke('set_icon', { id, icon }),
    setCover: (id, cover, offset) => invoke('set_cover', { id, cover, offset }),
    saveContent: (input) => invoke('save_content', { input }),
    moveDocument: (input) => invoke('move_document', { input }),
    archiveDocument: (id) => invoke('archive_document', { id }),
    restoreDocument: (id) => invoke('restore_document', { id }),
    deleteDocument: (id) => invoke('delete_document', { id }),
    listRevisions: (documentId) => invoke('list_revisions', { documentId }),
    pruneRevisions: () => invoke('prune_revisions'),
    recordActivity: (input) => invoke('record_activity', { input }),
    listActivity: (sinceDay) => invoke('list_activity', { sinceDay }),
    listStickies: (documentId) => invoke('list_stickies', { documentId }),
    putSticky: (note) => invoke('put_sticky', { note }),
    deleteSticky: (id) => invoke('delete_sticky', { id }),
    backlinks: (id) => invoke('backlinks', { id }),
    putAsset: (asset) => invoke('put_asset', { asset }),
    getAsset: (id) => invoke('get_asset', { id }),
    collectAssets: () => invoke('collect_assets'),

    copyImages: (ids) => invoke('copy_images', { ids }),

    writeExport: (request: WriteExportRequest) => invoke('write_export', { request }),
    pickImport: (folder) => invoke('pick_import', { folder }),
    restoreSnapshot: () => invoke('restore_snapshot'),
    pickPdf: () => invoke('pick_pdf'),

    /**
     * WebView2 can print to a file, but Tauri exposes no route to it, so this
     * opens the print dialog with "Save as PDF" preselected by the platform
     * instead. One extra click, and the same print stylesheet does the layout.
     */
    async printToPDF() {
      window.print();
      return { written: 0, location: null, cancelled: false };
    },

    openExternal: (url) => invoke('open_external', { url }),

    windowState: () => invoke('window_state'),
    onWindowState: (listener) => {
      const pending = listen<WindowState>('window:state', (event) => listener(event.payload));
      let stop: (() => void) | null = null;
      let cancelled = false;
      void pending.then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      });
      return () => {
        cancelled = true;
        stop?.();
      };
    },
    minimize: () => void invoke('minimize_window'),
    toggleMaximize: () => void invoke('toggle_maximize'),
    close: () => void invoke('close_window'),
  };
}
