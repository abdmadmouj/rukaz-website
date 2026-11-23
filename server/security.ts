/**
 * Security policy for every response. No third-party requests are needed: fonts, images,
 * scripts and sound are all served from this origin or synthesised in the browser.
 */
export function securityHeaders(production: boolean): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    // GSAP and React set element style attributes (transforms, opacity); no style blocks
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    ...(production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    ...(production ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload' } : {}),
  };
}

/** Fixed-window limiter per key. In memory: fine for one server; swap `store` for a shared one when scaling out. */
export interface RateStore { hit(key: string, windowMs: number): number }
export class MemoryRateStore implements RateStore {
  private map = new Map<string, { count: number; reset: number }>();
  hit(key: string, windowMs: number) {
    const now = Date.now();
    if (this.map.size > 50_000) for (const [k, v] of this.map) if (v.reset < now) this.map.delete(k);
    const e = this.map.get(key);
    if (!e || e.reset < now) {
      this.map.set(key, { count: 1, reset: now + windowMs });
      return 1;
    }
    e.count++;
    return e.count;
  }
}

/** escape text for an HTML email body */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** a header-safe single line (no CR/LF, so nothing can be injected into mail headers) */
export const oneLine = (s: string, max = 200) => s.replace(/[\r\n\t]+/g, ' ').replace(/[^\P{C}]/gu, '').slice(0, max);
