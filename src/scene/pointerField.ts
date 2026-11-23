import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { artDirection as AD } from '../config/artDirection';
import { P, STRIDE } from './poses';

/**
 * The pointer. Each plate is projected to a screen-space segment; plates near the pointer
 * rise a little, lean away and glow faintly, each on its own damped spring so the crest
 * follows the hand with weight. Every plate leans the way the hand is moving, so a sweep
 * reads as one wave. On the ribbon (hero and close) the crest fans plates up.
 * Visual only: it never moves a plate into a neighbour's slot.
 */
export class PointerField {
  readonly value: Float32Array;
  private vel: Float32Array;
  private side: Float32Array;
  pointer = { x: 0, y: 0, active: false };
  /** 0: lean sideways (ribbon); 1: lift straight up (round forms) */
  radial = 0;
  /** 0..1 how much the fan crest applies */
  fan = 0;
  enabled = true;
  private fwd = new Vector3();
  private up = new Vector3(0, 1, 0);
  private c = new Vector3();
  private a = new Vector3();
  private b = new Vector3();
  private w = new Vector3();
  private ax = new Vector3();
  private ay = new Vector3();
  private az = new Vector3();
  private q = new Quaternion();
  private qa = new Quaternion();
  private right = new Vector3(1, 0, 0);
  private leanAxis = new Vector3();
  /** the sweep: -1 when the hand moves left, +1 right; every plate leans the same way */
  private dir = 0;
  private lastX = NaN;

  constructor(readonly count: number) {
    this.value = new Float32Array(count);
    this.vel = new Float32Array(count);
    this.side = new Float32Array(count);
  }

  private project(v: Vector3, cam: PerspectiveCamera, w: number, h: number) {
    v.project(cam);
    return v.set((v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h, v.z);
  }

  private nearest = -1;
  /** plate order along the row (hero and close), so a sweep can strum the plates in between */
  strum = false;

  /** advance the springs; returns true while anything is still moving. `onTouch` hears each
   *  plate the pointer reaches (index, strength 0..1, position in a strum) */
  update(poses: Float32Array, cam: PerspectiveCamera, w: number, h: number, dt: number, onTouch?: (i: number, strength: number, step: number) => void) {
    let best = 0, bestI = -1;
    const C = AD.pointer;
    const reach = (C.radius + (C.fan.radius - C.radius) * this.fan) * h;
    cam.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    this.fwd.normalize();
    this.right.crossVectors(this.fwd, this.up).normalize();
    const { x: px, y: py } = this.pointer;
    if (this.pointer.active && Number.isFinite(this.lastX)) {
      const dx = px - this.lastX;
      // follow the hand's direction; a turn eases over a few frames, a still hand keeps it
      if (Math.abs(dx) > 0.5) this.dir += (Math.sign(dx) - this.dir) * Math.min(1, dt * 7);
    }
    this.lastX = this.pointer.active ? px : NaN;
    const live = this.pointer.active && this.enabled;
    let moving = false;
    for (let i = 0; i < this.count; i++) {
      let target = 0;
      if (live) {
        const o = i * STRIDE;
        this.q.set(poses[o + P.qx], poses[o + P.qy], poses[o + P.qz], poses[o + P.qw]);
        const hx = poses[o + P.hx], hy = poses[o + P.hy], hz = poses[o + P.hz];
        const long = hz >= hy;
        // the plate's long axis becomes a screen segment
        this.az.set(long ? 0 : 0, long ? 0 : 1, long ? 1 : 0).applyQuaternion(this.q).multiplyScalar(long ? hz : hy);
        this.ay.set(0, long ? 1 : 0, long ? 0 : 1).applyQuaternion(this.q).multiplyScalar(long ? hy : hz);
        this.c.set(poses[o], poses[o + 1], poses[o + 2]);
        this.a.copy(this.c).add(this.az);
        this.b.copy(this.c).sub(this.az);
        this.w.copy(this.c).add(this.ay);
        this.project(this.a, cam, w, h);
        this.project(this.b, cam, w, h);
        this.project(this.w, cam, w, h);
        this.ax.set(1, 0, 0).applyQuaternion(this.q).multiplyScalar(hx + 0.25).add(this.c);
        this.project(this.c, cam, w, h);
        this.project(this.ax, cam, w, h);
        if (this.c.z < 1) {
          const sx = this.b.x - this.a.x, sy = this.b.y - this.a.y;
          const len2 = sx * sx + sy * sy || 1;
          let t = ((px - this.a.x) * sx + (py - this.a.y) * sy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = px - (this.a.x + sx * t), ey = py - (this.a.y + sy * t);
          const width = Math.hypot(this.w.x - this.c.x, this.w.y - this.c.y);
          const d = Math.max(0, Math.hypot(ex, ey) - width * 0.85);
          target = Math.exp(-(d * d) / (reach * reach));
          const nx = this.ax.x - this.c.x, ny = this.ax.y - this.c.y;
          const nl = Math.hypot(nx, ny) || 1;
          const s = ((px - this.c.x) * nx + (py - this.c.y) * ny) / (nl * reach);
          this.side[i] = -(s < -1 ? -1 : s > 1 ? 1 : s);
        }
      }
      const k = C.stiffness;
      const steps = dt > 1 / 45 ? 2 : 1;
      const h1 = Math.min(dt, 1 / 20) / steps;
      for (let s = 0; s < steps; s++) {
        const acc = k * k * (target - this.value[i]) - 2 * k * this.vel[i];
        this.vel[i] += acc * h1;
        this.value[i] += this.vel[i] * h1;
      }
      if (Math.abs(this.vel[i]) > 1e-4 || Math.abs(target - this.value[i]) > 1e-4) moving = true;
      else this.value[i] = target;
      if (target > best) { best = target; bestI = i; }
    }
    // sound: a plate rings when the pointer reaches it; a quick sweep along the row rings
    // every plate passed over, in order
    if (bestI >= 0 && best > C.touchThreshold) {
      if (bestI !== this.nearest) {
        const prev = this.nearest;
        const span = prev >= 0 ? bestI - prev : 0;
        if (this.strum && prev >= 0 && Math.abs(span) > 1 && Math.abs(span) <= C.strumMax) {
          const dir = Math.sign(span);
          for (let k = prev + dir, step = 1; k !== bestI; k += dir, step++) onTouch?.(k, best * 0.8, step);
          onTouch?.(bestI, best, Math.abs(span));
        } else onTouch?.(bestI, best, 0);
        this.nearest = bestI;
      }
    } else if (best < C.touchThreshold * 0.5) this.nearest = -1;
    return moving;
  }

  /** bend the poses by the current field */
  apply(poses: Float32Array) {
    const C = AD.pointer, F = C.fan, r = this.radial, fan = this.fan, DEG = Math.PI / 180;
    for (let i = 0; i < this.count; i++) {
      const v = this.value[i];
      if (v < 1e-4) continue;
      const o = i * STRIDE;
      this.q.set(poses[o + P.qx], poses[o + P.qy], poses[o + P.qz], poses[o + P.qw]);
      this.ax.set(1, 0, 0).applyQuaternion(this.q);
      const keep = 1 - fan * 0.85;
      // one movement: every plate leans toward where the hand is going (screen space), so a
      // sweep reads as a single wave instead of plates splitting either side of the pointer
      const d = this.dir * (1 - r);
      const tall = 0.65 + 0.35 * Math.min(1, poses[o + P.hy] * 1.6);
      const lift = C.lift * v * tall * (1 - r * 0.7) * keep;
      const push = C.push * v * keep;
      poses[o] += this.right.x * push * d + this.ax.x * push * r * 1.6;
      poses[o + 1] += lift + this.ax.y * push * r * 1.6;
      poses[o + 2] += this.right.z * push * d + this.ax.z * push * r * 1.6;
      // the tilt axis is world up × the sweep direction: the plate's top moves with the hand
      this.leanAxis.crossVectors(this.up, this.right);
      const g = fan > 1e-3 ? fan * Math.min(1, Math.max(0.45, 1.35 - poses[o + P.hx] * 1.7)) * v * v * (3 - 2 * v) : 0;
      const angle = (C.tilt * v * keep + F.lean * g) * DEG * d;
      if (Math.abs(angle) > 1e-5) {
        this.qa.setFromAxisAngle(this.leanAxis, angle);
        this.q.premultiply(this.qa);
      }
      if (g > 0) {
        poses[o + 1] += F.lift * g;
        poses[o + P.hy] *= 1 + F.grow * g;
        poses[o + P.hz] *= 1 + F.grow * g * 0.6;
      }
      poses[o + P.qx] = this.q.x;
      poses[o + P.qy] = this.q.y;
      poses[o + P.qz] = this.q.z;
      poses[o + P.qw] = this.q.w;
    }
  }

  reset() {
    this.nearest = -1;
    this.value.fill(0);
    this.vel.fill(0);
    this.lastX = NaN;
  }
}
