/**
 * Main process: the window, the database, the filesystem. The renderer
 * touches none of these directly — everything crosses the narrow IPC surface
 * declared in preload.ts.
 */

import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { SqliteStore } from './sqliteStore.ts';
import type { WriteExportRequest } from '../src/data/bridge.ts';

const DEV_SERVER = process.env.VITE_DEV_SERVER_URL;
const WINDOW_STATE_FILE = 'window-state.json';
/** Nightly, and once shortly after launch so a machine that is never left on still gets one. */
const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;

let store: SqliteStore;
let mainWindow: BrowserWindow | null = null;

interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

function statePath(): string {
  return join(app.getPath('userData'), WINDOW_STATE_FILE);
}

function readBounds(): WindowBounds {
  try {
    const raw = readFileSync(statePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<WindowBounds>;
    return {
      x: parsed.x,
      y: parsed.y,
      width: Math.max(parsed.width ?? 1180, 640),
      height: Math.max(parsed.height ?? 820, 480),
      maximized: Boolean(parsed.maximized),
    };
  } catch {
    return { width: 1180, height: 820, maximized: false };
  }
}

function saveBounds(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  const bounds = window.getNormalBounds();
  const state: WindowBounds = { ...bounds, maximized: window.isMaximized() };
  try {
    writeFileSync(statePath(), JSON.stringify(state), 'utf8');
  } catch {
    // Losing the window position is not worth failing a quit over.
  }
}

function createWindow(): void {
  const bounds = readBounds();
  const window = new BrowserWindow({
    ...bounds,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#f0efec',
    // The tab strip lives in the title bar, so the frame has to go.
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });

  mainWindow = window;
  if (bounds.maximized) window.maximize();
  window.once('ready-to-show', () => window.show());

  const publish = () =>
    window.webContents.send('window:state', {
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(),
    });
  window.on('maximize', publish);
  window.on('unmaximize', publish);
  window.on('enter-full-screen', publish);
  window.on('leave-full-screen', publish);
  window.on('resize', () => saveBounds(window));
  window.on('move', () => saveBounds(window));
  window.on('close', () => saveBounds(window));
  window.on('closed', () => {
    mainWindow = null;
  });

  // Anything that isn't this app opens in the real browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_SERVER) void window.loadURL(DEV_SERVER);
  else void window.loadFile(join(__dirname, '../../dist/index.html'));
}

// ------------------------------------------------------------------- IPC

function registerHandlers(): void {
  const call = <A extends unknown[], R>(channel: string, handler: (...args: A) => Promise<R> | R) =>
    ipcMain.handle(channel, (_event, ...args) => handler(...(args as A)));

  call('db:listDocuments', () => store.listDocuments());
  call('db:getDocument', (id: string) => store.getDocument(id));
  call('db:createDocument', (input: Parameters<SqliteStore['createDocument']>[0]) =>
    store.createDocument(input),
  );
  call('db:renameDocument', (id: string, title: string) => store.renameDocument(id, title));
  call('db:setKind', (id: string, kind: Parameters<SqliteStore['setKind']>[1]) => store.setKind(id, kind));
  call('db:setFavorite', (id: string, favorite: boolean) => store.setFavorite(id, favorite));
  call('db:setIcon', (id: string, icon: string | null) => store.setIcon(id, icon));
  call('db:setCover', (id: string, cover: string | null, offset: number) =>
    store.setCover(id, cover, offset),
  );
  call('db:saveContent', (input: Parameters<SqliteStore['saveContent']>[0]) => store.saveContent(input));
  call('db:moveDocument', (input: Parameters<SqliteStore['moveDocument']>[0]) => store.moveDocument(input));
  call('db:archiveDocument', (id: string) => store.archiveDocument(id));
  call('db:restoreDocument', (id: string) => store.restoreDocument(id));
  call('db:deleteDocument', (id: string) => store.deleteDocument(id));
  call('db:listRevisions', (id: string) => store.listRevisions(id));
  call('db:pruneRevisions', () => store.pruneRevisions());
  call('db:backlinks', (id: string) => store.backlinks(id));
  call('db:putAsset', (asset: Parameters<typeof store.putAsset>[0]) => store.putAsset(asset));
  call('db:getAsset', (id: string) => store.getAsset(id));
  call('db:collectAssets', () => store.collectAssets());

  call('files:writeExport', async (request: WriteExportRequest) => {
    if (!mainWindow) return { written: 0, location: null, cancelled: true };

    let root: string;
    if (request.folder === null) {
      const single = request.files[0];
      const chosen = await dialog.showSaveDialog(mainWindow, {
        title: 'Export',
        defaultPath: join(app.getPath('documents'), single?.path ?? 'springboard'),
      });
      if (chosen.canceled || !chosen.filePath) return { written: 0, location: null, cancelled: true };
      writeOne(chosen.filePath, single!);
      return { written: 1, location: chosen.filePath, cancelled: false };
    }

    const chosen = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder to export into',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (chosen.canceled || chosen.filePaths.length === 0) {
      return { written: 0, location: null, cancelled: true };
    }
    root = join(chosen.filePaths[0]!, request.folder);
    for (const file of request.files) writeOne(join(root, file.path), file);
    return { written: request.files.length, location: root, cancelled: false };
  });

  call('files:printToPDF', async (title: string) => {
    if (!mainWindow) return { written: 0, location: null, cancelled: true };
    const chosen = await dialog.showSaveDialog(mainWindow, {
      title: 'Save as PDF',
      defaultPath: join(app.getPath('documents'), `${title}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (chosen.canceled || !chosen.filePath) return { written: 0, location: null, cancelled: true };
    // The print stylesheet does the layout; Chromium does the rendering.
    const data = await mainWindow.webContents.printToPDF({
      printBackground: false,
      pageSize: 'Letter',
      margins: { marginType: 'default' },
    });
    writeFileSync(chosen.filePath, data);
    return { written: 1, location: chosen.filePath, cancelled: false };
  });

  call('files:reveal', (path: string) => shell.showItemInFolder(path));
  // Checked here rather than trusted from the renderer, for the same reason
  // the Tauri build checks it in Rust: this is the boundary.
  call('shell:openExternal', async (url: string) => {
    const protocol = (() => {
      try {
        return new URL(url).protocol;
      } catch {
        return '';
      }
    })();
    if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'mailto:') {
      throw new Error(`refusing to open a ${protocol || 'malformed'} link`);
    }
    await shell.openExternal(url);
  });

  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:toggleMaximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  call('window:state', () => ({
    maximized: mainWindow?.isMaximized() ?? false,
    fullScreen: mainWindow?.isFullScreen() ?? false,
  }));
}

function writeOne(target: string, file: { data: string | number[]; binary: boolean }): void {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.binary ? Buffer.from(file.data as number[]) : (file.data as string), {
    encoding: file.binary ? undefined : 'utf8',
  });
}

// ------------------------------------------------------------------ boot

// The packaged build ships one locale pak. Asking Chromium for a locale whose
// pak is missing is how a trimmed build fails to start on somebody else's
// machine, so pin the request to the one we ship. This is the interface
// language only — spellcheck and text input are unaffected.
app.commandLine.appendSwitch('lang', 'en-US');

// One window, one database. A second instance would fight over the file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    const dataDirectory = app.getPath('userData');
    mkdirSync(dataDirectory, { recursive: true });
    try {
      store = new SqliteStore(join(dataDirectory, 'springboard.sqlite'));
      store.pruneRevisions();
    } catch (error) {
      // Without a database there is nothing to show, and a window that never
      // appears is the worst way to say so.
      dialog.showErrorBox(
        'Springboard cannot open its library',
        `${String(error)}

The database lives at
${dataDirectory}`,
      );
      app.exit(1);
      return;
    }

    const snapshotDirectory = join(app.getPath('documents'), 'Springboard Snapshots');
    const snapshot = () => {
      try {
        store.snapshotTo(snapshotDirectory);
      } catch (error) {
        console.error('snapshot failed', error);
      }
    };
    setTimeout(snapshot, 60_000);
    setInterval(snapshot, SNAPSHOT_INTERVAL_MS);

    registerHandlers();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    store?.close();
    if (process.platform !== 'darwin') app.quit();
  });
}
