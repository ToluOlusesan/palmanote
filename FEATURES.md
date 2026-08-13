# PalmaNote — the feature set

What the app actually does, as of the code in this repository. Written against
the source rather than the brief: every binding, limit and behaviour below was
read out of the file it lives in, and each section names that file.

The [README](README.md) is the design record — why things are the way they are,
and what was argued about. This is the inventory.

---

## 1. Shape of the thing

A single-user writing app: a page tree, tabs, a Tiptap/ProseMirror editor, and
five ways out of it. It runs as a Windows desktop application and, unchanged, in
a browser.

| | Desktop | Browser |
|---|---|---|
| Shell | Tauri 2 over WebView2, SQLite in a Rust process | plain page |
| Storage | `%APPDATA%/com.springboard.app/springboard.sqlite` | IndexedDB |
| Window | frameless, custom caption buttons, remembered bounds | ordinary page |
| Files out | native save/folder dialogs | File System Access API, else downloads |
| Files in | native picker, whole folders walked in Rust | `<input type="file">`, `webkitRelativePath` |
| PDF | platform print dialog | browser print dialog |
| PDF reading | yes, WebView2's own viewer | no |
| Backups | nightly `VACUUM INTO` Documents, last 30 kept | none |
| Snapshot restore | yes | no |

The app was called Springboard until 13 August 2026, and every name that
*addresses* something keeps that spelling on purpose: the bundle identifier
`com.springboard.app`, the library file `springboard.sqlite`, the IndexedDB
database `springboard`, the `springboard://page/<id>` link form, the
`Documents/Springboard Snapshots` folder and the `springboard-<stamp>.sqlite`
files in it. Renaming any of them would leave an existing install launching
happily onto an empty library. Electron pins `userData` to the old folder for
the same reason — see the note at the top of [electron/main.ts](electron/main.ts).
These are addresses, not titles.

The seam is [src/data/bridge.ts](src/data/bridge.ts) — twenty-odd methods,
resolved once at load. Nothing above that file knows which shell it is in.
[tauriBridge.ts](src/data/tauriBridge.ts) implements it over `invoke`;
[electron/](electron/) still holds the older implementation of the same contract.

### Motion

One vocabulary, at the end of [styles.css](src/app/styles.css#L3074) — three
easings (`--ease`, `--glide`, `--spring`) and three durations (`--quick` 120ms,
`--settle` 190ms, `--unfold` 280ms), and almost nothing outside them. Gathered
in one block rather than spread through the file, because the difference between
an interface that feels considered and one that feels assembled is not how much
it animates but whether everything animates the same.

Three rules cover the surface: anything a pointer can touch answers at
`--quick`; anything that appears out of nothing rises four pixels while it
fades, so it reads as having come from somewhere; anything pressed dents by 7%
and comes back faster than it went. The selection bar is the one thing that goes
further — its controls arrive in sequence rather than together, which is what
makes it read as a thing that came to you.

Nothing loops, nothing runs longer than 280ms, and one media query at the foot
of the file turns all of it off under `prefers-reduced-motion` — durations
rather than `animation: none`, so anything animating *into* its resting state
still ends up there.

---

## 2. Pages and the tree

The sidebar is the whole library. Source: [src/ui/TreePane.tsx](src/ui/TreePane.tsx),
[src/state/library.tsx](src/state/library.tsx), [src/core/tree.ts](src/core/tree.ts).

- **Unlimited nesting.** Any page can hold both prose and children; nesting is
  never restricted by kind.
- **Four kinds** — `folder`, `chapter`, `scene`, `note` — kept in the model
  because export needs them. New pages default to `note` and the kind is not
  surfaced in the UI.
- **Per-page icon**, one emoji, chosen from a picker
  ([IconPicker.tsx](src/ui/IconPicker.tsx), [emoji.ts](src/ui/emoji.ts)). Pages
  without one fall back to a glyph for their kind.
- **Favourites** get their own section pinned above the tree, alphabetically
  sorted, and only ever contain pages still reachable in the tree.
- **Word counts roll up** the tree in one bottom-up pass; the sidebar footer
  carries the library total.
- **Reordering and re-parenting** by drag with drop indicators, or by keyboard:
  `Alt+↑/↓` among siblings, `Tab`/`Shift+Tab` to nest and outdent.
- **Rename** inline — `F2`, `Shift+Enter`, or the row menu.
- **Row context menu** ([RowMenu.tsx](src/ui/RowMenu.tsx)): Rename, New page
  inside, Copy link, icon, Favourite, Delete. One level, no submenus; it flips
  upward near the bottom of the window rather than overflowing.
- **Expansion state and sidebar visibility persist** across launches
  (`palmanote:ui` in `localStorage`).
- A thin **edge handle** brings a hidden sidebar back without knowing the
  shortcut.

### Ordering keys

Siblings sort by a base-62 fractional index, not a float
([src/core/fracIndex.ts](src/core/fracIndex.ts), mirrored in Rust at
[frac_index.rs](src-tauri/src/frac_index.rs)). An integer part increments on
append, a fractional part subdivides. A move is one row update, keys sort
lexicographically in both SQLite `TEXT` and IndexedDB, and 5,000 appends produce
a 4-character key rather than the 1,000-character one a naive string midpoint
gives you. Both cases are asserted in
[fracIndex.test.ts](src/core/fracIndex.test.ts).

### Archive, and the one destructive operation

- **`Backspace` archives.** The subtree leaves the sidebar and waits in the
  Archive at the foot of the tree. Only the subtree *root* is marked;
  descendants keep `archived_at` null and simply stop being reachable by
  traversal — so archive and restore are each one row update with no cascade.
- **Restore** puts a branch back exactly as it was, or at the root if its parent
  has since been archived.
- **Archiving the open page** lands you on its nearest surviving ancestor, and
  corrects the selection in place rather than pushing a history entry.
- **Delete for good** exists only inside the Archive, asks once inline (not in a
  modal), and removes the subtree, its content and its whole revision history. In
  SQLite that is a recursive CTE deleting leaves first, because `parent_id` is
  `ON DELETE RESTRICT` — the constraint is there so a bad delete fails loudly
  instead of orphaning half a novel. It is the only operation in the app that
  cannot be undone, and the only moment orphaned image bytes are swept.

---

## 3. The writing surface

Tiptap 3 on ProseMirror. The entire schema is one list in
[src/editor/extensions.ts](src/editor/extensions.ts) — everything absent from it
is absent from the document model, which is what makes paste-stripping close to
free.

**In the schema:** paragraphs, headings 1–3, blockquote, bullet / ordered / task
lists, hard breaks, bold, italic, strikethrough, a four-colour highlight, a typed
scene break, page links, stickers, images, galleries.

**Deliberately not in it:** code and code blocks, hyperlinks, underline, tables,
text colour, font sizes, alignment.

- **Input rules:** `**bold**`, `*italic*`, `~~struck~~`, `## ` headings, `- `,
  `1. `, `[] `, `> `, `---` / `***` for a scene break.
- **Smart typography** ([typography.ts](src/editor/typography.ts)) — hand-written
  rather than `@tiptap/extension-typography`, which also converts fractions,
  copyright signs and guillemets. Curly quotes, em dash from `--`, a real
  ellipsis.
- **Lists cap at three levels.** The cap runs at priority 1000, above Tiptap's
  own uncapped `Tab`→`sinkListItem`, and swallows the key at the limit rather
  than declining it. Outside a list `Tab` keeps its usual job of moving focus.
- **Undo depth 300**, 400 ms grouping.
- **Paste is stripped twice over.** Unknown node types cannot parse into a schema
  with no rule for them; on top of that `transformPastedHTML` removes `style`,
  `class`, `id`, `lang` and `dir` attributes riding on nodes that do exist.
- **Placeholder** appears only on a wholly empty page, never on the trailing
  paragraph of a finished one.
- **Spellcheck** is on.
- **One rule owns the space between blocks** — `.body > * + *`, 1.05em, with
  headings taking more above and less below. The browser's own block margins
  are removed inside `:where()` so that reset contributes no specificity and
  cannot outrank it. Doing that at `.body p` instead is what used to leave two
  paragraphs, a quote after a sentence and a list after its lead-in all running
  flush together while headings alone kept their air.

### The animated caret

[src/editor/caret.ts](src/editor/caret.ts). The native caret is hidden and one is
drawn that slides between positions, the way Word's does. It is defensive by
construction: the native caret is only hidden *after* ours has painted once, and
it comes back on blur, on IME composition, on resize/scroll failure, and if
anything throws. A visible native caret is always better than no caret. It
switches itself off when the system asks for reduced motion, regardless of the
setting.

Typewriter scrolling was built and removed — nothing scrolls the page now except
the writer.

### The page bar

Back / forward, a clickable breadcrumb trail, and the formatting toolbar
([Toolbar.tsx](src/ui/Toolbar.tsx)) sharing the same row, so the writing surface
loses no height to it: bold, italic, strikethrough, highlight (a button that
opens four), H1/H2/H3, and the three list types. Every control is also a shortcut
and an input rule. It stays where it is; the
[selection bar](#4-the--and--menus-and-the-selection-bar) is the one that comes
to the words.

### Status bar

Words, characters (Word's convention — spaces counted, block breaks not), and
`+N this session`. Characters are counted on the same walk as words, on save and
on load, rather than per keystroke.

---

## 4. The `/` and `@` menus, and the selection bar

[src/editor/slash.ts](src/editor/slash.ts) decides *whether* something is open;
[src/ui/SlashMenu.tsx](src/ui/SlashMenu.tsx) and
[src/ui/SelectionBar.tsx](src/ui/SelectionBar.tsx) decide what. Three doors, one
mechanism:

| Trigger | Opens |
|---|---|
| `/` at the start of a word | a list: every block type, plus images, galleries and the nine stickers |
| `@` at the start of a word | a list: your pages, by title — and a row that creates one if none match |
| holding a selection | a bar above the words: block type, the four marks, the three list types, the highlights |

- Filters as you type, up to 24 characters; a space closes it. Arrows move,
  `Enter`/`Tab` chooses, `Escape` closes it and leaves what you typed exactly
  where you typed it.
- Choosing an entry takes the trigger character and the query back out with it.
- **A trigger mid-word never opens a menu** — dates, fractions, file paths and
  email addresses are all safe. When both characters are behind the caret the
  nearer one wins.
- A selection gets a **bar rather than a list**: a column of every verb is the
  right shape for "put something here" and the wrong shape for "do something to
  this". It **transforms rather than inserts**, so no stickers and no images —
  either would eat the words that asked for it.
- The bar **does not take `Enter`, `Tab` or the arrows** — those belong to the
  selection, and intercepting them would be wrong a hundred times a day. Every
  control carries its own shortcut in its tooltip.
- It **never covers the words it is about**: above them, or below when there is
  no room above. Centred on the selection on one line, on the column when it
  spans several.
- A selection only gets the bar once the drag has finished — tracked through
  `mouseup` *and* `dragend`, because dragging existing text never delivers a
  mouseup at all.
- Selecting an image, sticker or scene break opens nothing: there are no words
  there to mark.
- Waved away with `Escape` it stays shut until you leave that range, and comes
  back when the same selection is deliberately remade.
- Written by hand rather than with `@tiptap/suggestion` or
  `@tiptap/extension-bubble-menu`.

---

## 5. Blocks as objects

[src/editor/blocks.ts](src/editor/blocks.ts) holds the rules,
[BlockGutter.tsx](src/ui/BlockGutter.tsx) the two controls,
[BlockMenu.tsx](src/ui/BlockMenu.tsx) what the handle opens.

Everything above this section treats a page as a stream you type into: the
caret is somewhere, and what you do happens there. This is the other reading —
that a page is a stack of objects, each of which can be picked up, moved,
copied and thrown away without the caret being involved at all.

Rest the pointer anywhere and two controls appear in the margin beside the
block under it: a `+` and a drag handle.

| | |
|---|---|
| drag the handle | move the block, with a line showing where it will land |
| click the handle | hold the block and open its menu |
| `+` | a new block underneath, with the `/` menu already open on it |
| `Alt+Shift+↑` / `↓` | move the block the caret is in |
| `Alt+Shift+D` | duplicate it, caret in the copy |

### List items are not dragged

`isCarryable` in [blocks.ts](src/editor/blocks.ts). A bullet is a block by every
other measure — it has a handle, a menu, and all six verbs — but it cannot be
picked up by the pointer, and that is a decision rather than a gap.

Dropping *into* a list has no target worth offering. ProseMirror resolves a
point inside an item to the gap after it, so the first item of a list has no
reachable slot above it however carefully you aim; and items sit flush against
one another, so the two-pixel line that says where a block will land has nowhere
to draw but across the text of the row above, where it reads as a strikethrough.
Both fall out of a list being one node holding items rather than a run of
siblings, and neither is reachable without replacing drop targeting wholesale.

`Alt+Shift+↑`/`↓` moves an item among its siblings, exactly, every time, and it
is the same chord that moves a paragraph. One gesture that works is a better
offer than two where the more inviting one misleads. The handle stops saying
otherwise: on an item it is not `draggable`, and the cursor stays an arrow
rather than promising a grab.

The menu is four verbs — duplicate, move up, move down, delete — and then the
nine block types a block can be turned into. Move up and move down are greyed
at the ends rather than hidden, because a menu whose items move between
openings is a menu you have to read every time.

### What counts as one block

Two rules, and the order of them is the whole question.

- **The deepest list item wins.** A bulleted list is one node holding six
  items, but nobody thinks of a list as one thing — they think of six bullets,
  each of which can be moved on its own. So an item is a block and the list
  that holds it is not, and a bullet nested inside a bullet belongs to itself
  rather than to the point above it.
- **Otherwise the outermost node under the page wins.** That is what puts one
  handle beside a whole quote rather than one beside each paragraph inside it,
  and what makes a quote move with everything in it.

A block only ever moves among its own siblings. A bullet dragged past the end
of its list does not climb out into the page, and a paragraph does not dive
into the quote beneath it — both are plausible readings of "move down" and
neither is one anybody expects from an arrow key, because the block would
vanish from where they were looking and reappear wearing a different shape.

### How the drag is done

The handle sets a node selection and hands ProseMirror its own `view.dragging`,
so the move is `prosemirror-view`'s drop handler rather than a reimplementation
of it, and the indicator is the `dropcursor` that was already configured in
[extensions.ts](src/editor/extensions.ts). What that buys is every awkward case
answered by the library: a drop into a place the schema forbids snaps to the
nearest place it allows, and a drop outside the window does nothing.

The one thing worth knowing is what is *not* there. **Nothing in the gutter
calls `preventDefault` on mousedown**, unlike every other control that floats
over the writing — the menus do it to keep the caret, and doing it here is
exactly what stops the browser starting a native drag. The handle would open
its menu perfectly and never move anything, and every other check would pass
while it did. Neither control needs the caret anyway: the `+` is told which
block it is beside, and the handle selects one outright.

### Two questions that look like one

A block's position is the position immediately *before* it, which for a bullet
is a position inside its list. So "what block is at this position" and "what
block starts at this position" have different answers, and the gutter — which
remembers a block on hover and re-reads it on every scroll and every
keystroke — needs the second. Asking the first promotes a bullet to its whole
list, quietly, and the handle beside one point comes to hold all six.

`blockAt` and `blockFrom` are that pair, named apart for that reason. The same
trap sits behind `currentBlock`, which reads a held node back rather than
looking its position up.

### Held is not selected

A block held by its handle is a node selection, and the selection bar had to
learn the difference. It used to decide by asking whether there was any text in
the range, which answered a held picture correctly and by accident; a held
paragraph *has* text, so the bar came up over the block that had just been
chosen, covering it and swallowing the pointer. It now asks what kind of
selection it is, which is what was always meant — see the note in
[slash.ts](src/editor/slash.ts).

Held blocks are washed rather than outlined. An outline around a single line of
prose reads as an error state; a fill reads as a selection, which is what every
list and file manager has already taught.

### Not here

**Selecting several blocks at once.** ProseMirror has no such selection, and
adding one means a custom `Selection` class that every command, every
serialiser and the clipboard would then have to understand. One block at a time
is the honest boundary of this pass.

---

## 6. Highlights

[src/editor/Highlight.ts](src/editor/Highlight.ts). Four highlights, named for
the colour they are: **Yellow**, **Green**, **Blue**, **Red**.

They were once named for what they meant — *Check this*, *Might cut*,
*Continuity*, *Aside* — which asked everyone to learn a private vocabulary
before they could mark a sentence. A colour is the one label nobody has to be
taught, and what it means is the writer's to decide. Still four fixed colours
rather than a picker: a highlight should be something you can find again, not a
shade you have to match.

They are marker colours rather than tints: saturated enough that a page can be
scanned by colour alone, which is the one job a highlight has. Dark mode does
not get the same four values — a colour that is bright on white is a light box
on charcoal — so it keeps the hue and the saturation and gives up the
lightness, with 4.5:1 against the prose colour as the floor that decides how
dark each one is allowed to be. Four CSS variables, so the swatch in a menu,
the bar under the highlighter and the mark in the prose cannot drift apart.

Clicking the colour a run already has removes it; a different colour recolours
in place rather than nesting marks. Highlights sit *under* other marks, so bold
text can still be highlighted. Each maps to one of Word's sixteen named
highlight colours on export (yellow, green, cyan, magenta), so a marked run
arrives in an editor's copy as a real Word highlight they can clear from the
ribbon.

**Pages written before the rename still work.** Documents are stored as
ProseMirror JSON, so the old names are still in the database and nothing
rewrites a document it was not asked to change. Every route out of the
attribute — the DOM, the exports, the toggle, the pressed state — goes through
one `toneOf` function, so an old highlight draws, exports and toggles as the
colour it always was on screen.

---

## 7. Images, galleries, covers and stickers

[src/editor/assets.ts](src/editor/assets.ts), [Image.ts](src/editor/Image.ts),
[Gallery.ts](src/editor/Gallery.ts),
[galleryClipboard.ts](src/editor/galleryClipboard.ts),
[ui/PageCover.tsx](src/ui/PageCover.tsx),
[Sticker.ts](src/editor/Sticker.ts), [stickers.ts](src/editor/stickers.ts).

**Images** arrive three ways — paste, drag-and-drop anywhere in the page, or
`/image`. PNG, JPEG, GIF and WebP. Over 32 MB is refused outright; over 2400px on
the long edge is scaled down before storage (never a GIF — that would throw away
the animation; JPEG stays JPEG, everything else re-encodes to PNG so a cut-out
isn't flattened onto black).

The rule that shapes all of it: **a document holds an id and never bytes.** The
id is the SHA-256 of the image itself, so the same picture on six pages is stored
once, and a revision snapshot copies a 64-character string rather than a 200 KB
screenshot every two minutes. Object URLs are cached for the session, in-flight
reads are deduplicated, and a whole document's images are read before it draws so
opening a picture-heavy chapter is one layout flash rather than five.

An image whose asset has gone is left in place and marked missing, not removed.
Orphaned bytes are collected only after a permanent delete — the only honest way
to know what is referenced is to read every document and every revision (and
every page's cover), so it is not worth doing on a timer.

**Galleries** are several images shown as a grid: a real node holding real image
children, not a rule about adjacency. Two or more pictures pasted or dropped at
once arrive as one; `/gallery` makes an empty one to drop into; selecting a run
of images and nothing else offers to group them in the page bar. Each carries a
column count (2, 3 or 4) and its own controls — add, copy all, ungroup. Dropping
onto a gallery adds to that gallery rather than below it. Because the children
are ordinary images, every walk in the app already understands the contents of
one: both exports fall through to the children of a block they do not recognise,
so a gallery exports as its pictures, in order.

**Copy all** puts down two flavours in one write, because the clipboard holds
exactly one image and always will. A file list (`CF_HDROP`) is what Explorer, an
upload box and an image editor read; an `HTML Format` fragment pointing at the
same files is what Word and a mail composer read. The pictures are written to a
folder under the system temp directory first — a page cannot put files on a
clipboard, so this half is Rust ([clipboard.rs](src-tauri/src/clipboard.rs)) and
is Windows-only. The browser build, and the Electron shell, fall back to an HTML
fragment with the bytes inline as data URIs.

**Covers** are a banner across the top of a page: an asset id and a crop offset
on the document itself, not a block in it. A cover therefore survives selecting
everything and typing over it, never lands mid-paragraph after a bad paste, and
stays out of the exports' block walk. Dragging the picture moves the crop one
pixel per pixel — the travel is computed from the image's own aspect ratio
against the frame, which is what `object-position` is a percentage of — and the
arrow keys do the same once it has focus. The offset lives on the page rather
than the asset, so one photograph can be the cover of two pages and sit
differently in each.

**Stickers** are nine pieces of art that ship with the app — Check, Checklist,
Idea, Search, Heart, Party, Coin, Lock, Person — inserted by name or by meaning
from the `/` menu, sized to sit inside a sentence. The document stores only the
id, so the id/file mapping is written out by hand rather than globbed: repoint
`src` freely, never touch `id`. Shipped art is 320px; the 2048px originals live
in [stickers/](stickers/).

Neither reaches for the network. Neither counts towards the word count.

---

## 8. Page links

[src/editor/PageLink.ts](src/editor/PageLink.ts),
[pageLinkView.ts](src/editor/pageLinkView.ts),
[pageLinkClipboard.ts](src/editor/pageLinkClipboard.ts).

An inline atom holding only a page id. The title and icon are looked up every
time it draws, so renaming a chapter updates every mention of it and there is
never a second copy of a title to fall out of step. Four routes in:

- `@` in the prose, which searches your pages by title.
- `@Name` + `Enter` when nothing matches — creates that page inside the one you
  are writing in, and leaves the caret in the sentence.
- **`Ctrl+Shift+N`** — making a page inside the open one drops a link to it at
  the caret, so a parent reads as a table of contents you wrote by accident.
- Right-click → **Copy link**, then `Ctrl+V` anywhere. Both the HTML flavour and
  the plain-text `springboard://page/<id>` form paste as a live link.

Clicking a link opens that page. A link to a page you later archive is left
visible rather than removed — deleting the sentence that pointed at it would be
worse than showing that it is gone. A `label` attribute is written at insertion
and never read by the app; it exists so a copy of the document carries something
meaningful into a file or another editor.

### Backlinks

[src/core/backlinks.ts](src/core/backlinks.ts),
[Backlinks.tsx](src/ui/Backlinks.tsx). The same graph read the other way.

Under the writing, a **Referenced on** list: every page whose prose links to
this one, with the block the first link sits in as context and a `×n` when one
page mentions it more than once. Clicking a row goes there.

- **No index.** The scan walks bodies on demand rather than maintaining a link
  table that import, undo and restore would all have to keep true. On SQLite a
  `LIKE` narrows to the handful of rows that could match before anything is
  parsed; IndexedDB has no such filter and reads every body, which at the size
  one person writes is a few milliseconds.
- **Ids only cross the bridge.** The tree already holds every page's metadata,
  so a title sent from storage would be a second copy — and a stale one, the
  moment the page is renamed.
- **The tree decides reachability.** Storage answers about every body it holds;
  only a subtree *root* carries `archivedAt`, so the renderer filters against
  the live tree rather than storage guessing at it.
- **Nothing when there is nothing.** A page with no references shows no heading
  and no empty state.
- Both walks — [Rust](src-tauri/src/store.rs) and TypeScript — are covered by
  tests that assert the same cases, including that a page never counts as a
  reference to itself.

### Web links

[src/core/links.ts](src/core/links.ts), [data/links.ts](src/data/links.ts).

Ordinary hyperlinks in the prose. `Ctrl+V` over a selection makes that
selection the link; typing a URL autolinks it; pasting from a browser brings
the page's title with it, because the browser already put
`<a href=…>Title</a>` on the clipboard.

- **Clicking opens the machine's browser**, never this window — the page *is*
  the app. Plain click follows; hold `Ctrl` to put a caret in the text instead.
- **Three schemes and no others** — `http`, `https`, `mailto`. Checked in the
  renderer and again in Rust ([`open_external`](src-tauri/src/main.rs)), because
  that is the boundary. A `file:` link would be a double-click on anything the
  account can read.
- **Nothing is ever fetched.** See section 21.

### Code

Inline code and fenced blocks, both from StarterKit, `/code` or ``` ``` ``` in
the prose. Monospace on a tinted panel, in the UI type register rather than the
reading one, so a block reads as *not sentences* at a glance. Long lines scroll
inside the block rather than wrapping, because wrapping code changes what it
says. No syntax highlighting, and that one is deliberate: it would mean
shipping a grammar per language and getting it wrong in the ones we did not.

Out through markdown the fence grows past any backtick run inside it, so a
block containing ``` ``` ``` survives the trip; out through docx it becomes one
`HTMLPreformatted` paragraph per line, and inline code the `HTMLCode` character
style, both declared in the file rather than borrowed from the reader's
template.

### Search

[src/core/search.ts](src/core/search.ts). Titles only, and deliberately so: the
tree holds every page's metadata in memory and leaves the bodies in the database,
so a title search is a pass over an array already in hand and runs between
keystrokes. Ranked in four tiers — exact, prefix, word-boundary, contains — with
ties going to whatever was touched most recently. An empty query returns the
pages you were most recently in, which makes the empty state useful.

### The palette

[Palette.tsx](src/ui/Palette.tsx). `Ctrl+K` anywhere: one box, type, `↑`/`↓`,
`Enter` to go, `Esc` to forget it. The chord toggles, so it also dismisses.

The matching is `searchPages` unchanged — the same four tiers, the same recency
tiebreak, the same breadcrumb trail that tells three pages called "Notes"
apart. It was already written and reachable only from `@` inside the prose.

- **An empty box lists what you were last in**, which is the recents list —
  behind a key rather than pinned to a screen beside two other lists of the
  same pages.
- **Archived pages are left out.** They are outside the tree, and being taken
  to one would strand you there.
- Opens the page **permanent, not preview**: naming a page and going to it is
  the definition of not just browsing.
- It costs no screen until pressed, which is what makes collapsing the sidebar
  a real option rather than a way to lose your work.

---

## 9. Tabs

[src/state/tabs.tsx](src/state/tabs.tsx), [TabStrip.tsx](src/ui/TabStrip.tsx).

- **Preview tabs**, VS Code style: clicking a page in the sidebar reuses one
  temporary tab, so browsing does not bury you. Editing it — or double-clicking —
  makes it permanent.
- **Pinning.** Pinned tabs sort left and take two presses of `Ctrl+W` within 1.5
  seconds to close.
- **`dragDropEnabled` is off** in [tauri.conf.json](src-tauri/tauri.conf.json),
  and it has to be. Left at its default of `true`, Tauri installs an OS-level
  `IDropTarget` on the webview so Rust can receive file drops — and on
  Windows that interception swallows HTML5 drag-and-drop inside the page, so
  dragging a tab draws the no-drop cursor. Nothing on the Rust side listened
  for those events, and turning it off also hands real file drops back to
  `handleDrop` in the editor, which is where the image path expects them.
  Note that synthetic input does *not* reproduce this: CDP mouse events are
  injected inside the renderer and never touch the OS, so both smoke suites
  pass either way. It is only visible to a real mouse.
- **Reorder by drag**, or by keyboard with `Ctrl+Shift+PageUp`/`PageDown` — the
  chord every browser uses for the same job, since `Alt+←/→` are already back
  and forward. A move that would carry a tab across the pinned boundary is
  declined rather than attempted, because the sort would undo it anyway and a
  keypress that changes nothing reads as a dropped one. Middle-click to close.
- **Reopen** the last 20 closed tabs, each back at the index it left from.
- **Session restore** — the whole set returns on launch, with per-tab scroll
  position, cursor **and undo history**.
- A tab whose page has been archived stops existing.
- Selection is the single source of truth: anything that changes the open page
  without going through a tab (back/forward, the archive fallback) gets a preview
  tab automatically.

### Undo that survives navigation

[useDocumentEditor.ts](src/editor/useDocumentEditor.ts). One editor view, many
documents. Switching tabs stashes the whole ProseMirror `EditorState` — document,
selection and history together — and swaps in the state for the tab being opened.
A document opened fresh gets a new `EditorState` rather than `setContent`, so it
starts with an empty undo stack instead of one step that erases the page.

What was argued against and not built: a single global undo stack where `Ctrl+Z`
after navigating silently edits text you cannot see. Neither survives a reload.

---

## 10. Navigation

Per-page back/forward over a 100-entry stack, mirrored into the browser's own
history by index — so `Alt+←`, the mouse's back button and the browser back
button all land in the same place. In the desktop shell the `popstate` half
simply never fires and the rest works unchanged.

---

## 11. Launch

[Welcome.tsx](src/ui/Welcome.tsx), [templates.ts](src/ui/templates.ts).

A greeting with four starting points that open **templates**, not blank pages:

| | opens |
|---|---|
| Make a to-do list | *Today* and *This week*, each with tasks |
| Draft a story | a story folder — premise, people, places — with *Chapter One* inside it, scene break included |
| Plan a project | a folder with *What it is*, *What are you trying to achieve*, *Next*, and a *Notes* page |
| Jot down thoughts | a page dated today, and nothing else |

Typing a name first uses it for whatever is created. Every template is a small
tree rather than a single page, and each stays under a screenful. Every route out
ends with a caret in a page; it never asks a second question; `Esc` skips it
entirely; it can be switched off in Settings.

When the greeting is off, launch puts the caret in the last page you had open —
waiting for the editor element rather than guessing at a delay. First run ever
creates one blank page rather than showing an empty room.

---

## 12. History

[HistoryDialog.tsx](src/ui/HistoryDialog.tsx), plus `revisions` in
[store.rs](src-tauri/src/store.rs) and [idbStore.ts](src/data/idbStore.ts).

- Append-only. Never updated, only inserted and pruned.
- **Coalesced to one snapshot per page per two minutes** of active writing, plus
  an unconditional one on navigate-away, blur, tab-hide and close. A snapshot on
  every 500 ms save would write hundreds of near-identical copies of a chapter
  per session, which the retention policy would then throw away.
- **Retention:** everything from the last 24 hours, hourly for a week, daily
  beyond that, and never the newest revision of any page. One window-function
  pass, run at boot, off the critical path.
- The dialog is **per page** — a writer hunting a cut paragraph knows which
  chapter it came from, and a library-wide timeline would bury it.
- Versions are **rendered, not diffed**, through the editor's own schema and
  serializer — same marks, same scene breaks, same sticker art, images resolved a
  frame later. A word-level diff of prose reads worse than either side of it.
- Timestamps are relative up to a week, then dated. Word counts carry a delta
  against the version before them.
- **Restore snapshots where you are now first**, forced past the coalescing
  window, and lands as a `setContent` so it leaves a step on the undo stack — a
  restore you did not mean costs `Ctrl+Z`, not an afternoon. It goes through the
  editor rather than the store, because the in-memory state is authoritative and
  writing underneath it would be overwritten by the next autosave.

---

## 13. Durability

- The editor state in memory is authoritative. **A database write never blocks
  typing.**
- Autosave 500 ms after typing stops; forced on navigation, blur, tab hide and
  unload. Titles commit 300 ms after typing stops.
- On unload, anything unwritten is stashed **synchronously** in `localStorage`
  ([pending.ts](src/state/pending.ts)) and replayed at next launch. IndexedDB
  writes started in `beforeunload` are not guaranteed to finish; `localStorage`
  writes are.
- `navigator.storage.persist()` is requested at boot so a browser does not evict
  the manuscript under storage pressure.
- SQLite runs in WAL with `synchronous = NORMAL` and foreign keys on.
- **Nightly `VACUUM INTO`** to `Documents/Springboard Snapshots`, once shortly
  after launch as well so a machine that is never left on still gets one. The
  last 30 are kept.
- **Snapshot restore** (desktop): pick a `.sqlite` snapshot, the live library is
  copied aside first with a timestamp, the WAL/SHM of the replaced file are
  removed, and the app restarts. Thirty nightly copies are only a backup if there
  is a way to open one.
- If the database cannot be opened at all, an error dialog names the path and the
  process exits — rather than a window that never appears.

---

## 14. Import

[src/import/](src/import/), [ImportDialog.tsx](src/ui/ImportDialog.tsx).
`Ctrl+Shift+I`.

| Reads | Via |
|---|---|
| `.md`, `.markdown`, `.txt` | own parser, front matter honoured (`title`, `kind`, `icon`) |
| `.docx` | `mammoth` → HTML → the same schema filter a paste goes through |
| `palmanote-export.json` | our own bundle format, parent relationships rebuilt |
| a whole folder | nested directories become nested pages |

- **Nothing is written until you have looked at it.** The dialog previews the
  full planned tree — titles, nesting, word counts — before committing. An import
  that turns out to be forty stray files is a lot to undo one `Backspace` at a
  time.
- Lands at the top of the tree or inside the open page, your choice.
- `03 Chapter Three.md` — the ordering prefix our own exporter writes — is
  stripped back off on the way in.
- Dotfiles are skipped. Directories are processed before their contents so a
  parent always exists first.
- Everything lands as ProseMirror JSON in the schema the editor already has, so
  an imported document is indistinguishable from a typed one.

---

## 15. Export

[src/export/](src/export/), [ExportDialog.tsx](src/ui/ExportDialog.tsx).
`Ctrl+Shift+E`. Every format takes a scope: this page, this page and everything
inside it, or everything.

**Word (.docx)**, two presets, both using Word's *named styles* throughout —
`Heading 1/2/3`, `Normal`, `ListParagraph` attached to real numbering
definitions. Nothing bakes "24pt bold centred" into a run, because a file that
does looks correct and behaves like a brick: no navigation pane, no Google Docs
outline, no restyling a manuscript in one action.

- *Reading copy* — single-spaced, comfortable, for handing to a friend.
- *Manuscript format* — Times 12pt, double-spaced, 1" margins, 0.5" first-line
  indent, chapters on new pages, scene breaks as a centred `#`,
  `Surname / TITLE / page` running header, title page built from the dialog's
  fields.

Images are embedded and scaled to the 6.5" text block (never blown up). Emoji get
their own run with an explicit `Segoe UI Emoji` font, or Word substitutes a box.
Highlights map to Word's named highlight colours.

**PDF** through the print stylesheet — the platform print dialog on the desktop,
the browser's own otherwise. No PDF library.

**Markdown** as one file in tree order, or as a folder mirroring the tree — one
numbered file per page (`01 …`, so the directory reads in tree order rather than
alphabetically) with title, kind, word count, timestamp and id in front matter.

**Everything** — the escape hatch, sitting with the rest rather than hidden in a
menu. Nested markdown, an `assets/` folder of every image named by its own hash
and linked with ordinary relative paths, `palmanote-export.json` holding every
document and every revision, and a `README.txt` explaining the folder to someone
who has never heard of this app. A person with that folder can rebuild the
archive without PalmaNote existing.

Correctness is asserted mechanically in
[docx.test.ts](src/export/docx.test.ts): generated files are unzipped and checked
for heading style ids rather than run formatting, a `numbering.xml` that exists
and is referenced, surviving strikethrough, the explicit emoji font run, and no
run property written as `w:val="false"` that would override a paragraph style.

---

## 16. Reading a PDF alongside

Desktop only. [PdfReader.tsx](src/ui/PdfReader.tsx), `pick_pdf` in
[main.rs](src-tauri/src/main.rs).

Open a PDF in the main window to read beside the writing. The viewer is the one
already inside WebView2 (`mspdf.dll`), so zoom, search, print, page navigation
and thumbnails all come free — bundling pdf.js would have been about half the
size of the whole application.

Deliberately a reader, not a reading *feature*: no annotation, no text
extraction, nothing enters the library. The asset-protocol scope is widened to
exactly the one file that was picked, by the person who picked it.

---

## 17. Theme and settings

**Theme** ([theme.ts](src/state/theme.ts)) cycles system → light → dark from a
button in the top bar. Three states rather than two, because following the
machine is a real preference. It also sets `color-scheme`, so the engine draws
the right scrollbars and form controls.

**Settings** ([SettingsDialog.tsx](src/ui/SettingsDialog.tsx)), `Ctrl+,` — one
question and two switches, on purpose, because anything that needs a switch
usually needed a decision instead:

- *What should it call you* — the name the greeting uses, and the only setting
  the app cannot work out for itself. It sits first because it is the only one
  about you rather than about the app.
- *Animated cursor* — the drawn caret described above. A system-level
  reduced-motion preference overrides it either way, and the dialog says so.
- *Greeting on launch* — read once per session, so turning it off does not close
  a greeting mid-use and turning it on waits for the next launch, which is what
  it says.

Plus a link to the guide.

### What it calls you

The greeting had a name compiled into it — `const OWNER = 'Sesan'` — which was
correct while exactly one person used this and became wrong the moment the
source was published and somebody else built a copy that greeted them by its
author's name.

Empty is the default and is a real answer rather than a missing one:
[`whatToCallYou`](src/state/writingSettings.ts) turns it into **"you"**, so a
fresh build opens on *"Hey you,"*. That matters more than it looks — the name is
in the middle of a one-line greeting, so nothing is not an option; it has to
become a word. "Hey you," is what a person says when they do not know your name
yet, and reads as a greeting rather than as a bug. Whitespace is trimmed on the
way through for the same reason: typing three spaces and getting *"Hey ,"* back
would look like the greeting was broken rather than like an answer to what was
typed.

The settings note shows the greeting it is about to make as you type it, and
says so differently when the greeting is switched off — a field whose only
effect is invisible should say that rather than appear to do nothing.

**The guide** ([guide.ts](src/ui/guide.ts),
[GuideDialog.tsx](src/ui/GuideDialog.tsx)) is every key, gesture and menu in one
searchable place — held as data rather than markup, so adding a shortcut is
adding a line. It lives in the app rather than in a README because the question
"what was the key for a scene break" arrives mid-sentence.

---

## 18. Data model

One recursive table plus two others. [schema.sql](src/data/schema.sql) is the
canonical DDL; [store.rs](src-tauri/src/store.rs) carries the same statements
verbatim, and [idbStore.ts](src/data/idbStore.ts) implements the identical
contract over IndexedDB.

```
documents  id · parent_id (ON DELETE RESTRICT) · position (fractional index)
           title · kind · favorite · icon · cover (asset id) · cover_offset
           content (ProseMirror JSON)
           word_count · created_at · updated_at · archived_at
assets     id (SHA-256 of bytes) · mime · bytes · width · height · created_at
revisions  id · document_id (ON DELETE CASCADE) · content · word_count · created_at
```

Indexed on `(parent_id, position)`, on `archived_at`, on `favorite` where true,
and on `(document_id, created_at DESC)`.

`assets` is owned by no document on purpose: two pages can share an image, and a
revision from last Tuesday can still be rendered because the asset it points at
outlives the edit that removed it. `documents.cover` is the one reference to an
asset that is not a node in a document, which is why the sweep asks for it
separately — without that, the first permanent delete would take every page
banner in the library with it.

The whole storage surface is [store.ts](src/data/store.ts) — every method async,
every argument and return value structured-clone safe, because it doubles as the
IPC contract.

---

## 19. The desktop shell

[src-tauri/src/main.rs](src-tauri/src/main.rs).

- **Frameless window** with caption buttons drawn by the renderer
  ([WindowControls.tsx](src/ui/WindowControls.tsx)). The Rust side emits window
  state on resize/move, so snapping and double-clicking the drag region keep the
  buttons honest.
- **Bounds are remembered**, including the un-maximised size and position, so
  unmaximising after a restart puts the window back where it was.
- **Taskbar icon** is handed over explicitly at 32px, because Windows asks the
  *window* for its icon and would otherwise resample whatever `bundle.icon` names
  first.
- **[capabilities/default.json](src-tauri/capabilities/default.json) is the
  security boundary.** Tauri denies every core command not listed there, and it
  fails quietly — a missing permission logs to the console and the feature simply
  stops. That is why `desktop:smoke` asserts the console is empty.
- **CSP** allows `self` plus `data:`/`blob:`/`asset:` images and the asset
  protocol for frames; the asset scope starts empty and is widened one PDF at a
  time.
- Installer: NSIS, per-user, ~1.8 MB.

---

## 20. Keyboard, complete

Windows bindings throughout — `Ctrl`, never `Cmd`. Anything reachable by mouse is
reachable from here.

**Window** — [App.tsx](src/app/App.tsx)

| | |
|---|---|
| `Esc` | back to the writing, from anywhere |
| `Ctrl+K` | go to page — opens and closes the palette |
| `Ctrl+\` or `Ctrl+/` | show or hide the sidebar |
| `Ctrl+T` | new page in a new tab, caret in the title |
| `Ctrl+W` | close tab (twice if pinned) |
| `Ctrl+Shift+T` | reopen the last closed tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | cycle tabs |
| `Ctrl+1`–`Ctrl+8`, `Ctrl+9` | jump to tab N, last tab |
| `Ctrl+Shift+PageUp` / `PageDown` | move the open tab left / right |
| `Alt+←` / `Alt+→` | back, forward |
| `Ctrl+Shift+E` | export |
| `Ctrl+Shift+I` | import |
| `Ctrl+Shift+H` | history of this page |
| `Ctrl+,` | settings |
| `Ctrl+N` / `Ctrl+Shift+N` | new page after / inside the selected one |

**Editor** — [keymap.ts](src/editor/keymap.ts) + StarterKit

| | |
|---|---|
| `Ctrl+B` / `Ctrl+I` / `Ctrl+Shift+X` | bold, italic, strikethrough |
| `Ctrl+Alt+1/2/3`, `Ctrl+Alt+0` | headings, paragraph |
| `Ctrl+Z` / `Ctrl+Y` | undo, redo |
| `Tab` / `Shift+Tab` in a list | nest, outdent (three levels) |
| `Enter` twice | leave a list |
| `/` , `@` | insert menu, page mention |
| `Alt+Shift+↑` / `Alt+Shift+↓` | move this block up / down |
| `Alt+Shift+D` | duplicate this block |

`Alt+Shift` rather than `Alt` alone, which the tree already uses to reorder rows
and which would otherwise mean two different things depending on where the focus
was. It is also what VS Code and Word use for moving a line. Duplicate is
deliberately not `Ctrl+D`, the obvious one, because that already favourites the
open page at the window level — a chord that means one thing in the sidebar and
another in the writing is worse than a less obvious chord that always means the
same.

**Tree**, when the sidebar has focus — [TreePane.tsx](src/ui/TreePane.tsx)

| | |
|---|---|
| `↑` `↓` | move through rows |
| `←` `→` | collapse / expand, or step to parent |
| `Enter` | open the page |
| `Shift+Enter`, `F2` | rename |
| `Tab` / `Shift+Tab` | nest / unnest |
| `Alt+↑` `Alt+↓` | reorder among siblings |
| `Ctrl+D` | favourite |
| `Backspace` / `Delete` | archive |

---

## 21. What it deliberately does not have

Worth reading as a feature list of its own, since most of these were decided
rather than deferred: no underline, no tables, no text colour, no font sizes, no
alignment controls, no colour picker for highlights, no syntax highlighting in
code blocks, no full-text search of bodies, no global undo stack, no annotation
on PDFs, no auto-collapsing sidebar, no multi-block selection, and no third
switch.

That last one used to read "no third setting", and the name field is the reason
it does not. It is a question rather than a switch — the app cannot work out
what to call you, where it can and does work out everything a third switch would
have asked about. The rule the count was standing in for is intact: still two
things to turn on and off.

**And no link previews.** Cards, unfurling, favicons and fetched titles all
mean the app calling whatever domain you happened to paste, which would tell
that server you have the link and when. The CSP in
[tauri.conf.json](src-tauri/tauri.conf.json) is `default-src 'self'` and the app
opens no sockets. A title still appears when there is one to have: a browser
puts `<a href=…>Title</a>` on the clipboard, so it arrives with the paste and
costs no request. See [core/links.ts](src/core/links.ts).

**Code blocks, hyperlinks and inline code were on this list** until the app
stopped being aimed only at manuscripts. A snippet, a shell command and a
pasted URL are the three things that turn up in notes which prose has nowhere
to put, and the omissions that were right for a novel were wrong for a
workspace.

---

## 22. Gaps and things to check

Honest state, not a wish list.

- **`Ctrl+Shift+H` is bound twice.** [Highlight.ts](src/editor/Highlight.ts)
  binds `Mod-Shift-h` to the yellow highlight, and
  [App.tsx](src/app/App.tsx#L164) opens the History dialog on the same chord at
  the window level. ProseMirror's keymap calls `preventDefault` but does not stop
  propagation, so pressing it while the caret is in the editor should do both.
  Read from the code, not observed — but it wants a decision either way.
- **The docx output has not been opened in Word or Google Docs.** The XML is
  asserted structurally by the test suite; nobody has confirmed the navigation
  pane populates in the real application. That is the one export claim that is
  still unverified.
- **PDF loses a click on Tauri.** WebView2 can print to a file, but Tauri exposes
  no route to `PrintToPdfAsync`, so `printToPDF` opens the platform print dialog.
  Closing the gap means calling WebView2's COM interface from Rust.
- **The [README](README.md) is behind the build.** It still says light-only with
  the dark palette removed, and does not mention import, the `/` and `@` menus,
  page links, images, galleries, covers, stickers, highlights, the icon picker,
  history, the PDF reader, settings, the guide, the animated caret, or the block
  gutter. Everything above is from the source.
- **A dragged block has no keyboard equivalent for crossing levels.**
  `Alt+Shift+↑/↓` moves a block among its own siblings and stops there, which is
  right for an arrow key; the drag can put a block anywhere the schema allows.
  Whether the keyboard should be able to do the same, and with what chord, is
  undecided rather than answered.
- **`npm run dist` (Electron) fails on this drive** with `EPERM … rename` — the
  volume rejects the directory rename electron-builder does at the end. Building
  to another output path works. Not a config problem.

---

## 23. Proving it

| | |
|---|---|
| `npm test` | storage, fractional ordering, markdown import and export, docx structure, the gallery grouping rule, and what a block is and where it goes (`node --test`) |
| `npm run test:rust` | the Rust store, ordering keys, the clipboard payloads, and a library from before covers existed (`cargo test`) |
| `npm run smoke` | drives the browser build in real Chrome — including killing a tab mid-sentence and checking the sentence survived, and dragging a block with real mouse events, which is the one gesture no unit test stands in for |
| `npm run desktop:smoke` | drives the packaged desktop build over CDP, and asserts the console is empty |
| `npm run scale` | writes 122,400 words across 63 documents, times what a writer would feel, and verifies its own cleanup |
| `npm run capture` | draws the running interface into an SVG with named, nested layers — artwork to animate from, not a feature of the app |

The scale run's measured numbers against their budgets:

| | measured | budget |
|---|---:|---:|
| listing every document | 3.5 ms | 100 ms |
| reading a chapter from SQLite | 3.4 ms | 100 ms |
| expanding the tree to 66 rows | 2.8 ms | 150 ms |
| switching chapters | 73 ms | 200 ms |
| keystroke to painted frame | 17 ms | 33 ms |
| autosaving a full chapter | 12 ms | 100 ms |

17 ms is one frame — as fast as anything can be. The budget is two, because
budgeting for one would be budgeting for the impossible.
