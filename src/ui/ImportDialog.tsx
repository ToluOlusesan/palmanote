import { useEffect, useRef, useState } from 'react';

import { wordCountOf } from '../core/pmText.ts';
import { bridge } from '../data/bridge.ts';
import { store } from '../data/index.ts';
import { mimeForName, storeImage } from '../editor/assets.ts';
import { planImport, runImport, type ImportPlan, type IncomingFile } from '../import/index.ts';
import { useLibrary } from '../state/library.tsx';

type Where = 'root' | 'inside';

/** What a picture may arrive as, alongside the pages that point at it. */
const PICTURES = '.png,.jpg,.jpeg,.gif,.webp';

/**
 * A picture named by a markdown file, put in the library.
 *
 * Bytes and a path rather than a `File`, because that is all the desktop shell
 * has to send: it reads the path off the disk, and nothing on the way carries
 * a mime type. Everything else — the size limit, the downscale, the hash that
 * becomes the id — is `storeImage`'s, exactly as it is for a paste or a drop.
 */
const putImage = async (bytes: Uint8Array, path: string): Promise<string | null> => {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mimeForName(path) });
  const stored = await storeImage(blob);
  return stored.id;
};

/**
 * The way in.
 *
 * PalmaNote could leave five ways and arrive none, which made the escape
 * hatch one-directional. Markdown, plain text and our own export bundle come
 * back exactly as they left; .docx arrives through the same schema filter as
 * a paste, so a Word file lands as prose rather than as Word's idea of prose.
 */
export function ImportDialog({
  onClose,
  onOpenPdf,
}: {
  onClose: () => void;
  onOpenPdf: (file: { path: string; name: string }) => void;
}) {
  const desktop = bridge;
  const library = useLibrary();
  const [where, setWhere] = useState<Where>('root');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Nothing is written until this has been looked at. An import that turns out
  // to be forty stray files is a lot to undo one Backspace at a time.
  const [plan, setPlan] = useState<ImportPlan[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const current = library.selectedId ? library.byId.get(library.selectedId) : undefined;

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const ingest = async (files: IncomingFile[]) => {
    if (files.length === 0) {
      setBusy(false);
      return;
    }
    setMessage(`Reading ${files.length} file${files.length === 1 ? '' : 's'}…`);
    const plans = await planImport(files);
    setBusy(false);
    if (plans.length === 0) {
      setMessage('Nothing in there could be read.');
      return;
    }
    setMessage(null);
    setPlan(plans);
  };

  const commit = async () => {
    if (!plan) return;
    setBusy(true);
    const parentId = where === 'inside' && current ? current.id : null;
    const result = await runImport(store, plan, parentId, wordCountOf, putImage);
    await library.refresh();
    if (result.firstId) library.select(result.firstId);
    setMessage(`${result.created} page${result.created === 1 ? '' : 's'} added.`);
    window.setTimeout(onClose, 900);
  };

  /** Depth of a planned page, for indenting the preview. */
  const depthOf = (plans: ImportPlan[], index: number): number => {
    let depth = 0;
    let at = plans[index]?.parent ?? null;
    while (at !== null && depth < 8) {
      depth += 1;
      at = plans[at]?.parent ?? null;
    }
    return depth;
  };

  const fromDesktop = async (folder: boolean) => {
    if (!desktop) return;
    setBusy(true);
    setMessage(null);
    try {
      const chosen = await desktop.pickImport(folder);
      await ingest(
        chosen.map((file) => ({
          path: file.path,
          text: file.text ?? undefined,
          bytes: file.bytes ? Uint8Array.from(file.bytes) : undefined,
        })),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed.');
      setBusy(false);
    }
  };

  const fromBrowser = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const files: IncomingFile[] = [];
      for (const file of Array.from(list)) {
        // webkitRelativePath is set when a directory was chosen, which is how
        // a folder keeps its shape on the way in.
        const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        // Pictures come in as bytes beside the pages that link them, which is
        // what makes `![shot](assets/shot.png)` in a chosen folder arrive as a
        // picture rather than as a hole.
        if (/\.(docx|png|jpe?g|gif|webp)$/i.test(file.name)) {
          files.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
        } else if (/\.(md|markdown|txt|json)$/i.test(file.name)) {
          files.push({ path, text: await file.text() });
        }
      }
      await ingest(files);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed.');
      setBusy(false);
    }
  };

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="dialog is-narrow"
        role="dialog"
        aria-modal="true"
        aria-label="Import"
        ref={panel}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">Import</h2>

        {plan && (
          <>
            <fieldset className="field">
              <legend>
                {plan.length} page{plan.length === 1 ? '' : 's'}, as they will appear
              </legend>
              <div className="preview">
                {plan.map((entry, index) => (
                  <div
                    className="preview-row"
                    key={`${entry.title}-${index}`}
                    style={{ paddingLeft: `${0.35 + depthOf(plan, index) * 0.9}rem` }}
                  >
                    <span className="preview-title">{entry.title || 'Untitled'}</span>
                    <span className="preview-words">
                      {wordCountOf(entry.content) > 0 ? `${wordCountOf(entry.content)} words` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </fieldset>

            <div className="dialog-foot">
              <span className="dialog-note">{message}</span>
              <button type="button" className="btn" disabled={busy} onClick={() => setPlan(null)}>
                Choose different files
              </button>
              <button type="button" className="btn is-primary" disabled={busy} onClick={() => void commit()}>
                {busy ? 'Importing' : `Import ${plan.length}`}
              </button>
            </div>
          </>
        )}

        {!plan && (
          <>
        <fieldset className="field">
          <legend>Where it lands</legend>
          <label className="choice">
            <input
              type="radio"
              name="where"
              checked={where === 'root'}
              onChange={() => setWhere('root')}
            />
            <span className="choice-label">At the top of the tree</span>
          </label>
          <label className="choice">
            <input
              type="radio"
              name="where"
              checked={where === 'inside'}
              disabled={!current}
              onChange={() => setWhere('inside')}
            />
            <span className="choice-label">
              Inside {current?.title ? `“${current.title}”` : 'the open page'}
            </span>
          </label>
        </fieldset>

        <fieldset className="field">
          <legend>What to read</legend>
          <p className="dialog-body">
            Markdown, plain text, Word documents, and PalmaNote&rsquo;s own{' '}
            <code>palmanote-export.json</code>. A folder keeps its shape: nested directories
            become nested pages.
          </p>
          <div className="dialog-actions">
            {desktop ? (
              <>
                <button type="button" className="btn" disabled={busy} onClick={() => void fromDesktop(false)}>
                  Choose files
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => void fromDesktop(true)}>
                  Choose a folder
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  Choose files
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  accept={`.md,.markdown,.txt,.docx,.json${PICTURES}`}
                  onChange={(event) => void fromBrowser(event.target.files)}
                />
              </>
            )}
          </div>
        </fieldset>

        {desktop && (
          <fieldset className="field">
            <legend>Read alongside</legend>
            <p className="dialog-body">
              Open a PDF here in PalmaNote — research to read beside the writing. It is not
              brought into the library and nothing is converted.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  void desktop.pickPdf().then((file) => {
                    if (!file) return;
                    onOpenPdf(file);
                    onClose();
                  })
                }
              >
                Open a PDF
              </button>
            </div>
          </fieldset>
        )}

        {desktop && (
          <fieldset className="field">
            <legend>Or go back</legend>
            <p className="dialog-body">
              Open one of the nightly snapshots from your Documents folder. The library you have
              now is set aside first, and PalmaNote restarts.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn is-destructive"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void desktop
                    .restoreSnapshot()
                    .then((aside) => {
                      if (!aside) setBusy(false);
                      else setMessage('Restoring…');
                    })
                    .catch((error: unknown) => {
                      setMessage(String(error));
                      setBusy(false);
                    });
                }}
              >
                Open a snapshot
              </button>
            </div>
          </fieldset>
        )}

        <div className="dialog-foot">
          <span className="dialog-note">{message}</span>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  );
}
