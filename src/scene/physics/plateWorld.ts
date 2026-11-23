/**
 * Plate physics: every plate is a solid glass slab with weight.
 *
 * Plates are pulled toward a target pose by critically damped springs (position and
 * orientation) and are kept apart by box-vs-box contact, so two plates touch and push
 * each other aside but never pass through one another. Settled plates sleep, so a
 * still scene costs nothing and the renderer can stop drawing.
 *
 * Dependency-free on purpose: plain arrays, so it runs in a worker, in tests and in the
 * render loop alike. One step costs O(n) with a spatial hash (93 plates: well under 1 ms).
 *
 *   world.setTarget(i, pos, quat, half)   where plate i should be, and its size
 *   world.poke(point, dir, radius, power) the pointer pushing plates (hover crest)
 *   world.step(dt)                        advance; returns new contacts (for sound)
 *   world.pos / world.quat                current state, for instance matrices
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface PhysicsOptions {
  /** spring stiffness toward the target position (1/s^2) */
  stiffness: number;
  /** spring stiffness toward the target orientation (1/s^2) */
  angularStiffness: number;
  /** 1 = critically damped (no overshoot); below 1 lets plates sway a touch */
  dampingRatio: number;
  /** fraction of approach speed kept after a contact (0 = dead stop, glass ~0.1) */
  restitution: number;
  /** tangential speed removed per contact (0..1) */
  friction: number;
  /** gap kept between surfaces (m), so resting neighbours never z-fight */
  skin: number;
  /** solver passes per substep */
  iterations: number;
  /** fixed substep (s) */
  substep: number;
  /** linear and angular speed under which a plate near its target may sleep */
  sleepSpeed: number;
  /** seconds a plate must stay slow before sleeping */
  sleepAfter: number;
  /** relative normal speed (m/s) above which a new touch is reported as a contact */
  contactSpeed: number;
  /** largest push apart per solver pass (m) */
  maxCorrection: number;
  /** speed limit (m/s): a safety net, never reached in normal motion */
  maxSpeed: number;
  /** how much a glancing contact turns the plates (0 = none) */
  contactSpin: number;
  /** sideways acceleration (m/s^2) that lets two head-on plates slip past each other */
  sidestep: number;
  /** seconds without progress before a blocked plate is lifted over the others */
  stuckAfter: number;
  /** how fast (m/s) and how high (m) a blocked plate may be lifted */
  liftRate: number;
  maxLift: number;
  /** most a plate may move between two contact checks (m); finer steps are taken when needed */
  maxTravel: number;
  /** distance (m) from its slot within which a plate counts as seated */
  dockRadius: number;
  /** seconds a plate may stay blocked before it stops pushing (off by default: shrinking handles jams) */
  ghostAfter: number;
  /** seconds a plate may stay blocked before it shrinks to slip through, and to what share of its size */
  shrinkAfter: number;
  shrinkTo: number;
}

export const defaultPhysics: PhysicsOptions = {
  stiffness: 42,
  angularStiffness: 36,
  dampingRatio: 0.92,
  restitution: 0.08,
  friction: 0.35,
  skin: 0.004,
  iterations: 6,
  substep: 1 / 120,
  sleepSpeed: 0.012,
  sleepAfter: 0.45,
  contactSpeed: 0.22,
  maxCorrection: 0.05,
  maxSpeed: 6,
  contactSpin: 0.15,
  sidestep: 14,
  maxTravel: 0.025,
  dockRadius: 0.04,
  ghostAfter: Infinity,
  shrinkAfter: 1.2,
  shrinkTo: 0.12,
  stuckAfter: 0.35,
  liftRate: 2.5,
  maxLift: 0,
};

export interface Contact {
  a: number;
  b: number;
  /** closing speed along the contact normal, m/s */
  speed: number;
  /** contact point (world) */
  at: Vec3;
}

// ---------------------------------------------------------------- small vector helpers
const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qnorm = (q: Quat): Quat => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
/** rotate v by unit quaternion q */
function rot(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** the three local axes of an oriented box */
function axes(q: Quat): [Vec3, Vec3, Vec3] {
  return [rot(q, [1, 0, 0]), rot(q, [0, 1, 0]), rot(q, [0, 0, 1])];
}

/**
 * Separating-axis test between two oriented boxes. Returns the axis of least penetration
 * (pointing from a to b) and the depth, or null when they are apart by more than `skin`.
 */
export function boxContact(pa: Vec3, qa: Quat, ha: Vec3, pb: Vec3, qb: Quat, hb: Vec3, skin = 0): { n: Vec3; depth: number } | null {
  const A = axes(qa);
  const B = axes(qb);
  const d: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
  let best = Infinity;
  let bestN: Vec3 = [0, 1, 0];
  const test = (ax: Vec3) => {
    const len = Math.hypot(ax[0], ax[1], ax[2]);
    if (len < 1e-3) return true; // near-parallel edges: no reliable axis
    const n: Vec3 = [ax[0] / len, ax[1] / len, ax[2] / len];
    const ra = ha[0] * Math.abs(dot(A[0], n)) + ha[1] * Math.abs(dot(A[1], n)) + ha[2] * Math.abs(dot(A[2], n));
    const rb = hb[0] * Math.abs(dot(B[0], n)) + hb[1] * Math.abs(dot(B[1], n)) + hb[2] * Math.abs(dot(B[2], n));
    const dist = dot(d, n);
    const overlap = ra + rb + skin - Math.abs(dist);
    if (overlap <= 0) return false;
    // prefer face axes slightly: edge axes give jittery normals at rest
    const score = overlap * (len === 1 ? 1 : 1.04);
    if (score < best) {
      best = score;
      bestN = dist < 0 ? [-n[0], -n[1], -n[2]] : n;
    }
    return true;
  };
  for (const ax of A) if (!test(ax)) return null;
  for (const ax of B) if (!test(ax)) return null;
  for (const a of A) for (const b of B) if (!test(cross(a, b))) return null;
  // recompute the true depth on the chosen axis (score carried the bias)
  const n = bestN;
  const ra = ha[0] * Math.abs(dot(A[0], n)) + ha[1] * Math.abs(dot(A[1], n)) + ha[2] * Math.abs(dot(A[2], n));
  const rb = hb[0] * Math.abs(dot(B[0], n)) + hb[1] * Math.abs(dot(B[1], n)) + hb[2] * Math.abs(dot(B[2], n));
  return { n, depth: ra + rb + skin - Math.abs(dot(d, n)) };
}

// ---------------------------------------------------------------- the world
export class PlateWorld {
  readonly n: number;
  readonly pos: Float32Array;
  readonly quat: Float32Array;
  readonly vel: Float32Array;
  readonly ang: Float32Array;
  readonly half: Float32Array;
  readonly targetPos: Float32Array;
  readonly targetQuat: Float32Array;
  /** 1 / mass; dark stone plates are heavier (smaller invMass) */
  readonly invMass: Float32Array;
  readonly asleep: Uint8Array;
  private readonly slowFor: Float32Array;
  /** temporary lift (m) for a plate blocked by others: it rises over them instead of fusing */
  readonly lift: Float32Array;
  private readonly best: Float32Array;
  private readonly stuckFor: Float32Array;
  private readonly touching = new Set<number>();
  private readonly grid = new Map<number, number[]>();
  private cells = new Int32Array(0);
  private acc = 0;
  private readonly o: PhysicsOptions;

  constructor(n: number, opts: Partial<PhysicsOptions> = {}) {
    this.n = n;
    this.o = { ...defaultPhysics, ...opts };
    this.pos = new Float32Array(n * 3);
    this.quat = new Float32Array(n * 4);
    this.vel = new Float32Array(n * 3);
    this.ang = new Float32Array(n * 3);
    this.half = new Float32Array(n * 3).fill(0.1);
    this.targetPos = new Float32Array(n * 3);
    this.targetQuat = new Float32Array(n * 4);
    this.invMass = new Float32Array(n).fill(1);
    this.asleep = new Uint8Array(n);
    this.slowFor = new Float32Array(n);
    this.lift = new Float32Array(n);
    this.best = new Float32Array(n).fill(Infinity);
    this.stuckFor = new Float32Array(n);
    this.cells = new Int32Array(n * 3);
    this.pressed = new Uint8Array(n);
    this.shard = new Uint8Array(n);
    this.pressedNext = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.quat[i * 4 + 3] = 1;
      this.targetQuat[i * 4 + 3] = 1;
    }
  }

  /** Place plate i exactly (no motion), e.g. at start-up or when motion is reduced. */
  place(i: number, p: Vec3, q: Quat, half: Vec3) {
    this.pos.set(p, i * 3);
    this.quat.set(qnorm(q), i * 4);
    this.targetPos.set(p, i * 3);
    this.targetQuat.set(qnorm(q), i * 4);
    this.half.set(half, i * 3);
    this.vel.fill(0, i * 3, i * 3 + 3);
    this.ang.fill(0, i * 3, i * 3 + 3);
    this.asleep[i] = 1;
  }

  /** Where plate i should go, and its size. Smaller sizes apply at once; larger ones only
   *  as the plate nears its slot, so two plates never swell into one space. */
  setTarget(i: number, p: Vec3, q: Quat, half?: Vec3) {
    const o = i * 3;
    const moved = Math.abs(this.targetPos[o] - p[0]) + Math.abs(this.targetPos[o + 1] - p[1]) + Math.abs(this.targetPos[o + 2] - p[2]);
    this.targetPos.set(p, o);
    this.targetQuat.set(qnorm(q), i * 4);
    if (half) {
      // shrinking is always safe, so it happens at once; growing waits until the plate is
      // close to its slot (see substep), so a plate in flight never swells into a neighbour
      let grows = false;
      for (let a = 0; a < 3; a++) {
        if (half[a] <= this.half[o + a]) this.half[o + a] = half[a];
        else grows = true;
      }
      if (grows) this.pendingHalf.set(i, half);
      else this.pendingHalf.delete(i);
    }
    if (moved > 1e-5) {
      this.best[i] = Infinity;
      this.stuckFor[i] = 0;
      this.wake(i);
    }
  }
  private readonly pendingHalf = new Map<number, Vec3>();
  private pressed = new Uint8Array(0);
  /** a jammed plate shrunk to a shard */
  private shard = new Uint8Array(0);
  private jams = new Set<number>();

  /** touching pairs where at least one plate is jammed (shrunk), since the last call */
  takeJams(): [number, number][] {
    const out: [number, number][] = [];
    for (const k of this.jams) out.push([Math.floor(k / 65536), k % 65536]);
    this.jams.clear();
    return out;
  }

  /** a shard (shrunk to an eighth) stuck a hand's width from its slot for over 3 s slips the
   *  last few centimetres in; it grows back once seated */
  slipping(i: number) {
    if (!this.shard[i] || this.stuckFor[i] < 3) return false;
    const o = i * 3;
    const dx = this.targetPos[o] - this.pos[o], dy = this.targetPos[o + 1] - this.pos[o + 1], dz = this.targetPos[o + 2] - this.pos[o + 2];
    return dx * dx + dy * dy + dz * dz < 0.3 * 0.3;
  }

  /** a plate given a new slot starts afresh (not jammed) */
  unstick(i: number) {
    this.stuckFor[i] = 0;
    this.best[i] = Infinity;
    this.wake(i);
  }
  private pressedNext = new Uint8Array(0);

  /** seated: within a few centimetres of its slot and turned into place (and not lifted) */
  private docking(i: number) {
    const o = i * 3;
    if (this.lift[i] > 0.05) return false;
    const r = this.o.dockRadius;
    const dx = this.targetPos[o] - this.pos[o], dy = this.targetPos[o + 1] - this.pos[o + 1], dz = this.targetPos[o + 2] - this.pos[o + 2];
    if (dx * dx + dy * dy + dz * dz >= r * r) return false;
    const q = i * 4;
    const d = Math.abs(this.quat[q] * this.targetQuat[q] + this.quat[q + 1] * this.targetQuat[q + 1] + this.quat[q + 2] * this.targetQuat[q + 2] + this.quat[q + 3] * this.targetQuat[q + 3]);
    // the tolerance shrinks with the plate's length, so its ends stay within ~2 cm of place
    const reach = Math.max(this.half[o], this.half[o + 1], this.half[o + 2]);
    const maxAngle = Math.min(0.12, 0.02 / Math.max(reach, 0.05));
    return d > Math.cos(maxAngle / 2);
  }

  setMass(i: number, mass: number) {
    this.invMass[i] = 1 / Math.max(0.05, mass);
  }

  wake(i: number) {
    this.asleep[i] = 0;
    this.slowFor[i] = 0;
  }

  get sleeping() {
    for (let i = 0; i < this.n; i++) if (!this.asleep[i]) return false;
    return true;
  }

  /** The pointer pushing plates inside `radius` of `point` along `dir`, scaled by `power`. */
  poke(point: Vec3, dir: Vec3, radius: number, power: number) {
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      const dx = this.pos[o] - point[0], dy = this.pos[o + 1] - point[1], dz = this.pos[o + 2] - point[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > radius) continue;
      const f = power * (1 - d / radius) ** 2 * this.invMass[i];
      this.vel[o] += dir[0] * f;
      this.vel[o + 1] += dir[1] * f;
      this.vel[o + 2] += dir[2] * f;
      this.wake(i);
    }
  }

  /** Advance by dt seconds (fixed substeps). Returns contacts that began this frame. */
  step(dt: number): Contact[] {
    const contacts: Contact[] = [];
    this.acc = Math.min(this.acc + dt, 0.1); // never spiral after a stalled frame
    while (this.acc >= this.o.substep) {
      this.acc -= this.o.substep;
      // fast plates take finer steps: no plate moves more than `maxTravel` between contact
      // checks, so a thin slab can never skip through another one
      let vmax = 0;
      for (let i = 0; i < this.n; i++) {
        if (this.asleep[i]) continue;
        const v = Math.hypot(this.vel[i * 3], this.vel[i * 3 + 1], this.vel[i * 3 + 2]);
        if (v > vmax) vmax = v;
      }
      const k = Math.min(10, Math.max(1, Math.ceil((vmax * this.o.substep) / this.o.maxTravel)));
      for (let j = 0; j < k; j++) this.substep(this.o.substep / k, contacts);
    }
    return contacts;
  }

  private substep(h: number, contacts: Contact[]) {
    const { n, pos, vel, quat, ang, targetPos, targetQuat, invMass, o: O } = this;
    const k = O.stiffness;
    const c = 2 * O.dampingRatio * Math.sqrt(k);
    const kr = O.angularStiffness;
    const cr = 2 * O.dampingRatio * Math.sqrt(kr);

    // 1. springs toward the targets, integrate
    for (let i = 0; i < n; i++) {
      if (this.asleep[i]) continue;
      const o3 = i * 3;
      const o4 = i * 4;
      // heavier plates answer the spring a little more slowly
      const m = Math.sqrt(invMass[i]);
      // Blocked? Progress is measured across the floor (x, z). A plate that stops getting
      // closer is lifted over the plates in its way, then lowered into its slot once it is
      // above it, so it never has to pass through anything.
      const dist = Math.hypot(targetPos[o3] - pos[o3], targetPos[o3 + 1] - pos[o3 + 1], targetPos[o3 + 2] - pos[o3 + 2]);
      const across = Math.hypot(targetPos[o3] - pos[o3], targetPos[o3 + 2] - pos[o3 + 2]);
      if (across < this.best[i] - 0.02) {
        this.best[i] = across;
        this.stuckFor[i] = 0;
      } else this.stuckFor[i] += h;
      if (across < 0.1) {
        this.lift[i] = Math.max(0, this.lift[i] - O.liftRate * h);
        this.best[i] = across;
      } else if (this.stuckFor[i] > O.stuckAfter) {
        // each plate climbs to its own lane height, so lifted plates don't jam up there too
        const lane = O.maxLift * (0.45 + 0.55 * (((i * 7) % 11) / 10));
        this.lift[i] = Math.min(lane, this.lift[i] + O.liftRate * h);
      }
      else this.lift[i] = Math.max(0, this.lift[i] - O.liftRate * 0.3 * h);
      void dist;
      for (let a = 0; a < 3; a++) {
        const goal = targetPos[o3 + a] + (a === 1 ? this.lift[i] : 0);
        // a plate pressed against another eases off its pull, so it never shoves into it
        const kk = this.pressed[i] ? k * 0.2 : k;
        const acc = (kk * (goal - pos[o3 + a]) - c * vel[o3 + a]) * m;
        vel[o3 + a] += acc * h;
      }
      const sp = Math.hypot(vel[o3], vel[o3 + 1], vel[o3 + 2]);
      if (sp > O.maxSpeed) for (let a = 0; a < 3; a++) vel[o3 + a] *= O.maxSpeed / sp;
      for (let a = 0; a < 3; a++) pos[o3 + a] += vel[o3 + a] * h;
      // orientation error as an axis-angle in world space
      const q: Quat = [quat[o4], quat[o4 + 1], quat[o4 + 2], quat[o4 + 3]];
      const t: Quat = [targetQuat[o4], targetQuat[o4 + 1], targetQuat[o4 + 2], targetQuat[o4 + 3]];
      let e = qmul(t, [-q[0], -q[1], -q[2], q[3]]);
      if (e[3] < 0) e = [-e[0], -e[1], -e[2], -e[3]];
      const s = Math.hypot(e[0], e[1], e[2]);
      const angle = 2 * Math.atan2(s, e[3]);
      const axis: Vec3 = s > 1e-8 ? [e[0] / s, e[1] / s, e[2] / s] : [0, 0, 0];
      for (let a = 0; a < 3; a++) ang[o3 + a] += (kr * axis[a] * angle - cr * ang[o3 + a]) * m * h;
      const w: Quat = [ang[o3] * h * 0.5, ang[o3 + 1] * h * 0.5, ang[o3 + 2] * h * 0.5, 0];
      const dq = qmul(w, q);
      quat.set(qnorm([q[0] + dq[0], q[1] + dq[1], q[2] + dq[2], q[3] + dq[3]]), o4);
      // A plate that stays blocked shrinks (contacts stay on) until it slips through the
      // gaps; it grows back to full size as it reaches its slot. Nothing ever passes through.
      const jammed = this.stuckFor[i] > O.shrinkAfter && !this.docking(i);
      this.shard[i] = 0;
      if (jammed) {
        let full = this.pendingHalf.get(i);
        if (!full) {
          full = [this.half[o3], this.half[o3 + 1], this.half[o3 + 2]];
          this.pendingHalf.set(i, full);
        }
        const k = Math.min(1, h * 3);
        for (let a = 0; a < 3; a++) {
          const floor = Math.max(0.012, full[a] * O.shrinkTo);
          this.half[o3 + a] = Math.max(floor, this.half[o3 + a] - (this.half[o3 + a] - floor) * k);
        }
        // fully shrunk: a thin shard
        let small = true;
        for (let a = 0; a < 3; a++) if (this.half[o3 + a] > Math.max(0.012, full[a] * O.shrinkTo) * 1.08) small = false;
        this.shard[i] = small ? 1 : 0;
      }
      // a plate near its slot grows into its new size over a few frames
      const pend = this.pendingHalf.get(i);
      if (pend && dist < 0.3 && !jammed) {
        const k = Math.min(1, h * 10);
        let done = true;
        for (let a = 0; a < 3; a++) {
          this.half[o3 + a] += (pend[a] - this.half[o3 + a]) * k;
          if (Math.abs(pend[a] - this.half[o3 + a]) > 1e-4) done = false;
        }
        if (done) {
          this.half.set(pend, o3);
          this.pendingHalf.delete(i);
        }
      }
    }

    this.pressed.set(this.pressedNext);
    this.pressedNext.fill(0);
    // 2. contacts: push overlapping plates apart, kill closing speed
    const pairs = this.broadphase();
    const now = new Set<number>();
    let active = pairs;
    for (let it = 0; it < O.iterations; it++) {
      const next: number[] = [];
      for (const key of active) {
        const a = Math.floor(key / 65536);
        const b = key % 65536;
        if (this.asleep[a] && this.asleep[b]) continue;
        // two plates both seating into their own (non-overlapping) slots don't fight:
        // contact is for plates in flight, which is where paths actually cross. A blocked plate
        // first rises over the others and lowers into its slot; only if it is still blocked
        // after `ghostAfter` seconds (a safety net, rare) does it stop pushing.
        if ((this.docking(a) && this.docking(b)) || this.slipping(a) || this.slipping(b) || this.stuckFor[a] > O.ghostAfter || this.stuckFor[b] > O.ghostAfter) continue;
        const hit = boxContact(this.p3(a), this.q4(a), this.h3(a), this.p3(b), this.q4(b), this.h3(b), O.skin);
        if (!hit) continue;
        next.push(key);
        if (hit.depth > 0.01) { this.pressedNext[a] = 1; this.pressedNext[b] = 1; }
        // two jammed shards blocking each other: report them, so the scene can swap their slots
        if (this.shard[a] || this.shard[b]) this.jams.add(a < b ? a * 65536 + b : b * 65536 + a);
        now.add(key);
        const wa = invMass[a], wb = invMass[b];
        const sum = wa + wb || 1;
        const { n: nn, depth } = hit;
        // positional correction, split by inverse mass and capped per pass, so a deep
        // crossing resolves over a few frames instead of teleporting plates apart
        const push = Math.min(depth, O.maxCorrection);
        for (let ax = 0; ax < 3; ax++) {
          pos[a * 3 + ax] -= nn[ax] * push * (wa / sum);
          pos[b * 3 + ax] += nn[ax] * push * (wb / sum);
        }
        // Head-on jam: both plates want to go through each other. Real slabs would slip
        // past; nudge them apart sideways (opposite ways) so neither blocks the other.
        if (it === 0) this.sidestep(a, b, nn, wa / sum, wb / sum, h);
        if (it === 0) {
          // velocity response once per substep
          const rv: Vec3 = [vel[b * 3] - vel[a * 3], vel[b * 3 + 1] - vel[a * 3 + 1], vel[b * 3 + 2] - vel[a * 3 + 2]];
          const vn = dot(rv, nn);
          if (vn < 0) {
            const j = (-(1 + O.restitution) * vn) / sum;
            const tv: Vec3 = [rv[0] - vn * nn[0], rv[1] - vn * nn[1], rv[2] - vn * nn[2]];
            for (let ax = 0; ax < 3; ax++) {
              // normal impulse pushes them apart; friction pulls their sliding speeds together
              const fr = (O.friction * tv[ax]) / sum;
              vel[a * 3 + ax] += -j * nn[ax] * wa + fr * wa;
              vel[b * 3 + ax] += j * nn[ax] * wb - fr * wb;
            }
            // a glancing touch turns plates a little, as real slabs do
            const spin = cross(nn, tv);
            for (let ax = 0; ax < 3; ax++) {
              ang[a * 3 + ax] -= spin[ax] * O.contactSpin * wa;
              ang[b * 3 + ax] += spin[ax] * O.contactSpin * wb;
            }
            if (!this.touching.has(key) && -vn > O.contactSpeed) {
              contacts.push({
                a,
                b,
                speed: -vn,
                at: [(pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2],
              });
            }
          }
          this.wake(a);
          this.wake(b);
        }
      }
      active = next;
      if (!active.length) break;
    }
    this.touching.clear();
    for (const key of now) this.touching.add(key);

    // 3. sleep plates that are slow and home
    for (let i = 0; i < n; i++) {
      if (this.asleep[i]) continue;
      const o3 = i * 3;
      const speed = Math.hypot(vel[o3], vel[o3 + 1], vel[o3 + 2]) + Math.hypot(ang[o3], ang[o3 + 1], ang[o3 + 2]) * 0.2;
      const off = Math.hypot(targetPos[o3] - pos[o3], targetPos[o3 + 1] - pos[o3 + 1], targetPos[o3 + 2] - pos[o3 + 2]);
      if (speed < O.sleepSpeed && off < 0.01 && this.lift[i] < 1e-3 && !this.pendingHalf.has(i)) {
        this.slowFor[i] += h;
        if (this.slowFor[i] > O.sleepAfter) {
          this.asleep[i] = 1;
          vel.fill(0, o3, o3 + 3);
          ang.fill(0, o3, o3 + 3);
        }
      } else this.slowFor[i] = 0;
    }
  }

  private sidestep(a: number, b: number, nn: Vec3, sa: number, sb: number, h: number) {
    const { pos, targetPos, vel } = this;
    const ta: Vec3 = [targetPos[a * 3] - pos[a * 3], targetPos[a * 3 + 1] - pos[a * 3 + 1], targetPos[a * 3 + 2] - pos[a * 3 + 2]];
    const tb: Vec3 = [targetPos[b * 3] - pos[b * 3], targetPos[b * 3 + 1] - pos[b * 3 + 1], targetPos[b * 3 + 2] - pos[b * 3 + 2]];
    // a wants to go along +n (into b) and b along -n (into a)
    const pa = dot(ta, nn), pb = -dot(tb, nn);
    if (pa < 0.02 && pb < 0.02) return;
    // slide direction: world up made perpendicular to the normal; if the normal is vertical, use x
    let side: Vec3 = [-nn[1] * nn[0], 1 - nn[1] * nn[1], -nn[1] * nn[2]];
    let l = Math.hypot(side[0], side[1], side[2]);
    if (l < 0.2) {
      side = [1 - nn[0] * nn[0], -nn[0] * nn[1], -nn[0] * nn[2]];
      l = Math.hypot(side[0], side[1], side[2]) || 1;
    }
    side = [side[0] / l, side[1] / l, side[2] / l];
    // the lower-indexed plate goes over, the other under: deterministic, never undecided
    const f = this.o.sidestep * Math.min(1, Math.max(pa, pb)) * h;
    for (let ax = 0; ax < 3; ax++) {
      vel[a * 3 + ax] += side[ax] * f * (sa * 2);
      vel[b * 3 + ax] -= side[ax] * f * (sb * 2);
    }
  }

  /** Candidate pairs by bounding sphere in a uniform grid. Keys are a*65536+b, a<b. */
  private broadphase(): number[] {
    const { n, pos, half } = this;
    let rmax = 0;
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      r[i] = Math.hypot(half[i * 3], half[i * 3 + 1], half[i * 3 + 2]) + this.o.skin;
      if (r[i] > rmax) rmax = r[i];
    }
    const cell = Math.max(0.05, rmax * 2);
    // integer cell keys (no string building in the hot path)
    const keyOf = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
    const grid = this.grid;
    grid.clear();
    const cells = this.cells;
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(pos[i * 3] / cell), cy = Math.floor(pos[i * 3 + 1] / cell), cz = Math.floor(pos[i * 3 + 2] / cell);
      cells[i * 3] = cx;
      cells[i * 3 + 1] = cy;
      cells[i * 3 + 2] = cz;
      const k = keyOf(cx, cy, cz);
      const list = grid.get(k);
      if (list) list.push(i);
      else grid.set(k, [i]);
    }
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const cx = cells[i * 3], cy = cells[i * 3 + 1], cz = cells[i * 3 + 2];
      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -1; z <= 1; z++) {
            const list = grid.get(keyOf(cx + x, cy + y, cz + z));
            if (!list) continue;
            for (const j of list) {
              if (j <= i) continue;
              if (this.asleep[i] && this.asleep[j]) continue;
              const dx = pos[i * 3] - pos[j * 3], dy = pos[i * 3 + 1] - pos[j * 3 + 1], dz = pos[i * 3 + 2] - pos[j * 3 + 2];
              const rr = r[i] + r[j];
              if (dx * dx + dy * dy + dz * dz < rr * rr) out.push(i * 65536 + j);
            }
          }
    }
    return out;
  }

  private p3(i: number): Vec3 {
    return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]];
  }
  private q4(i: number): Quat {
    return [this.quat[i * 4], this.quat[i * 4 + 1], this.quat[i * 4 + 2], this.quat[i * 4 + 3]];
  }
  private h3(i: number): Vec3 {
    return [this.half[i * 3], this.half[i * 3 + 1], this.half[i * 3 + 2]];
  }
}

/** Pairs of slots in a finished form that overlap (should be none). For tests and dev checks. */
export function overlappingSlots(slots: { p: Vec3; q: Quat; half: Vec3 }[], skin = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < slots.length; i++)
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i], b = slots[j];
      const ra = Math.hypot(...a.half), rb = Math.hypot(...b.half);
      const d = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
      if (d > ra + rb) continue;
      const hit = boxContact(a.p, a.q, a.half, b.p, b.q, b.half, skin);
      if (hit && hit.depth > 1e-4) out.push([i, j]);
    }
  return out;
}
