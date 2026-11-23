import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useTheme } from '../theme/theme';
import type { Audience } from '../forms/schema';
import { useLanguage } from '../i18n/LanguageProvider';
import { Arrow, Lockup } from './Brand';

export const CHAPTERS = ['hero', 'who', 'ways', 'process', 'proof', 'terms', 'contact', 'connect'] as const;
export type Chapter = (typeof CHAPTERS)[number];

function LangSwitch() {
  const { lang, setLang, t } = useLanguage();
  return (
    <div className="lang-switch" role="group" aria-label={t.nav.languageLabel}>
      <button type="button" lang="en" aria-pressed={lang === 'en'} aria-label={t.nav.english} onClick={() => setLang('en')}>{t.nav.englishShort}</button>
      <span aria-hidden="true">/</span>
      <button type="button" lang="ar" aria-pressed={lang === 'ar'} aria-label={t.nav.arabic} onClick={() => setLang('ar')}>{lang === 'ar' ? 'عربي' : 'AR'}</button>
    </div>
  );
}

/** a small settings button: language and light or dark, in one quiet popover */
type SoundProps = { soundOn: boolean; onToggleSound: () => void };

function Settings({ soundOn, onToggleSound }: SoundProps) {
  const { lang, setLang, t } = useLanguage();
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', esc);
    document.addEventListener('pointerdown', away);
    return () => { window.removeEventListener('keydown', esc); document.removeEventListener('pointerdown', away); };
  }, [open]);
  return (
    <div className="settings" ref={wrap}>
      <button ref={button} type="button" className="settings__button" aria-label={t.nav.settings} aria-expanded={open} aria-controls="settings-panel" onClick={() => setOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="17" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <div id="settings-panel" className="settings__panel" data-open={open} hidden={!open}>
        <div className="settings__row" role="group" aria-label={t.nav.languageLabel}>
          <span className="settings__label" aria-hidden="true">{t.nav.languageLabel}</span>
          <div className="segmented">
            <button type="button" lang="en" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
            <button type="button" lang="ar" aria-pressed={lang === 'ar'} onClick={() => setLang('ar')}>العربية</button>
          </div>
        </div>
        <div className="settings__row" role="group" aria-label={t.nav.themeLabel}>
          <span className="settings__label" aria-hidden="true">{t.nav.themeLabel}</span>
          <div className="segmented">
            <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>{t.nav.dark}</button>
            <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>{t.nav.light}</button>
          </div>
        </div>
        <div className="settings__row" role="group" aria-label={t.sound.label}>
          <span className="settings__label" aria-hidden="true">{t.sound.label}</span>
          <div className="segmented">
            <button type="button" aria-pressed={!soundOn} onClick={() => { if (soundOn) onToggleSound(); }}>{t.sound.off}</button>
            <button type="button" aria-pressed={soundOn} onClick={() => { if (!soundOn) onToggleSound(); }}>{t.sound.on}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Header({ activeChapter, onOpen, soundOn, onToggleSound }: { activeChapter: Chapter; onOpen: (a: Audience) => void } & SoundProps) {
  const { t, lang } = useLanguage();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > window.innerHeight * 0.6);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  const links = [
    { href: '#who', label: t.nav.who, chapters: ['who'] },
    { href: '#process', label: t.nav.process, chapters: ['process'] },
    { href: '#proof', label: t.nav.proof, chapters: ['proof'] },
    ...(t.team.published ? [{ href: '#team', label: t.nav.team, chapters: ['team'] }] : []),
    { href: '#terms', label: t.nav.terms, chapters: ['terms'] },
  ];
  const book = () => { setOpen(false); onOpen('diagnostic'); };
  const go = (e: ReactMouseEvent<HTMLAnchorElement>, href: string) => {
    if (!document.querySelector(href)) return;
    e.preventDefault();
    setOpen(false);
    scrollToSection(href);
  };
  return (
    <>
      <header className="site-header" data-scrolled={scrolled || open}>
        <div className="site-header__bar">
          <a className="wordmark" href="#top" aria-label={t.nav.home}><Lockup lang={lang} /></a>
          <nav className="site-nav" aria-label={t.nav.label}>
            <ul>
              {links.map((l) => (
                <li key={l.href}><a href={l.href} onClick={(e) => go(e, l.href)} aria-current={l.chapters.includes(activeChapter) ? 'true' : undefined}>{l.label}</a></li>
              ))}
            </ul>
          </nav>
          <div className="site-header__end">
            <Settings soundOn={soundOn} onToggleSound={onToggleSound} />
            <button type="button" className="pill pill--signal" onClick={book} aria-haspopup="dialog">{t.nav.primary}</button>
            <button type="button" className="menu-toggle" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((v) => !v)}>{open ? t.nav.close : t.nav.menu}</button>
          </div>
        </div>
      </header>
      <div id="mobile-nav" className="mobile-nav" data-open={open} hidden={!open}>
        <nav aria-label={t.nav.label}>
          <ul>
            {links.map((l) => (
              <li key={l.href}><a href={l.href} onClick={(e) => go(e, l.href)}>{l.label}<Arrow /></a></li>
            ))}
          </ul>
        </nav>
        <div className="mobile-nav__end">
          <LangSwitch />
          <button type="button" className="pill pill--signal" onClick={book} aria-haspopup="dialog">{t.nav.primary}</button>
        </div>
      </div>
    </>
  );
}

/**
 * In-page links land where the section's words are fully on screen. A plain jump to a card
 * inside a held (pinned) scene lands past its hold, where the words have already faded and
 * the next form has begun.
 */
export function scrollToSection(href: string) {
  const el = document.querySelector<HTMLElement>(href);
  if (!el) return;
  const section = el.closest<HTMLElement>('.scene') ?? el;
  const top = section.getBoundingClientRect().top + window.scrollY;
  const held = Math.max(0, section.offsetHeight - window.innerHeight);
  const pinned = window.matchMedia('(min-width: 901px) and (min-aspect-ratio: 6/5)').matches;
  const phone = window.matchMedia('(max-width: 640px)').matches;
  // the gates scene opens on its first gate; other scenes are read mid-hold
  const y = href === '#top' ? 0 : !pinned ? el.getBoundingClientRect().top + window.scrollY - (phone ? 56 : 80) : section.id === 'process' ? top + 2 : top + held * 0.45;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
}

export function BottomBar({ chapter, soundOn, onToggleSound }: { chapter: Chapter; soundOn: boolean; onToggleSound: () => void }) {
  const { t } = useLanguage();
  const index = Math.max(0, CHAPTERS.indexOf(chapter));
  // the bar steps aside while the (white) footer is on screen, so it never sits on it
  const [away, setAway] = useState(false);
  useEffect(() => {
    const footer = document.querySelector('.site-footer');
    if (!footer || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setAway(e.isIntersecting), { rootMargin: '0px 0px -40px 0px' });
    io.observe(footer);
    return () => io.disconnect();
  }, []);
  return (
    <div className="bottom-bar" data-away={away} inert={away}>
      <div className="bottom-bar__inner">
        <span className="bottom-bar__scroll" data-hidden={chapter !== 'hero'} aria-hidden={chapter !== 'hero'}>{t.hero.scroll}</span>
        <span className="bottom-bar__chapter" aria-live="polite">{String(index + 1).padStart(2, '0')} / {t.chapters[CHAPTERS[index]]}</span>
        <button type="button" className="sound-toggle" aria-pressed={soundOn} aria-label={soundOn ? t.sound.turnOff : t.sound.turnOn} onClick={onToggleSound}>
          {t.sound.label}: <span className="sound-toggle__state">{soundOn ? t.sound.on : t.sound.off}</span>
        </button>
      </div>
    </div>
  );
}
