import { useSyncExternalStore } from 'react';

/**
 * Light or dark. Light is the default; a visitor's choice is remembered on this device
 * only (no cookie). The choice sits on <html data-theme>, which the stylesheet and the 3D
 * scene both follow.
 */
export type Theme = 'dark' | 'light';
const KEY = 'rukaz-theme';
const COLORS: Record<Theme, string> = { dark: '#071411', light: '#F3F6F3' };
const listeners = new Set<() => void>();
let current: Theme = 'light';

export function savedTheme(): Theme {
  try {
    const s = window.localStorage.getItem(KEY);
    if (s === 'light' || s === 'dark') return s;
  } catch { /* storage unavailable */ }
  return 'light';
}

export function applyTheme(t: Theme, remember = true) {
  current = t;
  const root = document.documentElement;
  root.dataset.theme = t;
  root.style.colorScheme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[t]);
  if (remember) {
    try { window.localStorage.setItem(KEY, t); } catch { /* storage unavailable */ }
  }
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, () => current, () => 'light' as Theme);
  return [theme, applyTheme];
}
