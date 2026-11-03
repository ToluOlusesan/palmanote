import type { PMDoc, PMNode } from '../core/types.ts';

/**
 * Reading a Word document into the editor's own schema.
 *
 * This replaced mammoth for .docx, and the reason is the round trip. Mammoth
 * turns a Word file into clean HTML, which is its whole purpose, and clean
 * means it drops what this app now keeps: colour, size, alignment and — unless
 * asked — underline. Once a .docx can be opened, edited and saved back over
 * itself, a reader that loses those is a reader that damages the file a little
 * more on every save. So this walks Word's own XML and maps each thing onto the
 * node or mark that means the same, and it is written as the mirror of
 * export/docx.ts: whatever that writes, this reads back as the same document.
 *
 * Pure and dependency-free on purpose. The zip is read with the platform's own
 * `DecompressionStream`, and the XML with the small parser below rather than
 * `DOMParser`, which Node does not have — so the round trip is a unit test and
 * not something that can only be checked in a browser.
 *
 * What is not read: headers and footers, footnotes, comments, tracked changes
 * (the document is read as it currently stands), text boxes and shapes, and
 * fonts. A family is the theme's to choose here, and a document full of
 * Calibri does not need to say so.
 */

export interface ReadDocx {
  doc: PMDoc;
  /** Picture bytes by the path the image nodes carry, for the importer to store. */
  images: Map<string, Uint8Array>;
  /** The document's own title, when Word recorded one. */
  title: string | null;
}

// ------------------------------------------------------------------- zip

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Every file in a zip, by name. Stored and deflated entries; nothing else is in a .docx. */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('That file is not a Word document.');

  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    files.set(name, method === 8 ? await inflate(raw) : raw.slice());
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

// ------------------------------------------------------------------- xml

interface El {
  name: string;
  attrs: Record<string, string>;
  children: (El | string)[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

/**
 * Enough XML for Office Open XML: elements, attributes, text, self-closing
 * tags. Comments, processing instructions and CDATA are skipped or kept as
 * text; Word writes none of them inside a body.
 */
export function parseXml(source: string): El {
  const root: El = { name: '#root', attrs: {}, children: [] };
  const stack: El[] = [root];
  const tag = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(source)) !== null) {
    const top = stack[stack.length - 1]!;
    if (match.index > last) top.children.push(decode(source.slice(last, match.index)));
    last = tag.lastIndex;
    if (match[5] !== undefined) {
      top.children.push(match[5]);
      continue;
    }
    if (!match[2]) continue;
    if (match[1]) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const attr of (match[3] ?? '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[attr[1]!] = decode(attr[2] ?? attr[3] ?? '');
    }
    const element: El = { name: match[2], attrs, children: [] };
    top.children.push(element);
    if (!match[4]) stack.push(element);
  }
  return root;
}

const elements = (el: El | undefined): El[] => (el ? el.children.filter((c): c is El => typeof c !== 'string') : []);
const child = (el: El | undefined, name: string): El | undefined => elements(el).find((c) => c.name === name);
const all = (el: El | undefined, name: string): El[] => elements(el).filter((c) => c.name === name);

/** Every descendant with this name, in document order. */
function deep(el: El | undefined, name: string, out: El[] = []): El[] {
  for (const c of elements(el)) {
    if (c.name === name) out.push(c);
    deep(c, name, out);
  }
  return out;
}

/** A Word on/off property: present means on, unless it says otherwise. */
function on(el: El | undefined): boolean {
  if (!el) return false;
  const value = el.attrs['w:val'];
  return value === undefined || !['0', 'false', 'off', 'none'].includes(value.toLowerCase());
}

// ------------------------------------------------------------ the document

type Mark = NonNullable<PMNode['marks']>[number];

interface Context {
  rels: Map<string, string>;
  /** numId → level → bullet or ordered. */
  numbering: Map<string, Map<number, 'bulletList' | 'orderedList'>>;
  images: Map<string, Uint8Array>;
  media: Map<string, Uint8Array>;
  /** The body size Word falls back to, in half-points; a run at it says nothing. */
  defaultSize: number | null;
}

const HIGHLIGHT_TONES: Record<string, string> = {
  yellow: 'yellow',
  green: 'green',
  brightGreen: 'green',
  darkGreen: 'green',
  cyan: 'blue',
  blue: 'blue',
  darkBlue: 'blue',
  darkCyan: 'blue',
  red: 'red',
  darkRed: 'red',
  magenta: 'red',
  darkMagenta: 'red',
};

function relationships(xml: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!xml) return out;
  for (const rel of deep(parseXml(xml), 'Relationship')) {
    if (rel.attrs.Id && rel.attrs.Target) out.set(rel.attrs.Id, rel.attrs.Target);
  }
  return out;
}

function numberingOf(xml: string | undefined): Context['numbering'] {
  const out: Context['numbering'] = new Map();
  if (!xml) return out;
  const root = child(parseXml(xml), 'w:numbering');
  const abstracts = new Map<string, Map<number, 'bulletList' | 'orderedList'>>();
  for (const abstract of all(root, 'w:abstractNum')) {
    const levels = new Map<number, 'bulletList' | 'orderedList'>();
    for (const lvl of all(abstract, 'w:lvl')) {
      const format = child(lvl, 'w:numFmt')?.attrs['w:val'] ?? 'bullet';
      levels.set(Number(lvl.attrs['w:ilvl'] ?? 0), format === 'bullet' || format === 'none' ? 'bulletList' : 'orderedList');
    }
    abstracts.set(abstract.attrs['w:abstractNumId'] ?? '', levels);
  }
  for (const num of all(root, 'w:num')) {
    const levels = abstracts.get(child(num, 'w:abstractNumId')?.attrs['w:val'] ?? '');
    if (levels) out.set(num.attrs['w:numId'] ?? '', levels);
  }
  return out;
}

function defaultSizeOf(xml: string | undefined): number | null {
  if (!xml) return null;
  const defaults = child(child(child(child(parseXml(xml), 'w:styles'), 'w:docDefaults'), 'w:rPrDefault'), 'w:rPr');
  const size = Number(child(defaults, 'w:sz')?.attrs['w:val']);
  return Number.isFinite(size) && size > 0 ? size : null;
}

function marksOf(rPr: El | undefined, context: Context): Mark[] {
  const marks: Mark[] = [];
  if (!rPr) return marks;
  if (on(child(rPr, 'w:b'))) marks.push({ type: 'bold' });
  if (on(child(rPr, 'w:i'))) marks.push({ type: 'italic' });
  const underline = child(rPr, 'w:u');
  if (underline && (underline.attrs['w:val'] ?? 'single') !== 'none') marks.push({ type: 'underline' });
  if (on(child(rPr, 'w:strike')) || on(child(rPr, 'w:dstrike'))) marks.push({ type: 'strike' });

  const style = child(rPr, 'w:rStyle')?.attrs['w:val'];
  const font = child(rPr, 'w:rFonts')?.attrs['w:ascii'] ?? '';
  if (style === 'HTMLCode' || /^(consolas|courier( new)?|cascadia (mono|code))$/i.test(font)) {
    marks.push({ type: 'code' });
    // Code takes no other mark in this schema.
    return marks.filter((mark) => mark.type === 'code');
  }

  const highlight = child(rPr, 'w:highlight')?.attrs['w:val'];
  if (highlight && HIGHLIGHT_TONES[highlight]) marks.push({ type: 'highlight', attrs: { tone: HIGHLIGHT_TONES[highlight] } });

  const colourValue = child(rPr, 'w:color')?.attrs['w:val'];
  const color = colourValue && /^[0-9a-f]{6}$/i.test(colourValue) && colourValue !== '000000' ? `#${colourValue.toLowerCase()}` : null;
  const half = Number(child(rPr, 'w:sz')?.attrs['w:val']);
  const fontSize = Number.isFinite(half) && half > 0 && half !== context.defaultSize ? `${half / 2}pt` : null;
  if (color || fontSize) marks.push({ type: 'textStyle', attrs: { color, fontSize } });
  return marks;
}

function alignmentOf(pPr: El | undefined): string | null {
  switch (child(pPr, 'w:jc')?.attrs['w:val']) {
    case 'center':
      return 'center';
    case 'right':
    case 'end':
      return 'right';
    case 'both':
    case 'distribute':
      return 'justify';
    default:
      return null;
  }
}

/** The inline content of a paragraph, and any pictures it held, which are blocks here. */
function inlineOf(paragraph: El, context: Context): { content: PMNode[]; pictures: PMNode[] } {
  const content: PMNode[] = [];
  const pictures: PMNode[] = [];

  const push = (text: string, marks: Mark[]) => {
    if (!text) return;
    const previous = content[content.length - 1];
    // Word splits runs for reasons of its own — a spell-check boundary, an
    // edit session. Runs that came out identical are one run here.
    if (previous?.type === 'text' && JSON.stringify(previous.marks ?? []) === JSON.stringify(marks)) {
      previous.text = (previous.text ?? '') + text;
      return;
    }
    content.push(marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text });
  };

  const run = (r: El, extra: Mark[]) => {
    const marks = [...marksOf(child(r, 'w:rPr'), context), ...extra];
    for (const part of elements(r)) {
      if (part.name === 'w:t') push(part.children.filter((c): c is string => typeof c === 'string').join(''), marks);
      else if (part.name === 'w:tab') push('\t', marks);
      else if ((part.name === 'w:br' && part.attrs['w:type'] !== 'page') || part.name === 'w:cr') {
        content.push({ type: 'hardBreak' });
      } else if (part.name === 'w:drawing' || part.name === 'w:pict') {
        const blip = deep(part, 'a:blip')[0] ?? deep(part, 'v:imagedata')[0];
        const target = context.rels.get(blip?.attrs['r:embed'] ?? blip?.attrs['r:id'] ?? '');
        if (!target) continue;
        const path = target.startsWith('/') ? target.slice(1) : `word/${target}`;
        const bytes = context.media.get(path);
        if (!bytes) continue;
        context.images.set(path, bytes);
        const description = deep(part, 'wp:docPr')[0]?.attrs.descr ?? '';
        pictures.push({ type: 'image', attrs: { src: path, alt: description } });
      }
    }
  };

  const walk = (el: El, extra: Mark[]) => {
    for (const part of elements(el)) {
      if (part.name === 'w:r') run(part, extra);
      else if (part.name === 'w:hyperlink') {
        const href = context.rels.get(part.attrs['r:id'] ?? '');
        walk(part, href ? [...extra, { type: 'link', attrs: { href } }] : extra);
      } else if (part.name === 'w:ins' || part.name === 'w:smartTag' || part.name === 'w:sdt' || part.name === 'w:sdtContent' || part.name === 'w:fldSimple') {
        walk(part, extra);
      }
      // w:del is text that was deleted under tracked changes: not read.
    }
  };
  walk(paragraph, []);
  return { content, pictures };
}

const plain = (nodes: PMNode[]) => nodes.map((n) => n.text ?? '').join('');

/**
 * Turns the flat run of list paragraphs Word stores into nested lists.
 *
 * `open[d]` is the list currently being filled at depth d. A paragraph can go
 * at most one level deeper than the deepest list open — Word allows a jump
 * from level 0 to 3, a tree does not — and never past the three levels the
 * editor nests to.
 */
function nestLists(items: { level: number; type: string; item: PMNode }[]): PMNode[] {
  const top: PMNode[] = [];
  const open: PMNode[] = [];
  for (const { level, type, item } of items) {
    const depth = Math.min(level, open.length, 2);
    open.length = Math.min(open.length, depth + 1);
    let list = open[depth];
    if (!list || list.type !== type) {
      list = { type, content: [] };
      if (depth === 0) top.push(list);
      else open[depth - 1]!.content!.at(-1)!.content!.push(list);
      open[depth] = list;
    }
    list.content!.push(item);
  }
  return top;
}

function blocksOf(body: El, context: Context): PMNode[] {
  const out: PMNode[] = [];
  let listRun: { level: number; type: string; item: PMNode }[] = [];
  let quoteRun: PMNode[] = [];
  let codeRun: string[] = [];

  const flush = () => {
    if (listRun.length) out.push(...nestLists(listRun));
    if (quoteRun.length) out.push({ type: 'blockquote', content: quoteRun });
    if (codeRun.length) out.push({ type: 'codeBlock', content: codeRun.join('\n') ? [{ type: 'text', text: codeRun.join('\n') }] : [] });
    listRun = [];
    quoteRun = [];
    codeRun = [];
  };

  for (const el of elements(body)) {
    if (el.name === 'w:sdt') {
      flush();
      out.push(...blocksOf(child(el, 'w:sdtContent') ?? el, context));
      continue;
    }
    if (el.name === 'w:tbl') {
      flush();
      out.push(tableOf(el, context));
      continue;
    }
    if (el.name !== 'w:p') continue;

    const pPr = child(el, 'w:pPr');
    const style = (child(pPr, 'w:pStyle')?.attrs['w:val'] ?? '').replace(/\s+/g, '').toLowerCase();
    const { content, pictures } = inlineOf(el, context);
    const textAlign = alignmentOf(pPr);
    const attrs = textAlign ? { textAlign } : undefined;
    const text = plain(content);

    // Code: one Word paragraph per line, which is how the exporter writes it.
    if (style === 'htmlpreformatted') {
      if (listRun.length || quoteRun.length) flush();
      codeRun.push(text);
      continue;
    }
    if (codeRun.length) flush();

    const numPr = child(pPr, 'w:numPr');
    const numId = child(numPr, 'w:numId')?.attrs['w:val'];
    const task = /^([☐☒])\s/.exec(text);
    if ((numId && numId !== '0') || (style === 'listparagraph' && task)) {
      if (quoteRun.length) flush();
      const level = Number(child(numPr, 'w:ilvl')?.attrs['w:val'] ?? 0);
      if (task && style === 'listparagraph') {
        // The exporter's task: a list paragraph opening on a ballot box.
        const indent = Number(child(pPr, 'w:ind')?.attrs['w:left'] ?? 360);
        const first = content[0];
        if (first?.text) first.text = first.text.slice(2);
        listRun.push({
          level: Math.max(0, Math.round((indent - 360) / 360)),
          type: 'taskList',
          item: { type: 'taskItem', attrs: { checked: task[1] === '☒' }, content: [{ type: 'paragraph', attrs, content: content.filter((n) => n.text !== '') }] },
        });
      } else {
        const type = context.numbering.get(numId ?? '')?.get(level) ?? 'bulletList';
        listRun.push({ level, type, item: { type: 'listItem', content: [{ type: 'paragraph', attrs, content }] } });
      }
      continue;
    }
    if (listRun.length) flush();

    if (style === 'quote' || style === 'intensequote') {
      quoteRun.push({ type: 'paragraph', attrs, content });
      continue;
    }
    if (quoteRun.length) flush();

    const heading = /^(?:heading(\d)|title)$/.exec(style);
    if (heading) {
      const level = Math.min(3, Math.max(1, Number(heading[1] ?? 1)));
      out.push({ type: 'heading', attrs: { level, ...(textAlign ? { textAlign } : {}) }, content });
    } else if (text === '#' && textAlign === 'center' && content.length === 1) {
      // The exporter's scene break.
      out.push({ type: 'sceneBreak' });
    } else if (content.length > 0 || pictures.length === 0) {
      out.push(attrs ? { type: 'paragraph', attrs, content } : { type: 'paragraph', content });
    }
    out.push(...pictures);
  }
  flush();
  return out;
}

function tableOf(table: El, context: Context): PMNode {
  const rows = all(table, 'w:tr').map((tr) => {
    const header = on(child(child(tr, 'w:trPr'), 'w:tblHeader'));
    return {
      type: 'tableRow',
      content: all(tr, 'w:tc').map((tc) => {
        const span = Number(child(child(tc, 'w:tcPr'), 'w:gridSpan')?.attrs['w:val'] ?? 1);
        const body = blocksOf(tc, context);
        return {
          type: header ? 'tableHeader' : 'tableCell',
          attrs: { colspan: span, rowspan: 1, colwidth: null },
          content: body.length > 0 ? body : [{ type: 'paragraph', content: [] }],
        };
      }),
    };
  });
  return { type: 'table', content: rows.filter((row) => row.content.length > 0) };
}

/** A .docx, as the document this app would have written for it. */
export async function readDocx(bytes: Uint8Array): Promise<ReadDocx> {
  const files = await unzip(bytes);
  const text = (name: string) => {
    const file = files.get(name);
    return file ? new TextDecoder().decode(file) : undefined;
  };
  const main = text('word/document.xml');
  if (!main) throw new Error('That file is not a Word document.');

  const context: Context = {
    rels: relationships(text('word/_rels/document.xml.rels')),
    numbering: numberingOf(text('word/numbering.xml')),
    images: new Map(),
    media: files,
    defaultSize: defaultSizeOf(text('word/styles.xml')),
  };
  const body = child(child(parseXml(main), 'w:document'), 'w:body');
  const content = body ? blocksOf(body, context) : [];

  const core = text('docProps/core.xml');
  const title = core ? deep(parseXml(core), 'dc:title')[0]?.children.join('').trim() || null : null;

  return {
    doc: { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }] },
    images: context.images,
    title,
  };
}
