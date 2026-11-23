import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { STOPS } from '../scene/choreography';

let registered = false;
function register() {
  if (registered) return;
  gsap.registerPlugin(ScrollTrigger, CustomEase);
  // the brand ease (strong ease-out): quick to arrive, slow to settle
  CustomEase.create('brand', 'M0,0 C0.23,1 0.32,1 1,1');
  registered = true;
}

export interface ScrollStageOptions {
  onStage: (stage: number) => void;
  onChapter: (chapter: string) => void;
  reducedMotion: boolean;
}

/**
 * Scroll drives the sculpture. Each [data-stop] section contributes 0..1 as it travels from
 * the bottom of the screen to the top; the stage is the sum, so the plates rebuild while the
 * next section rises into place, and the form is complete when its section pins.
 */
export function scrollStage(root: HTMLElement, opts: ScrollStageOptions) {
  register();
  const ctx = gsap.context(() => {
    const els = STOPS.slice(1)
      .map((name) => root.querySelector<HTMLElement>(`[data-stop="${name}"]`))
      .filter((el): el is HTMLElement => !!el);
    const progress = new Float32Array(els.length);
    const emit = () => {
      let s = 0;
      for (let i = 0; i < progress.length; i++) s += progress[i];
      opts.onStage(s);
    };
    els.forEach((el, i) => {
      ScrollTrigger.create({
        trigger: el,
        start: 'top bottom',
        end: 'top top',
        onUpdate: (st) => { progress[i] = st.progress; emit(); },
        onRefresh: (st) => { progress[i] = st.progress; emit(); },
      });
    });
    root.querySelectorAll<HTMLElement>('[data-chapter]').forEach((el) => {
      ScrollTrigger.create({ trigger: el, start: 'top 55%', end: 'bottom 55%', onToggle: (st) => st.isActive && opts.onChapter(el.dataset.chapter!) });
    });
  }, root);
  const scrub = scrubCopy(root, opts.reducedMotion);
  const refresh = () => { ScrollTrigger.refresh(); scrub.measure(); };
  let timer = 0;
  let height = root.scrollHeight;
  const ro = new ResizeObserver(() => {
    if (Math.abs(root.scrollHeight - height) < 2) return;
    height = root.scrollHeight;
    window.clearTimeout(timer);
    timer = window.setTimeout(refresh, 120);
  });
  ro.observe(root);
  document.fonts?.ready.then(refresh).catch(() => {});
  return {
    refresh,
    dispose: () => {
      ro.disconnect();
      scrub.dispose();
      window.clearTimeout(timer);
      ctx.revert();
    },
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Apple-style copy: while a section holds the screen its words come in (fade and a short
 * rise), stay, then leave before the plates rebuild. Scrubbed to the scrollbar (it runs back
 * on the way up); transform and opacity only. Phones, reduced motion and no script: the words
 * simply stand.
 */
function scrubCopy(root: HTMLElement, reduced: boolean) {
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-scrub]'));
  const still = () => reduced || window.matchMedia('(max-width: 900px), (max-aspect-ratio: 6/5)').matches;
  let spans: { el: HTMLElement; top: number; len: number; mode: string; a: number; b: number; f: number }[] = [];
  let raf = 0;
  const measure = () => {
    spans = els.map((el) => {
      const section = el.closest<HTMLElement>('.scene')!;
      const rect = section.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      // data-range="a,b": the slice of the held scroll this block owns (default: all of it)
      const [a, b] = (el.dataset.range ?? '0,1').split(',').map(Number);
      // data-fade: share of the slice spent fading in (and out); long held scenes fade quickly
      const f = Number(el.dataset.fade ?? 0.2);
      const held = section.offsetHeight - window.innerHeight;
      // a section that does not hold the screen (the close) brings its words in as it rises
      if (held < window.innerHeight * 0.25) {
        const rise = window.innerHeight * 0.6;
        return { el, top: top - rise, len: rise, mode: el.dataset.scrub ?? 'both', a, b, f };
      }
      return { el, top, len: Math.max(1, held), mode: el.dataset.scrub ?? 'both', a, b, f };
    });
    update();
  };
  const update = () => {
    raf = 0;
    const isStill = still();
    const y = window.scrollY;
    for (const s of spans) {
      if (isStill) {
        s.el.style.opacity = '';
        s.el.style.transform = '';
        continue;
      }
      const raw = (y - s.top) / s.len;
      const p = (raw - s.a) / (s.b - s.a);
      // words that open a section arrive while it rises, so they are fully there the moment
      // it holds the screen; later blocks (the gates) crossfade inside their own slice
      const lead = (window.innerHeight * 0.4) / s.len;
      const inn = s.mode === 'out' ? 1 : s.a <= 0 ? smooth(-lead, -0.005, raw) : smooth(-0.02, s.f, p);
      const out = s.mode === 'in' ? 1 : 1 - smooth(1 - s.f - 0.02, 0.98, p);
      const o = Math.min(inn, out);
      const dy = (1 - inn) * 28 - (1 - out) * 28;
      const sc = 0.985 + 0.015 * o;
      s.el.style.opacity = o.toFixed(3);
      s.el.style.transform = `translate3d(0, ${dy.toFixed(1)}px, 0) scale(${sc.toFixed(4)})`;
      // never hidden: faded words stay in the keyboard order and are read by screen readers;
      // they only stop catching stray clicks while invisible
      s.el.style.pointerEvents = o < 0.05 ? 'none' : '';
    }
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
  // keyboard: tabbing into a section scrolls it to its reading position, so the focused
  // control is always on screen and fully visible
  const onFocus = (e: FocusEvent) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-scrub]');
    const span = el && spans.find((s) => s.el === el);
    if (!span || still()) return;
    const a = Math.max(0, span.a), b = Math.min(1, span.b);
    const p = (window.scrollY - span.top) / span.len;
    if (p > a + (b - a) * 0.22 && p < a + (b - a) * 0.76) return;
    window.scrollTo({ top: span.top + span.len * (a + (b - a) * 0.45), behavior: 'instant' as ScrollBehavior });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  root.addEventListener('focusin', onFocus);
  window.addEventListener('resize', measure);
  // positions go stale when anything above changes height (fonts arriving, hydration, an
  // answer opening), so measure again whenever the page's size changes
  let pending = 0;
  const remeasure = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; measure(); }); };
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure);
  ro?.observe(root);
  document.fonts?.ready.then(remeasure).catch(() => {});
  window.addEventListener('load', remeasure);
  measure();
  return {
    measure,
    dispose: () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
      window.removeEventListener('load', remeasure);
      ro?.disconnect();
      cancelAnimationFrame(pending);
      root.removeEventListener('focusin', onFocus);
      cancelAnimationFrame(raf);
      for (const s of spans) { s.el.style.opacity = ''; s.el.style.transform = ''; s.el.style.pointerEvents = ''; }
    },
  };
}
