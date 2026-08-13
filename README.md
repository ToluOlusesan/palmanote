# PalmaNote

A writing app for one person. Page tree, tabs, a Tiptap editor, export to
Word, and a Windows desktop shell over SQLite.

```
npm install

npm run desktop            # the desktop app, hot-reloading
npm run dev                # the same app in a browser, http://localhost:5273

npm test                   # storage, ordering and docx structure (node --test)
npm run test:rust          # the Rust side (cargo test)
npm run smoke              # drives the browser build in real Chrome
npm run desktop:build      # NSIS installer, ~1.8 MB
npm run desktop:smoke      # drives that build over CDP
```

Building the desktop app needs a Rust toolchain (`rustup`, MSVC target) and
the WebView2 runtime, which ships with Windows 11.

---

## Shells

The desktop app is **Tauri 2** over WebView2, with SQLite in a Rust process.
The same renderer also runs unchanged in a browser against IndexedDB, which is
the fastest way to iterate and keeps the storage seam honest.

`src/data/bridge.ts` picks the backend once at load — Tauri if
`__TAURI_INTERNALS__` is present, otherwise the browser fallback. Nothing above
that file knows which. The same is true of files: `src/data/files.ts` writes
through a native save dialog on the desktop, the File System Access API in
Chromium, and plain downloads as a last resort.

| | Desktop | Browser |
|---|---|---|
| Storage | SQLite at `%APPDATA%/com.springboard.app/springboard.sqlite` | IndexedDB |
| Export | native dialogs, real folders | directory picker or downloads |
| PDF | the platform print dialog | the browser's print dialog |
| Window | frameless, custom title bar | ordinary page |
| Backups | nightly `VACUUM INTO` to Documents, last 30 kept | your own |

`src-tauri/capabilities/default.json` is the desktop equivalent of an Electron
preload: Tauri denies every core command not listed there, so that file *is*
the security boundary. It fails quietly — a missing permission logs to the
console and the feature simply stops — which is why `desktop:smoke` asserts
the console is empty.

### Why not Electron

It was, and the shell is still in `electron/` until this one has been lived
with. Electron shipped a 215 MB browser to host a 1.1 MB app; after trimming
everything trimmable the installer was 82 MB, and 95% of that was Chromium.
Tauri uses the WebView2 already on the machine:

| | Electron | Tauri |
|---|---:|---:|
| installer | 82 MB | **1.8 MB** |
| app binary | 215 MB | 3.9 MB |
| cold build | ~40 s | ~2 min |

WebView2 *is* Chromium, so nothing about the rendering changed — same Tiptap,
same CSS, same print stylesheet. The port touched four files' worth of
Node-specific code and left the other 4,782 lines of `src/` alone. Every SQL
statement moved across verbatim, including the recursive-CTE delete and the
window-function retention pass.

**The one thing lost is PDF.** Electron had `webContents.printToPDF`, which
wrote a file straight to a path. WebView2 can do it, but Tauri exposes no
route to `PrintToPdfAsync`, so PDF export now opens the platform print dialog
with the same print stylesheet behind it — one extra click, same output.
Closing that gap means calling WebView2's COM interface from Rust.

## File layout

```
src/
  core/          storage-agnostic logic, no React, no browser APIs
    types.ts       row shapes, mirroring schema.sql
    fracIndex.ts   base-62 fractional ordering keys
    tree.ts        flat rows -> tree, traversals, word-count roll-up
    pmText.ts      plain text <-> ProseMirror JSON
  data/
    schema.sql     canonical SQLite DDL (reference; not run by the web build)
    store.ts       the entire storage surface == the future IPC contract
    idb.ts         ~60-line promise wrapper over IndexedDB
    idbStore.ts    IndexedDB implementation
    bridge.ts      the Electron preload contract, as the renderer sees it
    index.ts       picks SQLite-over-IPC or IndexedDB, once
    files.ts       native dialogs / directory picker / downloads
  export/
    walk.ts        the one depth-first tree walk every export shares
    markdown.ts    ProseMirror JSON -> markdown
    docx.ts        ProseMirror JSON -> .docx, named styles throughout
    index.ts       scope + format -> a set of files
  editor/
    extensions.ts        the whole schema, in one list
    keymap.ts            Windows bindings and the list depth cap
    typography.ts        smart quotes, em dash, ellipsis
    SceneBreak.ts        the typed break between sections
    useDocumentEditor.ts one view, many documents; autosave
    Highlight.ts         four highlights, named for the colour they are
    slash.ts             whether a menu or the selection bar should be open
  state/
    library.tsx    document tree state, selection, navigation history
    tabs.tsx       the open set: preview tabs, pinning, session restore
    pending.ts     synchronous crash cushion for unload
  ui/
    TreePane.tsx   sidebar: create, rename, nest, reorder, archive, restore
    TabStrip.tsx   the tab row
    EditorPane.tsx breadcrumb, title, body, status bar
    SelectionBar.tsx  the bar that comes to held text
    SlashMenu.tsx  the list a "/" or an "@" opens
    ExportDialog.tsx  one dialog for every route out
    WindowControls.tsx  Windows caption buttons
    PalmaMark.tsx  the mark: a page, a palm, a waterline
  electron/
    main.ts        window, IPC handlers, nightly snapshots
    preload.ts     the whole surface the page can see
    sqliteStore.ts better-sqlite3 implementation of the same contract
  app/
    App.tsx        shell and global shortcuts
    styles.css     all of the styling
```

## Interface

Modelled on the macOS editor you sent: a sidebar that reads as part of the
window rather than a panel inside it, and one white card floating on the
window's own grey. Chrome — sidebar toggle, tabs — sits in the strip above the
card. The card holds the trail, the writing, and a footer with the page name
left and counts right. Sidebar rows group under a section label, select with a
soft grey fill rather than a coloured bar, carry their word count right-aligned,
and end in an "Add page" row.

**The body face is now sans, reversing what I argued for two rounds ago.** I
kept a reading serif then and flagged it as a one-variable switch; the
reference you sent renders prose in the system sans, so it is sans. The brief's
requirement that chrome and writing not share a typeface is met by register
instead of by family: chrome is small, tracked out and grey, prose is larger,
tracked in and black. That is how the reference does it too. `--prose` in
`styles.css` is still the single variable if you want the serif back.

Colour appears only in focus rings, the highlights, and drop indicators. The
selected sidebar row no longer uses it.

## Size

82 MB installed from a 109 MB starting point, 279 MB on disk from 415 MB.
Where it went:

| | before | after | how |
|---|---:|---:|---|
| `app.asar` | 39.9 MB | 1.5 MB | renderer deps moved to `devDependencies` |
| `locales/` | 47.0 MB | 0.6 MB | one interface language, pinned in `main.ts` |
| `dxcompiler.dll`, `dxil.dll` | 25.8 MB | — | DirectX shader compilers; nothing here draws |
| better-sqlite3 | 12 MB | 2 MB | dropped the C source and seven other platforms |
| renderer bundle | 1.0 MB | 0.7 MB | the docx writer loads only on export |

The first one was the real mistake. Vite already bundles React, Tiptap, docx
and Phosphor into `dist/`, but electron-builder also copies everything in
`dependencies` into the asar as source — 4,552 Phosphor files among them,
shipped twice. Only `better-sqlite3` is required at runtime by the main
process, so only it belongs there. Everything else is a build-time dependency
and now lives in `devDependencies`. Anything added for the renderer should go
there too.

`scripts/trim-package.cjs` does the rest as an `afterPack` hook, and names
what it removes and why. It deliberately keeps four things it could delete:
`LICENSES.chromium.html` (19 MB, but Chromium's terms require shipping it),
`ffmpeg.dll`, `d3dcompiler_47.dll` and `vk_swiftshader.dll` — the last three
are the graphics fallback path, and their absence shows up as a blank window
on somebody else's GPU rather than on the machine that built it.

**What is left is Electron.** `PalmaNote.exe` is 215 MB of the 279 MB, and
it is byte-identical to the stock `electron.exe` — a whole browser engine,
statically linked. Add `icudtl.dat`, `resources.pak` and the graphics DLLs and
roughly 95% of this app is Chromium. There is no configuration that changes
that.

The one lever that would is the one the brief closed: a WebView2 shell ships
no browser, because Windows already has one. That was measured rather than
assumed — a Tauri 2 shell built around this exact `dist/` produces a **1.7 MB
installer**, 48× smaller, and runs the renderer unmodified on Chromium 150
with smart typography, headings and task lists all intact.

If it is ever worth revisiting, the port is bounded by design: `bridge.ts` is
the whole native surface at twenty methods, the Node-specific code is 761
lines across four files, and the other 4,782 lines of `src/` do not change.
The SQL ports verbatim — the recursive-CTE delete and the window-function
prune are plain SQLite, not better-sqlite3 idioms. The two real costs are
`printToPDF`, which WebView2 has but Tauri does not expose, and a second
language in a project whose brief argues that every dependency is something
that can break a novel in four years.

## Does it hold a novel

The first acceptance criterion — *a 120,000-word novel across 60 nested
documents opens, navigates, and types without perceptible lag* — is now
measured rather than hoped for. `npm run scale` writes 122,400 words across 63
documents, times the things a writer would feel, and deletes exactly what it
created:

| | measured | budget |
|---|---:|---:|
| listing every document | 3.5 ms | 100 ms |
| reading a chapter from SQLite | 3.4 ms | 100 ms |
| expanding the tree to 66 rows | 2.8 ms | 150 ms |
| switching chapters | 73 ms | 200 ms |
| keystroke to painted frame | 17 ms | 33 ms |
| autosaving a full chapter | 12 ms | 100 ms |

17 ms is one frame: a keystroke is painted at the next refresh, which is as
fast as anything can be. The budget is two frames because budgeting for one
would be budgeting for the impossible.

It runs against the real library — Tauri resolves its data directory through
Win32, so there is no honest way to point it elsewhere from outside — and
verifies the cleanup rather than assuming it, because a cleanup that quietly
does nothing is worse than none.

## Launch

A greeting, with four starting points that open **templates** rather than
blank pages:

| | opens |
|---|---|
| Make a to-do list | a page with *Today* and *This week*, each with tasks |
| Draft a story | a story folder — premise, people, places — with *Chapter One* inside it, scene break included |
| Plan a project | a folder with *What it is*, *What are you trying to achieve*, *Next*, and a *Notes* page |
| Jot down thoughts | a page dated today, and nothing else |

Typing a name first uses it for whatever is created. Templates live in
`src/ui/templates.ts` and are deliberately under a screenful each — somewhere
to start, not a form to fill in.

The brief argued against a greeting, on the grounds that a writer should
arrive already writing. This is the version that respects that: every route
out of it ends with a caret in a page, it never asks a second question, and it
is a switch in the writing menu. `Esc` goes straight back to work.

## Deleting

Two steps, and the second one is the only destructive operation in the app.

**Delete** — right-click a tree row, or `Backspace` on the selection — takes
the page and everything inside it out of the sidebar and puts it in the
archive at the foot of the tree. Nothing is lost; Restore puts it back where
it was, or at the root if the branch it came from has since gone.

**Delete for good** lives only in the archive, asks once inline, and then
removes the subtree, its content and its whole revision history. In SQLite
that is a recursive CTE deleting leaves first, because `parent_id` is
`ON DELETE RESTRICT` — the constraint is there precisely so a bad delete
fails loudly instead of orphaning half a novel.

The original brief said there is no hard delete in the UI. There is one now,
because you asked for it; it is kept behind the archive and a confirmation so
that the everyday `Backspace` is still the reversible one.

## Export

`Ctrl+Shift+E`, or the button in the title bar. Every format takes a scope —
this page, this page and everything inside it, or everything.

- **Word (.docx)**, two presets. Both use Word's *named styles* throughout:
  `Heading 1/2/3`, `Normal`, `ListParagraph` attached to real numbering
  definitions. Nothing bakes "24pt bold centred" into a run, because a file
  that does looks correct and behaves like a brick — no navigation pane, no
  Google Docs outline, no restyling a manuscript in one action.
  - *Reading copy* — single-spaced, comfortable, for handing to a friend.
  - *Manuscript format* — Times 12pt, double-spaced, 1" margins, 0.5"
    first-line indent, chapters on new pages, scene breaks as a centred `#`,
    `Surname / TITLE / page` running header, title page from the fields in the
    dialog.
- **PDF** through the print stylesheet — `printToPDF` on the desktop, the
  browser's own print dialog otherwise. No PDF library.
- **Markdown**, as one file or as a folder mirroring the tree.
- **Everything** — the escape hatch. Nested folders of markdown, one numbered
  file per page with its metadata in front matter, plus
  `palmanote-export.json` holding every document and every revision. A
  person with that folder can rebuild the archive without PalmaNote
  existing.

`src/export/docx.test.ts` unzips generated files and asserts the structure:
that headings carry style ids rather than run formatting, that `numbering.xml`
exists and is referenced, that strikethrough survives, that emoji get an
explicit font run, and that no run property is written as an explicit
`w:val="false"` that would override a paragraph style.

**Not yet verified in Word or Google Docs.** The XML is right; someone still
has to open the file in both. That is the one part of the export work I cannot
finish from here.

## Data model

One recursive table, as specified. `kind` (`folder | chapter | scene | note`)
is kept in the model because export needs it, but it is not surfaced anywhere
in the UI yet and new pages default to the neutral `note` — this reads as a
document editor, not a novel-writing rig. Nesting is never restricted by kind;
any page may hold both prose and children.

**Archiving marks the subtree root only.** Descendants keep `archived_at` null
and simply stop being reachable by traversal. Archive and restore are each one
row update with no cascade to get wrong, and a restored branch comes back
exactly as it was. The one edge case — restoring a page whose parent was
archived afterwards — lifts it to the root rather than into a hidden branch.

## Durability

- The editor state in memory is authoritative; a database write never blocks typing.
- Autosave 500ms after typing stops, forced on navigation, blur, tab hide, and unload.
- On unload, anything not yet written is stashed synchronously in `localStorage`
  and replayed at next launch. IndexedDB writes started in `beforeunload` are
  not guaranteed to finish; `localStorage` writes are. This is the web stand-in
  for the synchronous SQLite write the desktop build will do on close.
- `navigator.storage.persist()` is requested at boot so the browser does not
  evict the work under storage pressure.
- Revisions are captured from day one in an append-only table, pruned at boot:
  everything from the last 24h, hourly for a week, daily beyond, never below
  the newest revision of any page.

`npm run smoke` kills a tab mid-sentence and checks the sentence survives.

---

## Where I'd diverge from the brief

Flagged before building, as asked.

**1. `position` should be a string, not a float.**
The brief says "float or fractional index". Float midpoints exhaust double
precision after roughly fifty consecutive inserts at the same spot and then
silently tie — two siblings with identical positions, order decided by
whatever the sort is unstable about. Positions are base-62 strings using the
Figma order-key scheme: an integer part that increments on append plus a
fractional part that subdivides. A move is still one row update, keys sort
lexicographically in both SQLite `TEXT` and IndexedDB, and they can be
subdivided forever.

This matters concretely — a naive string midpoint (no integer part) produces a
**1000-character key after 5000 appends**. With the integer part, 5000 appends
top out at 4 characters. Both cases are in `src/core/fracIndex.test.ts`.

**2. A revision snapshot on literally every save is too many revisions.**
At a 500ms debounce, a two-hour session writes hundreds of near-identical full
copies of a chapter, and the coarse retention policy then throws nearly all of
them away. Snapshots are coalesced instead: one per page per two minutes of
active editing, plus an unconditional one whenever you navigate away, blur, or
close. The append-only table and the retention policy are exactly as specified.

This does not weaken crash recovery, because revisions were never what provides
it — the document row itself is saved every 500ms and is what survives a crash.
Revisions are for time travel.

**3. "Undo/redo that survives navigating between documents" needed a definition — now settled.**
ProseMirror history is per-`EditorState`, so it is per-page undo, held in
memory for the session: leaving a tab stashes its whole state and returning
swaps it back. What I argued against, and did not build, is a single global
undo stack where Ctrl+Z after navigating silently edits text you cannot see.
Neither survives a reload; persisting ProseMirror history across restarts is a
large amount of machinery for a rare need.

**4. Reversed on your instruction, noted here so it isn't lost.**
§9 asks the sidebar to collapse automatically when typing starts. It was built
that way and then removed: you asked for something that feels like Word or
Notion, and in both the sidebar stays where you left it. Ctrl+\ still toggles
it, and hidden is still a state the app remembers between launches. Say the
word and the auto-collapse comes back as a single flag.

Also on your instruction: light only. The dark palette is gone rather than left
half-wired, and a dark system theme no longer drags the app with it.

---

## Keyboard

| | |
|---|---|
| right-click a row | rename, new page inside, favourite, delete |
| `Backspace` | delete the selected page (to the archive) |
| `Ctrl+Shift+E` | export |
| `Ctrl+D` | favourite the selected page |
| `Ctrl+T` | new page in a new tab, caret in the title |
| `Ctrl+W` | close tab (twice if pinned) |
| `Ctrl+Shift+T` | reopen the last closed tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | cycle tabs |
| `Ctrl+1`–`Ctrl+8`, `Ctrl+9` | jump to tab N, last tab |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+Shift+X` | bold, italic, strikethrough |
| `Ctrl+Alt+1/2/3`, `Ctrl+Alt+0` | headings, paragraph |
| `Ctrl+Shift+8/7/9` | bullet, numbered, task list |
| `Tab` / `Shift+Tab` in a list | nest, outdent |
| `Alt+←` / `Alt+→` | back, forward |
| `Ctrl+N` | new page after the selected one |
| `Ctrl+Shift+N` | new page inside the selected one |
| `Ctrl+\` | show or hide the sidebar |
| `Esc` | back to the writing |
| `↑` `↓` | move through the sidebar |
| `←` `→` | collapse / expand |
| `Enter` | open the selected page |
| `Shift+Enter`, `F2` | rename |
| `Tab` / `Shift+Tab` | nest / unnest |
| `Alt+↑` `Alt+↓` | reorder among siblings |
| `Backspace` | archive |

## Against the v2 polish brief

The v2 brief opens by saying the base version already has a Tiptap editor,
docx export and the escape hatch. **It does not.** What existed when v2
arrived was phase 1 of the original build order: the skeleton, with a plain
textarea. That changes what §13 can be worked through, so here is the state
against it.

**Done**

| §13 | |
|---|---|
| 1. Windows shortcut audit | Every binding is `Ctrl`; no `metaKey` remains anywhere. Rename is F2 as well as Shift+Enter. |
| 3. Tabs | Preview tabs, promote on double-click or on edit, Ctrl+T/W/Shift+T/Tab/1–9, middle-click close, drag to reorder, pinning with a two-press Ctrl+W, session restore with per-tab scroll, cursor **and undo history**. |
| 4. Marks, lists, input rules, selection bar | Bold, italic, strikethrough; bullet, ordered and task lists; headings, blockquote, typed scene break; smart typography; paste stripped to the schema; a formatting bar that comes to held text. |
| — | Enough of §4's Phosphor pass to avoid text glyphs in chrome. |

**Blocked, and why**

- **§13.2, frameless window and custom title bar.** Impossible in a browser.
  This is still the web build you asked to iterate on before committing. The
  tab strip is built as its own row so it drops into a custom title bar
  unchanged when the Electron shell lands.
- **§13.5, export correctness for lists and strikethrough.** There is no docx
  exporter yet — that was phase 4 of the original order and was never built.
  Nothing about lists or marks can be verified through Word or Google Docs
  until it exists.

So the review point the brief asks for — "tabs plus marks plus correct export"
— is two-thirds reachable. The missing third needs the escape hatch and the
docx exporter built first. Suggested next order: escape hatch (§6 of the
original brief) → docx with both presets → the §13.5 correctness pass →
resume v2 at §13.6.

**Editor decisions worth knowing**

- **Tiptap 3, not 2.** Same ProseMirror underneath; 3 is the maintained line.
  The instruction that mattered — Tiptap on ProseMirror, not Lexical or a
  hand-rolled editor — is honoured.
- **Undo really does survive navigation.** Switching tabs stashes the whole
  ProseMirror `EditorState` — document, selection and history together — and
  swaps it back in. One view, many documents. This is the concrete answer to
  the definition question raised in phase 1.
- **Smart typography is hand-written** rather than `@tiptap/extension-typography`,
  which also converts fractions, copyright signs and guillemets.
- **Paste stripping is mostly free.** ProseMirror cannot parse a node type
  that is not in the schema, so tables, images and colour have nowhere to
  land. The transform only strips attributes riding on nodes that do exist.
- **Lists cap at three levels.** Tiptap's own list extensions bind Tab to an
  uncapped `sinkListItem`, so the cap runs at higher priority and swallows the
  key at the limit rather than declining it.

## Packaging

`npm run dist` produces an NSIS installer in `release/`. Two notes from
building it here:

- `npm run electron:rebuild` has to run once after install, and again after
  any Electron upgrade. `better-sqlite3` is native and needs the ABI Electron
  is on, not the one Node is on.
- On this machine electron-builder cannot write into `E:\palmanote
elease`
  — the drive rejects the directory rename it does at the end. Building to
  another location works (`npx electron-builder --dir --config.directories.output=<path>`),
  and the packaged `PalmaNote.exe` was verified running from there, writing
  to SQLite, with the caption buttons drawn. If `npm run dist` fails with
  `EPERM ... rename`, that is this and not the config.

## Not built yet

The rest of v2 §13, from step 6 on: emoji, command palette, quick switcher,
focus mode, session marks, revision browser, export dialog. And from the
original brief: the escape hatch, docx, PDF, markdown, find and replace.

## Dependencies

Runtime: `react`, `react-dom`, `@tiptap/*` (react, pm, starter-kit,
placeholder, task-list, task-item), `@phosphor-icons/react`.
Dev: `vite`, `typescript`, `@vitejs/plugin-react`, `@types/*`,
`fake-indexeddb` (store tests), `playwright-core` (smoke test — drives the
Chrome already on the machine, downloads no browser).
