import { useEffect, useRef } from 'react';
import { WebGLRenderer } from 'three';
import type { SceneBridge } from '../scene/bridge';
import type { Quality } from '../scene/RukazScene';
import { SceneRuntime, type FrameStats } from '../scene/runtime';

/** The canvas behind the page. Draws only while something moves; stops when the tab is hidden. */
export function SceneHost({ bridge, quality, reducedMotion, onFailure, onStats }: {
  bridge: SceneBridge; quality: Quality; reducedMotion: boolean; onFailure: () => void; onStats?: (s: FrameStats) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      onFailure();
      return;
    }
    let raf = 0, last = performance.now(), running = false;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (runtime.frame(dt) && !document.hidden) raf = requestAnimationFrame(tick);
      else running = false;
    };
    // ?capture: frames are stepped by hand at a fixed rate (for recording a smooth video)
    const capture = new URLSearchParams(window.location.search).has('capture');
    const requestFrame = () => {
      if (capture || running || document.hidden) return;
      running = true;
      last = performance.now() - 16;
      raf = requestAnimationFrame(tick);
    };
    let runtime: SceneRuntime;
    try {
      runtime = new SceneRuntime(renderer, bridge, { quality, reducedMotion, requestFrame, onStats });
    } catch (err) {
      console.error(err);
      renderer.dispose();
      onFailure();
      return;
    }
    const resize = () => runtime.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    resize();
    window.addEventListener('resize', resize);
    const visible = () => { if (!document.hidden) requestFrame(); };
    document.addEventListener('visibilitychange', visible);
    const lost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); onFailure(); };
    canvas.addEventListener('webglcontextlost', lost);
    if (new URLSearchParams(window.location.search).has('debug')) (window as unknown as { __rukaz: SceneRuntime }).__rukaz = runtime;
    if (capture) (window as unknown as { __rukazStep: (n: number, dt: number) => void }).__rukazStep = (n, dt) => { for (let i = 0; i < n; i++) runtime.frame(dt); };
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visible);
      canvas.removeEventListener('webglcontextlost', lost);
      runtime.dispose();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <canvas ref={canvasRef} className="scene-canvas" aria-hidden="true" />;
}
