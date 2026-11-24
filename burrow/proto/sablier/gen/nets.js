// Surface nets (Gibson 1998) d'un champ de distance sur une grille : sommet au
// barycentre des passages par zéro de chaque cellule, deux passes de lissage.
// (Repris de melt/src/objects.js.)
export function surfaceNets({ f, n, min, h }) {
  const [nx, ny, nz] = n, at = (i, j, k) => f[i + nx * (j + ny * k)];
  const vid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1), pos = [], idx = [];
  const cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const C = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { v[c] = at(i + C[c][0], j + C[c][1], k + C[c][2]); if (v[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, m = 0;
    for (const [a, b] of E) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += C[a][0] + (C[b][0] - C[a][0]) * t; sy += C[a][1] + (C[b][1] - C[a][1]) * t; sz += C[a][2] + (C[b][2] - C[a][2]) * t; m++;
    }
    vid[cid(i, j, k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / m) * h, min[1] + (j + sy / m) * h, min[2] + (k + sz / m) * h);
  }
  // une face par arête traversée, entre les quatre cellules qui la partagent
  const D = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const f0 = at(i, j, k);
    for (let a = 0; a < 3; a++) {
      const f1 = at(i + D[a][0], j + D[a][1], k + D[a][2]);
      if ((f0 < 0) === (f1 < 0)) continue;
      const u = D[(a + 1) % 3], w = D[(a + 2) % 3];
      const q = [vid[cid(i - u[0] - w[0], j - u[1] - w[1], k - u[2] - w[2])], vid[cid(i - w[0], j - w[1], k - w[2])], vid[cid(i, j, k)], vid[cid(i - u[0], j - u[1], k - u[2])]];
      if (q.some((x) => x < 0)) continue;
      if (f0 < 0) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); else idx.push(q[0], q[2], q[1], q[0], q[3], q[2]);
    }
  }
  // lissage (deux passes de moyenne avec les voisins) : la grille ne se lit plus sur les bords
  const P = new Float32Array(pos), nv = P.length / 3, nb = Array.from({ length: nv }, () => new Set());
  for (let i = 0; i < idx.length; i += 3) for (let e = 0; e < 3; e++) { nb[idx[i + e]].add(idx[i + (e + 1) % 3]); nb[idx[i + e]].add(idx[i + (e + 2) % 3]); }
  for (let it = 0; it < 2; it++) {
    const Q = new Float32Array(P);
    for (let v = 0; v < nv; v++) {
      let x = 0, y = 0, z = 0, m = 0;
      for (const w of nb[v]) { x += P[w * 3]; y += P[w * 3 + 1]; z += P[w * 3 + 2]; m++; }
      if (m) { Q[v * 3] += (x / m - P[v * 3]) * 0.5; Q[v * 3 + 1] += (y / m - P[v * 3 + 1]) * 0.5; Q[v * 3 + 2] += (z / m - P[v * 3 + 2]) * 0.5; }
    }
    P.set(Q);
  }
  return { position: P, index: new Uint32Array(idx) };
}
