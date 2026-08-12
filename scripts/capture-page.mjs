/**
 * The same tracer, pointed at somebody else's page.
 *
 *   node scripts/capture-page.mjs --url https://example.com --out captures/example
 *
 * scripts/capture-ui.mjs knows this app: its selectors, its states, the way it
 * has to be nudged before it is worth a picture. This one knows nothing, which
 * is the point — it exists to find out what scripts/ui-svg.mjs does when handed
 * a page it was never written for.
 *
 * Three differences from the app capture, all forced by the page being remote:
 *
 *  - The tracer cannot be imported. There is no dev server on the other end
 *    serving it, so it is read from disk and evaluated in the page. Going in
 *    through the debugger rather than a <script> tag also steps around whatever
 *    CSP the site is running.
 *  - The page has to be scrolled through before it is traced. A landing page
 *    holds most of its content at `opacity: 0` until it is scrolled past, and
 *    the tracer drops anything that faint. Capturing at the top of the page
 *    would be testing a straw man.
 *  - The viewer is served from the site's own origin, so the fonts and images
 *    the SVG points at resolve the way they did in the real page. Otherwise the
 *    comparison shot measures CORS, not the tracer.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = flag('url', null);
const OUT = flag('out', 'captures/page').replace(/\.svg$/i, '');
const ROOT = flag('root', 'body');
const [WIDTH, HEIGHT] = flag('size', '1440x900').split('x').map(Number);
const DARK = args.includes('--dark');

if (!URL_) {
  console.error('need a --url.');
  process.exit(1);
}
mkdirSync(dirname(resolve(OUT)), { recursive: true });

// `export` means nothing inside an evaluated expression, and the two names it
// guards are the two this needs.
const tracer = readFileSync(new global.URL('./ui-svg.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  colorScheme: DARK ? 'dark' : 'light',
});
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (error) => problems.push(String(error)));

await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60000 });

// Walk the whole page so anything that reveals on scroll has revealed, then
// come back to the top. Reveal classes stay on once they are added.
await page.evaluate(async () => {
  const pause = (ms) => new Promise((done) => setTimeout(done, ms));
  const step = Math.round(window.innerHeight * 0.75);
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await pause(220);
  }
  window.scrollTo(0, document.body.scrollHeight);
  await pause(400);
  window.scrollTo(0, 0);
  await pause(900);
});

// Lazy images started loading on the way down; let them finish.
await page.evaluate(
  () =>
    Promise.all(
      [...document.images]
        .filter((img) => !img.complete)
        .map((img) => new Promise((done) => { img.onload = img.onerror = done; })),
    ),
);
await page.waitForTimeout(800);

const root = page.locator(ROOT).first();
if (!(await root.count())) {
  console.error(`no ${ROOT} on the page.`);
  process.exit(1);
}

const svg = await page.evaluate(`(async () => {
${tracer}
const root = document.querySelector(${JSON.stringify(ROOT)});
return await svgFromUI(root);
})()`);

writeFileSync(`${OUT}.svg`, svg, 'utf8');
await page.screenshot({ path: `${OUT}-reference.png`, fullPage: true });

// Served from the site's own origin so that relative font and image URLs in
// the traced file resolve, and fonts pass the CORS check they would fail from
// an about:blank document.
const viewer = await ctx.newPage();
const shell = `<!doctype html><meta charset="utf-8"><body style="margin:0">${svg.replace(/^<\?xml[^>]*\?>\n/, '')}</body>`;
const viewerUrl = new global.URL('/__svg_viewer', URL_).href;
await viewer.route(viewerUrl, (route) => route.fulfill({ contentType: 'text/html', body: shell }));
await viewer.goto(viewerUrl);
await viewer.waitForTimeout(1500);
await viewer.locator('svg').screenshot({ path: `${OUT}-rendered.png` });

const summary = await viewer.evaluate(() => {
  const svgEl = document.querySelector('svg');
  const depth = (node, level = 0) =>
    Math.max(level, ...[...node.children].filter((n) => n.tagName === 'g').map((n) => depth(n, level + 1)));
  return {
    size: [svgEl.getAttribute('width'), svgEl.getAttribute('height')],
    layers: svgEl.querySelectorAll('g[data-name]').length,
    depth: depth(svgEl),
    text: svgEl.querySelectorAll('text').length,
    paths: svgEl.querySelectorAll('path').length,
    rects: svgEl.querySelectorAll('rect').length,
    images: svgEl.querySelectorAll('image').length,
  };
});

// What the page had, against what came across. The gap is the finding.
const had = await page.evaluate(() => {
  const count = { gradients: 0, shadows: 0, filters: 0, transforms: 0, pseudo: 0, faint: 0 };
  const seen = new Set();
  for (const node of document.querySelectorAll('*')) {
    const s = getComputedStyle(node);
    if (s.backgroundImage && s.backgroundImage !== 'none') count.gradients += 1;
    if (s.boxShadow && s.boxShadow !== 'none') count.shadows += 1;
    if ((s.filter && s.filter !== 'none') || (s.backdropFilter && s.backdropFilter !== 'none')) count.filters += 1;
    if (s.transform && s.transform !== 'none') count.transforms += 1;
    if (Number(s.opacity) < 0.01) count.faint += 1;
    for (const which of ['::before', '::after']) {
      const p = getComputedStyle(node, which);
      if (p.content && p.content !== 'none' && p.content !== 'normal') count.pseudo += 1;
    }
    seen.add(node);
  }
  return { ...count, elements: seen.size, media: document.querySelectorAll('video, canvas, iframe').length };
});

await browser.close();

console.log(`${OUT}.svg`);
console.log(`  ${summary.size[0]}×${summary.size[1]}, ${(svg.length / 1024).toFixed(0)} kB`);
console.log(
  `  ${summary.layers} layers, ${summary.depth} deep, ${summary.text} text, ` +
    `${summary.rects} rects, ${summary.paths} paths, ${summary.images} images`,
);
console.log(`\n  on the page, and not in the file:`);
console.log(`    ${had.elements} elements total`);
console.log(`    ${had.gradients} with a background-image or gradient`);
console.log(`    ${had.shadows} with a box-shadow`);
console.log(`    ${had.filters} with a filter or backdrop-filter`);
console.log(`    ${had.transforms} with a transform`);
console.log(`    ${had.pseudo} ::before/::after with content`);
console.log(`    ${had.faint} still at opacity 0`);
console.log(`    ${had.media} video/canvas/iframe`);
console.log(`\n  reference: ${OUT}-reference.png`);
console.log(`  rendered:  ${OUT}-rendered.png`);
if (problems.length > 0) console.error(`\npage errors:\n  ${problems.join('\n  ')}`);
