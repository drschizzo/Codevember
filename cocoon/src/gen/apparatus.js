// L'appareil : colonne, fléau, deux stations (axe, cage, lampe), ailettes en C
// avec chariot et œil. Et la cinématique de l'œil, déduite du fil : l'œil est
// sur la tangente au ruban au point de pose, assez loin pour être hors du cocon
// plein ; l'ailette suit son azimut, le chariot sa hauteur sur le rail.
//
// Repères : monde (sol y = 0) ; fléau (pivot de la colonne, tourne autour de
// y) ; station (centre de la cage à l'origine, axe y). Module pur.
import { Buffers, lathe, tube, roundedBox, sphere, torus, OUT, EDGE, norm, sub, add, mul, cross } from '../../../shared/gen/mesh.js';
import { wallPoint } from './profile.js';

const TAU = Math.PI * 2;

// Dimensions communes (m), tirées du profil
export function layout(P) {
  const yc = 1.2;                    // hauteur du centre des cages
  const L = 0.44;                    // demi-longueur du fléau (entraxe 0,88 m)
  const top = P.H / 2;               // pôle haut (station)
  const yBeam = yc + top + 0.2;      // hauteur du fléau
  return { yc, L, top, bot: -P.H / 2, yBeam, axisTop: yBeam - yc - 0.035 };
}

// ── Cinématique de l'œil ─────────────────────────────────────────────────────
// L'ailette porte un rail qui épouse le cocon plein à `gap` de distance (une
// ailette de rouet) ; le chariot y coulisse, l'œil est sur le chariot. Le brin
// libre, tendu, va droit du point de pose à l'œil, tangent au ruban : l'œil
// est donc là où la tangente au ruban rencontre la surface du rail. Lissé le
// long du chemin (l'ailette tourne d'un mouvement continu), puis ramené sur le
// rail ; un brin qui traverserait le cocon garde l'œil brut.
export function eyeTable(P, band, env, grid, opts = {}) {
  const { gap = 0.05, spinneret = false } = opts;
  const m = band.pos.length / 3;
  // enveloppe du cocon plein (plan méridien), puis le rail : sa courbe décalée
  const N = grid.Ns, ER = new Float64Array(N), EY = new Float64Array(N);
  const q = [0, 0, 0];
  for (let i = 0; i < N; i++) { wallPoint(P, (i + 0.5) * grid.cs, 0, env[i], q); ER[i] = q[0]; EY[i] = q[1]; }
  const nr = 240, RP = [];
  for (let k = 0; k < nr; k++) {
    const i = Math.min(N - 1, Math.round((k / (nr - 1)) * (N - 1)));
    const a = Math.max(0, i - 3), b = Math.min(N - 1, i + 3);
    const tr = ER[b] - ER[a], ty = EY[b] - EY[a], l = Math.hypot(tr, ty) || 1;
    RP.push([ER[i] + (ty / l) * gap, EY[i] - (tr / l) * gap]);
  }
  // lissage du rail (pas de rebroussement à la taille d'une arachide)
  for (let it = 0; it < 6; it++) for (let k = 1; k < nr - 1; k++) RP[k] = [(RP[k - 1][0] + 2 * RP[k][0] + RP[k + 1][0]) / 4, (RP[k - 1][1] + 2 * RP[k][1] + RP[k + 1][1]) / 4];
  for (const p of RP) p[0] = Math.max(p[0], P.hub + 0.03);
  // garde : le lissage rentre le rail aux angles des calottes polaires ; on le
  // repousse à 0,8 × l'écart de l'enveloppe, puis on relisse un peu
  for (let round = 0; round < 6; round++) {
    for (const p of RP) {
      let bd = 1e9, bx = 0, by = 0;
      for (let i = 0; i < N; i += 2) { const d = Math.hypot(p[0] - ER[i], p[1] - EY[i]); if (d < bd) { bd = d; bx = ER[i]; by = EY[i]; } }
      if (bd < gap * 0.8) { const k = (gap * 0.8) / Math.max(1e-6, bd); p[0] = bx + (p[0] - bx) * k; p[1] = by + (p[1] - by) * k; }
    }
    if (round < 5) for (let k = 1; k < nr - 1; k++) RP[k] = [(RP[k - 1][0] + 2 * RP[k][0] + RP[k + 1][0]) / 4, (RP[k - 1][1] + 2 * RP[k][1] + RP[k + 1][1]) / 4];
  }
  const nearestRail = (rho, y) => {
    let best = 0, bd = 1e9;
    for (let k = 0; k < nr; k++) { const d = (RP[k][0] - rho) ** 2 + (RP[k][1] - y) ** 2; if (d < bd) { bd = d; best = k; } }
    // raffinement linéaire entre voisins
    const k0 = Math.max(0, Math.min(nr - 2, best - (best > 0 ? 1 : 0)));
    let bu = best, bdd = bd;
    for (let k = k0; k < Math.min(nr - 1, k0 + 2); k++) for (let t = 0; t <= 1; t += 0.05) {
      const x = RP[k][0] + (RP[k + 1][0] - RP[k][0]) * t, z = RP[k][1] + (RP[k + 1][1] - RP[k][1]) * t;
      const d = (x - rho) ** 2 + (z - y) ** 2; if (d < bdd) { bdd = d; bu = k + t; }
    }
    return bu;
  };
  const railAt = (u) => { const k = Math.min(nr - 2, Math.max(0, Math.floor(u))), t = u - k; return [RP[k][0] + (RP[k + 1][0] - RP[k][0]) * t, RP[k][1] + (RP[k + 1][1] - RP[k][1]) * t]; };
  // dedans / dehors de l'enveloppe et du rail (rayon du profil à la hauteur y)
  const radAt = (arrR, arrY, y) => {
    if (y <= arrY[0] || y >= arrY[arrY.length - 1]) return -1;
    let lo = 0, hi = arrY.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arrY[mid] < y) lo = mid; else hi = mid; }
    const f = (y - arrY[lo]) / Math.max(1e-9, arrY[hi] - arrY[lo]);
    return arrR[lo] + (arrR[hi] - arrR[lo]) * f;
  };
  const RR = RP.map((p) => p[0]), RY = RP.map((p) => p[1]);
  const insideEnv = (rho, y) => rho < radAt(ER, EY, y) + 0.004;
  // profil nu (la cage), pour la paroi telle qu'elle est au moment du passage
  const BR = new Float64Array(N), BY = new Float64Array(N);
  for (let i = 0; i < N; i++) { wallPoint(P, (i + 0.5) * grid.cs, 0, 0, q); BR[i] = q[0]; BY[i] = q[1]; }
  const insideNow = (rho, y, h) => rho < radAt(BR, BY, y) + h;
  const insideRail = (rho, y) => rho < radAt(RR, RY, y);
  // 1. intersection de la tangente avec la surface du rail
  const Eraw = new Float64Array(m * 3);
  for (let j = 0; j < m; j++) {
    const px = band.pos[j * 3], py = band.pos[j * 3 + 1], pz = band.pos[j * 3 + 2];
    const tx = band.tan[j * 3], ty = band.tan[j * 3 + 1], tz = band.tan[j * 3 + 2];
    let d = 0.01;
    for (; d < 0.4; d += 0.003) {
      const x = px + tx * d, y = py + ty * d, z = pz + tz * d;
      if (!insideRail(Math.hypot(x, z), y)) break;
    }
    Eraw[j * 3] = px + tx * d; Eraw[j * 3 + 1] = py + ty * d; Eraw[j * 3 + 2] = pz + tz * d;
  }
  const chordClear = (j, x, y, z) => {
    const px = band.pos[j * 3], py = band.pos[j * 3 + 1], pz = band.pos[j * 3 + 2];
    // (près du point de pose, le brin est tangent : on ne contrôle qu'au-delà)
    for (let t = 0.4; t <= 1.0001; t += 0.05) {
      const qx = px + (x - px) * t, qy = py + (y - py) * t, qz = pz + (z - pz) * t;
      if (insideNow(Math.hypot(qx, qz) + 0.003, qy, band.hgt[j])) return false;
    }
    return true;
  };
  // 2. l'ailette tourne d'un mouvement continu : azimut et position du chariot
  // lissés le long du chemin (σ en points de 3 mm) ; aux rebroussements
  // polaires, le chariot ne fouette pas, il précède ou suit le point de pose
  const unwrap = (arr) => { const o = new Float64Array(m); let prev = 0; for (let j = 0; j < m; j++) { let a = arr[j]; if (j) { while (a - prev > Math.PI) a -= TAU; while (a - prev < -Math.PI) a += TAU; } o[j] = prev = a; } return o; };
  const smooth1 = (src, sig) => {
    const out = new Float64Array(m), K = Math.ceil(3 * sig), w = [];
    for (let k = -K; k <= K; k++) w.push(Math.exp(-(k * k) / (2 * sig * sig)));
    for (let j = 0; j < m; j++) { let a0 = 0, ws = 0; for (let k = -K; k <= K; k++) { const jj = Math.min(m - 1, Math.max(0, j + k)), ww = w[k + K]; a0 += src[jj] * ww; ws += ww; } out[j] = a0 / ws; }
    return out;
  };
  const az = new Float64Array(m), ur = new Float64Array(m);
  for (let j = 0; j < m; j++) { const x = Eraw[j * 3], y = Eraw[j * 3 + 1], z = Eraw[j * 3 + 2]; az[j] = Math.atan2(z, x); ur[j] = nearestRail(Math.hypot(x, z), y); }
  const psi = smooth1(unwrap(az), spinneret ? 40 : (opts.sigPsi ?? 22)), U = smooth1(ur, spinneret ? 30 : (opts.sigU ?? 14));
  // 3. le chariot sur le rail ; l'œil : sur le chariot, ou (filière du huit) au
  // bout d'une filière qui frôle la paroi et bat en huit
  const S = new Float64Array(m * 3), C = new Float64Array(m * 3);
  let crossing = 0;
  for (let j = 0; j < m; j++) {
    const [rr, ry] = railAt(U[j]);
    C[j * 3] = rr * Math.cos(psi[j]); C[j * 3 + 1] = ry; C[j * 3 + 2] = rr * Math.sin(psi[j]);
    if (spinneret) {
      const px = band.pos[j * 3], py = band.pos[j * 3 + 1], pz = band.pos[j * 3 + 2];
      const tx = band.tan[j * 3], ty = band.tan[j * 3 + 1], tz = band.tan[j * 3 + 2];
      // normale extérieure approchée : du centre de la cage vers le point
      const l = Math.hypot(px, py * 0.8, pz) || 1, nx = px / l, ny = (py * 0.8) / l, nz = pz / l;
      S[j * 3] = px + nx * 0.016 + tx * 0.008; S[j * 3 + 1] = py + ny * 0.016 + ty * 0.008; S[j * 3 + 2] = pz + nz * 0.016 + tz * 0.008;
    } else {
      S[j * 3] = C[j * 3]; S[j * 3 + 1] = C[j * 3 + 1]; S[j * 3 + 2] = C[j * 3 + 2];
      if (!chordClear(j, S[j * 3], S[j * 3 + 1], S[j * 3 + 2])) crossing++;
    }
  }
  const fallback = crossing;
  return {
    eye: Float32Array.from(S), carriage: Float32Array.from(C), psi: Float32Array.from(psi), rail: Float32Array.from(U), railPts: Float32Array.from(RP.flat()), spinneret,
    gap, fallback, envR: Float32Array.from(ER), envY: Float32Array.from(EY),
  };
}

// ── Géométrie ────────────────────────────────────────────────────────────────
// Rôles : chaque constructeur rend un objet { rôle: tampons } ; la scène pose
// une matière par rôle.
const zToY = (B) => B.frame([0, 0, 0], [1, 0, 0], [0, 0, -1], [0, 1, 0]); // (lathe tourne autour de z)

// profil de révolution à partir de (r, y) et de normales calculées
function revolve(B, pts, M = 48, s = OUT) {
  const prof = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1;
    prof.push({ r: pts[i][0], z: pts[i][1], nr: dy / l, nz: -dr / l, s: pts[i][2] ?? s });
  }
  zToY(B); lathe(B, prof, M); B.noFrame();
}
// moulure : suite de tores et de cylindres (profil d'arcs)
function arcPts(cx, cy, r, a0, a1, n) {
  const o = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return o;
}

// Colonne (monde) : socle tourné en trois gradins, fût cannelé, chapiteau-palier
export function buildColumn(lay) {
  const wood = new Buffers(), metal = new Buffers();
  const yTop = lay.yBeam - 0.045;
  // socle (bois) : trois gradins arrondis
  const base = [[0, 0], [0.24, 0], ...arcPts(0.24, 0.012, 0.012, -Math.PI / 2, Math.PI / 2, 6), [0.2, 0.024], ...arcPts(0.2, 0.034, 0.01, -Math.PI / 2, Math.PI / 2, 6),
    [0.16, 0.044], ...arcPts(0.16, 0.058, 0.014, -Math.PI / 2, Math.PI / 2, 8), [0.07, 0.072], ...arcPts(0.07, 0.09, 0.018, -Math.PI / 2, 0, 5), [0.052, 0.11]];
  revolve(wood, base.map(([r, y]) => [r, y]), 64);
  // fût (métal de structure) : légèrement galbé
  const shaft = [];
  for (let i = 0; i <= 30; i++) { const t = i / 30, y = 0.11 + (yTop - 0.11) * t; shaft.push([0.03 + 0.008 * Math.sin(Math.PI * t) * (1 - t * 0.5) + (t < 0.05 ? (0.05 - t) * 0.4 : 0), y]); }
  revolve(metal, [[0.0, 0.11], [0.05, 0.11], ...shaft, ...arcPts(0.034, yTop + 0.012, 0.012, -Math.PI / 2, Math.PI / 2, 6), [0.045, yTop + 0.024], [0.045, yTop + 0.04], [0, yTop + 0.04]], 48);
  // cannelures : filets en relief le long du fût
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU, pts = [];
    for (let i = 2; i <= 28; i++) { const t = i / 30, y = 0.11 + (yTop - 0.11) * t, r = 0.03 + 0.008 * Math.sin(Math.PI * t) * (1 - t * 0.5); pts.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
    tube(metal, pts, 0.0025, 6, OUT, true);
  }
  return { wood: wood.out(), structure: metal.out() };
}

// Fléau (repère du fléau, pivot à l'origine = sommet de la colonne) : poutre à
// congés, embouts en olive, paliers des stations, poulies
export function buildBeam(lay) {
  const st = new Buffers(), fit = new Buffers(), wood = new Buffers();
  const L = lay.L, y0 = 0;
  roundedBox(st, [0, y0, 0], [L + 0.07, 0.018, 0.016], 0.006, 4, EDGE, OUT, [1, 0, 0]);
  // moyeu central
  st.frame([0, y0, 0], [1, 0, 0], [0, 0, -1], [0, 1, 0]);
  lathe(st, [{ r: 0, z: -0.03, nr: 0, nz: -1, s: OUT }, { r: 0.04, z: -0.03, nr: 0, nz: -1, s: OUT }, { r: 0.04, z: -0.03, nr: 1, nz: 0, s: EDGE }, { r: 0.04, z: 0.03, nr: 1, nz: 0, s: EDGE }, { r: 0.04, z: 0.03, nr: 0, nz: 1, s: OUT }, { r: 0, z: 0.03, nr: 0, nz: 1, s: OUT }], 40);
  st.noFrame();
  for (const sx of [-1, 1]) {
    // embout en olive (bois) : un ellipsoïde au bout du fléau
    wood.frame([sx * (L + 0.1), y0, 0], [0.032 * sx, 0, 0], [0, 0.022, 0], [0, 0, 0.022]);
    sphere(wood, [0, 0, 0], 1, 32, 18, OUT);
    wood.noFrame();
    // palier de la station : bloc sous le fléau, axe qui descend
    const cx = sx * L;
    roundedBox(fit, [cx, y0 - 0.026, 0], [0.026, 0.014, 0.026], 0.005, 3, EDGE, OUT);
    // poulie (au-dessus du bloc, à l'intérieur) : roue à gorge sur sa chape
    fit.frame([cx - sx * 0.05, y0 + 0.032, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    torus(fit, [0, 0, 0], 0.016, 0.004, 40, 10, EDGE);
    lathe(fit, [{ r: 0, z: -0.004, nr: 0, nz: -1, s: OUT }, { r: 0.014, z: -0.004, nr: 0, nz: -1, s: OUT }, { r: 0.014, z: 0.004, nr: 0, nz: 1, s: OUT }, { r: 0, z: 0.004, nr: 0, nz: 1, s: OUT }], 32);
    fit.noFrame();
    roundedBox(fit, [cx - sx * 0.05, y0 + 0.016, 0], [0.004, 0.018, 0.012], 0.002, 2, EDGE, OUT);
  }
  return { structure: st.out(), fittings: fit.out(), wood: wood.out() };
}

// Station (repère de la station) : axe, moyeux, côtes de la cage, douille et
// ampoule, palier haut et bas de l'ailette
export function buildStation(P, lay, cage) {
  const fit = new Buffers(), wire = new Buffers(), glass = new Buffers(), fil = new Buffers();
  const { top, bot } = lay;
  const hub = P.hub;
  // axe : du palier du fléau au moyeu haut
  tube(fit, [[0, lay.axisTop + 0.02, 0], [0, top + 0.006, 0]], 0.0055, 16, OUT, false);
  // moyeux (rosaces) : disque à bord roulé, aux deux pôles
  for (const [y, sgn] of [[P.yAt(P.sHi), 1], [P.yAt(P.sLo), -1]]) {
    fit.frame([0, y, 0], [1, 0, 0], [0, 0, -1], [0, 1, 0]);
    const hz = 0.004 * sgn;
    lathe(fit, [{ r: 0, z: hz + sgn * 0.002, nr: 0, nz: sgn, s: OUT }, { r: hub * 0.7, z: hz + sgn * 0.002, nr: 0, nz: sgn, s: OUT }, ...arcPts(hub * 0.92, hz, 0.0045, sgn > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 5).map(([r, z]) => ({ r, z, nr: (r - hub * 0.92) / 0.0045, nz: (z - hz) / 0.0045, s: EDGE })),
      ...arcPts(hub * 0.92, hz, 0.0045, 0, sgn > 0 ? -Math.PI / 2 : Math.PI / 2, 5).map(([r, z]) => ({ r, z, nr: (r - hub * 0.92) / 0.0045, nz: (z - hz) / 0.0045, s: EDGE })), { r: 0.006, z: hz - sgn * 0.0045, nr: 0, nz: -sgn, s: OUT }], 40);
    fit.noFrame();
  }
  // bout d'arbre sous le moyeu bas (palier bas de l'ailette)
  tube(fit, [[0, P.yAt(P.sLo) - 0.004, 0], [0, bot - 0.045, 0]], 0.005, 14, OUT, true);
  // côtes : fil le long du profil, d'un moyeu à l'autre
  const nR = cage.ribs, rho = cage.wire / 2;
  for (let k = 0; k < nR; k++) {
    const a = (k / nR) * TAU, pts = [];
    const s0 = P.sLo - 0.002, s1 = P.sHi + 0.002;
    for (let i = 0; i <= 60; i++) { const s = s0 + ((s1 - s0) * i) / 60, r = P.rAt(s), y = P.yAt(s); pts.push([r * Math.cos(a), y, r * Math.sin(a)]); }
    tube(wire, pts, rho, 6, OUT, true);
  }
  // douille de la lampe (sous le moyeu haut) et ampoule
  const yTopHub = P.yAt(P.sHi);
  revolve(fit, [[0, yTopHub - 0.002], [0.0085, yTopHub - 0.004], [0.0085, 0.05], ...arcPts(0.0085, 0.046, 0.004, 0, -Math.PI / 2, 3), [0.011, 0.04], [0.011, 0.032], [0, 0.032]], 24);
  const rb = 0.026;
  sphere(glass, [0, -0.004, 0], rb, 40, 24, OUT);
  // filament en boucle (tungstène) tenu par deux supports
  const fpts = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40, a = Math.PI * (0.15 + 0.7 * t); fpts.push([Math.cos(a) * 0.012, -0.004 - Math.sin(a) * 0.012 + 0.006, 0]); }
  tube(fil, fpts, 0.0007, 6, OUT, false);
  tube(fit, [[-0.010, 0.031, 0], [-0.0105, 0.004, 0]], 0.0005, 5, OUT, false);
  tube(fit, [[0.010, 0.031, 0], [0.0105, 0.004, 0]], 0.0005, 5, OUT, false);
  return { fittings: fit.out(), cage: wire.out(), glass: glass.out(), filament: fil.out() };
}

// Ailette (repère de l'ailette = station tournée de ψ autour de y) : le rail
// (qui épouse le cocon plein, dans le plan x > 0), les bras jusqu'aux paliers
// haut et bas, les contrepoids, les bagues
export function buildYoke(lay, E, P) {
  const fit = new Buffers();
  const RP = [];
  for (let k = 0; k < E.railPts.length; k += 2) RP.push([E.railPts[k], E.railPts[k + 1], 0]);
  const yTop = P.yAt(P.sHi) + 0.026, yBot = lay.bot - 0.03;
  const a = RP[RP.length - 1], b = RP[0];
  const bend = (p, q, n = 14) => { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, e = t * t * (3 - 2 * t); o.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * e, 0]); } return o; };
  tube(fit, RP, 0.0038, 12, OUT, false);
  tube(fit, bend([0.006, yTop, 0], a), 0.0034, 10, OUT, true);
  tube(fit, bend([0.006, yBot, 0], b), 0.0034, 10, OUT, true);
  // contrepoids (à l'opposé, en haut et en bas)
  const ar = Math.max(...RP.map((p) => p[0]));
  for (const y of [yTop, yBot]) {
    tube(fit, [[0, y, 0], [-ar * 0.38, y, 0]], 0.003, 8, OUT, true);
    fit.frame([-ar * 0.38, y, 0], [0.011, 0, 0], [0, 0.011, 0], [0, 0, 0.011]);
    sphere(fit, [0, 0, 0], 1, 20, 12, OUT);
    fit.noFrame();
  }
  for (const y of [yTop, yBot]) { fit.frame([0, y, 0], [1, 0, 0], [0, 0, -1], [0, 1, 0]); torus(fit, [0, 0, 0], 0.009, 0.0045, 24, 10, EDGE); fit.noFrame(); }
  return { fittings: fit.out() };
}

// Chariot (repère : centré sur le rail, x vers l'extérieur, y le long du
// rail) : un patin à deux galets, et l'œil de porcelaine tourné vers le cocon
export function buildCarriage() {
  const fit = new Buffers(), eye = new Buffers();
  roundedBox(fit, [0.004, 0, 0], [0.006, 0.013, 0.007], 0.003, 3, EDGE, OUT);
  for (const y of [-0.009, 0.009]) { fit.frame([0.0, y, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]); torus(fit, [0, 0, 0], 0.004, 0.002, 16, 8, EDGE); fit.noFrame(); }
  tube(fit, [[0, 0, 0], [-0.012, 0, 0]], 0.0018, 8, OUT, false);
  eye.frame([-0.014, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0]);
  torus(eye, [0, 0, 0], 0.0062, 0.0026, 28, 12, OUT); // (l'œil se voit : c'est lui qui conduit le ruban)
  eye.noFrame();
  return { fittings: fit.out(), eye: eye.out() };
}
export function buildEye() { return { eye: new Buffers().out() }; }

// Doublure (paroi lisse au rayon moyen du cocon plein) : elle porte l'ombre
// de ce cocon dans la carte d'ombre de l'AUTRE lampe, masquée selon la
// transmission de la paroi (σ et φ en attribut)
export function buildProxy(P, env, grid) {
  const B = new Buffers();
  const ns = 64, np = 96, rows = [];
  const sig = new Float32Array((ns + 1) * np * 2);
  const q = [0, 0, 0];
  let o = 0;
  for (let i = 0; i <= ns; i++) {
    const s = P.sLo + ((P.sHi - P.sLo) * i) / ns;
    const ei = Math.min(grid.Ns - 1, Math.floor(s / grid.cs)), h = env[ei] * 0.5;
    const row = [];
    for (let k = 0; k < np; k++) {
      const ph = (k / np) * TAU;
      wallPoint(P, s, ph, h, q);
      const n = [P.dyAt(s) * Math.cos(ph), -P.drAt(s), P.dyAt(s) * Math.sin(ph)];
      row.push(B.vert([...q], n, OUT));
      sig[o++] = s; sig[o++] = ph;
    }
    rows.push(row);
  }
  B.grid(rows, true);
  return { ...B.out(), sp: sig };
}
