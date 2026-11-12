// Le plasmodium (module pur : worker, tests, Node). Coordonnées du site (cm) :
// x le long du vent et du fil du bois, z en travers.
//
// 1. Germination et front. Les spores posées germent (instants tirés) ; chaque
//    gouttelette s'étend, les gouttelettes fusionnent. L'instant d'arrivée du
//    plasmodium T(x, z) est une distance de Dijkstra multi-sources sur une
//    grille à huit voisins : pas anisotrope (le front court plus vite le long
//    du fil), vitesse modulée par un bruit (les festons du front), bornée au
//    territoire (une ellipse au bord bruité). T est ensuite remappé pour que le
//    front ralentisse en fin de course. La nappe de la scène est une courbe de
//    niveau de T : son bord est net à toute distance.
//
// 2. Le réseau (Tero et al., 2007) : un graphe en treillis triangulaire
//    couvre le territoire ; chaque arête a une conductivité D. À chaque pas,
//    le protoplasme part des foyers (les points de germination) vers le front
//    (puits tirés parmi les nœuds récents) ; pressions par Kirchhoff,
//        Σ_j D_ij / l_ij · (p_i − p_j) = b_i,
//    (gradient conjugué préconditionné, partant de la solution du pas
//    précédent), flux Q_ij = D_ij / l_ij · (p_i − p_j), puis
//        dD/dt = f(|Q|) − D,  f(q) = q^μ / (1 + q^μ).
//    Les tubes traversés s'épaississent, les autres s'effacent ; μ > 1 donne
//    un arbre, μ ≈ 1 des mailles. Quand le front s'arrête, les puits sont
//    tirés au bord du territoire (exploration). Rayon des veines par
//    Poiseuille : D ∝ r⁴, donc r ∝ D^¼. Enregistré en K instantanés.
//
// 3. La condensation : les perles (futurs sporanges) sont placées selon la
//    famille — en grappes autour des nœuds les plus chargés, en touffes, le
//    long des veines à l'espacement de Plateau-Rayleigh (λ ≈ 9 r), ou nulle
//    part (Hemitrichia : les veines maîtresses deviennent le fruit). Chaque
//    veine verse son volume à la perle la plus proche : Σ perles = réseau.
import { createRng } from '../rng.js';
import { makeNoise } from './wood.js';

export const K_SNAP = 32;                // instantanés du réseau
export const S0 = 0.06, S1 = 0.44;       // fenêtre enregistrée (phase du site)
export const T_GERM = [0.04, 0.12];      // instants de germination
export const T_FULL = 0.37;              // le front a tout couvert
export const FRONT_AGE = 0.03;           // âge (phase) d'un nœud « de front »
const SQ3 = Math.sqrt(3) / 2;

// ── 1. Front ─────────────────────────────────────────────────────────────────
class Heap {
  constructor() { this.k = []; this.v = []; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], last = k.length - 1;
    const lk = k[last], lv = v[last]; k.pop(); v.pop();
    if (last > 0) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= last) break; if (c + 1 < last && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
  get size() { return this.k.length; }
}

export function territoryOf(P) {
  const [cx, cz, rx, rz] = P.territory;
  return { cx, cz, rx, rz, x0: cx - rx * 1.25, x1: cx + rx * 1.25, z0: cz - rz * 1.25, z1: cz + rz * 1.25 };
}

// champ T(x, z) sur une grille Gx × Gz couvrant la boîte du territoire
export function arrivalField(P, L, seeds) {
  const Tr = territoryOf(P), N = makeNoise(L, 41);
  const h = 0.011; // (cm par cellule)
  const Gx = Math.ceil((Tr.x1 - Tr.x0) / h) + 1, Gz = Math.ceil((Tr.z1 - Tr.z0) / h) + 1;
  const inside = new Uint8Array(Gx * Gz), speed = new Float32Array(Gx * Gz);
  for (let j = 0; j < Gz; j++) for (let i = 0; i < Gx; i++) {
    const x = Tr.x0 + i * h, z = Tr.z0 + j * h, o = j * Gx + i;
    const e = ((x - Tr.cx) / Tr.rx) ** 2 + ((z - Tr.cz) / Tr.rz) ** 2;
    const edge = 1 + 0.32 * N(x, z, 1.1, 2) + 0.12 * N(x + 3, z, 3, 2);
    inside[o] = e < edge ? 1 : 0;
    speed[o] = Math.max(0.35, 1 + P.festoon * (0.45 * N(x + 11, z, 2.4, 3) + 0.25 * N(x + 5, z, 7, 2)));
  }
  // Dijkstra à huit voisins
  const D = new Float32Array(Gx * Gz).fill(Infinity), heap = new Heap();
  for (const s of seeds) {
    const i = Math.round((s.x - Tr.x0) / h), j = Math.round((s.z - Tr.z0) / h);
    if (i < 0 || j < 0 || i >= Gx || j >= Gz) continue;
    const o = j * Gx + i, d0 = (s.t - T_GERM[0]) * 3.2; // (une graine tardive part avec un retard, en cm)
    if (d0 < D[o]) { D[o] = d0; heap.push(d0, o); }
  }
  // (seize voisins : pas de cavalier, sinon les fronts sont des octogones)
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
  const cost = nb.map(([a, b]) => Math.hypot((a * h) / P.aniso, b * h));
  while (heap.size) {
    const o = heap.pop(), d = D[o];
    const i = o % Gx, j = (o - i) / Gx;
    for (let k = 0; k < 16; k++) {
      const ii = i + nb[k][0], jj = j + nb[k][1];
      if (ii < 0 || jj < 0 || ii >= Gx || jj >= Gz) continue;
      const q = jj * Gx + ii;
      if (!inside[q]) continue;
      if (k >= 8 && !inside[(j + (jj - j >> 1)) * Gx + i + (ii - i >> 1)]) continue; // (le pas de cavalier ne saute pas un bord)
      const nd = d + (cost[k] * 2) / (speed[o] + speed[q]);
      if (nd < D[q]) { D[q] = nd; heap.push(nd, q); }
    }
  }
  // distance → phase : T = t_germ + (T_FULL − t_germ)·f(d / dmax), f(x) = ½x^0,55 + ½x^1,6 :
  // les gouttelettes grossissent lentement (elles se voient séparées), le front
  // file au milieu, puis ralentit en fin de course
  let dmax = 0;
  for (let o = 0; o < D.length; o++) if (D[o] < Infinity) dmax = Math.max(dmax, D[o]);
  const T = new Float32Array(Gx * Gz);
  for (let o = 0; o < D.length; o++) T[o] = D[o] < Infinity ? T_GERM[0] + (T_FULL - T_GERM[0]) * (0.5 * (D[o] / dmax) ** 0.55 + 0.5 * (D[o] / dmax) ** 1.6) : 9;
  return { T, Gx, Gz, x0: Tr.x0, z0: Tr.z0, h, dmax };
}

// T bilinéaire en (x, z) (9 hors du territoire)
export function sampleT(F, x, z) {
  const u = (x - F.x0) / F.h, v = (z - F.z0) / F.h;
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const g = (a, b) => (a < 0 || b < 0 || a >= F.Gx || b >= F.Gz ? 9 : F.T[b * F.Gx + a]);
  return (g(i, j) * (1 - fu) + g(i + 1, j) * fu) * (1 - fv) + (g(i, j + 1) * (1 - fu) + g(i + 1, j + 1) * fu) * fv;
}

// ── 2. Réseau ────────────────────────────────────────────────────────────────
export function buildGraph(P, F, a = 0.045, seed = 'g') {
  const rng = createRng(seed), Tr = territoryOf(P);
  const xs = [], zs = [], Ts = [], index = new Map();
  const ni = Math.ceil((Tr.x1 - Tr.x0) / a) + 1, nj = Math.ceil((Tr.z1 - Tr.z0) / (a * SQ3)) + 1;
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
    const x = Tr.x0 + (i + (j & 1) * 0.5) * a + (rng.next() - 0.5) * 0.5 * a;
    const z = Tr.z0 + j * a * SQ3 + (rng.next() - 0.5) * 0.5 * a;
    const t = sampleT(F, x, z);
    if (t > 1) continue;
    index.set(j * ni + i, xs.length); xs.push(x); zs.push(z); Ts.push(t);
  }
  const E = [];
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
    const a0 = index.get(j * ni + i); if (a0 === undefined) continue;
    const odd = j & 1;
    const nbs = [[i + 1, j], [i + (odd ? 1 : 0), j + 1], [i - (odd ? 0 : 1), j + 1]];
    for (const [ii, jj] of nbs) {
      const b = index.get(jj * ni + ii);
      if (b === undefined || ii < 0 || ii >= ni) continue;
      E.push([a0, b]);
    }
  }
  const n = xs.length, m = E.length;
  const ea = new Int32Array(m), eb = new Int32Array(m), len = new Float32Array(m);
  E.forEach(([p, q], k) => { ea[k] = p; eb[k] = q; len[k] = Math.hypot(xs[p] - xs[q], zs[p] - zs[q]); });
  // adjacence (CSR)
  const deg = new Int32Array(n + 1);
  for (let k = 0; k < m; k++) { deg[ea[k] + 1]++; deg[eb[k] + 1]++; }
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const adj = new Int32Array(2 * m), fill = deg.slice(0, n);
  for (let k = 0; k < m; k++) { adj[fill[ea[k]]++] = k; adj[fill[eb[k]]++] = k; }
  return { n, m, x: Float32Array.from(xs), z: Float32Array.from(zs), T: Float32Array.from(Ts), ea, eb, len, off: deg, adj };
}

// (L + εI) p = b sur les nœuds actifs, gradient conjugué préconditionné (Jacobi)
function solve(Gr, cond, active, b, p, iters = 400, tol = 1e-7) {
  const { n, off, adj, ea, eb } = Gr;
  const diag = new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n), d = new Float64Array(n), Ad = new Float64Array(n);
  const eps = 1e-4;
  const mulA = (v, out) => {
    for (let i = 0; i < n; i++) {
      if (!active[i]) { out[i] = 0; continue; }
      let s = eps * v[i];
      for (let q = off[i]; q < off[i + 1]; q++) { const k = adj[q], c = cond[k]; if (!c) continue; const j = ea[k] === i ? eb[k] : ea[k]; s += c * (v[i] - v[j]); }
      out[i] = s;
    }
  };
  for (let i = 0; i < n; i++) {
    if (!active[i]) { diag[i] = 1; p[i] = 0; continue; }
    let s = eps; for (let q = off[i]; q < off[i + 1]; q++) s += cond[adj[q]];
    diag[i] = s;
  }
  mulA(p, Ad);
  let bn = 0;
  for (let i = 0; i < n; i++) { r[i] = active[i] ? b[i] - Ad[i] : 0; z[i] = r[i] / diag[i]; d[i] = z[i]; bn += b[i] * b[i]; }
  let rz = 0; for (let i = 0; i < n; i++) rz += r[i] * z[i];
  bn = Math.sqrt(bn) || 1;
  let it = 0;
  for (; it < iters; it++) {
    mulA(d, Ad);
    let dAd = 0; for (let i = 0; i < n; i++) dAd += d[i] * Ad[i];
    if (!(dAd > 0)) break;
    const al = rz / dAd;
    let rn = 0;
    for (let i = 0; i < n; i++) { p[i] += al * d[i]; r[i] -= al * Ad[i]; rn += r[i] * r[i]; }
    if (Math.sqrt(rn) / bn < tol) break;
    let rz2 = 0; for (let i = 0; i < n; i++) { z[i] = r[i] / diag[i]; rz2 += r[i] * z[i]; }
    const be = rz2 / rz; rz = rz2;
    for (let i = 0; i < n; i++) d[i] = z[i] + be * d[i];
  }
  return it;
}

// pas à pas (générateur : l'écran de chargement le dessine pendant qu'il tourne)
export function* networkSteps(P, Gr, seeds, { steps = 140, seed = 'tero', snaps = true } = {}) {
  const rng = createRng(seed);
  const { n, m, ea, eb, len, T } = Gr;
  const D = new Float64Array(m), cond = new Float64Array(m), p = new Float64Array(n), b = new Float64Array(n);
  const active = new Uint8Array(n);
  const snapD = new Float32Array(snaps ? m * K_SNAP : 0), snapQ = new Float32Array(snaps ? m * K_SNAP : 0);
  const Qe = new Float64Array(m), comp = new Int32Array(n);
  // foyers : le nœud le plus proche de chaque graine
  const roots = seeds.map((s) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = (Gr.x[i] - s.x) ** 2 + (Gr.z[i] - s.z) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  });
  const I0 = 1, D0 = 0.002, mu = P.mu, dt = 0.35;
  let snap = 0, residual = 0;
  const balance = []; // (bilan des flux : Σ b, pour le test de conservation)
  for (let st = 0; st <= steps; st++) {
    const s = S0 + ((S1 - S0) * st) / steps;
    for (let i = 0; i < n; i++) if (!active[i] && T[i] <= s) active[i] = 1;
    for (let k = 0; k < m; k++) if (!D[k] && active[ea[k]] && active[eb[k]]) D[k] = D0;
    // composantes connexes du plasmodium (les gouttelettes avant leur fusion)
    comp.fill(-1);
    let nc = 0;
    for (let i0 = 0; i0 < n; i0++) {
      if (!active[i0] || comp[i0] >= 0) continue;
      const stack = [i0]; comp[i0] = nc;
      while (stack.length) {
        const i = stack.pop();
        for (let q = Gr.off[i]; q < Gr.off[i + 1]; q++) { const k = Gr.adj[q]; if (!D[k]) continue; const j = ea[k] === i ? eb[k] : ea[k]; if (comp[j] < 0) { comp[j] = nc; stack.push(j); } }
      }
      nc++;
    }
    // sources : le corps (nœuds âgés, qui se vident vers le front) ; puits :
    // quelques nœuds du front, tirés à chaque pas — ou, quand le front s'est
    // arrêté, au bord du territoire et au hasard (exploration). Bilan nul dans
    // chaque composante.
    b.fill(0);
    const byComp = Array.from({ length: nc }, () => ({ src: [], front: [], late: [], all: [] }));
    for (let i = 0; i < n; i++) {
      if (!active[i]) continue;
      const C = byComp[comp[i]], age = s - T[i];
      C.all.push(i);
      if (age < FRONT_AGE) C.front.push(i); else if (age > 0.05) C.src.push(i);
      if (T[i] > T_FULL - 0.08) C.late.push(i);
    }
    for (const C of byComp) {
      if (C.all.length < 4) continue;
      let src = C.src.length ? C.src : roots.filter((i) => C.all.includes(i));
      if (!src.length) src = [C.all[0]];
      let sinks = [];
      if (C.front.length > 6) for (let q = 0; q < 6; q++) sinks.push(C.front[Math.floor(rng.next() * C.front.length)]);
      else {
        const pool = C.late.length ? C.late : C.all;
        for (let q = 0; q < 4; q++) sinks.push(rng.next() < P.explore ? C.all[Math.floor(rng.next() * C.all.length)] : pool[Math.floor(rng.next() * pool.length)]);
      }
      const I = (I0 * C.all.length) / n;
      for (const i of src) b[i] += I / src.length;
      for (const i of sinks) b[i] -= I / sinks.length;
    }
    for (let k = 0; k < m; k++) cond[k] = D[k] ? D[k] / len[k] : 0;
    solve(Gr, cond, active, b, p);
    // flux et adaptation
    for (let k = 0; k < m; k++) {
      if (!D[k]) { Qe[k] = 0; continue; }
      const q = cond[k] * (p[ea[k]] - p[eb[k]]);
      Qe[k] = q;
      const a = Math.abs(q / I0) * 2.5; // (un flux de l'ordre du flux total sature f)
      const f = a ** mu / (1 + a ** mu);
      D[k] += dt * (f - D[k]);
      D[k] = Math.max(D[k], 1e-5);
    }
    // résidu de Kirchhoff (conservation au nœud)
    let res = 0;
    for (let i = 0; i < n; i++) {
      if (!active[i]) continue;
      let s2 = -b[i];
      for (let q = Gr.off[i]; q < Gr.off[i + 1]; q++) { const k = Gr.adj[q]; s2 += ea[k] === i ? Qe[k] : -Qe[k]; }
      res = Math.max(res, Math.abs(s2));
    }
    residual = Math.max(residual, res);
    balance.push(res);
    // instantanés (K répartis sur la fenêtre)
    while (snaps && snap < K_SNAP && s >= S0 + ((S1 - S0) * snap) / (K_SNAP - 1) - 1e-9) {
      for (let k = 0; k < m; k++) { snapD[snap * m + k] = D[k]; snapQ[snap * m + k] = Qe[k]; }
      snap++;
    }
    yield { s, D, Qe, active };
  }
  return { snapD, snapQ, residual, roots };
}

export function simulateNetwork(P, Gr, seeds, opts = {}) {
  const it = networkSteps(P, Gr, seeds, opts);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}



// ── 3. Perles ────────────────────────────────────────────────────────────────
function poisson(rng, cx, cz, R, minD, count, accept) {
  const pts = [];
  for (let t = 0; t < count * 60 && pts.length < count; t++) {
    const a = rng.next() * Math.PI * 2, r = R * Math.sqrt(rng.next());
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.8;
    if (!accept(x, z)) continue;
    if (pts.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < minD * minD)) continue;
    pts.push({ x, z });
  }
  return pts;
}

export function placeBeads(P, Gr, net, sp, fruit, rad, seed = 'beads') {
  const rng = createRng(seed);
  const { n, m, ea, eb, x, z, len } = Gr;
  const last = K_SNAP - 1;
  const rFinal = (k) => rad(net.snapD[last * m + k]);
  const inside = (px, pz) => Gr.inside(px, pz);
  const nCount = Math.round((sp.count[0] + (sp.count[1] - sp.count[0]) * rng.next()) * fruit.density);
  let beads = [];
  if (sp.mode === 'cluster' || sp.mode === 'tuft') {
    // charge des nœuds : masse des veines qui y arrivent
    const load = new Float64Array(n);
    for (let k = 0; k < m; k++) { const v = rFinal(k) ** 2 * len[k]; load[ea[k]] += v; load[eb[k]] += v; }
    const order = [...Array(n).keys()].sort((a, b) => load[b] - load[a]);
    const nHub = sp.mode === 'tuft' ? rng.int(2, 4) : rng.int(2, 5), hubs = [];
    for (const i of order) { if (hubs.length >= nHub) break; if (hubs.every((h) => Math.hypot(x[h] - x[i], z[h] - z[i]) > 0.55)) hubs.push(i); }
    const per = Math.ceil(nCount / hubs.length);
    hubs.forEach((h, c) => {
      const k = per * (0.7 + 0.6 * rng.next());
      const R = Math.sqrt(k) * sp.spacing * 0.62;
      for (const q of poisson(rng, x[h], z[h], R, sp.spacing * (sp.mode === 'tuft' ? 1.0 : 0.9), Math.round(k), inside)) {
        if (beads.some((o) => (o.x - q.x) ** 2 + (o.z - q.z) ** 2 < (sp.spacing * 0.8) ** 2)) continue;
        beads.push({ ...q, cluster: c });
      }
    });
  } else if (sp.mode === 'vein') {
    // le long des veines, à l'espacement de Plateau-Rayleigh (au moins l'espacement de l'espèce)
    const ks = [...Array(m).keys()].filter((k) => rFinal(k) > sp.vein * 0.35).sort((a, b) => rFinal(b) - rFinal(a));
    for (const k of ks) {
      if (beads.length >= nCount) break;
      const lam = Math.max(sp.spacing, 9.02 * rFinal(k) * 0.6);
      const t = rng.next(), px = x[ea[k]] + (x[eb[k]] - x[ea[k]]) * t, pz = z[ea[k]] + (z[eb[k]] - z[ea[k]]) * t;
      if (beads.some((o) => (o.x - px) ** 2 + (o.z - pz) ** 2 < lam * lam * 0.8)) continue;
      beads.push({ x: px, z: pz, cluster: 0 });
    }
  }
  // les têtes ne se traversent pas : une perle trop proche d'une autre est
  // fondue dans sa voisine (son volume la suit), sinon les deux rétrécissent
  // juste assez (rayon de tête à son plus large : filet détendu d'Arcyria)
  const rHead = sp.head ? sp.head.r * (sp.cup ? 1.28 : sp.head.h > 3 * sp.head.r ? 1.05 : 1) : 0;
  const merged = beads.map(() => -1);
  // volume : chaque veine (et la nappe) verse le sien à la perle la plus proche
  const Vtot = (snapIdx) => { let v = 0; for (let k = 0; k < m; k++) v += veinVolume(rad(net.snapD[snapIdx * m + k]), len[k]); return v; };
  const V = beads.map(() => 0);
  let Vnet = 0;
  const drain = new Float32Array(m); // (retard de vidange : les veines loin des perles se vident d'abord)
  for (let k = 0; k < m; k++) {
    const mx = (x[ea[k]] + x[eb[k]]) / 2, mz = (z[ea[k]] + z[eb[k]]) / 2, v = veinVolume(rFinal(k), len[k]);
    Vnet += v;
    let best = -1, bd = Infinity;
    for (let i = 0; i < beads.length; i++) { const d = (beads[i].x - mx) ** 2 + (beads[i].z - mz) ** 2; if (d < bd) { bd = d; best = i; } }
    if (best >= 0) V[best] += v;
    drain[k] = best >= 0 ? Math.sqrt(bd) : 0;
  }
  const dmax = Math.max(1e-6, ...drain);
  for (let k = 0; k < m; k++) drain[k] = 1 - drain[k] / dmax;
  const Vmean = V.length ? V.reduce((a, b) => a + b, 0) / V.length : 1;
  // retards (ordre de maturation)
  const cx = beads.reduce((s, q) => s + q.x, 0) / (beads.length || 1), cz = beads.reduce((s, q) => s + q.z, 0) / (beads.length || 1);
  const rmax = Math.max(1e-6, ...beads.map((q) => Math.hypot(q.x - cx, q.z - cz)));
  const xs = beads.map((q) => q.x), xmin = Math.min(...xs), xmax = Math.max(...xs);
  const coff = Array.from({ length: 8 }, () => rng.next());
  beads = beads.map((q, i) => {
    let d;
    switch (fruit.order) {
      case 'center': d = Math.hypot(q.x - cx, q.z - cz) / rmax; break;
      case 'sweep': d = (q.x - xmin) / Math.max(1e-6, xmax - xmin); break;
      case 'clusters': d = coff[q.cluster % 8] * 0.8; break;
      default: d = 0;
    }
    d = Math.min(1, Math.max(0, d * 0.85 + rng.next() * 0.15));
    return {
      x: q.x, z: q.z, cluster: q.cluster, V: V[i],
      size: Math.min(1.25, Math.max(0.75, (V[i] / Vmean) ** (1 / 3))) * (0.92 + 0.16 * rng.next()),
      delay: d, tilt: rng.next() * 0.12, az: rng.next() * Math.PI * 2, spin: rng.next() * Math.PI * 2, rnd: rng.next(),
    };
  });
  if (rHead > 0) {
    for (let it = 0; it < 6; it++) {
      let changed = false;
      for (let i = 0; i < beads.length; i++) for (let j = i + 1; j < beads.length; j++) {
        const A = beads[i], B = beads[j];
        if (!A || !B) continue;
        const d = Math.hypot(A.x - B.x, A.z - B.z), need = (A.size + B.size) * rHead;
        if (need <= d * 0.999) continue;
        if (d < need * 0.72) { A.V += B.V; A.size = Math.min(1.25, A.size * 1.08); beads[j] = null; }
        else { const k = (d * 0.998) / need; A.size *= k; B.size *= k; }
        changed = true;
      }
      beads = beads.filter(Boolean);
      if (!changed) break;
    }
  }
  const Vb = beads.reduce((a, b) => a + b.V, 0);
  return { beads, drain, Vnet, Vbeads: Vb, Vtot };
}

// volume d'une veine posée (demi-ellipse aplatie : hauteur 0,6 r), cm³
export const veinVolume = (r, l) => 0.5 * Math.PI * r * (0.6 * r) * l;

// ── Tout le plasmodium d'une scène ───────────────────────────────────────────
export function seedsOf(P, rngSeed) {
  const rng = createRng(`${rngSeed}:seeds`), Tr = territoryOf(P), out = [];
  for (let i = 0; i < P.seeds; i++) {
    const g = P.foci === 2 ? (i % 2 ? 1 : -1) : 0;
    const x = Tr.cx - Tr.rx * (0.55 + 0.35 * rng.next());
    const z = Tr.cz + Tr.rz * (g ? g * 0.45 + (rng.next() - 0.5) * 0.4 : (rng.next() - 0.5) * 1.1);
    out.push({ x, z, t: T_GERM[0] + (T_GERM[1] - T_GERM[0]) * rng.next() ** 1.5 });
  }
  return out;
}

export function buildPlasmodium({ P, sp, fruit, L }) {
  const tried = seedsOf(P, P.seed);
  const F = arrivalField(P, L, tried);
  // (une graine tirée hors du territoire au bord bruité ne germe pas : on l'oublie)
  const seeds = tried.filter((g) => sampleT(F, g.x, g.z) < 0.3);
  const Gr = buildGraph(P, F, 0.045, `${P.seed}:graph`);
  Gr.inside = (px, pz) => sampleT(F, px, pz) < 1;
  const net = simulateNetwork(P, Gr, seeds, { seed: `${P.seed}:tero` });
  // rayon des veines : Poiseuille, normalisé au 99ᵉ centile des conductivités
  const all = Array.from(net.snapD).filter((v) => v > 0).sort((a, b) => a - b);
  const Dref = all[Math.floor(all.length * 0.995)] || 1;
  const rmax = sp.vein;
  const rad = (Dv) => { const r = rmax * Math.min(1, Dv / Dref) ** 0.25; return r < rmax * 0.42 ? 0 : r; };
  const B = placeBeads(P, Gr, net, sp, fruit, rad, `${P.seed}:beads`);
  return { seeds, F, Gr, net, rad, Dref, ...B };
}
