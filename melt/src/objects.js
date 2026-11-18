// Les objets de cire : des figurines faites d'ellipsoïdes fondus (repère objet,
// y vers le haut, en cellules de la grille de simulation ; l'origine est le
// centre du dessous, posé sur l'assiette du plateau). Module pur : la recette,
// la scène et les tests le lisent.
//
// Tous les objets d'une usine ont le même volume (c'est la même cire, fondue et
// remoulée) : `shapeOf` ramène chaque figurine au volume commun VOLUME.
const rot = (az, ax) => {
  const cz = Math.cos(az), sz = Math.sin(az), cx = Math.cos(ax), sx = Math.sin(ax);
  const R = [[cz, -sz, 0], [cx * sz, cx * cz, -sx], [sx * sz, sx * cz, cx]]; // Rx · Rz
  return [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]]; // (transposée : monde → local)
};
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const E = (c, r, R = I3) => ({ c, r, R });

export const OBJECTS = {
  lapin: { label: 'Lapin', prims: [
    E([0, 10.5, -2.5], [11.5, 10, 11.5]), E([0, 17, 0], [9.5, 12.5, 9]), E([0, 33.5, 3], [7.6, 7.2, 8.2]), E([0, 31.5, 10], [4, 3.3, 3.6]),
    E([-3.6, 47.5, 0.5], [2.6, 10.5, 2.1], rot(0.14, -0.1)), E([3.6, 47.5, 0.5], [2.6, 10.5, 2.1], rot(-0.14, -0.1)),
    E([-4.6, 6, 8.6], [3.1, 5.5, 3.6]), E([4.6, 6, 8.6], [3.1, 5.5, 3.6]), E([-8.5, 3.6, 3], [4, 3.4, 7]), E([8.5, 3.6, 3], [4, 3.4, 7]),
    E([0, 8.5, -13.2], [4.2, 4.2, 4.2]),
  ] },
  canard: { label: 'Canard', prims: [
    E([0, 13.5, -1], [11.5, 10.5, 15]), E([0, 15, 6], [9.5, 9.5, 9]), E([0, 32, 7.5], [8.2, 7.8, 8.4]), E([0, 24, 6.5], [5.5, 6, 5.5]),
    E([0, 30.2, 16], [4.6, 1.9, 4.2], rot(0, 0.12)), E([0, 19, -15], [5, 4.2, 6.5], rot(0, 0.6)),
    E([-10.6, 14.5, -2.5], [2.6, 6.5, 10], rot(0.12, 0.15)), E([10.6, 14.5, -2.5], [2.6, 6.5, 10], rot(-0.12, 0.15)),
  ] },
  ourson: { label: 'Ourson', prims: [
    E([0, 15, 0], [10.5, 12.5, 9.5]), E([0, 34, 1], [8.6, 8, 8.2]), E([0, 32, 8], [4.2, 3.4, 3.4]),
    E([-6.8, 41.5, 0], [3.4, 3.4, 2.2]), E([6.8, 41.5, 0], [3.4, 3.4, 2.2]),
    E([-11.5, 20, 2], [3.4, 8.5, 3.6], rot(0.45, 0)), E([11.5, 20, 2], [3.4, 8.5, 3.6], rot(-0.45, 0)),
    E([-6.5, 4.5, 6.5], [4.4, 4.2, 8]), E([6.5, 4.5, 6.5], [4.4, 4.2, 8]),
  ] },
  chouette: { label: 'Chouette', prims: [
    E([0, 17, 0], [11.5, 16, 10]), E([0, 34, 0.5], [10.5, 9, 9.2]),
    E([-6.5, 43.5, 0], [2.4, 4.6, 2.2], rot(0.35, 0)), E([6.5, 43.5, 0], [2.4, 4.6, 2.2], rot(-0.35, 0)),
    E([-4.4, 35.5, 8.2], [3.6, 3.6, 1.6]), E([4.4, 35.5, 8.2], [3.6, 3.6, 1.6]), E([0, 31.5, 9.4], [1.6, 2.4, 1.8]),
    E([-11.2, 17, -1], [2.6, 12, 7.5], rot(-0.1, 0)), E([11.2, 17, -1], [2.6, 12, 7.5], rot(0.1, 0)),
  ] },
  quille: { label: 'Quille', prims: [
    E([0, 13, 0], [10.5, 14, 10.5]), E([0, 27, 0], [6.2, 9, 6.2]), E([0, 38, 0], [4.4, 6, 4.4]), E([0, 46.5, 0], [6.8, 6.4, 6.8]), E([0, 53.5, 0], [2.4, 2.2, 2.4]),
  ] },
};

const KS = 2.6;
// distance signée approchée d'une figurine (sc : échelle), socle compris
export function sdObject(prims, sc, x, y, z) {
  x /= sc; y /= sc; z /= sc;
  let d = 1e9;
  for (const P of prims) {
    const px = x - P.c[0], py = y - P.c[1], pz = z - P.c[2], R = P.R;
    const lx = R[0][0] * px + R[0][1] * py + R[0][2] * pz, ly = R[1][0] * px + R[1][1] * py + R[1][2] * pz, lz = R[2][0] * px + R[2][1] * py + R[2][2] * pz;
    const k0 = Math.hypot(lx / P.r[0], ly / P.r[1], lz / P.r[2]), k1 = Math.hypot(lx / P.r[0] ** 2, ly / P.r[1] ** 2, lz / P.r[2] ** 2);
    const e = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...P.r);
    const h = Math.max(KS - Math.abs(d - e), 0) / KS;
    d = Math.min(d, e) - h * h * KS * 0.25;
  }
  // socle : un cylindre arrondi
  const q0 = Math.hypot(x, z) - 12 + 0.8, q1 = Math.abs(y - 1.4) - 1.4 + 0.8;
  const e = Math.min(Math.max(q0, q1), 0) + Math.hypot(Math.max(q0, 0), Math.max(q1, 0)) - 0.8;
  const h = Math.max(1.6 - Math.abs(d - e), 0) / 1.6;
  return (Math.min(d, e) - h * h * 0.4) * sc;
}

// boîte (repère objet) où tient toute figurine : celle de la texture de distance et du semis
export const BOX = { min: [-18, -1, -20], size: [36, 56, 40] };
export const VOLUME = 6400; // cellules cubes : le volume de cire d'une usine

// volume d'une figurine à l'échelle sc (comptage sur une grille d'une cellule)
export function volumeOf(prims, sc = 1) {
  let n = 0;
  for (let z = BOX.min[2] + 0.5; z < BOX.min[2] + BOX.size[2]; z++) for (let y = 0.5; y < BOX.min[1] + BOX.size[1]; y++) for (let x = BOX.min[0] + 0.5; x < BOX.min[0] + BOX.size[0]; x++) {
    if (sdObject(prims, sc, x, y, z) < 0) n++;
  }
  return n;
}
// l'échelle qui donne à la figurine le volume commun
export function scaleOf(key) {
  const P = OBJECTS[key].prims;
  let sc = Math.cbrt(VOLUME / volumeOf(P, 1));
  sc *= Math.cbrt(VOLUME / volumeOf(P, sc)); // (le socle ne suit pas tout à fait le cube : une retouche)
  return sc;
}
// semis des particules (pas h, en cellules) : positions dans le repère objet
export function seedPoints(key, sc, h = 0.5) {
  const P = OBJECTS[key].prims, out = [];
  for (let z = BOX.min[2] + h / 2; z < BOX.min[2] + BOX.size[2]; z += h) for (let y = h / 2; y < BOX.min[1] + BOX.size[1]; y += h) for (let x = BOX.min[0] + h / 2; x < BOX.min[0] + BOX.size[0]; x += h) {
    if (sdObject(P, sc, x, y, z) < 0) out.push(x, y, z);
  }
  return out;
}
// hauteur de la figurine (cellules)
export function heightOf(key, sc) {
  const P = OBJECTS[key].prims;
  for (let y = BOX.min[1] + BOX.size[1] - 0.25; y > 0; y -= 0.5) for (let z = -16; z <= 16; z += 1) for (let x = -14; x <= 14; x += 1) if (sdObject(P, sc, x, y, z) < 0) return y;
  return 0;
}

// ── Le moule : une coque à la forme de la figurine, en deux moitiés ──
// Champ (négatif dans le métal) d'une moitié (side = ±1, de part et d'autre du
// plan de joint x = 0) : la paroi suit l'objet, une bride plate borde le plan
// de joint, un canal de coulée surmonté d'un entonnoir débouche au sommet,
// dans l'axe du filet de cire. Le dessous reste ouvert : il coiffe l'assiette.
export const MOULD = { tIn: 0.25, tOut: 2.6, flange: 6.5, step: 0.7, cup: 5, rise: 9 };
export function mouldField(key, sc, side) {
  const P = OBJECTS[key].prims, M = MOULD, h = M.step;
  const Ht = heightOf(key, sc) + M.rise;
  const min = [-25, -0.6, -29], n = [Math.ceil(50 / h) + 1, Math.ceil((Ht + 2) / h) + 1, Math.ceil(58 / h) + 1];
  const f = new Float32Array(n[0] * n[1] * n[2]);
  let zBack = 0;
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    const x = min[0] + i * h, y = min[1] + j * h, z = min[2] + k * h;
    const sd = sdObject(P, sc, x, y, z), rr = Math.hypot(x, z);
    let s = Math.max(sd - M.tOut, M.tIn - sd); // paroi
    s = Math.min(s, Math.max(Math.abs(x) - 1.5, sd - M.flange, M.tIn - sd)); // bride du plan de joint
    s = Math.min(s, Math.max(rr - 5.2, M.tIn - sd, y - Ht, 8 - y)); // fût du canal de coulée
    const c = y - (Ht - M.cup);
    s = Math.min(s, Math.max(rr - (5.2 + c * 0.9), -c, y - Ht)); // entonnoir
    if (y > 6) s = Math.max(s, (2.8 + Math.max(0, c) * 0.9) - rr); // le canal lui-même
    s = Math.max(s, 0.35 - y, 0.12 - side * x); // dessous ouvert, moitié
    f[i + n[0] * (j + n[1] * k)] = s;
    if (s < 0 && z < zBack) zBack = z;
  }
  return { f, n, min, h, top: Ht, zBack };
}

// Maillage d'un champ sur grille (surface nets : un sommet par cellule traversée, placé à
// la moyenne des passages par zéro de ses arêtes). Rend { position, index }.
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
