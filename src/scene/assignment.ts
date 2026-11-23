/**
 * Which plate goes to which slot. For each transition the plates are matched to the new
 * slots so that the total squared distance travelled is as small as possible (the Hungarian
 * method). With that matching, plates moving together along straight lines never meet at the
 * same moment: their paths keep clear of each other by construction, and the physics only
 * has to settle the last centimetres.
 */
export function hungarian(cost: Float64Array, n: number): Int32Array {
  // Jonker-Volgenant style O(n^3) with potentials; rows = plates, columns = slots
  const INF = 1e18;
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1), way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(INF);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[(i0 - 1) * n + (j - 1)] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const assign = new Int32Array(n); // plate -> slot
  for (let j = 1; j <= n; j++) assign[p[j] - 1] = j - 1;
  return assign;
}

/** reorder `to` so that plate i takes the slot nearest in the optimal sense to its place in `from` */
export function matchSlots(from: Float32Array, to: Float32Array, n: number, stride: number) {
  const cost = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const dx = from[i * stride] - to[j * stride], dy = from[i * stride + 1] - to[j * stride + 1], dz = from[i * stride + 2] - to[j * stride + 2];
      cost[i * n + j] = dx * dx + dy * dy + dz * dz;
    }
  const a = hungarian(cost, n);
  const out = new Float32Array(to.length);
  for (let i = 0; i < n; i++) out.set(to.subarray(a[i] * stride, a[i] * stride + stride), i * stride);
  return out;
}
