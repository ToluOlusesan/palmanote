/**
 * Runs the desktop app against the Vite dev server, with hot reload in the
 * renderer and a rebuild-and-restart when anything in electron/ changes.
 *
 *   npm run electron:dev
 */

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { createServer } from 'vite';
import electron from 'electron';

const server = await createServer({ server: { port: 5273, strictPort: true } });
await server.listen();
const url = server.resolvedUrls?.local?.[0];
if (!url) throw new Error('vite did not report a local url');
console.log(`renderer on ${url}`);

let child = null;

const compile = () =>
  new Promise((resolve) => {
    const tsc = spawn('npx', ['tsc', '-p', 'electron'], { stdio: 'inherit', shell: true });
    tsc.on('exit', (code) => resolve(code === 0));
  });

const start = async () => {
  if (!(await compile())) {
    console.error('main process did not compile; leaving the last build running');
    return;
  }
  child?.kill();
  const env = { ...process.env, VITE_DEV_SERVER_URL: url };
  // Some Electron-based tools export this for their children; inherited, it
  // makes Electron boot as plain Node with no app and no window.
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, ['.'], { stdio: 'inherit', env });
  child.on('exit', (code) => {
    if (code !== null) shutdown();
  });
};

const shutdown = async () => {
  child?.kill();
  await server.close();
  process.exit(0);
};

let pending = null;
watch('electron', { recursive: true }, () => {
  clearTimeout(pending);
  pending = setTimeout(() => {
    console.log('main process changed — restarting');
    void start();
  }, 150);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await start();
