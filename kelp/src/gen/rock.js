// La roche du platier (module pur) : un relief calculé une fois, dans un worker,
// puis lu partout — par la simulation des laminaires (contact, frottement), par
// la mer (les cuvettes gardent leur eau : les flaques), par la pose des
// crampons, et sur le GPU en déplacement des sommets et en normal map.
//
// relief(x, z) = profil moyen b(x) (celui de la mer, gen/sea.js) + détail(x, z)
// propre à la roche :
//   granit   — boules et dômes usés, diaclases aux épaules arrondies ;
//   basalte  — dalles polygonales (sommets de colonnes) à hauteurs inégales ;
//   craie    — dalle douce, cupules peu profondes, rognons de silex ;
//   ardoise  — feuillets dressés en peigne (une face raide, un dos en pente) ;
//   grès     — gradins en lits, alvéoles (taffonis).
// Plus des cuvettes (les flaques). Axe x vers la côte, z le long de la côte.
import { createNoise3, hashSeed, createRng } from '../../../shared/rng.js';
import { makeProfile } from './sea.js';

const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const h2 = (i, j, s) => { const v = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };

// Worley 2D : F1, F2, identifiant et centre de la cellule la plus proche
function worley(x, z, c, s, jit = 0.9) {
  const gx = Math.floor(x / c), gz = Math.floor(z / c);
  let f1 = 1e9, f2 = 1e9, id = 0, cx1 = 0, cz1 = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = gx + i, cz = gz + j;
    const px = (cx + 0.5 + (h2(cx, cz, s) - 0.5) * jit) * c, pz = (cz + 0.5 + (h2(cx, cz, s + 1) - 0.5) * jit) * c;
    const d = Math.hypot(x - px, z - pz);
    if (d < f1) { f2 = f1; f1 = d; id = h2(cx, cz, s + 2); cx1 = px; cz1 = pz; } else if (d < f2) f2 = d;
  }
  return [f1, f2, id, cx1, cz1];
}

export const ROCKS = {
  granite: { label: 'Granit' },
  basalt: { label: 'Basalte' },
  chalk: { label: 'Craie' },
  slate: { label: 'Ardoise' },
  sandstone: { label: 'Grès' },
};

// Le relief détaillé d'une roche : detail(x, z) en mètres (moyenne ~0), et
// quelques attributs pour la couleur (fissure, identifiant de bloc, motif)
export function makeRock(type, seed, opts = {}) {
  const s = hashSeed(`rock:${type}:${seed}`) % 997;
  const N = createNoise3(`rock:${seed}`);
  const amp = opts.amp ?? 1;
  const dip = opts.dip ?? 0.5; // (ardoise : direction des feuillets)
  const cd = Math.cos(dip), sd = Math.sin(dip);
  function sample(x, z) {
    const wx = x + 0.25 * N.noise(x * 0.5, 1.3, z * 0.5), wz = z + 0.25 * N.noise(x * 0.5, 7.1, z * 0.5);
    let d = 0, crack = 0, id = 0, motif = 0;
    const wear = N.fbm(x * 0.6, 0.7, z * 0.6, 4);
    if (type === 'granite') {
      // boules usées, séparées par des diaclases
      const [f1, f2, cid] = worley(wx, wz, 0.8, s, 0.85);
      const e = f2 - f1;
      crack = Math.exp(-((e / (0.03 + 0.02 * N.noise(x * 0.7, 4, z * 0.7))) ** 2));
      const dome = 1 - Math.min(1, (f1 / 0.7) ** 2);
      d = 0.035 * dome + (cid - 0.5) * 0.04 - 0.05 * crack + 0.02 * wear;
      // usure à l'échelle du centimètre : creux, bosses, grain
      d += 0.008 * N.fbm(x * 6, 2.2, z * 6, 4) + 0.003 * N.fbm(x * 20, 5.2, z * 20, 2);
      id = cid;
    } else if (type === 'basalt') {
      // sommets de colonnes : dalles polygonales planes, bords arrondis, joints creux
      const [f1, f2, cid] = worley(x + 0.06 * N.noise(x * 2, 3, z * 2), z, 0.42, s, 0.75);
      const e = f2 - f1;
      crack = Math.exp(-((e / 0.022) ** 2));
      const shoulder = sst(0.0, 0.06, e);
      d = ((cid - 0.5) * 0.07 + 0.012 * wear) * shoulder - 0.045 * (1 - shoulder) - 0.03 * crack;
      d += 0.003 * N.fbm(x * 9, 4.1, z * 9, 2); // (bulles et rugosité de la lave)
      id = cid;
    } else if (type === 'chalk') {
      // dalle douce, cupules, rognons de silex, rares fissures droites
      d = 0.03 * wear;
      const [p1, , pid] = worley(x, z, 0.5, s + 5, 1);
      const pit = pid > 0.55 ? sst(0.22, 0.05, p1) : 0;
      d -= 0.028 * pit;
      const [n1, , nid] = worley(x, z, 0.33, s + 9, 1);
      const nod = nid > 0.82 ? Math.sqrt(Math.max(0, 1 - (n1 / 0.07) ** 2)) : 0;
      d += 0.022 * nod;
      const [c1, c2] = worley(x * 0.35, z * 1.6, 1.0, s + 11, 1);
      crack = Math.exp(-(((c2 - c1) / 0.02) ** 2));
      d -= 0.02 * crack;
      motif = nod; id = pid;
    } else if (type === 'slate') {
      // feuillets dressés : une coordonnée transverse aux couches, gauchie ;
      // des couches d'épaisseurs inégales (bords gauchis par un bruit), coupées
      // le long de leur direction en blocs de hauteurs différentes, au dessus
      // rugueux — un pas et un profil constants faisaient une tôle ondulée
      const u = (x * cd + z * sd) + 0.18 * N.fbm(x * 0.25, 5.5, z * 0.25, 3);
      const v = -x * sd + z * cd;
      const period = 0.3;
      const k = u / period + 0.35 * N.noise(u * 1.5, 2.2, v * 0.3), f = k - Math.floor(k), lay = Math.floor(k), lid = h2(lay, 3, s);
      // (blocs longs, joints obliques et décalés d'une couche à l'autre)
      const blen = 0.8 + 1.4 * h2(lay, 9, s), vj = v + (u - lay * period) * (h2(lay, 6, s) - 0.5) * 1.6 + 0.2 * N.noise(u * 2, 8.8, v * 2);
      const kb = vj / blen + h2(lay, 4, s), fb = kb - Math.floor(kb), blk = h2(lay * 31 + Math.floor(kb), 5, s);
      // profil : face raide (f → 1) et dos en pente, crête nette mais pas vive
      // (la face raide descend sur ~8 cm : plus abrupte, elle ne tient pas
      // dans le relief cuit ni dans le maillage, et se lit en facettes)
      // (dos plan, à peine arrondi à l'arête : un profil en cloche faisait des tuiles)
      const tooth = Math.min(1, f / 0.8) ** 1.15 * (1 - sst(0.8, 1.0, f));
      const rough = 0.006 * N.fbm(x * 7, 3.1, z * 7, 3) + 0.01 * N.fbm(x * 1.8, 4.4, z * 1.8, 2);
      d = (0.03 + 0.03 * lid + 0.03 * blk) * tooth - 0.035 + 0.01 * wear + rough;
      // (joint transverse entre deux blocs : une entaille)
      const joint = sst(0.06, 0.0, Math.min(fb, 1 - fb) * blen);
      d -= 0.025 * joint * tooth;
      crack = Math.max(1 - sst(0.0, 0.12, f) * (1 - sst(0.9, 1.0, f)), joint);
      // (pas de feuilletage fin dans le relief : sa période, 3,5 cm, est à peine
      // deux texels de la carte cuite, et il se repliait en stries)
      id = lid; motif = f;
    } else { // sandstone
      // lits en gradins le long de x (marches arrondies), alvéoles
      const k = (x + 0.4 * N.fbm(x * 0.3, 6.6, z * 0.3, 3)) / 0.55, f = k - Math.floor(k);
      d = 0.06 * (sst(0.75, 0.95, f) - f) + 0.02 * wear;
      const [t1, , tid] = worley(x, z, 0.09, s + 3, 1);
      const taf = tid > 0.82 ? sst(0.03 + 0.04 * (tid - 0.82) / 0.18, 0.01, t1) : 0; // (alvéoles rares et de tailles variées : nombreuses et égales, pleines d'eau, elles faisaient des pois)
      d -= 0.012 * taf * (0.6 + 0.4 * N.noise(x * 0.8, 1, z * 0.8));
      crack = sst(0.9, 0.97, f);
      id = h2(Math.floor(k), 1, s); motif = taf;
    }
    return { d: d * amp, crack, id, motif };
  }
  return { sample, noise: N };
}

// Les cuvettes : quelques bassins sur le platier (ils deviennent des flaques)
export function makePools(seed, area, n) {
  const r = createRng(`pools:${seed}`);
  return Array.from({ length: n }, () => ({
    x: r.range(area.x0, area.x1), z: r.range(area.z0, area.z1),
    rx: r.range(0.35, 0.9), rz: r.range(0.35, 0.9), a: r.range(0, Math.PI), depth: r.range(0.06, 0.16),
  }));
}
function poolDepth(pools, x, z) {
  let d = 0;
  for (const P of pools) {
    const c = Math.cos(P.a), s = Math.sin(P.a), dx = x - P.x, dz = z - P.z;
    const u = (dx * c + dz * s) / P.rx, v = (-dx * s + dz * c) / P.rz, q = u * u + v * v;
    if (q < 1.6) d = Math.max(d, P.depth * (1 - sst(0.35, 1.25, q)));
  }
  return d;
}

// ── Cuisson : grille M × M sur le domaine du platier ─────────────────────────
// spec : { type, seed, profile, box: {x0, x1, z0, z1}, M, pools: [...] }
// retour : { M, box, H (Float32 : relief complet), fill (niveau d'eau des
//   flaques, −∞ hors flaque), crack, id, motif (Float32) }
export function bakeRock(spec) {
  const { type, seed, box, M = 1024 } = spec;
  const prof = makeProfile(spec.profile);
  const rock = makeRock(type, seed, spec.rock ?? {});
  const pools = spec.pools ?? [];
  const H = new Float32Array(M * M), crack = new Float32Array(M * M), id = new Float32Array(M * M), motif = new Float32Array(M * M);
  const sx = (box.x1 - box.x0) / (M - 1), sz = (box.z1 - box.z0) / (M - 1);
  // le détail s'éteint au large (sous l'eau profonde) et loin de la scène
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = box.x0 + i * sx, z = box.z0 + j * sz, k = j * M + i;
    const o = rock.sample(x, z);
    const fade = sst(-4.2, -3.2, x);
    H[k] = prof(x) + o.d * fade - poolDepth(pools, x, z);
    crack[k] = o.crack; id[k] = o.id; motif[k] = o.motif;
  }
  const fill = priorityFill(H, M, spec.seaLevel ?? 0);
  // surface de contact des laminaires : enveloppe supérieure lissée du relief
  // (dilatation puis flou, ~3 cm) — une lanière passe par-dessus une fissure
  // au lieu d'y tomber, et ne descend jamais sous la roche dessinée
  const Hc = boxBlur(dilate(H, M, 2), M, 2);
  return { M, box, H, Hc, fill, crack, id, motif };
}

function dilate(A, M, r) {
  const T = new Float32Array(A.length), O = new Float32Array(A.length);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { let m = -1e9; for (let k = -r; k <= r; k++) { const q = Math.min(M - 1, Math.max(0, i + k)); m = Math.max(m, A[j * M + q]); } T[j * M + i] = m; }
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { let m = -1e9; for (let k = -r; k <= r; k++) { const q = Math.min(M - 1, Math.max(0, j + k)); m = Math.max(m, T[q * M + i]); } O[j * M + i] = m; }
  return O;
}
function boxBlur(A, M, r) {
  const T = new Float32Array(A.length), O = new Float32Array(A.length), n = 2 * r + 1;
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { let s = 0; for (let k = -r; k <= r; k++) s += A[j * M + Math.min(M - 1, Math.max(0, i + k))]; T[j * M + i] = s / n; }
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { let s = 0; for (let k = -r; k <= r; k++) s += T[Math.min(M - 1, Math.max(0, j + k)) * M + i]; O[j * M + i] = s / n; }
  return O;
}

// Inondation prioritaire (Barnes et al., 2014) : le niveau auquel chaque creux
// déborde. L'eau s'écoule par les bords du domaine et par le large (x faible).
// Renvoie, par texel, le niveau de remplissage (= H hors des cuvettes).
function priorityFill(H, M, sea) {
  const W = new Float32Array(H), done = new Uint8Array(M * M);
  // tas binaire de (niveau, index)
  const hv = [], hi = [];
  const push = (v, i) => { hv.push(v); hi.push(i); let c = hv.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (hv[p] <= hv[c]) break; [hv[p], hv[c]] = [hv[c], hv[p]]; [hi[p], hi[c]] = [hi[c], hi[p]]; c = p; } };
  const pop = () => { const v = hv[0], i = hi[0], lv = hv.pop(), li = hi.pop(); if (hv.length) { hv[0] = lv; hi[0] = li; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < hv.length && hv[l] < hv[m]) m = l; if (r < hv.length && hv[r] < hv[m]) m = r; if (m === c) break; [hv[m], hv[c]] = [hv[c], hv[m]]; [hi[m], hi[c]] = [hi[c], hi[m]]; c = m; } } return [v, i]; };
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    if (i === 0 || j === 0 || i === M - 1 || j === M - 1) { const k = j * M + i; done[k] = 1; push(Math.max(W[k], i === 0 ? sea : W[k]), k); }
  }
  while (hv.length) {
    const [v, k] = pop();
    const i = k % M, j = (k - i) / M;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= M || b >= M) continue;
      const n = b * M + a;
      if (done[n]) continue;
      done[n] = 1;
      W[n] = Math.max(W[n], v);
      push(W[n], n);
    }
  }
  return W;
}

// Échantillonneur bilinéaire d'une carte cuite (CPU : simulation, pose)
export function sampler(B, A = B.H) {
  const { M, box } = B, sx = (M - 1) / (box.x1 - box.x0), sz = (M - 1) / (box.z1 - box.z0);
  return (x, z) => {
    let fx = (x - box.x0) * sx, fz = (z - box.z0) * sz;
    fx = Math.max(0, Math.min(M - 1.001, fx)); fz = Math.max(0, Math.min(M - 1.001, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * M + i;
    return (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + M] * (1 - u) + A[k + M + 1] * u) * v;
  };
}
