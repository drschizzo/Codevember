// L'étage fin (scene/fine.js) recopié en JS, ligne pour ligne, pour les tests
// Node : même pose initiale (patch de Catmull-Rom), mêmes itérations de Jacobi,
// mêmes contacts. Toute retouche du WGSL se reporte ici (un test compare les
// deux dans la page, en ?debug : veil.fineCheck()).
import { plinthSDF } from './forms.js';

const crw = (t) => [(-t * t * t + 2 * t * t - t) / 2, (3 * t * t * t - 5 * t * t + 2) / 2, (-3 * t * t * t + 4 * t * t + t) / 2, (t * t * t - t * t) / 2];
const crd = (t) => [(-3 * t * t + 4 * t - 1) / 2, (9 * t * t - 10 * t) / 2, (-9 * t * t + 8 * t + 1) / 2, (3 * t * t - 2 * t) / 2];
function hash(i) {
  let x = (Math.imul(i >>> 0, 747796405) + 2891336453) >>> 0;
  x = Math.imul(((x >>> ((x >>> 28) + 4)) ^ x) >>> 0, 277803737) >>> 0;
  x = ((x >>> 22) ^ x) >>> 0;
  return x / 4294967295;
}

// coarse : Float32Array n·n·4 ; sdf : f(x, y, z, grad) cuit (forms.js bakeForm)
// ou null ; plinth : spec du socle ; P = { L, iters, adh, RA, anchor, maxN,
// bend, shear, RC, pin, seed }
export function fineSolve(coarse, n, R, sdf, plinth, P) {
  const m = (n - 1) * R + 1, M = m * m;
  const base = new Float64Array(M * 3), nrm = new Float64Array(M * 3);
  let xa = new Float64Array(M * 3), xb = new Float64Array(M * 3);
  const C = (i, j) => { const k = (Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))) * 4; return [coarse[k], coarse[k + 1], coarse[k + 2]]; };
  for (let k = 0; k < M; k++) {
    const gx = (k % m) / R, gy = Math.floor(k / m) / R;
    const fi = Math.min(Math.max(gx, 0), n - 1.0001), fj = Math.min(Math.max(gy, 0), n - 1.0001);
    const i0 = Math.floor(fi), j0 = Math.floor(fj), tu = fi - i0, tv = fj - j0;
    const wu = crw(tu), wv = crw(tv), du = crd(tu), dv = crd(tv);
    const p = [0, 0, 0], pu = [0, 0, 0], pv = [0, 0, 0];
    for (let b = 0; b < 4; b++) {
      const row = [0, 0, 0], rowU = [0, 0, 0];
      for (let a = 0; a < 4; a++) { const q = C(i0 + a - 1, j0 + b - 1); for (let c = 0; c < 3; c++) { row[c] += q[c] * wu[a]; rowU[c] += q[c] * du[a]; } }
      for (let c = 0; c < 3; c++) { p[c] += row[c] * wv[b]; pu[c] += rowU[c] * wv[b]; pv[c] += row[c] * dv[b]; }
    }
    let nn = [pu[1] * pv[2] - pu[2] * pv[1], pu[2] * pv[0] - pu[0] * pv[2], pu[0] * pv[1] - pu[1] * pv[0]];
    const l = Math.hypot(...nn);
    nn = l > 1e-9 ? nn.map((v) => v / l) : [0, 1, 0];
    const jit = (hash(k * 7 + (P.seed ?? 0)) - 0.5) * 0.0006;
    for (let c = 0; c < 3; c++) { base[k * 3 + c] = p[c]; nrm[k * 3 + c] = nn[c]; xa[k * 3 + c] = p[c] + nn[c] * jit; }
  }
  const hf = P.L / (m - 1), RC = P.RC ?? 0.004, pr = P.pin ?? R, c0 = (m - 1) >> 1;
  const pl = plinth ? plinthSDF(plinth) : null, floorY = plinth ? -plinth.height : -10;
  const S = [[1, 0, hf, 1, 0], [-1, 0, hf, 1, 0], [0, 1, hf, 1, 0], [0, -1, hf, 1, 0],
    [1, 1, hf * Math.SQRT2, P.shear, 0], [-1, 1, hf * Math.SQRT2, P.shear, 0], [1, -1, hf * Math.SQRT2, P.shear, 0], [-1, -1, hf * Math.SQRT2, P.shear, 0],
    [2, 0, 2 * hf, P.bend, 1], [-2, 0, 2 * hf, P.bend, 1], [0, 2, 2 * hf, P.bend, 1], [0, -2, 2 * hf, P.bend, 1]];
  const g = [0, 0, 0];
  // poids de l'adhérence : la surface grossière doit déjà être près de la
  // statue (une grandeur continue dans le temps) ; sinon le linge claquerait
  // d'un coup sur la forme dès qu'il entre dans la portée
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const wAdh = new Float64Array(M);
  if (sdf) for (let k = 0; k < M; k++) { const d = sdf(base[k * 3], base[k * 3 + 1], base[k * 3 + 2], g); wAdh[k] = d < 1 ? ss(P.near ?? 0.03, 0.006, d) : 0; }
  for (let it = 0; it < P.iters; it++) {
    for (let k = 0; k < M; k++) {
      const i = k % m, j = Math.floor(k / m), k3 = k * 3;
      const pinned = Math.abs(i - c0) <= pr && Math.abs(j - c0) <= pr; // (sous la bague : la surface grossière, mais hors de la matière)
      const x = [xa[k3], xa[k3 + 1], xa[k3 + 2]];
      const acc = [0, 0, 0];
      let wsum = 0;
      for (const [di, dj, rest, w, bend] of S) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= m || jj >= m) continue;
        const q = (jj * m + ii) * 3;
        const e = [xa[q] - x[0], xa[q + 1] - x[1], xa[q + 2] - x[2]], l = Math.hypot(...e);
        if (l < 1e-9) continue;
        const cv = l - rest;
        if (bend && cv > 0) continue;
        for (let c = 0; c < 3; c++) acc[c] += e[c] * (0.5 * cv / l) * w;
        wsum += w;
      }
      const p = x.map((v, c) => v + (acc[c] / Math.max(wsum, 1)) * 1.6);
      const b0 = [base[k3], base[k3 + 1], base[k3 + 2]], n0 = [nrm[k3], nrm[k3 + 1], nrm[k3 + 2]];
      const dl = p.map((v, c) => v - b0[c]);
      const hn = dl[0] * n0[0] + dl[1] * n0[1] + dl[2] * n0[2];
      const hc = Math.min(P.maxN, Math.max(-P.maxN, hn));
      for (let c = 0; c < 3; c++) p[c] = pinned ? b0[c] : b0[c] + (dl[c] - n0[c] * hn) * (1 - P.anchor) + n0[c] * hc;
      if (sdf) for (let pass = 0; pass < 2; pass++) { // (deux projections : dans un creux, une seule peut retomber dans la matière)
        const d = sdf(p[0], p[1], p[2], g), gl = Math.hypot(g[0], g[1], g[2]);
        if (d < 1 && gl > 1e-6) {
          const nn = g.map((v) => v / gl);
          if (d < RC) for (let c = 0; c < 3; c++) p[c] += nn[c] * (RC - d);
          else if (d < RC + P.RA && pass === 0) { const s = Math.min(d - RC, P.adh * wAdh[k] * ss(RC + P.RA, RC, d)); for (let c = 0; c < 3; c++) p[c] -= nn[c] * s; }
        }
      }
      if (pl && p[1] < 0.05) {
        const d = pl(p[0], p[1], p[2]);
        if (d < RC) {
          const e = 0.0005;
          const gp = [pl(p[0] + e, p[1], p[2]) - pl(p[0] - e, p[1], p[2]), pl(p[0], p[1] + e, p[2]) - pl(p[0], p[1] - e, p[2]), pl(p[0], p[1], p[2] + e) - pl(p[0], p[1], p[2] - e)];
          const l = Math.hypot(...gp);
          if (l > 1e-9) for (let c = 0; c < 3; c++) p[c] += (gp[c] / l) * (RC - d);
        }
      }
      p[1] = Math.max(p[1], floorY + RC);
      xb[k3] = p[0]; xb[k3 + 1] = p[1]; xb[k3 + 2] = p[2];
    }
    [xa, xb] = [xb, xa];
  }
  return { X: xa, base, m };
}
