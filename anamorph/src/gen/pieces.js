// Peupler la coque de vraies pièces : un assemblage de ferraille soudée
// (famille « ferronnerie », d'après Shigeo Fukuda). Vu de près, c'est un tas
// de profilés de récupération sans dessin ; son ombre ne devient une figure
// qu'aux deux heures choisies.
//
// Principe : couverture gloutonne, du gros au fin.
//  - Trois rangs de tailles : quelques grosses pièces de structure posées au
//    sol, puis des moyennes, puis des petites (un vrai assemblage a une
//    hiérarchie ; 400 barres de même calibre font un fagot artificiel).
//  - Des profilés réels : tube creux, rond à béton, fer carré, méplat, cornière.
//  - Aucune pièce n'en traverse une autre : chaque pièce part du flanc d'une
//    pièce déjà posée (soudure bout contre flanc) ou repose sur le sol, et
//    reste à distance de toutes les autres (rayon d'encombrement rc, celui du
//    coin le plus éloigné de l'axe). Test : test/pieces.test.mjs.
//  - On garde à chaque pas la candidate qui couvre le plus de cible encore
//    nue, en comptant seulement l'OMBRE PLEINE (le soleil fait 0,53° : la
//    pénombre d'un point à la hauteur y s'étale sur 2 · SUN_RADIUS · y / sin h).
//  - Toute pièce est dans la coque (distance signée ≤ −rc) : l'ombre ne
//    déborde jamais des cibles.
//
// Module pur (Node, worker). Repère de three.js (y vers le haut).
import { SUN_RADIUS, shadowOf, toFigure, fromFigure } from './shadowart.js';
import { axisAt, supportAt, pieceFrame } from './forge.js';

const G = 384, A0 = -0.05, AS = 1.1, B0 = -0.55, BS = 1.1; // grille de chaque figure (repère a, b)

// Profilés : rc (encombrement) et rcov (demi-largeur d'ombre créditée) en
// multiples du calibre r. Les cotes sont celles du maillage (worker.js).
export const PROFILES = {
  tube: { w: 0.25, rc: 1.0, rcov: 1.0 },      // tube creux, paroi 0,2 r
  rond: { w: 0.22, rc: 1.02, rcov: 1.0 },     // rond à béton
  carre: { w: 0.2, rc: 1.36, rcov: 1.05 },    // fer carré, demi-côté r, chanfreins
  plat: { w: 0.16, rc: 1.6, rcov: 0.85 },     // méplat 3 r × r
  corniere: { w: 0.17, rc: 1.56, rcov: 0.85 }, // cornière à ailes égales de 2 r, épaisseur 0,28 r
};
const KINDS = Object.keys(PROFILES);

// Accords de matières : chacun a ses profilés (poids), ses déformations et ses
// jonctions (voir forge.js) ; la matière elle-même est dans src/scene/objectMaterials.js.
export const ACCORDS = {
  rouille: { label: 'Ferraille rouillée', kinds: { tube: 0.25, rond: 0.22, carre: 0.2, plat: 0.16, corniere: 0.17 }, bend: { rond: 0.55, tube: 0.3, carre: 0.25, plat: 0.25, corniere: 0.1 }, crush: 0.35, joint: 'soudure' },
  bois: { label: 'Bois flotté', kinds: { rond: 0.75, plat: 0.25 }, bend: { rond: 0.35, plat: 0.15 }, bendMax: 0.45, crush: 0, joint: 'aucun', taper: true, rcov: 0.84 }, // (rcov : l'ombre réelle d'une branche amincie et sillonnée)
  cuivre: { label: 'Plomberie de cuivre', kinds: { tube: 0.65, rond: 0.35 }, bend: { tube: 0.3, rond: 0.45 }, crush: 0.2, joint: 'brasure' },
  peint: { label: 'Acier peint écaillé', kinds: { carre: 0.25, plat: 0.25, corniere: 0.25, tube: 0.25 }, bend: { carre: 0.2, plat: 0.25, corniere: 0.1, tube: 0.2 }, crush: 0.25, joint: 'soudure' },
  galva: { label: 'Acier galvanisé', kinds: { tube: 0.4, corniere: 0.3, plat: 0.3 }, bend: { tube: 0.15, corniere: 0.05, plat: 0.15 }, crush: 0.2, joint: 'soudure' },
};

export const TIERS = [
  { r: [0.042, 0.06], n: 9, ground: 0.75, len: [0.35, 1.3], aim: 3 }, // (la structure : des candidates libres, pour ses appuis au sol)
  { r: [0.022, 0.04], n: 170, ground: 0.1, len: [0.16, 0.9] },
  { r: [0.011, 0.024], n: 300, ground: 0.06, len: [0.1, 0.6] },
];

function makeRasters(F) {
  return F.map((f) => {
    const T = new Uint8Array(G * G), C = new Uint8Array(G * G);
    let n = 0;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const a = A0 + (j + 0.5) / G * AS, b = B0 + (i + 0.5) / G * BS;
      if (f.mask.at(a, b)) { T[j * G + i] = 1; n++; }
    }
    // poids : ce qui fait lire la figure, c'est son contour et ses parties
    // fines (oreilles, museau, bec) ; un trou au milieu, la pénombre le comble.
    // Distance au bord (chanfrein 3-4, en pixels) → poids 1 + 4 e^(−d/6).
    const D = new Float32Array(G * G);
    for (let q = 0; q < G * G; q++) D[q] = T[q] ? 1e9 : 0;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const q = j * G + i; if (!T[q]) continue;
      if (i > 0) D[q] = Math.min(D[q], D[q - 1] + 3); if (j > 0) D[q] = Math.min(D[q], D[q - G] + 3);
      if (i > 0 && j > 0) D[q] = Math.min(D[q], D[q - G - 1] + 4); if (i < G - 1 && j > 0) D[q] = Math.min(D[q], D[q - G + 1] + 4);
    }
    for (let j = G - 1; j >= 0; j--) for (let i = G - 1; i >= 0; i--) {
      const q = j * G + i; if (!T[q]) continue;
      if (i < G - 1) D[q] = Math.min(D[q], D[q + 1] + 3); if (j < G - 1) D[q] = Math.min(D[q], D[q + G] + 3);
      if (i < G - 1 && j < G - 1) D[q] = Math.min(D[q], D[q + G + 1] + 4); if (i > 0 && j < G - 1) D[q] = Math.min(D[q], D[q + G - 1] + 4);
    }
    const Wp = new Float32Array(G * G);
    let wsum = 0;
    for (let q = 0; q < G * G; q++) if (T[q]) { Wp[q] = 1 + 4 * Math.exp(-D[q] / 3 / 6); wsum += Wp[q]; }
    return { T, C, n, nc: 0, Wp, wsum, cov: 0 };
  });
}

// L'ombre franche : la bande où la pièce cache au moins DARK (70 %) du disque
// solaire. Modèle 1D (le disque comme une bande de demi-largeur ρ = α·L, la pièce
// comme une bande de demi-largeur r) : la part cachée vaut min(r/ρ, 1) sur
// |x| ≤ |ρ − r|, puis (r + ρ − |x|) / 2ρ. D'où la demi-largeur franche :
//   r ≥ DARK·ρ : max(|ρ − r| si r < ρ, r − (2·DARK − 1)·ρ) ; sinon 0.
// (Une pièce un peu plus fine que la pénombre garde une ombre nette et sombre ;
// exiger l'ombre pleine, 100 %, interdisait toute pièce dans le haut des figures.)
export const DARK = 0.7;
export function darkHalfWidth(r, rho) {
  if (r < DARK * rho) return 0;
  return Math.max(r < rho ? rho - r : 0, r - (2 * DARK - 1) * rho);
}

// Pixels de la cible que l'ombre pleine de la pièce couvrirait (et les marque si mark).
function stamp(f, Rr, p0, p1, r, mark) {
  const s = Math.sin(f.sun.h);
  const [ga, gb] = toFigure(f, ...shadowOf(f, ...p0)), [ha, hb] = toFigure(f, ...shadowOf(f, ...p1));
  const len = Math.hypot((ha - ga) / AS * G, (hb - gb) / BS * G);
  const steps = Math.max(1, Math.ceil(len / 0.7));
  let gain = 0;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const y = p0[1] + (p1[1] - p0[1]) * t;
    const ru = darkHalfWidth(r, SUN_RADIUS * y / s); // demi-largeur de l'ombre franche
    if (ru <= 0) continue;
    const ca = ga + (ha - ga) * t, cb = gb + (hb - gb) * t;
    const rb = ru / f.scale, ra = ru / s / f.scale;
    const j0 = Math.max(0, Math.floor((ca - ra - A0) / AS * G)), j1 = Math.min(G - 1, Math.ceil((ca + ra - A0) / AS * G));
    const i0 = Math.max(0, Math.floor((cb - rb - B0) / BS * G)), i1 = Math.min(G - 1, Math.ceil((cb + rb - B0) / BS * G));
    for (let j = j0; j <= j1; j++) {
      const da = (A0 + (j + 0.5) / G * AS - ca) / ra;
      for (let i = i0; i <= i1; i++) {
        const db = (B0 + (i + 0.5) / G * BS - cb) / rb;
        if (da * da + db * db > 1) continue;
        const q = j * G + i;
        if (Rr.T[q] && !Rr.C[q]) { gain += Rr.Wp[q]; if (mark) { Rr.C[q] = 1; Rr.nc++; } }
      }
    }
  }
  return gain;
}

function inside(sdf, p0, p1, r) {
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const n = Math.max(2, Math.ceil(L / 0.015));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    // (le sol est vérifié à part, d'après la vraie section : ici, la coque seule)
    if (sdf(p0[0] + (p1[0] - p0[0]) * t, Math.max(r + 1e-3, p0[1] + (p1[1] - p0[1]) * t), p0[2] + (p1[2] - p0[2]) * t) > -r) return false;
  }
  return true;
}

// Longueur, depuis le bout soudé, où une pièce peut encore toucher sa mère.
export const jointZone = (rc, rcParent) => 0.6 * (rc + rcParent);

// Distance entre deux segments [p0, p1] et [q0, q1].
export function segDist(p0, p1, q0, q1) {
  const d1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], d2 = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]];
  const r = [p0[0] - q0[0], p0[1] - q0[1], p0[2] - q0[2]];
  const a = d1[0] ** 2 + d1[1] ** 2 + d1[2] ** 2, e = d2[0] ** 2 + d2[1] ** 2 + d2[2] ** 2;
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2], b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
  const den = a * e - b * b;
  let s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
  const x = r[0] + d1[0] * s - d2[0] * t, y = r[1] + d1[1] * s - d2[1] * t, z = r[2] + d1[2] * s - d2[2] * t;
  return Math.hypot(x, y, z);
}

// Grille d'accélération pour les distances entre pièces (cellules de 20 cm ;
// dédoublonnage par marques, sans Set : c'est la boucle la plus chaude).
function makeGrid(cell = 0.2) {
  const cells = new Map();
  const key = (i, j, k) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
  let mark = new Int32Array(1024), stamp = 0;
  const range = (p0, p1, m) => [0, 1, 2].map((d) => [Math.floor((Math.min(p0[d], p1[d]) - m) / cell), Math.floor((Math.max(p0[d], p1[d]) + m) / cell)]);
  return {
    add(id, p0, p1, m) {
      if (id >= mark.length) { const b = new Int32Array(mark.length * 2); b.set(mark); mark = b; }
      const R = range(p0, p1, m);
      for (let i = R[0][0]; i <= R[0][1]; i++) for (let j = R[1][0]; j <= R[1][1]; j++) for (let k = R[2][0]; k <= R[2][1]; k++) {
        const kk = key(i, j, k); let l = cells.get(kk); if (!l) cells.set(kk, (l = [])); l.push(id);
      }
    },
    near(p0, p1, m) {
      const R = range(p0, p1, m), out = [];
      stamp++;
      for (let i = R[0][0]; i <= R[0][1]; i++) for (let j = R[1][0]; j <= R[1][1]; j++) for (let k = R[2][0]; k <= R[2][1]; k++) {
        const l = cells.get(key(i, j, k));
        if (l) for (const id of l) if (mark[id] !== stamp) { mark[id] = stamp; out.push(id); }
      }
      return out;
    },
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const nrm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// rnd : tirages de la graine ; bounds : [x0, 0, z0, x1, h, z1] (emprise de la coque)
export function coverWithPieces(F, sdf, bounds, rnd, { target = 0.97, cands = 120, onStep = null, accord = 'rouille', aimEvery = 1, nTargets = 16, tiers = TIERS, stallMax = 40, stats = null } = {}) {
  const AC = ACCORDS[accord] ?? ACCORDS.rouille;
  const Rr = makeRasters(F);
  const pieces = [];
  const grid = makeGrid();
  const RCMAX = 0.06 * 1.6;
  const kinds = Object.entries(AC.kinds), wsum = kinds.reduce((a, [, w]) => a + w, 0);
  const pickKind = () => { let x = rnd() * wsum; for (const [k, w] of kinds) if ((x -= w) <= 0) return k; return kinds[0][0]; };
  const randDir = () => { const u = rnd() * 2 - 1, t = rnd() * 2 * Math.PI, c = Math.sqrt(1 - u * u); return [c * Math.cos(t), u, c * Math.sin(t)]; };
  const clear = (p0, p1, rc, skip) => {
    for (const id of grid.near(p0, p1, rc + RCMAX)) {
      if (id === skip) continue;
      const o = pieces[id];
      if (segDist(p0, p1, o.p0, o.p1) < rc + o.rc + 0.002) return false;
    }
    return true;
  };
  // calibre minimal pour porter une ombre pleine depuis la hauteur y (soleil le plus bas)
  const sinMin = Math.min(...F.map((f) => Math.sin(f.sun.h)));
  const rMinAt = (y) => 1.05 * DARK * SUN_RADIUS * y / sinMin; // (en dessous : pas d'ombre franche)
  // un pixel nu de la cible k (tiré selon son poids), remonté le long du rayon
  // de soleil jusqu'à un point de la coque où une pièce de rayon r tiendrait
  // (cumuls des poids nus, refaits une fois par pas : tirage par dichotomie)
  const cum = F.map(() => ({ idx: new Int32Array(G * G), acc: new Float32Array(G * G), n: 0 }));
  function rebuildCum() {
    Rr.forEach((R, k) => {
      const C = cum[k]; let t = 0, n = 0;
      for (let q = 0; q < G * G; q++) if (R.T[q] && !R.C[q]) { t += R.Wp[q]; C.idx[n] = q; C.acc[n++] = t; }
      C.n = n;
    });
  }
  function targetPoint(k) {
    const C = cum[k], f = F[k];
    if (!C.n) return null;
    const x = rnd() * C.acc[C.n - 1];
    let lo = 0, hi = C.n - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (C.acc[m] < x) lo = m + 1; else hi = m; }
    const q = C.idx[lo];
    const j = Math.floor(q / G), i = q % G;
    const [gx, gz] = fromFigure(f, A0 + (j + 0.5) / G * AS, B0 + (i + 0.5) / G * BS);
    const d = f.sun.d, H = bounds[4];
    const ok = [];
    for (let t = 0.02 / d[1]; t * d[1] < H; t += 0.02 / d[1]) {
      const T = [gx + t * d[0], t * d[1], gz + t * d[2]], r = rMinAt(T[1]);
      if (sdf(T[0], Math.max(T[1], r * 1.4), T[2]) <= -r * 1.4) ok.push(T);
    }
    return ok.length ? ok[Math.floor(rnd() * ok.length)] : null;
  }
  // l'assise : les points du sol où une pièce d'appui tient (distance à la paroi
  // de la coque mesurée à 3,5 cm de haut, sur une grille de 1 cm)
  const base = [];
  for (let x = bounds[0]; x <= bounds[3]; x += 0.01) for (let z = bounds[2]; z <= bounds[5]; z += 0.01) {
    const room = -sdf(x, 0.035, z);
    if (room > 0.02) base.push([x, z, room]);
  }
  let steps = 0;
  for (const [ti, tier] of tiers.entries()) {
    let placed = 0, stall = 0;
    if (stats) stats[`palier${ti}`] = 'plafond';
    while (placed < tier.n && !Rr.every((x) => x.cov >= target)) {
      const W = Rr.map((x) => 1 / (x.cov + 0.05) ** 2);
      let best = null;
      // quelques candidates poussent vers un point du contour encore nu
      const targets = [];
      if (pieces.length && (steps++ & 3) === 0) rebuildCum(); // (les points visés vieillissent de quatre pas au plus)
      if (pieces.length) for (let k = 0; k < nTargets; k++) { const T = targetPoint(k % F.length); if (T) targets.push(T); }
      for (let c = 0; c < cands; c++) {
        const kind = pickKind(), P = PROFILES[kind];
        const ae = tier.aim ?? aimEvery; // (moyennes et petites : toutes visent un pixel nu du contour)
        const aim = targets.length && c % ae === 0 ? targets[(c / ae) % targets.length | 0] : null;
        let r = tier.r[0] + (tier.r[1] - tier.r[0]) * rnd();
        if (aim) r = Math.min(tier.r[1] * 1.4, Math.max(r, rMinAt(aim[1])));
        const roll = rnd() * Math.PI;
        const onGround = !pieces.length || (!aim && rnd() < tier.ground);
        // déformations de la ferraille : ronds et fers cintrés, tubes écrasés à
        // un bout (pas pour les pièces posées au sol : elles doivent porter)
        let bend = null, crush = null;
        if (!onGround) {
          const pb = AC.bend[kind] ?? 0;
          if (rnd() < pb) bend = { s: r * Math.min(AC.bendMax ?? 9, kind === 'rond' ? 0.3 + 1.3 * rnd() : 0.2 + 0.6 * rnd()), dir: rnd() * 2 * Math.PI };
          if (kind === 'tube' && rnd() < AC.crush) crush = { c: 0.15 + 0.3 * rnd(), end: rnd() < 0.5 ? 0 : 1 };
        }
        // posée au sol : un point d'appui dans l'assise de la coque (qui peut être
        // étroite : les figures ne se recouvrent qu'au pied), et un calibre qui y tient
        let ga = null;
        if (onGround) {
          if (!base.length) continue;
          const b = base[Math.floor(rnd() * base.length)];
          ga = { q: [b[0] + (rnd() - 0.5) * 0.01, 0, b[1] + (rnd() - 0.5) * 0.01], room: b[2] };
          r = Math.min(r, (0.85 * ga.room) / P.rc);
        }
        // encombrement : coin le plus éloigné, ovalisation, flèche du cintrage
        const rc = r * P.rc * (1 + (crush?.c ?? 0)) + (bend?.s ?? 0);
        let a, d, parent = -1;
        if (onGround) {
          // posée au sol : son bout bas touche la neige (hauteur réglée plus bas, d'après la section)
          a = ga.q;
          d = randDir(); d[1] = Math.abs(d[1]) * (rnd() < 0.5 ? 0.25 : 1); d = nrm(d);
          // assise étroite (la coque s'évase en montant) : la pièce d'appui monte en poteau
          if (ga.room < 0.09 || rnd() < 0.35) { const h = 0.55 + 0.45 * rnd(), k = Math.sqrt(1 - h * h), t = rnd() * 2 * Math.PI; d = [k * Math.cos(t), h, k * Math.sin(t)]; }
          const probe = { kind, r, roll, p0: [0, 0, 0], p1: d };
          a[1] = supportAt(probe, [0, -1, 0]) + 0.0005;
        } else if (aim) {
          // pousse vers le point visé, depuis la pièce posée la plus proche
          let bd = 0.7;
          // (voisinage proche d'abord : la recherche à 70 cm coûtait le tiers du peuplement)
          for (const rad of [0.25, 0.7]) {
            for (const id of grid.near(aim, aim, rad)) { const dd = segDist(aim, aim, pieces[id].p0, pieces[id].p1); if (dd < bd) { bd = dd; parent = id; } }
            if (parent >= 0) break;
          }
          if (parent < 0) continue;
          const o = pieces[parent], X = pieceFrame(o).X, Lo = Math.hypot(...sub(o.p1, o.p0));
          const t = Math.min(0.95, Math.max(0.05, ((aim[0] - o.p0[0]) * X[0] + (aim[1] - o.p0[1]) * X[1] + (aim[2] - o.p0[2]) * X[2]) / Lo + (rnd() - 0.5) * 0.2));
          const q = axisAt(o, t), v = sub(aim, q), vx = v[0] * X[0] + v[1] * X[1] + v[2] * X[2];
          const n = nrm([v[0] - vx * X[0], v[1] - vx * X[1], v[2] - vx * X[2]]);
          const off = supportAt(o, n, t) + 0.15 * r;
          a = [q[0] + n[0] * off, q[1] + n[1] * off, q[2] + n[2] * off];
          const rd = randDir();
          d = nrm([aim[0] - a[0] + rd[0] * 0.04, aim[1] - a[1] + rd[1] * 0.04, aim[2] - a[2] + rd[2] * 0.04]);
          if (d[0] * n[0] + d[1] * n[1] + d[2] * n[2] < 0.5) continue;
          if (a[1] - supportAt({ kind, r, roll, p0: [0, 0, 0], p1: d }, [0, -1, 0]) < 0) continue;
        } else {
          // soudée bout contre flanc sur la VRAIE surface d'une pièce déjà posée
          parent = Math.floor(rnd() * pieces.length);
          const o = pieces[parent];
          const t = 0.08 + 0.84 * rnd();
          const ax = pieceFrame(o).X, q = axisAt(o, t);
          const n = nrm(crs(ax, randDir()));
          // le bout de la nouvelle pièce affleure le flanc de la mère (la soudure noie le reste)
          const off = supportAt(o, n, t) + 0.15 * r;
          a = [q[0] + n[0] * off, q[1] + n[1] * off, q[2] + n[2] * off];
          const rd = randDir();
          d = nrm([n[0] + rd[0] * 0.5, n[1] + rd[1] * 0.5, n[2] + rd[2] * 0.5]);
          if (d[0] * n[0] + d[1] * n[1] + d[2] * n[2] < 0.75) continue;
          // (le bout n'entre pas dans la neige)
          if (a[1] - supportAt({ kind, r, roll, p0: [0, 0, 0], p1: d }, [0, -1, 0]) < 0) continue;
        }
        if (sdf(a[0], Math.max(rc + 1e-3, a[1]), a[2]) > -rc) continue;
        // longueur : jusqu'au bord de la coque ou au sol, puis une part tirée
        let L = 0;
        while (L < tier.len[1]) {
          const s = L + 0.02, qq = [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s];
          if (qq[1] < 0.6 * rc || sdf(qq[0], Math.max(rc + 1e-3, qq[1]), qq[2]) > -rc) break;
          L = s;
        }
        if (aim) L = Math.min(L, Math.hypot(...sub(aim, a)) + 0.03 + 0.12 * rnd());
        else L *= 0.6 + 0.4 * rnd();
        if (L < tier.len[0]) continue;
        const p1 = [a[0] + d[0] * L, a[1] + d[1] * L, a[2] + d[2] * L];
        // trop fine pour sa hauteur : pas d'ombre pleine, elle ne ferait que prendre la place
        if (r < 0.85 * rMinAt(Math.max(a[1], p1[1]))) continue;
        // (la jonction : on ne teste la mère qu'au-delà de la zone où les deux
        // encombrements se recouvrent forcément, rc + rc_mère le long de la pièce)
        const jz = parent >= 0 ? jointZone(rc, pieces[parent].rc) : 0;
        const a2 = [a[0] + d[0] * jz, a[1] + d[1] * jz, a[2] + d[2] * jz];
        if (!inside(sdf, a, p1, rc)) continue;
        // la vraie section (cintrage compris) reste au-dessus de la neige
        const cand = { kind, r, roll, p0: a, p1, bend, crush, taper: !!AC.taper };
        let low = Infinity;
        for (let k = 0; k <= 16; k++) low = Math.min(low, axisAt(cand, k / 16)[1] - supportAt(cand, [0, -1, 0], k / 16));
        if (onGround) { a[1] -= low - 0.0003; p1[1] -= low - 0.0003; } // (posée : son point le plus bas touche la neige)
        else if (low < 0) continue;
        if (!clear(a, p1, rc, parent) || (parent >= 0 && segDist(a2, p1, pieces[parent].p0, pieces[parent].p1) < rc + pieces[parent].rc + 0.002)) continue;
        let score = 0;
        F.forEach((f, k) => { score += W[k] * stamp(f, Rr[k], a, p1, r * P.rcov * (AC.rcov ?? 1), false) / Rr[k].wsum; });
        score /= 1 + 0.1 * L;
        if (!best || score > best.score) best = { score, p0: a, p1, r, rc, kind, parent, roll, bend, crush };
      }
      if (!best || best.score < 1e-5) { if (++stall > stallMax) { if (stats) stats[`palier${ti}`] = 'calé'; break; } continue; }
      stall = 0;
      F.forEach((f, k) => { stamp(f, Rr[k], best.p0, best.p1, best.r * PROFILES[best.kind].rcov * (AC.rcov ?? 1), true); });
      Rr.forEach((x) => { x.cov = x.nc / x.n; }); // (compte tenu à jour par stamp)
      grid.add(pieces.length, best.p0, best.p1, best.rc);
      pieces.push({ kind: best.kind, p0: best.p0, p1: best.p1, r: best.r, rc: best.rc, parent: best.parent, roll: best.roll, bend: best.bend, crush: best.crush, taper: !!AC.taper });
      placed++;
      onStep?.(pieces.length, Rr.map((x) => x.cov), pieces[pieces.length - 1]);
    }
  }
  if (stats) stats.rasters = Rr.map((x) => ({ T: x.T, C: x.C, G }));
  return { pieces, coverage: Rr.map((x) => x.cov) };
}
