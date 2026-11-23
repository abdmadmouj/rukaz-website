import type { ChapterKey } from '../config/soundDesign';
import type { Identity } from '../scene/poses';
import { SoundEngine } from './engine';

/**
 * Sound on the page: off until the visitor turns it on (a user gesture, as browsers
 * require). A plate rings when the pointer reaches it; scrolling and collisions are silent.
 * Fades out and suspends when the tab is hidden.
 */
export class Soundscape {
  private ctx: AudioContext | null = null;
  private engine: SoundEngine | null = null;
  private wanted = false;
  private pan = 0;
  private chapter: ChapterKey = 'hero';
  private onVisibility = () => this.applyVisibility();
  private onPointer = (e: PointerEvent) => {
    this.pan = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
  };

  get enabled() {
    return this.wanted;
  }

  async enable() {
    this.wanted = true;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.engine = new SoundEngine(this.ctx);
      this.engine.setChapter(this.chapter);
      void this.engine.prepare();
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('pointermove', this.onPointer, { passive: true });
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.engine!.fade(1, 1.6);
  }

  disable() {
    this.wanted = false;
    if (!this.ctx || !this.engine) return;
    this.engine.fade(0, 0.8);
    const ctx = this.ctx;
    window.setTimeout(() => {
      if (!this.wanted && ctx.state === 'running') void ctx.suspend();
    }, 900);
  }

  /** the pointer reached a plate; a strum spaces the plates it passed 34 ms apart */
  contact(index: number, strength: number, id: Identity, step = 0) {
    if (!this.wanted || !this.ctx || !this.engine || this.ctx.state !== 'running' || document.hidden) return;
    this.engine.ring(index, id.mat === 'forest' ? 'stone' : 'glass', strength, this.pan, this.ctx.currentTime + 0.01 + step * 0.034);
  }

  setChapter(c: ChapterKey) {
    this.chapter = c;
    this.engine?.setChapter(c);
  }

  private applyVisibility() {
    if (!this.ctx || !this.engine) return;
    if (document.hidden) {
      this.engine.fade(0, 0.25);
      const ctx = this.ctx;
      window.setTimeout(() => { if (document.hidden && ctx.state === 'running') void ctx.suspend(); }, 300);
    } else if (this.wanted) void this.ctx.resume().then(() => this.engine?.fade(1, 0.9));
  }

  dispose() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pointermove', this.onPointer);
    this.engine?.stopAll();
    void this.ctx?.close();
    this.ctx = null;
    this.engine = null;
  }
}
