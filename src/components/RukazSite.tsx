import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChapterKey } from '../config/soundDesign';
import type { Audience } from '../forms/schema';
import { LanguageProvider, useLanguage } from '../i18n/LanguageProvider';
import { SceneBridge } from '../scene/bridge';
import { detectQuality, supportsWebGL2 } from '../scene/quality';
import type { Quality } from '../scene/RukazScene';
import type { FrameStats } from '../scene/runtime';
import { scrollStage } from '../scroll/scrollStage';
import { Soundscape } from '../sound/soundscape';
import { BottomBar, CHAPTERS, Header, type Chapter } from './Chrome';
import { InterestDialog } from './InterestDialog';
import { SceneHost } from './SceneHost';
import { useTheme } from '../theme/theme';
import { Connect, Contact, Footer, Hero, Process, Proof, Team, Terms, Ways, Who } from './Sections';

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

function Site() {
  const { t, lang } = useLanguage();
  const mainRef = useRef<HTMLElement>(null);
  const bridge = useMemo(() => new SceneBridge(), []);
  const reduced = useReducedMotion();
  const [scene, setScene] = useState<{ quality: Quality } | 'none' | null>(null);
  const [chapter, setChapter] = useState<Chapter>('hero');
  const [audience, setAudience] = useState<Audience | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [debug, setDebug] = useState(false);
  const sound = useRef<Soundscape | null>(null);
  const hud = useRef<HTMLDivElement>(null);
  const scroller = useRef<ReturnType<typeof scrollStage> | null>(null);

  useEffect(() => {
    setDebug(new URLSearchParams(window.location.search).has('debug'));
    setScene(supportsWebGL2() ? { quality: detectQuality() } : 'none');
  }, []);
  useEffect(() => bridge.setDirection(t.dir as 'ltr' | 'rtl'), [bridge, t.dir]);
  const [theme] = useTheme();
  useEffect(() => bridge.setTheme(theme), [bridge, theme]);
  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;
    const s = scrollStage(root, {
      onStage: (v) => bridge.setStage(v),
      onChapter: (c) => { if ((CHAPTERS as readonly string[]).includes(c)) setChapter(c as Chapter); },
      reducedMotion: reduced,
    });
    scroller.current = s;
    return () => { s.dispose(); scroller.current = null; };
  }, [bridge, reduced]);
  useEffect(() => {
    const id = requestAnimationFrame(() => scroller.current?.refresh());
    return () => cancelAnimationFrame(id);
  }, [lang]);
  // tell the sculpture where each section's words begin, so its form always ends above them
  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;
    const measure = () => {
      const vh = window.innerHeight;
      const areas: Record<string, number> = {};
      root.querySelectorAll<HTMLElement>('.scene[data-stop]').forEach((sec) => {
        const pin = sec.querySelector<HTMLElement>('.scene__pin');
        const copy = sec.querySelector<HTMLElement>('.scene__copy');
        if (!pin || !copy) return;
        const padBottom = parseFloat(getComputedStyle(pin).paddingBottom) || 0;
        const y1 = (vh - padBottom - copy.offsetHeight) / vh - 0.04;
        areas[sec.dataset.stop!] = y1;
        // the gates share one held scene, so they share its space
        sec.querySelectorAll<HTMLElement>('.scene__marker[data-stop]').forEach((m) => { areas[m.dataset.stop!] = y1; });
      });
      bridge.setAreas(areas);
    };
    measure();
    const ro = new ResizeObserver(measure);
    root.querySelectorAll('.scene__copy').forEach((el) => ro.observe(el));
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [bridge, lang]);
  useEffect(() => bridge.onContact((i, s, id, step) => {
    sound.current?.contact(i, s, id, step);
    if (debug) (window as unknown as { __rings: number }).__rings = ((window as unknown as { __rings?: number }).__rings ?? 0) + 1;
  }), [bridge, debug]);
  useEffect(() => () => sound.current?.dispose(), []);
  useEffect(() => { sound.current?.setChapter(chapter as ChapterKey); }, [chapter]);

  const toggleSound = useCallback(() => {
    if (!sound.current) {
      sound.current = new Soundscape();
      sound.current.setChapter(chapter as ChapterKey);
    }
    if (sound.current.enabled) { sound.current.disable(); setSoundOn(false); }
    else { void sound.current.enable(); setSoundOn(true); }
  }, [chapter]);
  const stats = useCallback((s: FrameStats) => {
    if (hud.current) hud.current.textContent = `cpu+submit ${s.ms.toFixed(1)} ms\ndpr ${s.dpr.toFixed(2)}\ndraw calls ${s.calls}\ntriangles ${s.triangles}`;
  }, []);
  const fail = useCallback(() => setScene('none'), []);

  return (
    <>
      <a className="skip-link" href="#content">{t.skipLink}</a>
      <div className="scene-layer">
        {scene && scene !== 'none' ? (
          <SceneHost key={reduced ? 'reduced' : 'full'} bridge={bridge} quality={scene.quality} reducedMotion={reduced} onFailure={fail} onStats={debug ? stats : undefined} />
        ) : scene === 'none' ? <img className="scene-fallback" src="/images/hero-render.jpg" alt="" /> : null}
      </div>
      <div className="grain" aria-hidden="true" />
      <Header activeChapter={chapter} onOpen={setAudience} soundOn={soundOn} onToggleSound={toggleSound} />
      <main id="content" ref={mainRef} tabIndex={-1}>
        <Hero note={scene === 'none' ? t.fallback.noWebgl : undefined} onOpen={setAudience} />
        <Who onOpen={setAudience} />
        <Ways />
        <Process />
        <Proof />
        <Team />
        <Terms />
        <Contact onOpen={setAudience} />
        <Connect onOpen={setAudience} />
        <Footer />
      </main>
      <BottomBar chapter={chapter} soundOn={soundOn} onToggleSound={toggleSound} />
      <InterestDialog audience={audience} onClose={() => setAudience(null)} />
      {debug ? <div ref={hud} className="perf-hud" aria-hidden="true" /> : null}
    </>
  );
}

export function RukazSite({ lang }: { lang?: 'en' | 'ar' } = {}) {
  return (
    <LanguageProvider initial={lang}>
      <Site />
    </LanguageProvider>
  );
}
