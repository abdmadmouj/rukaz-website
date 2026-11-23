import type { WebGLRenderer } from 'three';
import type { SceneBridge } from './bridge';
import { RukazScene, type Quality } from './RukazScene';

export interface FrameStats { ms: number; dpr: number; calls: number; triangles: number }

interface RuntimeOptions {
  quality: Quality;
  reducedMotion: boolean;
  requestFrame: () => void;
  onStats?: (s: FrameStats) => void;
}

/**
 * Drives the scene: input, resize and an adaptive pixel ratio that steps down on slow
 * frames and back up when there is headroom. Frames are drawn only while something moves.
 */
export class SceneRuntime {
  readonly scene: RukazScene;
  private unsubs: (() => void)[] = [];
  private width = 1;
  private height = 1;
  private dpr = 1;
  private maxDpr = 2;
  private slow = 0;
  private fast = 0;
  private touchTimer = 0;

  constructor(private renderer: WebGLRenderer, private bridge: SceneBridge, private opts: RuntimeOptions) {
    this.scene = new RukazScene(renderer, { quality: opts.quality, reducedMotion: opts.reducedMotion, direction: bridge.direction, onContact: bridge.contact });
    this.scene.setAreas(bridge.areas as never);
    this.scene.setTheme(bridge.theme);
    this.scene.snapStage(bridge.stage);
    this.unsubs.push(bridge.subscribe(() => {
      this.scene.setDirection(bridge.direction);
      this.scene.setTheme(bridge.theme);
      this.scene.setAreas(bridge.areas as never);
      this.scene.setStage(bridge.stage);
      opts.requestFrame();
    }));
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      this.scene.setPointer(e.clientX, e.clientY);
      opts.requestFrame();
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      this.scene.setPointer(e.clientX, e.clientY);
      window.clearTimeout(this.touchTimer);
      this.touchTimer = window.setTimeout(() => {
        this.scene.clearPointer();
        opts.requestFrame();
      }, 700);
      opts.requestFrame();
    };
    const leave = () => {
      this.scene.clearPointer();
      opts.requestFrame();
    };
    const out = (e: PointerEvent) => {
      if (!e.relatedTarget) leave();
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', down, { passive: true });
    document.addEventListener('pointerout', out, { passive: true });
    window.addEventListener('blur', leave);
    this.unsubs.push(() => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', down);
      document.removeEventListener('pointerout', out);
      window.removeEventListener('blur', leave);
      window.clearTimeout(this.touchTimer);
    });
  }

  resize(w: number, h: number, deviceDpr: number) {
    this.width = w;
    this.height = h;
    this.maxDpr = Math.min(deviceDpr, this.opts.quality === 'high' ? 2 : 1.5);
    this.dpr = Math.min(this.dpr > 1 ? this.dpr : this.maxDpr, this.maxDpr);
    this.apply();
  }

  private apply() {
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.scene.setViewport(this.width, this.height, this.dpr);
    this.opts.requestFrame();
  }

  frame(dt: number) {
    const t0 = performance.now();
    const moving = this.scene.update(dt);
    // covered by the content sheet (phones): keep the physics going, skip the drawing
    if (this.bridge.covered) return moving;
    this.scene.render();
    const ms = performance.now() - t0;
    this.adapt(dt);
    const info = this.renderer.info.render;
    this.opts.onStats?.({ ms, dpr: this.dpr, calls: info.calls, triangles: info.triangles });
    return moving;
  }

  private adapt(dt: number) {
    if (dt <= 0 || dt > 0.25) return;
    if (dt > 1 / 40) { this.slow++; this.fast = 0; }
    else if (dt < 1 / 58) { this.fast++; this.slow = Math.max(0, this.slow - 1); }
    if (this.slow > 45 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.slow = 0;
      this.apply();
    } else if (this.fast > 240 && this.dpr < this.maxDpr) {
      this.dpr = Math.min(this.maxDpr, this.dpr + 0.25);
      this.fast = 0;
      this.apply();
    }
  }

  dispose() {
    this.unsubs.forEach((u) => u());
    this.scene.dispose();
  }
}
