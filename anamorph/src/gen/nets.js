// Surface nets : maillage d'une distance signée sur une grille régulière.
// Un sommet par cellule traversée (moyenne des points de passage sur ses
// arêtes, puis projeté sur la surface par deux pas de Newton), un
// quadrilatère par arête de grille traversée. Normales par le gradient de la
// distance (différences centrées) : arêtes arrondies exactes, sans facettes.
// Module pur (Node, worker).
import { Buffers, OUT } from '../../../shared/gen/mesh.js';

export function surfaceNets(sdf, lo, hi, cell, { surf = OUT, B = new Buffers(1 << 16) } = {}) {
  const nx = Math.ceil((hi[0] - lo[0]) / cell) + 1, ny = Math.ceil((hi[1] - lo[1]) / cell) + 1, nz = Math.ceil((hi[2] - lo[2]) / cell) + 1;
  const V = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    V[(k * ny + j) * nx + i] = sdf(lo[0] + i * cell, lo[1] + j * cell, lo[2] + k * cell);
  }
  const at = (i, j, k) => V[(k * ny + j) * nx + i];
  const vid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const C = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const e = cell * 0.5;
  const grad = (x, y, z) => {
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  };
  const d = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { d[c] = at(i + C[c][0], j + C[c][1], k + C[c][2]); if (d[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let px = 0, py = 0, pz = 0, n = 0;
    for (const [a, b] of E) {
      if ((d[a] < 0) === (d[b] < 0)) continue;
      const t = d[a] / (d[a] - d[b]);
      px += C[a][0] + t * (C[b][0] - C[a][0]); py += C[a][1] + t * (C[b][1] - C[a][1]); pz += C[a][2] + t * (C[b][2] - C[a][2]); n++;
    }
    let x = lo[0] + (i + px / n) * cell, y = lo[1] + (j + py / n) * cell, z = lo[2] + (k + pz / n) * cell;
    for (let it = 0; it < 2; it++) { // projection sur la surface (bornée à la cellule)
      const g = grad(x, y, z), s = Math.max(-cell, Math.min(cell, sdf(x, y, z)));
      x -= g[0] * s; y -= g[1] * s; z -= g[2] * s;
    }
    vid[cid(i, j, k)] = B.vert([x, y, z], grad(x, y, z), surf);
  }
  // un quadrilatère par arête de grille traversée (les quatre cellules qui la partagent)
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const s0 = at(i, j, k) < 0;
    if (i < nx - 1 && s0 !== (at(i + 1, j, k) < 0)) B.quad(vid[cid(i, j - 1, k - 1)], vid[cid(i, j, k - 1)], vid[cid(i, j, k)], vid[cid(i, j - 1, k)]);
    if (j < ny - 1 && s0 !== (at(i, j + 1, k) < 0)) B.quad(vid[cid(i - 1, j, k - 1)], vid[cid(i, j, k - 1)], vid[cid(i, j, k)], vid[cid(i - 1, j, k)]);
    if (k < nz - 1 && s0 !== (at(i, j, k + 1) < 0)) B.quad(vid[cid(i - 1, j - 1, k)], vid[cid(i, j - 1, k)], vid[cid(i, j, k)], vid[cid(i - 1, j, k)]);
  }
  return B;
}
