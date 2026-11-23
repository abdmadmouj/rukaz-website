import type { Direction } from './choreography';
import type { Identity } from './poses';

export type ContactListener = (index: number, strength: number, id: Identity, step: number) => void;

/**
 * The only link between the page and the 3D scene: the page writes the stage (from
 * scroll) and the reading direction; the scene reports plates the pointer reaches (for sound).
 * Keeps React out of the render loop.
 */
export class SceneBridge {
  stage = 0;
  direction: Direction = 'ltr';
  theme: 'dark' | 'light' = 'light';
  /** phones: the sculpture is hidden behind the content sheet, so drawing can pause */
  covered = false;
  /** per stop: where its words begin on screen (fraction from the top), so the form stays above them */
  areas: Record<string, number> = {};
  private listeners = new Set<() => void>();
  private contactListeners = new Set<ContactListener>();

  setStage(s: number) {
    if (Math.abs(s - this.stage) < 1e-5) return;
    this.stage = s;
    this.emit();
  }

  setDirection(d: Direction) {
    if (d === this.direction) return;
    this.direction = d;
    this.emit();
  }

  setCovered(c: boolean) {
    if (c === this.covered) return;
    this.covered = c;
    this.emit();
  }

  setTheme(t: 'dark' | 'light') {
    if (t === this.theme) return;
    this.theme = t;
    this.emit();
  }

  setAreas(a: Record<string, number>) {
    this.areas = a;
    this.emit();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  onContact(fn: ContactListener) {
    this.contactListeners.add(fn);
    return () => void this.contactListeners.delete(fn);
  }

  contact: ContactListener = (i, s, id, step) => this.contactListeners.forEach((fn) => fn(i, s, id, step));

  private emit() {
    this.listeners.forEach((fn) => fn());
  }
}
