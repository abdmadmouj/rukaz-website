import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { buildStops, fitCamera, STOPS } from '../src/scene/choreography';
import * as L from '../src/scene/layouts';
import { overlappingSlots, type Quat, type Vec3 } from '../src/scene/physics/plateWorld';
import { STRIDE } from '../src/scene/poses';

const slotsOf = (b: Float32Array, n: number) => Array.from({ length: n }, (_, i) => {
  const o = i * STRIDE;
  return { p: [b[o], b[o + 1], b[o + 2]] as Vec3, q: [b[o + 3], b[o + 4], b[o + 5], b[o + 6]] as Quat, half: [b[o + 7], b[o + 8], b[o + 9]] as Vec3 };
});

test('every resting form gives each plate its own space (no two slots overlap)', () => {
  for (const dir of ['ltr', 'rtl'] as const) {
    const { stops, count } = buildStops('wide', dir);
    assert.equal(stops.length, STOPS.length);
    for (const s of stops) assert.deepEqual(overlappingSlots(slotsOf(s.poses, count)), [], `${s.name} (${dir})`);
  }
});

test('the three rings are gone; the forms are the new storyboard', () => {
  assert.deepEqual([...STOPS], ['hero', 'who', 'ways', 'discover', 'validate', 'build', 'scale', 'proof', 'terms', 'contact', 'connect']);
  assert.equal((L as Record<string, unknown>).rings, undefined);
});

test('every form uses all 93 plates and keeps them on or above the floor', () => {
  const { stops, count } = buildStops('wide', 'ltr');
  assert.equal(count, 93);
  for (const s of stops) for (let i = 0; i < count; i++) assert.ok(s.poses[i * STRIDE + 1] > 0, `${s.name} plate ${i}`);
});

test('the active gate lights up and the stream reaches it', () => {
  const { identities } = L.ribbon();
  const lit = (b: Float32Array) => Array.from({ length: 93 }, (_, i) => b[i * STRIDE + 13]).filter((v) => v === 1).length;
  for (let g = 0; g < 4; g++) assert.equal(lit(L.gates(identities, g)), 9, `gate ${g}: two posts and a lintel`);
});

test('automatic framing: centred in the upper half, filling it', () => {
  const { stops } = buildStops('wide', 'ltr');
  for (const s of stops.filter((x) => x.frame)) {
    const cam = fitCamera(s.frame!, 'wide', 'ltr', 1440, 900);
    const d = new Vector3(...cam.pos).distanceTo(new Vector3(...cam.target));
    assert.ok(d > 1 && d < 80, `${s.name} distance ${d}`);
    // the form is centred left to right and sits in the upper half (the words go below it)
    assert.ok(Math.abs(cam.shift[0]) < 0.06, `${s.name} centred (${cam.shift})`);
    assert.ok(cam.shift[1] < -0.05, `${s.name} raised into the upper half (${cam.shift})`);
  }
});
