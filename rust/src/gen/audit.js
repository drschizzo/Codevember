// Cohérence d'une pièce : chaque élément (composante connexe du maillage après
// soudure des sommets) doit toucher, de proche en proche, le sol (y = 0) —
// sinon il flotte. Échantillonnage de surface à pas fixe ; deux éléments se
// touchent s'ils ont des points à moins de `tol`. Renvoie les groupes
// flottants (liste d'éléments avec leur boîte).
export function floatingGroups(meshes, tol = 0.0025) {
// composantes : soudure des positions puis union des triangles
  const comps = []; // { name, tris: [], pts: [] }
  for (const [name, M] of meshes) {
    const pos = M.position, idx = M.index, n = pos.length / 3;
    const key = new Map(), id = new Int32Array(n);
    for (let i = 0; i < n; i++) { const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`; if (!key.has(k)) key.set(k, key.size); id[i] = key.get(k); }
    const par = Int32Array.from({ length: key.size }, (_, i) => i);
    const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let t = 0; t < idx.length; t += 3) { const a = f(id[idx[t]]), b = f(id[idx[t + 1]]), c = f(id[idx[t + 2]]); par[b] = a; par[f(c)] = a; }
    const map = new Map();
    for (let t = 0; t < idx.length; t += 3) { const r = f(id[idx[t]]); if (!map.has(r)) { map.set(r, comps.length); comps.push({ name, tris: [], M }); } comps[map.get(r)].tris.push(t); }
  }
  // échantillons
  const h = 0.0025, cell = tol * 2, grid = new Map();
  let seedN = 1; const rnd = () => ((seedN = (seedN * 16807) % 2147483647) / 2147483647);
  comps.forEach((C, ci) => {
    const pos = C.M.position, idx = C.M.index; C.lo = [1e9, 1e9, 1e9]; C.hi = [-1e9, -1e9, -1e9]; C.n = 0;
    for (const t of C.tris) {
      const A = idx[t] * 3, B = idx[t + 1] * 3, D = idx[t + 2] * 3;
      const u = [0, 1, 2].map((k) => pos[B + k] - pos[A + k]), v = [0, 1, 2].map((k) => pos[D + k] - pos[A + k]);
      const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const area = 0.5 * Math.hypot(...cr); let m = Math.max(3, Math.ceil(area / (h * h)));
      for (let s = 0; s < m; s++) {
        let a = rnd(), b = rnd(); if (a + b > 1) { a = 1 - a; b = 1 - b; }
        const p = [0, 1, 2].map((k) => pos[A + k] + u[k] * a + v[k] * b);
        for (let k = 0; k < 3; k++) { C.lo[k] = Math.min(C.lo[k], p[k]); C.hi[k] = Math.max(C.hi[k], p[k]); }
        const g = p.map((x) => Math.floor(x / cell)).join(',');
        if (!grid.has(g)) grid.set(g, []); grid.get(g).push([p[0], p[1], p[2], ci]);
        C.n++;
      }
    }
  });
  // contacts
  const par = Int32Array.from({ length: comps.length + 1 }, (_, i) => i), GROUND = comps.length;
  const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const join = (a, b) => { par[f(a)] = f(b); };
  for (const [g, list] of grid) {
    const [gx, gy, gz] = g.split(',').map(Number);
    for (const p of list) {
      if (p[1] < 0.0015) join(p[3], GROUND);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const L2 = grid.get(`${gx + dx},${gy + dy},${gz + dz}`); if (!L2) continue;
        for (const q of L2) if (q[3] !== p[3] && f(q[3]) !== f(p[3]) && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < tol) join(p[3], q[3]);
      }
    }
  }
  
  const bad = new Map();
  comps.forEach((C, i) => { if (f(i) !== f(GROUND)) { const r = f(i); if (!bad.has(r)) bad.set(r, []); bad.get(r).push(C); } });
  return { count: comps.length, groups: [...bad.values()].map((list) => ({ n: list.length, name: list[0].name, lo: [0, 1, 2].map((k) => Math.min(...list.map((c) => c.lo[k]))), hi: [0, 1, 2].map((k) => Math.max(...list.map((c) => c.hi[k]))) })) };
}
