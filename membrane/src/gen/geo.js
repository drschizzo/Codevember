// Maillage de la membrane au repos : sphère géodésique de fréquence n
// (icosaèdre dont chaque face est découpée en n² triangles), légèrement
// désordonnée puis détendue. Le désordre compte : une déchirure suit les
// arêtes du maillage, et sur une grille régulière elle tracerait des
// zigzags trop réguliers (ou les grands cercles de l'icosaèdre).
//
// Pôle +z : il fait face à la caméra (c'est là que la membrane s'ouvre).

const { sqrt, PI } = Math;

export const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

function icosahedron() {
  const t = (1 + sqrt(5)) / 2;
  const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(V3.norm);
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  // (on tourne l'icosaèdre pour qu'aucun sommet ne tombe sur le pôle +z :
  // le centre de l'ouverture n'est pas un nœud de valence 5)
  const a = 0.37, b = 0.21, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const R = (p) => { const y = p[1] * ca - p[2] * sa, z = p[1] * sa + p[2] * ca; const x = p[0] * cb + z * sb; return [x, y, -p[0] * sb + z * cb]; };
  return { V: V.map(R), F };
}

// Sphère géodésique : positions (Float64Array), triangles (Uint32Array)
export function geodesic(n, rng, jitter = 0.35, relax = 3) {
  const { V, F } = icosahedron();
  const pts = [];
  const map = new Map();
  const vid = (p, key) => {
    if (key && map.has(key)) return map.get(key);
    const q = V3.norm(p), i = pts.length;
    pts.push(q);
    if (key) map.set(key, i);
    return i;
  };
  // point de barycentriques entières (i, j, k), i + j + k = n, sur la face (A, B, C) :
  // les points d'arête et de sommet sont calculés de façon canonique (même
  // résultat depuis les deux faces voisines) et partagés par une clé
  const point = (fa, i, j, k) => {
    const ids = [[fa[0], i], [fa[1], j], [fa[2], k]].filter(([, w]) => w > 0).sort((x, y) => x[0] - y[0]);
    if (ids.length === 1) return vid(V[ids[0][0]], `v${ids[0][0]}`);
    if (ids.length === 2) {
      const [[a, wa], [b]] = ids, t = 1 - wa / n;
      return vid(V3.add(V3.mul(V[a], 1 - t), V3.mul(V[b], t)), `e${a}_${b}_${wa}`);
    }
    return vid(V3.add(V3.add(V3.mul(V[fa[0]], i / n), V3.mul(V[fa[1]], j / n)), V3.mul(V[fa[2]], k / n)), null);
  };
  const tris = [];
  for (const f of F) {
    const g = [];
    for (let j = 0; j <= n; j++) { g[j] = []; for (let k = 0; k <= n - j; k++) g[j][k] = point(f, n - j - k, j, k); }
    for (let j = 0; j < n; j++) for (let k = 0; k < n - j; k++) {
      tris.push([g[j][k], g[j + 1][k], g[j][k + 1]]);
      if (j + k < n - 1) tris.push([g[j + 1][k], g[j + 1][k + 1], g[j][k + 1]]);
    }
  }
  // orientation : normale sortante
  for (const t of tris) {
    const [a, b, c] = t.map((i) => pts[i]);
    if (V3.dot(V3.cross(V3.sub(b, a), V3.sub(c, a)), a) < 0) { const x = t[1]; t[1] = t[2]; t[2] = x; }
  }
  const NV = pts.length;
  const nb = Array.from({ length: NV }, () => new Set());
  for (const [a, b, c] of tris) { nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
  // désordre tangentiel, puis détente (chaque sommet vers le barycentre de ses voisins)
  const h = (1.1 / n); // (≈ longueur d'arête)
  for (const p of pts) {
    const d = rng.dir(), dd = V3.dot(d, p);
    const t = V3.sub(d, V3.mul(p, dd));
    const q = V3.norm(V3.add(p, V3.mul(t, jitter * h * rng.next())));
    p[0] = q[0]; p[1] = q[1]; p[2] = q[2];
  }
  for (let it = 0; it < relax; it++) {
    const next = pts.map((p, i) => {
      let s = [0, 0, 0];
      for (const j of nb[i]) s = V3.add(s, pts[j]);
      s = V3.mul(s, 1 / nb[i].size);
      return V3.norm(V3.add(V3.mul(p, 0.6), V3.mul(s, 0.4)));
    });
    next.forEach((q, i) => { pts[i] = q; });
  }
  const pos = new Float64Array(NV * 3);
  pts.forEach((p, i) => pos.set(p, i * 3));
  const tri = new Uint32Array(tris.length * 3);
  tris.forEach((t, i) => tri.set(t, i * 3));
  return { pos, tri, nv: NV, nt: tris.length };
}

// Adjacence triangle–triangle par arête : pour chaque triangle, ses trois
// voisins (−1 : bord). Clé d'arête : (min, max).
export function triNeighbors(tri, nt) {
  const map = new Map(), out = new Int32Array(nt * 3).fill(-1);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const a = tri[t * 3 + e], b = tri[t * 3 + ((e + 1) % 3)];
    const k = a < b ? a * 1048576 + b : b * 1048576 + a;
    const o = map.get(k);
    if (o === undefined) map.set(k, t * 3 + e);
    else { out[t * 3 + e] = Math.floor(o / 3); out[o] = t; }
  }
  return out;
}

export { PI };
