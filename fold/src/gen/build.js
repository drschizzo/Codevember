// Géométrie : gabarits instanciés de la plante, parties fixes (tiges,
// fleurs, gousses, terre), montures et appareils. Fonctions pures, appelées
// par le worker (gen/worker.js) et par les tests.
//
// Attribut `surf` : poids des trois rôles de surface (OUT, IN, EDGE) ; pour
// la plante, ce sont trois matières d'un même organe (voir scene/plant.js) :
//   tige    OUT écorce, IN aiguillon, EDGE stipule ;
//   fleur   OUT filet rose, IN anthère, EDGE pédoncule et réceptacle ;
//   gousse  OUT valve, EDGE soies.
import { Buffers, OUT, IN, EDGE, tube, lathe, sphere, roundedBox, torus, add, sub, mul, norm, cross, dot } from './mesh.js';
import { leafletPoint, LEAFLET, sampleCurve, v3, halfPoint, fullPoint } from './plant.js';
import { createRng } from '../rng.js';
import { caseBars, potRelief, chaikin } from '../container.js';
import { hammerLayout, HAMMER } from '../apparatus.js';

const { sin, cos, PI, sqrt, max, min, abs, hypot } = Math;
const UPW = [0, 1, 0];

// repère « axe y vertical » pour les tours (lathe construit autour de z)
const Y_UP = (B, o = [0, 0, 0]) => B.frame(o, [1, 0, 0], [0, 0, 1], [0, 1, 0]);

// ── Gabarits ─────────────────────────────────────────────────────────────────
// Lame épaisse à tranche arrondie (un biseau en demi-rond) : une nappe P(u, v)
// est doublée dessus et dessous (± h/2 le long de sa normale) et fermée par
// une tranche dont la normale tourne d'une face à l'autre ; la tranche accroche
// toujours un filet de lumière. Attribut `leafuv` (u, v, face) : face = 1
// dessus, 0 dessous, ½ tranche.
function thickBlade(P, us, vs, h, extra = null) {
  const B = new Buffers(1 << 11), uv = [];
  const V = (p, n, u, v, f) => { uv.push(u, v, f); return B.vert(p, n, [255, 0, 0], [1, 0, 0]); };
  const nU = us.length, nV = vs.length;
  const pos = [], nor = [];
  for (let i = 0; i < nU; i++) {
    const pr = [], nr = [];
    for (let j = 0; j < nV; j++) {
      const u = us[i], v = vs[j], e = 1e-3;
      const du = sub(P(Math.min(1, u + e), v), P(Math.max(0, u - e), v));
      const dv = sub(P(u, Math.min(vs[nV - 1], v + e)), P(u, Math.max(vs[0], v - e)));
      let n = norm(cross(du, dv));
      if (n[2] < 0) n = mul(n, -1);
      if (!(Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) > 0.5)) n = [0, 0, 1];
      pr.push(P(u, v)); nr.push(n);
    }
    pos.push(pr); nor.push(nr);
  }
  const hh = (i, j) => (h / 2) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, us[i] * 1.2)));
  // faces
  for (const sgn of [1, -1]) {
    const rows = [];
    for (let i = 0; i < nU; i++) {
      const row = [];
      for (let j = 0; j < nV; j++) row.push(V(add(pos[i][j], mul(nor[i][j], sgn * hh(i, j))), mul(nor[i][j], sgn), us[i], vs[j], sgn > 0 ? 1 : 0));
      rows.push(row);
    }
    B.grid(rows);
  }
  // tranche : le tour de la nappe, en demi-rond
  const loop = [];
  for (let i = 0; i < nU; i++) loop.push([i, 0]);
  for (let j = 1; j < nV; j++) loop.push([nU - 1, j]);
  for (let i = nU - 2; i >= 0; i--) loop.push([i, nV - 1]);
  for (let j = nV - 2; j > 0; j--) loop.push([0, j]);
  const K = 4, rows = [];
  const ctr = pos[Math.floor(nU / 2)][Math.floor(nV / 2)];
  for (const [i, j] of loop) {
    const p = pos[i][j], n = nor[i][j];
    // vers l'extérieur, dans le plan de la nappe
    let out = sub(p, ctr);
    const ii = Math.min(nU - 2, Math.max(1, i)), jj = Math.min(nV - 2, Math.max(1, j));
    const inner = pos[ii][jj];
    const d = sub(p, inner);
    if (Math.hypot(...d) > 1e-6) out = d;
    out = sub(out, mul(n, dot(out, n)));
    out = Math.hypot(...out) > 1e-9 ? norm(out) : [1, 0, 0];
    const r = hh(i, j), row = [];
    for (let k = 0; k <= K; k++) {
      const th = Math.PI / 2 - (Math.PI * k) / K;
      row.push(V(add(add(p, mul(n, r * Math.sin(th))), mul(out, r * 0.9 * Math.cos(th))), norm(add(mul(n, Math.sin(th)), mul(out, Math.cos(th)))), us[i], vs[j], k === 0 ? 1 : k === K ? 0 : 0.5));
    }
    rows.push(row);
  }
  rows.push(rows[0]);
  // (grid relie les rangées entre elles : ici chaque rangée est un demi-rond)
  for (let a = 0; a + 1 < rows.length; a++) for (let k = 0; k < K; k++) B.quad(rows[a][k], rows[a][k + 1], rows[a + 1][k + 1], rows[a + 1][k]);
  if (extra) extra(B, V);
  const o = B.out();
  o.leafuv = new Float32Array(uv);
  return o;
}
const spaced = (n, f = (x) => x) => Array.from({ length: n + 1 }, (_, i) => f(i / n));

// Foliole : nappe unique (dessinée des deux côtés), u le long, v en travers ;
// mirror : foliole de gauche (la moitié large passe de l'autre côté).
export function leafletTemplate(mirror = false, nu = 12, nv = 4) {
  const P = (u, v) => { const p = leafletPoint(u, v); return mirror ? [p[0], -p[1], p[2]] : p; };
  // (épaisseur ≈ 0,2 mm : en largeurs de foliole)
  return thickBlade(P, spaced(nu, (x) => 0.5 - 0.5 * Math.cos(Math.PI * x)), spaced(nv, (x) => -1 + 2 * x), 0.13);
}
// Demi-limbe (trèfle, dionée) : u le long de la nervure, v ∈ [0, 1] vers le
// bord ; mirror : demi-limbe de droite (vers −y). Attribut `leafuv` (u, v) :
// le shader y dessine nervures, cils, rouge du piège.
//   oxalis : foliole triangulaire, échancrée au bout (en cœur)
//   trap   : lobe en demi-ellipse, bordé de cils qui s'entrecroisent
export function halfTemplate(mirror = false, shape = 'oxalis', nu = 22, nv = 16) {
  // (limbe entier, d'un seul tenant : le pli se fait dans le shader)
  const P = (u, v) => fullPoint(shape, u, v);
  const us = shape === 'trap' ? spaced(nu, (x) => 0.5 - 0.5 * Math.cos(Math.PI * x)) : spaced(nu, (x) => Math.pow(x, 1.25));
  // (plus de rangées près de la nervure : c'est là que le limbe se courbe)
  const vs = spaced(nv, (x) => { const c = 2 * x - 1; return Math.sign(c) * Math.pow(Math.abs(c), 1.35); });
  const h = shape === 'trap' ? 0.09 : 0.03;
  const cilia = shape !== 'trap' ? null : (B, V) => {
    // cils : longues dents effilées et courbes, décalées d'un demi-pas d'un
    // lobe à l'autre (elles s'entrecroisent quand le piège se ferme)
    const n = 17;
    for (const sg of [1, -1]) for (let k = 0; k < n; k++) {
      const u = 0.08 + (0.84 * (k + (sg < 0 ? 0.5 : 0))) / n;
      const c = P(u, sg), rows = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        // (de l'axe du bord vers le haut, en se courbant vers l'intérieur)
        const ctr = add(c, [0.012 * t, sg * 0.44 * t, 0.06 * t + 0.1 * t * t]);
        const tng = norm([0.012, sg * 0.44, 0.06 + 0.2 * t]);
        const s1 = norm(cross(tng, [0, 0, 1])), s2 = cross(tng, s1), r = 0.014 * (1 - t) + 0.0015, row = [];
        for (let q = 0; q < 8; q++) { const a = (2 * Math.PI * q) / 8, d = add(mul(s1, Math.cos(a)), mul(s2, Math.sin(a))); row.push(V(add(ctr, mul(d, r)), d, u, sg * (1.02 + 0.43 * t), 0.5)); }
        rows.push(row);
      }
      B.grid(rows, true);
    }
    // les trois poils sensibles de chaque lobe : de fines aiguilles dressées
    // sur la face interne (leafuv.x = 2 : la matière les reconnaît)
    for (const sg of [1, -1]) for (const [u, v] of [[0.32, 0.38], [0.52, 0.42], [0.72, 0.36]]) {
      const b = P(u, sg * v), rows = [];
      for (let i = 0; i <= 4; i++) {
        const t = i / 4, c = add(b, [0, -sg * 0.01 * t, 0.012 + 0.06 * t]), r = 0.005 * (1 - t) + 0.001, row = [];
        for (let q = 0; q < 6; q++) { const a = (2 * Math.PI * q) / 6, d = [Math.cos(a), Math.sin(a), 0]; row.push(V(add(c, mul(d, r)), d, 2, sg * v, 1)); }
        rows.push(row);
      }
      B.grid(rows, true);
    }
  };
  return thickBlade(P, us, vs, h, cilia);
}
// Pétiole ailé de la dionée : une lame qui s'élargit vers le piège
export function wingTemplate(n = 20) {
  // lame épaisse (elle porte son ombre), nervure en relief, bords arrondis
  const P = (u, v) => { const w = 0.006 + 0.03 * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.8; return [u, v * w, 0.005 * (1 - v * v) - 0.004 * v * v]; };
  const o = thickBlade(P, spaced(n), spaced(8, (x) => -1 + 2 * x), 0.0035);
  return o;
}
// Tube unitaire le long de +x (pétiole ou rachis) ; r(x) donne le rayon absolu
export function rodTemplate(r, n = 20, nr = 14, bulge = 0) {
  const B = new Buffers(1 << 9);
  const rows = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    // pulvinus : renflement à la base
    const rr = r(x) * (1 + bulge * Math.exp(-((x / 0.07) ** 2)));
    const row = [];
    for (let k = 0; k < nr; k++) {
      const a = (2 * PI * k) / nr, d = [0, cos(a), sin(a)];
      row.push(B.vert([x, d[1] * rr, d[2] * rr], d, [255, 0, 0], [1, 0, 0]));
    }
    rows.push(row);
  }
  B.grid(rows, true);
  // bouts fermés (petits disques)
  for (const [i, s] of [[0, -1], [n, 1]]) {
    const c = B.vert([i / n, 0, 0], [s, 0, 0], [255, 0, 0]);
    for (let k = 0; k < nr; k++) B.tri(c, rows[i][k], rows[i][(k + 1) % nr]);
  }
  return B.out();
}

// ── Parties fixes de la plante ───────────────────────────────────────────────
export function buildStems(plant) {
  const B = new Buffers(1 << 15);
  for (const S of plant.stems) {
    // tube à rayon variable : anneau par point
    const M = S.pts.length, nr = 16;
    const T = S.pts.map((_, i) => norm(sub(S.pts[min(M - 1, i + 1)], S.pts[max(0, i - 1)])));
    let N = norm(cross(T[0], [0, 0, 1]));
    const rows = [];
    for (let i = 0; i < M; i++) {
      if (i > 0) N = norm(cross(cross(T[i], N), T[i]));
      const Bn = cross(T[i], N), row = [];
      for (let k = 0; k < nr; k++) {
        const a = (2 * PI * k) / nr, d = add(mul(N, cos(a)), mul(Bn, sin(a)));
        row.push(B.vert(add(S.pts[i], mul(d, S.rad[i])), d, OUT, T[i]));
      }
      rows.push(row);
    }
    B.grid(rows, true);
    // bout arrondi
    const tip = S.pts[M - 1], tt = T[M - 1];
    const c = B.vert(add(tip, mul(tt, S.rad[M - 1] * 0.8)), tt, OUT);
    for (let k = 0; k < nr; k++) B.tri(c, rows[M - 1][k], rows[M - 1][(k + 1) % nr]);
    // (le pied entre dans la terre : pas de fond)
  }
  // aiguillons recourbés (cônes courbes, pointe vers le bas)
  for (const Pk of plant.prickles) {
    const S = plant.stems[Pk.stem], at = sampleCurve(S, Pk.t);
    const out = norm([cos(Pk.az), 0, sin(Pk.az)]);
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const s = i / 5;
      pts.push(add(add(at.p, mul(out, at.r * 0.85 + Pk.len * s)), mul(at.d, -Pk.len * 0.55 * s * s)));
    }
    taperTube(B, pts, (s) => 0.0065 * (1 - s) + 0.0004, 6, IN);
  }
  // stipules à la base des pétioles
  for (const L of plant.leaves) {
    const side = norm(cross(L.dir, UPW));
    for (const sg of [1, -1]) {
      const base = add(L.base, mul(side, sg * 0.012));
      const d = norm(add(add(UPW, mul(side, sg * 0.4)), mul(L.dir, -0.2)));
      taperTube(B, [base, add(base, mul(d, 0.025)), add(base, mul(d, 0.05))], (s) => 0.004 * (1 - s) + 0.0005, 5, EDGE);
    }
  }
  return B.out();
}
function taperTube(B, pts, rad, nr, s) {
  const M = pts.length;
  const T = pts.map((_, i) => norm(sub(pts[min(M - 1, i + 1)], pts[max(0, i - 1)])));
  let N = norm(cross(T[0], abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const rows = [];
  for (let i = 0; i < M; i++) {
    if (i > 0) N = norm(cross(cross(T[i], N), T[i]));
    const Bn = cross(T[i], N), row = [], r = rad(i / (M - 1));
    for (let k = 0; k < nr; k++) { const a = (2 * PI * k) / nr, d = add(mul(N, cos(a)), mul(Bn, sin(a))); row.push(B.vert(add(pts[i], mul(d, r)), d, s, T[i])); }
    rows.push(row);
  }
  B.grid(rows, true);
  const c = B.vert(add(pts[M - 1], mul(T[M - 1], rad(1))), T[M - 1], s);
  for (let k = 0; k < nr; k++) B.tri(c, rows[M - 1][k], rows[M - 1][(k + 1) % nr]);
}

// Pompons : ~70 étamines roses à anthères jaunes, sur un pédoncule
export function buildFlowers(plant) {
  const B = new Buffers(1 << 15);
  for (const F of plant.flowers) {
    const r = createRng(`fl${F.seed}`);
    taperTube(B, [F.base, v3.lerp(F.base, F.head, 0.5), F.head], () => 0.0042, 6, EDGE);
    sphereAt(B, F.head, 0.014, 8, 6, EDGE);
    const n = Math.round(60 + 30 * F.open);
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n, rr = sqrt(1 - y * y), t = i * 2.39996323;
      let d = [rr * cos(t), y, rr * sin(t)];
      // (pas d'étamine dans le pédoncule)
      if (dot(d, F.dir) < -0.75) continue;
      // repère : le pompon est orienté selon le pédoncule
      d = norm(add(d, mul(F.dir, 0.25)));
      const L = F.r * (0.82 + 0.18 * r.next()) * F.open;
      const bend = norm(cross(d, [r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)]));
      const p0 = add(F.head, mul(d, 0.01));
      const pts = [p0, add(add(p0, mul(d, L * 0.5)), mul(bend, L * 0.04)), add(add(p0, mul(d, L)), mul(bend, L * 0.06))];
      taperTube(B, pts, (s) => 0.0011 * (1 - 0.4 * s), 4, OUT);
      sphereAt(B, pts[2], 0.0028, 5, 4, IN);
    }
  }
  return B.out();
}
function sphereAt(B, c, r, nu, nv, s) {
  const rows = [];
  for (let j = 0; j <= nv; j++) {
    const th = (PI * j) / nv, row = [];
    for (let i = 0; i < nu; i++) { const ph = (2 * PI * i) / nu, d = [sin(th) * cos(ph), cos(th), sin(th) * sin(ph)]; row.push(B.vert(add(c, mul(d, r)), d, s)); }
    rows.push(row);
  }
  B.grid(rows, true);
}

// Gousses : lomentums plats, articulés (3 à 5 articles), bordés de soies
export function buildPods(plant) {
  const B = new Buffers(1 << 14);
  for (const Pd of plant.pods) {
    const r = createRng(`pod${Pd.seed}`);
    taperTube(B, [Pd.base, v3.lerp(Pd.base, Pd.head, 0.5), Pd.head], () => 0.0045, 6, EDGE);
    for (let k = 0; k < Pd.n; k++) {
      // éventail de gousses autour du pédoncule
      const a = ((k - (Pd.n - 1) / 2) / Pd.n) * 1.4;
      const side = norm(cross(Pd.dir, [0, 1, 0.001]));
      const d = norm(add(mul(Pd.dir, cos(a)), mul(side, sin(a))));
      const flat = norm(cross(d, side));
      const segs = r.int(3, 5), L = Pd.len * r.range(0.85, 1.05), W = 0.028, Th = 0.008;
      // surface : ellipse aplatie, étranglée entre les articles
      const rows = [], nu = segs * 8, nv = 12;
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const pinch = 1 - 0.32 * Math.pow(abs(cos(PI * u * segs)), 6);
        const w = W * pinch * Math.pow(sin(PI * min(1, u * 1.04)), 0.45);
        const row = [];
        for (let j = 0; j < nv; j++) {
          const t = (2 * PI * j) / nv;
          const off = add(mul(side, cos(t) * w), mul(flat, sin(t) * Th * (0.6 + 0.4 * pinch)));
          const c = add(Pd.head, mul(d, 0.01 + u * L));
          row.push(B.vert(add(c, off), norm(add(mul(side, cos(t) / max(w, 1e-4)), mul(flat, sin(t) / Th))), OUT, d));
        }
        rows.push(row);
      }
      B.grid(rows, true);
      // soies sur les bords
      for (let i = 1; i < nu; i += 2) for (const sg of [1, -1]) {
        const u = i / nu, pinch = 1 - 0.32 * Math.pow(abs(cos(PI * u * segs)), 6);
        const w = W * pinch * Math.pow(sin(PI * u), 0.45);
        const p = add(add(Pd.head, mul(d, 0.01 + u * L)), mul(side, sg * w));
        const dir = norm(add(mul(side, sg), mul(d, 0.4)));
        taperTube(B, [p, add(p, mul(dir, 0.012))], (s) => 0.0008 * (1 - s) + 0.0002, 3, EDGE);
      }
    }
  }
  return B.out();
}

// Terre du pot : disque bosselé (mottes, gravillons dans le shader)
export function buildSoil(S, seed) {
  const B = new Buffers(1 << 13);
  const r = createRng(`soil${seed}`);
  const lumps = Array.from({ length: 40 }, () => ({ p: [r.range(-1, 1) * S.soilR, r.range(-1, 1) * S.soilR], s: r.range(0.03, 0.09), h: r.range(0.004, 0.014) }));
  const h = (x, z) => { let y = 0; for (const L of lumps) y += L.h * Math.exp(-((x - L.p[0]) ** 2 + (z - L.p[1]) ** 2) / (L.s * L.s)); return y; };
  const nr = 24, na = 72, rows = [];
  for (let i = 0; i <= nr; i++) {
    const rr = (S.soilR * i) / nr, row = [];
    for (let k = 0; k < na; k++) {
      const a = (2 * PI * k) / na, x = cos(a) * rr, z = sin(a) * rr;
      // (le bord remonte un peu contre la paroi)
      const y = h(x, z) * (1 - (i / nr) ** 6) + 0.012 * (i / nr) ** 8;
      const e = 0.004, nx = (h(x - e, z) - h(x + e, z)) / (2 * e), nz = (h(x, z - e) - h(x, z + e)) / (2 * e);
      row.push(B.vert([x, y, z], norm([nx, 1, nz]), OUT));
    }
    rows.push(row);
  }
  B.grid(rows, true);
  return B.out();
}

// ── Montures ─────────────────────────────────────────────────────────────────
// Profil de révolution [ρ, y] → tour (normales d'après le profil, lissées
// sauf aux angles marqués)
function turn(B, prof, s, M = 72, smoothAngle = 0.55) {
  const pts = [];
  for (let i = 0; i < prof.length; i++) {
    const [r, y] = prof[i];
    const a = prof[max(0, i - 1)], b = prof[min(prof.length - 1, i + 1)];
    const t0 = norm2([r - a[0], y - a[1]]), t1 = norm2([b[0] - r, b[1] - y]);
    const n0 = [t0[1], -t0[0]], n1 = [t1[1], -t1[0]];
    if (i > 0 && i < prof.length - 1 && n0[0] * n1[0] + n0[1] * n1[1] < cos(smoothAngle)) {
      pts.push({ r, z: y, nr: n0[0], nz: n0[1], s }, { r, z: y, nr: n1[0], nz: n1[1], s });
    } else {
      const n = norm2([n0[0] + n1[0], n0[1] + n1[1]]);
      pts.push({ r, z: y, nr: n[0], nz: n[1], s });
    }
  }
  Y_UP(B);
  lathe(B, pts, M);
  B.noFrame();
}
const norm2 = (v) => { const l = hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

// tour à relief : la paroi suit le profil, déplacée radialement par disp(φ, y) ;
// normales par différences finies sur la surface
function turnRelief(B, prof, s, M, disp) {
  const Pt = (k, phi) => { const [r, y] = prof[k]; const rr = r + disp(phi, y); return [Math.cos(phi) * rr, y, Math.sin(phi) * rr]; };
  const rows = [];
  for (let k = 0; k < prof.length; k++) {
    const row = [];
    for (let i = 0; i < M; i++) {
      const phi = (2 * PI * i) / M, e = (2 * PI) / M / 4;
      const a = sub(Pt(k, phi + e), Pt(k, phi - e));
      const b = sub(Pt(Math.min(prof.length - 1, k + 1), phi), Pt(Math.max(0, k - 1), phi));
      let n = norm(cross(a, b));
      const p = Pt(k, phi);
      if (dot(n, [p[0], 0, p[2]]) < 0) n = mul(n, -1);
      row.push(B.vert(p, n, s, [-Math.sin(phi), 0, Math.cos(phi)]));
    }
    rows.push(row);
  }
  B.grid(rows, true);
}

// pot (paroi extérieure, lèvre, paroi intérieure jusqu'à la terre, fond)
export function buildPot(S) {
  const B = new Buffers(1 << 14);
  const outer = S.outer;
  const inner = [];
  // paroi intérieure : de la lèvre jusqu'un peu sous la terre
  const top = outer[outer.length - 1];
  inner.push([top[0], top[1]], [top[0] - 0.015, top[1] + 0.002], [S.rimR - 0.06, S.rimY - 0.004], [S.rimR - 0.075, S.rimY - 0.02], [S.soilR + 0.01, S.rimY - 0.035], [S.soilR, -0.04]);
  const relief = potRelief(S);
  if (relief) {
    // paroi extérieure en relief (finement découpée), puis fond et paroi intérieure
    const fine = [];
    for (let i = 0; i + 1 < outer.length; i++) { const [a, b] = [outer[i], outer[i + 1]]; const n = Math.max(1, Math.ceil(Math.abs(b[1] - a[1]) / 0.006)); for (let k = 0; k < n; k++) fine.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); }
    fine.push(outer[outer.length - 1]);
    turnRelief(B, fine, OUT, 396, relief);
    turn(B, [[0, outer[0][1]], outer[0]], OUT, 396, 0.9);
    turn(B, [outer[outer.length - 1], ...inner.slice(1)], OUT, 396, 0.9);
  } else turn(B, [[0, outer[0][1]], ...outer, ...inner.slice(1)], OUT, 160, 0.9);
  // (la paroi intérieure, au-dessus de la terre, est la face « interne »)
  if (S.saucer) {
    const y0 = S.potBottom - S.saucer.h, R = S.saucer.r;
    turn(B, [[0, y0], [R - 0.06, y0], [R - 0.02, y0 + 0.01], [R, y0 + S.saucer.h * 0.8], [R - 0.012, y0 + S.saucer.h], [R - 0.03, y0 + S.saucer.h * 0.75], [R - 0.07, y0 + 0.018], [0, y0 + 0.018]], OUT, 96);
  }
  if (S.feet) for (let k = 0; k < S.feet.n; k++) {
    const a = (2 * PI * (k + 0.5)) / S.feet.n;
    roundedBox(B, [cos(a) * S.feet.r, S.potBottom - S.feet.h / 2, sin(a) * S.feet.r], [0.07, S.feet.h / 2, 0.07], 0.02, 4, OUT, OUT);
  }
  return B.out();
}
// socle tourné (cloche), caisse de Ward (socle, montants, petits bois, toit)
export function buildBase(S) {
  const B = new Buffers(1 << 14);
  if (S.plinth) {
    const y0 = S.tableY, h = S.plinth.h, R = S.plinth.r;
    const prof = S.plinth.profile;
    turn(B, [[0, y0], ...prof, [0, y0 + h]], OUT, 256, 0.9);
    // gorge où repose la cloche
    turn(B, [[S.bell.R + 0.03, y0 + h + 0.004], [S.bell.R + 0.05, y0 + h + 0.02], [S.bell.R - 0.05, y0 + h + 0.02], [S.bell.R - 0.03, y0 + h + 0.004]], EDGE, 128);
  }
  if (S.case) {
    const { W, D: Dp, base } = S.case, y0 = S.tableY;
    roundedBox(B, [0, y0 + base / 2, 0], [W + 0.06, base / 2, Dp + 0.06], 0.025, 6, EDGE, OUT);
    roundedBox(B, [0, y0 + base + 0.015, 0], [W + 0.03, 0.015, Dp + 0.03], 0.01, 4, EDGE, OUT);
  }
  return B.out();
}
// montants et petits bois de la caisse (fonte)
export function buildCaseFrame(S) {
  const B = new Buffers(1 << 14);
  for (const [a, b, r] of caseBars(S)) tube(B, [a, b], r, 8, OUT, true);
  const { W, D: Dp, eave, pitch } = S.case, ridgeY = eave + W * Math.tan(pitch);
  // fleurons de faîtage
  for (const sz of [-1, 1]) { sphere(B, [0, ridgeY + 0.07, sz * (Dp + 0.04)], 0.045, 14, 10, EDGE); tube(B, [[0, ridgeY, sz * (Dp + 0.04)], [0, ridgeY + 0.05, sz * (Dp + 0.04)]], 0.015, 8, EDGE); }
  return B.out();
}
// vitres : cloche (deux nappes, dôme, bouton) ou caisse (plans minces)
export function buildGlass(S) {
  const B = new Buffers(1 << 14);
  if (S.bell) {
    const { R, top, dome } = S.bell, y0 = S.tableY + S.plinth.h + 0.012, yc = top - dome;
    const prof = [];
    // cylindre puis dôme sphérique, rebord ourlé en bas
    prof.push([R + 0.012, y0], [R + 0.016, y0 + 0.02]);
    const ysh = yc + sqrt(max(0, dome * dome - R * R));
    for (let i = 0; i <= 6; i++) prof.push([R, y0 + 0.03 + ((ysh - y0 - 0.03) * i) / 6]);
    const a0 = Math.asin(min(1, R / dome));
    for (let i = 1; i <= 24; i++) { const a = a0 * (1 - i / 24); prof.push([dome * sin(a) + 0.0001, yc + dome * cos(a)]); }
    // nappe extérieure
    turn(B, prof.map(([r, y]) => [r, y]), OUT, 128, 0.3);
    // bouton
    const kt = top;
    turn(B, [[0.0001, kt], [0.06, kt + 0.01], [0.075, kt + 0.06], [0.05, kt + 0.11], [0.0001, kt + 0.125]], EDGE, 48);
  }
  if (S.case) {
    const { W, D: Dp, eave, pitch } = S.case, y0 = S.tableY + S.case.base + 0.03;
    const ridgeY = eave + W * Math.tan(pitch), t = 0.004;
    const pane = (c, h, n) => roundedBox(B, c, h, 0.001, 1, OUT, OUT);
    for (const sz of [-1, 1]) pane([0, (y0 + eave) / 2, sz * Dp], [W, (eave - y0) / 2, t]);
    for (const sx of [-1, 1]) pane([sx * W, (y0 + eave) / 2, 0], [t, (eave - y0) / 2, Dp]);
    // toit : deux pans inclinés
    for (const sx of [-1, 1]) {
      const L = W / Math.cos(pitch);
      B.frame([sx * W / 2, (eave + ridgeY) / 2, 0], [Math.cos(pitch) * -sx, Math.sin(pitch), 0], [0, 0, 1], [Math.sin(pitch) * sx, Math.cos(pitch), 0]);
      roundedBox(B, [0, 0, 0], [L / 2, Dp, t], 0.001, 1, OUT, OUT);
      B.noFrame();
    }
    // pignons vitrés (triangles)
    for (const sz of [-1, 1]) {
      const a = B.vert([-W, eave, sz * Dp], [0, 0, sz], OUT), b = B.vert([W, eave, sz * Dp], [0, 0, sz], OUT), c = B.vert([0, ridgeY, sz * Dp], [0, 0, sz], OUT);
      B.tri(a, b, c);
    }
  }
  return B.out();
}

// ── Appareils ────────────────────────────────────────────────────────────────
// Statif et burette : socle, tige, noix, bras, pince, burette graduée,
// robinet, bec. La pointe du bec est en `tip` ; le statif à `stand`.
export function buildBurette(A) {
  const B = new Buffers(1 << 14), G2 = new Buffers(1 << 12);
  const { tip, stand, tableY, armY } = A;
  // socle de fonte (orienté vers le pot) et tige d'acier
  {
    const rd = norm([stand[0], 0, stand[2]]), sd = cross(rd, [0, 1, 0]);
    B.frame([stand[0] + rd[0] * 0.05, tableY + 0.03, stand[2] + rd[2] * 0.05], rd, [0, 1, 0], sd);
    roundedBox(B, [0, 0, 0], [0.2, 0.03, 0.12], 0.012, 4, OUT, OUT);
    B.noFrame();
  }
  tube(B, [[stand[0], tableY + 0.05, stand[2]], [stand[0], armY + 0.45, stand[2]]], 0.022, 14, EDGE, true);
  // noix et bras horizontal jusqu'à la burette
  roundedBox(B, [stand[0], armY, stand[2]], [0.045, 0.04, 0.045], 0.01, 3, IN, IN);
  const dir = norm([tip[0] - stand[0], 0, tip[2] - stand[2]]);
  const end = [tip[0] - dir[0] * 0.065, armY, tip[2] - dir[2] * 0.065];
  tube(B, [[stand[0], armY, stand[2]], end], 0.014, 10, EDGE, true);
  // pince : deux mâchoires autour du tube
  B.frame([tip[0], armY, tip[2]], [1, 0, 0], [0, 0, 1], [0, 1, 0]);
  torus(B, [0, 0, 0], 0.062, 0.01, 32, 8, IN);
  B.noFrame();
  // burette : tube de verre, robinet, bec (verre à part)
  const yTube = tip[1] + 0.22;
  tube(G2, [[tip[0], yTube, tip[2]], [tip[0], armY + 1.2, tip[2]]], 0.055, 32, OUT, false);
  // l'eau dans la burette : une colonne teintée, son ménisque
  const L3 = new Buffers(1 << 11), lvl = armY + 0.55;
  Y_UP(L3, [tip[0], 0, tip[2]]);
  lathe(L3, [{ r: 0.0001, z: yTube - 0.06, nr: 0, nz: -1, s: OUT }, { r: 0.048, z: yTube - 0.06, nr: 1, nz: 0, s: OUT }, { r: 0.048, z: lvl, nr: 1, nz: 0, s: OUT }, { r: 0.04, z: lvl - 0.006, nr: 0.3, nz: 1, s: OUT }, { r: 0.0001, z: lvl - 0.01, nr: 0, nz: 1, s: OUT }], 32);
  L3.noFrame();
  // cône jusqu'au bec
  Y_UP(G2, [tip[0], 0, tip[2]]);
  lathe(G2, [{ r: 0.055, z: yTube, nr: 1, nz: 0, s: OUT }, { r: 0.012, z: tip[1] + 0.12, nr: 1, nz: 0.2, s: OUT }, { r: 0.007, z: tip[1] + 0.01, nr: 1, nz: 0.05, s: OUT }, { r: 0.0045, z: tip[1], nr: 0.3, nz: -1, s: OUT }, { r: 0.0001, z: tip[1] - 0.0005, nr: 0, nz: -1, s: OUT }], 24);
  G2.noFrame();
  // robinet (clé en croix) entre le tube et le bec
  const ky = tip[1] + 0.17;
  const side = norm(cross(dir, [0, 1, 0]));
  tube(B, [add([tip[0], ky, tip[2]], mul(side, -0.05)), add([tip[0], ky, tip[2]], mul(side, 0.07))], 0.016, 12, IN, true);
  roundedBox(B, add([tip[0], ky, tip[2]], mul(side, 0.085)), [0.012, 0.035, 0.012], 0.006, 3, IN, IN);
  return { metal: B.out(), glass: G2.out(), liquid: L3.out() };
}
// Marteau de laboratoire (voir apparatus.js) : la partie fixe dans le monde,
// le bras (mobile) dans le repère du pivot — X = direction du coup, Y le haut,
// Z l'axe — bras pendu le long de −y à l'angle 0.
export function buildHammer(E, S) {
  const Hm = E.hammer, d = E.dir, K = HAMMER, L = hammerLayout(Hm);
  const B = new Buffers(1 << 14), Arm = new Buffers(1 << 13);
  const side = norm(cross(d, [0, 1, 0]));
  const W = (rho, y, z = 0) => add([d[0] * rho, y, d[2] * rho], mul(side, z));
  const y0 = S.tableY;
  // socle de fonte, colonne d'acier
  B.frame(W(L.plateRho, y0 + K.plate[1]), d, [0, 1, 0], side);
  roundedBox(B, [0, 0, 0], K.plate, 0.012, 4, OUT, OUT);
  B.noFrame();
  tube(B, [W(L.colRho, y0 + 0.05), W(L.colRho, L.top)], K.colR, 16, EDGE, true);
  // potence jusqu'à la chape ; chape (deux joues) et axe
  const py = Hm.pivot[1];
  tube(B, [W(L.colRho, py + 0.035), W(Hm.pivot[0] + 0.02, py + 0.035)], 0.021, 14, EDGE, true);
  for (const z of [-0.028, 0.028]) {
    B.frame(W(Hm.pivot[0], py + 0.008, z), d, [0, 1, 0], side);
    roundedBox(B, [0, 0, 0], [0.026, 0.034, 0.005], 0.004, 2, EDGE, EDGE);
    B.noFrame();
  }
  tube(B, [W(Hm.pivot[0], py, -0.045), W(Hm.pivot[0], py, 0.045)], 0.006, 12, EDGE, true);
  // ressorts de torsion enroulés sur l'axe, de part et d'autre de la chape
  for (const z0 of [-0.042, 0.034]) {
    const pts = [];
    for (let i = 0; i <= 48; i++) { const a = (i / 48) * 5 * 2 * PI; pts.push(add(W(Hm.pivot[0] + 0.011 * Math.cos(a), py + 0.011 * Math.sin(a)), mul(side, z0 + (0.008 * i) / 48))); }
    tube(B, pts, 0.0018, 6, EDGE, true);
  }
  // électroaimant : équerre sur la colonne, deux joues, bobine, noyau
  const n3 = norm(add(mul(d, L.n[0]), [0, L.n[1], 0]));
  tube(B, [W(L.back[0], L.back[1]), W(L.colRho, L.back[1])], 0.012, 10, EDGE, true);
  const pole = W(L.pole[0], L.pole[1]), back = W(L.back[0], L.back[1]);
  coil(B, mul(add(pole, back), 0.5), n3, K.coilR - 0.012, K.coilL - 0.02);
  tube(B, [add(back, mul(n3, -0.004)), add(pole, mul(n3, -0.002))], K.coreR, 14, OUT, true); // (noyau de fer)
  // le bras, dans le repère du pivot
  sphere(Arm, [0, 0, 0], 0.016, 16, 10, EDGE); // (moyeu)
  tube(Arm, [[0, 0, -0.022], [0, 0, 0.022]], 0.013, 14, EDGE, true);
  tube(Arm, [[0, 0, 0], [0, -Hm.arm + Hm.rh * 0.8, 0]], K.armR, 12, EDGE, true);
  sphere(Arm, [0, -Hm.arm, 0], Hm.rh, 32, 20, IN);
  // armature de fer, rivée sur le bras, face à l'aimant (côté extérieur)
  roundedBox(Arm, [0.012, -K.la, 0], [0.008, 0.03, 0.028], 0.003, 2, OUT, OUT);
  return { base: B.out(), arm: Arm.out() };
}
function coil(B, c, axis, r, len) {
  // enroulement : tores serrés le long de l'axe, entre deux joues
  const side = norm(cross(axis, [0, 1, 0])), up = cross(side, axis);
  B.frame(c, side, up, axis);
  const turns = 9;
  for (let i = 0; i < turns; i++) torus(B, [0, 0, -len / 2 + (len * (i + 0.5)) / turns], r, len / turns / 2, 32, 6, IN); // (enroulements de cuivre)
  for (const z of [-len / 2 - 0.006, len / 2 + 0.006]) {
    lathe(B, [{ r: 0.0001, z: z - 0.006, nr: 0, nz: -1, s: EDGE }, { r: r + 0.025, z: z - 0.006, nr: 0, nz: -1, s: EDGE }, { r: r + 0.025, z: z - 0.006, nr: 1, nz: 0, s: EDGE }, { r: r + 0.025, z: z + 0.006, nr: 1, nz: 0, s: EDGE }, { r: r + 0.025, z: z + 0.006, nr: 0, nz: 1, s: EDGE }, { r: 0.0001, z: z + 0.006, nr: 0, nz: 1, s: EDGE }], 32);
  }
  B.noFrame();
}

// sphère unitaire (gouttes, perles), demi-sphère (perles posées), disque (taches)
export function unitSphere(nu = 20, nv = 12) { const B = new Buffers(1 << 10); sphere(B, [0, 0, 0], 1, nu, nv, OUT); return B.out(); }
export function unitDisc(n = 32) {
  const B = new Buffers(1 << 8);
  const c = B.vert([0, 0, 0], [0, 1, 0], OUT);
  const ring = Array.from({ length: n }, (_, i) => { const a = (2 * PI * i) / n; return B.vert([cos(a), 0, sin(a)], [0, 1, 0], OUT); });
  for (let i = 0; i < n; i++) B.tri(c, ring[i], ring[(i + 1) % n]);
  return B.out();
}

// ── Paillage : des grains posés un à un ──────────────────────────────────────
// Akadama (granules d'argile cuite, ocre), gravier de rivière (galets gris,
// beiges, blancs), sphaigne (têtes de mousse vert pâle, en coussin). Chaque
// grain est une sphère déformée (bruit propre au grain), posée par empilement :
// sa hauteur est celle où il touche la terre ou les grains déjà posés.
// Attribut `grain` (teinte, clarté, tirage, sorte) pour la matière.
export function buildMulch(S, plant, kind, seed, lite = false) {
  const r = createRng(`mulch${seed}`);
  const B = new Buffers(1 << 16), grain = [];
  const spec = {
    akadama: { r: [0.018, 0.034], n: lite ? 900 : 2200, flat: 0.85, rough: 0.22 },
    gravel: { r: [0.016, 0.042], n: lite ? 800 : 1900, flat: 0.62, rough: 0.12 },
    sphagnum: { r: [0.011, 0.019], n: lite ? 2200 : 5200, flat: 0.9, rough: 0.0, star: true },
    // perlite : grains blancs, irréguliers, poreux, semés sur la tourbe noire
    perlite: { r: [0.01, 0.026], n: lite ? 380 : 900, flat: 0.8, rough: 0.32, sparse: true },
  }[kind];
  // (pas de grain là où sortent les tiges et les pétioles)
  const holes = [];
  for (const St of plant.stems) if (St.parent == null) holes.push([St.pts[0][0], St.pts[0][2], St.rad[0] + 0.012]);
  for (const L of plant.leaves) if (L.stem < 0) holes.push([L.base[0], L.base[2], 0.03]);
  const placed = [];
  const cell = 0.1, grid = new Map(), key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const near = (x, z) => { const out = []; const cx = Math.floor(x / cell), cz = Math.floor(z / cell); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = grid.get(`${cx + i},${cz + j}`); if (a) out.push(...a); } return out; };
  const R = S.soilR - 0.01;
  for (let tries = 0; placed.length < spec.n && tries < spec.n * 20; tries++) {
    const rr = r.range(...spec.r) * (kind === 'gravel' && r.chance(0.15) ? 1.35 : 1);
    const a = r.range(0, 2 * PI), d = R * Math.sqrt(r.next());
    const x = cos(a) * d, z = sin(a) * d;
    if (d + rr * 0.8 > R) continue;
    if (holes.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr + rr)) continue;
    // hauteur de repos : sur la terre, ou sur les grains voisins (contact de sphères)
    const g0 = (q) => q * spec.flat * 0.75 + 1e-6;
    let y = rr * spec.flat * 0.75;
    for (const q of near(x, z)) {
      const dd = Math.hypot(x - q.x, z - q.z), s = (rr + q.r) * (spec.star ? 0.7 : 0.92); // (la mousse se serre)
      if (dd < s) y = Math.max(y, q.y + Math.sqrt(s * s - dd * dd));
    }
    if (y > (kind === 'sphagnum' ? 0.065 : 0.07)) continue; // (une couche et demie, pas un tas)
    if (spec.sparse && y > g0(rr)) continue; // (perlite : une seule couche, la tourbe entre les grains)
    const g = { x, y, z, r: rr };
    placed.push(g);
    const k = key(x, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(g);
  }
  // grains : sphère déformée, aplatie, tournée au hasard
  const nu = lite ? 10 : 14, nv = lite ? 6 : 9;
  for (const g of placed) {
    const ax = [r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)];
    const f1 = r.range(1.5, 3.5), ph = r.range(0, 10), amp = spec.rough;
    const sx = r.range(0.85, 1.15), sz = r.range(0.85, 1.15), sy = spec.flat * r.range(0.85, 1.1);
    const tone = r.next(), pick = r.next();
    // (sphaigne : une tête étoilée — cinq à sept branches courtes autour d'un cœur)
    const arms = r.int(5, 7), tw = r.range(0, 6.28);
    const disp = spec.star
      ? (d) => 0.55 + 0.6 * Math.pow(Math.max(0, Math.cos(arms * Math.atan2(d[2], d[0]) + tw)), 3) * (1 - Math.abs(d[1])) + 0.25 * Math.max(0, d[1])
      : (d) => 1 + amp * (Math.sin(f1 * d[0] + ph) * Math.sin(f1 * d[1] + 2 * ph) * Math.sin(f1 * d[2] + 3 * ph) + 0.35 * Math.sin(2.7 * f1 * (d[0] + d[1] + ax[2]) + ph));
    const P = (th, phi) => { const d = [Math.sin(th) * Math.cos(phi), Math.cos(th), Math.sin(th) * Math.sin(phi)]; const k = g.r * disp(d); return [g.x + d[0] * k * sx, g.y + d[1] * k * sy, g.z + d[2] * k * sz]; };
    const rows = [];
    for (let j = 0; j <= nv; j++) {
      const th = (PI * j) / nv, row = [];
      for (let i = 0; i < nu; i++) {
        const phi = (2 * PI * i) / nu, e = 1e-3;
        const p = P(th, phi), a = sub(P(th + e, phi), P(th - e, phi)), b = sub(P(th, phi + e), P(th, phi - e));
        let n = norm(cross(b, a));
        if (dot(n, sub(p, [g.x, g.y, g.z])) < 0) n = mul(n, -1);
        if (j === 0) n = [0, 1, 0]; else if (j === nv) n = [0, -1, 0];
        row.push(B.vert(p, n, OUT)); grain.push(tone, pick, (g.x * 37.1 + g.z * 11.3) % 1, 0);
      }
      rows.push(row);
    }
    B.grid(rows, true);
  }
  const o = B.out();
  o.grain = new Float32Array(grain);
  o.top = placed.reduce((m, g) => Math.max(m, g.y + g.r * spec.flat), 0);
  return o;
}
