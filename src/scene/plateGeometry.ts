import { Box3, BufferAttribute, BufferGeometry, Sphere, Uint32BufferAttribute, Vector3 } from 'three';

/**
 * One rounded slab, shared by every plate. The vertex shader rebuilds it per instance
 * from its half size (aHalf) and radii (aShape), so a single geometry serves every plate
 * and sizes can animate without new buffers.
 *
 *   aSgn  which corner region a vertex belongs to (±1 per axis)
 *   aU    direction around the face corner (cos, sin)
 *   aBev  position around the edge bevel (cos, sin)
 */
export function plateGeometry(cornerSegments = 8, bevelSegments = 4) {
  const cs = cornerSegments, bs = bevelSegments;
  const ring = 4 * (cs + 1);
  const sgn: number[] = [], u: number[] = [], bev: number[] = [], pos: number[] = [];
  const corners: [number, number, number][] = [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, (3 * Math.PI) / 2]];
  const at = (side: number, b: number) => side * (bs + 1) * ring + b * ring;
  for (const side of [0, 1]) {
    const sx = side === 0 ? 1 : -1;
    for (let b = 0; b <= bs; b++) {
      const t = (b / bs) * (Math.PI / 2);
      const cb = Math.cos(t), sb = Math.sin(t);
      for (const [cy, cz, a0] of corners) {
        for (let k = 0; k <= cs; k++) {
          const a = a0 + (k / cs) * (Math.PI / 2);
          const ca = Math.cos(a), sa = Math.sin(a);
          sgn.push(sx, cy, cz);
          u.push(ca, sa);
          bev.push(cb, sb);
          pos.push(sx * cb * 0.5, ca * sb * 0.5 + cy * 0.25, sa * sb * 0.5 + cz * 0.25);
        }
      }
    }
  }
  const centers = [sgn.length / 3, sgn.length / 3 + 1];
  for (const sx of [1, -1]) {
    sgn.push(sx, 0, 0);
    u.push(0, 0);
    bev.push(1, 0);
    pos.push(sx * 0.5, 0, 0);
  }
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
  for (const side of [0, 1]) {
    const base = at(side, 0);
    for (let k = 0; k < ring; k++) idx.push(centers[side], base + k, base + ((k + 1) % ring));
    for (let b = 0; b < bs; b++) {
      const r0 = at(side, b), r1 = at(side, b + 1);
      for (let k = 0; k < ring; k++) {
        const k1 = (k + 1) % ring;
        quad(r0 + k, r1 + k, r1 + k1, r0 + k1);
      }
    }
  }
  const e0 = at(0, bs), e1 = at(1, bs);
  for (let k = 0; k < ring; k++) {
    const k1 = (k + 1) % ring;
    quad(e0 + k, e1 + k, e1 + k1, e0 + k1);
  }
  // orient every triangle outward, using a representative slab and its analytic normals
  const rep = (i: number) => new Vector3(
    sgn[i * 3] * (0.2 - 0.06 + bev[i * 2] * 0.06),
    sgn[i * 3 + 1] * (0.6 - 0.25) + u[i * 2] * (0.25 - 0.06 + bev[i * 2 + 1] * 0.06),
    sgn[i * 3 + 2] * (1 - 0.25) + u[i * 2 + 1] * (0.25 - 0.06 + bev[i * 2 + 1] * 0.06),
  );
  const nrm = (i: number) => new Vector3(sgn[i * 3] * bev[i * 2], u[i * 2] * bev[i * 2 + 1], u[i * 2 + 1] * bev[i * 2 + 1]).normalize();
  const e1v = new Vector3(), e2v = new Vector3(), cr = new Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const a = rep(idx[t]), b = rep(idx[t + 1]), c = rep(idx[t + 2]);
    e1v.subVectors(b, a);
    e2v.subVectors(c, a);
    cr.crossVectors(e1v, e2v);
    const n = nrm(idx[t]).add(nrm(idx[t + 1])).add(nrm(idx[t + 2]));
    if (cr.dot(n) < 0) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aSgn', new BufferAttribute(new Float32Array(sgn), 3));
  g.setAttribute('aU', new BufferAttribute(new Float32Array(u), 2));
  g.setAttribute('aBev', new BufferAttribute(new Float32Array(bev), 2));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  // instances are sized in the shader, so bounds are generous and culling is off
  g.boundingBox = new Box3(new Vector3(-4, -4, -4), new Vector3(4, 4, 4));
  g.boundingSphere = new Sphere(new Vector3(), 7);
  return g;
}
