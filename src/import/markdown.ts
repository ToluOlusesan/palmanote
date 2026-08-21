/**
 * Markdown to ProseMirror JSON — the mirror of `src/export/markdown.ts`.
 *
 * Deliberately small: it understands exactly what PalmaNote can represent
 * and quietly flattens everything else to prose. A parser that handled all of
 * CommonMark would produce nodes this schema has no place for, and the writer
 * would find them missing later. Better to be honest at the door.
 *
 * The rule underneath that, and the one most of this file exists to keep, is
 * that **the round trip is the specification**: anything the writer opposite
 * can emit, this has to read back as the document it started as, which means
 * the two files have to agree about escaping character for character. Several
 * things below are here only because they did not agree — see the notes on
 * paired punctuation, on `_`, and on how a line ending is told apart from a
 * line break.
 *
 * The second job is foreign markdown — a file written in any other editor —
 * and the two pull in different directions exactly once, at bare URLs. See
 * `inline`.
 */

import type { PMDoc, PMNode } from '../core/types.ts';
import { STICKER_IDS } from '../editor/stickerIds.ts';

interface FrontMatter {
  title: string | null;
  kind: string | null;
  icon: string | null;
}

export interface ParsedMarkdown {
  doc: PMDoc;
  front: FrontMatter;
  /** First heading, when there is no front matter to take a title from. */
  impliedTitle: string | null;
}

/** `[label]: href` definitions, by lowercased label. */
type Refs = Map<string, string>;

const NO_REFS: Refs = new Map();

/**
 * How many spaces a run of leading whitespace is worth.
 *
 * A tab is four, which is what every editor that writes tab-indented lists
 * means by one. Counting the prefix's `length` instead — which is what this
 * did — makes one tab worth one space, so a tab-indented sub-list sits at
 * indent 1 against its parent's 0 and nests correctly by luck; two levels
 * down it is worth 2 against a parent's 4 and climbs back out again.
 */
function indentWidth(prefix: string): number {
  let width = 0;
  for (const character of prefix) width += character === '\t' ? 4 : 1;
  return width;
}

export function parseMarkdown(source: string): ParsedMarkdown {
  // NUL is what a hard break is turned into before the inline pass, so a
  // document that arrived carrying one of its own has to lose it first or it
  // comes back with a line break nobody wrote.
  const normalised = source.replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  const { body, front } = splitFrontMatter(normalised);
  const { text, refs } = collectReferences(body);
  const blocks: PMNode[] = [];
  const lines = text.split('\n');
  let impliedTitle: string | null = null;
  let index = 0;

  const paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push(...paragraphBlocks(paragraph.join('\n'), refs));
    paragraph.length = 0;
  };

  while (index < lines.length) {
    const line = lines[index]!;

    if (line.trim().length === 0) {
      flush();
      index += 1;
      continue;
    }

    // Fences first: everything between them is content, not markdown, so no
    // other rule below may look at those lines. A fence closes only on one at
    // least as long as the one that opened it, which is what lets a block
    // containing ``` be written with ````.
    const fence = /^(\s*)(`{3,}|~{3,})\s*(\S*)\s*$/.exec(line);
    if (fence) {
      flush();
      const [, , delimiter = '```', language = ''] = fence;
      const marker = delimiter[0]!;
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const closing = new RegExp(`^\\s*${marker}{${delimiter.length},}\\s*$`);
        if (closing.test(lines[index]!)) {
          index += 1;
          break;
        }
        body.push(lines[index]!);
        index += 1;
      }
      blocks.push({
        type: 'codeBlock',
        attrs: { language: language || null },
        content: body.length > 0 ? [{ type: 'text', text: body.join('\n') }] : undefined,
      });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const text = heading[2]!.trim().replace(/\s+#+\s*$/, '');
      // A lone level-1 heading at the top is the document's title, not part of
      // its body — that is how our own export writes it.
      if (impliedTitle === null && blocks.length === 0 && heading[1]!.length === 1) {
        impliedTitle = unescape(text);
        index += 1;
        continue;
      }
      // Six levels in, three here. The clamp is the honest answer rather than
      // a silent one: this schema has three headings, so an `####` arrives as
      // the smallest of them rather than as a paragraph nobody can find later.
      blocks.push({
        type: 'heading',
        attrs: { level: Math.min(heading[1]!.length, 3) },
        content: inlineOnly(text, refs),
      });
      index += 1;
      continue;
    }

    // Setext: a rule of `=` or `-` *under* a line of text is a heading, and
    // this has to be asked before the scene break below it, because `---` is
    // both and which one it is depends entirely on whether anything is above
    // it. Getting the order wrong is what turned every underlined heading in a
    // foreign file into a paragraph followed by a scene break.
    const underline = /^(=+|-+)\s*$/.exec(line.trim());
    if (underline && paragraph.length > 0) {
      const level = underline[1]!.startsWith('=') ? 1 : 2;
      const text = paragraph.join('\n');
      paragraph.length = 0;
      if (level === 1 && impliedTitle === null && blocks.length === 0) {
        impliedTitle = unescape(text.trim());
      } else {
        blocks.push({ type: 'heading', attrs: { level }, content: inlineOnly(text, refs) });
      }
      index += 1;
      continue;
    }

    if (/^(\*\*\*|---|___)\s*$/.test(line.trim())) {
      flush();
      blocks.push({ type: 'sceneBreak' });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      flush();
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index]!)) {
        quoted.push(lines[index]!.replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', content: paragraphBlocks(quoted.join('\n'), refs) });
      continue;
    }

    // A pipe table, and only when the line under it is the delimiter row. That
    // second condition is the whole test: a sentence with a `|` in it is far
    // commoner than a table, and GFM says a table is a header, a rule and then
    // rows — so the rule is what makes the line above it a header rather than
    // prose. Asked before lists and before the paragraph fallback, both of
    // which would otherwise swallow the rows one line at a time.
    if (line.includes('|') && isDelimiterRow(lines[index + 1])) {
      flush();
      const [table, consumed] = readTable(lines, index, refs);
      blocks.push(table);
      index = consumed;
      continue;
    }

    const listMatch = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      flush();
      const [list, consumed] = readList(lines, index, refs);
      blocks.push(list);
      index = consumed;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }
  flush();

  return {
    doc: { type: 'doc', content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }] },
    front,
    impliedTitle,
  };
}

/**
 * A run of paragraph text, as the blocks it turns out to be.
 *
 * Usually one paragraph. An image makes it more than one, because an image is
 * a *block* in this schema rather than something that can sit in a sentence —
 * so `text ![shot](a.png) more` is three blocks, not one paragraph holding an
 * illegal child.
 *
 * The split happens out here rather than inside `inline` for one reason: only
 * the inline pass knows that an `![…](…)` written inside a code span is four
 * pieces of punctuation rather than a picture, because code is matched first
 * and swallows whatever is in it.
 */
function paragraphBlocks(source: string, refs: Refs): PMNode[] {
  const nodes = inline(softWrap(source), [], refs);
  if (!nodes.some((node) => node.type === 'image')) {
    return [{ type: 'paragraph', content: nodes }];
  }

  const out: PMNode[] = [];
  let run: PMNode[] = [];
  const close = () => {
    const trimmed = trimEdges(run);
    if (trimmed.length > 0) out.push({ type: 'paragraph', content: trimmed });
    run = [];
  };
  for (const node of nodes) {
    if (node.type === 'image') {
      close();
      out.push(node);
    } else {
      run.push(node);
    }
  }
  close();
  return out.length > 0 ? out : [{ type: 'paragraph' }];
}

/**
 * The whitespace either side of a picture belonged to the sentence, not to the
 * paragraph that is left once the picture has been lifted out of it.
 *
 * Copies rather than trimming in place: these nodes are the ones being
 * returned, and a helper that quietly edits its argument is the kind of thing
 * that only shows up when a second caller appears.
 */
function trimEdges(nodes: PMNode[]): PMNode[] {
  const out = nodes.map((node, at) => {
    if (node.type !== 'text') return node;
    let text = node.text ?? '';
    if (at === 0) text = text.replace(/^[ \t]+/, '');
    if (at === nodes.length - 1) text = text.replace(/[ \t]+$/, '');
    return { ...node, text };
  });
  return out.filter((node) => node.type !== 'text' || (node.text ?? '').length > 0);
}

/**
 * Inline content for the places that cannot hold a block.
 *
 * A heading and a list item are one line of prose each, so a picture written
 * into one has nowhere to go. It becomes its own alt text rather than
 * disappearing — the words the writer chose to describe it are better than a
 * gap, and better than a broken node the schema would drop on load.
 */
function inlineOnly(source: string, refs: Refs): PMNode[] {
  return inline(softWrap(source), [], refs).flatMap((node) => {
    if (node.type !== 'image') return [node];
    const alt = String(node.attrs?.alt ?? '');
    return alt.length > 0 ? [{ type: 'text', text: alt }] : [];
  });
}

/**
 * `| --- | :-: | ---: |` — the row that tells a table from a paragraph.
 *
 * The alignment colons are read and then thrown away, which is deliberate:
 * this schema has no alignment on a cell any more than it has one on a
 * paragraph, and accepting the syntax while ignoring what it asks for is
 * better than refusing to see a table because somebody centred a column.
 */
function isDelimiterRow(line: string | undefined): boolean {
  if (line === undefined) return false;
  const trimmed = line.trim();
  return trimmed.includes('-') && /^\|?[\s:|-]+\|?$/.test(trimmed) && trimmed.includes('|');
}

/**
 * A GFM pipe table, as far as this schema can hold one.
 *
 * Rows are squared off to the width of the header, which is GFM's own rule —
 * cells past it are dropped and missing ones are empty — and is also what
 * ProseMirror requires, since a table with a ragged row is not a table it will
 * load. A cell holds one paragraph: the pipe format has no way to say
 * otherwise, so there is nothing to lose by not trying.
 */
function readTable(lines: string[], start: number, refs: Refs): [PMNode, number] {
  const header = splitRow(lines[start]!);
  const width = header.length;
  const body: string[][] = [];
  let index = start + 2;

  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim().length === 0 || !line.includes('|')) break;
    body.push(splitRow(line));
    index += 1;
  }

  const row = (cells: string[], head: boolean): PMNode => ({
    type: 'tableRow',
    content: Array.from({ length: width }, (_, at) => {
      const content = inlineOnly(cells[at] ?? '', refs);
      return {
        type: head ? 'tableHeader' : 'tableCell',
        // An empty cell is an empty paragraph with no content key at all,
        // which is how ProseMirror writes one — and therefore what a document
        // has to come back as to equal the one it went out as.
        content: [content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }],
      };
    }),
  });

  // A header of nothing but empty cells is the one this writer puts above a
  // table that never had a header, so it is read back off rather than becoming
  // a row of blank boxes at the top of the table.
  const blank = header.every((cell) => cell.trim().length === 0);
  return [
    {
      type: 'table',
      content: blank
        ? body.map((cells) => row(cells, false))
        : [row(header, true), ...body.map((cells) => row(cells, false))],
    },
    index,
  ];
}

/**
 * One row into its cells.
 *
 * Split by hand rather than with `split('|')` because a cell is allowed to
 * contain a pipe as `\|`, which is what the writer opposite emits — and the
 * general unescape pass cannot help here, since it runs on the contents of a
 * cell long after the row has been cut into cells.
 */
function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  for (let at = 0; at < inner.length; at++) {
    const character = inner[at]!;
    if (character === '\\' && inner[at + 1] === '|') {
      current += '|';
      at += 1;
      continue;
    }
    if (character === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** Bullets, numbers and tasks, nested to the three levels the schema allows. */
function readList(lines: string[], start: number, refs: Refs): [PMNode, number] {
  const first = /^(\s*)([-*+]|\d+\.)\s+/.exec(lines[start]!)!;
  const baseIndent = indentWidth(first[1]!);
  const ordered = /\d/.test(first[2]!);
  const firstNumber = ordered ? Number.parseInt(first[2]!, 10) : 1;

  const items: PMNode[] = [];
  let index = start;
  let type: 'bulletList' | 'orderedList' | 'taskList' = ordered ? 'orderedList' : 'bulletList';

  while (index < lines.length) {
    const match = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[index]!);
    if (!match) break;
    const indent = indentWidth(match[1]!);
    if (indent < baseIndent) break;

    if (indent > baseIndent) {
      const [nested, consumed] = readList(lines, index, refs);
      const last = items.at(-1);
      if (last?.content) last.content.push(nested);
      index = consumed;
      continue;
    }

    const text = match[3]!;
    const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
    if (task) {
      type = 'taskList';
      const checked = task[1]!.toLowerCase() === 'x';
      items.push({
        type: 'taskItem',
        attrs: { checked },
        content: [{ type: 'paragraph', content: inlineOnly(task[2]!, refs) }],
      });
    } else {
      items.push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: inlineOnly(text, refs) }],
      });
    }
    index += 1;
  }

  // Task items cannot live in a bullet list, so the list takes their type.
  const itemType = type === 'taskList' ? 'taskItem' : 'listItem';
  for (const item of items) item.type = itemType;

  const list: PMNode = { type, content: items };
  // Only when it is not the default. The writer opposite reads `start ?? 1` and
  // omits the attribute at 1, so adding one unconditionally would give a
  // document that no longer equals the one it was written from.
  if (type === 'orderedList' && firstNumber !== 1) list.attrs = { start: firstNumber };
  return [list, index];
}

type Mark = { type: string; attrs?: Record<string, unknown> };

const STICKERS = STICKER_IDS.join('|');

/**
 * Code, links, pictures, stickers, bold, italic, strikethrough and highlight.
 * Everything else is text.
 *
 * Order in the alternation is precedence, and three of the places it matters:
 *
 * - **Code first**, because what is inside a code span is not markdown, so
 *   `` `**x**` `` is four asterisks and an x rather than something bold.
 *   `exec` takes the leftmost match, so a span opening before an emphasis
 *   marker swallows it.
 * - **Pictures before links.** `![alt](src)` matches the link rule perfectly
 *   well if it is asked first, which is what used to happen: every image in an
 *   imported file arrived as a stray `!` in front of a hyperlink.
 * - **`**` before `*`**, or every pair of asterisks is two empty italics.
 *
 * The lookbehinds are the other half of the agreement with the writer. It
 * escapes literal punctuation, and without them `\*not italic\*` comes back as
 * emphasis; both ends need checking, because an escaped closing delimiter is
 * not a closing delimiter.
 *
 * `_` additionally may not open or close against a word character, which is
 * CommonMark's rule and exists for exactly one reason: `some_variable_name`
 * is not a request for emphasis, and an app that holds shell commands and
 * snippets meets that far more often than it meets `_emphasis_`. `*` keeps no
 * such restriction, because intraword `*` is unambiguous.
 *
 * **Bare URLs are deliberately not linked.** `<https://…>` is markdown asking
 * for a link and is read as one; `https://…` sitting in a sentence is not, and
 * turning it into one would break the round trip in the one direction that
 * matters — a writer who deliberately unlinked a URL would find it linked
 * again every time the page went out to a file and came back. The editor
 * autolinks what is *typed*, which is where that decision belongs.
 */
function inline(source: string, inherited: Mark[] = [], refs: Refs = NO_REFS): PMNode[] {
  const out: PMNode[] = [];
  const pattern = new RegExp(
    [
      '(?<fence>`+)(?<code>[\\s\\S]+?)\\k<fence>',
      '(?<!\\\\)!\\[(?<imageAlt>[^\\]]*)\\]\\(\\s*(?:<(?<imageAngle>[^>]*)>|(?<imageBare>[^()\\s]*))(?:\\s+"[^"]*")?\\s*\\)',
      '(?<!\\\\)\\[(?<linkText>[^\\]]*)\\]\\(\\s*(?:<(?<linkAngle>[^>]*)>|(?<linkBare>[^()\\s]*))(?:\\s+"[^"]*")?\\s*\\)',
      '(?<!\\\\)\\[(?<refText>[^\\]]*)\\]\\[(?<refName>[^\\]]*)\\]',
      '(?<!\\\\)<(?<autolink>(?:https?:|mailto:)[^>\\s]+)>',
      '(?<!\\\\)\\*\\*(?<strongStar>.+?)(?<!\\\\)\\*\\*',
      '(?<![\\w\\\\])__(?<strongLine>.+?)(?<!\\\\)__(?!\\w)',
      '(?<!\\\\)\\*(?<emStar>.+?)(?<!\\\\)\\*',
      '(?<![\\w\\\\])_(?<emLine>.+?)(?<!\\\\)_(?!\\w)',
      '(?<!\\\\)~~(?<strike>.+?)(?<!\\\\)~~',
      '(?<!\\\\)==(?<mark>.+?)(?<!\\\\)==',
      `:(?<sticker>${STICKERS}):`,
      '(?<hard>\\u0000)',
    ].join('|'),
    'g',
  );
  let last = 0;
  let match: RegExpExecArray | null;

  const push = (text: string, marks: Mark[] = []) => {
    if (text.length === 0) return;
    const all = [...inherited, ...marks];
    out.push(all.length > 0 ? { type: 'text', text, marks: all } : { type: 'text', text });
  };

  /** Re-reads the contents of a delimiter with one more mark in hand. */
  const nest = (inner: string, mark: Mark) => {
    out.push(...inline(inner, [...inherited, mark], refs));
  };

  while ((match = pattern.exec(source)) !== null) {
    const groups = match.groups ?? {};
    push(unescape(source.slice(last, match.index)));

    if (groups.code !== undefined) {
      // Not unescaped, and no other mark: a code span is what it says it is.
      // Markdown strips one space either side of a fenced span, which is how
      // a span whose code starts with a backtick is written at all.
      push(groups.code.replace(/^ (.*) $/s, '$1'), [{ type: 'code' }]);
    } else if (groups.imageAlt !== undefined) {
      // Carries the path it was written with rather than an asset id. This
      // parser is a pure string-to-JSON function with no filesystem and no
      // store; `resolveImages` in ./index.ts is what turns a path into bytes
      // into an id, once the rest of the chosen files are in hand.
      out.push({
        type: 'image',
        attrs: {
          src: decodeSrc(groups.imageAngle ?? groups.imageBare ?? ''),
          alt: unescape(groups.imageAlt),
        },
      });
    } else if (groups.linkText !== undefined) {
      const href = decodeSrc(groups.linkAngle ?? groups.linkBare ?? '');
      // The link mark goes on whatever the text turns out to be, so
      // `[**bold**](url)` comes back bold *and* linked — which is how the
      // exporter writes it, link outermost.
      const marks: Mark[] = href ? [{ type: 'link', attrs: { href } }] : [];
      out.push(...inline(groups.linkText, [...inherited, ...marks], refs));
    } else if (groups.refText !== undefined) {
      // `[text][label]`, and `[text][]` where the text is its own label.
      const label = (groups.refName || groups.refText).trim().toLowerCase();
      const href = refs.get(label) ?? '';
      const marks: Mark[] = href ? [{ type: 'link', attrs: { href } }] : [];
      out.push(...inline(groups.refText, [...inherited, ...marks], refs));
    } else if (groups.autolink !== undefined) {
      push(groups.autolink, [{ type: 'link', attrs: { href: groups.autolink } }]);
    }
    // Emphasis recurses rather than pushing its contents as flat text, so a
    // run carrying two marks — `**[linked](url)**`, `*==both==*` — comes back
    // carrying both rather than losing the inner one.
    else if (groups.strongStar !== undefined) nest(groups.strongStar, { type: 'bold' });
    else if (groups.strongLine !== undefined) nest(groups.strongLine, { type: 'bold' });
    else if (groups.emStar !== undefined) nest(groups.emStar, { type: 'italic' });
    else if (groups.emLine !== undefined) nest(groups.emLine, { type: 'italic' });
    else if (groups.strike !== undefined) nest(groups.strike, { type: 'strike' });
    else if (groups.mark !== undefined) {
      // Markdown cannot say which colour; everything arrives as the first one.
      nest(groups.mark, { type: 'highlight', attrs: { tone: 'yellow' } });
    } else if (groups.sticker !== undefined) {
      // The shortcode the writer opposite puts down. Only the nine ids that
      // ship are matched, so a time of `12:30:45` and a `:)` stay as they were.
      out.push({ type: 'sticker', attrs: { id: groups.sticker } });
    } else if (groups.hard !== undefined) out.push({ type: 'hardBreak' });

    last = pattern.lastIndex;
  }
  push(unescape(source.slice(last)));
  return out;
}

/** `%20` and friends, where the address survives being decoded. */
function decodeSrc(raw: string): string {
  try {
    return decodeURI(raw);
  } catch {
    return raw;
  }
}

/**
 * Line endings, settled before anything else looks at them.
 *
 * Markdown has two kinds and tells them apart by trailing whitespace, which is
 * invisible: two or more spaces before the newline — or a backslash — is a
 * *hard* break the writer asked for, and any other wrap is a *soft* one, which
 * is how a file wrapped at eighty columns says nothing at all.
 *
 * This reader used to make a `hardBreak` of every newline, which was wrong
 * twice. A paragraph from any other editor arrived as a column of short lines;
 * and because the rule matched the newline but not the two spaces in front of
 * it, our own hard breaks came back with those spaces welded to the end of the
 * text — so a page went out to a file and came back subtly heavier every time.
 *
 * A hard break becomes NUL so the inline pattern can still find it once the
 * whitespace around it is gone. `parseMarkdown` strips any NUL the document
 * brought with it before this runs.
 */
function softWrap(source: string): string {
  return source.replace(/(?:[ \t]{2,}|\\)\n/g, '\u0000').replace(/[ \t]*\n[ \t]*/g, ' ');
}

/**
 * The inverse of the writer's escaping, and it has to stay the inverse.
 *
 * The two sets disagreed for a while — `=` and `~` were unescaped here and
 * never escaped there — which meant a sentence with a literal `~~` or `==` in
 * it came back struck through or highlighted. See `PAIRED` in the writer.
 */
function unescape(text: string): string {
  return text.replace(/\\([\\`*_[\]#=~])/g, '$1');
}

/**
 * `[label]: https://…  "title"` lines, lifted out of the body.
 *
 * A definition is not content — it is the address half of a link written
 * somewhere else in the file — so leaving them in puts a line of punctuation
 * in the middle of the prose. Fences are tracked while scanning, because a
 * line that looks like a definition inside a code block is code.
 */
function collectReferences(body: string): { text: string; refs: Refs } {
  const refs: Refs = new Map();
  const kept: string[] = [];
  let fence: string | null = null;

  for (const line of body.split('\n')) {
    const edge = /^\s*(`{3,}|~{3,})/.exec(line);
    if (edge) {
      const delimiter = edge[1]!;
      if (fence === null) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = null;
      kept.push(line);
      continue;
    }
    if (fence === null) {
      const definition =
        /^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]*)>|(\S+))\s*(?:"[^"]*"|'[^']*'|\([^)]*\))?\s*$/.exec(line);
      if (definition) {
        refs.set(definition[1]!.trim().toLowerCase(), definition[2] ?? definition[3] ?? '');
        continue;
      }
    }
    kept.push(line);
  }

  return { text: kept.join('\n'), refs };
}

function splitFrontMatter(source: string): { body: string; front: FrontMatter } {
  const front: FrontMatter = { title: null, kind: null, icon: null };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { body: source, front };

  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (!pair) continue;
    const key = pair[1]!;
    let value = pair[2]!.trim();
    if (/^".*"$/.test(value)) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        value = value.slice(1, -1);
      }
    }
    if (key === 'title') front.title = value;
    if (key === 'kind') front.kind = value;
    if (key === 'icon') front.icon = value;
  }
  return { body: source.slice(match[0].length), front };
}
