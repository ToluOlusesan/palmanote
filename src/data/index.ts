/**
 * Picks the storage backend once, at module load.
 *
 * In the desktop shell every call crosses IPC to better-sqlite3 in the main
 * process. In a browser it goes to IndexedDB. The interface is identical, so
 * this is the only file that has to know which.
 */

import { bridge } from './bridge.ts';
import { IdbStore } from './idbStore.ts';
import type { PalmaNoteStore } from './store.ts';

/** The bridge already implements the contract; it just needs naming as such. */
function desktopStore(desktop: NonNullable<typeof bridge>): PalmaNoteStore {
  return {
    listDocuments: () => desktop.listDocuments(),
    getDocument: (id) => desktop.getDocument(id),
    createDocument: (input) => desktop.createDocument(input),
    renameDocument: (id, title) => desktop.renameDocument(id, title),
    setKind: (id, kind) => desktop.setKind(id, kind),
    setFavorite: (id, favorite) => desktop.setFavorite(id, favorite),
    setIcon: (id, icon) => desktop.setIcon(id, icon),
    setCover: (id, cover, offset) => desktop.setCover(id, cover, offset),
    saveContent: (input) => desktop.saveContent(input),
    moveDocument: (input) => desktop.moveDocument(input),
    archiveDocument: (id) => desktop.archiveDocument(id),
    restoreDocument: (id) => desktop.restoreDocument(id),
    deleteDocument: (id) => desktop.deleteDocument(id),
    listRevisions: (documentId) => desktop.listRevisions(documentId),
    pruneRevisions: () => desktop.pruneRevisions(),
    recordActivity: (input) => desktop.recordActivity(input),
    listActivity: (sinceDay) => desktop.listActivity(sinceDay),
    listStickies: (documentId) => desktop.listStickies(documentId),
    putSticky: (note) => desktop.putSticky(note),
    deleteSticky: (id) => desktop.deleteSticky(id),
    backlinks: (id) => desktop.backlinks(id),
    putAsset: (asset) => desktop.putAsset(asset),
    getAsset: (id) => desktop.getAsset(id),
    collectAssets: () => desktop.collectAssets(),
  };
}

export const store: PalmaNoteStore = bridge ? desktopStore(bridge) : new IdbStore();
