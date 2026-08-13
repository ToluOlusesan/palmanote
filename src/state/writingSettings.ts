import { useCallback, useEffect, useState } from 'react';

const KEY = 'palmanote:writing';

export interface WritingSettings {
  /** A drawn cursor that slides between positions, the way Word's does. */
  animatedCaret: boolean;
  /** The greeting on launch. */
  welcome: boolean;
  /** What the app calls you. Empty is a real answer — see `whatToCallYou`. */
  name: string;
}

export const DEFAULTS: WritingSettings = {
  animatedCaret: true,
  welcome: true,
  // Empty rather than a guess. The app had a name hard-coded into it, which
  // was fine while one person used it and wrong the moment anyone else built
  // a copy — see whatToCallYou for what empty turns into.
  name: '',
};

/**
 * What the app calls you.
 *
 * "you" rather than a blank, and it is worth being deliberate about why: the
 * greeting is one line and the name is the middle of it, so an empty setting
 * has to become a word rather than a gap. "Hey you," is what a person would
 * say when they do not know your name yet, and it reads as a greeting rather
 * than as a missing value.
 *
 * Trimmed, because a name of three spaces is not a name — and typing one into
 * the field and getting "Hey    ," back would look like a bug in the greeting
 * rather than an answer to what was typed.
 */
export function whatToCallYou(name: string): string {
  return name.trim() || 'you';
}

/**
 * The settings that are switches, which is not all of them any more.
 *
 * `toggle` inverts what it is given, so it must never be handed the name — and
 * this is the type that says so, rather than a comment asking nicely.
 */
type Switchable = {
  [K in keyof WritingSettings]: WritingSettings[K] extends boolean ? K : never;
}[keyof WritingSettings];

function read(): WritingSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<WritingSettings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/** Someone who has asked their system to stop animating things means it. */
function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let current = read();
const listeners = new Set<() => void>();

export function writingSettings(): WritingSettings {
  if (reducedMotion()) return { ...current, animatedCaret: false };
  return current;
}

export function setWritingSetting<K extends keyof WritingSettings>(
  key: K,
  value: WritingSettings[K],
): void {
  current = { ...current, [key]: value };
  localStorage.setItem(KEY, JSON.stringify(current));
  for (const listener of listeners) listener();
}

export function useWritingSettings() {
  const [settings, setSettings] = useState(writingSettings);

  useEffect(() => {
    const refresh = () => setSettings(writingSettings());
    listeners.add(refresh);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    motion.addEventListener('change', refresh);
    return () => {
      listeners.delete(refresh);
      motion.removeEventListener('change', refresh);
    };
  }, []);

  const toggle = useCallback((key: Switchable) => {
    setWritingSetting(key, !writingSettings()[key]);
  }, []);

  return { settings, toggle, set: setWritingSetting, reducedMotion: reducedMotion() };
}
