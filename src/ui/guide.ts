/**
 * What everything does.
 *
 * Written here rather than in a README because a README is somewhere else, and
 * the question "what was the key for a scene break" arrives while writing. Kept
 * as data rather than as markup so that adding a shortcut is adding a line.
 *
 * Every binding below is the one in the code, not the one that seemed likely:
 * window-level keys come from App.tsx, editor keys from editor/keymap.ts and
 * Tiptap's own defaults, tree keys from ui/TreePane.tsx. If one of them stops
 * being true, this file is wrong and should be corrected rather than trusted.
 */

export interface GuideRow {
  /** A key, an input rule, or a gesture. Blank for a plain point. */
  keys?: string;
  what: string;
}

export interface GuideSection {
  id: string;
  title: string;
  intro: string;
  rows: GuideRow[];
  /** The reasoning, where the app has an opinion worth knowing about. */
  aside?: string;
}

export const GUIDE: GuideSection[] = [
  {
    id: 'writing',
    title: 'Writing',
    intro:
      'Everything is saved as you type — there is no save key and nothing to remember. Writing is the resting state of the app: it launches with the caret in a page, and Escape always returns you to one.',
    rows: [
      { keys: 'F1', what: 'Open this guide, from anywhere' },
      { keys: 'Escape', what: 'Back to the writing, from anywhere' },
      { keys: 'Right-click', what: 'Cut, copy, paste, and what can be done to the block under the pointer' },
      { what: 'The mark at the top of the sidebar goes back to the launch screen.' },
      { keys: 'Ctrl + Z', what: 'Undo — survives switching pages and coming back' },
      { keys: 'Ctrl + Y', what: 'Redo' },
      { keys: 'Alt + ←  /  Alt + →', what: 'Back and forward through pages you have visited' },
      { keys: 'Ctrl + \\', what: 'Show or hide the sidebar' },
      { what: 'The status bar counts words, characters, and how much you have added this session.' },
    ],
    aside:
      'Undo really does survive navigation. Switching tabs puts the whole editor state aside — document, cursor and undo history together — and swaps it back when you return, rather than reloading the text and throwing the history away.',
  },
  {
    id: 'formatting',
    title: 'Formatting',
    intro:
      'Three marks and nothing else — no underline, no colour, no font sizes. Each has a shortcut, a button in the page bar, and a way to type it directly.',
    rows: [
      { keys: 'Ctrl + B  ·  **bold**', what: 'Bold' },
      { keys: 'Ctrl + I  ·  *italic*', what: 'Italic' },
      { keys: 'Ctrl + Shift + X  ·  ~~struck~~', what: 'Strikethrough' },
      { keys: 'Ctrl + Alt + 1 / 2 / 3', what: 'Heading levels — or type ##, ### at the start of a line' },
      { keys: 'Ctrl + Alt + 0', what: 'Back to ordinary text' },
      { keys: '- ', what: 'Bulleted list' },
      { keys: '1. ', what: 'Numbered list' },
      { keys: '[] ', what: 'To-do list, with real checkboxes' },
      { keys: '> ', what: 'Quote' },
      { keys: '--- or ***', what: 'Scene break' },
      { keys: 'Tab  /  Shift + Tab', what: 'Nest a list item, up to three levels' },
      { keys: 'Enter, twice', what: 'Leave a list' },
    ],
    aside:
      'Quotation marks, dashes and ellipses are converted as you type — "so" becomes “so”, -- becomes an em dash, ... becomes a single character. Pasted text is stripped to what this app can hold, so a paste from a web page arrives as writing rather than as a web page.',
  },
  {
    id: 'highlights',
    title: 'Highlights',
    intro:
      'Four highlights: yellow, green, blue and red. Reach them from the highlighter in the page bar, or from the bar that appears when you select text.',
    rows: [
      { keys: 'Ctrl + Shift + H', what: 'Yellow, straight away' },
      { what: 'Picking the colour a run already has takes it off again.' },
      { what: 'Picking a different one recolours it in place.' },
      { what: 'None — take the highlight off whatever colour it is' },
    ],
    aside:
      'Four fixed colours rather than a picker: a highlight should be something you can find again, not a shade you have to match. What each colour means is yours to decide. Each maps to one of Word’s named highlight colours on export, so a marked run arrives in an editor’s copy as a real Word highlight they can clear from the ribbon.',
  },
  {
    id: 'insert',
    title: 'The / menu',
    intro:
      'Type / at the start of a word to put something new down. Keep typing to filter it; the arrows move, Enter or Tab chooses, Escape closes it and leaves the / where you typed it.',
    rows: [
      { keys: '/', what: 'Every block type, plus stickers and images' },
      { keys: '/head', what: 'Filters as you type — /quo, /todo, /scene all work' },
      { keys: '/image', what: 'Opens a file picker' },
      { keys: '/heart, /idea, /party …', what: 'The nine stickers, by name or by what they mean' },
      { what: 'A / in the middle of a word never opens it, so dates, fractions and paths are safe.' },
    ],
    aside:
      'Everything the / menu offers already had a shortcut or a way to type it. It is the discoverable route, not the fast one — which is why each row shows the faster way beside it.',
  },
  {
    id: 'selection',
    title: 'Selecting text',
    intro:
      'Select any text and a bar comes to it, holding what can be done to writing that already exists: the block type it is in, the four marks, the three list types, and the highlights.',
    rows: [
      { what: 'Click a control to apply it. The bar stays, so you can bold and then highlight without selecting twice.' },
      { what: 'The left-hand control says which block type you are in, and turns it into another.' },
      { keys: 'Escape', what: 'Close it, keeping the selection' },
      { what: 'It never covers the words it is about — it sits above them, or below when there is no room.' },
      { what: 'Selecting a picture or a sticker does not open it: there are no words there to mark.' },
    ],
    aside:
      'It deliberately does not take Enter, Tab or the arrow keys. Those belong to the selection — Enter replaces it, Tab indents it, the arrows collapse it — and a bar that intercepted them would be wrong a hundred times a day. Use the mouse, or the shortcut in each control’s tooltip.',
  },
  {
    id: 'blocks',
    title: 'Moving blocks',
    intro:
      'Every paragraph, heading, bullet, quote and picture is a block. Rest the pointer anywhere on the page and two controls appear in the margin beside whichever block you are over.',
    rows: [
      { keys: 'drag the ⠿ handle', what: 'Move the block anywhere on the page — a line shows where it will land' },
      { keys: 'click the ⠿ handle', what: 'Hold the block and open its menu: duplicate, move, delete, turn into' },
      { keys: '+', what: 'A new block underneath, with the / menu already open on it' },
      { keys: 'Alt + Shift + ↑ / ↓', what: 'Move the block the cursor is in, up or down' },
      { keys: 'Alt + Shift + D', what: 'Duplicate it, and put the cursor in the copy' },
      { what: 'Each bullet is its own block, not the list — so one point moves without the ones around it.' },
      { what: 'A quote moves as one thing, with every paragraph inside it.' },
      { what: 'A block only ever moves among its own neighbours: the last bullet in a list will not climb out of it.' },
      {
        what: 'List items are moved with the arrows rather than by dragging. Everything else the handle does still works on a bullet — it just is not picked up.',
      },
    ],
    aside:
      'The handle is the only place the app asks you to reach outside the writing, so it stays out of it — the column keeps its width, the controls sit in the margin, and they disappear the moment you start typing. Everything here also has a chord, because a control you have to find with the mouse is a slow control once you know what it does.',
  },
  {
    id: 'pages',
    title: 'Pages and the tree',
    intro:
      'The sidebar is the whole library. Pages nest as deep as you like, drag to reorder or to move inside another, and carry their own icon.',
    rows: [
      { keys: 'Ctrl + N', what: 'New page beside this one' },
      { keys: 'Ctrl + Shift + N', what: 'New page inside this one — and a link to it appears where you were writing' },
      { keys: '↑ ↓', what: 'Move through the tree' },
      { keys: '→  /  ←', what: 'Open or close a page’s children' },
      { keys: 'Enter', what: 'Open the page' },
      { keys: 'F2  ·  Shift + Enter', what: 'Rename' },
      { keys: 'Tab  /  Shift + Tab', what: 'Move a page in or out one level' },
      { keys: 'Alt + ↑ / ↓', what: 'Move a page up or down among its siblings' },
      { keys: 'Ctrl + D', what: 'Favourite — favourites get their own section at the top' },
      { keys: 'Backspace', what: 'Archive. Nothing is deleted; it moves to the archive at the foot of the sidebar' },
      { keys: 'Right-click', what: 'Rename, add a page inside, copy a link, change the icon, favourite, archive' },
    ],
    aside:
      'Archiving is not deleting. Deleting for good is only reachable from inside the archive, asks once, and takes everything beneath the page with it — which is the only operation in this app that cannot be undone.',
  },
  {
    id: 'links',
    title: 'Linking pages together',
    intro:
      'Pages can point at each other, and a link always shows the title the page has now — rename a chapter and every mention of it updates.',
    rows: [
      { keys: '@', what: 'Search your pages by title and drop a link where the caret is' },
      { keys: '@Name, then Enter', what: 'If no page answers to that name, the last row makes one, inside the page you are writing in' },
      { keys: 'Right-click a page → Copy link', what: 'Puts a link on the clipboard' },
      { keys: 'Ctrl + V', what: 'Pastes it as a live link, wherever the caret is' },
      { what: 'Clicking a link opens that page.' },
      { what: 'An @ inside a word — an email address — never opens the picker.' },
    ],
    aside:
      'A link stores only the page’s id. The title you see is looked up every time it is drawn, so there is never a second copy of a title to fall out of step. A link to a page you later archive is left visible rather than removed: deleting the sentence that pointed at it would be worse than showing that it is gone.',
  },
  {
    id: 'pictures',
    title: 'Images and stickers',
    intro:
      'Both live in your library rather than on the internet. Nothing here reaches for the network, and an export carries the picture files with it.',
    rows: [
      { keys: 'Ctrl + V', what: 'Paste an image straight into the page' },
      { keys: 'Drag and drop', what: 'Drop an image file anywhere in the page' },
      { keys: '/image', what: 'Choose one from disk' },
      { what: 'Drag a picture already in a page to move it somewhere else in that page.' },
      { keys: '/sticker', what: 'The nine stickers — small, and sized to sit inside a sentence' },
      { what: 'Pictures do not count towards your word count.' },
    ],
    aside:
      'The same picture used on six pages is stored once: an image is filed under a fingerprint of its own contents, and a page holds only that fingerprint. It is also why history stays small — a snapshot of a page copies the reference, not the picture.',
  },
  {
    id: 'galleries',
    title: 'Galleries',
    intro:
      'Several pictures shown as a grid instead of as a column of full-width images. A gallery is something you make rather than something that happens: it can be given a column count, dropped into, copied out of whole, and taken apart again.',
    rows: [
      { keys: 'Paste or drop several', what: 'Two or more pictures at once arrive as one gallery' },
      { keys: '/gallery', what: 'An empty one, to drop pictures into' },
      { what: 'Select a run of pictures and nothing else, and the page bar offers to group them.' },
      { keys: '2 · 3 · 4', what: 'How many across, on the gallery’s own controls' },
      { keys: 'Copy all', what: 'Every picture in the gallery, onto the clipboard at once' },
      { keys: 'Ungroup', what: 'Back to ordinary pictures, one after another' },
      { what: 'Dropping a picture onto a gallery adds it to that gallery rather than below it.' },
    ],
    aside:
      'The clipboard holds one image — that is what the format is — so “copy all” puts down two other things instead: a file list, which Explorer, an upload box and an image editor read as six files, and an HTML fragment, which Word and a mail composer read as six pictures. Whichever you paste into takes the one it understands.',
  },
  {
    id: 'covers',
    title: 'Page covers',
    intro:
      'A banner across the top of a page. It belongs to the page rather than to a place in it, so it survives selecting everything and typing over it, and it stays out of the way of the prose.',
    rows: [
      { keys: 'Add cover', what: 'Above the title, when the page is hovered' },
      { keys: 'Drag the cover', what: 'Moves the crop up and down, one pixel per pixel' },
      { keys: '↑  /  ↓', what: 'The same, once the cover has focus' },
      { what: 'A cover is an ordinary picture from your library — using one that is already in the page costs nothing.' },
    ],
    aside:
      'The crop is stored on the page and not on the picture, so the same photograph can be the cover of two pages and sit differently in each.',
  },
  {
    id: 'tabs',
    title: 'Tabs',
    intro:
      'Clicking a page in the sidebar previews it in a single reusable tab, so browsing does not bury you in tabs. Editing it, or double-clicking, makes the tab permanent.',
    rows: [
      { keys: 'Ctrl + T', what: 'New page in a new tab' },
      { what: 'Or press the + at the end of the tab strip, which does the same thing.' },
      { keys: 'Ctrl + W', what: 'Close the tab' },
      { keys: 'Ctrl + Shift + T', what: 'Reopen the last one you closed' },
      { keys: 'Ctrl + Tab  /  Ctrl + Shift + Tab', what: 'Next and previous tab' },
      { keys: 'Ctrl + 1 … 9', what: 'Jump straight to a tab' },
      { keys: 'Middle-click', what: 'Close a tab' },
      { what: 'Drag tabs to reorder them. The whole set comes back when you reopen the app, scroll position and all.' },
    ],
  },
  {
    id: 'notes',
    title: 'Stickies and comments',
    intro:
      'Two ways to write something down beside the writing rather than in it. A sticky is about the page; a comment is about particular words. Both live in the rail down the right, and neither is part of what you are writing.',
    rows: [
      { keys: 'Ctrl + Space', what: 'A sticky note in the rail, with the caret already in it' },
      { keys: 'Ctrl + Alt + M', what: 'A comment on the words you are holding' },
      { keys: 'Right-click', what: 'Both are in the menu — “Sticky note” and “Comment on this”' },
      { what: 'Commented words wear a dotted underline. A comment shows “in the page” — press it to go to them.' },
      { what: 'Four papers to choose from, on any note. Press one of the dots at the foot.' },
      { keys: 'Escape', what: 'Back to the prose, from a note' },
      { keys: 'Backspace', what: 'In an empty note, throws it away' },
      { what: 'Deleting a comment also takes the underline off the words.' },
    ],
    aside:
      'Neither exports, neither counts towards the page’s word count, and neither is kept in a revision — they are the aside you write while writing something else, not part of the thing itself. A comment whose words you later delete says so rather than quietly vanishing: the thought was still worth having, and throwing it away is yours to decide. Notes stack in the order you wrote them and cannot be dragged, because a thought parked over the third paragraph is lost the moment you edit above it.',
  },
  {
    id: 'history',
    title: 'History',
    intro:
      'Every page keeps its own history, saved for you as you write. There is nothing to remember to press.',
    rows: [
      { keys: 'Ctrl + Shift + H', what: 'Open the history of the page you are in' },
      { what: 'A version is kept roughly every couple of minutes of active writing.' },
      { what: 'Pick one from the list to read it in full, laid out exactly as it was.' },
      { what: 'Restore puts it back — and keeps where you are now as its own version first.' },
      { keys: 'Ctrl + Z', what: 'Undoes a restore, like anything else' },
    ],
    aside:
      'Older history thins out rather than growing forever: everything from the last day, hourly for a week, daily beyond that — and never the most recent version of a page.',
  },
  {
    id: 'inout',
    title: 'Getting things in and out',
    intro:
      'Your writing is yours and stays readable without this app. Export offers several routes out, including one that takes everything.',
    rows: [
      { keys: 'Ctrl + Shift + E', what: 'Export' },
      { keys: 'Ctrl + Shift + I', what: 'Import — Word documents, markdown, or a PDF to read alongside' },
      { what: 'It asks two things: what kind of file, and how much of your library.' },
      { what: 'Word document — opens in Word and Google Docs, with real heading styles.' },
      { what: 'Manuscript format — a switch under Word: double-spaced, running header, title page, chapters starting on new pages.' },
      { what: 'Markdown — one page comes out as one file; more than one comes out as folders mirroring your pages.' },
      { what: 'Everything — the markdown tree, the picture files, and the complete raw database.' },
      { what: 'PDF is out of the app for now while it is rebuilt.' },
    ],
    aside:
      '“Everything” is the escape hatch and sits with the rest rather than hidden away. Someone with that folder and no copy of PalmaNote can rebuild what was here, by hand if they have to. On the desktop app a copy of the whole library is also written to your Documents folder each night, and the last thirty are kept.',
  },
  {
    id: 'settings',
    title: 'Settings',
    intro:
      'Two switches, and that is on purpose — anything that needs a switch usually needed a decision instead.',
    rows: [
      { keys: 'Ctrl + ,', what: 'Open settings' },
      { keys: 'F1', what: 'Open this guide — also the ? in the top bar' },
      { what: 'Animated cursor — the cursor slides between positions rather than jumping.' },
      { what: 'Greeting on launch — somewhere to start before the writing. Escape always skips it.' },
      { what: 'The theme button in the top bar cycles system, light and dark.' },
    ],
    aside:
      'There was a third setting here — a name for the greeting to use. The greeting lost the half of it that said a name, at which point the setting had no reader at all, and a control whose only effect is invisible is worse than no control.',
  },
];
