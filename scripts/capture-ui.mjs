/**
 * The interface, out as an SVG you can animate.
 *
 *   npm run dev            # in one terminal
 *   npm run capture        # in another
 *
 * Writes `springboard-ui.svg` beside a `.png` of the same frame, so there is
 * something to hold the vectors against. `--dark` / `--light` pick the theme,
 * `--size WxH` the window, `--out <path>` where it lands.
 *
 * `--state` picks what the window is doing, because the parts worth animating
 * are mostly states rather than the resting view:
 *
 *   page      the writing surface with a page open (the default)
 *   welcome   the landing screen, greeting and all
 *   slash     the insert menu, open over a page
 *   selection the formatting bar, over a held sentence
 *
 * The drawing itself is scripts/ui-svg.mjs, loaded into the running app over
 * the dev server. Neither file is reachable from src/, so neither is in the
 * bundle and neither ships.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.SPRINGBOARD_URL ?? 'http://localhost:5273/';
const OUT = flag('out', 'springboard-ui.svg').replace(/\.svg$/i, '');
const DARK = !args.includes('--light');
const [WIDTH, HEIGHT] = flag('size', '1400x900').split('x').map(Number);
const STATE = flag('state', 'page');

if (!['page', 'welcome', 'slash', 'selection'].includes(STATE)) {
  console.error(`unknown --state ${STATE}. Use one of: page, welcome, slash, selection.`);
  process.exit(1);
}
mkdirSync(dirname(OUT), { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
  colorScheme: DARK ? 'dark' : 'light',
});
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (error) => problems.push(String(error)));
page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.welcome, .body', { timeout: 20000 });

if (await page.locator('.workspace.tree-hidden').count()) {
  await page.keyboard.press('Control+Backslash');
  await page.waitForTimeout(400);
}

if (STATE === 'welcome') {
  // The greeting only stands there on a launch that has not been answered, so
  // this state is the one thing that must not be dismissed on the way in.
  if (!(await page.locator('.welcome').count())) {
    console.error('the greeting is not showing — it is only offered on a fresh launch.');
    process.exit(1);
  }
  await page.waitForTimeout(500);
} else {
  if (await page.locator('.welcome').count()) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('.body', { timeout: 20000 });
  }

  // Something worth looking at. A window captured empty is a window that says
  // nothing about the app, so seed a page unless one is already open.
  if (!(await page.locator('.title').inputValue())) {
    await page.locator('.title').fill("What's the latest you've been out at night?");
    await page.locator('.body').click();
    await page.keyboard.type(
      'It had been seven years since I saw my eldest brother last. So when we finally got to see ' +
        'again, it was prime time to do some long overdue bonding, as now I too was an adult. ' +
        'A big boy.\n',
    );
    await page.keyboard.type(
      'He looked at me bewildered and was like "What am I looking for outside." And immediately ' +
        'memories of me jumping and shouting at raves by 2am flashed behind my eyes.\n',
    );
    await page.keyboard.type('It was interesting, how different our lives were.');
    await page.waitForTimeout(900);
  }

  if (STATE === 'slash') {
    // Typed rather than summoned: the menu belongs to the caret, and it places
    // itself against the line it was opened on.
    await page.locator('.body').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await page.waitForSelector('.slash', { timeout: 8000 });
    // It measures the line and then moves; capturing before that is capturing
    // the menu on its way.
    await page.waitForTimeout(700);
  } else if (STATE === 'selection') {
    // Dragged rather than selected with a shortcut: the bar waits for the
    // gesture to finish, which is the whole reason it never chases a pointer
    // down the page.
    const line = await page.locator('.body p').first().boundingBox();
    await page.mouse.move(line.x + line.width * 0.18, line.y + line.height / 2);
    await page.mouse.down();
    await page.mouse.move(line.x + line.width * 0.82, line.y + line.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForSelector('.bubble', { timeout: 8000 });
    // Long enough for the row to have finished arriving — a still of a
    // staggered entrance is a still of half a toolbar.
    await page.waitForTimeout(700);
  } else {
    // The caret blinks and a selection is state, not interface. Neither belongs
    // in a still, and the page bar is the one place a click changes nothing.
    await page.locator('.pagebar').click();
    await page.waitForTimeout(500);
  }
}

const svg = await page.evaluate(async () => {
  const { svgFromUI } = await import('/scripts/ui-svg.mjs');
  return svgFromUI(document.querySelector('.workspace'));
});

writeFileSync(`${OUT}.svg`, svg, 'utf8');
await page.locator('.workspace').screenshot({ path: `${OUT}-reference.png` });

// Rendered on its own, exactly as any other tool would open it — proof the
// file stands up away from the app that produced it.
const viewer = await ctx.newPage();
await viewer.setContent(`<body style="margin:0">${svg.replace(/^<\?xml[^>]*\?>\n/, '')}</body>`);
await viewer.waitForTimeout(600);
await viewer.locator('svg').screenshot({ path: `${OUT}-rendered.png` });

const summary = await viewer.evaluate(() => {
  const root = document.querySelector('svg');
  const depth = (node, level = 0) =>
    Math.max(level, ...[...node.children].filter((n) => n.tagName === 'g').map((n) => depth(n, level + 1)));
  return {
    size: [root.getAttribute('width'), root.getAttribute('height')],
    layers: root.querySelectorAll('g[data-name]').length,
    depth: depth(root),
    text: root.querySelectorAll('text').length,
    paths: root.querySelectorAll('path').length,
    images: root.querySelectorAll('image').length,
  };
});

await browser.close();

console.log(`${OUT}.svg`);
console.log(`  ${summary.size[0]}×${summary.size[1]}, ${(svg.length / 1024).toFixed(0)} kB`);
console.log(
  `  ${summary.layers} layers, ${summary.depth} deep, ${summary.text} text, ` +
    `${summary.paths} paths, ${summary.images} images`,
);
console.log(`  reference: ${OUT}-reference.png`);
console.log(`  rendered:  ${OUT}-rendered.png`);
if (problems.length > 0) console.error(`\nconsole errors:\n  ${problems.join('\n  ')}`);
