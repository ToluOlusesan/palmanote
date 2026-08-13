/**
 * Markdown to ProseMirror JSON — the mirror of `src/export/markdown.ts`.
 *
 * Deliberately small: it understands exactly what PalmaNote can represent
 * and quietly flattens everything else to prose. A parser that handled all of
 * CommonMark would produce nodes this schema has no place for, and the writer
 * would find them missing later. Better to be honest at the door.
 */

import type { PMDoc, PMNode } from '../core/types.ts';

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

export function parseMarkdown(source: string): ParsedMarkdown {
  const { body, front } = splitFrontMatter(source);
  const blocks: PMNode[] = [];
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  let impliedTitle: string | null = null;
  let index = 0;

  const paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', content: inline(paragraph.join('\n')) });
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
      const level = Math.min(heading[1]!.length, 3);
      const text = heading[2]!.trim();
      // A lone level-1 heading at the top is the document's title, not part of
      // its body — that is how our own export writes it.
      if (impliedTitle === null && blocks.length === 0 && heading[1]!.length === 1) {
        impliedTitle = text;
        index += 1;
        continue;
      }
      blocks.push({ type: 'heading', attrs: { level }, content: inline(text) });
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
      blocks.push({
        type: 'blockquote',
        content: [{ type: 'paragraph', content: inline(quoted.join('\n')) }],
      });
      continue;
    }

    const listMatch = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      flush();
      const [list, consumed] = readList(lines, index);
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

/** Bullets, numbers and tasks, nested to the three levels the schema allows. */
function readList(lines: string[], start: number): [PMNode, number] {
  const first = /^(\s*)([-*+]|\d+\.)\s+/.exec(lines[start]!)!;
  const baseIndent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);

  const items: PMNode[] = [];
  let index = start;
  let type: 'bulletList' | 'orderedList' | 'taskList' = ordered ? 'orderedList' : 'bulletList';

  while (index < lines.length) {
    const match = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[index]!);
    if (!match) break;
    const indent = match[1]!.length;
    if (indent < baseIndent) break;

    if (indent > baseIndent) {
      const [nested, consumed] = readList(lines, index);
      const last = items.at(-1);
      if (last?.content) last.content.push(nested);
      index = consumed;
      continue;
    }

    let text = match[3]!;
    const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
    if (task) {
      type = 'taskList';
      const checked = task[1]!.toLowerCase() === 'x';
      items.push({
        type: 'taskItem',
        attrs: { checked },
        content: [{ type: 'paragraph', content: inline(task[2]!) }],
      });
    } else {
      items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(text) }] });
    }
    index += 1;
  }

  // Task items cannot live in a bullet list, so the list takes their type.
  const itemType = type === 'taskList' ? 'taskItem' : 'listItem';
  for (const item of items) item.type = itemType;

  return [{ type, content: items }, index];
}

type Mark = { type: string; attrs?: Record<string, unknown> };

/**
 * Code, links, bold, italic, strikethrough and highlight. Everything else is
 * text.
 *
 * Order in the alternation is precedence, and code comes first for the reason
 * it exists: what is inside a code span is not markdown, so `` `**x**` `` is
 * four asterisks and an x rather than something bold. `exec` takes the
 * leftmost match, so a span opening before an emphasis marker swallows it.
 *
 * The lookbehinds matter: the exporter escapes literal punctuation, and
 * without them `\*not italic\*` comes back as emphasis. Both ends need
 * checking — an escaped closing delimiter is not a closing delimiter.
 */
function inline(source: string, inherited: Mark[] = []): PMNode[] {
  const out: PMNode[] = [];
  const pattern = new RegExp(
    [
      '(?<fence>`+)(?<code>[\\s\\S]+?)\\k<fence>',
      '(?<!\\\\)\\[(?<linkText>[^\\]]*)\\]\\((?:<(?<linkAngle>[^>]*)>|(?<linkBare>[^()\\s]*))\\)',
      '(?<!\\\\)(?<strongFence>\\*\\*|__)(?<strong>.+?)(?<!\\\\)\\k<strongFence>',
      '(?<!\\\\)(?<emFence>\\*|_)(?<em>.+?)(?<!\\\\)\\k<emFence>',
      '(?<!\\\\)~~(?<strike>.+?)(?<!\\\\)~~',
      '(?<!\\\\)==(?<mark>.+?)(?<!\\\\)==',
      '(?<br>\\n)',
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
    out.push(...inline(inner, [...inherited, mark]));
  };

  while ((match = pattern.exec(source)) !== null) {
    const groups = match.groups ?? {};
    push(unescape(source.slice(last, match.index)));

    if (groups.code !== undefined) {
      // Not unescaped, and no other mark: a code span is what it says it is.
      // Markdown strips one space either side of a fenced span, which is how
      // a span whose code starts with a backtick is written at all.
      push(groups.code.replace(/^ (.*) $/s, '$1'), [{ type: 'code' }]);
    } else if (groups.linkText !== undefined) {
      const href = groups.linkAngle ?? groups.linkBare ?? '';
      // The link mark goes on whatever the text turns out to be, so
      // `[**bold**](url)` comes back bold *and* linked — which is how the
      // exporter writes it, link outermost.
      const marks: Mark[] = href ? [{ type: 'link', attrs: { href } }] : [];
      out.push(...inline(groups.linkText, [...inherited, ...marks]));
    }
    // Emphasis recurses rather than pushing its contents as flat text, so a
    // run carrying two marks — `**[linked](url)**`, `*==both==*` — comes back
    // carrying both rather than losing the inner one.
    else if (groups.strong !== undefined) nest(groups.strong, { type: 'bold' });
    else if (groups.em !== undefined) nest(groups.em, { type: 'italic' });
    else if (groups.strike !== undefined) nest(groups.strike, { type: 'strike' });
    else if (groups.mark !== undefined) {
      // Markdown cannot say which colour; everything arrives as the first one.
      nest(groups.mark, { type: 'highlight', attrs: { tone: 'yellow' } });
    } else if (groups.br !== undefined) out.push({ type: 'hardBreak' });

    last = pattern.lastIndex;
  }
  push(unescape(source.slice(last)));
  return out;
}

function unescape(text: string): string {
  return text.replace(/\\([\\`*_[\]#=~])/g, '$1');
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
