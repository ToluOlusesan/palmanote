import { useEffect, useRef, useState } from 'react';

import { store } from '../data/index.ts';
import { writeExport } from '../data/files.ts';
import { buildExport, type ExportFormat, type ManuscriptDetails } from '../export/index.ts';
import { useLibrary } from '../state/library.tsx';

const SETTINGS_KEY = 'palmanote:export';

type Scope = 'document' | 'subtree' | 'all';
/** What the writer chooses. `markdown-folder` is derived, never picked. */
type Choice = 'docx' | 'markdown' | 'everything';

interface Settings {
  format: Choice;
  scope: Scope;
  manuscript: boolean;
  details: ManuscriptDetails;
}

const DEFAULTS: Settings = {
  format: 'docx',
  scope: 'all',
  manuscript: false,
  details: { surname: '', title: '', author: '', contact: '' },
};

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    // `format` is read as a loose string on purpose: what is in storage may
    // name a format this dialog no longer offers.
    const saved = JSON.parse(raw) as Partial<Omit<Settings, 'format'>> & {
      format?: string;
      preset?: string;
    };
    return {
      ...DEFAULTS,
      ...saved,
      // Two settings this dialog no longer has. Somebody who last exported a
      // PDF, or a markdown folder, should open this to a sane choice rather
      // than to a radio group with nothing selected.
      format: saved.format === 'markdown-folder'
        ? 'markdown'
        : saved.format === 'docx' || saved.format === 'markdown' || saved.format === 'everything'
          ? saved.format
          : DEFAULTS.format,
      manuscript: saved.manuscript ?? saved.preset === 'manuscript',
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * One dialog for every way out of PalmaNote.
 *
 * It asks two questions — what kind of file, and how much of the library —
 * and it used to ask four. What went, and why:
 *
 *   * **PDF.** Out entirely for now, on its way to being rebuilt.
 *   * **Markdown, one file *or* a folder.** That was never a question about
 *     the format; it is a question about how much you are exporting, which
 *     has already been asked one field down. One page is one file. More than
 *     one page is a folder of them.
 *   * **Reading copy or manuscript format**, and the four title-page fields
 *     under it. A running header, a surname and a contact block are a
 *     novelist submitting to an agent — real, and not what most people
 *     opening this dialog are doing. It is one switch now, off by default,
 *     and the fields only exist once it is on.
 *
 * "Everything" stays where it is rather than being hidden in a menu: it is
 * the guarantee the owner can leave at any moment, and it should be as easy
 * to reach as saving one page for somebody.
 */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const library = useLibrary();
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const current = library.selectedId ? library.byId.get(library.selectedId) : undefined;
  // The escape hatch is the whole library by definition, so asking how much of
  // it you want would be asking a question with one answer.
  const wholeLibrary = settings.format === 'everything';
  const scope: Scope = wholeLibrary || !current ? 'all' : settings.scope;
  const onePage = scope === 'document';

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  };

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const target =
        scope === 'all'
          ? ({ kind: 'all' } as const)
          : scope === 'subtree'
            ? ({ kind: 'subtree', rootId: current!.id } as const)
            : ({ kind: 'document', id: current!.id } as const);

      // One page is one file; anything more is a folder mirroring the tree.
      const format: ExportFormat =
        settings.format === 'markdown' && !onePage ? 'markdown-folder' : settings.format;

      const details: ManuscriptDetails = {
        ...settings.details,
        title: settings.details.title || current?.title || 'Untitled',
      };
      const result = await buildExport(store, {
        format,
        scope: target,
        preset: settings.manuscript ? 'manuscript' : 'reading',
        details,
      });
      const outcome = await writeExport(result);
      if (outcome.cancelled) return;
      setMessage(
        `${outcome.written} file${outcome.written === 1 ? '' : 's'}${
          outcome.location ? ` in ${outcome.location}` : ''
        }`,
      );
      window.setTimeout(onClose, 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  const formats: { value: Choice; label: string; note: string }[] = [
    { value: 'docx', label: 'Word document', note: 'Opens in Word and Google Docs.' },
    {
      value: 'markdown',
      label: 'Markdown',
      note: onePage ? 'One file.' : 'One file per page, in folders that mirror your pages.',
    },
    {
      value: 'everything',
      label: 'Everything',
      note: 'Your whole library, twice over: readable markdown, and the raw data.',
    },
  ];

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Export"
        ref={panel}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">Export</h2>

        <fieldset className="field">
          <legend>As</legend>
          {formats.map((format) => (
            <label className="choice" key={format.value}>
              <input
                type="radio"
                name="format"
                checked={settings.format === format.value}
                onChange={() => update({ format: format.value })}
              />
              <span className="choice-label">{format.label}</span>
              <span className="choice-note">{format.note}</span>
            </label>
          ))}
        </fieldset>

        {!wholeLibrary && (
          <fieldset className="field">
            <legend>How much</legend>
            {(
              [
                ['document', `This page${current?.title ? ` — ${current.title}` : ''}`],
                ['subtree', 'This page and everything inside it'],
                ['all', 'Every page'],
              ] as const
            ).map(([value, label]) => (
              <label className="choice" key={value}>
                <input
                  type="radio"
                  name="scope"
                  checked={scope === value}
                  disabled={value !== 'all' && !current}
                  onChange={() => update({ scope: value })}
                />
                <span className="choice-label">{label}</span>
              </label>
            ))}
          </fieldset>
        )}

        {settings.format === 'docx' && (
          <fieldset className="field">
            <legend>Formatting</legend>
            <label className="choice">
              <input
                type="checkbox"
                checked={settings.manuscript}
                onChange={(event) => update({ manuscript: event.target.checked })}
              />
              <span className="choice-label">Manuscript format</span>
              <span className="choice-note">
                Times 12pt, double-spaced, 1&quot; margins, chapters on new pages, a running
                header and a title page. For sending to an editor or an agent.
              </span>
            </label>

            {settings.manuscript && (
              <div className="grid">
                {(
                  [
                    ['title', 'Title'],
                    ['author', 'Author'],
                    ['surname', 'Surname for the header'],
                  ] as const
                ).map(([key, label]) => (
                  <label className="text-field" key={key}>
                    <span>{label}</span>
                    <input
                      type="text"
                      value={settings.details[key]}
                      placeholder={key === 'title' ? (current?.title ?? 'Untitled') : ''}
                      onChange={(event) =>
                        update({ details: { ...settings.details, [key]: event.target.value } })
                      }
                    />
                  </label>
                ))}
                <label className="text-field wide">
                  <span>Contact</span>
                  <textarea
                    rows={2}
                    value={settings.details.contact}
                    onChange={(event) =>
                      update({ details: { ...settings.details, contact: event.target.value } })
                    }
                  />
                </label>
              </div>
            )}
          </fieldset>
        )}

        <div className="dialog-foot">
          <span className="dialog-note">{message}</span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn is-primary" disabled={busy} onClick={() => void run()}>
            {busy ? 'Exporting' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
