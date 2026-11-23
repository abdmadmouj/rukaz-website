import type { Quality } from './RukazScene';

/** high: transmission and reflections; low: phones and small machines. ?quality=low|high overrides. */
export function detectQuality(): Quality {
  if (typeof window === 'undefined') return 'low';
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced === 'low' || forced === 'high') return forced;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return !coarse && cores >= 6 && memory >= 4 ? 'high' : 'low';
}

export function supportsWebGL2() {
  if (typeof document === 'undefined') return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ok = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}
