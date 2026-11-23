import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { artDirection as AD, type Breakpoint, type CameraSpec } from '../config/artDirection';
import { matchSlots } from './assignment';
import * as L from './layouts';
import { bounds, poseBuffer, STRIDE, type Identity } from './poses';

/**
 * The storyboard: one stop per section, in page order. Scrolling moves a continuous
 * stage value through these stops; each stop names its form and its camera.
 */
export const STOPS = ['hero', 'who', 'ways', 'discover', 'validate', 'build', 'scale', 'proof', 'terms', 'contact', 'connect'] as const;
export type StopName = (typeof STOPS)[number];
export type Direction = 'ltr' | 'rtl';

export interface Motion {
  /** turn about a vertical axis through `center`: continuous (deg/s) or a sway (deg amplitude) */
  center: Vector3;
  speed?: number;
  sway?: number;
  period?: number;
}

export interface Stop {
  name: StopName;
  poses: Float32Array;
  motion?: Motion;
  /** arrival order into this form, 0..1 per plate (bottom first for stacked forms) */
  arrival?: Float32Array;
  /** per plate (x, y, z): where it slides in from, relative to its slot */
  approach?: Float32Array;
  /** world box the camera frames (fitted stops only) */
  frame?: { min: Vector3; max: Vector3; view: [number, number] };
}

export function breakpointFor(w: number, h: number): Breakpoint {
  const aspect = w / Math.max(h, 1);
  if (aspect >= 1.2 && w >= 900) return 'wide';
  if (aspect >= 0.78 && w >= 640) return 'tablet';
  return 'mobile';
}


export function buildStops(bp: Breakpoint, dir: Direction) {
  const rib = L.ribbon();
  const { identities: ids, count } = rib;
  // the row is symmetric and centred, so it reads the same in both directions
  const heroPoses = rib.poses;
  const fitted = (poses: Float32Array, view: [number, number]) => {
    const b = bounds(poses, count);
    return { min: b.min, max: b.max, view };
  };
  const V = AD.framing.view;
  const who = L.halves(ids);
  const ways = L.core(ids);
  const proof = L.column(ids);
  const terms = L.ledger(ids);
  const contact = L.mark(ids);
  const gate = (g: number): Stop => {
    const poses = L.gates(ids, g);
    const gx = AD.gates.xs[g];
    return { name: STOPS[3 + g], poses, frame: { min: new Vector3(gx - 3.6, 0, -1.6), max: new Vector3(gx + 3.6, AD.gates.height + 0.8, 1.6), view: V.gate } };
  };
  const centerOf = (p: Float32Array) => {
    const b = bounds(p, count);
    return new Vector3().addVectors(b.min, b.max).multiplyScalar(0.5);
  };
  const stops: Stop[] = [
    { name: 'hero', poses: heroPoses },
    { name: 'who', poses: who, frame: fitted(who, V.who), motion: { center: centerOf(who), speed: AD.halves.turn } },
    { name: 'ways', poses: ways, frame: fitted(ways, V.ways), motion: { center: centerOf(ways), speed: AD.core.spin } },
    gate(0), gate(1), gate(2), gate(3),
    { name: 'proof', poses: proof, frame: fitted(proof, V.proof) },
    { name: 'terms', poses: terms, frame: fitted(terms, V.terms) },
    { name: 'contact', poses: contact, frame: fitted(contact, V.contact) },
    { name: 'connect', poses: heroPoses },
  ];
  // each form takes its plates by optimal matching from the form before it (in page order),
  // so every transition moves plates along paths that keep clear of each other
  for (let k = 1; k < stops.length; k++) {
    stops[k].poses = matchSlots(stops[k - 1].poses, stops[k].poses, count, STRIDE);
  }
  // stacked forms fill from the ground up, so no plate has to slide in under another
  for (const s of stops) if (['ways', 'discover', 'validate', 'build', 'scale'].includes(s.name)) s.arrival = heightRank(s.poses, count);
  // every built form is entered along a clear path: the column's tiles slide in along their
  // length (between the levels above and below); everything else comes in face first
  for (const s of stops) if (s.frame) s.approach = approachVectors(s.poses, count, 'face');
  return { stops, identities: ids, count };
}

/** where each plate slides in from: along its face normal (pointing out of the form) or its length */
function approachVectors(poses: Float32Array, count: number, along: 'face' | 'length' | 'above') {
  const b = bounds(poses, count);
  const c = new Vector3().addVectors(b.min, b.max).multiplyScalar(0.5);
  const out = new Float32Array(count * 3);
  const q = new Quaternion(), v = new Vector3(), rel = new Vector3();
  for (let i = 0; i < count; i++) {
    const o = i * STRIDE;
    q.set(poses[o + 3], poses[o + 4], poses[o + 5], poses[o + 6]);
    if (along === 'above') { out[i * 3 + 1] = poses[o + 8] * 2 + 0.6; continue; }
    if (along === 'length') v.set(0, 0, 1).applyQuaternion(q).multiplyScalar(poses[o + 9] * 2 + 0.5);
    else v.set(1, 0, 0).applyQuaternion(q).multiplyScalar(0.9);
    rel.set(poses[o] - c.x, poses[o + 1] - c.y, poses[o + 2] - c.z);
    // point away from the form's middle, never down through the floor
    if (v.dot(rel) < 0 || (v.y < -0.3 && along === 'face')) v.negate();
    if (poses[o + 1] + v.y < poses[o + 8]) v.y = Math.abs(v.y);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

/** 0..1 rank of each plate by the height of its slot */
function heightRank(poses: Float32Array, count: number) {
  const idx = Array.from({ length: count }, (_, i) => i).sort((a, b) => poses[a * STRIDE + 1] - poses[b * STRIDE + 1]);
  const out = new Float32Array(count);
  idx.forEach((plate, k) => { out[plate] = k / Math.max(1, count - 1); });
  return out;
}

const tmpCam = new PerspectiveCamera();
const corner = new Vector3();

/**
 * Automatic framing: place the camera so the form fills its share of its screen area
 * (columns 6 to 12 on desktop, mirrored in Arabic; the top of the screen on phones).
 * Uses the real projected corners, so tall, wide and flat forms all sit snugly.
 */
export function fitCamera(frame: NonNullable<Stop['frame']>, bp: Breakpoint, dir: Direction, w: number, h: number, bottom?: number): CameraSpec {
  const F = AD.framing;
  let [x0, x1, y0, y1] = F.area[bp];
  // the page reports where its words begin, so the form always ends above them
  if (bottom !== undefined && bp === 'wide') y1 = Math.max(y0 + 0.2, Math.min(y1 + 0.1, bottom));
  // phones show only a short caption under each shape, so the shape takes most of the screen
  if (bp === 'mobile' && w <= 640) [y0, y1] = [0.12, 0.66];
  if (dir === 'rtl') [x0, x1] = [1 - x1, 1 - x0];
  const [azDeg, elDeg] = frame.view;
  const az = ((dir === 'rtl' ? -azDeg : azDeg) * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  const toCam = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const center = new Vector3().addVectors(frame.min, frame.max).multiplyScalar(0.5);
  const radius = Math.max(0.5, frame.min.distanceTo(frame.max) / 2);
  const fov = F.fov[bp];
  tmpCam.fov = fov;
  tmpCam.aspect = w / Math.max(h, 1);
  tmpCam.near = 0.1;
  tmpCam.far = 500;
  tmpCam.clearViewOffset();
  tmpCam.updateProjectionMatrix();
  let dist = radius / Math.sin(((fov * Math.PI) / 180) / 2);
  let cx = 0, cy = 0;
  for (let it = 0; it < 4; it++) {
    tmpCam.position.copy(center).addScaledVector(toCam, dist);
    tmpCam.lookAt(center);
    tmpCam.updateMatrixWorld();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < 8; k++) {
      corner.set(k & 1 ? frame.max.x : frame.min.x, k & 2 ? frame.max.y : frame.min.y, k & 4 ? frame.max.z : frame.min.z).project(tmpCam);
      minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
    }
    const rx = (maxX - minX) / 2 / (F.fill * (x1 - x0));
    const ry = (maxY - minY) / 2 / (F.fill * (y1 - y0));
    cx = (minX + maxX) / 2;
    cy = (minY + maxY) / 2;
    const r = Math.max(rx, ry);
    if (Math.abs(r - 1) < 0.01) break;
    // projected size goes roughly as 1 / distance (measured from the form's front)
    dist = Math.max(radius * 1.05, (dist - radius) * r + radius);
  }
  const ax = x0 + x1 - 1;
  const ay = 1 - (y0 + y1);
  const pos = new Vector3().copy(center).addScaledVector(toCam, dist);
  return { pos: pos.toArray() as [number, number, number], target: center.toArray() as [number, number, number], fov, shift: [(ax - cx) / 2, (cy - ay) / 2] };
}


/** the composed (hand-placed) cameras for the hero and the close: centred, so the same in Arabic */
export function composedCamera(name: 'hero' | 'connect', bp: Breakpoint, _dir: Direction, w = 0, h = 0): CameraSpec {
  const cam = AD.cameras[name][bp];
  if (bp !== 'mobile' || !w || !h) return cam;
  // tall screens differ a lot: on a phone the words take most of the height, so the row sits
  // low; on a tablet held upright the words are short, so the row comes up to meet them
  const k = clamp01((w / h - 0.6) / (0.75 - 0.6));
  // phones use the app layout: words at the top, the row in the middle of what is left
  const [phone, upright] = name === 'hero' ? [w <= 640 ? 0.24 : 0.36, 0.04] : [w <= 640 ? 0.03 : 0.28, 0.02];
  return { ...cam, shift: [cam.shift[0], phone + (upright - phone) * k] };
}

const smootherstep = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export { smootherstep, clamp01 };

const qa = new Quaternion(), qb = new Quaternion(), qm = new Quaternion(), pv = new Vector3();

/** a stop's poses at time t, with its slow motion applied */
export function stopPoses(stop: Stop, time: number, count: number, out: Float32Array, still: boolean) {
  out.set(stop.poses);
  const m = stop.motion;
  if (!m || still) return out;
  const angle = m.speed !== undefined ? (m.speed * Math.PI / 180) * time : ((m.sway ?? 0) * Math.PI / 180) * Math.sin((2 * Math.PI * time) / (m.period ?? 16));
  qm.setFromAxisAngle(new Vector3(0, 1, 0), angle);
  for (let i = 0; i < count; i++) {
    const o = i * STRIDE;
    pv.set(out[o] - m.center.x, out[o + 1] - m.center.y, out[o + 2] - m.center.z).applyQuaternion(qm);
    out[o] = pv.x + m.center.x;
    out[o + 1] = pv.y + m.center.y;
    out[o + 2] = pv.z + m.center.z;
    qa.set(out[o + 3], out[o + 4], out[o + 5], out[o + 6]).premultiply(qm);
    out[o + 3] = qa.x; out[o + 4] = qa.y; out[o + 5] = qa.z; out[o + 6] = qa.w;
  }
  return out;
}

/**
 * The transition between two forms. Plates leave in reading order (a wave along the
 * ribbon, with a little randomness), lift off their form along their faces, travel on
 * their own arc and lane, and land. The physics then settles real contact.
 */
export function blend(from: Float32Array, to: Float32Array, e: number, ids: Identity[], out: Float32Array, arrival?: Float32Array, approach?: Float32Array) {
  const { stagger, release, arc, lanes } = AD.choreography;
  const n = ids.length;
  /** share of a plate's move spent travelling to its approach point; the rest slides it in */
  const TRAVEL = 0.7;
  for (let i = 0; i < n; i++) {
    const id = ids[i];
    const rank = arrival ? arrival[i] : id.order;
    const start = stagger * (0.85 * rank + 0.15 * id.seed);
    const f = smootherstep(clamp01((e - start) / (1 - stagger)));
    const o = i * STRIDE;
    if (f <= 0) { out.set(from.subarray(o, o + STRIDE), o); continue; }
    if (f >= 1) { out.set(to.subarray(o, o + STRIDE), o); continue; }
    // the travel aims at a point just outside the slot (the approach point), then the plate
    // slides straight in, already turned and sized, along a path no neighbour crosses
    const ax = approach ? approach[i * 3] : 0, ay = approach ? approach[i * 3 + 1] : 0, az = approach ? approach[i * 3 + 2] : 0;
    const f1 = approach ? smootherstep(clamp01(f / TRAVEL)) : f;
    const f2 = approach ? smootherstep(clamp01((f - TRAVEL) / (1 - TRAVEL))) : 1;
    const tx = to[o] + ax * (1 - f2), ty = to[o + 1] + ay * (1 - f2), tz = to[o + 2] + az * (1 - f2);
    const dx = tx - from[o], dy = ty - from[o + 1], dz = tz - from[o + 2];
    const dist = Math.min(Math.hypot(to[o] + ax - from[o], to[o + 1] + ay - from[o + 1], to[o + 2] + az - from[o + 2]), 10);
    const bump = Math.sin(Math.PI * f1);
    // lane: sideways from the path, so neighbours fly apart instead of through each other
    const flat = Math.hypot(dx, dz) || 1;
    const side = (id.seed - 0.5) * 2 * lanes * bump * Math.min(1, dist / 3);
    // release: off the old form along its face normal, early in the move
    qa.set(from[o + 3], from[o + 4], from[o + 5], from[o + 6]);
    pv.set(1, 0, 0).applyQuaternion(qa).multiplyScalar(release * bump * (1 - f1) * (id.seed > 0.5 ? 1 : -1));
    out[o] = from[o] + dx * f1 + (-dz / flat) * side + pv.x;
    // one shared rise for every plate (it keeps the matched paths apart)
    out[o + 1] = from[o + 1] + dy * f1 + bump * arc * Math.min(1, dist / 4) + Math.abs(pv.y);
    out[o + 2] = from[o + 2] + dz * f1 + (dx / flat) * side + pv.z;
    qb.set(to[o + 3], to[o + 4], to[o + 5], to[o + 6]);
    qa.slerp(qb, f1);
    out[o + 3] = qa.x; out[o + 4] = qa.y; out[o + 5] = qa.z; out[o + 6] = qa.w;
    for (let k = 7; k < STRIDE; k++) out[o + k] = from[o + k] + (to[o + k] - from[o + k]) * f1;
  }
  return out;
}

export const emptyPoses = poseBuffer;

/** would plates a and b (now at pa, pb) travel less in total with each other's slot? */
export function swapHelps(stop: Stop, a: number, b: number, pos: Float32Array) {
  const p = stop.poses;
  const d = (i: number, j: number) => {
    const dx = pos[i * 3] - p[j * STRIDE], dy = pos[i * 3 + 1] - p[j * STRIDE + 1], dz = pos[i * 3 + 2] - p[j * STRIDE + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  return d(a, b) + d(b, a) < d(a, a) + d(b, b) - 1e-4;
}

/** give plates a and b each other's slot in this form (any plate can fill any slot) */
export function swapSlots(stop: Stop, a: number, b: number) {
  const p = stop.poses;
  for (let k = 0; k < STRIDE; k++) {
    const t = p[a * STRIDE + k];
    p[a * STRIDE + k] = p[b * STRIDE + k];
    p[b * STRIDE + k] = t;
  }
  if (stop.arrival) [stop.arrival[a], stop.arrival[b]] = [stop.arrival[b], stop.arrival[a]];
  if (stop.approach) for (let k = 0; k < 3; k++) {
    const t = stop.approach[a * 3 + k];
    stop.approach[a * 3 + k] = stop.approach[b * 3 + k];
    stop.approach[b * 3 + k] = t;
  }
}
