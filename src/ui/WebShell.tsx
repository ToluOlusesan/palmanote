import { useEffect, useState } from 'react';

import { isDesktop } from '../data/bridge.ts';
import type { TabClaim } from '../state/soleTab.ts';
import { PalmaBadge } from './PalmaMark.tsx';

/**
 * The three things the browser build has to say that the desktop one never
 * does, kept together because they are all the same admission: a tab is not a
 * window, and a browser is not a disk.
 *
 * Two of them stand in front of the app rather than inside it — a second tab
 * and a phone are both cases where opening the library would be worse than
 * declining to — and the third is a note at the foot of the window that says
 * where the work is being kept.
 *
 * None of this is reachable from the desktop shell. `isDesktop` is resolved at
 * module load, so these components are dead code there, and the app that ships
 * as an installer is unchanged by any of it.
 */

/* ------------------------------------------------------------- second tab */

export function DuplicateTab({ claim }: { claim: TabClaim }) {
  const freed = claim === 'released';

  return (
    <Standing
      title={freed ? 'The other tab has closed.' : 'PalmaNote is open in another tab.'}
      body={
        freed
          ? 'This tab can have the library now. It is still showing what it read when it opened, so it needs a reload before you write in it.'
          : 'Two tabs writing to one library would overwrite each other, and the tab that lost would never know. So this one is holding back rather than racing.'
      }
      action={{ label: freed ? 'Open it here' : 'Try again', onClick: () => window.location.reload() }}
      note={freed ? null : 'Close the other tab, then press this.'}
    />
  );
}

/* ------------------------------------------------------------ small screen */

/** Below this the sidebar, the tabs and the block gutter have nowhere to go. */
const NARROW = '(max-width: 44rem)';

/**
 * Asked once, at boot, and never again.
 *
 * A live media query would unmount the entire app the moment somebody dragged
 * their window narrow, taking the editor state and everything not yet
 * autosaved with it. A resize is not a reason to throw away a paragraph.
 */
export function useNarrowScreen(): boolean {
  const [narrow] = useState(() => !isDesktop && window.matchMedia(NARROW).matches);
  return narrow;
}

/**
 * A phone is told rather than served, and then let through anyway.
 *
 * Everything this app is made of — a sidebar, tabs, a margin holding a handle
 * beside every block, a bar that comes to a selection, thirty keyboard chords —
 * assumes a pointer and a keyboard. Pretending otherwise on a 390px screen
 * would be a worse first impression than saying so.
 *
 * It is a door rather than a wall, because someone who wants to read a page
 * they wrote on their laptop has every right to, and a link that refuses to
 * open is not a link.
 */
export function NarrowScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <Standing
      title="PalmaNote wants a bigger screen."
      body="It is built around a sidebar, a keyboard and a margin wide enough to reach into — none of which a phone has. On a laptop it will feel like it was meant to."
      action={{ label: 'Open it anyway', onClick: onContinue }}
      note="Your pages are kept in this browser, so open it on the machine you write on."
    />
  );
}

/* ------------------------------------------------------------ where it lives */

const NOTED = 'palmanote:web-storage-noted';

/**
 * Said once, at the foot of the window.
 *
 * The desktop build keeps a library in one SQLite file, copies it into
 * Documents every night and keeps thirty of those. None of that is true here:
 * this is a browser's own storage, it belongs to this browser on this machine,
 * and clearing site data takes it with everything else. That is a fair trade
 * for an app that needs no install — but only if it is said out loud, once,
 * before there is anything to lose.
 */
export function StorageNote({ onExport }: { onExport: () => void }) {
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem(NOTED) !== 'yes';
    } catch {
      // Storage refused outright — private windows do this. The note would be
      // shown on every launch, which is nagging rather than telling.
      return false;
    }
  });

  const dismiss = () => {
    setShown(false);
    try {
      localStorage.setItem(NOTED, 'yes');
    } catch {
      /* Nothing to do about it, and nothing worth failing over. */
    }
  };

  if (!shown) return null;

  return (
    <div className="webnote" role="note">
      <span className="webnote-text">
        Your pages are saved in this browser, on this machine — no account, nothing uploaded.
        Clearing your browsing data would erase them, so keep a copy somewhere of your own.
      </span>
      <button
        type="button"
        className="btn is-primary"
        onClick={() => {
          onExport();
          dismiss();
        }}
      >
        Export a copy
      </button>
      <button type="button" className="btn" onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ shared */

/**
 * The shape both standing screens take. Same badge, same measure, same one
 * action — so the tab that says "not here" and the phone that says "not yet"
 * read as the same app being careful, rather than two error pages.
 */
function Standing({
  title,
  body,
  action,
  note,
}: {
  title: string;
  body: string;
  action: { label: string; onClick: () => void };
  note: string | null;
}) {
  useEffect(() => {
    document.title = `${title} — PalmaNote`;
    return () => {
      document.title = 'PalmaNote';
    };
  }, [title]);

  return (
    <div className="standing">
      <div className="standing-card">
        <PalmaBadge size={52} />
        <h1 className="standing-title">{title}</h1>
        <p className="standing-body">{body}</p>
        <button type="button" className="btn is-primary standing-action" onClick={action.onClick}>
          {action.label}
        </button>
        {note && <p className="standing-note">{note}</p>}
      </div>
    </div>
  );
}
