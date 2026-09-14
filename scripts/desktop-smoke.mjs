/**
 * Boots the real desktop app — the same binary the installer ships — and
 * drives it over the Chrome DevTools protocol.
 *
 *   npm run desktop:build && npm run desktop:smoke
 *   PALMANOTE_EXE=path/to/PalmaNote.exe npm run desktop:smoke
 *
 * The counterpart to scripts/smoke.mjs. That one covers the editor; this one
 * covers what a browser cannot — the native window and the SQLite store — and
 * does it *through the interface* rather than by calling the bridge, so the
 * adapter is under test alongside the database, and the same checks run
 * against whichever shell is underneath.
 */

import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 9333;
const SHOT = process.env.PROBE_OUT ?? 'desktop-smoke.png';

const CANDIDATES = [
  process.env.PALMANOTE_EXE,
  'src-tauri/target/release/PalmaNote.exe',
  // The name it had before `mainBinaryName`; kept so an older build already
  // sitting in target/ is still found, on a filesystem that cares about case.
  'src-tauri/target/release/palmanote.exe',
].filter(Boolean);

const exe = CANDIDATES.find((path) => existsSync(path));
if (!exe) {
  console.error(`no desktop build found. Looked in:\n  ${CANDIDATES.join('\n  ')}`);
  console.error('Run `npm run desktop:build` first.');
  process.exit(1);
}

const failures = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures.push(`${label}\n   expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
};
const section = (name) => console.log(`\n— ${name}`);

/**
 * This shell can have ELECTRON_RUN_AS_NODE set — some Electron-based tools set
 * it for their children and it is inherited. Harmless to Tauri, fatal to
 * Electron, so it goes either way. The WebView2 variable is how a Tauri window
 * is made inspectable; Electron takes the flag instead. Sending both means
 * this script does not care which it launched.
 */
function appEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${PORT}`;
  return env;
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const child = spawn(exe, [`--remote-debugging-port=${PORT}`], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: appEnv(),
});

let browser;
try {
  let page = null;
  for (let attempt = 0; attempt < 40 && !page; attempt++) {
    await settle(500);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
      page = browser.contexts()[0]?.pages()[0] ?? null;
    } catch {
      /* not listening yet */
    }
  }
  if (!page) throw new Error('could not attach to the app');
  // Tauri denies core commands that are not in capabilities/default.json, and
  // it says so here rather than by failing loudly. A silent ACL denial is how
  // the drag region stops dragging without any test noticing.
  const rendererErrors = [];
  page.on('pageerror', (error) => rendererErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(message.text());
  });
  await page.waitForSelector('.row', { timeout: 20000 });

  /** Launch greets; the checks below want the writing surface. */
  const dismissWelcome = async () => {
    await page.waitForSelector('.welcome, .body', { timeout: 20000 });
    if ((await page.locator('.welcome').count()) === 0) return;
    await page.keyboard.press('Escape');
    await page.waitForSelector('.body', { timeout: 20000 });
    await page.waitForTimeout(200);
    // An isolated desktop profile is also a first launch. The tour is covered
    // by the browser suite; here it would stand over the native controls this
    // runner is trying to exercise.
    if (await page.locator('.tour').count()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
  };
  await dismissWelcome();

  // The sidebar's visibility is remembered between launches, so a run that
  // collapsed it leaves the next one unable to click anything in it.
  if (await page.locator('.workspace.tree-hidden').count()) {
    await page.keyboard.press('Control+Backslash');
    await page.waitForTimeout(400);
  }

  // ------------------------------------------------------------ the window
  section('the window');
  const shell = await page.evaluate(() => {
    const gap = document.querySelector('.drag-region');
    const deep = (selector) =>
      document.querySelector(selector)?.getAttribute('data-tauri-drag-region') ?? null;
    return {
      engine: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? 'unknown',
      controls: document.querySelectorAll('.wincontrol').length,
      dragRegions: document.querySelectorAll('.drag-region[data-tauri-drag-region]').length,
      nodeInPage: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
      desktop: document.querySelector('.topstrip')?.classList.contains('is-desktop') ?? false,
      stripDrags: deep('.topstrip'),
      headDrags: deep('.tree-head'),
      // The gap between the tabs and the icons used to be the *only* way to
      // move the window, and it was a flexible one: three open pages squeezed
      // it to its floor. A shrink factor of 0 is what keeps it out of the
      // negotiation, and is the thing worth watching, because a stray `flex:
      // 1` puts it back without changing anything you can see in a screenshot.
      gapShrink: gap ? getComputedStyle(gap).flexShrink : null,
      gapWidth: gap ? Math.round(gap.getBoundingClientRect().width) : 0,
    };
  });
  console.log(`      ${exe}`);
  console.log(`      ${shell.engine}`);
  check('the renderer knows it is on the desktop', shell.desktop, true);
  check('Windows caption buttons are drawn', shell.controls, 3);
  check('the title bar has a drag region', shell.dragRegions, 1);
  check('the whole strip drags, not just the gap', shell.stripDrags, 'deep');
  check('the sidebar head drags too', shell.headDrags, 'deep');
  check('the reserved gap cannot be squeezed away', shell.gapShrink, '0');
  check('the reserved gap is wide enough to hit', shell.gapWidth >= 64, true);
  check('node is not reachable from the page', shell.nodeInPage, false);

  // --------------------------------------------------------------- storage
  section('the library');
  const title = `Desktop run ${Date.now()}`;
  await page.locator('.tree-list').click();
  await page.keyboard.press('Control+KeyN');
  await page.waitForSelector('.rename');
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  await page.locator('.body').click();
  await page.keyboard.type('Written to SQLite through the real bridge.');
  await page.waitForTimeout(1200);
  check('the status bar counts what was typed', await page.locator('.status .words').innerText(), '7 words');

  const row = page.locator('.tree-list .row', { hasText: title }).first();
  await row.hover();
  await row.locator('.row-star').click();
  await page.waitForTimeout(400);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.row', { timeout: 20000 });
  await dismissWelcome();
  await page.waitForTimeout(800);
  check(
    'the writing survives a relaunch of the view',
    (await page.locator('.body').innerText()).trim(),
    'Written to SQLite through the real bridge.',
  );
  check(
    'so does the favourite',
    (await page.locator('.favourites .row-title').allInnerTexts()).some((text) => text.trim() === title),
    true,
  );

  // -------------------------------------------------------------- stickers
  // The one part of this feature that is a desktop question rather than an
  // editor one: sticker art is a relative URL under `base: './'`, and a
  // relative URL over file:// in WebView2 is not the same thing it is over
  // http in a browser. A miss here also shows up in the console check below.
  section('stickers');
  await page.locator('.body').click();
  await page.keyboard.press('Control+KeyA');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type(' /party');
  await page.waitForSelector('.slash', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  check('the insert menu reaches a sticker', await page.locator('.body img.sticker').count(), 1);
  check(
    'and the art it names is found on disk',
    await page
      .locator('.body img.sticker')
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  );

  // ---------------------------------------------------------------- images
  // Image bytes are a BLOB in SQLite here and base64 across `invoke` to get
  // there. Neither of those is exercised by the browser build at all.
  section('images');
  await page.locator('.body').evaluate(async (body) => {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2f4b8f';
    context.fillRect(0, 0, 48, 48);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'desktop.png', { type: 'image/png' }));
    body.focus();
    body.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  });
  await page.waitForSelector('.body img.image', { timeout: 6000 });
  await page.waitForTimeout(900);
  check('a pasted image reaches SQLite', await page.locator('.body img.image').count(), 1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.row', { timeout: 20000 });
  await dismissWelcome();
  await page.waitForTimeout(900);
  check('and comes back out of it', await page.locator('.body img.image').count(), 1);
  check(
    'as pixels, not as a broken link',
    await page.locator('.body img.image').evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  );

  // --------------------------------------------------------------- history
  // The revisions behind this are a Rust window function over SQLite here and
  // a hand-rolled pass over IndexedDB in the browser. Only one of them ships.
  section('history');
  await page.locator('.chrome-btn[aria-label="History"]').click();
  await page.waitForSelector('.dialog.is-wide', { timeout: 5000 });
  // The list is read asynchronously after the dialog is on screen.
  await page.waitForSelector('.history-entry', { timeout: 5000 });
  check('the page has a history in SQLite', (await page.locator('.history-entry').count()) >= 1, true);
  check(
    'and a version renders through the same schema it was written in',
    (await page.locator('.history-preview .body').innerText()).includes('SQLite'),
    true,
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---------------------------------------------------------------- delete
  section('delete');
  await page.locator('.tree-list .row', { hasText: title }).first().click({ button: 'right' });
  await page.waitForSelector('.menu');
  await page.locator('.menu-item', { hasText: 'Delete' }).click();
  await page.waitForTimeout(600);
  check(
    'delete takes it out of the tree',
    (await page.locator('.tree-list .row-title').allInnerTexts()).some((text) => text.trim() === title),
    false,
  );

  if ((await page.locator('.archive').count()) === 0) {
    await page.locator('.tree-foot .ghost').click();
    await page.waitForTimeout(250);
  }
  check('and puts it in the archive', await page.locator('.archive-row', { hasText: title }).count(), 1);

  await page
    .locator('.archive-row', { hasText: title })
    .first()
    .locator('.ghost', { hasText: 'Delete' })
    .click();
  await page.waitForTimeout(250);
  await page
    .locator('.archive-row', { hasText: title })
    .first()
    .locator('.ghost', { hasText: 'Delete for good' })
    .click();
  await page.waitForTimeout(700);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.row', { timeout: 20000 });
  await dismissWelcome();
  await page.waitForTimeout(800);
  check(
    'deleting for good outlives the reload',
    await page.evaluate(
      (needle) => [...document.querySelectorAll('.row-title')].some((n) => n.textContent.trim() === needle),
      title,
    ),
    false,
  );

  section('the console');
  check('nothing was denied or thrown', rendererErrors, []);

  writeFileSync(SHOT, await page.screenshot());
  console.log(`\nscreenshot: ${SHOT}`);
} catch (error) {
  failures.push(String(error));
} finally {
  await browser?.close().catch(() => {});
  child.kill();
}

await settle(500);
if (failures.length > 0) {
  console.error('\n' + failures.join('\n'));
  process.exit(1);
}
console.log('\nall desktop checks passed');
process.exit(0);
