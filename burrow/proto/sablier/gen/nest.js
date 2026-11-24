// Le terrier prêt pour le GPU (dans le worker) : deux textures 3D en
// demi-flottants et un maillage d'ombre.
//   A = (distance signée, fraction de remplissage, fraction de vidange, front de prise)
//   B = (distance au filet, début du filet, fin du filet, —)
// Les fractions sont celles du volume versé : le métal occupe un voxel quand
// la fraction versée F dépasse sa fraction de remplissage (jour 1) ; il le
// quitte quand la fraction vidée D dépasse sa fraction de vidange (jour 2).
// Les poches d'air ont un remplissage de 4 (jamais) et une vidange de −1.
// Ces valeurs sont recopiées dans la bande de gel autour du vide (trois
// couches), pour que l'interpolation trilinéaire reste juste près des parois.
import { burrowPrims } from './burrows.js';
import { field, simulate, gridOf, VOXEL } from './fill.js';
import { surfaceNets } from './nets.js';

const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
export function half(v) {
  _f[0] = v; const x = _u[0];
  const sgn = (x >> 16) & 0x8000, e = ((x >> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return sgn;
  if (e >= 31) return sgn | 0x7c00;
  return (sgn | (e << 10) | (m >> 13)) + ((m >> 12) & 1);
}

export function buildNest({ family, params, seed, voxel = VOXEL }) {
  const t0 = Date.now();
  const prims = burrowPrims(family, params, seed);
  const F = field(prims, gridOf(voxel));
  const S = simulate(F);
  const { f, n, h } = F, [nx, ny, nz] = n, N = nx * ny * nz;
  const total = S.total;

  // valeurs par voxel du vide
  const fill = new Float32Array(N).fill(4), drain = new Float32Array(N).fill(-1), frz = new Float32Array(N);
  const sd = new Float32Array(N).fill(1), ws = new Float32Array(N).fill(2), we = new Float32Array(N).fill(2);
  const known = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!S.isVoid[i]) continue;
    known[i] = 1;
    if (S.filled[i]) { fill[i] = (S.order[i] + 0.5) / total; drain[i] = (S.drain[i] + 0.5) / total; frz[i] = S.geo[i] / S.geoMax; }
  }
  // le filet : distance à ses voxels (jusqu'à 3 voxels), et son intervalle
  {
    let front = [];
    const dist = new Float32Array(N).fill(1e9), src = new Int32Array(N).fill(-1);
    for (const [id, a] of S.wetA) {
      const b = Math.min(S.wetB.get(id), S.order[id]);
      if (!(b > a + 2)) continue; // (un filet aussitôt noyé ne se voit pas)
      dist[id] = 0; src[id] = id; front.push(id);
      ws[id] = a / total; we[id] = Number.isFinite(b) ? b / total : 2;
    }
    for (let layer = 0; layer < 3; layer++) {
      const next = [];
      for (const id of front) {
        const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny));
        for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj, c = k + dk;
          if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
          const q = a + nx * (b + ny * c), s = src[id];
          const si = s % nx, sj = Math.floor(s / nx) % ny, sk = Math.floor(s / (nx * ny));
          const d = Math.hypot(a - si, b - sj, c - sk) * h;
          if (d < dist[q]) { dist[q] = d; src[q] = s; ws[q] = ws[s]; we[q] = we[s]; next.push(q); }
        }
      }
      front = next;
    }
    for (let i = 0; i < N; i++) sd[i] = Math.min(1, dist[i]);
  }
  // recopie dans la bande de gel (3 couches) : la valeur du voisin connu
  for (let layer = 0; layer < 3; layer++) {
    const add = [];
    for (let id = 0; id < N; id++) {
      if (known[id]) continue;
      const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny));
      let best = -1, bd = 9;
      for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj, c = k + dk;
        if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
        const q = a + nx * (b + ny * c);
        if (known[q] === 1 && Math.abs(di) + Math.abs(dj) + Math.abs(dk) < bd) { bd = Math.abs(di) + Math.abs(dj) + Math.abs(dk); best = q; }
      }
      if (best >= 0) add.push(id, best);
    }
    for (let a = 0; a < add.length; a += 2) { const id = add[a], q = add[a + 1]; fill[id] = fill[q]; drain[id] = drain[q]; frz[id] = frz[q]; known[id] = 2; }
    for (let a = 0; a < add.length; a += 2) known[add[a]] = 1;
  }
  const A = new Uint16Array(N * 4), B = new Uint16Array(N * 4);
  for (let i = 0; i < N; i++) {
    A[i * 4] = half(f[i]); A[i * 4 + 1] = half(fill[i]); A[i * 4 + 2] = half(drain[i]); A[i * 4 + 3] = half(frz[i]);
    B[i * 4] = half(sd[i]); B[i * 4 + 1] = half(ws[i]); B[i * 4 + 2] = half(we[i]); B[i * 4 + 3] = 0;
  }
  // boîte du vide (pour borner la marche) et volume
  const lo = [9, 9, 9], hi = [-9, -9, -9];
  for (let id = 0; id < N; id++) {
    if (!S.isVoid[id]) continue;
    const p = [F.min[0] + (id % nx) * h, F.min[1] + (Math.floor(id / nx) % ny) * h, F.min[2] + Math.floor(id / (nx * ny)) * h];
    for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], p[c]); hi[c] = Math.max(hi[c], p[c]); }
  }
  // maillage d'ombre (le vide entier ; le masque d'ombre n'en garde que le métal)
  const mesh = surfaceNets({ f, n, min: F.min, h });
  // vue de face pour l'écran de chargement : ordre de remplissage du premier vide
  const view = new Float32Array(nx * ny).fill(-1);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) { const id = i + nx * (j + ny * k); if (S.isVoid[id]) { view[i + nx * j] = S.filled[id] ? fill[id] : 3; break; } }
  }
  return {
    A, B, n, min: F.min, h, total, volume: total * h ** 3, voidVolume: S.nVoid * h ** 3,
    bounds: [lo[0] - 2 * h, lo[1] - 2 * h, lo[2] - 2 * h, hi[0] + 2 * h, hi[1] + 2 * h, hi[2] + 2 * h],
    spills: S.events.length, freezeLen: S.geoMax,
    shadow: { position: mesh.position, index: mesh.index },
    view, ms: Date.now() - t0,
  };
}
