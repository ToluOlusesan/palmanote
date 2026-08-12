/**
 * electron-builder afterPack hook: removes what a prose editor cannot use.
 *
 * Electron ships a whole browser, and most of a browser is for things this app
 * never does — decode video, compile GPU shaders, render in ninety languages.
 * Each removal below names what it is and why it is safe here; anything whose
 * absence could produce a blank window on somebody's machine is left alone and
 * said so at the bottom.
 *
 * Sizes are uncompressed. The installer compresses at roughly 3:1.
 */

const { existsSync, readdirSync, rmSync, statSync } = require('node:fs');
const { join } = require('node:path');

/** Locales Electron ships .pak files for. We render one interface, in English. */
const KEEP_LOCALES = new Set(['en-US.pak']);

/**
 * DirectX shader compilation, for WebGPU and D3D12. There is no canvas, no
 * WebGL and no WebGPU anywhere in this app — the heaviest thing it draws is a
 * text caret.
 */
const REMOVE_FILES = ['dxcompiler.dll', 'dxil.dll'];

/**
 * better-sqlite3 ships one prebuild file per platform — `win32-x64.node`,
 * `darwin-arm64.node` and so on. Match by prefix: they are files, not folders,
 * and deleting the one we need leaves a build that starts and then cannot
 * open the database.
 */
const KEEP_PREBUILD = 'win32-x64';

function sizeOf(target) {
  if (!existsSync(target)) return 0;
  const stats = statSync(target);
  if (!stats.isDirectory()) return stats.size;
  return readdirSync(target).reduce((total, entry) => total + sizeOf(join(target, entry)), 0);
}

function drop(target, saved) {
  const bytes = sizeOf(target);
  if (bytes === 0) return saved;
  rmSync(target, { recursive: true, force: true });
  return saved + bytes;
}

exports.default = async function trim(context) {
  const root = context.appOutDir;
  let saved = 0;

  const locales = join(root, 'locales');
  if (existsSync(locales)) {
    for (const entry of readdirSync(locales)) {
      if (!KEEP_LOCALES.has(entry)) saved = drop(join(locales, entry), saved);
    }
  }

  for (const name of REMOVE_FILES) saved = drop(join(root, name), saved);

  // better-sqlite3 is unpacked whole so its .node file sits on disk rather
  // than inside the asar. That drags along the amalgamated SQLite C source and
  // the object files it was compiled from — 10 MB of build inputs for a
  // binary that is already built. `lib/binding.js` loads
  // `prebuilds/<platform>.node` and nothing else.
  const nativeModule = join(root, 'resources/app.asar.unpacked/node_modules/better-sqlite3');
  for (const build of ['deps', 'src', 'build']) saved = drop(join(nativeModule, build), saved);

  const prebuilds = join(nativeModule, 'prebuilds');
  if (existsSync(prebuilds)) {
    const kept = [];
    for (const entry of readdirSync(prebuilds)) {
      if (entry.startsWith(KEEP_PREBUILD)) kept.push(entry);
      else saved = drop(join(prebuilds, entry), saved);
    }
    if (kept.length === 0) throw new Error(`trim: removed every ${KEEP_PREBUILD} prebuild`);
  }

  // Left in place on purpose:
  //   LICENSES.chromium.html  — 19 MB of licence text, and Chromium's terms
  //                             require shipping it with the binary.
  //   ffmpeg.dll              — Chromium loads it during startup whether or
  //                             not any media is ever played.
  //   d3dcompiler_47.dll      — ANGLE's shader compiler; without it the
  //                             hardware rendering path can fail to a blank
  //                             window on some GPUs.
  //   vk_swiftshader.dll      — the software fallback for exactly that case.
  console.log(`  • trimmed         ${(saved / 1048576).toFixed(1)} MB from ${context.electronPlatformName}`);
};
