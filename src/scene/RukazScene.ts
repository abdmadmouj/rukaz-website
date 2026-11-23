import {
  ACESFilmicToneMapping, Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene, SRGBColorSpace, Vector3,
  type Texture, type WebGLRenderer,
} from 'three';
import { artDirection as AD, type Breakpoint, type CameraSpec } from '../config/artDirection';
import { blend, breakpointFor, buildStops, clamp01, composedCamera, fitCamera, smootherstep, stopPoses, STOPS, swapHelps, swapSlots, type Direction, type Stop, type StopName } from './choreography';
import { studioEnvironment } from './environment';
import { Floor } from './floor';
import { PlateWorld } from './physics/plateWorld';
import { Plates, type SharedUniforms } from './plateMaterials';
import { PointerField } from './pointerField';
import { poseBuffer, STRIDE, type Identity } from './poses';

export type Quality = 'high' | 'low';

export interface SceneOptions {
  quality?: Quality;
  reducedMotion?: boolean;
  parallax?: boolean;
  direction?: Direction;
  /** the pointer reached a plate (for sound): index, strength 0..1, plate, position in a strum */
  onContact?: (index: number, strength: number, id: Identity, step: number) => void;
}

/** how the hover crest behaves on each form: 0 leans plates aside, 1 lifts them straight up */
const RADIAL: Record<StopName, number> = { hero: 0, who: 1, ways: 0.6, discover: 0, validate: 0, build: 0, scale: 0, proof: 0.4, terms: 0.3, contact: 0.3, connect: 0 };
const FAN: Partial<Record<StopName, number>> = { hero: 1, connect: 1 };

/**
 * The sculpture. Scroll sets a stage value; each frame the choreography gives every plate
 * a place, the physics moves the plates there as solid bodies (they touch and push aside,
 * never merge), and the pointer adds its crest on top.
 */
export class RukazScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 16 / 9, 0.1, 500);
  private shared: SharedUniforms = { uKeyDirView: { value: new Vector3() }, uHoverGlow: { value: 0.07 } };
  private keyDir = new Vector3(...AD.lighting.keyDirection).normalize();
  private stops: Stop[] = [];
  private cameras: CameraSpec[] = [];
  private identities: Identity[];
  private count: number;
  private width = 1;
  private height = 1;
  private bp: Breakpoint = 'wide';
  private dir: Direction;
  private stage = 0;
  private stageTarget = 0;
  private time = 0;
  private parallax = { x: 0, y: 0 };
  private parallaxTarget = { x: 0, y: 0 };
  private dirty = true;
  private reducedMotion: boolean;
  private useParallax: boolean;
  private bufA: Float32Array;
  private bufB: Float32Array;
  private base: Float32Array;
  private out: Float32Array;
  private env: Texture;
  private plates: Plates;
  private floor: Floor;
  private field: PointerField;
  private world: PlateWorld;
  private onContact?: SceneOptions['onContact'];

  constructor(private renderer: WebGLRenderer, opts: SceneOptions = {}) {
    this.reducedMotion = !!opts.reducedMotion;
    this.useParallax = opts.parallax !== false && !this.reducedMotion;
    this.dir = opts.direction ?? 'ltr';
    this.onContact = opts.onContact;
    const quality = opts.quality ?? 'high';
    const Lg = AD.lighting;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = Lg.exposure;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(new Color(AD.floor.backdropTop), 1);
    this.env = studioEnvironment(renderer);
    this.scene.environment = this.env;
    this.scene.environmentIntensity = Lg.environmentIntensity;
    this.scene.fog = new Fog(new Color(AD.floor.backdropHorizon), AD.floor.fadeStart + 6, AD.floor.fadeEnd + 30);
    const key = new DirectionalLight(new Color(Lg.keyColor), Lg.keyIntensity);
    key.position.copy(this.keyDir).multiplyScalar(30);
    const fill = new DirectionalLight(new Color(Lg.fillColor), Lg.fillIntensity);
    fill.position.set(-20, 8, 18);
    const under = new DirectionalLight(new Color(Lg.underColor), Lg.underIntensity);
    under.position.set(2, -6, 14);
    this.scene.add(key, key.target, fill, under, new HemisphereLight(new Color(Lg.hemiSky), new Color(Lg.hemiGround), Lg.hemiIntensity));

    const built = buildStops(this.bp, this.dir);
    this.stops = built.stops;
    this.identities = built.identities;
    this.count = built.count;
    this.bufA = poseBuffer(this.count);
    this.bufB = poseBuffer(this.count);
    this.base = poseBuffer(this.count);
    this.out = poseBuffer(this.count);
    this.plates = new Plates(this.identities, this.shared, quality === 'high');
    for (const g of this.plates.groups) this.scene.add(g.mesh);
    this.floor = new Floor();
    this.floor.reflections = quality === 'high';
    this.scene.add(this.floor.backdrop, this.floor.mesh);
    this.field = new PointerField(this.count);
    this.field.enabled = !this.reducedMotion;
    this.world = new PlateWorld(this.count, { ...AD.physics, maxSpeed: 20 });
    this.identities.forEach((id) => this.world.setMass(id.index, AD.mass[id.mat]));
    this.placeAll(this.stops[0].poses);
    this.refreshCameras();
  }

  get plateCount() {
    return this.count;
  }

  get currentStop(): StopName {
    return STOPS[Math.round(this.stage)] ?? 'hero';
  }

  /** put every plate exactly at these poses, at rest */
  private placeAll(poses: Float32Array) {
    for (let i = 0; i < this.count; i++) {
      const o = i * STRIDE;
      this.world.place(i, [poses[o], poses[o + 1], poses[o + 2]], [poses[o + 3], poses[o + 4], poses[o + 5], poses[o + 6]], [poses[o + 7], poses[o + 8], poses[o + 9]]);
    }
  }

  private areaBottom: Partial<Record<StopName, number>> = {};

  /** where each section's words begin (viewport fraction from the top) */
  setAreas(areas: Partial<Record<StopName, number>>) {
    const same = Object.keys(areas).length === Object.keys(this.areaBottom).length && Object.entries(areas).every(([k, v]) => Math.abs((this.areaBottom[k as StopName] ?? -1) - (v ?? 0)) < 0.004);
    if (same) return;
    this.areaBottom = { ...areas };
    this.refreshCameras();
    this.dirty = true;
  }

  private refreshCameras() {
    this.cameras = this.stops.map((s) =>
      s.name === 'hero' || s.name === 'connect' ? composedCamera(s.name, this.bp, this.dir, this.width, this.height) : fitCamera(s.frame!, this.bp, this.dir, this.width, this.height, this.areaBottom[s.name]),
    );
  }

  setViewport(w: number, h: number, dpr: number) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.camera.aspect = this.width / this.height;
    const bp = breakpointFor(this.width, this.height);
    if (bp !== this.bp) {
      this.bp = bp;
      this.rebuild();
    } else this.refreshCameras();
    this.floor.setReflectionSize(Math.round(this.width * dpr * 0.5), Math.round(this.height * dpr * 0.5));
    this.dirty = true;
  }

  private theme: 'dark' | 'light' = 'dark';
  /** light or dark studio: background, fog, floor and exposure (the plates keep their colours) */
  setTheme(theme: 'dark' | 'light') {
    if (theme === this.theme) return;
    this.theme = theme;
    const T = AD.themes[theme];
    this.renderer.setClearColor(new Color(T.backdropTop), 1);
    (this.scene.fog as Fog).color.set(T.backdropHorizon);
    this.renderer.toneMappingExposure = AD.lighting.exposure * T.exposure;
    this.floor.setPalette(T);
    this.dirty = true;
  }

  setDirection(dir: Direction) {
    if (dir === this.dir) return;
    this.dir = dir;
    this.rebuild();
  }

  private rebuild() {
    this.stops = buildStops(this.bp, this.dir).stops;
    this.refreshCameras();
    this.dirty = true;
  }

  setStage(s: number) {
    const v = Math.min(this.stops.length - 1, Math.max(0, s));
    this.stageTarget = this.reducedMotion ? Math.round(v) : v;
    this.dirty = true;
  }

  /** jump without animation (first load, reduced motion) */
  snapStage(s: number) {
    this.setStage(s);
    this.stage = this.stageTarget;
    this.compose(0, true);
    this.placeAll(this.base);
  }

  private lastPointerMove = -Infinity;

  setPointer(x: number, y: number) {
    this.lastPointerMove = performance.now();
    this.field.pointer.x = x;
    this.field.pointer.y = y;
    this.field.pointer.active = true;
    if (this.useParallax) {
      this.parallaxTarget.x = (x / this.width) * 2 - 1;
      this.parallaxTarget.y = (y / this.height) * 2 - 1;
    }
    this.dirty = true;
  }

  clearPointer() {
    this.field.pointer.active = false;
    this.parallaxTarget.x = 0;
    this.parallaxTarget.y = 0;
    this.dirty = true;
  }

  /** choreographed poses for the current stage into this.base, and the camera */
  private compose(dt: number, still: boolean) {
    const last = this.stops.length - 1;
    const s = Math.min(last, Math.max(0, this.stage));
    const i0 = Math.floor(s), i1 = Math.min(i0 + 1, last), f = s - i0;
    const a = this.stops[i0], b = this.stops[i1];
    stopPoses(a, this.time, this.count, this.bufA, still);
    stopPoses(b, this.time, this.count, this.bufB, still);
    blend(this.bufA, this.bufB, f, this.identities, this.base, b.arrival, b.approach);
    this.placeCamera(this.cameras[i0], this.cameras[i1], f, i0, i1);
    this.field.radial = RADIAL[a.name] * (1 - f) + RADIAL[b.name] * f;
    this.field.fan = (FAN[a.name] ?? 0) * (1 - f) + (FAN[b.name] ?? 0) * f;
    void dt;
    return (a.motion && f < 0.999) || (b.motion && f > 0.001);
  }

  private effectiveFov(cam: CameraSpec, index: number) {
    const name = this.stops[index].name;
    if (name !== 'hero' && name !== 'connect') return cam.fov; // fitted to this exact viewport already
    // composed shots keep their horizontal coverage on narrower screens
    const aspect = this.width / Math.max(this.height, 1);
    const design = AD.designAspect[this.bp];
    if (aspect >= design) return cam.fov;
    const h = 2 * Math.atan(Math.tan((cam.fov * Math.PI) / 360) * design);
    return (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI;
  }

  private pos = new Vector3();
  private tgt = new Vector3();
  private placeCamera(c0: CameraSpec, c1: CameraSpec, f: number, i0: number, i1: number) {
    const k = smootherstep(clamp01(f));
    this.pos.set(c0.pos[0] + (c1.pos[0] - c0.pos[0]) * k, c0.pos[1] + (c1.pos[1] - c0.pos[1]) * k, c0.pos[2] + (c1.pos[2] - c0.pos[2]) * k);
    this.tgt.set(c0.target[0] + (c1.target[0] - c0.target[0]) * k, c0.target[1] + (c1.target[1] - c0.target[1]) * k, c0.target[2] + (c1.target[2] - c0.target[2]) * k);
    this.pos.x += this.parallax.x * 0.35;
    this.pos.y += this.parallax.y * 0.2;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.tgt);
    const fov = this.effectiveFov(c0, i0) + (this.effectiveFov(c1, i1) - this.effectiveFov(c0, i0)) * k;
    this.camera.fov = Math.min(fov, 75);
    const sx = c0.shift[0] + (c1.shift[0] - c0.shift[0]) * k;
    const sy = c0.shift[1] + (c1.shift[1] - c0.shift[1]) * k;
    this.camera.setViewOffset(this.width, this.height, -sx * this.width, -sy * this.height, this.width, this.height);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** run physics toward this.base; result into this.out */
  private simulate(dt: number) {
    const w = this.world, b = this.base;
    for (let i = 0; i < this.count; i++) {
      const o = i * STRIDE;
      w.setTarget(i, [b[o], b[o + 1], b[o + 2]], [b[o + 3], b[o + 4], b[o + 5], b[o + 6]], [b[o + 7], b[o + 8], b[o + 9]]);
    }
    const contacts = w.step(dt * AD.physicsSpeed);
    // a jammed plate and the plate in its way trade slots when that shortens both journeys,
    // instead of either pushing through
    const target = this.stops[Math.round(this.stageTarget)];
    for (const [a, c] of w.takeJams()) {
      if (Math.abs(this.stage - this.stageTarget) > 0.02 || !target || !swapHelps(target, a, c, w.pos)) continue;
      swapSlots(target, a, c);
      w.unstick(a);
      w.unstick(c);
    }
    void contacts; // collisions are silent: sound answers the pointer only
    this.out.set(b);
    for (let i = 0; i < this.count; i++) {
      const o = i * STRIDE;
      this.out[o] = w.pos[i * 3];
      this.out[o + 1] = w.pos[i * 3 + 1];
      this.out[o + 2] = w.pos[i * 3 + 2];
      this.out[o + 3] = w.quat[i * 4];
      this.out[o + 4] = w.quat[i * 4 + 1];
      this.out[o + 5] = w.quat[i * 4 + 2];
      this.out[o + 6] = w.quat[i * 4 + 3];
      // drawn at the size the physics uses, so what you see is exactly what collides
      this.out[o + 7] = w.half[i * 3];
      this.out[o + 8] = w.half[i * 3 + 1];
      this.out[o + 9] = w.half[i * 3 + 2];
    }
  }

  /** advance one frame; returns true while anything is still moving (keep drawing) */
  update(dtIn: number) {
    const dt = Math.min(Math.max(dtIn, 0), 0.1);
    this.time += dt;
    let active = this.dirty;
    this.dirty = false;
    const diff = this.stageTarget - this.stage;
    if (Math.abs(diff) > 1e-4) {
      this.stage += this.reducedMotion ? diff : diff * (1 - Math.exp(-dt / AD.choreography.stageSmoothing));
      active = true;
    } else this.stage = this.stageTarget;
    const ease = 1 - Math.exp(-dt / 0.6);
    const px = this.parallaxTarget.x - this.parallax.x, py = this.parallaxTarget.y - this.parallax.y;
    if (Math.abs(px) + Math.abs(py) > 1e-4) {
      this.parallax.x += px * ease;
      this.parallax.y += py * ease;
      active = true;
    }
    const turning = this.compose(dt, this.reducedMotion);
    if (turning && !this.reducedMotion) active = true;
    if (this.reducedMotion) this.out.set(this.base);
    else {
      this.simulate(dt);
      if (!this.world.sleeping) active = true;
    }
    // strum along the row only on the hero (there plate order is order along the row)
    this.field.strum = this.field.fan > 0.5 && this.stage < 0.5;
    // ring only when the hand moves: the page scrolling under a still pointer is silent
    const handMoving = performance.now() - this.lastPointerMove < 180;
    const hovering = this.field.update(this.out, this.camera, this.width, this.height, dt, (i, strength, step) => {
      if (handMoving) this.onContact?.(i, strength, this.identities[i], step);
    });
    active = active || hovering;
    this.field.apply(this.out);
    this.plates.upload(this.out, this.field.value);
    if (active) this.floor.updatePlates(this.out, this.count, this.plates.translucency);
    this.shared.uKeyDirView.value.copy(this.keyDir).transformDirection(this.camera.matrixWorldInverse);
    return active;
  }

  render() {
    const r = this.renderer;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = AD.lighting.exposure;
    r.outputColorSpace = SRGBColorSpace;
    this.floor.prepare(r, this.scene, this.camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }

  dispose() {
    this.plates.dispose();
    this.floor.dispose();
    this.env.dispose();
    this.scene.clear();
  }
}
