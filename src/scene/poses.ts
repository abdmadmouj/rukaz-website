import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { MaterialKey } from '../config/artDirection';

/**
 * Pose buffers. Every plate's pose is 14 floats, so a whole form is one Float32Array
 * that can be blended, mirrored and uploaded without allocating.
 *   position (3) · rotation quaternion (4) · half size (3) · face radius R · bevel r · taper · highlight
 */
export const STRIDE = 14;
export const P = { px: 0, py: 1, pz: 2, qx: 3, qy: 4, qz: 5, qw: 6, hx: 7, hy: 8, hz: 9, R: 10, r: 11, taper: 12, hl: 13 } as const;

export const poseBuffer = (n: number) => new Float32Array(n * STRIDE);

/** A plate in a layout. t is thickness (local x), h height (local y), l length (local z). */
export interface Slot {
  x: number;
  y: number;
  z: number;
  t: number;
  h: number;
  l: number;
  quat?: Quaternion;
  /** degrees, applied YXZ as (roll, yaw, lean) when no quaternion is given */
  lean?: number;
  yaw?: number;
  roll?: number;
  R: number;
  r: number;
  taper?: number;
  hl?: number;
  /** sort key: plates are handed to slots in identity order, slots sorted by key */
  key: number;
}

export interface Identity {
  index: number;
  mat: MaterialKey;
  seed: number;
  /** 0..1 reading order along the ribbon */
  order: number;
}

const DEG = Math.PI / 180;
const euler = new Euler();
const quat = new Quaternion();
const basisMatrix = new Matrix4();

export function writeSlot(buf: Float32Array, i: number, s: Slot) {
  const o = i * STRIDE;
  buf[o + P.px] = s.x;
  buf[o + P.py] = s.y;
  buf[o + P.pz] = s.z;
  if (s.quat) quat.copy(s.quat);
  else {
    euler.set((s.roll ?? 0) * DEG, (s.yaw ?? 0) * DEG, (s.lean ?? 0) * DEG, 'YXZ');
    quat.setFromEuler(euler);
  }
  buf[o + P.qx] = quat.x;
  buf[o + P.qy] = quat.y;
  buf[o + P.qz] = quat.z;
  buf[o + P.qw] = quat.w;
  buf[o + P.hx] = s.t / 2;
  buf[o + P.hy] = s.h / 2;
  buf[o + P.hz] = s.l / 2;
  buf[o + P.R] = s.R;
  buf[o + P.r] = s.r;
  buf[o + P.taper] = s.taper ?? 0;
  buf[o + P.hl] = s.hl ?? 0;
}

export function readQuat(buf: Float32Array, i: number, out: Quaternion) {
  const o = i * STRIDE;
  return out.set(buf[o + 3], buf[o + 4], buf[o + 5], buf[o + 6]);
}

/** quaternion whose local x, y, z axes are the given (orthonormal, right-handed) vectors */
export function basis(x: Vector3, y: Vector3, z: Vector3, out = new Quaternion()) {
  basisMatrix.makeBasis(x, y, z);
  return out.setFromRotationMatrix(basisMatrix);
}

/** deterministic 0..1 hash */
export function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** bevel and face radius that suit a plate of this size */
export function radii(bevel: number, faceRadius: number, t: number, h: number, l: number, R?: number) {
  const r = Math.min(bevel, t * 0.45);
  const fr = Math.min(R ?? faceRadius, h / 2, l / 2);
  return { r, R: Math.max(fr, r) };
}

/**
 * Hand slots to plates. Plates sorted by `rank` receive slots sorted by key, so neighbours
 * on the ribbon stay neighbours in the next form and travel short, parallel paths.
 */
export function assign(slots: Slot[], ids: Identity[], rank: (id: Identity) => number) {
  if (slots.length !== ids.length) throw new Error(`layout has ${slots.length} slots for ${ids.length} plates`);
  const buf = poseBuffer(ids.length);
  const sortedSlots = [...slots].sort((a, b) => a.key - b.key);
  [...ids].sort((a, b) => rank(a) - rank(b)).forEach((id, k) => writeSlot(buf, id.index, sortedSlots[k]));
  return buf;
}

export function translate(buf: Float32Array, n: number, dx: number, dy: number, dz: number) {
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    buf[o] += dx;
    buf[o + 1] += dy;
    buf[o + 2] += dz;
  }
  return buf;
}

/** Mirror a whole form through a plane (point, unit normal). Used for Arabic (RTL). */
export function mirror(src: Float32Array, n: number, point: Vector3, normal: Vector3, out = poseBuffer(n)) {
  const p = new Vector3();
  const q = new Quaternion();
  const ax = new Vector3();
  const ay = new Vector3();
  const az = new Vector3();
  const reflect = (v: Vector3) => v.sub(normal.clone().multiplyScalar(2 * v.dot(normal)));
  out.set(src);
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    p.set(src[o], src[o + 1], src[o + 2]).sub(point);
    reflect(p).add(point);
    out[o] = p.x;
    out[o + 1] = p.y;
    out[o + 2] = p.z;
    readQuat(src, i, q);
    ax.set(1, 0, 0).applyQuaternion(q);
    ay.set(0, 1, 0).applyQuaternion(q);
    az.set(0, 0, 1).applyQuaternion(q);
    // a reflection flips handedness; negating one axis keeps the slab the same shape
    reflect(ax).negate();
    reflect(ay);
    reflect(az);
    basis(ax, ay, az, q);
    out[o + 3] = q.x;
    out[o + 4] = q.y;
    out[o + 5] = q.z;
    out[o + 6] = q.w;
  }
  return out;
}

/** axis-aligned bounds of a form, counting each plate's full extent */
export function bounds(buf: Float32Array, n: number) {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const q = new Quaternion();
  const c = new Vector3();
  const e = new Vector3();
  const corner = new Vector3();
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    c.set(buf[o], buf[o + 1], buf[o + 2]);
    e.set(buf[o + 7], buf[o + 8], buf[o + 9]);
    readQuat(buf, i, q);
    for (let k = 0; k < 8; k++) {
      corner.set(k & 1 ? e.x : -e.x, k & 2 ? e.y : -e.y, k & 4 ? e.z : -e.z).applyQuaternion(q).add(c);
      min.min(corner);
      max.max(corner);
    }
  }
  return { min, max };
}
