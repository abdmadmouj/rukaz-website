import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artDirection as AD } from '../src/config/artDirection';
import { blend, buildStops, swapHelps, swapSlots } from '../src/scene/choreography';
import { boxContact, PlateWorld, type Quat, type Vec3 } from '../src/scene/physics/plateWorld';
import { poseBuffer, STRIDE } from '../src/scene/poses';

/**
 * The real thing: every transition on the page, scrolled through in 2.5 seconds, run through
 * the same physics as the site. Plates must never visibly pass through each other, and every
 * form must finish.
 */
const fresh = () => buildStops('wide', 'ltr');
const { identities, count } = fresh();
let stops = fresh().stops;

function run(from: number, to: number) {
  stops = fresh().stops;
  const w = new PlateWorld(count, { ...AD.physics, maxSpeed: 20 });
  identities.forEach((id) => w.setMass(id.index, AD.mass[id.mat]));
  const A = stops[from].poses, B = stops[to].poses, base = poseBuffer(count);
  for (let i = 0; i < count; i++) {
    const o = i * STRIDE;
    w.place(i, [A[o], A[o + 1], A[o + 2]], [A[o + 3], A[o + 4], A[o + 5], A[o + 6]], [A[o + 7], A[o + 8], A[o + 9]]);
  }
  const P = (i: number): Vec3 => [w.pos[i * 3], w.pos[i * 3 + 1], w.pos[i * 3 + 2]];
  const Q = (i: number): Quat => [w.quat[i * 4], w.quat[i * 4 + 1], w.quat[i * 4 + 2], w.quat[i * 4 + 3]];
  const H = (i: number): Vec3 => [w.half[i * 3], w.half[i * 3 + 1], w.half[i * 3 + 2]];
  let stage = 0, worst = 0, deep = 0, settledAt = -1, slip = 0;
  for (let f = 0; f < 60 * 18; f++) {
    stage = Math.min(1, stage + 1 / (60 * 2.5));
    blend(A, B, stage, identities, base, stops[to].arrival, stops[to].approach);
    for (let i = 0; i < count; i++) {
      const o = i * STRIDE;
      w.setTarget(i, [base[o], base[o + 1], base[o + 2]], [base[o + 3], base[o + 4], base[o + 5], base[o + 6]], [base[o + 7], base[o + 8], base[o + 9]]);
    }
    w.step(AD.physicsSpeed / 60);
    for (const [a, b] of w.takeJams()) if (stage >= 1 && swapHelps(stops[to], a, b, w.pos)) { swapSlots(stops[to], a, b); w.unstick(a); w.unstick(b); }
    let fw = 0;
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const c = boxContact(P(i), Q(i), H(i), P(j), Q(j), H(j));
      if (!c) continue;
      // a jammed plate shrunk to a small shard may slip its last few centimetres into place
      if (w.slipping(i) || w.slipping(j)) { slip = Math.max(slip, c.depth); continue; }
      if (c.depth > fw) fw = c.depth;
    }
    worst = Math.max(worst, fw);
    if (fw > 0.04) deep++;
    if (settledAt < 0 && stage >= 1 && w.sleeping) settledAt = f / 60;
  }
  return { worst, deep, settledAt, slip };
}

for (let k = 1; k < stops.length; k++) {
  test(`${stops[k - 1].name} to ${stops[k].name}: plates collide, never pass through, and the form finishes`, () => {
    const r = run(k - 1, k);
    // plates are 9 to 30 cm thick: 4 cm for a frame or two while a crowd sorts itself out is the most allowed
    assert.ok(r.deep <= 3, `${r.deep} frames with more than 4 cm of overlap (worst ${(r.worst * 100).toFixed(1)} cm)`);
    console.log(`  ${stops[k - 1].name}->${stops[k].name}: settled ${r.settledAt.toFixed(1)} s, worst ${(r.worst * 100).toFixed(1)} cm, slip ${(r.slip * 100).toFixed(1)} cm`);
    assert.ok(r.settledAt > 0 && r.settledAt <= 16, `settled at ${r.settledAt} s`);
    // a shard is an eighth of a plate: a few centimetres of its edge for a moment at the very end
    assert.ok(r.slip < 0.08, `a shard slipped ${(r.slip * 100).toFixed(1)} cm`);
  });
}
