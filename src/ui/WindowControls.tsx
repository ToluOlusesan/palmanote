import { useEffect, useState } from 'react';

import { bridge } from '../data/bridge.ts';

/**
 * Windows caption buttons, drawn to the platform's metrics: 46×32 hit areas,
 * 10px glyphs, grey hover on minimise and restore, red on close. The restore
 * glyph is two offset squares, and it swaps with the maximise square when the
 * window is maximised — including when that happened by snapping or by
 * double-clicking the drag region rather than by pressing the button.
 */
export function WindowControls() {
  const desktop = bridge;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    void desktop.windowState().then((state) => setMaximized(state.maximized));
    return desktop.onWindowState((state) => setMaximized(state.maximized));
  }, [desktop]);

  if (!desktop) return null;

  return (
    <div className="wincontrols">
      <button type="button" className="wincontrol" aria-label="Minimise" onClick={() => desktop.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>

      <button
        type="button"
        className="wincontrol"
        aria-label={maximized ? 'Restore' : 'Maximise'}
        onClick={() => desktop.toggleMaximize()}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor">
            <rect x="0.5" y="2.5" width="7" height="7" />
            <path d="M2.5 2.5V0.5h7v7h-2" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>

      <button
        type="button"
        className="wincontrol is-close"
        aria-label="Close"
        onClick={() => desktop.close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" stroke="currentColor">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}
