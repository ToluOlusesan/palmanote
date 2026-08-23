/**
 * Does it hold a novel?
 *
 *   npm run desktop:build && npm run scale
 *
 * The first acceptance criterion this project was given was "a 120,000-word
 * novel across 60 nested documents opens, navigates, and types without
 * perceptible lag". Everything else is decoration if that is false, and it had
 * never been measured.
 *
 * It writes into the real library — Tauri resolves its data directory through
 * Win32 rather than the environment, so there is no honest way to point it
 * somewhere else from out here — and deletes exactly what it created, by id,
 * when it finishes. Nothing you wrote is touched.
 *
 * Numbers are medians over repeated samples.
 *
 * The budgets are deliberately tight rather than generous: two frames for a
 * keystroke, a tenth of a second for anything that touches the database. A
 * measurement over budget is a thing to look at, not necessarily a thing a
 * writer would feel.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 9611;
const EXE = process.env.PALMANOTE_EXE ?? 'src-tauri/target/release/PalmaNote.exe';
const CHAPTERS = Number(process.env.SCALE_CHAPTERS ?? 60);
const WORDS_EACH = Number(process.env.SCALE_WORDS ?? 2000);

if (!existsSync(EXE)) {
  console.error(`no desktop build at ${EXE}. Run \`npm run desktop:build\` first.`);
  process.exit(1);
}

const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(EXE, [], { stdio: ['ignore', 'inherit', 'inherit'], env });
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
const report = (label, value, unit, budget) => {
  const over = budget !== undefined && value > budget;
  results.push({ label, value, unit, over });
  const shown = `${value.toFixed(value < 10 ? 1 : 0)}${unit}`;
  const note = budget === undefined ? '' : over ? `  OVER ${budget}${unit}` : `  (under ${budget}${unit})`;
  console.log(`${over ? 'SLOW' : 'ok  '}  ${label.padEnd(42)} ${shown.padStart(9)}${note}`);
};

let browser;
try {
  let page = null;
  for (let attempt = 0; attempt < 40 && !page; attempt++) {
    await settle(500);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
      page = browser.contexts()[0]?.pages()[0] ?? null;
    } catch {
      /* not up yet */
    }
  }
  if (!page) throw new Error('could not attach to the app');
  await page.waitForSelector('.welcome, .body', { timeout: 30000 });
  if (await page.locator('.welcome').count()) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('.body', { timeout: 20000 });
  }

  // ------------------------------------------------------------- filling
  console.log(`\nfilling: ${CHAPTERS} documents, ${WORDS_EACH} words each\n`);
  const filled = await page.evaluate(
    async ({ chapters, wordsEach }) => {
      const bridge = window.__TAURI_INTERNALS__;
      const call = (cmd, args) => bridge.invoke(cmd, args);

      // Prose-shaped filler: real sentence lengths, real paragraph breaks.
      const words =
        'the rain came sideways off the estuary and she thought not for the first time that weather was too small a word for what the sea did to this coast in winter when the light went early and the harbour emptied of everything but rope'.split(
          ' ',
        );
      const paragraph = (seed) => {
        const out = [];
        for (let i = 0; i < 60; i++) out.push(words[(seed + i * 7) % words.length]);
        return { type: 'paragraph', content: [{ type: 'text', text: out.join(' ') + '.' }] };
      };

      const started = performance.now();
      // Every id, not just the parents: relying on a recursive delete to sweep
      // children up means one failed parent leaves twenty chapters behind.
      const created = [];
      let total = 0;
      let part = null;
      for (let index = 0; index < chapters; index++) {
        // Three parts, each holding twenty chapters, each holding scenes.
        if (index % 20 === 0) {
          part = await call('create_document', {
            input: { parentId: null, kind: 'folder', title: `Scale part ${index / 20 + 1}` },
          });
          created.push(part.id);
        }
        const chapter = await call('create_document', {
          input: { parentId: part.id, kind: 'chapter', title: `Scale chapter ${index + 1}` },
        });
        const content = {
          type: 'doc',
          content: Array.from({ length: Math.ceil(wordsEach / 60) }, (_, n) => paragraph(index + n)),
        };
        created.push(chapter.id);
        total += content.content.length * 60;
        await call('save_content', {
          input: { id: chapter.id, content, wordCount: content.content.length * 60, snapshot: false },
        });
      }
      return { total, ms: performance.now() - started, created };
    },
    { chapters: CHAPTERS, wordsEach: WORDS_EACH },
  );
  console.log(`  wrote ${filled.total.toLocaleString('en-GB')} words in ${(filled.ms / 1000).toFixed(1)}s\n`);

  // -------------------------------------------------------------- opening
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.welcome, .body', { timeout: 30000 });
  if (await page.locator('.welcome').count()) {
    await page.keyboard.press('Escape');
  }
  await page.waitForSelector('.row', { timeout: 30000 });

  const listing = await page.evaluate(async () => {
    const started = performance.now();
    const rows = await window.__TAURI_INTERNALS__.invoke('list_documents');
    return { ms: performance.now() - started, count: rows.length };
  });
  report(`listing ${listing.count} documents`, listing.ms, 'ms', 100);

  const load = await page.evaluate(async () => {
    const rows = await window.__TAURI_INTERNALS__.invoke('list_documents');
    const chapter = rows.find((row) => row.wordCount > 1000);
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      await window.__TAURI_INTERNALS__.invoke('get_document', { id: chapter.id });
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    return samples[2];
  });
  report('reading one chapter from SQLite', load, 'ms', 100);

  // ------------------------------------------------------------ the tree
  if (await page.locator('.workspace.tree-hidden').count()) {
    await page.keyboard.press('Control+Backslash');
    await page.waitForTimeout(400);
  }
  const expand = await page.evaluate(() => {
    const started = performance.now();
    document.querySelectorAll('.twisty').forEach((node) => node.click());
    return performance.now() - started;
  });
  await page.waitForTimeout(600);
  report(`expanding the tree to ${await page.locator('.row').count()} rows`, expand, 'ms', 150);

  // -------------------------------------------------------------- opening
  // Chapters only: a part is a container with nothing in it, and timing how
  // fast an empty page opens would measure nothing.
  const chapters = page.locator('.tree-list .row', { hasText: 'Scale chapter' });
  const navigation = [];
  for (let i = 0; i < 6; i++) {
    const started = Date.now();
    await chapters.nth(i).click();
    await page.waitForFunction(() => document.querySelector('.body')?.textContent?.length > 200, null, {
      timeout: 15000,
    });
    navigation.push(Date.now() - started);
  }
  navigation.sort((a, b) => a - b);
  report('switching to another chapter', navigation[3], 'ms', 200);

  // -------------------------------------------------------------- typing
  await page.locator('.body').click();
  await page.keyboard.press('Control+End');
  const typing = await page.evaluate(async () => {
    const body = document.querySelector('.body');
    const samples = [];
    for (let i = 0; i < 40; i++) {
      const started = performance.now();
      body.dispatchEvent(
        new InputEvent('beforeinput', { inputType: 'insertText', data: 'a', bubbles: true, cancelable: true }),
      );
      document.execCommand('insertText', false, 'a');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    return { median: samples[20], worst: samples[39] };
  });
  // Two frames at 60Hz. One frame is the floor — a keystroke cannot be
  // painted sooner than the next vsync — so budgeting 16 would be budgeting
  // for the impossible.
  report('keystroke to painted frame (median)', typing.median, 'ms', 33);
  report('keystroke to painted frame (worst)', typing.worst, 'ms', 100);

  const saving = await page.evaluate(async () => {
    const rows = await window.__TAURI_INTERNALS__.invoke('list_documents');
    const chapter = rows.find((row) => row.wordCount > 1000);
    const record = await window.__TAURI_INTERNALS__.invoke('get_document', { id: chapter.id });
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      await window.__TAURI_INTERNALS__.invoke('save_content', {
        input: { id: chapter.id, content: record.content, wordCount: chapter.wordCount, snapshot: false },
      });
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    return samples[2];
  });
  report('autosaving a full chapter', saving, 'ms', 100);

  // ------------------------------------------------------------- cleanup
  // This runs against the real library, so putting it back exactly as it was
  // is not optional. Children first, then parents: a parent whose children
  // are already gone deletes cleanly, where the reverse can leave orphans.
  // The result is checked rather than assumed — a cleanup that quietly does
  // nothing is worse than none, because nobody goes looking.
  const cleanup = await page.evaluate(async (ids) => {
    const call = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
    let gone = 0;
    for (const id of [...ids].reverse()) {
      try {
        gone += (await call('delete_document', { id })).length;
      } catch {
        /* taken by its parent already */
      }
    }
    const left = (await call('list_documents')).filter((row) => ids.includes(row.id));
    return { gone, left: left.length };
  }, filled.created);

  if (cleanup.left > 0) {
    console.error(`\nWARNING: ${cleanup.left} of this run's documents are still in your library.`);
    results.push({ over: true });
  } else {
    console.log(`\ncleaned up all ${cleanup.gone} documents this run created`);
  }
} catch (error) {
  console.error(`\n${String(error)}`);
  results.push({ over: true });
} finally {
  await browser?.close().catch(() => {});
  child.kill();
}

await settle(500);
const slow = results.filter((result) => result.over);
console.log(
  slow.length === 0
    ? '\nnothing over budget — it holds a novel'
    : `\n${slow.length} measurement${slow.length === 1 ? '' : 's'} over budget`,
);
process.exit(slow.length === 0 ? 0 : 1);
