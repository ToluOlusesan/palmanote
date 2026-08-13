/**
 * The whole interface, as vectors.
 *
 * A tool, not a feature — it lives in scripts/ and nothing under src/ imports
 * it, so it is never in the bundle and never in the installer. It is loaded
 * into the running app by scripts/capture-ui.mjs, over the dev server.
 *
 * What it is for: getting the app out as artwork that can be animated, when
 * there is no Figma file to animate from. So it draws the window the way the
 * window is drawn — sidebar, tabs, chrome, the sheet, the status bar — and
 * hands back one SVG with named layers.
 *
 * It renders from the *screen* rather than from any model of the app, and has
 * to: where a line breaks, how wide a row is, which tab is active and what the
 * theme resolved to are all facts about the laid-out window. So it measures
 * the live DOM — `Range.getClientRects()` for text, `getBoundingClientRect`
 * for everything else — and writes what the browser actually drew.
 *
 * The output is aimed at a design tool. Text stays text rather than being
 * converted to outlines, so it is still editable on the other side; icons come
 * across as their own paths; every block gets a `<g>` with `id` and
 * `data-name`, which is what Figma and Illustrator turn into layer names.
 *
 * Known to be missing: box shadows, CSS filters, and `::before`/`::after`
 * content. The first two are effects a motion tool would rather apply itself,
 * and the third carries nothing but decoration in this app.
 */

/** Chrome that exists only to be pointed at, and never reads as artwork. */
const SKIP = [
  '.drag-region',
  '.ProseMirror-gapcursor',
  '.ProseMirror-trailingBreak',
  '.caret',
  '[data-svg-skip]',
].join(', ');

/**
 * Layer names worth having. Anything not named here falls back to its tag, so
 * a new part of the interface shows up as `Group 4` rather than not at all.
 */
const NAMES = [
  ['.workspace', 'Window'],
  ['.tree-head', 'Sidebar header'],
  ['.tree-list', 'Page list'],
  ['.tree-foot', 'Sidebar footer'],
  ['.favourites', 'Favourites'],
  ['.archive', 'Archive'],
  ['.tree', 'Sidebar'],
  ['.topstrip', 'Top bar'],
  ['.tabstrip', 'Tab strip'],
  ['.tab', 'Tab'],
  ['.wincontrol', 'Window control'],
  ['.chrome-btn', 'Chrome button'],
  ['.pagebar', 'Page bar'],
  ['.crumbs', 'Breadcrumbs'],
  ['.toolbar', 'Toolbar'],
  ['.tool', 'Tool'],
  ['.navbtn', 'Nav button'],
  ['.status', 'Status bar'],
  ['.sheet', 'Sheet'],
  ['.title', 'Title'],
  ['.backlinks', 'Backlinks'],
  ['.cover', 'Cover'],
  ['.row-title', 'Row title'],
  ['.row', 'Row'],
  ['.editor-host', 'Card'],
  ['.scene-break', 'Scene break'],

  // The insert menu, and the row-with-a-heading it repeats.
  ['.slash-group', 'Menu group'],
  ['.slash-item', 'Menu item'],
  ['.slash', 'Insert menu'],
  ['.menu-hint', 'Menu hint'],

  // The landing screen.
  ['.welcome-greeting', 'Greeting'],
  ['.welcome-question', 'Question'],
  ['.welcome-field', 'Name field'],
  ['.welcome-starts', 'Suggestions'],
  ['.welcome-start', 'Suggestion'],
  ['.welcome-skip', 'Skip'],
  ['.welcome-inner', 'Welcome panel'],
  ['.welcome', 'Welcome'],
];

const TAGS = {
  P: 'Paragraph',
  H1: 'Heading 1',
  H2: 'Heading 2',
  H3: 'Heading 3',
  H4: 'Heading 4',
  LI: 'Item',
  PRE: 'Code',
  BLOCKQUOTE: 'Quote',
  UL: 'List',
  OL: 'List',
  HR: 'Rule',
  BUTTON: 'Button',
  HEADER: 'Header',
  FOOTER: 'Footer',
  NAV: 'Nav',
  MAIN: 'Main',
  INPUT: 'Field',
};

export const UI_DEFAULTS = { padding: 0, background: true };

/* ------------------------------------------------------------------ entry */

export async function svgFromUI(root, options = {}) {
  const { padding, background } = { ...UI_DEFAULTS, ...options };
  const frame = root.getBoundingClientRect();
  const roots = await collect(root, { clip: frame, opacity: 1, ellipsis: false });

  if (!roots.some(holds)) throw new Error('Nothing on screen to capture.');

  // The window's own box, not the extent of what was drawn: a screenshot of an
  // interface that has been shrink-wrapped to its content is not a screenshot
  // of that interface.
  const width = Math.ceil(frame.width + padding * 2);
  const height = Math.ceil(frame.height + padding * 2);
  const dx = padding - frame.left;
  const dy = padding - frame.top;

  const clips = new Map();
  const body = renderAll(roots, dx, dy, clips, frame, 1);

  const canvas = getComputedStyle(root).backgroundColor;
  const backdrop =
    background && visible(canvas)
      ? `  <rect id="Background" data-name="Background" x="0" y="0" width="${width}" height="${height}" fill="${canvas}"/>\n`
      : '';

  const defs =
    clips.size > 0
      ? `  <defs>\n${[...clips.values()].map((clip) => `    ${clip}`).join('\n')}\n  </defs>\n`
      : '';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`,
    defs + backdrop + body,
    '</svg>',
    '',
  ].join('\n');
}

/* ------------------------------------------------------------ collecting */

async function collect(root, start) {
  const roots = [];
  const open = [];

  // Groups nest the way the interface nests, so a toolbar arrives as a toolbar
  // with its tools inside it. Flat layers would animate one at a time and
  // never as a unit, which is most of what a moving interface does.
  const push = (kind, context) => {
    const block = {
      kind,
      lines: [],
      shapes: [],
      children: [],
      clip: context.clip,
      opacity: context.opacity,
    };
    (open[open.length - 1]?.children ?? roots).push(block);
    open.push(block);
    return block;
  };
  const current = (context) => open[open.length - 1] ?? push('Group', context);

  const visit = async (node, context) => {
    if (node.nodeType === Node.TEXT_NODE) {
      addText(current(context), node, context);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches(SKIP)) return;

    const style = getComputedStyle(node);
    const opacity = context.opacity * Number(style.opacity || 1);
    if (style.display === 'none' || style.visibility === 'hidden' || opacity < 0.01) return;

    const rect = node.getBoundingClientRect();
    // Scrolled out of its own container, or off the window entirely. Culling
    // beats clipping here: a list of two hundred rows should not arrive as two
    // hundred layers of which eight can be seen.
    if (rect.width > 0 && rect.height > 0 && !intersects(rect, context.clip)) return;

    // An <svg> in the page is already artwork. It comes across whole rather
    // than being walked as if it were markup.
    if (node.namespaceURI === 'http://www.w3.org/2000/svg') {
      if (node.tagName.toLowerCase() === 'svg') drawIcon(current(context), node, style);
      return;
    }

    const clips = !(
      style.overflow === 'visible' &&
      style.overflowX === 'visible' &&
      style.overflowY === 'visible'
    );
    const inner = {
      opacity,
      // Anything that scrolls or hides its overflow narrows what its children
      // are allowed to occupy, and that is inherited the rest of the way down.
      clip: clips ? intersection(context.clip, rect) : context.clip,
      // Where a label is cut short with an ellipsis rather than simply hidden,
      // the words below have to be cut to match — the DOM still holds all of
      // them. See `addText`.
      ellipsis: clips && style.textOverflow === 'ellipsis' ? true : context.ellipsis,
    };

    // Present to a screen reader, absent to everyone else: `.visually-hidden`
    // and its kind collapse to a pinhole and hide the overflow. Nothing inside
    // one is on screen, so nothing inside one is artwork.
    if (inner.clip.width < 2 || inner.clip.height < 2) return;

    if (node.tagName === 'INPUT') {
      if (node.type === 'checkbox' || node.type === 'radio') drawCheckbox(current(context), node, style);
      else drawField(push(nameOf(node), inner), node, style), open.pop();
      return;
    }
    if (node.tagName === 'IMG') {
      await drawImage(current(context), node);
      return;
    }

    const opened = isBlock(node, style) ? push(nameOf(node), inner) : null;
    const target = opened ?? current(context);

    drawDecoration(target, node, style, inner);
    if (node.tagName === 'LI') drawMarker(target, node);

    for (const child of node.childNodes) await visit(child, inner);
    if (opened) open.pop();
  };

  await visit(root, start);
  return roots;
}

/** Anything that starts its own stack of lines, or is worth a layer of its own. */
function isBlock(node, style) {
  if (style.display === 'inline' || style.display === 'contents') return false;
  if (TAGS[node.tagName]) return true;
  return NAMES.some(([selector]) => node.matches(selector));
}

function nameOf(node) {
  const named = NAMES.find(([selector]) => node.matches(selector));
  if (named) return named[1];
  return TAGS[node.tagName] ?? 'Group';
}

/* ------------------------------------------------------------------ text */

function addText(block, node, context) {
  if (!node.data.trim()) return;
  const parent = node.parentElement;
  if (!parent) return;

  const style = styleOf(parent);
  const { ascent } = metricsFor(style);

  for (const piece of linesOf(node)) {
    if (!intersects(piece.rect, context.clip)) continue;
    const baseline = piece.rect.top + ascent;
    const run = { text: piece.text, x: piece.rect.left, width: piece.rect.width, baseline, style };

    // A tab label reading "What's the latest you've be…" holds the whole title
    // in the DOM; only the browser knows it drew an ellipsis. Rebuild the cut
    // rather than let the full string run out across its neighbours.
    if (context.ellipsis && piece.rect.right > context.clip.right + 0.5) {
      const room = context.clip.right - piece.rect.left;
      if (room <= 0) continue;
      run.text = elide(piece.text, style, room);
      run.width = room;
      if (!run.text) continue;
    }
    // Runs sharing a baseline are the same drawn line even when they came from
    // different text nodes — a bold word mid-sentence is two nodes and one
    // line, and animating it as two lines would look like a stutter.
    const line = block.lines.find((candidate) => Math.abs(candidate.top - baseline) < 1);
    if (line) line.runs.push(run);
    else block.lines.push({ top: baseline, runs: [run] });
  }
}

/**
 * Splits a text node into the lines the browser broke it into, with a tight
 * rect for each.
 *
 * The whole-node rect list already gives the geometry; what it does not say is
 * which characters landed on which line. So walk the characters once and cut
 * wherever the top jumps. Collapsed whitespace measures as nothing and is
 * carried along to the next line.
 */
function linesOf(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
  if (rects.length === 0) return [];
  if (rects.length === 1) return [{ text: node.data, rect: rects[0] }];

  const data = node.data;
  const cuts = [];
  let top = null;

  for (let i = 0; i < data.length; i += 1) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const rect = range.getClientRects()[0];
    if (!rect || rect.width === 0) continue;
    if (top === null || Math.abs(rect.top - top) > 1) {
      top = rect.top;
      cuts.push(i);
    }
  }

  const pieces = [];
  for (let index = 0; index < cuts.length; index += 1) {
    const from = cuts[index];
    const to = cuts[index + 1] ?? data.length;
    // The space a line broke on belongs to neither line once it is drawn.
    const text = data.slice(from, to).replace(/\s+$/, '');
    if (!text) continue;
    range.setStart(node, from);
    range.setEnd(node, from + text.length);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0) pieces.push({ text, rect });
  }
  return pieces;
}

/**
 * A field's value, centred in its box the way the browser centres it — or its
 * placeholder, in the placeholder's own colour, because an empty search box
 * that says nothing does not read as a search box.
 */
function drawField(block, input, computed) {
  const showing = input.value || input.placeholder;
  if (!showing) return;
  const rect = input.getBoundingClientRect();
  const style = styleOf(input);
  if (!input.value) {
    style.fill = getComputedStyle(input, '::placeholder').color || style.fill;
  }
  const { ascent, descent } = metricsFor(style);
  const inset = parseFloat(computed.paddingLeft) + parseFloat(computed.borderLeftWidth);
  block.lines.push({
    top: rect.top,
    runs: [
      {
        text: showing,
        x: rect.left + (Number.isFinite(inset) ? inset : 0),
        width: measure(showing, style),
        baseline: rect.top + (rect.height - ascent - descent) / 2 + ascent,
        style,
      },
    ],
  });
}

/* ---------------------------------------------------------------- shapes */

/** Panels, borders and rules — the parts of the interface that are drawn. */
function drawDecoration(block, node, style, context) {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const fill = style.backgroundColor;
  if (visible(fill)) {
    block.shapes.push({
      kind: 'rect',
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      radius: radiiOf(style),
      fill,
      opacity: context.opacity,
    });
  }

  // Sides separately rather than one stroked rect: most rules in this
  // interface are a single edge — a sidebar's right border, a status bar's top
  // one, a blockquote's left rule.
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    const width = parseFloat(style[`border${side}Width`]);
    const colour = style[`border${side}Color`];
    if (!width || !visible(colour)) continue;
    block.shapes.push({
      kind: 'rect',
      x: side === 'Right' ? rect.right - width : rect.left,
      y: side === 'Bottom' ? rect.bottom - width : rect.top,
      width: side === 'Left' || side === 'Right' ? width : rect.width,
      height: side === 'Top' || side === 'Bottom' ? width : rect.height,
      radius: [0, 0, 0, 0],
      fill: colour,
      opacity: context.opacity,
    });
  }
}

/**
 * An icon is already vector art. Rather than redraw it, its own children are
 * lifted out and placed — scaled from the viewBox to the size it is drawn at,
 * with `currentColor` resolved, since outside the document that word means
 * nothing.
 */
function drawIcon(block, svg, style) {
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const box = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const [minX, minY, boxWidth, boxHeight] = box.length === 4 ? box : [0, 0, rect.width, rect.height];
  if (!boxWidth || !boxHeight) return;

  const clone = svg.cloneNode(true);
  const colour = style.color;
  for (const node of [clone, ...clone.querySelectorAll('*')]) {
    for (const attribute of ['fill', 'stroke']) {
      if (node.getAttribute(attribute) === 'currentColor') node.setAttribute(attribute, colour);
    }
    node.removeAttribute('class');
  }

  const art = [...clone.childNodes]
    .filter((node) => node.nodeType === Node.ELEMENT_NODE)
    .map((node) => node.outerHTML)
    .join('');
  if (!art) return;

  block.shapes.push({
    kind: 'icon',
    x: rect.left,
    y: rect.top,
    scaleX: rect.width / boxWidth,
    scaleY: rect.height / boxHeight,
    minX,
    minY,
    // An icon drawn with no explicit fill inherits it, and `currentColor` is
    // the usual default, so state it once on the group.
    fill: colour,
    art,
  });
}

/**
 * List markers are `::marker` pseudo-elements: no node, no range, nothing to
 * measure. A bulleted list is rebuilt as a disc rather than as the bullet
 * character, which is a good deal smaller and differs by typeface. Numbers
 * really are text and stay text.
 */
function drawMarker(block, li) {
  const list = li.parentElement;
  if (!list || list.getAttribute('data-type') === 'taskList') return;
  if (getComputedStyle(list).listStyleType === 'none') return;

  const rect = li.getBoundingClientRect();
  const style = styleOf(li);
  const { ascent } = metricsFor(style);
  const baseline = rect.top + ascent;

  if (list.tagName !== 'OL') {
    const radius = style.size * 0.175;
    block.shapes.push({
      kind: 'disc',
      x: rect.left - style.size * 0.38 - radius,
      y: baseline - style.size * 0.31,
      radius,
      fill: style.fill,
    });
    return;
  }

  const items = [...list.children].filter((child) => child.tagName === 'LI');
  const text = `${(Number(list.getAttribute('start')) || 1) + items.indexOf(li)}.`;
  const width = measure(text, style);
  block.lines.push({
    top: baseline,
    runs: [{ text, x: rect.left - width - style.size * 0.35, width, baseline, style }],
  });
}

function drawCheckbox(block, input, style) {
  const rect = input.getBoundingClientRect();
  if (rect.width === 0) return;
  block.shapes.push({
    kind: 'box',
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    radius: input.type === 'radio' ? rect.width / 2 : 3,
    fill: input.checked ? style.color : 'none',
    stroke: visible(style.borderTopColor) ? style.borderTopColor : style.color,
  });
  if (!input.checked || input.type === 'radio') return;
  const { left: x, top: y, width: w } = rect;
  block.shapes.push({
    kind: 'path',
    points: [
      [x + w * 0.24, y + w * 0.52],
      [x + w * 0.43, y + w * 0.7],
      [x + w * 0.76, y + w * 0.32],
    ],
    stroke: '#ffffff',
    width: 1.6,
  });
}

async function drawImage(block, img) {
  const rect = img.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const href = await inline(img);
  if (!href) return;
  block.shapes.push({
    kind: 'image',
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    href,
    fit: getComputedStyle(img).objectFit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet',
  });
}

/**
 * Pictures travel inside the file as data URIs — a blob URL means nothing
 * outside the window that made it, and an SVG that only renders on the machine
 * that made it is not a capture.
 *
 * Blobs are repainted through a canvas rather than fetched. The pixels are
 * already decoded and on screen, so it needs no permission, and the desktop
 * build's `connect-src` does not allow reading a `blob:` back. Everything else
 * is same-origin and read as bytes, which keeps the original encoding.
 */
async function inline(img) {
  const src = img.currentSrc || img.src;
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  if (src.startsWith('blob:')) return repaint(img);
  try {
    const blob = await (await fetch(src)).blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return repaint(img);
  }
}

function repaint(img) {
  if (!img.complete || !img.naturalWidth || !img.naturalHeight) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    // A picture that cannot be read is left out rather than drawn as a hole.
    return null;
  }
}

/* --------------------------------------------------------------- writing */

/** Whether a block draws anything, itself or anywhere beneath it. */
function holds(block) {
  return block.lines.length > 0 || block.shapes.length > 0 || block.children.some(holds);
}

/**
 * Siblings, numbered within their parent — `Tool 1`…`Tool 10` inside `Toolbar
 * 1` rather than counted across the whole window. Empty groups are dropped
 * before numbering, so nothing spends a number on nothing.
 */
function renderAll(blocks, dx, dy, clips, frame, depth) {
  const counts = new Map();
  return blocks
    .filter(holds)
    .map((block) => {
      const next = (counts.get(block.kind) ?? 0) + 1;
      counts.set(block.kind, next);
      return renderBlock(block, `${block.kind} ${next}`, dx, dy, clips, frame, depth);
    })
    .join('\n');
}

function renderBlock(block, name, dx, dy, clips, frame, depth) {
  const pad = '  '.repeat(depth + 1);
  const parts = block.shapes.map((shape) => renderShape(shape, dx, dy));

  [...block.lines]
    .sort((a, b) => a.top - b.top)
    .forEach((line, index) => {
      const runs = [...line.runs].sort((a, b) => a.x - b.x);
      const lead = runs[0];
      if (!lead) return;
      const label = `${name} — line ${index + 1}`;
      const spans = runs
        .map((run, position) =>
          position === 0
            ? escapeXml(run.text)
            : `<tspan x="${round(run.x + dx)}"${styleAttrs(run.style, lead.style)}>${escapeXml(run.text)}</tspan>`,
        )
        .join('');
      parts.push(
        `<text id="${slug(label)}" data-name="${escapeXml(label)}" x="${round(lead.x + dx)}" ` +
          `y="${round(lead.baseline + dy)}" xml:space="preserve"${styleAttrs(lead.style)}>${spans}</text>`,
      );
    });

  // Only the containers that actually hold something back get a clip. Putting
  // one on every group would be correct and unreadable.
  const attrs = [`id="${slug(name)}"`, `data-name="${escapeXml(name)}"`];
  if (block.clip && tighterThan(block.clip, frame) && overflows(block, block.clip)) {
    attrs.push(`clip-path="url(#${clipFor(block.clip, clips, dx, dy)})"`);
  }

  // The block's own paint first, then whatever sits inside it — a panel drawn
  // after its contents would cover them.
  const own = parts.map((part) => `${pad}${part}`).join('\n');
  const nested = renderAll(block.children, dx, dy, clips, frame, depth + 1);
  const inner = [own, nested].filter(Boolean).join('\n');
  return `${'  '.repeat(depth)}<g ${attrs.join(' ')}>\n${inner}\n${'  '.repeat(depth)}</g>`;
}

function clipFor(rect, clips, dx, dy) {
  const id = `clip-${Math.round(rect.left)}-${Math.round(rect.top)}-${Math.round(rect.width)}-${Math.round(rect.height)}`;
  if (!clips.has(id)) {
    clips.set(
      id,
      `<clipPath id="${id}"><rect x="${round(rect.left + dx)}" y="${round(rect.top + dy)}" ` +
        `width="${round(rect.width)}" height="${round(rect.height)}"/></clipPath>`,
    );
  }
  return id;
}

function renderShape(shape, dx, dy) {
  const alpha = shape.opacity !== undefined && shape.opacity < 0.999 ? ` opacity="${round(shape.opacity)}"` : '';
  switch (shape.kind) {
    case 'rect': {
      const [tl, tr, br, bl] = shape.radius;
      // One radius covers almost everything; the few corners that disagree —
      // a card, a tab — need the path, because `rx` cannot say it.
      const corners = tl === tr && tr === br && br === bl ? (tl ? ` rx="${round(tl)}"` : '') : null;
      if (corners !== null) {
        return (
          `<rect x="${round(shape.x + dx)}" y="${round(shape.y + dy)}" width="${round(shape.width)}" ` +
          `height="${round(shape.height)}"${corners} fill="${shape.fill}"${alpha}/>`
        );
      }
      return `<path d="${roundedPath(shape, dx, dy)}" fill="${shape.fill}"${alpha}/>`;
    }
    case 'box':
      return (
        `<rect x="${round(shape.x + dx)}" y="${round(shape.y + dy)}" width="${round(shape.width)}" ` +
        `height="${round(shape.height)}" rx="${round(shape.radius)}" fill="${shape.fill}" ` +
        `stroke="${shape.stroke}" stroke-width="1"/>`
      );
    case 'disc':
      return `<circle cx="${round(shape.x + dx)}" cy="${round(shape.y + dy)}" r="${round(shape.radius)}" fill="${shape.fill}"/>`;
    case 'path': {
      const d = shape.points
        .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${round(x + dx)} ${round(y + dy)}`)
        .join(' ');
      return (
        `<path d="${d}" stroke="${shape.stroke}" stroke-width="${shape.width}" fill="none" ` +
        'stroke-linecap="round" stroke-linejoin="round"/>'
      );
    }
    case 'icon': {
      const move = `translate(${round(shape.x + dx)} ${round(shape.y + dy)})`;
      const scale =
        shape.scaleX === 1 && shape.scaleY === 1 ? '' : ` scale(${round4(shape.scaleX)} ${round4(shape.scaleY)})`;
      const origin = shape.minX || shape.minY ? ` translate(${round(-shape.minX)} ${round(-shape.minY)})` : '';
      return `<g transform="${move}${scale}${origin}" fill="${shape.fill}">${shape.art}</g>`;
    }
    case 'image':
      return (
        `<image x="${round(shape.x + dx)}" y="${round(shape.y + dy)}" width="${round(shape.width)}" ` +
        `height="${round(shape.height)}" preserveAspectRatio="${shape.fit}" href="${shape.href}"/>`
      );
    default:
      return '';
  }
}

function roundedPath(shape, dx, dy) {
  const x = shape.x + dx;
  const y = shape.y + dy;
  const w = shape.width;
  const h = shape.height;
  const half = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = shape.radius.map((radius) => Math.min(radius, half));
  return (
    `M${round(x + tl)} ${round(y)}H${round(x + w - tr)}` +
    (tr ? `A${round(tr)} ${round(tr)} 0 0 1 ${round(x + w)} ${round(y + tr)}` : '') +
    `V${round(y + h - br)}` +
    (br ? `A${round(br)} ${round(br)} 0 0 1 ${round(x + w - br)} ${round(y + h)}` : '') +
    `H${round(x + bl)}` +
    (bl ? `A${round(bl)} ${round(bl)} 0 0 1 ${round(x)} ${round(y + h - bl)}` : '') +
    `V${round(y + tl)}` +
    (tl ? `A${round(tl)} ${round(tl)} 0 0 1 ${round(x + tl)} ${round(y)}` : '') +
    'Z'
  );
}

/**
 * Only what differs from what is already in force — the parent <text> for a
 * tspan, and SVG's own defaults for the rest. Writing `font-style="normal"` on
 * every line would be true and useless, and a design tool shows it as an
 * override on every layer.
 */
function styleAttrs(style, inherited) {
  const out = [];
  const put = (name, value, standing) => {
    if (value !== standing) out.push(` ${name}="${value}"`);
  };

  if (!inherited || inherited.family !== style.family) out.push(` font-family="${escapeXml(style.family)}"`);
  if (!inherited || round(inherited.size) !== round(style.size)) out.push(` font-size="${round(style.size)}"`);
  if (!inherited || inherited.fill !== style.fill) out.push(` fill="${style.fill}"`);

  put('font-weight', style.weight, inherited ? inherited.weight : '400');
  put('font-style', style.italic ? 'italic' : 'normal', inherited ? (inherited.italic ? 'italic' : 'normal') : 'normal');
  put('letter-spacing', round(style.letterSpacing), inherited ? round(inherited.letterSpacing) : 0);
  put('text-decoration', decorationOf(style), inherited ? decorationOf(inherited) : 'none');
  return out.join('');
}

function decorationOf(style) {
  const parts = [style.underline && 'underline', style.strike && 'line-through'].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/* ----------------------------------------------------------------- style */

function styleOf(element) {
  const computed = getComputedStyle(element);
  const spacing = parseFloat(computed.letterSpacing);
  const decoration = computed.textDecorationLine;
  return {
    family: resolveFamily(computed.fontFamily),
    size: parseFloat(computed.fontSize),
    weight: computed.fontWeight,
    italic: computed.fontStyle === 'italic' || computed.fontStyle.startsWith('oblique'),
    letterSpacing: Number.isFinite(spacing) ? spacing : 0,
    fill: computed.color,
    underline: decoration.includes('underline'),
    strike: decoration.includes('line-through'),
  };
}

function radiiOf(style) {
  return [
    parseFloat(style.borderTopLeftRadius) || 0,
    parseFloat(style.borderTopRightRadius) || 0,
    parseFloat(style.borderBottomRightRadius) || 0,
    parseFloat(style.borderBottomLeftRadius) || 0,
  ];
}

/**
 * A design tool handed the whole CSS stack takes the first name in it whether
 * or not that font exists on the machine, which on Windows means artwork
 * marked up in Apple metrics and drawn in something else. So walk the stack
 * the way the browser did and write down the one that actually answered.
 *
 * `document.fonts.check` is no use for this — it reports whether the text
 * *can* be drawn, and with fallback it always can. The only honest test is to
 * measure.
 */
const GENERIC = new Set([
  'system-ui',
  'sans-serif',
  'serif',
  'monospace',
  'ui-monospace',
  'ui-sans-serif',
  'ui-serif',
  'cursive',
  'fantasy',
]);

const families = new Map();
function resolveFamily(stack) {
  const cached = families.get(stack);
  if (cached) return cached;
  const names = stack.split(',').map((name) => name.trim().replace(/^["']|["']$/g, ''));
  const found =
    names.find((name) => {
      // `-apple-system` and friends name a platform default rather than a
      // file, and mean nothing to a design tool.
      if (!name || name.startsWith('-')) return false;
      return GENERIC.has(name) || installed(name);
    }) ??
    names[0] ??
    'sans-serif';
  families.set(stack, found);
  return found;
}

/** Absent by construction, so it always falls through to the default face. */
const ABSENT = '"__palmanote_no_such_family__"';

function installed(name) {
  const ctx = context();
  if (!ctx) return false;
  const probe = 'mmmwwwiiilll0123OØ';
  ctx.font = `72px ${ABSENT}`;
  const fallback = ctx.measureText(probe).width;
  ctx.font = `72px "${name}", ${ABSENT}`;
  // A font that is not there falls through to exactly the same face, and so
  // measures to exactly the same width.
  return Math.abs(ctx.measureText(probe).width - fallback) > 0.01;
}

/**
 * Where the baseline sits inside a Range rect. The rect is the font's content
 * box, so the ascent measured for that exact font and size lands on it.
 */
const metrics = new Map();
let scratch;

function context() {
  if (scratch === undefined) scratch = document.createElement('canvas').getContext('2d');
  return scratch;
}

function metricsFor(style) {
  const font = `${style.italic ? 'italic ' : ''}${style.weight} ${style.size}px "${style.family}"`;
  const cached = metrics.get(font);
  if (cached) return cached;

  const ctx = context();
  let result = { ascent: style.size * 0.8, descent: style.size * 0.2 };
  if (ctx) {
    ctx.font = font;
    const measured = ctx.measureText('Hxg');
    if (measured.fontBoundingBoxAscent) {
      result = { ascent: measured.fontBoundingBoxAscent, descent: measured.fontBoundingBoxDescent };
    }
  }
  metrics.set(font, result);
  return result;
}

/**
 * The longest prefix of `text` that fits in `room` with an ellipsis after it —
 * what the browser drew when it cut a label short. Binary search rather than a
 * character-at-a-time walk, because a long title in a narrow tab is a lot of
 * measuring otherwise.
 */
function elide(text, style, room) {
  if (measure(text, style) <= room) return text;
  const mark = '…';
  const markWidth = measure(mark, style);
  if (markWidth > room) return '';

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(text.slice(0, mid), style) + markWidth <= room) low = mid;
    else high = mid - 1;
  }
  // Cutting mid-word leaves a stray space against the ellipsis.
  return low > 0 ? text.slice(0, low).replace(/\s+$/, '') + mark : '';
}

/** For the runs that have no Range to measure: field values and markers. */
function measure(text, style) {
  const ctx = context();
  if (!ctx) return text.length * style.size * 0.5;
  ctx.font = `${style.italic ? 'italic ' : ''}${style.weight} ${style.size}px "${style.family}"`;
  return ctx.measureText(text).width + style.letterSpacing * text.length;
}

/* --------------------------------------------------------------- tidying */

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function intersection(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  return new DOMRect(left, top, Math.max(0, Math.min(a.right, b.right) - left), Math.max(0, Math.min(a.bottom, b.bottom) - top));
}

function tighterThan(clip, frame) {
  return (
    clip.left > frame.left + 0.5 ||
    clip.top > frame.top + 0.5 ||
    clip.right < frame.right - 0.5 ||
    clip.bottom < frame.bottom - 0.5
  );
}

/** Whether anything in the block actually crosses its clip, and so needs one. */
function overflows(block, clip) {
  for (const line of block.lines) {
    for (const run of line.runs) {
      const { ascent, descent } = metricsFor(run.style);
      if (
        run.x < clip.left - 0.5 ||
        run.x + run.width > clip.right + 0.5 ||
        run.baseline - ascent < clip.top - 0.5 ||
        run.baseline + descent > clip.bottom + 0.5
      ) {
        return true;
      }
    }
  }
  for (const shape of block.shapes) {
    if (shape.kind === 'path' || shape.kind === 'disc') continue;
    if (
      shape.x < clip.left - 0.5 ||
      shape.y < clip.top - 0.5 ||
      shape.x + (shape.width ?? 0) > clip.right + 0.5 ||
      shape.y + (shape.height ?? 0) > clip.bottom + 0.5
    ) {
      return true;
    }
  }
  return false;
}

function visible(colour) {
  if (!colour || colour === 'transparent') return false;
  const alpha = /rgba?\([^)]*,\s*([\d.]+)\s*\)/.exec(colour);
  return !alpha || Number(alpha[1]) > 0.01;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Figma and Illustrator name a layer from `id`, which has to be a valid one. */
function slug(label) {
  const cleaned = label
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `n-${cleaned}`;
}
