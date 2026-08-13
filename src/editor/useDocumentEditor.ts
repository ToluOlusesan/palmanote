import { useEditor, type Editor } from '@tiptap/react';
import { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { useCallback, useEffect, useRef, useState } from 'react';

import { countWords, textOf } from '../core/pmText.ts';
import type { PMDoc, PMNode } from '../core/types.ts';
import { store } from '../data/index.ts';
import { openLink } from '../data/links.ts';
import { ACCEPTED, preloadAssets, storeImage } from './assets.ts';
import { idFromPageUri } from './pageLinkClipboard.ts';
import { useLibrary } from '../state/library.tsx';
import { clearPending, stashPending } from '../state/pending.ts';
import { useWritingSettings } from '../state/writingSettings.ts';
import { extensions } from './extensions.ts';
import { PageLinkView, pageLinkKey } from './pageLinkView.ts';

const DEBOUNCE_MS = 500;
const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * `view.updateState` sets state without a transaction, so nothing downstream
 * of Tiptap hears about it. An empty transaction wakes the React bindings and
 * the selection bar; having no steps, it leaves undo history alone.
 */
function nudge(editor: Editor): void {
  editor.view.dispatch(editor.state.tr);
}

/** Word's convention: characters including spaces, excluding block breaks. */
function charactersIn(text: string): number {
  return text.split('\n').join('').length;
}

/**
 * Takes any images out of a paste or a drop and puts them in the library.
 *
 * Returns true — swallowing the event — only when there was at least one, so a
 * paste of text with a picture in it is not silently reduced to the picture.
 * The insert happens after an await, so it re-reads the position rather than
 * trusting the one it was handed; the document may have moved on by then.
 *
 * Several pictures arriving together become a gallery rather than a column of
 * them. Dropping a folder of screenshots into a page and getting back a wall
 * of full-width images is the thing everyone does once; the grid is what they
 * wanted, and the gallery's own Ungroup button is the way back.
 */
function takeImages(view: EditorView, items: DataTransferItem[], at: number | null): boolean {
  const files = items
    .filter((item) => item.kind === 'file' && ACCEPTED.includes(item.type))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  if (files.length === 0) return false;

  void (async () => {
    // Stored first, all of them, so the shape of what lands is known before
    // anything is written into the document. One failure among six is skipped
    // rather than allowed to turn the other five into separate inserts.
    const stored: { id: string; alt: string }[] = [];
    for (const file of files) {
      try {
        const image = await storeImage(file);
        stored.push({ id: image.id, alt: file.name });
      } catch (error) {
        // Nothing is thrown at the writer here: the paste either worked or it
        // did not, and a dialog over the page they were writing on is a worse
        // answer than the picture simply not being there.
        console.warn('PalmaNote could not read that image.', error);
      }
    }
    if (stored.length === 0) return;

    const where = at ?? view.state.selection.from;
    const pos = Math.max(0, Math.min(where, view.state.doc.content.size));
    const { schema } = view.state;
    const images = stored
      .map((image) => schema.nodes.image?.create(image))
      .filter((node): node is NonNullable<typeof node> => Boolean(node));
    if (images.length === 0) return;

    // Landing inside a gallery adds to it, however many arrived: a grid that
    // turned one of its own cells into a nested grid would be nobody's idea of
    // dropping a picture into a gallery.
    const inGallery = view.state.doc.resolve(pos).parent.type.name === 'gallery';
    const payload =
      images.length > 1 && !inGallery
        ? [schema.nodes.gallery?.createAndFill(null, images)].filter(
            (node): node is NonNullable<typeof node> => Boolean(node),
          )
        : images;
    if (payload.length === 0) return;

    // `replaceRangeWith` rather than `insert`, because a drop lands wherever
    // the pointer was — which is usually the middle of a paragraph, and an
    // image is a block. `insert` would put a block where only inline content
    // can go; this one splits to make room.
    const tr = view.state.tr;
    if (payload.length === 1) tr.replaceRangeWith(pos, pos, payload[0]!);
    else tr.insert(pos, payload);
    view.dispatch(tr);
  })();
  return true;
}

/**
 * Turns a pasted `springboard://page/<id>` into a real page link.
 *
 * The HTML flavour of a copied page link needs nothing here — PageLink's own
 * `parseHTML` already claims it. This is the other half: the paste that
 * arrives as plain text, from Ctrl+Shift+V or from having gone through
 * somewhere that does not carry HTML. Without it a page link pasted the wrong
 * way lands as a URI nobody can click.
 */
function takePageUri(view: EditorView, text: string, titleOf: (id: string) => string): boolean {
  const id = idFromPageUri(text);
  if (!id) return false;
  // The label is written once, here, and never read by the app again — the
  // live title comes from the id every time this draws. It is what a copy of
  // this document carries into a file or another editor, where the id is just
  // a string. See PageLink.
  const node = view.state.schema.nodes.pageLink?.create({ id, label: titleOf(id) });
  if (!node) return false;
  view.dispatch(view.state.tr.replaceSelectionWith(node, false).scrollIntoView());
  return true;
}

/** Every asset id a document points at, so they can be read before it draws. */
function assetIdsIn(doc: PMDoc | null): string[] {
  const found: string[] = [];
  const visit = (node: PMNode) => {
    if (node.type === 'image' && typeof node.attrs?.id === 'string') found.push(node.attrs.id);
    for (const child of node.content ?? []) visit(child);
  };
  if (doc) visit(doc);
  return found;
}

interface Session {
  state: EditorState;
  scrollTop: number;
}

/**
 * One editor view, many documents.
 *
 * Switching tabs stashes the whole ProseMirror `EditorState` — document,
 * selection and undo history together — and swaps in the state for the tab
 * being opened. That is what makes undo survive navigation: the history
 * plugin's state travels with the document rather than being thrown away and
 * rebuilt by `setContent`.
 *
 * The in-memory state is authoritative. Writes never block typing.
 */
export function useDocumentEditor(docId: string | null, scrollHost: () => HTMLElement | null) {
  const library = useLibrary();
  const { applyMeta } = library;
  const [loading, setLoading] = useState(docId !== null);
  // Characters are counted on the same walk as words — on save and on load —
  // rather than per keystroke, which would rebuild the whole text each time.
  const [characters, setCharacters] = useState(0);

  const sessions = useRef(new Map<string, Session>());
  const current = useRef<{ docId: string | null; dirty: boolean }>({ docId: null, dirty: false });
  const timer = useRef<number | null>(null);
  const applyMetaRef = useRef(applyMeta);
  applyMetaRef.current = applyMeta;

  // The caret plugin reads its options object on every update, so flipping a
  // switch takes effect on the next transaction rather than by rebuilding the
  // editor and throwing away the undo stack with it.
  const { settings } = useWritingSettings();

  // The plugin needs today's titles and a way to navigate, and both change as
  // the library does. A ref keeps the plugin itself stable.
  const linkContext = useRef({ byId: library.byId, select: library.select });
  linkContext.current = { byId: library.byId, select: library.select };

  const editor = useEditor({
    extensions: [
      ...extensions,
      // The closures read a ref, so the extension is configured once and still
      // sees today's titles.
      PageLinkView.configure({
        lookup: (id) => linkContext.current.byId.get(id),
        open: (id) => linkContext.current.select(id),
      }),
    ],
    autofocus: false,
    // Paste already lands schema-clean because unknown nodes cannot be parsed
    // into a schema that has no rule for them. This strips the attributes that
    // do survive — inline styles and classes riding on paragraphs.
    editorProps: {
      transformPastedHTML(html) {
        return html.replace(/\s(style|class|id|lang|dir)="[^"]*"/gi, '');
      },
      attributes: { class: 'body', spellcheck: 'true', 'aria-label': 'Document body' },
      // Pasted and dropped pictures are the two routes nobody thinks of as a
      // feature until they are missing. Both go through the same place: real
      // image *data* becomes an asset, and anything else falls through to
      // ProseMirror, which has no node an `<img src="https://…">` can land in.
      handlePaste(view, event) {
        if (takeImages(view, [...(event.clipboardData?.items ?? [])], null)) return true;
        return takePageUri(view, event.clipboardData?.getData('text/plain') ?? '', (id) =>
          linkContext.current.byId.get(id)?.title ?? '',
        );
      },
      handleDrop(view, event) {
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        return takeImages(view, [...(event.dataTransfer?.items ?? [])], at?.pos ?? null);
      },
      // A web link goes to the machine's browser, never to this window: the
      // page is the app, and navigating it away would close the library.
      // Plain click, so a caret can still be placed in the text of a link —
      // holding a modifier is how you edit one rather than follow it.
      handleClick(_view, _pos, event) {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return false;
        const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]');
        const href = anchor?.getAttribute('href');
        if (!href) return false;
        event.preventDefault();
        openLink(href);
        return true;
      },
    },
    onUpdate({ editor: instance, transaction }) {
      if (!transaction.docChanged) return;
      current.current.dirty = true;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(instance, false), DEBOUNCE_MS);
    },
  });

  const save = useCallback(async (instance: Editor, snapshot: boolean) => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const id = current.current.docId;
    if (!id || !current.current.dirty) return;
    current.current.dirty = false;
    const content = instance.getJSON() as PMDoc;
    const text = textOf(content);
    setCharacters(charactersIn(text));
    const meta = await store.saveContent({
      id,
      content,
      wordCount: countWords(text),
      snapshot,
    });
    applyMetaRef.current(meta);
    clearPending();
  }, []);

  const flush = useCallback(
    (snapshot: boolean) => (editor ? save(editor, snapshot) : Promise.resolve()),
    [editor, save],
  );

  /**
   * Put an older version of the open page back.
   *
   * It goes through here rather than through the store because the state in
   * this hook is the authoritative copy — writing underneath it would be
   * overwritten by the next autosave, which is the kind of bug that eats a
   * chapter and cannot be reproduced.
   *
   * Two things make it safe to press. Where you are now is snapshotted first,
   * forced past the coalescing window, so the restore always has something to
   * come back to even if you have been typing for the last ten seconds. And it
   * lands as a `setContent` rather than a fresh `EditorState`, so unlike
   * opening a document it leaves a step on the undo stack: a restore you did
   * not mean costs Ctrl+Z, not an afternoon.
   */
  const restore = useCallback(
    async (content: PMDoc) => {
      if (!editor) return;
      const id = current.current.docId;
      if (!id) return;
      const before = editor.getJSON() as PMDoc;
      applyMetaRef.current(
        await store.saveContent({
          id,
          content: before,
          wordCount: countWords(textOf(before)),
          snapshot: true,
        }),
      );
      editor.commands.setContent(content);
      current.current.dirty = true;
      await save(editor, true);
    },
    [editor, save],
  );

  // Swap documents: save what is leaving, stash its state and scroll, restore
  // or load what is arriving.
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;

    void (async () => {
      const leaving = current.current.docId;
      await save(editor, true);
      if (leaving && leaving !== docId) {
        sessions.current.set(leaving, {
          state: editor.state,
          scrollTop: scrollHost()?.scrollTop ?? 0,
        });
      }
      if (cancelled) return;

      if (!docId) {
        current.current = { docId: null, dirty: false };
        setLoading(false);
        return;
      }

      const measure = (content: PMDoc | null) => setCharacters(charactersIn(textOf(content)));

      const stashed = sessions.current.get(docId);
      if (stashed) {
        current.current = { docId, dirty: false };
        editor.view.updateState(stashed.state);
        nudge(editor);
        measure(editor.getJSON() as PMDoc);
        setLoading(false);
        requestAnimationFrame(() => {
          const host = scrollHost();
          if (host) host.scrollTop = stashed.scrollTop;
        });
        return;
      }

      setLoading(true);
      const record = await store.getDocument(docId);
      if (cancelled) return;
      // Read the pictures before the page is drawn, so opening a chapter full
      // of them is one flash of layout rather than five.
      await preloadAssets(assetIdsIn(record?.content ?? null));
      if (cancelled) return;
      current.current = { docId, dirty: false };
      // A fresh EditorState rather than setContent, so the document opens with
      // an empty undo stack instead of one step that erases it.
      editor.view.updateState(
        EditorState.create({
          schema: editor.schema,
          doc: editor.schema.nodeFromJSON(record?.content ?? EMPTY_DOC),
          plugins: editor.state.plugins,
        }),
      );
      nudge(editor);
      measure(record?.content ?? null);
      setLoading(false);
      requestAnimationFrame(() => {
        const host = scrollHost();
        if (host) host.scrollTop = 0;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [docId, editor, save, scrollHost]);

  useEffect(() => {
    if (!editor) return;
    const extension = editor.extensionManager.extensions.find(
      (candidate) => candidate.name === 'palmanoteCaret',
    );
    if (extension) Object.assign(extension.options, settings);
    editor.view.dispatch(editor.state.tr);
  }, [editor, settings]);

  // Making a page inside the one that is open drops a link to it where the
  // caret was, before the editor moves on to the new page.
  useEffect(() => {
    if (!editor) return;
    return library.onSubpage(({ parentId, id }) => {
      if (parentId !== current.current.docId) return;
      const title = library.byId.get(id)?.title ?? '';
      editor
        .chain()
        .insertContent({ type: 'pageLink', attrs: { id, label: title } })
        .run();
      void save(editor, false);
    });
    // `library` changes on every keystroke elsewhere; the subscription only
    // needs the editor and a stable subscribe function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, library.onSubpage, save]);

  // A page renamed elsewhere has to be repainted here.
  useEffect(() => {
    if (!editor || !pageLinkKey.get(editor.state)) return;
    editor.view.dispatch(editor.state.tr);
  }, [editor, library.byId]);

  // Forced save points.
  useEffect(() => {
    if (!editor) return;
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void save(editor, true);
    };
    const onUnload = () => {
      if (current.current.docId && current.current.dirty) {
        stashPending(current.current.docId, editor.getJSON() as PMDoc);
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('pagehide', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('pagehide', onUnload);
      void save(editor, true);
    };
  }, [editor, save]);

  return { editor, loading, characters, flush, restore };
}
