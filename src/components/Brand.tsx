import { brand } from '../config/brand';
import { MARK_LEFT, MARK_OUTLINE, MARK_RIGHT_TRANSFORM, MARK_VIEWBOX } from '../brand/mark';

export function Mark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox={MARK_VIEWBOX} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title} focusable="false">
      <path d={MARK_LEFT} fill="currentColor" />
      <path d={MARK_LEFT} fill="currentColor" transform={MARK_RIGHT_TRANSFORM} />
    </svg>
  );
}

export function Lockup({ lang }: { lang: 'en' | 'ar' }) {
  return (
    <span className="lockup">
      <Mark className="lockup__mark" />
      {lang === 'ar' ? (
        <span className="lockup__name lockup__name--ar">{brand.wordmarkAr}</span>
      ) : (
        <span className="lockup__text">
          <span className="lockup__name">{brand.wordmark}</span>
          <span className="lockup__descriptor">{brand.descriptor}</span>
        </span>
      )}
    </span>
  );
}

const RINGS = [{ s: 1.22, o: 0.7, accent: true }, { s: 1.22 ** 2, o: 0.32 }, { s: 1.22 ** 3, o: 0.22 }, { s: 1.22 ** 4, o: 0.14 }, { s: 1.22 ** 5, o: 0.08 }];

/** the brand's Contours graphic: the mark with its outline echoed outward */
export function Contours({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-150 -350 1300 1700" aria-hidden="true" focusable="false">
      {RINGS.map((r) => (
        <path key={r.s} d={MARK_OUTLINE} fill="none" stroke={r.accent ? 'var(--emerald-glass)' : 'var(--ivory)'} strokeOpacity={r.o} strokeWidth="1.25" vectorEffect="non-scaling-stroke" transform={`translate(500 500) scale(${r.s}) translate(-500 -500)`} />
      ))}
      <path d={MARK_LEFT} fill="var(--ivory)" />
      <path d={MARK_LEFT} fill="var(--ivory)" transform={MARK_RIGHT_TRANSFORM} />
    </svg>
  );
}

export function Arrow() {
  return (
    <svg className="arrow" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
