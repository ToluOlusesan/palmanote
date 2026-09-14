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
| Files out | native save/folder dialogs | File System Access API, else one zip |
| Files in | native picker, whole folders walked in Rust | `<input type="file">`, `webkitRelativePath` |
| PDF reading | yes, WebView2's own viewer | no |
| Backups | nightly `VACUUM INTO` Documents, last 30 kept | none — the note at the foot of the window says so |
| Snapshot restore | yes | no |
| Two of it at once | one window, and the question does not arise | the second tab is declined |

The app was called Springboard until 13 August 2026, and every name that
*addresses* something keeps that spelling on purpose: the bundle identifier
`com.springboard.app`, the library file `springboard.sqlite`, the IndexedDB
database `springboard`, the `springboard://page/<id>` link form, the
`Documents/Springboard Snapshots` folder and the `springboard-<stamp>.sqlite`
files in it. Renaming any of them would leave an existing install launching
happily onto an empty library. Electron pins `userData` to the old folder for
the same reason — see the note at the top of [electron/main.ts](electron/main.ts).
These are addresses, not titles.

The other side of that rule: anything a person *reads* is spelled the way the
product is. The Rust crate stays `palmanote` — a crate name is an address — but
`mainBinaryName` in [tauri.conf.json](src-tauri/tauri.conf.json) renames the
binary at bundle time, so what installs is `PalmaNote.exe` rather than a
lower-case file inside a `PalmaNote` folder from a `PalmaNote` installer. The
publisher is set for the same reason: left alone, Tauri takes it from the
identifier's middle segment and Windows lists the app under `springboard`. It
is **Spatial Foundry**, the same shelf Palma Canvas is on.

One wrinkle worth knowing when testing an upgrade: Windows keeps the *existing*
directory entry's spelling when a file is replaced in place, so installing over
an older build can leave the old lower-case name on disk with the new bytes
inside it. Uninstall first if you want to see what a new machine gets.

The seam is [src/data/bridge.ts](src/data/bridge.ts) — twenty-odd methods,
resolved once at load. Nothing above that file knows which shell it is in.
[tauriBridge.ts](src/data/tauriBridge.ts) implements it over `invoke`;
[electron/](electron/) still holds the older implementation of the same contract.

### The browser build

The same source, served as static files, published from
[.github/workflows/web.yml](.github/workflows/web.yml) on every push to `main`.

It is **published** to `toluolusesan.github.io/palmanote/` and **served** at
**<https://palmaboard.com/note/app/>**, which proxies it. The distinction is
not cosmetic: a browser's storage belongs to the origin that served the page,
so the address people are given is the address their library lives at, and
moving it later strands everything written before the move. The published
permalink carries no version, so shipping a build never touches the site that
fronts it.

`base` is `./`
in [vite.config.ts](vite.config.ts) and every path in
[index.html](index.html) goes through `%BASE_URL%`, so the same `dist/` works
at a domain root, in a subdirectory, and over `file://` in the desktop shell.
There is no server, no API and no build step at request time; moving it to
another host is a copy.

It is the whole app rather than a preview of one — but a tab is not a window
and a browser is not a disk, and four things follow from that.
[WebShell.tsx](src/ui/WebShell.tsx) holds the three that are visible, and every
branch is behind `isDesktop`, so the installer builds exactly what it built
before any of this existed.

- **A second tab is declined.** Two tabs each hold the whole library in memory
  and each autosave it back, so the second write wins — silently, with nothing
  in the history to recover, because the losing tab never knew it lost. A Web
  Lock in [soleTab.ts](src/state/soleTab.ts) settles it *above* the providers,
  so a tab that will not be allowed to write never opens the library at all.
  When the first tab closes, the second is offered a reload rather than handed
  the library: its copy is whatever it read at boot, and taking over with that
  in hand is the same overwrite by a slower route. A browser too old for Web
  Locks is let through — the race is a risk, and locking someone out of their
  own pages over a risk is worse than the risk.
- **An export leaves as one file.** Chromium hands the File System Access API a
  real folder; Firefox and Safari have neither, and one `<a download>` per file
  makes a forty-page export forty prompts. [zip.ts](src/data/zip.ts) is a zip
  writer of our own — deflate through `CompressionStream`, stored where that is
  missing, no dependency — and [zip.test.ts](src/data/zip.test.ts) reads the
  archives back with `node:zlib` rather than with itself, because an archive
  only its own author can open is not an export.
- **A phone is told, and then let through.** Below 44rem the sidebar, the tabs
  and the margin the block handle lives in have nowhere to go. The screen says
  so and offers the door anyway: someone who wants to read a page they wrote on
  their laptop has every right to, and a link that refuses to open is not a
  link. Asked once at boot rather than watched — a live media query would
  unmount the app mid-paragraph the moment a window was dragged narrow.
- **Where the work is kept is said once**, at the foot of the window, before
  there is anything to lose. `navigator.storage.persist()` is requested at boot
  ([library.tsx](src/state/library.tsx)) and a manifest makes the app
  installable, which is the other half of the same argument: a browser grants
  persistent storage to an app someone installed, and persistent storage is the
  difference between a library that survives a quiet fortnight and one the
  browser is within its rights to evict.

### Motion

One vocabulary, at the end of [styles.css](src/app/styles.css) — two ease-out
curves (`--ease`, `--glide`) and three durations (`--quick` 120ms, `--settle`
190ms, `--unfold` 280ms), and almost nothing outside them. Gathered
in one block rather than spread through the file, because the difference between
an interface that feels considered and one that feels assembled is not how much
it animates but whether everything animates the same.

Three rules cover the surface: anything a pointer can touch answers at
`--quick`; anything that appears out of nothing rises four pixels while it
fades, so it reads as having come from somewhere; anything pressed dents by 7%
and comes back faster than it went. The selection bar is the one thing that goes
further — its controls arrive in sequence rather than together, which is what
makes it read as a thing that came to you.

**Ease-out only, no spring.** There was a `--spring` here that overshot by a
hair and came back, on menus, the selection bar and the dialog. The Palmaboard
motion spec rules it out across the family and the family wins — a bounce in one
app of three reads as a bug in the other two. What did the work in those cases
was the four-pixel rise, and that stays.

Nothing loops, nothing runs longer than 280ms, and one media query at the foot
of the file turns all of it off under `prefers-reduced-motion` — durations
rather than `animation: none`, so anything animating *into* its resting state
still ends up there.

### Brand

Two layers, and they do not bleed into each other.

**Interior** — the app someone actually works in — is paper, ink, grey and one
accent. **Cobalt `#1D5FFF`** is `--accent`: buttons, links, selection, the
caret, focus rings, active state, a starred page, and the hue the writing
chart's four steps are mixed from. Dark runs `#6C97FF`, the same hue a third of
the way to white, because cobalt itself only reaches 3.4:1 on the dark card and
anything carrying a word needs 4.5.

**Identity** — the app icon, the installer, marketing — is the one place the
brand is allowed to be loud: a **Cobalt → Violet `#7C5CFF`** diagonal with the
artwork knocked out in white and no second colour inside the mark. It lives in
[make-icon.mjs](scripts/make-icon.mjs) and nowhere else. In the window the mark
is flat `currentColor` — ink on paper, near-white on the dark card.

There was an Amber in here for a day: the streak figure, the star, the ring on
today. It is gone, and the reason is the rule rather than the colour. A second
decorative hue is invisible one element at a time and reads as unplanned once
there are three of them, and it spends the only thing a single accent has —
meaning something *because* it is the only colour on the screen. If an interior
element needs emphasis it takes the accent; if it is a system state it takes
that role's colour; there is no third option.

The old two-stop Cobalt→Amber gradient also had a mechanical problem worth
recording, because it is why Violet is the right second stop: those two sit near
enough to opposite that every path between them is grey through the middle, in
OKLab as much as in sRGB. Cobalt and Violet are neighbours, so the run stays
saturated end to end and neither stop has to be held back.

### Paper

The surface is a material, not a colour. The same near-white tones and the same
static fractal-noise tile the rest of the Palmaboard family uses — one 200px
SVG, multiplied over the surface in light, `overlay` in dark where multiply has
nothing to bite on. Static on purpose: grain that re-positions as something
scrolls forces a repaint every frame and, at these opacities, is
indistinguishable from grain that stays put.

**One surface, not two.** There was a white card here, bordered and shadowed,
floating on the window's grey, with its own fainter grain — so the paper under
the prose and the paper around it were two materials meeting at a seam. The
writing area should not be discernible from its background, so the card is
gone: the editor is transparent, the sticky page bar and status bar take the
window's own tone, and one grain layer runs under the whole thing unbroken at
0.18 (0.32 in dark) — felt at the edges of the window, gone under a sentence.

That also settles the "no grain under active text entry" rule the honest way. A
flat panel behind the sentence would itself have been a discernible patch; one
continuous surface at an opacity that vanishes under reading is what the rule is
protecting, and this is under it everywhere rather than switched off in one
place. Dialogs, menus and the palette still get none — they are *above* the
paper rather than made of it, and grain on every white rectangle is how a
material turns into a texture effect.

### Type

The platform stack, and nothing shipped. Inter and DM Serif Display were
vendored out of `@fontsource` for a day and taken back out: Inter at 400 sets
noticeably heavier than the platform UI face at the sizes this app uses, so the
prose came out thick, and the serif on the greeting was a voice the app did not
want. Whatever the machine already has is lighter, better hinted at small sizes,
and costs nothing to load — which also keeps the promise that the app fetches
nothing.

Chrome runs regular and medium and stops there; the 600s that had crept into
dialog titles, section labels and the guide are now 500. The only weights above
that are in the document's own typography — the page title and prose headings —
where they are the writer's, not the interface's.

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
scene break, page links, web links, inline code, code blocks, tables, stickers,
images, galleries.

**Deliberately not in it:** underline, text colour, font sizes, alignment.

That first list has grown three times and the second has only ever shrunk,
which is worth watching rather than being pleased about — every addition costs
the claim above it. Paste-stripping is free *because* the schema is small, so
each new node is one more thing a web page can now put in a document. Tables
are the first one where that mattered enough to need an answer of its own — see
**Tables**, below.

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

### Tables

A grid of cells you type prose into. `/table` makes a 3×3 with a header row;
`Tab` moves to the next cell and makes a new row off the end of the last one,
which is what makes a table fillable without reaching for the mouse. Cells hold
paragraphs and lists like anywhere else in the document, and a table is a block
like any other — the gutter handle picks the whole thing up, `Alt+Shift+↑/↓`
moves it among its siblings.

**A table is not a database, and the distinction is the whole reason this was
allowed in.** What is here is the thing Word has: rows, columns, words. What
stays ruled out is rows-as-records — typed columns, filters, sorts, saved
views. That is a different product living inside this one.

Nothing about it is decorative. No cell colour, no alignment controls, no
column types, no totals row. **No column resizing either**, which is the one
worth arguing about: it is the most-asked-for thing about a table and it is
also how a writing surface becomes a layout surface — the same argument that
keeps images at one width. It would also mean a `colwidth` array on every cell,
and a cell attribute is copied into a revision snapshot every two minutes for
as long as the page lives. Automatic layout sizes a column to what is in it. A
table wider than the measure scrolls inside its own box rather than dragging
the column of prose sideways under the reader.

**Paste is where tables cost something.** The claim in
[extensions.ts](src/editor/extensions.ts) — that stripping a paste is free
because ProseMirror cannot parse a node type that does not exist — was true of
tables until they existed. `<table>` is two different things wearing one tag: a
grid of data, and a box drawn around a page, which is what a decade of HTML
email uses it for. [pastedHtml.ts](src/editor/pastedHtml.ts) answers the second
with the one signal that separates them reliably — **a table with one cell is
not a table** — and unwraps those, repeatedly, because layout tables nest. Two
cells and up are left alone, because past one the guess stops being safe.

Out through markdown a table is a GFM pipe table, which costs it two things
markdown cannot say: a cell holds one line, and every table gets a header row
because GFM has no table without one (a table that never had one is written
under an empty header and read back off). Out through docx it is a real
`<w:tbl>` with declared borders and a `tblHeader` row Word repeats across page
breaks — not tab stops, and not a picture of a table.

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

### The context menu

[EditorContextMenu.tsx](src/ui/EditorContextMenu.tsx). Right-clicking the
writing opens the app's own menu rather than the one the engine draws — five
items: cut, copy, paste, duplicate this block, delete this block.

Replacing the system menu is a decision that has to earn itself, because that
menu works everywhere and this one has to. What earns it: WebView2's menu
offers to *reload the page*, which in an app that **is** the page is an offer
to close the library.

- **Paste goes through the door Ctrl+V goes through.** It reads the clipboard
  and then dispatches a real paste event at the editor, rather than inserting
  the content itself, because the two are not the same path — a paste runs
  `handlePaste` (image data becomes a stored asset, a `springboard://page/…`
  becomes a live page link) and then `transformPastedHTML`, which is the strip
  that keeps a web page's `style` and `class` off the nodes and unwraps a table
  drawn round a layout. Inserting the HTML directly would be a second, dirtier
  way in, and it would be the one nobody tested.
- **Cut and copy go through `document.execCommand`**, which fires the editor's
  own clipboard handlers, so a marked-up run lands on the clipboard as the same
  HTML `Ctrl+C` puts there.
- **The selection is read on mousedown, in the capture phase.** ProseMirror
  answers the right button by moving the caret, so by the time `contextmenu`
  arrives the selection somebody right-clicked *in order to copy* has already
  gone, and the menu came up with cut and copy greyed at exactly the wrong
  moment. Putting it back is a dispatch straight at the view rather than an
  `editor.chain().focus()`: Tiptap's focus is deferred and re-derives the
  selection from the DOM a frame later, which quietly undid the restore about
  one time in three.
- **And where the state disagrees with the screen, the screen wins.** A
  selection made with the keyboard is the browser's own doing; ProseMirror
  learns of it from `selectionchange` and folds it in on its next flush, so a
  right-click landing before that flush found a state that still said nothing
  was selected — words plainly highlighted, cut and copy greyed. It reads the
  DOM selection through `posAtDOM` when the state looks empty. This is the
  fault the smoke suite failed on intermittently for six runs before it was
  understood, and the intermittency was the whole tell: it was a race, not a
  rule.
- **Greyed rather than gone**, so the menu's shape never changes between
  openings — and a greyed item keeps its shortcut beside it, which is the route
  that still works.

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
- The bar carries **one thing that is not a mark**: a comment on the held
  words. It belongs here for the reason the bar exists — it is done *to* words
  that already exist rather than put down where the caret is — and it is
  allowed in where a sticker or a picture is not, because it marks the
  selection rather than eating it.
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
- **Drag a page out of the sidebar and drop it into the prose.** The drag carries
  a private page flavour for PalmaNote, HTML and `springboard://` flavours for
  anywhere else; over the tree the same gesture remains a move, while over the
  editor it inserts a live reference at the drop point.

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

- **A `+` at the end of the strip**, where every browser keeps one, doing
  exactly what `Ctrl+T` does — one function behind both, so they cannot come to
  mean slightly different things. It is drawn even when no tabs are open, which
  is when a way to start one is most worth having.
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
- **A right-click menu** carries New, Pin/Unpin, Close, Close others, Close to
  the right, Reopen and Close all. Relative closes leave pinned tabs alone;
  Close all is literal and leaves the workbench empty until a page is opened or
  a closed tab is restored.
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

### The first launch

[Tutorial.tsx](src/ui/Tutorial.tsx). Five coachmarks, each dimming the window
except a cutout around the actual control it is about — the sidebar, the tab
strip, the page, the notes switch, the guide. Taught on the real interface
rather than on a drawing of it, because a tour that draws its own picture of a
button teaches you a picture.

It ends by handing over to the guide rather than trying to be one: five cards
cannot hold thirty shortcuts and should not try. This teaches the shape of the
room; `F1` holds the detail for the rest of the time you use the app, and
"Show me around again" in the guide's footer puts the tour back.

Shown once, after the greeting is answered — the tour is about the writing
surface and the greeting is still covering it until then. Leaving is one press
and is offered on every card, because a tour you cannot get out of is a modal
dialog wearing a friendly hat. The browser build's note about storage waits
until the tour is done: two things introducing themselves at once is neither of
them being read.

A greeting with four starting points that open **templates**, not blank pages.
**The mark at the top of the sidebar comes back here** — every app whose logo
sits in a corner has taught that pressing it goes home, and this one had a home
that was reachable only by relaunching. Going back unmounts the editor, which
is the one way of leaving a page the autosave has no hook for, so the window
flushes what is on screen before it takes the pane away.

| | opens |
|---|---|
| Make a to-do list | *Today* and *This week*, each with tasks |
| Draft a story | a story folder — premise, people, places — with *Chapter One* inside it, scene break included |
| Plan a project | a folder with *What it is*, *What are you trying to achieve*, *Next*, and a *Notes* page |
| Jot down thoughts | a page dated today, and nothing else |

The screen is the brand mark over a single question — *What do you want to do
today?* — and nothing else. It was a greeting and a question on two lines, then
one line with a name in it; both were the longer way to ask. Typing a name first
uses it for whatever is created. Every template is a small
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
  the manuscript under storage pressure. It is a request rather than a
  guarantee — the browser decides, and it decides more readily for an app that
  has been installed, which is what the manifest is for. Everything below this
  line is the desktop build's, and the browser build has none of it: that is
  what the note at the foot of the window is admitting.
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
| `.png` `.jpg` `.gif` `.webp` | not pages — assets, for the markdown that points at them |
| a whole folder | nested directories become nested pages |

### What the markdown reader understands

Two jobs, and they pull in different directions exactly once.

The first is that **the round trip is the specification**: anything
[export/markdown.ts](src/export/markdown.ts) can write,
[import/markdown.ts](src/import/markdown.ts) has to read back as the document
it started as, which means the two have to agree about escaping character for
character. They had drifted, each correct alone and wrong about the other, and
five documents came back changed:

- A literal `~~` or `==` in a sentence came back struck through or highlighted.
  The reader had always unescaped `\~` and `\=`; nothing ever wrote them. Only
  the *pairs* are escaped now — `a = b` and `~5kg` stay clean.
- Every hard break came back with two spaces welded to the end of the text,
  because the rule matched the newline but not the whitespace in front of it.
- A numbered list starting at 5 came back starting at 1.
- A sticker was written as `:party:` and read back as the literal text.
- A picture was written as `![alt](path)` and read back as a stray `!` in front
  of a hyperlink, because the link rule was asked first.

The second job is **markdown written somewhere else**, where the reader was
narrower than it looked:

- A paragraph wrapped at eighty columns became a column of short lines. There
  are two kinds of line ending and they are told apart by trailing whitespace;
  every newline was being treated as the second kind.
- `some_variable_name` came out italic. `_` may no longer open or close against
  a word character, which is CommonMark's rule and matters in an app that holds
  shell commands. `*` keeps no such restriction.
- A heading underlined with `===` or `---` became a paragraph followed by a
  scene break, because `---` is both and the divider was asked about first.
- Reference-style links (`[text][ref]`) and `<https://autolinks>` were text.
  Definitions are lifted out of the prose, and not from inside code blocks.
- Tab-indented sub-lists nested by luck at one level and wrongly below it.
- `####` and deeper are clamped to the third heading rather than quietly
  becoming paragraphs.

**Bare URLs are deliberately still not linked**, and that is where the two jobs
disagree. `<https://…>` is markdown asking for a link. `https://…` in a
sentence is not, and linking it would mean a writer who deliberately unlinked a
URL found it linked again every time the page went out to a file and came back.
The editor autolinks what is *typed*, which is where that belongs.

Pictures are the one thing the reader cannot finish on its own: it is a pure
function from a string to JSON, with no filesystem and no store, so it records
the path and stops. [import/index.ts](src/import/index.ts) resolves that path
against the chosen files three ways — relative to the markdown file, relative
to the root of what was chosen, then by filename if exactly one file has it —
and stores the bytes through the same `storeImage` a paste uses, at commit
time rather than at preview time, because storing is writing. A picture that
cannot be found is left as a *missing* image rather than dropped. Anything with
a scheme in front of it is skipped without being looked for: the app fetches
nothing.

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

**PDF is not here.** It was the print stylesheet handed to the platform's own
print dialog, and it is out of the app entirely while it is rebuilt — the
format, the branch in the dialog and `printToPDF` on the bridge, in both
shells. The stylesheet stays, because that is what it will be rebuilt on and
because Ctrl+P is a thing a browser does whether or not this app has an
opinion about it.

**Markdown** as one file in tree order, or as a folder mirroring the tree — one
numbered file per page (`01 …`, so the directory reads in tree order rather than
alphabetically) with title, kind, word count, timestamp and id in front matter.
Tables go out as GFM pipe tables.

A picture is linked with however many `../` it takes to climb from the page
back to the `assets/` folder at the root. Every page used to link `assets/x.png`
as though it were a sibling of that folder, which is correct for the pages at
the top and resolves to nothing from the second level down — an export that
looked right and had holes in it everywhere below the first tier. The README
inside it promises these are "ordinary relative links"; this is what makes that
true rather than nearly true.

**Everything** — the escape hatch, sitting with the rest rather than hidden in a
menu. Nested markdown, an `assets/` folder of every image named by its own hash
and linked with ordinary relative paths, `palmanote-export.json` holding every
document and every revision, and a `README.txt` explaining the folder to someone
who has never heard of this app. A person with that folder can rebuild the
archive without PalmaNote existing.

**What the file is called** is asked in the dialog, in a field prefilled with
the page's own title. It matters most on the web, where there is no save dialog
to correct a name in — the download takes whatever it is handed. The suggestion
follows the scope and stops following it the moment the writer types, because a
field that rewrites itself under your hands is worse than one that does
nothing; the extension sits *outside* the box, because getting it wrong is how
a file arrives called `chapter.docx.docx`. And the scope now defaults to the
page in front of you rather than the whole library, which is both the commoner
want and the reason a Word export used to come out called `PalmaNote`.

**How the files land** is [files.ts](src/data/files.ts), and nothing above it
knows which of the three ways ran: a native save dialog in the desktop shell, a
real folder through the File System Access API in Chromium, or a download. That
last one used to be one prompt per file, which made a folder export of a
library an argument with the browser; it is now a single `.zip` of the same
shape, and only a genuinely single-file export — one `.docx`, one `.md` with no
pictures — still comes down as itself.

**The Word file is packed as an `ArrayBuffer`.** It was a Node `Buffer`, which
a browser does not have, so the first person to export a Word document from the
web build got "nodebuffer is not supported by this platform" — and nothing
caught it, because every test of the docx writer runs in Node, where a Buffer is
exactly what you get. `npm run smoke` now presses the button rather than only
reading the dialog: it takes `showDirectoryPicker` away so the export goes down
the downloads route Firefox and Safari take, waits for the file, and checks it
begins `PK`. A check that reads a dialog proves the dialog.

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

**The guide** ([GuideDialog.tsx](src/ui/GuideDialog.tsx),
[guide.ts](src/ui/guide.ts)) is on `F1` and on a `?` in the top bar. It was
reachable only through a link inside Settings, which is the discoverability
version of a locked room with the key inside: a list of thirty shortcuts is
worth nothing if finding it needs a shortcut you would have had to read the
list to know. It is a reference rather than a tour — searchable, sectioned,
and openable mid-sentence, because that is when the question actually arrives.

**Settings** ([SettingsDialog.tsx](src/ui/SettingsDialog.tsx)), `Ctrl+,` — two
switches, on purpose, because anything that needs a switch usually needed a
decision instead:

- *Animated cursor* — the drawn caret described above. A system-level
  reduced-motion preference overrides it either way, and the dialog says so.
- *Greeting on launch* — read once per session, so turning it off does not close
  a greeting mid-use and turning it on waits for the next launch, which is what
  it says.

Plus a link to the guide.

### What it used to call you

There was a name here. The greeting had one compiled into it — `const OWNER =
'Sesan'` — which was correct while exactly one person used this and wrong the
moment somebody else built a copy and got greeted by its author's name. So it
became a setting, with `whatToCallYou` turning an empty one into **"you"** so a
fresh build opened on *"Hey you,"* rather than *"Hey ,"*.

All of it is gone, and the order it went in is the point. The greeting became
one line — *"Hey you, what do you want to do today?"* — and then lost the
greeting half of that, leaving just the question. At which point the name had no
reader at all, and a setting whose only effect is invisible is worse than no
setting: it is a control that appears to do nothing. The field, the stored
value, the helper and its tests all came out together rather than leaving a
switch behind to explain.

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
- **The whole title bar drags** — the top strip and the sidebar's head, wherever
  they are not a control. Two things about `data-tauri-drag-region` are worth
  knowing before touching it, because both fail silently:
  - The **bare** attribute means *only when this element is the topmost thing
    under the pointer*. Tauri compares it against `composedPath()[0]`, so any
    full-window overlay — the first-launch tour dims from an `inset: 0` panel —
    turns it off. `deep` matches anywhere in the subtree and survives that.
    Electron's `-webkit-app-region` is computed from the layout tree instead and
    was never affected, which is how this stayed invisible on that side.
  - A bare or `deep` attribute **ends the upward walk**. A child carrying the
    bare attribute therefore *hides* a `deep` on its parent rather than adding to
    it, which is worth remembering when the two are nested — and here they are.

  Tauri stops the walk at the first `<button>`/`<a>`, so the tabs and the icons
  keep their clicks with nothing declared. Electron subtracts nothing on its own,
  so each one is named `no-drag` in [styles.css](src/app/styles.css).
- **The reserved gap does not shrink.** `.drag-region` is `flex: 1 0 5rem` — a
  floor, not a size. It used to be `flex: 1; min-width: 1rem`, and a gap is the
  first thing a row of tabs eats: with three pages open the only way to move the
  window was a ~35px sliver between two icons. `desktop:smoke` now asserts the
  shrink factor, because that is the part a screenshot cannot show.
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
- Installer: NSIS, per-user, 2.7 MB — `src-tauri/target/release/bundle/nsis/`.

---

## 20. Keyboard, complete

Windows bindings throughout — `Ctrl`, never `Cmd`. Anything reachable by mouse is
reachable from here.

**Window** — [App.tsx](src/app/App.tsx)

| | |
|---|---|
| `Esc` | back to the writing, from anywhere |
| right-click | cut, copy, paste, and the block under the pointer |
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
| `Ctrl+Space` | a sticky note in the rail |
| `Ctrl+Shift+Y` | your writing — opens and closes the chart |
| `Ctrl+,` | settings |
| `F1` | the guide — opens and closes it |
| `Ctrl+N` / `Ctrl+Shift+N` | new page after / inside the selected one |

**Editor** — [keymap.ts](src/editor/keymap.ts) + StarterKit

| | |
|---|---|
| `Ctrl+B` / `Ctrl+I` / `Ctrl+Shift+X` | bold, italic, strikethrough |
| `Ctrl+Alt+1/2/3`, `Ctrl+Alt+0` | Heading, Subheading, Small heading, Text |
| `Ctrl+Z` / `Ctrl+Y` | undo, redo |
| `Tab` / `Shift+Tab` in a list | nest, outdent (three levels) |
| `Tab` / `Shift+Tab` in a table | next cell, previous cell — a new row off the last |
| `Enter` twice | leave a list |
| `/` , `@` | insert menu, page mention |
| `Alt+Shift+↑` / `Alt+Shift+↓` | move this block up / down |
| `Alt+Shift+D` | duplicate this block |

`Tab` now means three things, and [keymap.ts](src/editor/keymap.ts) is the only
place that knows the order to ask in: nest, if the caret is in a list; next
cell, if it is in a table; otherwise move focus onward, which is what a
keyboard user needs it to keep doing. The order matters where the two overlap —
a list *inside* a table cell is still a list, so `Tab` in one nests rather than
jumping to the next cell. Declining is a decision there rather than a default,
because this extension sits above both the list and table bindings.

`Alt+Shift` rather than `Alt` alone, which the tree already uses to reorder rows
and which would otherwise mean two different things depending on where the focus
was. It is also what VS Code and Word use for moving a line. Duplicate is
deliberately not `Ctrl+D`, the obvious one, because that already favourites the
open page at the window level — a chord that means one thing in the sidebar and
another in the writing is worse than a less obvious chord that always means the
same.

The chart is `Ctrl+Shift+Y` for the same reason and not `Ctrl+Shift+W`, which
fits "writing" far better: the tab-close above it does not test `Shift`, so that
chord already closes a tab and would go on doing so first.

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
rather than deferred: no underline, no text colour, no font sizes, no
alignment controls, no colour picker for highlights, no syntax highlighting in
code blocks, no full-text search of bodies, no global undo stack, no annotation
on PDFs, no auto-collapsing sidebar, no multi-block selection, and no third
switch.

**And no databases.** Rows as records, typed columns, filters, sorts, saved
views — the thing Notion is actually for. That is settled rather than pending,
and it is not the same question as tables, which are here: a table is a grid of
prose, and a database is a store with a query language and several faces. This
app already has a store, and it is the one under the whole library.

**Tables were on this list** until the same argument that took code blocks off
it. The omissions that were right for a manuscript were wrong for a workspace,
and a table is what notes use for the shape prose has nowhere to put — two
things compared, a set of rates, who is doing what. What made it a decision
rather than a default is that it is the first node that cost something to add:
see the note on paste under [Tables](#tables). The rule the old entry was
standing in for is intact and is about the *interface* having opinions — no
cell colour, no alignment, no column types, no widths.

That last one used to read "no third setting", and the name field is the reason
it does not. It is a question rather than a switch — the app cannot work out
where it can and does work out everything a third switch would
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

## 22. Sticky notes, and comments

[StickyNotes.tsx](src/ui/StickyNotes.tsx), [stickies.ts](src/state/stickies.ts),
and the `sticky_notes` table in [schema.sql](src/data/schema.sql).

- **`Ctrl+Space` puts one in the rail**, wherever the caret is, with the caret
  in it. Bound at the window rather than in the editor's keymap, so it works
  from the sidebar and the title field too. `Ctrl+Alt+M` — Word's chord — makes
  a **comment** on the words being held instead, and both are in the
  right-click menu.
- **A comment is a sticky that points at something**, and that is the whole of
  the difference: one nullable `anchor` column holding the id of a `comment`
  mark in the prose ([Comment.ts](src/editor/Comment.ts)). Everything else —
  the rail, the four papers, the debounced write, the promise that none of it
  exports or counts — is shared, because both are the same object: the aside
  you write *while* writing something else.
- **The anchor is a mark, not a stored position.** A position recorded when the
  comment was written is wrong the moment a paragraph is inserted above it; a
  mark is carried by the text it is on, so it survives editing, reordering,
  undo and a restore from history with nothing keeping it in step. `inclusive:
  false`, so typing at either end of a commented run does not silently swallow
  the new words.
- **Only the id is in the document.** The comment's text stays in the table
  beside the stickies, which is what keeps every promise the stickies made: it
  does not export, does not count towards the page, and is not copied into a
  revision snapshot every two minutes. What the document holds is a marked run
  and a 36-character string.
- **Commented words wear a dotted accent underline**, not a wash. The four
  highlight colours are the writer's to mean things with, and a comment cannot
  take one without spending a colour that is already spoken for.
- **Deleting a comment takes the mark off the words**, wherever they ended up —
  found by walking the document for the id rather than by a remembered range,
  because by then the sentence may have been cut in half and half of it bolded.
- **A comment whose words are gone says so** rather than quietly vanishing. It
  is asked at the moment of the click, not tracked: the answer changes with
  every keystroke and nothing should be watching a document to keep a badge
  honest. The thought was still worth having, and throwing it away is the
  writer's to decide.
- **Not part of the document.** A sticky is the aside you write *while* writing
  something else — a name to check, an argument with yourself. So it does not
  export, does not count towards the page's words, is not in a revision, and
  deleting it takes nothing with it. Keeping them as nodes in the ProseMirror
  doc would have made every one of those false, which is why they are a table.
- **The rail can be put away** — `Ctrl+Shift+Space`, a control at the top of
  the rail, or the note button in the **page bar**, beside bold and the
  headings, which is also how it comes back and says how many notes are waiting
  behind it. It sat in the window's top bar for a version, next to settings and
  the theme, which is where the *window's* switches live; this is not one of
  those. It is about the page in front of you. There is a thin strip at the
  window's edge too, mirroring the sidebar's, but a hidden control is a poor
  way to undo hiding something. `Ctrl+Space` opens the rail before adding to
  it, because writing into a closed drawer is not a feature. The state sits
  beside `treeVisible` in `palmanote:ui`, since that is where the window's
  layout is remembered.
- **A fixed rail down the right**, outside the element that scrolls, so notes
  hold still while the prose moves under them. They have no position of their
  own and stack in the order they were written. They were draggable for a
  version and it was wrong twice over: a thought parked over the third
  paragraph is lost the moment the page is edited above it, and a note that can
  be anywhere is a note you have to go looking for.
- The rail is inert between the notes — `pointer-events` come back only on the
  notes themselves — so the gaps are still window, and a click there goes to
  whatever is behind it.
- Four papers — lime, orange, blue, pink — pale enough that six of them on a
  page is still a page of writing. **This is the one place colour is allowed
  outside the accent**, and the distinction is content against chrome: a sticky
  is an object the writer made, the way a highlight is. The rule against a
  second hue is about the interface having opinions.
- The **peeled corner** is what makes a square of colour read as a sticky note
  rather than a swatch: two triangles from one element — the window showing
  through where the paper has lifted, and the shadow the fold casts on itself.
  The tilt is set from the note's own id, so it keeps its lean when the one
  above it is thrown away.
- The controls fade in on hover or focus, so a page of stickies reads as notes
  rather than as six little toolbars. `Escape` returns to the prose;
  `Backspace` in an empty one throws it away.
- Text writes settle 400ms after typing stops, per note, and anything owed is
  flushed when the page changes or the window closes. A new note is written
  immediately rather than debounced — one that vanished because the app closed
  in the four hundred milliseconds after it appeared would be unreproducible.

---

## 23. The writing chart

[WritingChart.tsx](src/ui/WritingChart.tsx),
[ActivityDialog.tsx](src/ui/ActivityDialog.tsx), the arithmetic in
[activity.ts](src/core/activity.ts), and the `activity` table in
[schema.sql](src/data/schema.sql).

- **A square is a day, and it counts words *touched*, not words gained.** An
  edit contributes the size of its change, so cutting forty words is forty words
  of work. Net growth would draw a morning spent tightening a chapter as an
  empty square, which is exactly the morning worth encouraging.
- **Time is the guard, not the score.** Seconds accrue from the gaps between
  edits and only while a gap stays under three minutes, so a window left open
  overnight earns nothing. It appears in the detail line as context; the heat
  never depends on it.
- **Two sizes, neither of them a year.** A year of days is 365 squares, which is
  a wall to read rather than a thing to glance at. The welcome screen gets **the
  week you are in** — seven squares under their weekday initials, with the
  streak beneath. The panel gets **one month at a time**, laid out as a calendar
  with the date on each square, and a dropdown back through every month since
  the first word — empty ones included, because a gap is a fact worth being able
  to look at.
- **The scale is the writer's own history, never the days on screen.** Full
  strength is the 75th percentile of the days they actually wrote on, floored at
  500 words so a first week does not set the bar at itself and come out all
  black. Computed over everything, so August and March mean the same thing.
- **Recorded from the editor's save and nowhere else.** Import, templates and a
  restored version all go through `saveContent` too, and none of them is a
  morning's writing — putting the tally in the store would have counted all
  three. The call is not awaited: a square on a chart never stands between the
  words and the disk, and it swallows its own failure.
- **Click a written date to reopen the work behind it.** Each activity row keeps
  the page ids touched that day and opens the surviving pages as permanent
  tabs. Rows written by older versions fall back to document and revision
  timestamps on demand, so the feature reaches back instead of beginning empty
  on upgrade.
- **Its own tiny table**, one row per day of four small values plus the handful
  of page ids touched that day, never pruned.
  Derived from `revisions` it would have been wrong twice over — those are
  pruned, and they carry a copy of the prose, so counting a year out of them
  means reading a year of documents.
- The day key is the **local** calendar day. Someone writing at eleven at night
  in Lagos is having Tuesday, and a UTC key would file half their evening under
  Wednesday and break a streak they can see with their own eyes.
- Colour is Cobalt in four steps, light to dark, **re-stepped rather than
  flipped** for dark — the ramp climbs away from the card instead of down onto
  the page, so the date's ink has to change tier a step earlier. Empty is a
  neutral rather than a fifth step of the blue: nothing is the absence of the
  scale, not the bottom of it. **Today wears an ink ring and a medium numeral**;
  hover and focus wear the accent, the same ring every other focusable thing in
  the app draws. Both are **inset**: an outward ring is 3.5px of shadow reaching
  into a 5px gap from both sides, so today's square and the one hovered beside
  it overlapped. Inset, a ring cannot reach a neighbour at any gap or any cell
  size.
- A day **later this week or later this month is drawn as an outline**, not as
  an empty square. A Friday that has not arrived is not a Friday that was
  missed.
- **Two stat cards, and neither ranks you.** There were four: words, days, best
  day, day streak. Best day is a personal record to beat and a streak is a
  chain not to break — both are competitive framing borrowed from habit-loop
  apps, and "keep it going" is a phrase built on loss aversion. The streak is
  gone as a *concept* rather than hidden until it is flattering: `summarise`
  still computes it, cheaply and under test, and nothing reads it. The launch
  strip lost it too, because hiding a mechanic in one place and keeping it in
  another is the incoherent half of that decision.
- The cards carry **no subtext**. A number under a number is a comparison
  asking to be made; one line at the foot does the talking for the whole panel,
  and it *describes* rather than scores — which week the writing landed in,
  never a target or a gap to close, and never a figure the cards already show.
- The method is behind **"Learn more about stats"**, collapsed, and floats over
  the calendar rather than pushing it down — it is worth being able to read and
  not worth reading twice.
- The month is chosen from a **listbox of ours, not a `<select>`**
  ([MonthPicker.tsx](src/ui/MonthPicker.tsx)). A native select draws its popup
  with the operating system, so the app's dark surface got a white list with a
  Windows-blue highlight on it — the one part of the interface the stylesheet
  cannot reach. Everything the native control gives away free is put back by
  hand: roles, arrow keys, Home and End, Enter and Escape, focus returned to
  the button, click-outside to dismiss, and the open list scrolled to the
  current month. That last one uses `scrollTop` rather than `scrollIntoView`,
  which scrolls *every* scrollable ancestor and dragged the whole panel up by
  its own header.
- Arrow keys walk the month and only the square under the cursor is tabbable, so
  a month costs one Tab stop rather than thirty-one. The hovered or focused
  day's detail goes in a **reserved line under the grid** rather than a floating
  tooltip: one row of squares has the stat row directly above it in the panel
  and the four starts above it on the welcome screen, and a bubble covered both.

---

## 24. Gaps and things to check

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
- **Two of the new pieces have no unit test, for the same reason.**
  [import/index.ts](src/import/index.ts) cannot be loaded by `node --test` at
  all — something it imports uses a TypeScript parameter property, which
  Node's strip-only mode refuses — so the path that resolves `![alt](path)` to
  an asset id is covered only at its two ends: the reader's tests prove the
  path comes out on the node, and `storeImage` is the same function a paste has
  always used. The join between them is untested.
  [pastedHtml.ts](src/editor/pastedHtml.ts) needs a `DOMParser` and so is in
  the same position. Both are reachable from `npm run smoke`, which drives real
  Chrome, and neither is asserted there yet.
- **The docx table has not been opened in Word.** It is asserted structurally —
  `w:tbl`, two rows, four cells, `tblHeader`, declared borders — which is the
  same standard as the rest of the file and carries the same caveat as the
  entry above: nobody has watched Word repeat the header across a page break.
- **`npm run dist` (Electron) fails on this drive** with `EPERM … rename` — the
  volume rejects the directory rename electron-builder does at the end. Building
  to another output path works. Not a config problem.

---

## 25. Proving it

| | |
|---|---|
| `npm test` | storage, fractional ordering, markdown in and out — every round trip that used to lose something, and every construct another editor writes — tables both ways, docx structure including a real `w:tbl`, the gallery grouping rule, what a block is and where it goes, the writing chart's arithmetic, and the zip the browser build exports through, inflated back with `node:zlib` (`node --test`) |
| `npm run test:rust` | the Rust store, ordering keys, the clipboard payloads, and a library from before covers existed (`cargo test`) |
| `npm run smoke` | drives the browser build in real Chrome — including killing a tab mid-sentence and checking the sentence survived, right-clicking a selection and checking it is still held when the menu opens, going home by the mark and checking nothing typed on the way out was lost, opening a *second* tab and checking it was refused the library rather than allowed to race, dragging a block with real mouse events, reordering a gallery to prove a moved picture is not a copied one, and filling a table by keyboard: `Tab` across the cells, off the end into a new row, and inside a list in a cell where it has to nest instead |
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
