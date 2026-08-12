import { useCallback, useEffect, useState } from 'react';

const THEME_KEY = 'springboard:theme';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];

function read(): ThemeChoice {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Three states rather than two: following the machine is a real preference,
 * and a writer who works into the evening should not have to flip a switch
 * when their desktop already does.
 */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  const [system, setSystem] = useState<Theme>(systemTheme);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  const resolved: Theme = choice === 'system' ? system : choice;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    // Tells the engine which scrollbars, form controls and caret to draw.
    document.documentElement.style.colorScheme = resolved;
    localStorage.setItem(THEME_KEY, choice);
  }, [choice, resolved]);

  const cycle = useCallback(() => {
    setChoice((current) => ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!);
  }, []);

  return { choice, resolved, cycle };
}
