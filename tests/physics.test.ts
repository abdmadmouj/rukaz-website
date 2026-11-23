import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boxContact, overlappingSlots, PlateWorld, type Quat, type Vec3 } from '../src/scene/physics/plateWorld';

const I: Quat = [0, 0, 0, 1];
const plate: Vec3 = [0.03, 0.5, 0.35]; // thin slab, like a hero plate

test('box contact: touching slabs overlap, separated slabs do not', () => {
  assert.ok(boxContact([0, 0, 0], I, plate, [0.05, 0, 0], I, plate), 'overlapping');
  assert.equal(boxContact([0, 0, 0], I, plate, [0.07, 0, 0], I, plate), null, 'apart');
  const rot45: Quat = [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)];
  const hit = boxContact([0, 0, 0], I, plate, [0.2, 0, 0], rot45, plate);
  assert.ok(hit && hit.depth > 0, 'a turned slab reaching over is detected');
});

/** deepest overlap between any two plates right now */
function worstOverlap(w: PlateWorld) {
  let worst = 0;
  for (let i = 0; i < w.n; i++)
    for (let j = i + 1; j < w.n; j++) {
      const p = (k: number): Vec3 => [w.pos[k * 3], w.pos[k * 3 + 1], w.pos[k * 3 + 2]];
      const q = (k: number): Quat => [w.quat[k * 4], w.quat[k * 4 + 1], w.quat[k * 4 + 2], w.quat[k * 4 + 3]];
      const h = (k: number): Vec3 => [w.half[k * 3], w.half[k * 3 + 1], w.half[k * 3 + 2]];
      const hit = boxContact(p(i), q(i), h(i), p(j), q(j), h(j));
      if (hit) worst = Math.max(worst, hit.depth);
    }
  return worst;
}

test('two rows crossing through each other collide and slip past instead of merging', () => {
  // row A walks forward through row B, which walks back: every plate meets another head on
  const n = 16;
  const w = new PlateWorld(n);
  for (let i = 0; i < 8; i++) {
    w.place(i, [i * 0.18, 0, -0.9], I, plate);
    w.place(8 + i, [i * 0.18 + 0.02, 0, 0.9], I, plate);
  }
  for (let i = 0; i < 8; i++) {
    w.setTarget(i, [i * 0.18, 0, 0.9], I);
    w.setTarget(8 + i, [i * 0.18 + 0.02, 0, -0.9], I);
  }
  let worst = 0, contacts = 0;
  for (let f = 0; f < 60 * 8; f++) {
    contacts += w.step(1 / 60).length;
    worst = Math.max(worst, worstOverlap(w));
  }
  assert.ok(worst < 0.012, `deepest overlap ${worst.toFixed(4)} m`);
  assert.ok(contacts > 0, 'contacts were reported for sound');
  for (let i = 0; i < n; i++) assert.ok(Math.abs(w.pos[i * 3 + 2] - w.targetPos[i * 3 + 2]) < 0.02, `plate ${i} arrived`);
});

test('plates reach free targets and go to sleep', () => {
  const w = new PlateWorld(6);
  for (let i = 0; i < 6; i++) w.place(i, [i * 0.2, 0, 0], I, plate);
  for (let i = 0; i < 6; i++) w.setTarget(i, [i * 0.2, 1, 0.5], [0, Math.sin(0.4), 0, Math.cos(0.4)]);
  for (let f = 0; f < 60 * 6; f++) w.step(1 / 60);
  for (let i = 0; i < 6; i++) assert.ok(Math.abs(w.pos[i * 3 + 1] - 1) < 0.02, `plate ${i} y ${w.pos[i * 3 + 1]}`);
  assert.ok(w.sleeping, 'settled plates sleep, so rendering can stop');
});

test('a plate shrinks at once but grows only as it reaches its slot', () => {
  const w = new PlateWorld(1);
  w.place(0, [0, 0, 0], I, plate);
  w.setTarget(0, [3, 0, 0], I, [0.02, 0.6, 0.2]);
  w.step(1 / 60);
  const h = [...w.half].map((v) => +v.toFixed(3));
  assert.deepEqual([h[0], h[2]], [0.02, 0.2], 'thinner and shorter at once');
  assert.equal(h[1], plate[1], 'not taller while in flight');
  for (let f = 0; f < 60 * 5; f++) w.step(1 / 60);
  assert.deepEqual([...w.half].map((v) => +v.toFixed(3)), [0.02, 0.6, 0.2], 'full size on arrival');
});

test('overlap check flags slots that would fuse', () => {
  const ok = [0, 1, 2].map((i) => ({ p: [i * 0.1, 0, 0] as Vec3, q: I, half: plate }));
  assert.deepEqual(overlappingSlots(ok), []);
  const bad = [...ok, { p: [0.12, 0, 0] as Vec3, q: I, half: plate }];
  assert.ok(overlappingSlots(bad).length > 0);
});
