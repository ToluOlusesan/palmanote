import { useCallback, useEffect, useState } from 'react';

const KEY = 'springboard:writing';

export interface WritingSettings {
  /** A drawn cursor that slides between positions, the way Word's does. */
  animatedCaret: boolean;
  /** The greeting on launch. */
  welcome: boolean;
}

export const DEFAULTS: WritingSettings = {
  animatedCaret: true,
  welcome: true,
};

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

  const toggle = useCallback((key: keyof WritingSettings) => {
    setWritingSetting(key, !writingSettings()[key]);
  }, []);

  return { settings, toggle, reducedMotion: reducedMotion() };
}
