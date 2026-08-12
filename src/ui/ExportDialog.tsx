import { useEffect, useRef, useState } from 'react';

import { store } from '../data/index.ts';
import { bridge } from '../data/bridge.ts';
import { writeExport } from '../data/files.ts';
import { buildExport, type DocxPreset, type ExportFormat, type ManuscriptDetails } from '../export/index.ts';
import { safeFileName } from '../export/walk.ts';
import { useLibrary } from '../state/library.tsx';

const SETTINGS_KEY = 'springboard:export';

type Scope = 'document' | 'subtree' | 'all';

interface Settings {
  format: ExportFormat | 'pdf';
  scope: Scope;
  preset: DocxPreset;
  details: ManuscriptDetails;
}

const DEFAULTS: Settings = {
  format: 'docx',
  scope: 'all',
  preset: 'manuscript',
  details: { surname: '', title: '', author: '', contact: '' },
};

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

const FORMATS: { value: Settings['format']; label: string; note: string }[] = [
  { value: 'docx', label: 'Word document', note: 'Opens in Word and Google Docs.' },
  { value: 'pdf', label: 'PDF', note: 'Print layout, read-only.' },
  { value: 'markdown', label: 'Markdown', note: 'One file, everything in tree order.' },
  { value: 'markdown-folder', label: 'Markdown folder', note: 'Nested folders mirroring the tree.' },
  { value: 'everything', label: 'Everything', note: 'Markdown tree plus the complete raw database.' },
];

/**
 * One dialog for every way out of Springboard.
 *
 * "Everything" is the escape hatch and sits with the rest rather than hidden
 * in a menu: it is the guarantee the owner can leave at any moment, and it
 * should be as easy to reach as saving a chapter for an editor.
 */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const library = useLibrary();
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const current = library.selectedId ? library.byId.get(library.selectedId) : undefined;

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
      const scope =
        settings.scope === 'all' || !current
          ? ({ kind: 'all' } as const)
          : settings.scope === 'subtree'
            ? ({ kind: 'subtree', rootId: current.id } as const)
            : ({ kind: 'document', id: current.id } as const);

      if (settings.format === 'pdf') {
        const title = safeFileName(current?.title ?? 'Springboard');
        if (!bridge) {
          onClose();
          // The browser's own print dialog is the only route to a PDF here.
          window.setTimeout(() => window.print(), 50);
          return;
        }
        const outcome = await bridge.printToPDF(title);
        if (outcome.cancelled) return;
        // Shells that hand off to the platform print dialog have no path to
        // report; the dialog is already in front of the writer, so get out of
        // its way rather than announcing a filename we do not know.
        if (outcome.location) setMessage(`Saved to ${outcome.location}`);
        onClose();
        return;
      }

      const details: ManuscriptDetails = {
        ...settings.details,
        title: settings.details.title || current?.title || 'Untitled',
      };
      const result = await buildExport(store, { format: settings.format, scope, preset: settings.preset, details });
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

  const isDocx = settings.format === 'docx';

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
          <legend>Format</legend>
          {FORMATS.map((format) => (
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

        <fieldset className="field">
          <legend>What to include</legend>
          {(
            [
              ['document', `This page${current?.title ? ` — ${current.title}` : ''}`],
              ['subtree', 'This page and everything inside it'],
              ['all', 'Everything'],
            ] as const
          ).map(([value, label]) => (
            <label className="choice" key={value}>
              <input
                type="radio"
                name="scope"
                checked={settings.scope === value}
                disabled={value !== 'all' && !current}
                onChange={() => update({ scope: value })}
              />
              <span className="choice-label">{label}</span>
            </label>
          ))}
        </fieldset>

        {isDocx && (
          <fieldset className="field">
            <legend>Preset</legend>
            <label className="choice">
              <input
                type="radio"
                name="preset"
                checked={settings.preset === 'reading'}
                onChange={() => update({ preset: 'reading' })}
              />
              <span className="choice-label">Reading copy</span>
              <span className="choice-note">Single-spaced and comfortable, for handing to a friend.</span>
            </label>
            <label className="choice">
              <input
                type="radio"
                name="preset"
                checked={settings.preset === 'manuscript'}
                onChange={() => update({ preset: 'manuscript' })}
              />
              <span className="choice-label">Manuscript format</span>
              <span className="choice-note">
                Times 12pt, double-spaced, 1&quot; margins, chapters on new pages, running header.
              </span>
            </label>
          </fieldset>
        )}

        {isDocx && settings.preset === 'manuscript' && (
          <fieldset className="field">
            <legend>Title page</legend>
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
