/**
 * ProseMirror JSON to markdown. Nearly free once the walk exists, and half of
 * the escape hatch: a folder of these plus the raw JSON is enough to rebuild
 * the archive without PalmaNote existing.
 */

import type { PMDoc, PMNode } from '../core/types.ts';
import { assetPath } from './walk.ts';

const ESCAPE = /([\\`*_[\]#])/g;

export function markdownFromDoc(doc: PMDoc | null): string {
  if (!doc?.content) return '';
  return doc.content
    .map((node) => block(node, 0))
    .filter((text) => text.length > 0)
    .join('\n\n');
}

function block(node: PMNode, indent: number): string {
  const pad = '  '.repeat(indent);
  switch (node.type) {
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1);
      return `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${inline(node)}`;
    }
    case 'blockquote':
      return (node.content ?? [])
        .map((child) => block(child, indent))
        .join('\n\n')
        .split('\n')
        .map((line) => `> ${line}`.trimEnd())
        .join('\n');
    case 'bulletList':
      return listItems(node, indent, () => '- ');
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return listItems(node, indent, (index) => `${start + index}. `);
    }
    case 'taskList':
      return listItems(node, indent, (_index, item) =>
        item.attrs?.checked ? '- [x] ' : '- [ ] ',
      );
    case 'sceneBreak':
      return `${pad}***`;
    // A fenced block, and nothing inside it is escaped — the whole point of
    // one is that its contents are not markdown. The fence grows past any run
    // of backticks in the code, which is how a block containing a fence
    // survives being written into one.
    case 'codeBlock': {
      const body = (node.content ?? []).map((child) => child.text ?? '').join('');
      const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((run) => run[0].length));
      const fence = '`'.repeat(Math.max(3, longest + 1));
      const language = String(node.attrs?.language ?? '');
      return [`${pad}${fence}${language}`, ...body.split('\n').map((line) => pad + line), `${pad}${fence}`].join(
        '\n',
      );
    }
    // A real relative link to a real file, because the exporter writes the
    // bytes alongside it — see `assetFiles` in export/index.ts. This is the
    // difference between an export you can read somewhere else and an export
    // with holes in it.
    case 'image':
      return `${pad}![${String(node.attrs?.alt ?? '').replace(/[[\]]/g, '')}](${assetPath(node)})`;
    case 'paragraph':
      return pad + inline(node);
    default:
      return node.content ? node.content.map((child) => block(child, indent)).join('\n\n') : '';
  }
}

function listItems(
  list: PMNode,
  indent: number,
  marker: (index: number, item: PMNode) => string,
): string {
  const pad = '  '.repeat(indent);
  return (list.content ?? [])
    .map((item, index) => {
      const bullet = marker(index, item);
      const parts = (item.content ?? []).map((child) =>
        child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList'
          ? block(child, indent + 1)
          : block(child, 0),
      );
      const [first = '', ...rest] = parts;
      const continued = rest
        .map((part) =>
          part
            .split('\n')
            .map((line) => (line.startsWith('  ') ? line : `${pad}  ${line}`))
            .join('\n'),
        )
        .join('\n');
      return `${pad}${bullet}${first}${continued ? `\n${continued}` : ''}`;
    })
    .join('\n');
}

function inline(node: PMNode): string {
  return (node.content ?? []).map(text).join('');
}

function text(node: PMNode): string {
  if (node.type === 'hardBreak') return '  \n';
  // The shortcode convention, for the same reason `==` stands in for a
  // highlight: the art itself lives in the app, not in the export, so what
  // travels is the fact that a sticker was there and which one. Silently
  // dropping it would make a round trip lose something without saying so.
  if (node.type === 'sticker') return `:${String(node.attrs?.id ?? '')}:`;
  if (node.type !== 'text') return inline(node);

  const marks = node.marks ?? [];
  // Inline code is a span whose contents are *not* markdown, so it escapes
  // nothing and takes no other mark inside it — `**bold**` in a code span is
  // four asterisks and a word, which is exactly what it says.
  if (marks.some((mark) => mark.type === 'code')) {
    const raw = node.text ?? '';
    const longest = Math.max(0, ...[...raw.matchAll(/`+/g)].map((run) => run[0].length));
    const fence = '`'.repeat(longest + 1);
    // A space either side when the code itself starts or ends with a backtick;
    // markdown strips one, and without it the fence would not close.
    const pad = raw.startsWith('`') || raw.endsWith('`') ? ' ' : '';
    return `${fence}${pad}${raw}${pad}${fence}`;
  }

  let out = (node.text ?? '').replace(ESCAPE, '\\$1');
  // Link last, whatever order the marks arrived in, so the whole formatted run
  // becomes the link text — `[**bold**](url)` rather than `**[bold](url)**`.
  // ProseMirror does not promise mark order, and the two nest differently.
  const ordered = [...marks].sort((a, b) => Number(a.type === 'link') - Number(b.type === 'link'));
  for (const mark of ordered) {
    if (mark.type === 'bold') out = `**${out}**`;
    if (mark.type === 'italic') out = `*${out}*`;
    if (mark.type === 'strike') out = `~~${out}~~`;
    // The convention Obsidian and Pandoc share. Markdown has no way to say
    // *which* tone, so the mark survives the trip and its meaning does not.
    // docx keeps both.
    if (mark.type === 'highlight') out = `==${out}==`;
    if (mark.type === 'link') {
      const href = String(mark.attrs?.href ?? '');
      // Angle brackets when the address holds a space or a bracket of its own,
      // which is markdown's own answer and keeps the URL readable rather than
      // percent-encoding it into something nobody can check by eye.
      if (href) out = `[${out}](${/[\s()<>]/.test(href) ? `<${href}>` : href})`;
    }
  }
  return out;
}
