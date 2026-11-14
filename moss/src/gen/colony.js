// Le coussin de mousse : des centaines de tiges plantées dans leur substrat,
// leurs feuilles et leurs sporophytes (module pur, importable depuis Node).
//
// - Le substrat est une surface y = sub(x, z) (dessus d'une pierre, d'une
//   souche, d'un tapis de tourbe), légèrement bosselée.
// - Les tiges sont réparties par échantillonnage de Poisson (Bridson) à la
//   densité d'un vrai coussin : un peu moins d'un rayon de rosette entre deux
//   tiges, les rosettes voisines s'imbriquent (une feuille passe au-dessus ou
//   au-dessous de celles de la voisine). Une tige serrée s'ouvre moins.
// - Le coussin est plus haut au centre (croissance radiale) ; les tiges
//   penchent vers l'extérieur, et leur axe zigzague irrégulièrement (deux
//   fréquences, deux plans).
// - Feuilles en spirale (divergence 2/5, 3/8…), de la base au bourgeon ; les
//   plus basses sont vieilles (brunes, raides).
// - Le graphe de contact (tiges voisines) et l'exposition de chaque tige (au
//   ciel, au soleil, au vent) servent à l'hydraulique (hydro.js).
import { createRng, createNoise3, smoothstep as sst } from '../../../shared/rng.js';
import { bilerp } from '../field.js';
import { makeRock } from './rock.js';
import { FAMILIES } from '../families.js';
import { leafPoint, poseParams, tipFrame } from '../pose.js';
import { Buffers, tube, norm, cross, sub, add, mul, dot } from '../../../shared/gen/mesh.js';

// ── Substrat ─────────────────────────────────────────────────────────────────
// support : { cx, cz (courbures, 1/cm), tilt, bumps, seed }
// (S.rock : le relief fin de la roche, gen/rock.js — la mousse est plantée
// sur la vraie surface, fissures comprises)
const ROCK_CACHE = new Map();
export function makeSubstrate(S) {
  const N = createNoise3(`sub:${S.seed}`);
  let rock = null;
  if (S.rock) { const k = `${S.rock}:${S.seed}`; if (!ROCK_CACHE.has(k)) ROCK_CACHE.set(k, makeRock(S.rock, S.seed)); rock = ROCK_CACHE.get(k); }
  const base = (x, z) => -0.5 * S.cx * x * x - 0.5 * S.cz * z * z + S.tilt * x + S.bumps * N.fbm(x * 0.45, 0.3, z * 0.45, 3);
  const f = rock ? (x, z) => base(x, z) + rock.sample(x, z).d : base;
  const normal = (x, z) => { const e = 0.01, dx = (f(x + e, z) - f(x - e, z)) / (2 * e), dz = (f(x, z + e) - f(x, z - e)) / (2 * e); return norm([-dx, 1, -dz]); };
  return { y: f, base, normal, rock };
}

// ── Poisson (Bridson) dans un disque irrégulier ──────────────────────────────
function poisson(rng, R, d, inside, maxN) {
  const cell = d / Math.SQRT2, G = Math.ceil((2 * R) / cell) + 1, grid = new Int32Array(G * G).fill(-1);
  const pts = [], active = [];
  const gi = (p) => [Math.floor((p[0] + R) / cell), Math.floor((p[1] + R) / cell)];
  const put = (p) => { const [i, j] = gi(p); grid[j * G + i] = pts.length; pts.push(p); active.push(pts.length - 1); };
  // (plusieurs germes : les coussins sont des îlots séparés)
  const farFrom = (p) => { const [i, j] = gi(p); for (let v = Math.max(0, j - 2); v <= Math.min(G - 1, j + 2); v++) for (let u = Math.max(0, i - 2); u <= Math.min(G - 1, i + 2); u++) { const q = grid[v * G + u]; if (q >= 0 && Math.hypot(pts[q][0] - p[0], pts[q][1] - p[1]) < d) return false; } return true; };
  for (let t = 0; t < 400; t++) { const p = [rng.range(-R, R), rng.range(-R, R)]; if (inside(p) && farFrom(p)) put(p); }
  while (active.length && pts.length < maxN) {
    const k = Math.floor(rng.next() * active.length), c = pts[active[k]];
    let ok = false;
    for (let t = 0; t < 24 && !ok; t++) {
      const a = rng.next() * Math.PI * 2, r = d * (1 + rng.next() * 0.35);
      const p = [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
      if (!inside(p)) continue;
      const [i, j] = gi(p);
      let far = true;
      for (let v = Math.max(0, j - 2); v <= Math.min(G - 1, j + 2) && far; v++) for (let u = Math.max(0, i - 2); u <= Math.min(G - 1, i + 2) && far; u++) {
        const q = grid[v * G + u];
        if (q >= 0 && Math.hypot(pts[q][0] - p[0], pts[q][1] - p[1]) < d) far = false;
      }
      if (far) { put(p); ok = true; }
    }
    if (!ok) active.splice(k, 1);
  }
  return pts;
}

// quaternion d'une base orthonormée (colonnes X, Y, Z)
function quatFromBasis(X, Y, Z) {
  const m00 = X[0], m10 = X[1], m20 = X[2], m01 = Y[0], m11 = Y[1], m21 = Y[2], m02 = Z[0], m12 = Z[1], m22 = Z[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  return [x, y, z, w];
}
export const qrot = (q, v) => {
  const [x, y, z, w] = q, c1 = [y * v[2] - z * v[1] + w * v[0], z * v[0] - x * v[2] + w * v[1], x * v[1] - y * v[0] + w * v[2]];
  return [v[0] + 2 * (y * c1[2] - z * c1[1]), v[1] + 2 * (z * c1[0] - x * c1[2]), v[2] + 2 * (x * c1[1] - y * c1[0])];
};

// rayon d'une rosette ouverte (le plus grand écart à l'axe d'une feuille de
// longueur L), et sa hauteur au-dessus du point d'insertion
export function rosetteReach(fam, L) {
  const Lf = fam.leaf;
  let r = 0, up = 0;
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const P = poseParams(fam, f, 0);
    const G = { L, W: Lf.W, h: 0, stemR: fam.shoot.stemR, twist: 1 };
    for (let s = 0; s <= 1.0001; s += 0.05) for (const x of [-1, 0, 1]) {
      const p = leafPoint(s, x, 0, 0, P, G, Lf);
      r = Math.max(r, Math.hypot(p[0], p[2])); up = Math.max(up, p[1]);
    }
    if (Lf.hair) { // (le poil prolonge la pointe, droit)
      const T = tipFrame(P, G, Lf), q = [T.p[0] + T.t[0] * Lf.hair * L, T.p[2] + T.t[2] * Lf.hair * L];
      r = Math.max(r, Math.hypot(q[0], q[1])); up = Math.max(up, T.p[1] + T.t[1] * Lf.hair * L);
    }
  }
  return { r, up };
}

export const LEAF_STRIDE = 20, SPOR_STRIDE = 16;

// spec : { family, seed, radius (cm), support, lite, sporFrac, palette }
export function buildColony(spec, habitat = null) {
  const fam = FAMILIES[spec.family];
  const rng = createRng(`colony:${spec.seed}`);
  const N = createNoise3(`colony:${spec.seed}`);
  const sub0 = makeSubstrate(spec.support);
  const Sh = fam.shoot, Lf = fam.leaf;
  const Lmax = Lf.L[1];
  const reach = rosetteReach(fam, Lmax * (Sh.capitulum ? 0.85 : 1));
  // distance minimale : celle d'un coussin réel, où les rosettes ouvertes
  // s'imbriquent (environ 0,45 rayon de rosette ; les capitules de la
  // sphaigne, plus massifs, se touchent à peine)
  // (version allégée : un peu plus espacées, environ deux fois moins de tiges)
  const d = (Sh.capitulum ? reach.r * 0.8 : Math.max(Sh.spacing * 0.4, reach.r * 0.45)) * (spec.lite ? 1.4 : 1);
  const Rc = spec.radius;
  const blob = (p) => { const a = Math.atan2(p[1], p[0]); return Rc * (1 + 0.16 * N.noise(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0.5) + 0.08 * N.noise(Math.cos(a) * 3, Math.sin(a) * 3, 2.5)); };
  // coussins : épaisseur du dôme pleinement poussé (gen/build.js, d'après le
  // champ de la mousse) ; les tiges ne poussent que là où il y aura un coussin
  const dome = spec.dome ? (x, z) => bilerp(spec.dome.T, spec.dome.N, spec.dome.E, x, z) : null;
  const inside = (p) => Math.hypot(p[0], p[1]) < blob(p) && (!dome || dome(p[0], p[1]) > 0.04);
  const maxN = spec.lite ? 3500 : 16000;
  const pts = poisson(rng.fork('poisson'), Rc * 1.3, d, inside, maxN);

  const shoots = [];
  // profondeur de la rosette (la partie feuillée qui affleure au-dessus du feutre)
  const ROS = Lf.L[1] * (Sh.capitulum ? 1.2 : 0.9);
  for (const [x, z] of pts) {
    const r = Math.hypot(x, z) / blob([x, z]);
    const yb = sub0.y(x, z) - 0.06; // (la base est prise dans le substrat)
    const nrm = sub0.normal(x, z);
    let axis, H;
    if (dome) {
      // la tige suit la normale du dôme : au sommet elle est droite, sur les
      // flancs elle penche vers l'extérieur et la rosette déborde
      const e = 0.08, T0 = dome(x, z);
      const gx = (dome(x + e, z) - dome(x - e, z)) / (2 * e), gz = (dome(x, z + e) - dome(x, z - e)) / (2 * e);
      const nd = norm([-gx, 1, -gz]);
      axis = norm(add(add(mul(nd, 0.85), mul(nrm, 0.15)), [rng.range(-0.05, 0.05), 0, rng.range(-0.05, 0.05)]));
      const top = sub0.y(x, z) + T0 + ROS * 0.35 * rng.range(0.8, 1.2);
      H = Math.max(ROS * 1.1, (top - yb) / Math.max(0.35, axis[1]));
    } else {
      const out = r > 1e-3 ? [x / Math.hypot(x, z), 0, z / Math.hypot(x, z)] : [0, 0, 0];
      axis = norm(add(add(mul([0, 1, 0], 0.6), mul(nrm, 0.4)), add(mul(out, Sh.lean * r), [rng.range(-0.06, 0.06), 0, rng.range(-0.06, 0.06)])));
      H = rng.range(...Sh.height) * (0.9 + 0.1 * N.noise(x * 0.9, 1.7, z * 0.9) * 2);
    }
    // naissance : chaque tige sort quand la mousse locale passe son seuil b
    // (le front avance tige par tige) ; dans les refuges (fissures), les
    // tiges survivent à la sécheresse — leur seuil est au plancher
    const refuge = habitat ? sst(0.45, 0.9, bilerp(habitat.R, habitat.N, habitat.E, x, z)) : 0;
    const bmax = spec.dome?.Bmax ? bilerp(spec.dome.Bmax, spec.dome.N, spec.dome.E, x, z) : 1;
    const birth = rng.next() * (1 - refuge);
    const b = Math.max(0.03, Math.min(0.03 + (bmax - 0.25) * birth, 0.6 * bmax));
    shoots.push({ x, z, yb, H, axis, r, rnd: rng.next(), twist: rng.chance(0.85) ? 1 : -1, b, refuge });
  }
  const n = shoots.length;

  // axe de chaque tige : polyligne qui zigzague aux nœuds (deux fréquences,
  // deux plans), rééchantillonnée régulièrement
  const NS = 16;
  for (const s of shoots) {
    const a = s.axis, t1 = norm(cross(a, Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), t2 = cross(a, t1);
    const ph = [rng.range(0, 6.3), rng.range(0, 6.3)], amp = 0.018 * s.H, fr = [rng.range(2.2, 3.6), rng.range(4.5, 7)];
    s.pts = [];
    for (let k = 0; k <= NS; k++) {
      const t = k / NS, e = t * t * (3 - 2 * t);
      const w1 = amp * (Math.sin(fr[0] * t * 6.28 + ph[0]) * 0.7 + Math.sin(fr[1] * t * 6.28 + ph[1]) * 0.3) * e;
      const w2 = amp * (Math.cos(fr[0] * 0.8 * t * 6.28 + ph[1]) * 0.6 + Math.sin(fr[1] * 1.3 * t * 6.28 + ph[0]) * 0.4) * e;
      s.pts.push(add(add([s.x, s.yb, s.z], mul(a, t * s.H)), add(mul(t1, w1), mul(t2, w2))));
    }
    s.top = s.pts[NS];
  }
  // niveau de détail d'un objet de taille l au point p (gen/build.js : d'après
  // la trajectoire de la caméra) : 0 gros plan, 1 moyen, 2 lointain
  const lodOf = spec.lod ? spec.lod(shoots) : () => 0;
  for (const s of shoots) s.lod = lodOf(s.top, Lmax);
  const stemAt = (s, t) => {
    const f = Math.min(NS - 1e-6, Math.max(0, t * NS)), k = Math.floor(f), u = f - k;
    const p = add(mul(s.pts[k], 1 - u), mul(s.pts[k + 1], u));
    const T = norm(sub(s.pts[Math.min(NS, k + 1)], s.pts[k]));
    return { p, T };
  };

  // graphe de contact et exposition
  const nb = shoots.map(() => []), nbC = d * 1.75, nbG = new Map();
  shoots.forEach((S, i) => { const k = `${Math.floor(S.x / nbC)},${Math.floor(S.z / nbC)}`; if (!nbG.has(k)) nbG.set(k, []); nbG.get(k).push(i); });
  for (let i = 0; i < n; i++) {
    const S = shoots[i], gx = Math.floor(S.x / nbC), gz = Math.floor(S.z / nbC);
    for (let a = gx - 1; a <= gx + 1; a++) for (let c = gz - 1; c <= gz + 1; c++) for (const j of nbG.get(`${a},${c}`) ?? []) {
      if (j <= i) continue;
      if (Math.hypot(S.x - shoots[j].x, S.z - shoots[j].z) < nbC) { nb[i].push(j); nb[j].push(i); }
    }
  }
  // écartement permis : une tige dont la voisine la plus proche est à dn
  // s'ouvre jusqu'à ce que sa rosette dépasse à peine l'axe de la voisine ;
  // serrement (crowd) : la part du ciel que lui cachent ses voisines
  for (let i = 0; i < n; i++) {
    const S = shoots[i];
    let dn = Infinity;
    for (const j of nb[i]) dn = Math.min(dn, Math.hypot(S.x - shoots[j].x, S.z - shoots[j].z));
    S.amp = Math.min(1, Math.max(0.55, (dn * 1.4) / reach.r));
    S.crowd = Math.min(1, nb[i].length / 9);
  }
  const sunDir = norm(spec.sunDir ?? [0.4, 0.8, 0.3]);
  for (let i = 0; i < n; i++) {
    const s = shoots[i], top = s.top[1];
    let higher = 0;
    for (const j of nb[i]) higher += Math.max(0, shoots[j].top[1] - top);
    const edge = Math.max(0, 6 - nb[i].length) / 6;
    s.sky = Math.min(1.3, Math.max(0.25, 1 - higher / (Sh.height[1] * 0.6) + edge * 0.35));
    // soleil : exposition du flanc tourné vers lui
    const outv = s.r > 1e-3 ? [s.x / Math.hypot(s.x, s.z), 0, s.z / Math.hypot(s.x, s.z)] : [0, 0, 0];
    s.sun = Math.min(1.3, Math.max(0.5, s.sky * (0.75 + 0.45 * dot(outv, sunDir) * s.r)));
  }

  // ── Le feutre (rhizoïdes, feuilles mortes, débris) entre les tiges ──
  // une surface qui remplit le coussin jusqu'au quart de la hauteur des
  // tiges, et retombe sur le substrat au bord du coussin
  const TURF = Sh.turf;
  const cellG = new Map(), cs = d * 1.5;
  shoots.forEach((S, i) => { const k = `${Math.floor(S.x / cs)},${Math.floor(S.z / cs)}`; if (!cellG.has(k)) cellG.set(k, []); cellG.get(k).push(i); });
  const turfY = dome ? (x, z) => sub0.y(x, z) + Math.max(0, dome(x, z) - ROS * 0.45) : (x, z) => {
    const r = Math.hypot(x, z) / blob([x, z]);
    const mask = 1 - sst(0.9, 1.06, r);
    let ws = 0, hs = 0;
    const gx = Math.floor(x / cs), gz = Math.floor(z / cs);
    for (let a = gx - 2; a <= gx + 2; a++) for (let b = gz - 2; b <= gz + 2; b++) for (const i of cellG.get(`${a},${b}`) ?? []) {
      const S = shoots[i], w = Math.exp(-((S.x - x) ** 2 + (S.z - z) ** 2) / (d * d * 0.8));
      ws += w; hs += w * (TURF * S.H * S.axis[1]);
    }
    const h = ws > 1e-6 ? hs / ws : 0;
    return sub0.y(x, z) + mask * (h * Math.min(1, ws * 3) + 0.02) - (1 - mask) * 0.08 + 0.012 * N.noise(x * 6, 3.3, z * 6) * mask;
  };
  for (const S of shoots) S.tTurf = dome ? Math.max(0.05, 1 - ROS / S.H) : Math.min(0.85, (turfY(S.x, S.z) - S.yb) / (S.H * Math.max(0.3, S.axis[1])) + 0.04);

  // ── Feuilles ──
  const leaves = [];
  shoots.forEach((s, si) => {
    const nl = Math.round(rng.range(...Sh.leaves) * (dome ? 1 : 0.75 + 0.25 * Math.min(1, s.H / Sh.height[1])));
    // (feuilles mortes, brunes et raides, le long du bas de la tige : sous un
    // dôme elles garnissent toute la partie enfouie, de 15 % de la hauteur
    // jusqu'à la rosette)
    const nOld = dome ? 3 : 2;
    const total = nl + nOld;
    let az = rng.range(0, Math.PI * 2);
    const L0 = rng.range(...Lf.L);
    for (let k = 0; k < total; k++) (() => {
      const old = k < nOld;
      // vieilles feuilles en bas, feuilles vertes de 1 − leafy au sommet ;
      // entre-nœuds qui raccourcissent vers le bourgeon
      const lo = s.tTurf, hiOld = dome ? lo : lo + 0.06, loOld = dome ? Math.min(lo, 0.15) : lo;
      const g = old ? loOld + (k / nOld) * (hiOld - loOld) * 0.95 : hiOld + (1 - hiOld) * (1 - (1 - (k - nOld) / nl) ** 1.35) * 0.97;
      const t = Math.min(0.985, g);
      const rho = old ? 0 : (k - nOld) / Math.max(1, nl - 1);
      az += Math.PI * 2 * Sh.div + rng.range(-0.12, 0.12);
      const { p, T } = stemAt(s, t);
      const Rr = norm(sub([Math.cos(az), 0, Math.sin(az)], mul(T, dot([Math.cos(az), 0, Math.sin(az)], T))));
      const Z = cross(Rr, T);
      const q = quatFromBasis(Rr, T, Z);
      const bud = Math.max(0, (rho - 0.68) / 0.32);
      const L = L0 * (old ? 0.85 : 1) * (1 - (Sh.capitulum ? 0.8 : 0.62) * bud * (Sh.capitulum ? 1 : bud)) * rng.range(0.9, 1.08);
      // (instance : i0 insertion + L ; i1 repère ; i2 seuil de naissance de la
      // tige, rang, largeur, tirage ; i3 rayon de tige, sens, écartement,
      // vieille ; i4 pied (y), tige (x, z), serrement)
      const lv = Math.max(s.lod, lodOf(p, L));
      // (au loin, les feuilles du bas d'une tige serrée sont cachées dans le coussin)
      if ((lv === 2 || (spec.lite && lv === 1)) && rho < 0.35 && s.crowd > 0.5) return;
      leaves.push([p[0], p[1], p[2], L, q[0], q[1], q[2], q[3], s.b, rho, Lf.W * rng.range(0.88, 1.1) * (1 - 0.3 * bud), rng.next(), Sh.stemR * (1 - 0.35 * t), s.twist, old ? 0.3 : s.amp, old ? 1 : 0, s.yb, s.x, s.z, s.crowd, si, lv]);
    })();
  });
  // instances des feuilles par niveau de détail (LEAF_STRIDE flottants
  // chacune) ; leafInst : toutes, leafStem : la tige de chacune
  const leafInst = new Float32Array(Math.max(1, leaves.length) * LEAF_STRIDE), leafStem = new Int32Array(leaves.length);
  leaves.forEach((l, i) => { leafInst.set(l.slice(0, LEAF_STRIDE), i * LEAF_STRIDE); leafStem[i] = l[LEAF_STRIDE]; });
  const lods = [0, 1, 2].map((lv) => {
    const L = leaves.filter((l) => l[LEAF_STRIDE + 1] === lv), a = new Float32Array(Math.max(1, L.length) * LEAF_STRIDE);
    L.forEach((l, i) => a.set(l.slice(0, LEAF_STRIDE), i * LEAF_STRIDE));
    return { inst: a, count: L.length };
  });
  // perles d'eau : seulement les feuilles qui peuvent en porter une (scene/moss.js,
  // beadPosition : une feuille sur trois du haut, pas les vieilles), hors du lointain
  const fract = (v) => v - Math.floor(v);
  const BL = leaves.filter((l) => l[LEAF_STRIDE + 1] < 2 && l[15] < 0.5 && l[9] > 0.3 && fract(l[11] * 7.31) > 0.35);
  const beads = { inst: new Float32Array(Math.max(1, BL.length) * LEAF_STRIDE), count: BL.length };
  BL.forEach((l, i) => beads.inst.set(l.slice(0, LEAF_STRIDE), i * LEAF_STRIDE));

  // ── Sporophytes ──
  const SP = fam.spor, spors = [];
  const fr = spec.sporFrac ?? SP.frac;
  const cand = shoots.map((s, i) => i).filter((i) => shoots[i].r < 0.92).sort(() => 0);
  const rs = rng.fork('spor');
  // (assez espacés pour que deux capsules qui tournent ne se touchent pas)
  const minD = SP.kind === 'funaria' ? 0.55 : SP.kind === 'sphagnum' ? 0.5 : 0.6;
  for (const i of cand) {
    if (!rs.chance(fr) || spors.length >= (spec.lite ? 30 : 70)) continue;
    const s = shoots[i];
    if (spors.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < minD)) continue;
    const len = rs.range(...SP.seta) * (SP.kind === 'sphagnum' ? 1 : 0.85 + 0.15 * (s.H / Sh.height[1]));
    const { T } = stemAt(s, 1);
    const tilt = norm(add(T, [rs.range(-0.06, 0.06), 0, rs.range(-0.06, 0.06)]));
    const az = rs.range(0, Math.PI * 2);
    const X = norm(sub([Math.cos(az), 0, Math.sin(az)], mul(tilt, dot([Math.cos(az), 0, Math.sin(az)], tilt))));
    const q = quatFromBasis(X, tilt, cross(X, tilt));
    // (la soie sort du bourgeon : sa base est un peu sous le sommet)
    const base = sub(s.top, mul(T, 0.03));
    spors.push({ x: s.x, z: s.z, i, base, q, len, rnd: rs.next(), turns: SP.turns ? rs.range(...SP.turns) * (rs.chance(0.5) ? 1 : -1) : 0, open: rs.chance(SP.lid > 0 ? 1 - SP.lid : 1) ? 1 : 0 });
  }
  const sporInst = new Float32Array(spors.length * SPOR_STRIDE);
  spors.forEach((o, k) => sporInst.set([o.base[0], o.base[1], o.base[2], o.len, ...o.q, shoots[o.i].b, o.rnd, o.turns, o.open, o.i, shoots[o.i].yb, shoots[o.i].x, shoots[o.i].z], k * SPOR_STRIDE));

  // ── Tiges (géométrie fixe, fusionnée) ──
  const B = new Buffers(1 << 15);
  const sidRanges = [];
  shoots.forEach((s, si) => {
    const v0 = B.n;
    B.piece = Math.floor(s.rnd * 255);
    // (au loin : moins d'anneaux et de côtés)
    const pts = s.lod === 2 ? s.pts.filter((_, k) => k % 2 === 0) : s.pts.slice(0, NS + 1);
    // (tube effilé : on construit anneau par anneau ; surf.x : hauteur relative)
    const R0 = Sh.stemR;
    const M = pts.length, nr = spec.lite || s.lod === 2 ? 4 : s.lod === 1 ? 5 : 7;
    const Ts = pts.map((_, i) => norm(sub(pts[Math.min(M - 1, i + 1)], pts[Math.max(0, i - 1)])));
    let Nn = norm(cross(Ts[0], [1, 0, 0]));
    const rows = [];
    for (let i = 0; i < M; i++) {
      if (i) Nn = norm(cross(cross(Ts[i], Nn), Ts[i]));
      const Bn = cross(Ts[i], Nn), t = i / (M - 1), row = [];
      const rr = R0 * (1 - 0.4 * t) * (i === M - 1 ? 0.5 : 1);
      for (let k = 0; k < nr; k++) {
        const a = (2 * Math.PI * k) / nr, nv = add(mul(Nn, Math.cos(a)), mul(Bn, Math.sin(a)));
        row.push(B.vert(add(pts[i], mul(nv, rr)), nv, [Math.round(t * 255), 0, si % 256], Ts[i]));
      }
      rows.push(row);
    }
    B.grid(rows, true);
    sidRanges.push([v0, B.n, si]);
  });
  const stems = B.out();
  // (seuil de naissance et serrement de la tige, par sommet)
  stems.sb = new Float32Array((stems.position.length / 3) * 2);
  for (const [a, b, si] of sidRanges) for (let v = a; v < b; v++) stems.sb.set([shoots[si].b, shoots[si].crowd], v * 2);
  // (pied de chaque tige : la tige pousse et se rétracte autour de lui)
  stems.sbase = new Float32Array(stems.position.length);
  for (const [a, b, si] of sidRanges) for (let v = a; v < b; v++) stems.sbase.set([shoots[si].x, shoots[si].yb, shoots[si].z], v * 3);

  // maillage du feutre : posé sous la roche (caché), il s'épaissit avec la
  // mousse dans le shader (attribut th : son épaisseur quand le tapis est plein)
  const TB = new Buffers(1 << 14), ext = Rc * 1.15, step = spec.lite ? 0.09 : 0.05, NG = Math.ceil((2 * ext) / step);
  const rowsT = [], thA = [];
  for (let j = 0; j <= NG; j++) {
    const row = [];
    for (let i = 0; i <= NG; i++) {
      const x = -ext + i * step, z = -ext + j * step, y0 = sub0.y(x, z);
      row.push(TB.vert([x, y0 - 0.04, z], sub0.normal(x, z), [255, 0, 0]));
      // (le fond n'existe que sous des tiges : à moins d'une distance de tige
      // de la plus proche, sinon il reste sous la roche)
      let dn = Infinity;
      const gx = Math.floor(x / cs), gz = Math.floor(z / cs);
      for (let a = gx - 1; a <= gx + 1; a++) for (let c = gz - 1; c <= gz + 1; c++) for (const k of cellG.get(`${a},${c}`) ?? []) dn = Math.min(dn, Math.hypot(shoots[k].x - x, shoots[k].z - z));
      const under = 1 - sst(d * 0.8, d * 1.5, dn);
      // (sous un coussin en dôme : une natte de rhizoïdes à peine levée — le
      // fond du coussin, ce sont les tiges dans leur pénombre ; un fond levé
      // ferait falaise là où les tiges sont encore rares)
      thA.push((dome ? 0.07 : Math.max(0, turfY(x, z) - y0) + 0.04) * under);
    }
    rowsT.push(row);
  }
  TB.grid(rowsT);
  const turf = TB.out();
  turf.th = new Float32Array(thA);

  return {
    family: spec.family, n, d, reach, turf, tTurf: shoots.map((S) => S.tTurf),
    shoots: shoots.map((s) => ({ x: s.x, z: s.z, yb: s.yb, H: s.H, top: s.top, sky: s.sky, sun: s.sun, r: s.r, axis: s.axis, b: s.b, amp: s.amp, crowd: s.crowd, lod: s.lod, refuge: s.refuge })),
    nb, leafInst, leafStem, leafCount: leaves.length, lods, beads, sporInst, sporCount: spors.length,
    spors: spors.map((o) => ({ shoot: o.i, base: o.base, len: o.len, q: o.q, turns: o.turns, open: o.open })),
    stems,
  };
}
