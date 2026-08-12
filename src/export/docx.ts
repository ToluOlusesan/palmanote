/**
 * ProseMirror JSON to .docx, via the `docx` package, in process.
 *
 * Everything here leans on Word's *named styles*. Headings are Heading 1/2/3,
 * body is Normal, lists are ListParagraph attached to real numbering
 * definitions. Nothing bakes "24pt bold centred" into a run. That is what
 * gives Word's navigation pane and Google Docs' outline their structure, and
 * what lets an editor restyle a whole manuscript in one action.
 *
 * The two presets share this file and differ only in style definitions and
 * section properties — same JSON in, same structure out.
 */

import {
  AlignmentType,
  type IRunOptions,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ExternalHyperlink,
  ImageRun,
  LevelFormat,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType,
  convertInchesToTwip,
} from 'docx';

import { toneOf, type HighlightTone } from '../editor/Highlight.ts';
import type { PMDoc, PMNode } from '../core/types.ts';
import type { Walk, WalkedDocument } from './walk.ts';

export type DocxPreset = 'reading' | 'manuscript';

export interface ManuscriptDetails {
  /** Runs in the header as `Surname / TITLE / page`. */
  surname: string;
  title: string;
  author: string;
  contact: string;
}

const BULLETS = 'springboard-bullets';
const NUMBERS = 'springboard-numbers';
const LIST_STYLE = 'ListParagraph';

/** Word's own styles for code, so an editor can restyle it in one go. */
const CODE_STYLE = 'HTMLPreformatted';
const CODE_CHARACTER_STYLE = 'HTMLCode';
const CODE_FONT = 'Consolas';

/** Emoji need their own run with an explicit font, or Word substitutes a box. */
const EMOJI = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/gu;
const EMOJI_FONT = 'Segoe UI Emoji';

/**
 * Word has sixteen named highlight colours and no others, so the four
 * highlights map onto four of them. An editor opening the file gets real Word
 * highlights they can clear from the ribbon, not a shaded run they have to
 * fight. Word's are the saturated originals rather than the tints drawn on
 * screen, which is as close as the format goes.
 */
type DocxHighlight = NonNullable<IRunOptions['highlight']>;

const HIGHLIGHT_COLOURS: Record<HighlightTone, DocxHighlight> = {
  yellow: 'yellow',
  green: 'green',
  blue: 'cyan',
  pink: 'magenta',
};

/** Pictures, already read out of the library — see loadAssets in index.ts. */
export interface ExportAsset {
  bytes: Uint8Array;
  width: number;
  height: number;
  extension: string;
}

/**
 * Word measures pictures in points, and a page has about 6.5 inches of them
 * between the margins. Anything wider is scaled down to fit; anything narrower
 * is left at its own size rather than blown up to fill the line.
 */
const MAX_IMAGE_POINTS = 6.5 * 72;

/** CSS pixels to points, the ratio every screenshot on a normal display uses. */
const POINTS_PER_PIXEL = 0.75;

let assetsForRun = new Map<string, ExportAsset>();

export async function docxFromWalk(
  walk: Walk,
  preset: DocxPreset,
  details: ManuscriptDetails,
  assets: Map<string, ExportAsset> = new Map(),
): Promise<Uint8Array> {
  const manuscript = preset === 'manuscript';
  const children: Paragraph[] = [];
  // The walk is depth-first and synchronous all the way down; threading a map
  // through nine functions to reach one `case` would cost more than it says.
  assetsForRun = assets;

  if (manuscript) children.push(...titlePage(details, walk.totalWords));

  walk.documents.forEach((entry, index) => {
    children.push(...documentParagraphs(entry, manuscript, index === 0 && !manuscript));
  });

  const document = new Document({
    creator: details.author || 'Springboard',
    title: details.title || walk.title,
    numbering: { config: numbering() },
    styles: manuscript ? manuscriptStyles() : readingStyles(),
    sections: [
      {
        properties: {
          page: {
            margin: manuscript
              ? {
                  top: convertInchesToTwip(1),
                  right: convertInchesToTwip(1),
                  bottom: convertInchesToTwip(1),
                  left: convertInchesToTwip(1),
                }
              : {
                  top: convertInchesToTwip(1),
                  right: convertInchesToTwip(1.25),
                  bottom: convertInchesToTwip(1),
                  left: convertInchesToTwip(1.25),
                },
          },
          titlePage: manuscript,
        },
        headers: manuscript ? { default: runningHeader(details) } : undefined,
        footers: manuscript ? undefined : { default: pageFooter() },
        children,
      },
    ],
  });

  return Packer.toBuffer(document).then((buffer) => new Uint8Array(buffer));
}

// --------------------------------------------------------------- structure

function documentParagraphs(
  entry: WalkedDocument,
  manuscript: boolean,
  first: boolean,
): Paragraph[] {
  const out: Paragraph[] = [];
  const heading = entry.depth === 0 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2;
  const isChapter = entry.depth === 0;

  if (entry.meta.title) {
    out.push(
      new Paragraph({
        heading,
        // Manuscript convention: every chapter starts on a fresh page.
        pageBreakBefore: manuscript && isChapter,
        children: runs(entry.meta.title),
      }),
    );
  } else if (manuscript && isChapter && !first) {
    out.push(new Paragraph({ children: [new PageBreak()] }));
  }

  out.push(...bodyParagraphs(entry.content, manuscript));
  return out;
}

function bodyParagraphs(doc: PMDoc | null, manuscript: boolean): Paragraph[] {
  if (!doc?.content) return [];
  const out: Paragraph[] = [];
  for (const node of doc.content) block(node, out, manuscript, 0);
  return out;
}

function block(node: PMNode, out: Paragraph[], manuscript: boolean, level: number): void {
  switch (node.type) {
    case 'heading': {
      const value = Number(node.attrs?.level ?? 1);
      out.push(
        new Paragraph({
          heading:
            value === 1
              ? HeadingLevel.HEADING_1
              : value === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          children: inlineRuns(node),
        }),
      );
      return;
    }
    case 'blockquote':
      for (const child of node.content ?? []) {
        out.push(
          new Paragraph({
            style: 'Quote',
            indent: { left: convertInchesToTwip(0.5) },
            children: inlineRuns(child),
          }),
        );
      }
      return;
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      for (const item of node.content ?? []) listItem(node.type, item, out, manuscript, level);
      return;
    case 'sceneBreak':
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          indent: { firstLine: 0 },
          children: [new TextRun('#')],
        }),
      );
      return;
    // One Word paragraph per line, in the named `HTMLPreformatted` style Word
    // itself uses for pasted code. Not one paragraph with breaks in it: a
    // reader wrapping the file needs each line to be a line, and the outline
    // pane counts paragraphs.
    case 'codeBlock': {
      const body = (node.content ?? []).map((child) => child.text ?? '').join('');
      for (const line of body.split('\n')) {
        out.push(
          new Paragraph({
            style: CODE_STYLE,
            indent: { firstLine: 0, left: convertInchesToTwip(0.25) },
            children: [new TextRun({ text: line, font: CODE_FONT })],
          }),
        );
      }
      return;
    }
    case 'image': {
      // Embedded, not linked. A .docx is a zip, and the picture travels inside
      // it — which is the whole reason this format exists as an export: it is
      // the one you can attach to an email without losing half of it.
      const asset = assetsForRun.get(String(node.attrs?.id ?? ''));
      if (!asset) return;
      const scale = Math.min(1, MAX_IMAGE_POINTS / (asset.width * POINTS_PER_PIXEL));
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          indent: { firstLine: 0 },
          children: [
            new ImageRun({
              type: asset.extension === 'jpg' ? 'jpg' : (asset.extension as 'png' | 'gif'),
              data: asset.bytes,
              transformation: {
                width: Math.round(asset.width * POINTS_PER_PIXEL * scale),
                height: Math.round(asset.height * POINTS_PER_PIXEL * scale),
              },
              altText: node.attrs?.alt
                ? { name: String(node.attrs.alt), title: String(node.attrs.alt), description: String(node.attrs.alt) }
                : undefined,
            }),
          ],
        }),
      );
      return;
    }
    case 'paragraph':
      out.push(
        new Paragraph({
          indent: manuscript ? { firstLine: convertInchesToTwip(0.5) } : undefined,
          children: inlineRuns(node),
        }),
      );
      return;
    default:
      for (const child of node.content ?? []) block(child, out, manuscript, level);
  }
}

function listItem(
  listType: string,
  item: PMNode,
  out: Paragraph[],
  manuscript: boolean,
  level: number,
): void {
  const checked = listType === 'taskList' ? Boolean(item.attrs?.checked) : null;
  let first = true;
  for (const child of item.content ?? []) {
    if (child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList') {
      for (const nested of child.content ?? []) {
        listItem(child.type, nested, out, manuscript, Math.min(level + 1, 2));
      }
      continue;
    }
    const marker = first && checked !== null ? [new TextRun(checked ? '☒ ' : '☐ ')] : [];
    out.push(
      new Paragraph({
        style: LIST_STYLE,
        numbering:
          listType === 'orderedList'
            ? { reference: NUMBERS, level }
            : listType === 'bulletList'
              ? { reference: BULLETS, level }
              : undefined,
        indent: listType === 'taskList' ? { left: convertInchesToTwip(0.25 + level * 0.25) } : undefined,
        children: [...marker, ...inlineRuns(child)],
      }),
    );
    first = false;
  }
}

// ------------------------------------------------------------------- runs

function inlineRuns(node: PMNode): InlineChild[] {
  const out: InlineChild[] = [];
  for (const child of node.content ?? []) {
    if (child.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }));
      continue;
    }
    if (child.type === 'pageLink') {
      out.push(...runs(String(child.attrs?.label ?? 'Untitled'), { italics: true }));
      continue;
    }
    // The same shortcode markdown writes. Word could hold the picture — `docx`
    // has ImageRun — but reading the bytes is async and this walk is not, so
    // that is a change to make deliberately rather than in passing.
    if (child.type === 'sticker') {
      out.push(...runs(`:${String(child.attrs?.id ?? '')}:`));
      continue;
    }
    if (child.type !== 'text') {
      out.push(...inlineRuns(child));
      continue;
    }
    const marks = child.marks?.map((mark) => mark.type) ?? [];
    // Only the marks that are on. Writing `bold: false` emits an explicit
    // <w:b w:val="false"/>, which overrides the paragraph style — a heading
    // carrying that would come out of Word un-bolded.
    const format: RunFormat = {};
    if (marks.includes('bold')) format.bold = true;
    if (marks.includes('italic')) format.italics = true;
    // The one that silently disappears if you forget it.
    if (marks.includes('strike')) format.strike = true;
    // Word's own character style for code, plus the font, because the style
    // alone is not present in every template this file might be opened with.
    if (marks.includes('code')) {
      format.style = CODE_CHARACTER_STYLE;
      format.font = CODE_FONT;
    }
    // `toneOf` rather than the raw attribute, so a page written before the
    // highlights were renamed still exports as the colour it shows on screen.
    const highlight = child.marks?.find((mark) => mark.type === 'highlight');
    if (highlight) format.highlight = HIGHLIGHT_COLOURS[toneOf(highlight.attrs?.tone)];

    // A real Word hyperlink, not blue text: `docx` writes the relationship
    // into the package for us, so the link is clickable in Word and survives
    // the trip through Google Docs.
    const href = child.marks?.find((mark) => mark.type === 'link')?.attrs?.href;
    if (typeof href === 'string' && href.length > 0) {
      out.push(
        new ExternalHyperlink({
          link: href,
          children: runs(child.text ?? '', { ...format, style: 'Hyperlink' }),
        }),
      );
      continue;
    }
    out.push(...runs(child.text ?? '', format));
  }
  return out.length > 0 ? out : [new TextRun('')];
}

type InlineChild = TextRun | ExternalHyperlink;

interface RunFormat {
  bold?: true;
  italics?: true;
  strike?: true;
  highlight?: DocxHighlight;
  style?: string;
  font?: string;
}

/** Splits emoji into their own runs so Word has a font that can draw them. */
function runs(text: string, format: RunFormat = {}) {
  return text
    .split(EMOJI)
    .filter((part) => part.length > 0)
    .map((part) =>
      EMOJI.test(part) || /\p{Extended_Pictographic}/u.test(part)
        ? new TextRun({ ...format, text: part, font: EMOJI_FONT })
        : new TextRun({ ...format, text: part }),
    );
}

// ----------------------------------------------------------------- chrome

function titlePage(details: ManuscriptDetails, words: number): Paragraph[] {
  const line = (text: string, alignment: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
    new Paragraph({ alignment, children: [new TextRun(text)] });
  const rounded = Math.round(words / 100) * 100;

  return [
    ...(details.author ? [line(details.author, AlignmentType.LEFT)] : []),
    ...details.contact.split('\n').filter(Boolean).map((entry) => line(entry, AlignmentType.LEFT)),
    ...Array.from({ length: 8 }, () => new Paragraph({ children: [] })),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: (details.title || 'Untitled').toUpperCase() })],
    }),
    ...(details.author
      ? [line(`by ${details.author}`, AlignmentType.CENTER), new Paragraph({ children: [] })]
      : []),
    line(`about ${rounded.toLocaleString('en-US')} words`, AlignmentType.CENTER),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function runningHeader(details: ManuscriptDetails): Header {
  const surname = details.surname || details.author.split(/\s+/).at(-1) || 'Author';
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun(`${surname} / ${(details.title || 'Untitled').toUpperCase()} / `),
          new TextRun({ children: [PageNumber.CURRENT] }),
        ],
      }),
    ],
  });
}

function pageFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT] })],
      }),
    ],
  });
}

// ----------------------------------------------------------------- styles

function numbering() {
  return [
    {
      reference: BULLETS,
      levels: [0, 1, 2].map((level) => ({
        level,
        format: LevelFormat.BULLET,
        text: ['•', '◦', '▪'][level]!,
        alignment: AlignmentType.LEFT,
        style: {
          paragraph: {
            indent: {
              left: convertInchesToTwip(0.25 + level * 0.25),
              hanging: convertInchesToTwip(0.25),
            },
          },
        },
      })),
    },
    {
      reference: NUMBERS,
      levels: [0, 1, 2].map((level) => ({
        level,
        format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level]!,
        text: `%${level + 1}.`,
        alignment: AlignmentType.LEFT,
        style: {
          paragraph: {
            indent: {
              left: convertInchesToTwip(0.25 + level * 0.25),
              hanging: convertInchesToTwip(0.25),
            },
          },
        },
      })),
    },
  ];
}

/** Industry standard for submission: Times, 12pt, double-spaced, indented. */
function manuscriptStyles() {
  const font = 'Times New Roman';
  const size = 24; // half-points
  return {
    default: {
      document: { run: { font, size } },
      heading1: {
        run: { font, size, bold: false },
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 480, line: 480 },
        },
      },
      heading2: {
        run: { font, size, bold: false },
        paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240, line: 480 } },
      },
      heading3: {
        run: { font, size, italics: true },
        paragraph: { spacing: { before: 240, after: 0, line: 480 } },
      },
    },
    paragraphStyles: [
      {
        id: 'Normal',
        name: 'Normal',
        run: { font, size },
        paragraph: { spacing: { before: 0, after: 0, line: 480 } },
      },
      {
        id: LIST_STYLE,
        name: 'List Paragraph',
        basedOn: 'Normal',
        quickFormat: true,
        run: { font, size },
        paragraph: { spacing: { before: 0, after: 0, line: 480 }, indent: { firstLine: 0 } },
      },
      {
        id: 'Quote',
        name: 'Quote',
        basedOn: 'Normal',
        run: { font, size },
        paragraph: { spacing: { before: 0, after: 0, line: 480 }, indent: { firstLine: 0 } },
      },
      // Single-spaced even here: double-spacing code makes it unreadable, and
      // the reason a manuscript is double-spaced — room to write between the
      // lines — does not apply to a block nobody is going to line-edit.
      {
        id: CODE_STYLE,
        name: 'HTML Preformatted',
        basedOn: 'Normal',
        run: { font: CODE_FONT, size: 20 },
        paragraph: { spacing: { before: 0, after: 0, line: 240 }, indent: { firstLine: 0 } },
      },
    ],
    characterStyles: CODE_AND_LINK_STYLES,
  };
}

/** Comfortable, single-spaced, for handing to a friend. */
function readingStyles() {
  const font = 'Georgia';
  const size = 23;
  return {
    default: {
      document: { run: { font, size }, paragraph: { spacing: { after: 200, line: 300 } } },
      heading1: {
        run: { font: 'Calibri', size: 36, bold: true, color: '1A1A1A' },
        paragraph: { spacing: { before: 480, after: 200 } },
      },
      heading2: {
        run: { font: 'Calibri', size: 28, bold: true, color: '1A1A1A' },
        paragraph: { spacing: { before: 360, after: 160 } },
      },
      heading3: {
        run: { font: 'Calibri', size: 24, bold: true, color: '333333' },
        paragraph: { spacing: { before: 280, after: 120 } },
      },
    },
    paragraphStyles: [
      {
        id: 'Normal',
        name: 'Normal',
        run: { font, size },
        paragraph: { spacing: { after: 200, line: 300 } },
      },
      {
        id: LIST_STYLE,
        name: 'List Paragraph',
        basedOn: 'Normal',
        quickFormat: true,
        paragraph: { spacing: { after: 80, line: 300 } },
      },
      {
        id: 'Quote',
        name: 'Quote',
        basedOn: 'Normal',
        run: { italics: true, color: '444444' },
        paragraph: { spacing: { before: 160, after: 160, line: 300 } },
      },
      {
        id: CODE_STYLE,
        name: 'HTML Preformatted',
        basedOn: 'Normal',
        run: { font: CODE_FONT, size: 20 },
        paragraph: { spacing: { before: 0, after: 0, line: 240 } },
      },
    ],
    characterStyles: CODE_AND_LINK_STYLES,
  };
}

/**
 * The two character styles both presets share.
 *
 * `Hyperlink` is Word's own — declaring it means a link comes out looking like
 * a link in a document built from a blank template, rather than inheriting
 * whatever the reader's Normal happens to be.
 */
const CODE_AND_LINK_STYLES = [
  {
    id: CODE_CHARACTER_STYLE,
    name: 'HTML Code',
    basedOn: 'DefaultParagraphFont',
    quickFormat: true,
    run: { font: CODE_FONT, size: 20 },
  },
  {
    id: 'Hyperlink',
    name: 'Hyperlink',
    basedOn: 'DefaultParagraphFont',
    run: { color: '0563C1', underline: { type: UnderlineType.SINGLE } },
  },
];
