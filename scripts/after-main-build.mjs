/**
 * The renderer is ESM ("type": "module" in package.json) but the Electron main
 * process is CommonJS, so the compiled output needs its own marker or Node
 * refuses to load it.
 */
import { writeFileSync } from 'node:fs';

writeFileSync('dist-electron/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
