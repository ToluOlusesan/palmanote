import { useEffect, useRef } from 'react';

import { useWritingSettings } from '../state/writingSettings.ts';

interface Switch {
  key: 'animatedCaret' | 'welcome';
  label: string;
  note: string;
}

const WRITING: Switch[] = [
  {
    key: 'animatedCaret',
    label: 'Animated cursor',
    note: 'The cursor slides between positions rather than jumping, the way Word does it.',
  },
];

const LAUNCH: Switch[] = [
  {
    key: 'welcome',
    label: 'Greeting on launch',
    note: 'Somewhere to start, before the writing. Escape always goes straight to the page.',
  },
];

/**
 * Settings, all of them.
 *
 * There are two, and the brief is clear that there should never be many
 * more: anything that needs a switch usually needed a decision instead. They
 * sit here rather than in a menu because a menu is for doing things and these
 * are for changing how things behave — and because a toggle you have to
 * rediscover in a dropdown is a toggle nobody flips twice.
 */
export function SettingsDialog({
  onClose,
  onOpenGuide,
}: {
  onClose: () => void;
  onOpenGuide: () => void;
}) {
  const writing = useWritingSettings();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const group = (legend: string, switches: Switch[]) => (
    <fieldset className="field">
      <legend>{legend}</legend>
      {switches.map((item) => (
        <label className="setting" key={item.key}>
          <input
            type="checkbox"
            checked={writing.settings[item.key]}
            onChange={() => writing.toggle(item.key)}
          />
          <span>
            <span className="setting-label">{item.label}</span>
            <span className="setting-note">{item.note}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="dialog is-narrow"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        ref={panel}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">Settings</h2>

        {group('Writing', WRITING)}
        {group('Launch', LAUNCH)}

        <fieldset className="field">
          <legend>Learning it</legend>
          <button
            type="button"
            className="setting-action"
            onClick={() => {
              onClose();
              onOpenGuide();
            }}
          >
            <span className="setting-label">Everything, and what it does</span>
            <span className="setting-note">
              Every key, every gesture and every menu, in one place — and searchable, for the
              question that turns up mid-sentence.
            </span>
          </button>
        </fieldset>

        {writing.reducedMotion && (
          <p className="dialog-body">
            Your system is set to reduce motion, so the cursor is drawn without animation whatever
            this says.
          </p>
        )}

        <div className="dialog-foot">
          <span className="dialog-note" />
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
