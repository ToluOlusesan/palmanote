/**
 * Renders `assets/logo.svg` into the app icons.
 *
 *   npm run icon
 *
 * Writes build/icon.ico (16–256px) and build/icon.png, the same into
 * src-tauri/icons/ where the bundler looks for them, and public/icons/ for the
 * browser build's tab and its web app manifest.
 *
 * The rasteriser is the browser already on this machine, driven headless. It
 * is a build-time dependency, not a shipped one, and the outputs are kept in
 * the repository — so an ordinary build never needs Chrome. It beats
 * hand-rolling bezier rasterisation, and it draws the actual artwork rather
 * than an approximation of it.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
/**
 * Every size the Windows shell asks for, so it never has to scale one itself:
 * 24 for a small taskbar, 32 at 100%, 40 at 125%, 48 at 150%, 64 at 200%, and
 * the rest for the start menu and file dialogs. A missing size is resampled by
 * the shell, and that always looks soft.
 */
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

/**
 * The browser build's own sizes, kept out of `SIZES` because they are not for
 * the .ico: an icon directory entry's size field is one byte wide, so 256 is
 * already written as zero and anything above it cannot be expressed at all.
 *
 * 192 and 512 are what a web app manifest is asked for — a browser will not
 * offer to install an app that cannot supply both — and 32 is the tab.
 */
const WEB_SIZES = [32, 192, 512];

/**
 * The identity layer, and the only place the brand is allowed to be loud.
 *
 * Cobalt to Violet, corner to corner, two stops, with the artwork knocked out
 * of it in white and no second colour inside the mark. This is the icon, the
 * installer and the marketing artwork; the app's own chrome does not get it —
 * in there the mark is a single ink and cobalt is the only hue on screen. See
 * the note on `PalmaMark` in src/ui/PalmaMark.tsx.
 *
 * Cobalt and Violet are neighbours on the wheel, so the run stays saturated
 * the whole way across and neither end has to be held back.
 */
const COBALT = '#1d5fff';
const VIOLET = '#7c5cff';
const INK = '#ffffff';
/** Corner radius, as a fraction of the tile. */
const RADIUS = 0.21;

/**
 * How much air the mark gets. Small sizes get almost none: on a taskbar the
 * tile is not the icon, the mark is, and every pixel spent on margin is a
 * pixel the coil does not get.
 */
const inset = (size) => (size <= 32 ? 0.05 : size <= 64 ? 0.1 : 0.15);

/**
 * Optical bolding, in viewBox units.
 *
 * The artwork is filled paths whose thinnest features — the palm fronds and
 * the waterline — are under 1% of the 1139-unit box. Rasterised honestly at
 * 32px that is a third of a pixel, which comes out as pale grey mush. Stroking
 * each path in its own fill colour grows it outward, so the shapes hold their
 * weight when there are only a few pixels to hold it in. Above 64px the
 * artwork can speak for itself.
 */
const bolden = (size) =>
  size <= 20 ? 18 : size <= 24 ? 14 : size <= 32 ? 10 : size <= 48 ? 6 : size <= 64 ? 3 : 0;

const svg = readFileSync('assets/logo.svg', 'utf8')
  // The artwork carries its own stylesheet; the tile decides the colour.
  .replace(/<style>[\s\S]*?<\/style>/, '')
  .replace('<svg', `<svg fill="${INK}"`);

function tile(size, scale = 1) {
  const box = size * scale;
  const pad = Math.round(box * inset(size));
  const weight = bolden(size);
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent}
    .tile{width:${box}px;height:${box}px;
      background:linear-gradient(135deg, ${COBALT}, ${VIOLET});
      border-radius:${Math.round(box * RADIUS)}px;
      display:grid;place-items:center;overflow:hidden}
    .tile svg{width:${box - pad * 2}px;height:${box - pad * 2}px;display:block}
    .tile path{stroke:${INK};stroke-width:${weight};stroke-linejoin:round}
  </style><div class="tile">${svg}</div>`;
}

/** Windows reads PNG-compressed entries directly, which keeps this short. */
function encodeIco(images) {
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2); // 1 = icon
  directory.writeUInt16LE(images.length, 4);

  let offset = directory.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    // 256 is written as 0; the field is one byte wide.
    directory[entry] = size >= 256 ? 0 : size;
    directory[entry + 1] = size >= 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  return Buffer.concat([directory, ...images.map((image) => image.png)]);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ deviceScaleFactor: 1 });
const images = [];

for (const size of SIZES) {
  const view = await context.newPage();
  await view.setViewportSize({ width: size, height: size });
  await view.setContent(tile(size));
  images.push({ size, png: await view.screenshot({ omitBackground: true, type: 'png' }) });
  await view.close();
}

const webImages = [];
for (const size of WEB_SIZES) {
  // 32 is already in `images`, and rendering it twice would be two chances to
  // differ. Everything larger is drawn here.
  const made = images.find((image) => image.size === size);
  if (made) {
    webImages.push(made);
    continue;
  }
  const view = await context.newPage();
  await view.setViewportSize({ width: size, height: size });
  await view.setContent(tile(size));
  webImages.push({ size, png: await view.screenshot({ omitBackground: true, type: 'png' }) });
  await view.close();
}

// A proof sheet: the taskbar sizes, magnified, on the colour a taskbar
// actually is. Judging an icon at its true size is guesswork; this is not.
const proof = await context.newPage();
await proof.setViewportSize({ width: 760, height: 250 });
await proof.setContent(
  `<!doctype html><meta charset="utf-8"><style>
     body{margin:0;background:#202020;color:#8a8a8a;font:11px/1.4 'Segoe UI',sans-serif;
       display:flex;gap:26px;align-items:flex-end;padding:26px}
     figure{margin:0;text-align:center}
     .real{margin-bottom:10px}
     img{image-rendering:pixelated;display:block}
   </style>` +
    [16, 24, 32, 40, 48]
      .map((size) => {
        const png = images.find((image) => image.size === size).png.toString('base64');
        return `<figure>
          <img class="real" src="data:image/png;base64,${png}" width="${size}" height="${size}">
          <img src="data:image/png;base64,${png}" width="${size * 3}" height="${size * 3}">
          <figcaption>${size}px</figcaption>
        </figure>`;
      })
      .join(''),
);
const sheet = await proof.screenshot({ type: 'png' });
await proof.close();
await browser.close();

mkdirSync('build', { recursive: true });
mkdirSync('src-tauri/icons', { recursive: true });
mkdirSync('public/icons', { recursive: true });

const ico = encodeIco(images);
const at = (size) => images.find((image) => image.size === size).png;

writeFileSync('build/icon-proof.png', sheet);
writeFileSync('build/icon.ico', ico);
writeFileSync('build/icon.png', at(256));
writeFileSync('src-tauri/icons/icon.ico', ico);
writeFileSync('src-tauri/icons/icon.png', at(256));
// The names Tauri's bundler and the Windows shell both look for.
writeFileSync('src-tauri/icons/32x32.png', at(32));
writeFileSync('src-tauri/icons/128x128.png', at(128));
writeFileSync('src-tauri/icons/128x128@2x.png', at(256));

// Served as ordinary files rather than inlined: the manifest has to point at a
// URL, and a tab icon the browser can cache is one fewer thing in the HTML.
for (const { size, png } of webImages) writeFileSync(`public/icons/icon-${size}.png`, png);

console.log(`icon.ico   ${SIZES.join(', ')}px  (${(ico.length / 1024).toFixed(1)} KB)`);
console.log('icon.png   256px');
console.log(`web        ${WEB_SIZES.join(', ')}px`);
console.log('written to build/, src-tauri/icons/ and public/icons/');
console.log('proof sheet: build/icon-proof.png');
