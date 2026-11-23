import { Quaternion, Vector3 } from 'three';
import { artDirection as AD, type ArtDirection } from '../config/artDirection';
import { MARK_BOUNDS, MARK_LEFT_POLYGON } from '../brand/mark';
import { assign, basis, hash, poseBuffer, radii, writeSlot, type Identity, type Slot } from './poses';

/**
 * The forms. Every function returns one pose buffer for all plates.
 * Rule for every resting form: no two slots overlap (checked in tests/layouts.test.ts),
 * so the physics can settle each plate exactly into place.
 */

const UP = new Vector3(0, 1, 0);
const fit = (t: number, h: number, l: number, R?: number) => radii(AD.plate.bevel, AD.plate.faceRadius, t, h, l, R);

/**
 * 01 · Hero: the row. Every plate stands side by side, facing you, in one centred line that
 * curves gently away at both ends. Defines the plate set (left to right is reading order).
 */
export function ribbon(ad: ArtDirection = AD) {
  const R = ad.ribbon;
  const n = R.count;
  const thick = (i: number) => {
    const fromMid = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
    return R.thickness[i % R.thickness.length] * (1 + 0.35 * Math.exp(-fromMid * fromMid * 18));
  };
  // lay the plates out along x first, then centre the row
  const xs: number[] = [];
  let edge = 0;
  for (let i = 0; i < n; i++) {
    const t = thick(i);
    xs.push(edge + t / 2);
    edge += t + R.gap;
  }
  const mid = (edge - R.gap) / 2;
  const slots: (Slot & { mat: Identity['mat'] })[] = [];
  for (let i = 0; i < n; i++) {
    const x = xs[i] - mid;
    const t = thick(i);
    // a gentle swell: the plates in the middle stand a little taller
    const h = R.height[0] + (R.height[1] - R.height[0]) * Math.exp(-(x * x) / (2 * R.swell * R.swell)) + 0.04 * Math.sin(i * 1.7);
    const l = R.length * (0.92 + 0.08 * Math.cos(i * 0.9));
    const z = -R.curve * x * x;
    const yaw = (Math.atan(2 * R.curve * x) * 180) / Math.PI;
    slots.push({ x, y: h / 2, z, t, h, l, yaw, mat: R.mats[i % R.mats.length], key: i, ...fit(t, h, l) });
  }
  const poses = poseBuffer(n);
  const identities: Identity[] = slots.map((s, i) => {
    writeSlot(poses, i, s);
    return { index: i, mat: s.mat, seed: hash(i + R.seed * 31), order: i / (n - 1) };
  });
  return { poses, identities, count: n };
}

/** Split n into parts proportional to weights (each at least 1), summing exactly to n. */
function share(n: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.max(1, Math.floor((w / sum) * n)));
  const order = weights.map((_, i) => i).sort((a, b) => weights[b] - weights[a]);
  for (let k = 0, left = n - out.reduce((a, b) => a + b, 0); left > 0; k++, left--) out[order[k % order.length]]++;
  return out;
}

/**
 * 02 · Who we work with: two halves. A banded sphere parted along a vertical channel,
 * the two halves turned slightly open: groups on one side, founders on the other,
 * the same shape as the two halves of the RUKAZ mark.
 */
export function halves(ids: Identity[], ad: ArtDirection = AD) {
  const n = ids.length;
  const { center, radius, bands, fill, thickness, channel, open } = ad.halves;
  const lats = Array.from({ length: bands }, (_, b) => -Math.PI / 2 + ((b + 0.5) / bands) * Math.PI);
  // two halves per band, plates per half-band in proportion to its circumference
  const perBand = share(n, lats.map((y) => Math.cos(y)));
  const slots: Slot[] = [];
  const meridian = (Math.PI * radius) / bands;
  const normal = new Vector3(), east = new Vector3(), north = new Vector3();
  lats.forEach((lat, b) => {
    const count = perBand[b];
    const left = Math.floor(count / 2), right = count - left;
    for (const [side, k] of [[1, right], [-1, left]] as const) {
      const ringR = radius * Math.cos(lat);
      // the half spans 180° minus the channel, measured at this band's radius
      const gapAngle = Math.min(Math.PI * 0.5, channel / Math.max(ringR, 0.2));
      const span = Math.PI - gapAngle;
      const polar = b === 0 || b === bands - 1;
      const h = Math.max(meridian * fill * (polar ? 0.6 : 1), 0.2);
      // measured at the tile's edge nearest the axis, where neighbours on a ring converge
      const innerR = Math.max(0.15, ringR - Math.abs(Math.sin(lat)) * h * 0.5 - thickness);
      const along = Math.min((innerR * span) / k * fill, 1.9);
      const l = Math.max(along, 0.12);
      for (let j = 0; j < k; j++) {
        // right half: azimuth from -90° to +90° (x > 0); left half mirrored
        const a = -span / 2 + ((j + 0.5) / k) * span + (side > 0 ? 0 : Math.PI);
        normal.set(Math.cos(lat) * Math.cos(a), Math.sin(lat), Math.cos(lat) * Math.sin(a));
        east.crossVectors(UP, normal);
        if (east.lengthSq() < 1e-6) east.set(0, 0, 1);
        east.normalize();
        north.crossVectors(normal, east).normalize();
        const q = basis(normal, north, new Vector3().crossVectors(normal, north), new Quaternion());
        // open each half like a geode: turn it about the vertical axis through its inner edge
        const turn = new Quaternion().setFromAxisAngle(UP, side * -open * (Math.PI / 180));
        const p = new Vector3(normal.x * radius, normal.y * radius, normal.z * radius);
        p.x -= side * channel * 0.15;
        p.applyQuaternion(turn);
        p.x += side * channel * 0.5;
        q.premultiply(turn);
        slots.push({ x: p.x + center[0], y: p.y + center[1], z: p.z + center[2], t: thickness, h, l, quat: q, R: Math.min(0.14, h / 2, l / 2), r: Math.min(0.03, thickness * 0.4),
          // sort left to right, then bottom to top, so the ribbon's order sweeps across
          key: p.x * 4 + p.y * 0.5 });
      }
    }
  });
  return assign(slots, ids, (id) => id.order);
}

/**
 * 03 · Three ways: the core sample. A column of glass in three layers, loose at the top,
 * woven in the middle, dense at the base. Commit is the solid base everything stands on.
 */
export function core(ids: Identity[], ad: ArtDirection = AD) {
  const n = ids.length;
  const { center, radius, slat, layerGap, layers } = ad.core;
  const total = layers.reduce((a, L) => a + L.rings * L.perRing, 0);
  if (total !== n) throw new Error(`core sample holds ${total} plates, the ribbon has ${n}`);
  const slots: Slot[] = [];
  const ringGap = 0.05;
  let y = 0;
  layers.forEach((L, li) => {
    for (let ring = 0; ring < L.rings; ring++) {
      const cy = y + L.height / 2;
      const offset = ring % 2 ? 0.5 : 0;
      const step = (Math.PI * 2) / L.perRing;
      for (let j = 0; j < L.perRing; j++) {
        const a = (j + offset) * step + li * 0.35;
        const radial = new Vector3(Math.cos(a), 0, Math.sin(a));
        const tangent = new Vector3(-Math.sin(a), 0, Math.cos(a));
        let q: Quaternion, r = radius, t = slat, l: number;
        if (L.name === 'advise') {
          // loose: radial fins, each ring turned a little further
          q = basis(tangent, UP, radial.clone().negate());
          l = radius * 0.62;
          r = radius - l / 2 - 0.08;
        } else {
          // tangential wall; operate weaves in and out, commit is a closed wall
          q = basis(radial, UP, tangent);
          const chord = 2 * (radius - t) * Math.sin(step / 2);
          l = chord * L.fill;
          if (L.name === 'operate') r = radius + (j % 2 ? 0.09 : -0.09);
        }
        slots.push({ x: center[0] + radial.x * r, y: center[1] + cy, z: center[2] + radial.z * r, t, h: L.height, l, quat: q, ...fit(t, L.height, l, 0.12),
          // sort bottom to top, then around: the ribbon's start becomes the base
          key: (li * 10 + ring) * 1000 + j });
      }
      y += L.height + ringGap;
    }
    y += layerGap - ringGap;
  });
  return assign(slots, ids, (id) => id.order);
}

/** how many core layers there are, base first (for the highlight of each way) */
export const coreLayerOf = (ad: ArtDirection = AD) => {
  const out: number[] = [];
  ad.core.layers.forEach((L, li) => { for (let k = 0; k < L.rings * L.perRing; k++) out.push(li); });
  return out;
};

/**
 * 04 · How an engagement moves: four gates in a row and a stream of plates passing
 * through them. `active` is the gate being explained; it lifts and lights, and the
 * stream has reached it. Each gate passed raises the stream a step.
 */
export function gates(ids: Identity[], active: number, ad: ArtDirection = AD) {
  const n = ids.length;
  const G = ad.gates;
  const slots: Slot[] = [];
  let key = 0;
  const gateLift = 0.14;
  G.xs.forEach((gx, g) => {
    const lit = g === active ? 1 : 0;
    const lift = g === active ? gateLift : 0;
    const pieceH = G.height / G.post.pieces;
    for (const side of [-1, 1]) {
      for (let k = 0; k < G.post.pieces; k++) {
        const h = pieceH - 0.04;
        slots.push({ x: gx, y: lift + k * pieceH + h / 2, z: side * (G.width / 2), t: G.post.t, h, l: G.post.l, hl: lit, ...fit(G.post.t, h, G.post.l, 0.08), key: key++ });
      }
    }
    const span = G.width + G.post.l;
    const pl = span / G.lintel.pieces - 0.04;
    for (let k = 0; k < G.lintel.pieces; k++) {
      const z = -span / 2 + (k + 0.5) * (span / G.lintel.pieces);
      slots.push({ x: gx, y: lift + G.height + 0.04 + G.lintel.h / 2, z, t: G.lintel.t, h: G.lintel.h, l: pl, hl: lit, ...fit(G.lintel.t, G.lintel.h, pl, 0.08), key: key++ });
    }
  });
  const streamCount = n - slots.length;
  const S = G.stream;
  const lanes = [-0.5, 0, 0.5];
  const perLane = Math.ceil(streamCount / lanes.length);
  const pitch = 0.34;
  const front = G.xs[Math.min(active, G.xs.length - 1)] + 0.55;
  for (let k = 0; k < streamCount; k++) {
    const lane = k % lanes.length;
    const idx = Math.floor(k / lanes.length);
    // the stream runs from the far end up to just past the active gate
    const x = front - (perLane - 1 - idx) * pitch - (lane === 1 ? pitch / 2 : 0);
    const passed = G.xs.filter((gx) => x > gx + 0.3).length;
    const rise = passed * 0.22;
    slots.push({ x, y: S.h / 2 + rise, z: lanes[lane], t: S.t, h: S.h, l: S.l, hl: x > G.xs[active] - 0.6 ? 0.5 : 0, ...fit(S.t, S.h, S.l, 0.1), key: 1000 + x * 10 + lane });
  }
  return assign(slots, ids, (id) => id.order);
}

/**
 * 05 · Proof: rising bars. Six bars of standing glass fins, each taller than the last, like
 * revenue growing. Fins stand side by side (never stacked), so the form builds cleanly.
 */
export function column(ids: Identity[], ad: ArtDirection = AD) {
  const n = ids.length;
  const C = ad.column;
  const counts = C.counts.slice();
  counts[counts.length - 1] += n - counts.reduce((a, b) => a + b, 0);
  const slots: Slot[] = [];
  const bars = counts.length;
  counts.forEach((k, bi) => {
    const h = C.heights[0] + ((C.heights[1] - C.heights[0]) * bi) / (bars - 1);
    const x = (bi - (bars - 1) / 2) * C.barGap;
    for (let j = 0; j < k; j++) {
      const z = (j - (k - 1) / 2) * C.pitch;
      // thickness along z, length along x
      slots.push({ x: C.center[0] + x, y: h / 2, z: C.center[2] + z, t: C.fin.t, h, l: C.fin.l, yaw: 90, ...fit(C.fin.t, h, C.fin.l, 0.1), key: bi * 100 + j });
    }
  });
  return assign(slots, ids, (id) => id.order);
}

/** 06 · Terms: every plate in an ordered ledger, tilted up to be read. Nothing hidden. */
export function ledger(ids: Identity[], ad: ArtDirection = AD) {
  const n = ids.length;
  const { center, cols, tile, gap } = ad.ledger;
  const rows = Math.ceil(n / cols);
  const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (-18 * Math.PI) / 180);
  // lying flat: thickness up, length across (x), height in depth (z)
  const flat = basis(UP, new Vector3(0, 0, 1), new Vector3(1, 0, 0)).premultiply(tilt);
  const depth = rows * tile.d + (rows - 1) * gap;
  const slots: Slot[] = [];
  for (let k = 0; k < n; k++) {
    const row = Math.floor(k / cols), col = k % cols;
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const rowWidth = inRow * tile.w + (inRow - 1) * gap;
    // the last, shorter row is centred
    const x = -rowWidth / 2 + tile.w / 2 + col * (tile.w + gap);
    const z = -depth / 2 + tile.d / 2 + row * (tile.d + gap);
    // tilted up to the reader; the low edge clears the floor
    const y = tile.t / 2 + Math.sin((18 * Math.PI) / 180) * tile.d * 0.5 + 0.03;
    slots.push({ x: center[0] + x, y: center[1] + y, z: center[2] + z, t: tile.t, h: tile.d, l: tile.w, quat: flat, ...fit(tile.t, tile.d, tile.w, 0.08), key: row * 100 + col });
  }
  return assign(slots, ids, (id) => id.order);
}

/** spans [x0, x1] where the horizontal line y crosses the mark's left polygon (or its mirror) */
function crossings(poly: readonly number[], y: number, mirrored: boolean) {
  const xs: number[] = [];
  const m = poly.length / 2;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    let x0 = poly[i * 2], x1 = poly[j * 2];
    const y0 = poly[i * 2 + 1], y1 = poly[j * 2 + 1];
    if (mirrored) { x0 = 1000 - x0; x1 = 1000 - x1; }
    if (y0 === y1 || y < Math.min(y0, y1) || y >= Math.max(y0, y1)) continue;
    xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
  }
  xs.sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) runs.push([xs[k], xs[k + 1]]);
  return runs;
}

function markRows(rows: number, ad: ArtDirection) {
  const { minY, maxY } = MARK_BOUNDS;
  const scale = ad.mark.height / (maxY - minY);
  const step = (maxY - minY) / rows;
  return Array.from({ length: rows }, (_, row) => {
    const y = minY + (row + 0.5) * step;
    const runs = [...crossings(MARK_LEFT_POLYGON, y, false), ...crossings(MARK_LEFT_POLYGON, y, true)]
      .filter(([a, b]) => (b - a) * scale >= ad.mark.minLength)
      .sort((a, b) => a[0] - b[0]);
    return { row, y, runs };
  });
}

/** 07 · Start here: the RUKAZ mark, built from horizontal glass bars, split by its channel. */
export function mark(ids: Identity[], ad: ArtDirection = AD) {
  const n = ids.length;
  const { minY, maxY } = MARK_BOUNDS;
  const M = ad.mark;
  const scale = M.height / (maxY - minY);
  let rows = 4;
  for (let r = 4; r < 90; r++) {
    if (markRows(r, ad).reduce((a, row) => a + row.runs.length, 0) > n) break;
    rows = r;
  }
  const bars = markRows(rows, ad).flatMap((row) => row.runs.map(([a, b]) => ({ row: row.row, y: row.y, a, b })));
  const cut = 0.05 / scale;
  while (bars.length < n) {
    // split the longest bar in two until every plate has a place
    let longest = 0;
    for (let k = 1; k < bars.length; k++) if (bars[k].b - bars[k].a > bars[longest].b - bars[longest].a) longest = k;
    const bar = bars[longest];
    const mid = (bar.a + bar.b) / 2;
    bars.splice(longest, 1, { ...bar, b: mid - cut / 2 }, { ...bar, a: mid + cut / 2 });
  }
  const h = ((maxY - minY) / rows) * scale * M.fill;
  const q = basis(new Vector3(0, 0, 1), UP, new Vector3(-1, 0, 0));
  const slots: Slot[] = bars.map((bar) => {
    const l = (bar.b - bar.a) * scale;
    return { x: M.center[0] + ((bar.a + bar.b) / 2 - 500) * scale, y: M.center[1] + M.base + (maxY - bar.y) * scale, z: M.center[2], t: M.depth, h, l, quat: q,
      R: Math.min(0.12, h / 2, l / 2), r: Math.min(0.03, M.depth * 0.4, h * 0.3), key: bar.row * 100 + bar.a / 10 };
  });
  return assign(slots, ids, (id) => id.order);
}
