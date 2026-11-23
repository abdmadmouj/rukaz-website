import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ar } from '../content/ar';
import { en, type Content } from '../content/en';

export type Lang = 'en' | 'ar';
const CONTENT: Record<Lang, Content> = { en, ar };
const KEY = 'rukaz-lang';

interface LanguageValue { lang: Lang; t: Content; setLang: (l: Lang) => void }
const Ctx = createContext<LanguageValue | null>(null);

/** a pre-rendered page knows its language; otherwise /ar/ or ?lang=ar in the address wins,
 *  then the visitor's last choice, then the browser language */
function initialLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const pre = document.documentElement.dataset.prerendered;
  if (pre === 'en' || pre === 'ar') return pre;
  if (/^\/ar(\/|$)/.test(window.location.pathname)) return 'ar';
  const q = new URLSearchParams(window.location.search).get('lang');
  if (q === 'en' || q === 'ar') return q;
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'ar') return saved;
  } catch { /* storage unavailable */ }
  return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

/** the address of each language's page on the live site */
function syncAddress(l: Lang) {
  try {
    if (!/^https?:$/.test(window.location.protocol) || !document.documentElement.dataset.prerendered) return;
    const path = l === 'ar' ? '/ar/' : '/';
    if (window.location.pathname !== path) window.history.replaceState(null, '', path + window.location.hash);
  } catch { /* sandboxed preview: keep the address */ }
}

export function LanguageProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? initialLang());
  const t = CONTENT[lang];
  useEffect(() => {
    const root = document.documentElement;
    root.lang = t.lang;
    root.dir = t.dir;
    document.title = t.meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.meta.description);
  }, [t]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    syncAddress(l);
    try { window.localStorage.setItem(KEY, l); } catch { /* storage unavailable */ }
  }, []);
  const value = useMemo(() => ({ lang, t, setLang }), [lang, t, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLanguage() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLanguage outside LanguageProvider');
  return v;
}
