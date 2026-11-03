import { useEffect, useState } from 'react';

/**
 * A line at the foot of the window that says something happened, then goes.
 *
 * For the things that happen away from where the writer is looking — a file
 * written to disk, a document opened from Explorer — and nothing that needs an
 * answer. Anything that does is a dialog.
 */

const listeners = new Set<(text: string) => void>();

/** Says it. Safe to call with nothing mounted to hear it. */
export function notify(text: string): void {
  if (!text) return;
  for (const listener of listeners) listener(text);
}

/** How long a line stays: long enough to read twice. */
const STAY_MS = 2800;

export function Notices() {
  const [items, setItems] = useState<{ id: number; text: string; leaving: boolean }[]>([]);

  useEffect(() => {
    let next = 0;
    const timers = new Set<number>();
    const listener = (text: string) => {
      const id = next++;
      setItems((current) => [...current.slice(-2), { id, text, leaving: false }]);
      const leave = window.setTimeout(() => {
        setItems((current) => current.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
        const gone = window.setTimeout(() => {
          setItems((current) => current.filter((item) => item.id !== id));
          timers.delete(gone);
        }, 200);
        timers.add(gone);
        timers.delete(leave);
      }, STAY_MS);
      timers.add(leave);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="notices" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`notice${item.leaving ? ' is-leaving' : ''}`}>
          {item.text}
        </div>
      ))}
    </div>
  );
}
