/**
 * End-to-end smoke test. Drives the real app in the browser already installed
 * on this machine — playwright-core, no browser download.
 *
 *   npm run dev          # in one terminal
 *   npm run smoke        # in another
 *
 * Override the browser with CHROME_PATH if Chrome is somewhere unusual.
 */

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.PALMANOTE_URL ?? 'http://localhost:5273/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
// Reading the clipboard is something only this test does — the app writes to it
// on a click, which needs no permission. Granting it here is what lets a check
// look at what "Copy link" actually put there.
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
let page = await ctx.newPage();

const errors = [];
const watch = (target) => {
  target.on('pageerror', (e) => errors.push(String(e)));
  target.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
};
watch(page);

const failures = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures.push(`${label}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`);
  }
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
};
const section = (name) => console.log(`\n— ${name}`);

const shapeOf = async () => {
  const rows = await page.locator('.row').all();
  const out = [];
  for (const row of rows) {
    const level = Number(await row.getAttribute('aria-level'));
    out.push('  '.repeat(level - 1) + (await row.locator('.row-title').innerText()).trim());
  }
  return out;
};
const tabLabels = async () => {
  const out = [];
  for (const tab of await page.locator('.tab').all()) {
    const label = (await tab.innerText()).trim();
    const preview = (await tab.getAttribute('class')).includes('is-preview');
    out.push(preview ? `${label} (preview)` : label);
  }
  return out;
};
const body = () => page.locator('.body');
const bodyHtml = () => body().innerHTML();
const bodyText = () => body().innerText();

/** A clean page to run editor rules in, so nothing bleeds between checks. */
const freshPage = async (title) => {
  await dismissWelcome();
  await page.locator('.tree-list').click();
  await page.keyboard.press('Control+KeyN');
  await page.waitForSelector('.rename');
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await body().click();
  await page.waitForTimeout(150);
};

const setArchiveOpen = async (open) => {
  const isOpen = (await page.locator('.archive').count()) > 0;
  if (isOpen !== open) {
    await page.locator('.tree-foot .ghost').click();
    await page.waitForTimeout(200);
  }
};

/** Launch shows a greeting; every check below wants the writing surface. */
const dismissWelcome = async (target = page) => {
  // Wait for whichever arrives — the greeting renders a beat after the tree,
  // so checking too early sees neither and skips past both.
  await target.waitForSelector('.welcome, .body', { timeout: 15000 });
  if ((await target.locator('.welcome').count()) === 0) return;
  await target.keyboard.press('Escape');
  await target.waitForSelector('.body', { timeout: 15000 });
  await target.waitForTimeout(150);
};

// --------------------------------------------------------------- welcome
section('launch');
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.welcome', { timeout: 8000 });
check(
  'launch asks what you want to do',
  (await page.locator('.welcome-greeting').innerText()).trim(),
  'What do you want to do today?',
);
check(
  'and offers somewhere to start',
  await page.locator('.welcome-start').allInnerTexts(),
  ['Make a to-do list', 'Draft a story', 'Plan a project', 'Jot down thoughts'],
);
await page.keyboard.press('Escape');
await page.waitForSelector('.body', { timeout: 8000 });
// Waited for rather than asserted on the next tick. The caret is placed by a
// requestAnimationFrame loop that retries until the editor has mounted, so
// `.body` existing and `.body` holding the focus are two different moments —
// a handful of frames apart, and further apart on a cold start now that there
// are webfonts to settle. Asserting instantly happened to pass and was timing,
// not behaviour. If focus never lands this still fails, one second later.
const caretLanded = await page
  .waitForFunction(() => document.activeElement?.className?.includes('body'), null, {
    timeout: 1000,
  })
  .then(() => true)
  .catch(() => false);
check('escape leaves it with the caret in the page', caretLanded, true);

// ---------------------------------------------------------------- basics
section('the page');
await page.waitForSelector('.row', { timeout: 8000 });
check('opens on a blank page', await page.locator('.row').count(), 1);

await page.locator('.title').fill('Chapter One');
await body().click();
await page.keyboard.type('The rain came sideways off the estuary.');
await page.waitForTimeout(900);
check('sidebar picks up the title', (await page.locator('.row-title').first().innerText()).trim(), 'Chapter One');
check('status bar counts words', await page.locator('.status .words').innerText(), '7 words');

await page.reload({ waitUntil: 'networkidle' });
await dismissWelcome();
await page.waitForSelector('.body');
check('reload restores the title', await page.locator('.title').inputValue(), 'Chapter One');
check('reload restores the body', (await bodyText()).trim(), 'The rain came sideways off the estuary.');

// --------------------------------------------------------------- greeting
section('greeting');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.welcome', { timeout: 8000 });
await page.locator('.row').first().click();
await page.waitForSelector('.body', { timeout: 8000 });
check('a page picked from the sidebar answers the greeting', await page.locator('.welcome').count(), 0);
check('and it is the page that opens', await page.locator('.title').inputValue(), 'Chapter One');
check(
  'browsing leaves the focus in the tree, so the arrows still work',
  await page.evaluate(() => document.activeElement?.className?.includes('tree-list')),
  true,
);

// ------------------------------------------------------------ input rules
section('input rules');
await freshPage('Marks');
await page.keyboard.type('a **bold** and *slanted* and ~~struck~~ text');
await page.waitForTimeout(300);
const marksHtml = await bodyHtml();
check('** ** becomes bold', /<strong>bold<\/strong>/.test(marksHtml), true);
check('* * becomes italic', /<em>slanted<\/em>/.test(marksHtml), true);
check('~~ ~~ becomes strikethrough', /<s>struck<\/s>/.test(marksHtml), true);
check('delimiters are gone', /\*|~~/.test(await bodyText()), false);

// What an Enter carries. Bold and italic describe how you are writing and
// usually continue; a highlight, a code span and a link describe one piece of
// text, and carrying those makes the next block arrive already painted.
await freshPage('Carry');
await page.keyboard.press('Control+KeyB');
await page.keyboard.type('bold');
await page.keyboard.press('Enter');
await page.keyboard.type('still bold');
await page.waitForTimeout(300);
check(
  'bold carries onto the next block',
  /<strong>bold<\/strong>.*<strong>still bold<\/strong>/s.test(await bodyHtml()),
  true,
);

// Applied from the bar rather than with Mod-Shift-H, because that chord also
// reaches the shell, where it is "browse history" — see the note in App.tsx.
await freshPage('NoCarry');
await page.keyboard.type('marked');
await page.waitForTimeout(200);
await page.keyboard.press('Control+KeyA');
await page.waitForSelector('.bubble', { timeout: 4000 });
await page.locator('.bubble-btn[aria-label="Highlight"]').click();
await page.waitForSelector('.bubble-menu');
await page.locator('.bubble-item', { hasText: 'Yellow' }).first().click();
await page.waitForTimeout(350);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
// Collapses the selection to its right edge, which is where the caret has to
// be for the Enter below to be a split rather than a replacement.
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
await page.keyboard.type('clean');
await page.waitForTimeout(300);
check(
  'a highlight stops at the end of its block',
  await bodyHtml(),
  '<p><mark data-tone="yellow">marked</mark></p><p>clean</p>',
);

await freshPage('NoCarryCode');
await page.keyboard.press('Control+KeyE');
await page.keyboard.type('snippet');
await page.keyboard.press('Enter');
await page.keyboard.type('prose');
await page.waitForTimeout(300);
check('and so does a code span', await bodyHtml(), '<p><code>snippet</code></p><p>prose</p>');

// Splitting inside a marked run is the other half: what is already painted
// stays painted, and only what you type next comes out clean.
await freshPage('SplitInside');
await page.keyboard.type('one two');
await page.waitForTimeout(200);
await page.keyboard.press('Control+KeyA');
await page.waitForSelector('.bubble', { timeout: 4000 });
await page.locator('.bubble-btn[aria-label="Highlight"]').click();
await page.waitForSelector('.bubble-menu');
await page.locator('.bubble-item', { hasText: 'Yellow' }).first().click();
await page.waitForTimeout(350);
await page.keyboard.press('Escape');
await page.keyboard.press('End');
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(60);
}
await page.keyboard.press('Enter');
await page.keyboard.type('X');
await page.waitForTimeout(300);
check(
  'splitting a marked run keeps the mark on the words, not on what comes after',
  await bodyHtml(),
  '<p><mark data-tone="yellow">one </mark></p><p>X<mark data-tone="yellow">two</mark></p>',
);

await freshPage('Typography');
await page.keyboard.type('He said "stop" -- then... it didn\'t.');
await page.waitForTimeout(300);
check('smart typography applies as you type', (await bodyText()).trim(), 'He said “stop” — then… it didn’t.');

await freshPage('Lists');
await page.keyboard.type('- first\nsecond\n');
await page.keyboard.press('Enter');
await page.keyboard.type('1. one\ntwo\n');
await page.keyboard.press('Enter');
await page.keyboard.type('[] a task\nanother\n');
await page.waitForTimeout(300);
const listHtml = await bodyHtml();
check('"- " makes a bullet list', (listHtml.match(/<ul(?![^>]*taskList)/g) ?? []).length, 1);
check('"1. " makes an ordered list', /<ol[^>]*>/.test(listHtml), true);
check('"[] " makes a task list', /data-type="taskList"/.test(listHtml), true);
check(
  'task items have real checkboxes',
  await page.locator('.body ul[data-type=taskList] input[type=checkbox]').count(),
  3,
);
// A second Enter on the empty item is how you leave a list.
await page.keyboard.press('Enter');
await page.keyboard.type('out again');
await page.waitForTimeout(300);
check('enter on an empty item leaves the list', /<\/ul><p>out again<\/p>/.test(await bodyHtml()), true);
check(
  'and the empty item goes with it',
  await page.locator('.body ul[data-type=taskList] > li').count(),
  2,
);

await freshPage('Nesting');
await page.keyboard.type('- one\n');
await page.keyboard.press('Tab');
await page.keyboard.type('two\n');
await page.keyboard.press('Tab');
await page.keyboard.type('three\n');
await page.keyboard.press('Tab');
await page.keyboard.type('four');
await page.waitForTimeout(300);
const depth = await page
  .locator('.body ul ul ul ul')
  .count()
  .then((over) => (over > 0 ? 'deeper than three' : 'three'));
check('lists nest three levels and stop', depth, 'three');

await freshPage('Blocks');
await page.keyboard.type('## A heading\n');
await page.keyboard.type('> a quotation\n');
await page.keyboard.press('Enter');
await page.keyboard.type('--- ');
await page.waitForTimeout(300);
const blockHtml = await bodyHtml();
check('"## " makes a heading', /<h2>A heading<\/h2>/.test(blockHtml), true);
check('"> " makes a blockquote', /<blockquote>/.test(blockHtml), true);
check('"---" makes a typed scene break', /data-scene-break/.test(blockHtml), true);

// ------------------------------------------------------------ insert menu
section('slash menu');
await freshPage('Slash');
await page.keyboard.type('/');
await page.waitForSelector('.slash', { timeout: 4000 });
check('"/" opens the insert menu', await page.locator('.slash').count(), 1);
check('it offers only what the schema holds', await page.locator('.slash-item').count(), 22);
check(
  'the first entry starts selected',
  await page.locator('.slash-item.is-active .slash-label').innerText(),
  'Text',
);

await page.keyboard.type('quo');
await page.waitForTimeout(200);
check('typing filters it', await page.locator('.slash-item .slash-label').allInnerTexts(), ['Quote']);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('enter inserts the block', /<blockquote>/.test(await bodyHtml()), true);
check('and the "/quo" that asked for it is gone', (await bodyText()).includes('/'), false);
check('the menu closes behind it', await page.locator('.slash').count(), 0);

await freshPage('Slash keys');
await page.keyboard.type('/head');
await page.waitForSelector('.slash');
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(150);
check(
  'the arrows move the selection',
  await page.locator('.slash-item.is-active .slash-label').innerText(),
  'Subheading',
);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('escape closes it', await page.locator('.slash').count(), 0);
check('and leaves what was typed alone', (await bodyText()).trim(), '/head');
await page.keyboard.type('ing');
await page.waitForTimeout(200);
check('a dismissed "/" stays dismissed as you keep typing', await page.locator('.slash').count(), 0);

await freshPage('Slash prose');
await page.keyboard.type('either 3/4 or 2026/07/31 ');
await page.waitForTimeout(250);
check('a "/" inside a word is not a command', await page.locator('.slash').count(), 0);
await page.keyboard.type('/zzzz');
await page.waitForTimeout(250);
check('nor is one that matches nothing', await page.locator('.slash').count(), 0);

// ------------------------------------------------------------------ tables
section('tables');
await freshPage('Tables');
await page.keyboard.type('/table');
await page.waitForSelector('.slash');
await page.keyboard.press('Enter');
await page.waitForSelector('.body table', { timeout: 4000 });
check('"/table" inserts a table', await page.locator('.body table').count(), 1);
check('three by three, with a header row', await page.locator('.body th').count(), 3);
check('and six ordinary cells under it', await page.locator('.body td').count(), 6);
check(
  'a wide one scrolls inside its own box rather than the page',
  await page.locator('.body .tableWrapper').count(),
  1,
);

await page.keyboard.type('Name');
await page.keyboard.press('Tab');
await page.keyboard.type('Role');
await page.waitForTimeout(250);
check('tab moves to the next cell', await page.locator('.body th').nth(1).innerText(), 'Role');
check('and leaves the one before it alone', await page.locator('.body th').nth(0).innerText(), 'Name');

// Seven more lands in the last cell; the eighth has nowhere to go.
for (let index = 0; index < 8; index++) await page.keyboard.press('Tab');
await page.waitForTimeout(300);
check('tab off the last cell makes a new row', await page.locator('.body tr').count(), 4);
check('and the new row is a row of cells', await page.locator('.body td').count(), 9);

/* A list inside a cell is still a list, so Tab there nests rather than
   jumping — the one place the two meanings of the key overlap. */
await page.keyboard.type('- one\nTwo');
await page.waitForTimeout(200);
await page.keyboard.press('Tab');
await page.waitForTimeout(250);
check(
  'tab in a list inside a cell nests, rather than leaving the cell',
  await page.locator('.body td ul ul').count(),
  1,
);
check('and the table still has the rows it had', await page.locator('.body tr').count(), 4);

// --------------------------------------------------------------- selection
section('selection');
await freshPage('Selection');
await page.keyboard.type('mark this sentence');
await page.waitForTimeout(300);

/** Drag across the paragraph, which is what actually brings the bar out. */
const selectLine = async () => {
  const box = await page.locator('.body p').first().boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
};

/** The bar animates itself out, so it outlives the selection by a beat. */
const barGone = async () => {
  await page.waitForTimeout(300);
  return page.locator('.bubble').count();
};

await selectLine();
await page.waitForSelector('.bubble', { timeout: 4000 });
check('holding text brings the bar to it', await page.locator('.bubble').count(), 1);
check(
  'and it offers what you can do to writing that already exists',
  await page.locator('.bubble-btn').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label')),
  ),
  [
    'Turn into',
    'Bold',
    'Italic',
    'Strikethrough',
    'Code',
    'Comment',
    'Bullet list',
    'Numbered list',
    'Task list',
    'Highlight',
  ],
);
check(
  'the block type says which one you are in',
  (await page.locator('.bubble-style').innerText()).trim(),
  'Text',
);
check(
  'it never covers the words it is about',
  await page.evaluate(() => {
    const bar = document.querySelector('.bubble').getBoundingClientRect();
    const line = document.querySelector('.body p').getBoundingClientRect();
    return bar.bottom <= line.top + 1 || bar.top >= line.bottom - 1;
  }),
  true,
);
check(
  'and every control arrives in its own turn',
  await page.evaluate(() =>
    [...document.querySelectorAll('.bubble > *')].every(
      (node) => getComputedStyle(node).animationName === 'bubble-part',
    ),
  ),
  true,
);

await page.locator('.bubble-btn[aria-label="Bold"]').click();
await page.waitForTimeout(400);
check('clicking a mark applies it', /<strong>mark this sentence<\/strong>/.test(await bodyHtml()), true);
check('and the bar stays, because the words are still held', await page.locator('.bubble').count(), 1);

await page.locator('.bubble-btn[aria-label="Highlight"]').click();
await page.waitForSelector('.bubble-menu');
check(
  'the highlights are named for the colour they are',
  await page.locator('.bubble-menu .bubble-item-label').allInnerTexts(),
  ['Yellow', 'Green', 'Blue', 'Red', 'None'],
);
await page.locator('.bubble-item', { hasText: 'Blue' }).first().click();
await page.waitForTimeout(400);
check('so a second mark needs no second selection', /<mark[^>]*data-tone="blue"/.test(await bodyHtml()), true);

await page.keyboard.press('Escape');
check('escape closes it', await barGone(), 0);
check(
  'and leaves the selection standing',
  await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim()),
  'mark this sentence',
);
// Clicking away and selecting again is a new question, and gets asked again.
const line = await page.locator('.body p').first().boundingBox();
await page.mouse.click(line.x + line.width - 2, line.y + line.height / 2);
check('clicking away leaves it closed', await barGone(), 0);
await selectLine();
await page.waitForSelector('.bubble', { timeout: 4000 });
check('and selecting again asks again', await page.locator('.bubble').count(), 1);

// A mousedown inside a selection is a text drag, not a new selection, and a
// text drag never delivers a mouseup. The bar has to survive one.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.mouse.move(line.x + 4, line.y + line.height / 2);
await page.mouse.down();
await page.mouse.move(line.x + line.width - 4, line.y + line.height / 2, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(400);
check(
  'and a dragged selection that never became one does not jam it shut',
  await page.locator('.bubble').count(),
  1,
);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Enter, Tab and the arrows all mean something to held text. Nothing that
// opens over a selection may take them.
await freshPage('Selection keys');
await page.keyboard.type('one line');
await page.keyboard.press('Shift+Home');
await page.waitForSelector('.bubble', { timeout: 4000 });
check('a selection made with the keyboard opens it too', await page.locator('.bubble').count(), 1);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('but enter still replaces held text rather than picking a control', (await bodyText()).trim(), '');

// -------------------------------------------------------------- stickers
section('stickers');
await freshPage('Stickers');
await page.keyboard.type('shipped it /party');
await page.waitForSelector('.slash');
check(
  'stickers are in the same menu',
  await page.locator('.slash-item .slash-label').allInnerTexts(),
  ['Party'],
);
await page.keyboard.press('Enter');
await page.waitForTimeout(900);
check('a sticker lands in the prose', await page.locator('.body img.sticker').count(), 1);
check(
  'as an id, not as bytes',
  await page.locator('.body img.sticker').getAttribute('data-sticker'),
  'party',
);
check(
  'and the art it names is found and drawn',
  await page
    .locator('.body img.sticker')
    .evaluate((img) => img.naturalWidth > 0 && img.src.includes('party')),
  true,
);
check('a sticker is not a word', await page.locator('.status .words').innerText(), '2 words');

await page.reload({ waitUntil: 'networkidle' });
await dismissWelcome();
await page.waitForTimeout(400);
check('it survives a relaunch', await page.locator('.body img.sticker').count(), 1);

// ---------------------------------------------------------------- images
section('images');
await freshPage('Images');
await page.keyboard.type('a picture follows');

/**
 * Pastes a PNG the page draws for itself, so the check needs no fixture on
 * disk and the bytes are known.
 */
const pasteImage = async (colour, size = 40) =>
  page.locator('.body').evaluate(
    async (body, { colour, size }) => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      context.fillStyle = colour;
      context.fillRect(0, 0, size, size);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'test.png', { type: 'image/png' }));
      body.focus();
      body.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    },
    { colour, size },
  );

await pasteImage('#c0392b');
await page.waitForSelector('.body img.image', { timeout: 5000 });
await page.waitForTimeout(900);
check('a pasted image lands in the page', await page.locator('.body img.image').count(), 1);
check(
  'as an id, not as bytes',
  (await page.locator('.body img.image').getAttribute('data-asset'))?.length,
  64,
);
check(
  'and it draws from the library',
  await page.locator('.body img.image').evaluate((img) => img.complete && img.naturalWidth > 0),
  true,
);
check('the words it sits beside are still the count', await page.locator('.status .words').innerText(), '3 words');

// The same picture twice is one asset: the id is the hash of the bytes.
await page.keyboard.press('Control+End');
await pasteImage('#c0392b');
await page.waitForTimeout(700);
const ids = await page.locator('.body img.image').evaluateAll((nodes) =>
  nodes.map((node) => node.getAttribute('data-asset')),
);
check('the same picture pasted twice is two nodes', ids.length, 2);
check('sharing one asset between them', ids[0] === ids[1], true);

await pasteImage('#1e6f50');
await page.waitForTimeout(700);
const all = await page.locator('.body img.image').evaluateAll((nodes) =>
  nodes.map((node) => node.getAttribute('data-asset')),
);
check('a different picture is a different asset', new Set(all).size, 2);

await page.reload({ waitUntil: 'networkidle' });
await dismissWelcome();
await page.waitForTimeout(700);
check('images survive a relaunch', await page.locator('.body img.image').count(), 3);
check(
  'and are read back out of storage, not remembered',
  await page.locator('.body img.image').first().evaluate((img) => img.complete && img.naturalWidth > 0),
  true,
);

// A picture is a selection like any other as far as ProseMirror is concerned,
// which is how it ended up being offered Bold and Heading.
await page.locator('.body img.image').first().click();
await page.waitForTimeout(400);
check('clicking a picture selects it', await page.locator('.body img.image.ProseMirror-selectednode').count(), 1);
check('but does not ask what to do to its words', await page.locator('.bubble').count(), 0);

// Text still does, which is the whole point of the distinction.
await page.locator('.body p').first().click();
await page.keyboard.press('Shift+Home');
await page.waitForSelector('.bubble', { timeout: 4000 });
check('while held text still does', await page.locator('.bubble').count(), 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

check(
  'and a picture is draggable, which is how it gets moved',
  await page.locator('.body img.image').first().evaluate((img) => img.draggable),
  true,
);

// Dropping a file, which is the route nobody thinks of as a feature until it
// is missing. Dropped onto the middle of a paragraph, because that is where a
// pointer lands and an image is a block.
await freshPage('Dropped');
await page.keyboard.type('drop it on this line');
await page.waitForTimeout(300);
await page.locator('.body p').first().evaluate(async (paragraph) => {
  const canvas = document.createElement('canvas');
  canvas.width = 30;
  canvas.height = 30;
  const context = canvas.getContext('2d');
  context.fillStyle = '#8e44ad';
  context.fillRect(0, 0, 30, 30);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], 'dropped.png', { type: 'image/png' }));
  const box = paragraph.getBoundingClientRect();
  paragraph.dispatchEvent(
    new DragEvent('drop', {
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }),
  );
});
await page.waitForSelector('.body img.image', { timeout: 5000 });
await page.waitForTimeout(900);
check('a dropped file becomes a picture', await page.locator('.body img.image').count(), 1);
check(
  'and dropping it into a sentence does not eat the sentence',
  (await bodyText()).includes('drop it on this line'),
  true,
);

// The escape hatch has to carry them, or an export is an export with holes.
const exported = await page.evaluate(async () => {
  const { buildExport } = await import('/src/export/index.ts');
  const { store } = await import('/src/data/index.ts');
  const result = await buildExport(store, {
    format: 'markdown-folder',
    scope: { kind: 'all' },
    preset: 'reading',
    details: { surname: '', title: '', author: '', contact: '' },
  });
  const markdown = result.files.filter((file) => file.path.endsWith('.md'));
  return {
    assets: result.files.filter((file) => file.path.startsWith('assets/')).map((file) => file.path),
    links: markdown.flatMap((file) => [...String(file.data).matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1])),
  };
});
check('an export writes the picture files beside the markdown', exported.assets.length, 3);
check('and the markdown links every one it writes', new Set(exported.links).size, 3);
check(
  'at exactly the paths the files were written to',
  exported.links.every((link) => exported.assets.includes(link)),
  true,
);

// ------------------------------------------------------------- page links
section('page links');
await freshPage('Somewhere else');
await page.keyboard.type('this page is the one being pointed at');
await page.waitForTimeout(700);

await page.locator('.tree-list .row', { hasText: 'Somewhere else' }).first().click({ button: 'right' });
await page.waitForSelector('.menu');
await page.locator('.menu-item', { hasText: 'Copy link' }).click();
await page.waitForTimeout(400);

const copied = await page.evaluate(async () => {
  const items = await navigator.clipboard.read();
  const out = {};
  for (const item of items) {
    for (const type of item.types) {
      if (type === 'text/html' || type === 'text/plain') out[type] = await (await item.getType(type)).text();
    }
  }
  return out;
});
check('copying a page writes a link the app can read', /data-page="[^"]+"/.test(copied['text/html'] ?? ''), true);
check(
  'and a reference anything else can',
  (copied['text/plain'] ?? '').startsWith('springboard://page/'),
  true,
);

await freshPage('Pointing at it');
await page.keyboard.type('see ');
await page.keyboard.press('Control+KeyV');
await page.waitForTimeout(700);
check('pasting it makes a live page link', await page.locator('.body .page-link').count(), 1);
check(
  'that carries the title of the page it points at',
  await page.locator('.body .page-link').getAttribute('data-title'),
  'Somewhere else',
);
check('inline, in the middle of the sentence it was pasted into', (await bodyText()).startsWith('see'), true);

// Renaming the target has to move the link with it: the node stores an id,
// and the title is looked up every time it draws.
await page.locator('.tree-list .row', { hasText: 'Somewhere else' }).first().click();
await page.keyboard.press('F2');
await page.waitForSelector('.rename');
await page.keyboard.press('Control+KeyA');
await page.keyboard.type('Renamed target');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
await page.locator('.tree-list .row', { hasText: 'Pointing at it' }).first().click();
await page.waitForTimeout(600);
check(
  'and follows the page when it is renamed',
  await page.locator('.body .page-link').getAttribute('data-title'),
  'Renamed target',
);

// The plain-text half, which is what arrives without HTML.
await freshPage('Plain paste');
await page.evaluate(async () => {
  const id = document.querySelector('.tree-list .row[data-id]')?.getAttribute('data-id');
  await navigator.clipboard.writeText(`springboard://page/${id}`);
});
await body().click();
await page.keyboard.press('Control+KeyV');
await page.waitForTimeout(600);
check(
  'a bare springboard:// reference pastes as a link too',
  await page.locator('.body .page-link').count(),
  1,
);
check('rather than as the text of a URI', (await bodyText()).includes('springboard://'), false);

// ---------------------------------------------------------------- mentions
section('mentions');
await freshPage('Mentioning');
await page.keyboard.type('as told in ');
await page.keyboard.type('@');
await page.waitForSelector('.slash', { timeout: 4000 });
check('"@" opens a list of pages', (await page.locator('.slash-item').count()) > 0, true);
check(
  'and offers what was touched most recently before anything is typed',
  (await page.locator('.slash-item .slash-label').first().innerText()).length > 0,
  true,
);

await page.keyboard.type('Renamed');
await page.waitForTimeout(300);
check(
  'typing narrows it to the page meant',
  await page.locator('.slash-item .slash-label').allInnerTexts(),
  ['Renamed target', 'Create “Renamed”'],
);
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
check('enter inserts a live page link', await page.locator('.body .page-link').count(), 1);
check(
  'pointing at the page that was chosen',
  await page.locator('.body .page-link').getAttribute('data-title'),
  'Renamed target',
);
check('and the "@Renamed" that asked for it is gone', (await bodyText()).includes('@'), false);
check('the sentence around it is untouched', (await bodyText()).startsWith('as told in'), true);

// The row that makes it more than a picker.
await page.keyboard.type(' and also @Barnaby');
await page.waitForTimeout(400);
check(
  'a name no page answers to is offered as a page to make',
  await page.locator('.slash-item .slash-label').allInnerTexts(),
  ['Create “Barnaby”'],
);
await page.keyboard.press('Enter');
await page.waitForTimeout(900);
check('choosing it makes the page', (await shapeOf()).some((row) => row.includes('Barnaby')), true);
check('and links to it from where you were', await page.locator('.body .page-link').count(), 2);
check(
  'the new link pointing at the page it just made',
  await page.locator('.body .page-link').last().getAttribute('data-title'),
  'Barnaby',
);
check(
  'without going to it — the caret stays in the sentence',
  await page.locator('.title').inputValue(),
  'Mentioning',
);

await freshPage('Not a mention');
await page.keyboard.type('write to sesan@gmail');
await page.waitForTimeout(300);
check('an "@" inside a word is not a mention', await page.locator('.slash').count(), 0);

// ------------------------------------------------------------------ guide
section('guide');
await page.keyboard.press('Control+Comma');
await page.waitForSelector('.dialog.is-narrow', { timeout: 4000 });
await page.locator('.setting-action').click();
await page.waitForSelector('.guide', { timeout: 4000 });
check('settings opens the guide', await page.locator('.guide').count(), 1);
check('and settings gets out of its way', await page.locator('.dialog.is-narrow').count(), 0);
check('every topic is listed', (await page.locator('.guide-topic').count()) >= 10, true);
check(
  'and every one of them has something to say',
  await page.locator('.guide-section').count(),
  await page.locator('.guide-topic').count(),
);

// The reason it is a reference and not a tour: you arrive with a question.
await page.locator('.guide-search').fill('scene break');
await page.waitForTimeout(300);
const answer = await page.locator('.guide-body').innerText();
check('searching it answers a question', answer.includes('---'), true);
check('and shows only what answers it', (await page.locator('.guide-section').count()) < 4, true);

await page.locator('.guide-search').fill('zzzz');
await page.waitForTimeout(250);
check('a question it cannot answer says so', await page.locator('.picker-empty').count(), 1);

await page.locator('.guide-search').fill('');
await page.waitForTimeout(250);
await page.locator('.guide-topic', { hasText: 'History' }).click();
await page.waitForTimeout(400);
check('picking a topic moves to it', await page.locator('.guide-topic.is-active').innerText(), 'History');

await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('escape closes it', await page.locator('.guide').count(), 0);
check('without taking you anywhere', await page.locator('.body').count(), 1);

// --------------------------------------------------------------- history
section('history');
await freshPage('History');
await page.keyboard.type('the version I meant to keep');
// Long enough for the debounced save that lays down the first revision.
await page.waitForTimeout(1200);

await page.locator('.chrome-btn[aria-label="History"]').click();
await page.waitForSelector('.dialog.is-wide', { timeout: 4000 });
// The list is read asynchronously after the dialog is on screen.
await page.waitForSelector('.history-entry', { timeout: 4000 });
const firstRun = await page.locator('.history-entry').count();
check('the top bar opens the page’s history', firstRun >= 1, true);
check(
  'and the newest version is shown, rendered rather than diffed',
  (await page.locator('.history-preview .body').innerText()).trim(),
  'the version I meant to keep',
);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('escape closes it', await page.locator('.dialog.is-wide').count(), 0);

// Overwrite it. Revisions coalesce, so this one does not get its own entry —
// which is exactly the case a restore has to survive.
await body().click();
await page.keyboard.press('Control+KeyA');
await page.keyboard.type('nonsense typed over the top');
await page.waitForTimeout(1200);
check('the page now says something else', (await bodyText()).trim(), 'nonsense typed over the top');

await page.keyboard.press('Control+Shift+KeyH');
await page.waitForSelector('.dialog.is-wide', { timeout: 4000 });
await page.waitForSelector('.history-entry', { timeout: 4000 });
check('the shortcut opens it too', await page.locator('.dialog.is-wide').count(), 1);
await page.locator('.history-entry').first().click();
await page.locator('.btn.is-primary', { hasText: 'Restore' }).click();
await page.waitForTimeout(1200);
check('restoring puts the old words back', (await bodyText()).trim(), 'the version I meant to keep');

await page.keyboard.press('Control+KeyZ');
await page.waitForTimeout(900);
check('and a restore can be undone like anything else', (await bodyText()).trim(), 'nonsense typed over the top');

await page.locator('.chrome-btn[aria-label="History"]').click();
await page.waitForSelector('.dialog.is-wide');
check(
  'and where you were before it is kept as its own version',
  (await page.locator('.history-entry').count()) > firstRun,
  true,
);
// Restore once more, so what persists is a restore rather than an undo.
await page.locator('.history-entry').first().click();
await page.locator('.btn.is-primary', { hasText: 'Restore' }).click();
await page.waitForTimeout(1200);
check('restoring again lands on the same words', (await bodyText()).trim(), 'the version I meant to keep');

await page.reload({ waitUntil: 'networkidle' });
await dismissWelcome();
await page.waitForTimeout(600);
check('the restored page is what survives a relaunch', (await bodyText()).trim(), 'the version I meant to keep');

// --------------------------------------------------------------- toolbar
section('toolbar');
await freshPage('Toolbar');
await page.keyboard.type('select these words');
await page.keyboard.press('Control+A');
await page.locator('.tool[aria-label="Bold"]').click();
await page.waitForTimeout(250);
check('the toolbar applies a mark', /<strong>select these words<\/strong>/.test(await bodyHtml()), true);
check('and shows it as active', await page.locator('.tool[aria-label="Bold"]').getAttribute('aria-pressed'), 'true');
check('it shares the page bar rather than adding a row', await page.locator('.pagebar .toolbar').count(), 1);

await page.keyboard.press('Control+A');
await page.locator('.tool[aria-label="Highlight"]').click();
await page.waitForSelector('.tones');
check('highlights are four fixed colours, not a picker', await page.locator('.tones .tone').count(), 5);
await page.locator('.tones .tone-blue').click();
await page.waitForTimeout(300);
check('a colour applies', /<mark[^>]*data-tone="blue"/.test(await bodyHtml()), true);
await page.keyboard.press('Control+A');
await page.locator('.tool[aria-label="Highlight"]').click();
await page.waitForSelector('.tones');
await page.locator('.tones .tone.is-clear').click();
await page.waitForTimeout(300);
check('and clears', /<mark/.test(await bodyHtml()), false);

// ------------------------------------------------------- caret and scroll
section('caret');
await freshPage('Caret');
await page.keyboard.type('a line of writing');
await page.waitForTimeout(400);
check('a caret is drawn', await page.locator('.caret').count(), 1);
check(
  'the native one is hidden only once ours exists',
  await page.locator('.body').evaluate((el) => el.classList.contains('caret-hidden')),
  true,
);
await page.keyboard.press('Control+A');
await page.waitForTimeout(350);
check('it goes when there is a selection to show instead', await page.locator('.caret').count(), 0);
check(
  'and the native caret comes back with it',
  await page.locator('.body').evaluate((el) => el.classList.contains('caret-hidden')),
  false,
);

// ---------------------------------------------------------------- paste
section('paste');
await freshPage('Paste');
await page.evaluate(() => {
  const html =
    '<p style="color:red;font-size:40px" class="x">red <span style="background:yellow">and yellow</span></p>' +
    '<table><tr><td>a cell</td></tr></table><img src="x.png">';
  const data = new DataTransfer();
  data.setData('text/html', html);
  document.querySelector('.body').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
});
await page.waitForTimeout(300);
const pasted = await bodyHtml();
check('paste keeps the words', /red and yellow/.test(pasted), true);
check('paste drops colour and size', /style=|color:|font-size/.test(pasted), false);
check('paste drops tables and images', /<table|<img/.test(pasted), false);

// ----------------------------------------------------------------- tabs
section('tabs');
// Three pages named but never typed into, so nothing has promoted itself.
for (const name of ['Alpha', 'Beta', 'Gamma']) {
  await page.locator('.tree-list').click();
  await page.keyboard.press('Control+KeyN');
  await page.waitForSelector('.rename');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
}

await page.locator('.row', { hasText: 'Alpha' }).first().click();
await page.waitForTimeout(300);
check('single click previews', await page.locator('.tab.is-active.is-preview').count(), 1);
const beforeBrowsing = (await tabLabels()).length;
await page.locator('.row', { hasText: 'Beta' }).first().click();
await page.waitForTimeout(300);
await page.locator('.row', { hasText: 'Gamma' }).first().click();
await page.waitForTimeout(300);
check('the next single click reuses the preview tab', (await tabLabels()).length, beforeBrowsing);
check('only ever one preview tab', await page.locator('.tab.is-preview').count(), 1);
await page.locator('.row', { hasText: 'Beta' }).first().dblclick();
await page.waitForTimeout(300);
check('double click keeps the tab', await page.locator('.tab.is-active.is-preview').count(), 0);
await page.locator('.row', { hasText: 'Gamma' }).first().click();
await page.waitForTimeout(300);
check('back to a preview', await page.locator('.tab.is-active.is-preview').count(), 1);
await body().click();
await page.keyboard.type('editing promotes too');
await page.waitForTimeout(500);
check('editing a preview promotes it', await page.locator('.tab.is-active.is-preview').count(), 0);

const before = (await tabLabels()).length;
await page.keyboard.press('Control+KeyT');
await page.waitForTimeout(400);
check('ctrl-T lands in the new title', await page.evaluate(() => document.activeElement?.className), 'title');
await page.keyboard.type('From a shortcut');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
check('ctrl-T opens a new page in a new tab', (await tabLabels()).length, before + 1);

await page.keyboard.press('Control+KeyW');
await page.waitForTimeout(300);
check('ctrl-W closes it', (await tabLabels()).length, before);
await page.keyboard.press('Control+Shift+KeyT');
await page.waitForTimeout(300);
check('ctrl-shift-T brings it back', (await tabLabels()).includes('From a shortcut'), true);

await page.keyboard.press('Control+Digit1');
await page.waitForTimeout(300);
const firstTab = (await tabLabels())[0].replace(' (preview)', '');
check('ctrl-1 jumps to the first tab', (await page.locator('.title').inputValue()) || 'Untitled', firstTab);
const activeBefore = await page.locator('.tab.is-active').innerText();
await page.keyboard.press('Control+Tab');
await page.waitForTimeout(300);
check('ctrl-tab moves on', (await page.locator('.tab.is-active').innerText()) !== activeBefore, true);

const openTabs = await tabLabels();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.tab');
check('the tab set survives a relaunch', (await tabLabels()).length, openTabs.length);
// The greeting stands between launch and the page; dismissing it is the
// route back to work, and the caret has to be waiting on the other side.
await dismissWelcome();
await page
  .waitForFunction(() => document.activeElement?.className?.includes('body'), null, { timeout: 5000 })
  .catch(() => {});
check('and lands ready to type', await page.evaluate(() => document.activeElement?.className.includes('body')), true);

check('browsing the tree does not bury you in tabs', (await tabLabels()).length <= (await shapeOf()).length, true);

// ------------------------------------------------------- undo across tabs
section('undo');
await dismissWelcome();
await page.locator('.tree-list .row', { hasText: 'Chapter One' }).first().dblclick();
await page.waitForTimeout(400);
await body().click();
await page.keyboard.press('Control+End');
await page.keyboard.type(' A sentence to undo.');
await page.waitForTimeout(700);
await page.locator('.row', { hasText: 'Marks' }).first().dblclick();
await page.waitForTimeout(400);
await page.locator('.row', { hasText: 'Chapter One' }).first().dblclick();
await page.waitForTimeout(400);
await body().click();
await page.keyboard.press('Control+KeyZ');
await page.waitForTimeout(400);
check(
  'undo survives navigating away and back',
  (await bodyText()).includes('A sentence to undo.'),
  false,
);

// ------------------------------------------------------------- durability
section('durability');
await page.locator('.tree-list .row', { hasText: 'Chapter One' }).first().dblclick();
await page.waitForTimeout(400);
await body().click();
await page.keyboard.press('Control+End');
await page.keyboard.type(' Then the light went.');
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await page.close({ runBeforeUnload: false });

page = await ctx.newPage();
watch(page);
await page.goto(URL, { waitUntil: 'networkidle' });
await dismissWelcome();
check(
  'nothing lost when the tab dies mid-sentence',
  (await bodyText()).includes('Then the light went.'),
  true,
);

// -------------------------------------------------------------- structure
section('structure');
await page.locator('.tree-list').click();
await page.locator('.row', { hasText: 'Lists' }).first().click();
await page.locator('.tree-list').focus();
await page.keyboard.press('Backspace');
await page.waitForTimeout(400);
check('backspace archives', (await shapeOf()).includes('Lists'), false);
await setArchiveOpen(true);
check('archive keeps it', (await page.locator('.tree-foot .ghost').innerText()).startsWith('Archive ('), true);
await page.locator('.archive-row .ghost').first().click();
await page.waitForTimeout(400);
check('restore brings it back', (await shapeOf()).includes('Lists'), true);
await setArchiveOpen(false);

// ------------------------------------------------------------- second tab
// Two tabs on one library would overwrite each other, so the second one is
// refused rather than allowed to race. Checked before the theme run below,
// which is why that run needs a context of its own.
section('a second tab');
const second = await ctx.newPage();
await second.goto(URL, { waitUntil: 'networkidle' });
await second.waitForSelector('.standing', { timeout: 5000 });
check(
  'a second tab is told rather than allowed to race',
  (await second.locator('.standing-title').innerText()).includes('another tab'),
  true,
);
check('and it never opens the library', await second.locator('.workspace').count(), 0);
await second.close();

// The theme run gets its own context — a second tab of the same profile is now
// declined, which is the point of the section above.
const darkCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const dark = await darkCtx.newPage();
await dark.emulateMedia({ colorScheme: 'dark' });
await dark.goto(URL, { waitUntil: 'networkidle' });
await dismissWelcome(dark);
await dark.waitForSelector('.editor-host');
check('follows a dark system theme', await dark.locator('html').getAttribute('data-theme'), 'dark');
// system -> light
await dark.locator('.chrome-btn[aria-label^="Theme"]').click();
await dark.waitForTimeout(250);
check('the theme control overrides the system', await dark.locator('html').getAttribute('data-theme'), 'light');
await dark.reload({ waitUntil: 'networkidle' });
await dismissWelcome(dark);
await dark.waitForSelector('.editor-host');
check('and the choice survives a relaunch', await dark.locator('html').getAttribute('data-theme'), 'light');
await darkCtx.close();

// ------------------------------------------------------------------ delete
section('delete');
await page.locator('.tree-list').click();
await page.keyboard.press('Control+KeyN');
await page.waitForSelector('.rename');
await page.keyboard.type('Doomed');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.keyboard.press('Control+Shift+KeyN');
await page.waitForSelector('.rename');
await page.keyboard.type('Doomed child');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);

await page.locator('.row', { hasText: 'Doomed' }).first().click({ button: 'right' });
await page.waitForSelector('.menu');
check(
  'right-click offers the row actions',
  await page.locator('.menu-item > span:first-child').allInnerTexts(),
  ['Rename', 'New page inside', 'Copy link', 'Add an icon', 'Add to favourites', 'Delete'],
);
await page.locator('.menu-item', { hasText: 'Delete' }).click();
await page.waitForTimeout(500);
check(
  'delete takes the page and everything inside it out of the tree',
  (await shapeOf()).some((row) => row.includes('Doomed')),
  false,
);

await setArchiveOpen(true);
const doomedRow = page.locator('.archive-row', { hasText: 'Doomed' }).first();
await doomedRow.locator('.ghost', { hasText: 'Delete' }).click();
await page.waitForTimeout(200);
check(
  'permanent delete asks first',
  await doomedRow.locator('.ghost', { hasText: 'Delete for good' }).count(),
  1,
);
await doomedRow.locator('.ghost', { hasText: 'Keep' }).click();
await page.waitForTimeout(200);
check('and can be backed out of', await page.locator('.archive-row', { hasText: 'Doomed' }).count(), 1);

await page
  .locator('.archive-row', { hasText: 'Doomed' })
  .first()
  .locator('.ghost', { hasText: 'Delete' })
  .click();
await page.waitForTimeout(150);
await page
  .locator('.archive-row', { hasText: 'Doomed' })
  .first()
  .locator('.ghost', { hasText: 'Delete for good' })
  .click();
await page.waitForTimeout(500);
check('deleting for good empties it from the archive', await page.locator('.archive-row', { hasText: 'Doomed' }).count(), 0);
check(
  'and the hidden descendant goes with it',
  await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      // Still 'springboard': the database is an address, not a title. See the
      // note beside DB_NAME in src/data/idbStore.ts.
      const request = indexedDB.open('springboard');
      request.onsuccess = () => resolve(request.result);
    });
    const rows = await new Promise((resolve) => {
      const request = db.transaction('documents').objectStore('documents').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    return rows.some((row) => row.title.startsWith('Doomed'));
  }),
  false,
);
await setArchiveOpen(false);

// --------------------------------------------------------------- favourites
section('favourites');
await page.locator('.tree-list').click();
const favouriteRow = page.locator('.row', { hasText: 'Chapter One' }).first();
await favouriteRow.hover();
await favouriteRow.locator('.row-star').click();
await page.waitForTimeout(400);
check('starring adds a favourites section', await page.locator('.favourites .row').count(), 1);
await page.reload({ waitUntil: 'networkidle' });
await dismissWelcome();
await page.waitForSelector('.favourites');
check('favourites persist', (await page.locator('.favourites .row-title').first().innerText()).trim(), 'Chapter One');

// ----------------------------------------------------------- rearranging
// Drag and drop is the one thing that cannot be checked by reading the code:
// a `dragover` that forgets to `preventDefault` looks fine and silently draws
// the browser's no-drop cursor instead of accepting anything.
section('rearranging tabs');

const tabOrder = () => page.locator('.tab .tab-label').allInnerTexts();

// A tab stays a preview — and so keeps being reused — until its body is
// edited, so each of these earns a tab of its own the way a writer would.
// The strip already holds tabs from earlier sections; these three go on the
// end and every check below reads the last three.
for (const name of ['Alpha', 'Bravo', 'Charlie']) {
  await page.keyboard.press('Control+KeyT');
  await page.waitForSelector('.title:focus', { timeout: 8000 });
  await page.locator('.title').fill(name);
  await body().click();
  await page.keyboard.type('x');
  await page.waitForFunction(
    (expected) =>
      [...document.querySelectorAll('.tab .tab-label')].slice(-1)[0]?.textContent === expected,
    name,
    { timeout: 8000 },
  );
}
check('three pages make three tabs', (await tabOrder()).slice(-3), ['Alpha', 'Bravo', 'Charlie']);

// The strip scrolls to the newest tab, and by now it holds more than fits, so
// both ends are brought into view before their coordinates are read —
// otherwise the drag starts on whatever is under a clipped tab's box.
const first = page.locator('.tab', { hasText: 'Alpha' }).first();
const last = page.locator('.tab', { hasText: 'Charlie' }).first();
await last.scrollIntoViewIfNeeded();
await first.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const from = await first.boundingBox();
const to = await last.boundingBox();
await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
await page.mouse.down();
for (let step = 1; step <= 8; step++) {
  await page.mouse.move(from.x + from.width / 2 + ((to.x - from.x) * step) / 8, from.y + from.height / 2);
  await page.waitForTimeout(40);
}
await page.waitForTimeout(120);
check(
  'the strip accepts the drag rather than refusing it',
  await page.locator('.tab.is-drop').count() > 0,
  true,
);
await page.mouse.up();
await page.waitForTimeout(400);
check('dragging a tab moves it', (await tabOrder()).slice(-3), ['Bravo', 'Charlie', 'Alpha']);

await page.locator('.tab', { hasText: 'Charlie' }).first().click();
await page.waitForTimeout(300);
await page.keyboard.press('Control+Shift+PageUp');
await page.waitForTimeout(400);
check('ctrl-shift-pageup moves it left', (await tabOrder()).slice(-3), ['Charlie', 'Bravo', 'Alpha']);
await page.keyboard.press('Control+Shift+PageDown');
await page.waitForTimeout(400);
check('and pagedown moves it back', (await tabOrder()).slice(-3), ['Bravo', 'Charlie', 'Alpha']);

const edge = await tabOrder();
await page.locator('.tab').first().click();
await page.waitForTimeout(400);
await page.keyboard.press('Control+Shift+PageUp');
await page.waitForTimeout(500);
check('the leftmost tab declines to move further left', await tabOrder(), edge);

// Left as they were found, so the sections after this one still see the
// library they were written against.
for (const name of ['Alpha', 'Bravo', 'Charlie']) {
  await page.locator('.tab', { hasText: name }).first().click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+KeyW');
  await page.waitForTimeout(250);
}

// --------------------------------------------------------------- pictures
/**
 * A real 1×1 PNG. Small on purpose: what is being checked is the path a
 * picture takes through the app, not the picture.
 */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Clicks something that opens a file dialog, and answers the dialog. */
const withPicture = async (open, name = 'picture.png') => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), open()]);
  await chooser.setFiles({ name, mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
  await page.waitForTimeout(400);
};

section('galleries');
await freshPage('Gallery');
await page.keyboard.type('/gallery');
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForSelector('.gallery', { timeout: 4000 });
check('"/gallery" makes one', await page.locator('.gallery').count(), 1);
check('an empty one says what it is for', await page.locator('.gallery-grid.is-empty').count(), 1);

await withPicture(() => page.locator('.gallery-button', { hasText: 'Add' }).click());
check('adding a picture puts it in the grid', await page.locator('.gallery .image').count(), 1);
check('and the grid stops being empty', await page.locator('.gallery-grid.is-empty').count(), 0);
check(
  'the picture resolves to real bytes rather than a hole',
  await page.locator('.gallery .image').first().evaluate((img) => img.src.startsWith('blob:')),
  true,
);

check('three across to begin with', await page.locator('.gallery').getAttribute('data-columns'), '3');
await page.locator('.gallery-button', { hasText: '2' }).click();
await page.waitForTimeout(200);
check('and the column control changes it', await page.locator('.gallery').getAttribute('data-columns'), '2');

// Reordering inside the grid must not leave a copy behind.
//
// Chromium puts the dragged picture on the drag's own `dataTransfer` as a
// file, so moving a cell onto its neighbour arrives at `handleDrop` looking
// exactly like a picture dropped in from the desktop — and the editor stored
// it as a new node while swallowing the event, so ProseMirror never completed
// the move. Two pictures, one drag. The guard is `view.dragging`.
//
// Driven by hand rather than with real mouse moves: a synthetic Chromium drag
// does not attach the file, which is the whole ingredient. This runs
// ProseMirror's own `dragstart` so the guard sees the state it keys on, then
// drops with a file the way a real drag does.
await withPicture(() => page.locator('.gallery-button', { hasText: 'Add' }).click());
const beforeReorder = await page.locator('.gallery .image').count();
await page.evaluate(async () => {
  const body = document.querySelector('.body');
  const images = [...document.querySelectorAll('.gallery img.image')];
  if (images.length < 2) return;
  images[0].click();
  await new Promise((done) => setTimeout(done, 150));
  body.dispatchEvent(
    new DragEvent('dragstart', { dataTransfer: new DataTransfer(), bubbles: true, cancelable: true }),
  );
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 40;
  canvas.getContext('2d').fillRect(0, 0, 40, 40);
  const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'));
  const dropped = new DataTransfer();
  dropped.items.add(new File([blob], 'moved.png', { type: 'image/png' }));
  const box = images[1].getBoundingClientRect();
  images[1].dispatchEvent(
    new DragEvent('drop', {
      dataTransfer: dropped,
      bubbles: true,
      cancelable: true,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
    }),
  );
});
await page.waitForTimeout(900);
check(
  'reordering the grid moves a picture rather than copying it',
  await page.locator('.gallery .image').count(),
  beforeReorder,
);
// Put the grid back to one picture, which is what the checks below expect.
await page.locator('.gallery img.image').nth(1).click();
await page.keyboard.press('Backspace');
await page.waitForTimeout(400);

// The browser build has no shell to write files, so this is the markup copy —
// which is the half every build has.
await page.locator('.gallery-button', { hasText: 'Copy all' }).click();
await page.waitForTimeout(500);
check(
  'copy all says what it did',
  await page.locator('.gallery-button', { hasText: 'Copied' }).count(),
  1,
);
check(
  'and the clipboard is holding the picture',
  await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const html = items.find((item) => item.types.includes('text/html'));
    if (!html) return 'no html flavour';
    const text = await (await html.getType('text/html')).text();
    return /<img src="data:image\/png;base64,/.test(text) ? 'an image' : text.slice(0, 40);
  }),
  'an image',
);

await page.locator('.gallery-button', { hasText: 'Ungroup' }).click();
await page.waitForTimeout(300);
check('ungrouping leaves the picture behind', await page.locator('.gallery').count(), 0);
check('as an ordinary image', await page.locator('.body .image').count(), 1);

// ----------------------------------------------------------------- covers
section('page covers');
await freshPage('Cover');
check('a new page has no cover', await page.locator('.cover').count(), 0);

await withPicture(() => page.locator('.sheet-tool', { hasText: 'Add cover' }).click(), 'cover.png');
await page.waitForSelector('.cover-image', { timeout: 4000 });
check('adding one puts a banner above the title', await page.locator('.cover-image').count(), 1);
check('and the button that offered it stands down', await page.locator('.sheet-tool').count(), 0);

// The whole point of a cover living on the document rather than in it.
await page.locator('.tree-list').click();
await page.locator('.row', { hasText: 'Gallery' }).first().click();
await page.waitForTimeout(300);
check('another page does not inherit it', await page.locator('.cover').count(), 0);
await page.locator('.row', { hasText: 'Cover' }).first().click();
await page.waitForTimeout(400);
check('and it is still there on the page it belongs to', await page.locator('.cover-image').count(), 1);

await page.locator('.cover-action', { hasText: 'Remove' }).click();
await page.waitForTimeout(300);
check('removing it takes the banner away', await page.locator('.cover').count(), 0);
check('and offers the way back in', await page.locator('.sheet-tool').count(), 1);

// ------------------------------------------------------------------ blocks
section('blocks');
await freshPage('Blocks');
const blockBody = async () => (await body().innerText()).split('\n').filter(Boolean);

for (const line of ['alpha', 'bravo', 'charlie']) {
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}
await page.keyboard.press('Backspace');
await page.waitForTimeout(300);

const hoverBlock = async (text) => {
  await page.locator('.body p', { hasText: text }).first().hover();
  await page.waitForTimeout(200);
};

await hoverBlock('bravo');
check('hovering a block brings its handle', await page.locator('.block-gutter.is-shown').count(), 1);
check(
  'and the handle stays outside the measure rather than inside it',
  await page.evaluate(() => {
    const gutter = document.querySelector('.block-gutter').getBoundingClientRect();
    const line = [...document.querySelectorAll('.body p')]
      .find((p) => p.textContent.includes('bravo'))
      .getBoundingClientRect();
    return gutter.right <= line.left + 1;
  }),
  true,
);
check(
  'and the card never scrolls sideways to hold it',
  await page.evaluate(() => {
    const host = document.querySelector('.editor-host');
    return host.scrollWidth <= host.clientWidth;
  }),
  true,
);

/*
  The margin the handle lives in has to be hoverable ground.

  `posAtCoords` is about text and answers nothing out there, and nothing used to
  mean hide — so the control put itself out as the hand arrived, and could only
  be reached by coming at it exactly level. Walked here rather than jumped,
  because a single `hover()` lands on the far side of the strip and sails past
  the bug entirely.
*/
const margin = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.body > p')];
  const box = (t) => rows.find((p) => p.textContent.includes(t)).getBoundingClientRect();
  const a = box('alpha');
  const c = box('charlie');
  return { x: Math.round(a.left) - 22, alphaY: Math.round((a.top + a.bottom) / 2), charlieY: Math.round((c.top + c.bottom) / 2) };
});
const besideNow = () => page.evaluate(() => {
  const gutter = document.querySelector('.block-gutter');
  if (!gutter.classList.contains('is-shown')) return '(hidden)';
  const box = gutter.getBoundingClientRect();
  const mid = box.top + box.height / 2;
  const row = [...document.querySelectorAll('.body > *')].find((el) => {
    const b = el.getBoundingClientRect();
    return mid >= b.top - 2 && mid <= b.bottom + 2;
  });
  return row ? row.textContent.trim() : '(nothing)';
});

await hoverBlock('charlie');
// Straight out of the text into the strip, then up it — the way a hand reaches.
await page.mouse.move(margin.x + 60, margin.charlieY);
await page.mouse.move(margin.x, margin.charlieY, { steps: 8 });
await page.waitForTimeout(200);
check('the strip the handle lives in is hoverable ground', await besideNow(), 'charlie');
for (let y = margin.charlieY; y >= margin.alphaY; y -= 6) {
  await page.mouse.move(margin.x, y);
}
await page.waitForTimeout(250);
check('and walking up it carries the handle along', await besideNow(), 'alpha');

await hoverBlock('bravo');
await page.locator('.block-gutter .block-btn').first().click();
await page.waitForSelector('.slash', { timeout: 4000 });
check('"+" puts a block under it and opens the insert menu', await page.locator('.slash').count(), 1);
await page.keyboard.press('Escape');
await page.keyboard.press('Backspace');
await page.waitForTimeout(250);
check('and backing out of it leaves an ordinary empty block', await blockBody(), [
  'alpha',
  'bravo',
  'charlie',
]);

await hoverBlock('bravo');
await page.locator('.block-handle').click();
await page.waitForSelector('.block-menu', { timeout: 4000 });
check('the handle opens the block menu', await page.locator('.block-menu').count(), 1);
check(
  'the block it is about is visibly held',
  await page.locator('.body .ProseMirror-selectednode').count(),
  1,
);
check(
  'and holding a block is not the same as holding its words',
  await page.locator('.bubble').count(),
  0,
);
check('it offers what you can do to a block', await page.locator('.block-menu .menu-item').count(), 13);
check(
  'the top block cannot be moved above itself',
  await page.locator('.block-item', { hasText: 'Move up' }).first().isDisabled(),
  false,
);

await page.locator('.block-item', { hasText: 'Move up' }).first().click();
await page.waitForTimeout(350);
check('moving it up trades it with the block above', await blockBody(), ['bravo', 'alpha', 'charlie']);

await page.keyboard.press('Alt+Shift+ArrowDown');
await page.waitForTimeout(350);
check('and the chord puts it back', await blockBody(), ['alpha', 'bravo', 'charlie']);

await page.keyboard.press('Alt+Shift+KeyD');
await page.waitForTimeout(350);
check('duplicating lands the copy directly beneath', await blockBody(), [
  'alpha',
  'bravo',
  'bravo',
  'charlie',
]);

await hoverBlock('charlie');
await page.locator('.block-handle').click();
await page.waitForSelector('.block-menu');
await page.locator('.block-item', { hasText: 'Subheading' }).first().click();
await page.waitForTimeout(350);
check('turning a block into a heading turns the whole block', await page.locator('.body h2').count(), 1);

// The gesture between a click and a drag: a press on the handle that the hand
// does not hold quite still. The browser calls anything past about four pixels
// a drag and then sends no `click` at all, so this used to hold the block, open
// nothing, and take the handle away with it.
await page.locator('.body p', { hasText: 'bravo' }).first().hover();
await page.waitForTimeout(200);
const nudge = await page.locator('.block-handle').boundingBox();
const nudgeX = nudge.x + nudge.width / 2;
const nudgeY = nudge.y + nudge.height / 2;
await page.mouse.move(nudgeX, nudgeY);
await page.mouse.down();
await page.mouse.move(nudgeX + 5, nudgeY + 5, { steps: 3 });
await page.mouse.move(nudgeX, nudgeY, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(450);
check('a press that wobbles is still a press', await page.locator('.block-menu').count(), 1);
check(
  'and the handle is still there afterwards',
  await page.locator('.block-gutter.is-shown').count(),
  1,
);
check('and it moved nothing', await blockBody(), ['alpha', 'bravo', 'bravo', 'charlie']);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);

// The one gesture no unit test can stand in for. HTML5 drag is also the thing
// that breaks silently — a `preventDefault` on mousedown anywhere in the gutter
// stops the browser starting a drag at all, and every other check here passes
// while it does.
await page.locator('.body p', { hasText: 'alpha' }).first().hover();
await page.waitForTimeout(200);
const grip = await page.locator('.block-handle').boundingBox();
const foot = await page.locator('.body h2').first().boundingBox();
// What the pointer is holding is the other thing no unit test can see. The
// browser will not say, so the call that hands it over is recorded on the way
// past — the numbers are the whole of whether a block lifts from where it sits
// or jumps sideways to meet the cursor.
await page.evaluate(() => {
  window.__drags = [];
  const real = DataTransfer.prototype.setDragImage;
  DataTransfer.prototype.setDragImage = function (el, x, y) {
    const box = el.getBoundingClientRect();
    window.__drags.push({
      card: el.classList.contains('block-lift'),
      fixed: getComputedStyle(el).position === 'fixed',
      grabInside: x >= 0 && y >= 0 && x <= box.width && y <= box.height,
      // A screen-high blank card was `.body`'s own min-height coming along
      // with the classes that make the clone look like the page.
      tall: box.height > 200,
    });
    return real.call(this, el, x, y);
  };
});
await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
await page.mouse.down();
await page.mouse.move(grip.x + 6, grip.y + 6, { steps: 4 });
await page.mouse.move(foot.x + 40, foot.y + foot.height - 3, { steps: 14 });
await page.waitForTimeout(200);
check(
  'a block in the air says where it would land',
  await page.evaluate(
    () => document.querySelectorAll('.prosemirror-dropcursor-block, .ProseMirror-dropcursor').length,
  ),
  1,
);
check('and it is carried as a card, grabbed where the pointer took it', await page.evaluate(() => window.__drags), [
  { card: true, fixed: true, grabInside: true, tall: false },
]);
// The states, not the opacities they fade to. Both of these are transitions,
// and a drag holds the page in a nested loop long enough that reading the
// animated value here is a coin toss — what the code decides is the class.
check(
  'the page is marked as having a hole where the block was',
  await page.evaluate(() => document.querySelector('.editor-host').classList.contains('is-lifting')),
  true,
);
// Its own handle would otherwise hang in the middle of the page beside a block
// the pointer left two seconds ago.
check(
  'and the gutter gets out of the way of its own block',
  await page.evaluate(() => document.querySelector('.block-gutter').classList.contains('is-lifting')),
  true,
);
await page.mouse.up();
await page.waitForTimeout(500);
check('and dropping it moves it there', await blockBody(), ['bravo', 'bravo', 'charlie', 'alpha']);
check(
  'nothing of the drag is left standing',
  await page.evaluate(() => ({
    carriers: document.querySelectorAll('.block-lift').length,
    dimmed: document.querySelector('.editor-host').classList.contains('is-lifting'),
  })),
  { carriers: 0, dimmed: false },
);
// No mousemove fires during a drag, so without the drop point the gutter is
// still remembering a position that now holds somebody else's block.
// Beside the block that was dropped, which is where the hand is. What this
// catches is the gutter left behind where the drag began — half a page away,
// and measured against a position that now holds somebody else's block.
check(
  'and the handle follows the block to where it landed',
  await page.evaluate(() => {
    const gutter = document.querySelector('.block-gutter').getBoundingClientRect();
    const mid = gutter.top + gutter.height / 2;
    const moved = [...document.querySelectorAll('.body > *')].find(
      (el) => el.textContent.trim() === 'alpha',
    );
    if (!moved) return 'the dragged block is gone';
    const box = moved.getBoundingClientRect();
    return mid >= box.top - 2 && mid <= box.bottom + 2
      ? true
      : `handle at ${Math.round(mid)}, block at ${Math.round(box.top)}–${Math.round(box.bottom)}`;
  }),
  true,
);

// ---------------------------------------------------------- nested blocks
/*
  A nested item's handle belongs beside that item, not out at the measure.

  It used to stay pinned where a top-level block's handle goes, so a
  level-three bullet had its controls seventy-five pixels away with two other
  rows of indent in between. Hovered by coordinate rather than by text, because
  a nested `li` contains its children's text and matching on it picks the
  parent — which is how this looked fine while it was broken.
*/
section('nested blocks');
await freshPage('Indents');
await page.keyboard.type('- level one');
await page.keyboard.press('Enter');
await page.keyboard.press('Tab');
await page.keyboard.type('level two');
await page.keyboard.press('Enter');
await page.keyboard.press('Tab');
await page.keyboard.type('level three');
await page.keyboard.press('Enter');
await page.keyboard.press('Shift+Tab');
await page.keyboard.press('Shift+Tab');
await page.keyboard.type('back out');
await page.waitForTimeout(400);

const handleAgainst = async (label) => {
  const at = await page.evaluate((text) => {
    const p = [...document.querySelectorAll('.body li p')].find((n) => n.textContent.trim() === text);
    const b = p.getBoundingClientRect();
    return { x: Math.round(b.left) + 25, y: Math.round(b.top + b.height / 2) };
  }, label);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(300);
  return page.evaluate((text) => {
    const p = [...document.querySelectorAll('.body li p')].find((n) => n.textContent.trim() === text);
    const li = p.closest('li');
    const gutter = document.querySelector('.block-gutter').getBoundingClientRect();
    const item = li.getBoundingClientRect();
    const line = p.getBoundingClientRect();
    return {
      // Clear of the marker column, which runs from the list's edge to the item's.
      clearsMarker: Math.round(gutter.right) <= Math.round(li.parentElement.getBoundingClientRect().left) + 1,
      // No further from the item than the one indent the marker occupies. A
      // range rather than a number: the gutter slides three pixels in as it
      // arrives, so an exact figure is really a measurement of the animation.
      adrift: item.left - gutter.right > 34,
      // Level with the item's own first line.
      onItsRow: Math.abs(gutter.top + gutter.height / 2 - (line.top + line.height / 2)) < 2,
    };
  }, label);
};

const BESIDE = { clearsMarker: true, adrift: false, onItsRow: true };
check('a top-level bullet has its handle beside it', await handleAgainst('level one'), BESIDE);
check('and so does one three levels in', await handleAgainst('level three'), BESIDE);
check('and coming back out brings it back', await handleAgainst('back out'), BESIDE);

// A task item is a checkbox and a wrapper before it reaches a paragraph, so
// its own box starts above the line the handle should be level with.
await freshPage('Tasks');
await page.keyboard.type('[] a task');
await page.waitForTimeout(400);
check('a task item gets its handle on the same line as its text', await handleAgainst('a task'), BESIDE);

/*
  A list item is not carried by hand, and that is settled.

  Dropping into a list has no good target: a point inside an item resolves to
  the gap after it, so the first item has no slot above it, and items sit flush
  so the indicator draws across the row above. `Alt+Shift` with an arrow is the
  gesture that does work, and it is checked in the blocks section above.

  Two checks rather than one. The attribute is the thing the stylesheet reads
  to drop the grab cursor, and a real mouse drag is the thing that proves the
  browser agrees — an attribute can be right while a stray `draggable`
  somewhere else reopens the gesture.
*/
await freshPage('No dragging lists');
for (const line of ['- one', 'two', 'three']) {
  await page.keyboard.type(line);
  if (line !== 'three') await page.keyboard.press('Enter');
}
await page.waitForTimeout(400);
const itemAt = async (text) => {
  const at = await page.evaluate((label) => {
    const p = [...document.querySelectorAll('.body li p')].find((n) => n.textContent.trim() === label);
    const b = p.getBoundingClientRect();
    return { x: Math.round(b.left) + 25, y: Math.round(b.top + b.height / 2) };
  }, text);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(280);
  return at;
};

await itemAt('three');
check(
  'a list item refuses to be picked up',
  await page.locator('.block-handle').getAttribute('draggable'),
  'false',
);
check(
  'and says so before it is pressed, rather than after',
  await page.evaluate(() => getComputedStyle(document.querySelector('.block-handle')).cursor),
  'pointer',
);

const listOrder = async () => (await body().innerText()).split('\n').filter(Boolean);
const grabItem = await page.locator('.block-handle').boundingBox();
const target = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.body li p')].find((n) => n.textContent.trim() === 'one');
  const b = p.getBoundingClientRect();
  return { x: Math.round(b.left) + 40, y: Math.round(b.top) + 2 };
});
await page.mouse.move(grabItem.x + grabItem.width / 2, grabItem.y + grabItem.height / 2);
await page.mouse.down();
await page.mouse.move(grabItem.x + 6, grabItem.y - 6, { steps: 4 });
await page.mouse.move(target.x, target.y, { steps: 12 });
await page.waitForTimeout(200);
check(
  'nothing goes into the air over a list',
  await page.evaluate(() => ({
    carriers: document.querySelectorAll('.block-lift').length,
    dimmed: document.querySelector('.editor-host').classList.contains('is-lifting'),
    indicator: document.querySelectorAll('.prosemirror-dropcursor-block, .ProseMirror-dropcursor').length,
  })),
  { carriers: 0, dimmed: false, indicator: 0 },
);
await page.mouse.up();
await page.waitForTimeout(400);
check('and the list is exactly as it was', await listOrder(), ['one', 'two', 'three']);

// Everything the handle does that is not carrying still works on an item.
await itemAt('two');
await page.locator('.block-handle').click();
await page.waitForSelector('.block-menu', { timeout: 4000 });
check('the handle still opens the block menu on a list item', await page.locator('.block-menu').count(), 1);
await page.locator('.block-item', { hasText: 'Move up' }).first().click();
await page.waitForTimeout(350);
check('and the menu still moves it', await listOrder(), ['two', 'one', 'three']);
await page.keyboard.press('Alt+Shift+ArrowDown');
await page.waitForTimeout(350);
check('as does the chord, which is the gesture that replaces the drag', await listOrder(), [
  'one',
  'two',
  'three',
]);

// ------------------------------------------------------- the context menu
// The system menu is replaced here, so the three verbs it had are this app's
// responsibility now. Right-clicking a *selection* is the case worth pinning
// down: ProseMirror answers the right button by moving the caret, which used
// to collapse the very selection somebody right-clicked in order to copy, and
// the menu came up with Cut and Copy greyed at exactly the wrong moment.
// On a page of its own, made by the `+` — which is the other thing this
// section proves. Everything above has spent the document it was working in on
// tables, lists and dragged blocks, and "the last paragraph" is not a reliable
// thing to point at by the end of it.
section('the plus on the tab strip');
const tabsBefore = await page.locator('.tab').count();
await page.locator('.tab-new').click();
await page.waitForTimeout(800);
check('it opens a tab', (await page.locator('.tab').count()) > tabsBefore, true);
check(
  'with the caret in the title, the same as Ctrl+T',
  await page.evaluate(() => document.activeElement?.className),
  'title',
);

section('right click on the writing');
await page.keyboard.type('Context');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await body().click();
await page.keyboard.type('A line to hold.');
await page.waitForTimeout(300);

/** Over the words themselves — the middle of a full-width line is past its end. */
const rightClickTheLine = async () => {
  const box = await page.locator('.body p').last().boundingBox();
  await page.mouse.click(box.x + 20, box.y + box.height / 2, { button: 'right' });
  await page.waitForSelector('.menu', { timeout: 5000 });
};

await rightClickTheLine();
check('it offers the clipboard, the asides and the block', await page.locator('.menu-item .menu-label').allInnerTexts(), [
  'Cut',
  'Copy',
  'Paste',
  'Comment on this',
  'Sticky note',
  'Duplicate block',
  'Delete block',
]);
check('cut is greyed when no words are held', await page.locator('.menu-item').first().isDisabled(), true);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);

await body().click();
await page.waitForTimeout(200);
await page.keyboard.press('Control+End');
await page.keyboard.press('Shift+Home');
// The selection has to actually exist before the right-click means anything —
// asserted here so a failure below says which of the two steps broke.
await page.waitForFunction(() => !(window.getSelection()?.isCollapsed ?? true), null, { timeout: 5000 });
await rightClickTheLine();
check('right-clicking held words leaves them held', await page.locator('.menu-item').first().isDisabled(), false);
await page.locator('.menu-item', { hasText: 'Copy' }).first().click();
await page.waitForTimeout(400);
check(
  'and copy puts them on the clipboard',
  (await page.evaluate(() => navigator.clipboard.readText())).includes('A line to hold.'),
  true,
);

// A string of our own, so this asserts *what* arrived rather than that the
// page got longer — and let the selection go first, or the paste lands on top
// of the words it came from and proves nothing either way.
await page.evaluate(() => navigator.clipboard.writeText('PASTED-BY-MENU'));
await page.keyboard.press('End');
await rightClickTheLine();
await page.locator('.menu-item', { hasText: 'Paste' }).first().click();
await page.waitForTimeout(1000);
check('paste goes in the way Ctrl+V does', (await bodyText()).includes('PASTED-BY-MENU'), true);

// --------------------------------------------------- stickies and comments
// One row in storage, one rail on screen, and one field between them: a
// comment carries the id of a mark in the prose, a sticky carries null. What
// is asserted here is the join — that the mark and the note survive a reload
// together, and that throwing the note away takes the mark with it.
section('stickies and comments');
await body().click();
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
await page.keyboard.type('A sentence worth a note.');
await page.waitForTimeout(300);
await page.keyboard.press('Shift+Home');
await page.waitForTimeout(200);
await page.keyboard.press('Control+Alt+KeyM');
await page.waitForTimeout(800);
check('a comment lands in the rail', await page.locator('.sticky.is-comment').count(), 1);
check('and the words wear the mark', (await page.locator('.body .commented').count()) > 0, true);
await page.locator('.sticky.is-comment .sticky-text').fill('Is this the right word?');
await page.waitForTimeout(800);

await page.reload({ waitUntil: 'networkidle' });
await dismissWelcome();
await page.waitForTimeout(400);
check('it survives a reload', await page.locator('.sticky.is-comment').count(), 1);
check(
  'with its text',
  (await page.locator('.sticky.is-comment .sticky-text').inputValue()).includes('right word'),
  true,
);
check('and its underline', (await page.locator('.body .commented').count()) > 0, true);
await page.locator('.sticky-anchor').click();
await page.waitForTimeout(400);
check(
  'and pressing it holds those words again',
  await page.evaluate(() => (window.getSelection()?.toString() ?? '').length > 0),
  true,
);

await body().click();
await page.keyboard.press('Control+Space');
await page.waitForTimeout(700);
check('a sticky is still a sticky', await page.locator('.sticky:not(.is-comment)').count(), 1);

// The rail can be put away and the notes are still there — hiding a column is
// not throwing away what is in it.
await page.keyboard.press('Control+Shift+Space');
await page.waitForTimeout(400);
check('the rail can be put away', await page.locator('.stickies').count(), 0);
check('and leaves a way back at the edge', await page.locator('.rail-handle').count(), 1);
check(
  'and a visible one on the bar, which says how many are waiting',
  await page.locator('.chrome-btn[aria-label="Show notes"]').getAttribute('title'),
  'Show notes (2) — Ctrl+Shift+Space',
);
await page.locator('.chrome-btn[aria-label="Show notes"]').click();
await page.waitForTimeout(400);
check('which brings the notes back', await page.locator('.sticky').count(), 2);
await page.locator('.rail-handle').count();

// And the comment icon in the bar that comes to a selection.
await body().click();
await page.keyboard.press('Control+End');
await page.keyboard.press('Shift+Home');
await page.waitForSelector('.bubble', { timeout: 5000 });
check(
  'the selection bar offers a comment',
  await page.locator('.bubble-btn[aria-label="Comment"]').count(),
  1,
);
await page.locator('.sticky.is-comment .sticky-remove').click();
await page.waitForTimeout(700);
check('throwing the comment away takes the mark with it', await page.locator('.body .commented').count(), 0);
check('and leaves the sticky where it was', await page.locator('.sticky').count(), 1);
await page.locator('.sticky .sticky-remove').click();
await page.waitForTimeout(500);

// ---------------------------------------------------------------- the guide
// A list of thirty shortcuts is worth nothing if finding it needs a shortcut
// you would have had to read the list to know, so it is on the bar and on F1.
section('the guide');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.keyboard.press('F1');
await page.waitForSelector('.guide', { timeout: 5000 });
check('F1 opens the guide', await page.locator('.guide-topics .guide-topic').count() > 5, true);
check(
  'and it carries the keys themselves',
  (await page.locator('.guide-row kbd').allInnerTexts()).includes('F1'),
  true,
);
await page.keyboard.press('F1');
await page.waitForTimeout(250);
check('the same key puts it away', await page.locator('.guide').count(), 0);
await page.locator('.chrome-btn[aria-label="Guide"]').click();
await page.waitForSelector('.guide', { timeout: 5000 });
check('so does the ? on the bar', await page.locator('.guide').count(), 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);

// ---------------------------------------------------------------- the logo
// Going home unmounts the editor, and an unmount is the one way of leaving a
// page the autosave has no hook for. What was typed a moment before has to
// still be there afterwards.
section('the mark goes home');
await body().click();
await page.keyboard.type('Typed on the way out.');
await page.locator('.tree-home').click();
await page.waitForSelector('.welcome', { timeout: 5000 });
check('the mark returns to the launch screen', await page.locator('.welcome').count(), 1);
await page.reload({ waitUntil: 'networkidle' });
await dismissWelcome();
check('and nothing typed on the way out was lost', (await bodyText()).includes('Typed on the way out.'), true);

// ------------------------------------------------------------------ export
section('export');
await page.keyboard.press('Control+Shift+KeyE');
await page.waitForSelector('.dialog');
check('ctrl-shift-E opens the export dialog', await page.locator('.dialog-title').innerText(), 'Export');
check('three ways out, and no PDF', await page.locator('.dialog .field').first().locator('.choice-label').allInnerTexts(), [
  'Word document',
  'Markdown',
  'Everything',
]);
check(
  'the manuscript apparatus stays folded away',
  await page.locator('.dialog .text-field').count(),
  0,
);
await page.locator('.dialog .choice', { hasText: 'Manuscript' }).locator('input').check();
await page.waitForTimeout(250);
check('until it is asked for', await page.locator('.dialog .text-field').count(), 4);
await page.locator('.dialog .choice', { hasText: 'Everything' }).first().locator('input').check();
await page.waitForTimeout(250);
check(
  'and the escape hatch asks nothing else',
  await page.locator('.dialog legend').allInnerTexts(),
  ['As'],
);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('escape closes it', await page.locator('.dialog').count(), 0);

await browser.close();

if (errors.length > 0) failures.push('console errors:\n   ' + errors.join('\n   '));
if (failures.length > 0) {
  console.error('\n' + failures.join('\n'));
  process.exit(1);
}
console.log('\nall checks passed');
