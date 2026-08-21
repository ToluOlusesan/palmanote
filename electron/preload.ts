/**
 * The only thing the renderer can see of Node.
 *
 * contextIsolation is on and nodeIntegration is off, so this is a hand-written
 * list of exactly what the page is allowed to ask for. No `ipcRenderer`, no
 * `require`, no filesystem — each function below is a named request the main
 * process knows how to answer.
 */

import { contextBridge, ipcRenderer } from 'electron';

import type { PalmaNoteBridge, WindowState, WriteExportRequest } from '../src/data/bridge.ts';

const api: PalmaNoteBridge = {
  platform: process.platform,
  dataDirectory: process.env.PALMANOTE_DATA_DIR ?? '',

  listDocuments: () => ipcRenderer.invoke('db:listDocuments'),
  getDocument: (id) => ipcRenderer.invoke('db:getDocument', id),
  createDocument: (input) => ipcRenderer.invoke('db:createDocument', input),
  renameDocument: (id, title) => ipcRenderer.invoke('db:renameDocument', id, title),
  setKind: (id, kind) => ipcRenderer.invoke('db:setKind', id, kind),
  setFavorite: (id, favorite) => ipcRenderer.invoke('db:setFavorite', id, favorite),
  setIcon: (id, icon) => ipcRenderer.invoke('db:setIcon', id, icon),
  setCover: (id, cover, offset) => ipcRenderer.invoke('db:setCover', id, cover, offset),
  saveContent: (input) => ipcRenderer.invoke('db:saveContent', input),
  moveDocument: (input) => ipcRenderer.invoke('db:moveDocument', input),
  archiveDocument: (id) => ipcRenderer.invoke('db:archiveDocument', id),
  restoreDocument: (id) => ipcRenderer.invoke('db:restoreDocument', id),
  deleteDocument: (id) => ipcRenderer.invoke('db:deleteDocument', id),
  listRevisions: (documentId) => ipcRenderer.invoke('db:listRevisions', documentId),
  pruneRevisions: () => ipcRenderer.invoke('db:pruneRevisions'),
  recordActivity: (input) => ipcRenderer.invoke('db:recordActivity', input),
  listActivity: (sinceDay) => ipcRenderer.invoke('db:listActivity', sinceDay),
  listStickies: (documentId) => ipcRenderer.invoke('db:listStickies', documentId),
  putSticky: (note) => ipcRenderer.invoke('db:putSticky', note),
  deleteSticky: (id) => ipcRenderer.invoke('db:deleteSticky', id),
  backlinks: (id) => ipcRenderer.invoke('db:backlinks', id),
  putAsset: (asset) => ipcRenderer.invoke('db:putAsset', asset),
  getAsset: (id) => ipcRenderer.invoke('db:getAsset', id),
  collectAssets: () => ipcRenderer.invoke('db:collectAssets'),

  writeExport: (request: WriteExportRequest) => ipcRenderer.invoke('files:writeExport', request),
  printToPDF: (title) => ipcRenderer.invoke('files:printToPDF', title),
  pickImport: (folder) => ipcRenderer.invoke('files:pickImport', folder),
  restoreSnapshot: () => ipcRenderer.invoke('files:restoreSnapshot'),
  pickPdf: () => ipcRenderer.invoke('files:pickPdf'),

  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  windowState: () => ipcRenderer.invoke('window:state'),
  onWindowState: (listener) => {
    const handler = (_event: unknown, state: WindowState) => listener(state);
    ipcRenderer.on('window:state', handler);
    return () => ipcRenderer.off('window:state', handler);
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
  close: () => ipcRenderer.send('window:close'),
};

contextBridge.exposeInMainWorld('palmanote', api);
