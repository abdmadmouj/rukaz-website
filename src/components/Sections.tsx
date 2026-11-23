import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Audience } from '../forms/schema';
import { useLanguage } from '../i18n/LanguageProvider';
import { Arrow, Mark } from './Brand';
import { brand } from '../config/brand';

type Open = { onOpen: (a: Audience) => void };

/**
 * One scene per screen. Each section holds the screen while its words come in, stay and
 * leave (driven by the scroll, Apple style); the sculpture takes the upper half and the
 * words sit centred below it, so nothing ever lies on the plates.
 */
function Scene({ id, stop, chapter, labelledBy, className = '', hero = false, scrub = hero ? 'out' : 'both', children }: {
  id: string; stop?: string; chapter?: string; labelledBy: string; className?: string; hero?: boolean; scrub?: 'in' | 'out' | 'both'; children: ReactNode;
}) {
  return (
    <section id={id} className={`scene ${hero ? 'scene--hero' : ''} ${className}`} data-stop={stop} data-chapter={chapter} aria-labelledby={labelledBy}>
      <div className="scene__pin">
        <div className="scene__copy" data-scrub={scrub}>{children}</div>
      </div>
    </section>
  );
}

/** buttons sit together in one frosted glass panel */
function Actions({ children }: { children: ReactNode }) {
  return <div className="glass-actions">{children}</div>;
}

/** phones (≤ 640 px): sections show only their headline over the sculpture */
const PHONE = '(max-width: 640px)';
function usePhone() {
  return useSyncExternalStore(
    (fn) => { const m = window.matchMedia(PHONE); m.addEventListener('change', fn); return () => m.removeEventListener('change', fn); },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

/**
 * A headline that opens its section. On phones the words stay folded so the sculpture is seen
 * whole; pressing the headline opens the rest. On larger screens everything simply shows.
 */
function Fold({ eyebrow, title, titleId, className, children }: { eyebrow?: string; title: ReactNode; titleId: string; className?: string; children: ReactNode }) {
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const bodyId = `${titleId}-more`;
  const button = useRef<HTMLButtonElement>(null);
  const anchor = useRef<number | null>(null);
  // opening brings the headline up under the header so the words below it come into view;
  // closing keeps the headline where the finger left it
  useLayoutEffect(() => {
    const b = button.current;
    if (!b || anchor.current === null) return;
    const top = b.getBoundingClientRect().top;
    const was = anchor.current;
    anchor.current = null;
    if (open) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: window.scrollY + (top - was), behavior: 'instant' });
      window.scrollTo({ top: window.scrollY + (was - 96), behavior: reduce ? 'instant' : 'smooth' });
    } else if (Math.abs(top - was) > 1) {
      window.scrollTo({ top: window.scrollY + (top - was), behavior: 'instant' });
    }
  }, [open]);
  useEffect(() => {
    const section = ref.current?.closest<HTMLElement>('.scene');
    if (!section) return;
    if (phone) section.dataset.fold = open ? 'open' : 'closed';
    else delete section.dataset.fold;
  }, [phone, open]);
  return (
    <>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2 id={titleId} className={className}>
        {phone ? (
          <button ref={button} type="button" className="fold__button" aria-expanded={open} aria-controls={bodyId}
            onClick={(e) => { anchor.current = e.currentTarget.getBoundingClientRect().top; setOpen((v) => !v); }}>
            <span>{title}</span>
            <span className="fold__icon" aria-hidden="true" />
          </button>
        ) : title}
      </h2>
      <div id={bodyId} ref={ref} className="fold__body" hidden={phone && !open}>{children}</div>
    </>
  );
}

export function Hero({ note, onOpen }: { note?: string } & Open) {
  const { t } = useLanguage();
  return (
    <Scene id="top" stop="hero" chapter="hero" labelledBy="hero-title" hero>
      <div data-enter>
        <p className="eyebrow" data-enter-item>{t.hero.eyebrow}</p>
        <h1 id="hero-title" className="hero__title">
          <span className="line"><span>{t.hero.line1}</span></span> <span className="line"><span>{t.hero.line2}</span></span>
        </h1>
        <p className="hero__support" data-enter-item>{t.hero.support}</p>
        <div data-enter-item>
          <Actions>
            <button type="button" className="pill pill--primary" onClick={() => onOpen('diagnostic')} aria-haspopup="dialog">{t.hero.cta}<Arrow /></button>
            <a className="pill pill--ghost" href="#process">{t.hero.secondary}</a>
          </Actions>
        </div>
        <p className="hero__proof" data-enter-item>{t.hero.proof}</p>
        {note ? <p className="hero__note">{note}</p> : null}
      </div>
    </Scene>
  );
}

export function Who({ onOpen }: Open) {
  const { t } = useLanguage();
  const w = t.who;
  return (
    <Scene id="who" stop="who" chapter="who" labelledBy="who-title">
      <Fold eyebrow={w.overline} title={w.title} titleId="who-title">
      <p className="lead">{w.lead}</p>
      <div className="duo">
        <article className="card" id="groups" tabIndex={-1}>
          <h3>{w.groups.title}</h3>
          <p>{w.groups.body}</p>
          <button type="button" className="text-link" onClick={() => onOpen('group')} aria-haspopup="dialog">{w.groups.cta}<Arrow /></button>
        </article>
        <article className="card" id="founders" tabIndex={-1}>
          <h3>{w.founders.title}</h3>
          <p>{w.founders.body}</p>
          <button type="button" className="text-link" onClick={() => onOpen('founder')} aria-haspopup="dialog">{w.founders.cta}<Arrow /></button>
        </article>
      </div>
      <p className="also">
        <span>{w.more}</span>
        <button type="button" className="text-link" onClick={() => onOpen('investor')} aria-haspopup="dialog">{w.investors}</button>
        <button type="button" className="text-link" onClick={() => onOpen('sponsor')} aria-haspopup="dialog">{w.sponsors}</button>
      </p>
      </Fold>
    </Scene>
  );
}

export function Ways() {
  const { t } = useLanguage();
  const w = t.ways;
  return (
    <Scene id="ways" stop="ways" chapter="ways" labelledBy="ways-title">
      <Fold eyebrow={w.overline} title={w.title} titleId="ways-title">
      <p className="lead">{w.intro}</p>
      <ol className="trio">
        {w.items.map((item) => (
          <li key={item.title}>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
            <p className="meta-line"><span>{item.length}</span><span aria-hidden="true"> · </span><span>{item.paid}</span></p>
          </li>
        ))}
      </ol>
      </Fold>
    </Scene>
  );
}

const GATES = ['discover', 'validate', 'build', 'scale'] as const;

/**
 * How an engagement moves: one held scene. As you scroll, the gates light up one by one and
 * the words change in place (each step fades out as the next comes in). The markers tell the
 * sculpture when to move on to the next gate.
 */
export const GATE_SPACING = 130; // vh of scroll per gate after the first
export function Process() {
  const { t } = useLanguage();
  const p = t.process;
  // every gate, the last included, gets its own stretch of held scroll
  const pin = GATE_SPACING * p.steps.length;
  return (
    <section id="process" className="scene scene--steps" data-stop="discover" data-chapter="process" aria-labelledby="process-title"
      style={{ height: `calc(100svh + ${pin}vh)` }}>
      {GATES.slice(1).map((g, k) => (
        <span key={g} id={`step-${g}`} className="scene__marker" data-stop={g} aria-hidden="true" style={{ ['--k' as string]: k + 1, ['--gap' as string]: `${GATE_SPACING}vh` }} />
      ))}
      <div className="scene__pin">
        <div className="scene__copy" data-scrub="both" data-fade="0.06">
        <Fold eyebrow={p.overline} title={p.title} titleId="process-title">
        <div className="steps-stack">
          {p.steps.map((s, i) => {
            // each step holds the words until the next gate; neighbours crossfade over 40vh
            // around the gate, so there is never a stretch with no step showing
            const last = p.steps.length - 1;
            const startVh = i === 0 ? 0 : i * GATE_SPACING - 20;
            const endVh = i === last ? pin : (i + 1) * GATE_SPACING + 20;
            const fade = Math.min(0.4, 36 / (endVh - startVh)).toFixed(3);
            return (
              <div key={s.title} id={i === 0 ? 'step-discover' : undefined} className="step-copy" data-scrub={i === 0 ? 'out' : i === last ? 'in' : 'both'} data-range={`${startVh / pin},${endVh / pin}`} data-fade={fade}>
                <p className="step__num">{String(i + 1).padStart(2, '0')} / 04</p>
                <h3 className="step__title">{s.title}</h3>
                <p className="lead">{s.body}</p>
                <dl className="facts-row">
                  <div><dt>{p.timeLabel}</dt><dd>{s.time}</dd></div>
                  <div><dt>{p.receiveLabel}</dt><dd>{s.receive}</dd></div>
                  <div><dt>{p.decisionLabel}</dt><dd>{s.decision}</dd></div>
                </dl>
              </div>
            );
          })}
        </div>
        </Fold>
        </div>
      </div>
    </section>
  );
}

export function Proof() {
  const { t } = useLanguage();
  const p = t.proof;
  return (
    <Scene id="proof" stop="proof" chapter="proof" labelledBy="proof-title">
      <Fold eyebrow={p.overline} title={p.title} titleId="proof-title">
      <div className="glass-box">
        <dl className="numbers">
          {p.facts.map((f) => (
            <div key={f.label}><dd>{f.value}</dd><dt>{f.label}</dt></div>
          ))}
        </dl>
        <p className="fine">{p.note}</p>
      </div>
      </Fold>
    </Scene>
  );
}

/** Team: kept off the page until the team photography is done (content.team.published). */
export function Team() {
  const { t } = useLanguage();
  if (!t.team.published) return null;
  return (
    <Scene id="team" chapter="team" labelledBy="team-title">
      <p className="eyebrow">{t.team.overline}</p>
      <h2 id="team-title">{t.team.title}</h2>
    </Scene>
  );
}

export function Terms() {
  const { t } = useLanguage();
  const T = t.terms;
  return (
    <>
      <Scene id="terms" stop="terms" chapter="terms" labelledBy="terms-title">
        <Fold eyebrow={T.overline} title={T.title} titleId="terms-title">
        <dl className="quad">
          {T.items.map((i) => (
            <div key={i.title}><dt>{i.title}</dt><dd>{i.body}</dd></div>
          ))}
        </dl>
        </Fold>
      </Scene>
      <Scene id="faq" chapter="terms" labelledBy="faq-title" className="faq">
        <Fold title={T.faqTitle} titleId="faq-title">
        {/* one answer open at a time (shared name), so the list never grows into the sculpture */}
        <div className="qa">
          {[T.faq.slice(0, Math.ceil(T.faq.length / 2)), T.faq.slice(Math.ceil(T.faq.length / 2))].map((col, c) => (
            <div key={c} className="qa__col">
              {col.map((f) => (
                <details key={f.q} name="faq">
                  <summary><span>{f.q}</span><span className="qa__icon" aria-hidden="true" /></summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          ))}
        </div>
        </Fold>
      </Scene>
    </>
  );
}

const PATHS = ['group', 'founder', 'investor', 'sponsor', 'talent'] as const;

export function Contact({ onOpen }: Open) {
  const { t } = useLanguage();
  const c = t.contact;
  return (
    <Scene id="contact" stop="contact" chapter="contact" labelledBy="contact-title">
      <Fold eyebrow={c.overline} title={c.title} titleId="contact-title">
      <p className="lead">{c.intro}</p>
      <ul className="paths">
        {PATHS.map((k) => (
          <li key={k}>
            <button type="button" className="path" onClick={() => onOpen(k)} aria-haspopup="dialog">
              <span className="path__title">{c.items[k].title}</span>
              <span className="path__cta">{c.items[k].cta}<Arrow /></span>
            </button>
          </li>
        ))}
      </ul>
      <p className="fine">{c.presence}</p>
      </Fold>
    </Scene>
  );
}

export function Connect({ onOpen }: Open) {
  const { t } = useLanguage();
  const c = t.connect;
  return (
    <Scene id="connect" stop="connect" chapter="connect" labelledBy="connect-title" hero scrub="in">
      <p className="eyebrow">{c.overline}</p>
      <h2 id="connect-title" className="close__title"><span>{c.title[0]}</span> <span>{c.title[1]}</span></h2>
      <p className="hero__support">{c.body}</p>
      <Actions>
        <button type="button" className="pill pill--primary" onClick={() => onOpen('diagnostic')} aria-haspopup="dialog">{t.nav.primary}<Arrow /></button>
        <button type="button" className="pill pill--ghost" onClick={() => onOpen('group')} aria-haspopup="dialog">{t.contact.items.group.cta}</button>
      </Actions>
    </Scene>
  );
}

export function Footer() {
  const { t } = useLanguage();
  // the close holds still while the footer slides up over it: the page needs the footer's height
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty('--footer-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--footer-h'); };
  }, []);
  return (
    <footer className="site-footer" ref={ref}>
      <Mark className="site-footer__mark" title="RUKAZ" />
      <p className="site-footer__story">{t.connect.story}</p>
      <ul className="site-footer__social" aria-label={t.connect.social}>
        {brand.social.map((s) => {
          const inner = (
            <>
              {brand.socialIcons ? <img src={`/images/social/${s.key}.svg`} alt="" width="18" height="18" /> : null}
              <span>{s.label}</span>
            </>
          );
          return (
            <li key={s.key}>
              {s.url
                ? <a href={s.url} target="_blank" rel="noopener noreferrer me" aria-label={`${s.label} (${t.connect.newTab})`}>{inner}</a>
                : <span className="site-footer__social-soon">{inner}</span>}
            </li>
          );
        })}
      </ul>
      <div className="site-footer__meta">
        <span>{t.connect.line}</span>
        <span>{t.connect.rights}</span>
      </div>
    </footer>
  );
}
