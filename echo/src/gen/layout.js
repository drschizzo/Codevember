// Mise en place de la pièce (module pur) : la table, la lampe, la nature morte,
// le réflecteur, la caméra, et les grandeurs dérivées (source image, foyers,
// boule) que lisent la scène et les tests.
//
// Contrainte de cadrage : la caméra doit voir la lampe ET son reflet. Pour le
// trumeau, la glace est posée là où la droite caméra → lampe image traverse le
// mur ; pour la psyché, la glace est orientée sur la bissectrice des directions
// de la lampe et de la caméra (le reflet de l'ampoule tombe en son centre) ;
// pour le miroir ardent, la calotte est une part d'ellipsoïde dont les foyers
// sont l'ampoule et un point d'un vase.
import { sub, add, mul, dot, norm, dist, len, cross, reflectPoint, planeBasis, planeEcho, makeEllipse, ellipseEcho, facetEcho, galleryEcho, galleryImages } from './optics.js';
import { cameraAt, TIMELINE } from '../film.js';

const r3 = (x) => Math.round(x * 1000) / 1000 || 0;
const v3 = (a) => a.map(r3);

export const TABLE_H = 0.74; // (hauteur du plateau au-dessus du sol ; le plateau est en y = 0)
export const CEIL = 1.75;    // (plafond, hors champ : d'où pend le fil de la lampe)

// Rayon d'emprise d'un vase sur la table (anse et bec compris)
export const footprint = (o) => o.r * (o.kind === 'jug' ? 1.45 : o.kind === 'bowl' ? 1.02 : 1.08);

export function place(R, rng) {
  const T = R.table, Lp = R.lamp, Rf = R.reflector;
  const wallZ = -T.depth / 2 - R.room.wallGap;
  R.room.wallZ = r3(wallZ);
  const s = [Lp.x, Lp.y, Lp.z];
  const reserved = []; // disques réservés sur la table [x, z, r, hauteur libre au-dessus]
  reserved.push([s[0], s[2], 0.07, s[1] - 0.09]);

  // ── réflecteur posé sur la table ou au-dessus (avant la nature morte) ──
  if (R.family === 'ardent') {
    // un grand miroir concave sphérique, debout sur un pied à côté de la table,
    // dont le centre de courbure est l'ampoule : toute la lumière qu'il reçoit
    // revient à la lampe, au même instant (chemin 2R), et la rallume
    const dir = norm([1, rng.range(-0.3, -0.12), rng.range(-0.2, 0.15)]);
    let R0 = rng.range(0.78, 0.95);
    R0 = Math.max(R0, (T.width / 2 + 0.16 - s[0]) / dir[0]);
    const M = add(s, mul(dir, R0));
    Rf.center = v3(M); Rf.focus = v3(s); Rf.radius = r3(R0);
    Rf.stand = v3([M[0], -TABLE_H, M[2]]);
  }
  if (R.family === 'facettes') {
    Rf.ballC = v3([rng.range(0.12, 0.3), rng.range(0.52, 0.6), rng.range(-0.18, -0.04)]);
    reserved.push([Rf.ballC[0], Rf.ballC[2], Rf.ball.r + 0.02, Rf.ballC[1] - Rf.ball.r - 0.05]);
  }

  // ── nature morte : grappe serrée (Morandi), les hautes au fond ──
  const objs = R.objects;
  const cx = rng.range(-0.1, 0.08), cz = rng.range(-0.08, 0.02);
  const xmin = -T.width / 2 + 0.07, xmax = T.width / 2 - 0.07, zmin = -T.depth / 2 + 0.07, zmax = T.depth / 2 - 0.09;
  const order = objs.map((o, i) => i).sort((a, b) => objs[b].h - objs[a].h);
  const placed = [];
  for (const i of order) {
    const o = objs[i], fp = footprint(o);
    let best = null;
    for (let k = 0; k < 400 && !best; k++) {
      const spread = 0.1 + k * 0.0006;
      // (les plus hautes tirées vers le fond)
      const zb = cz - 0.1 * (o.h - 0.15) / 0.2;
      const x = cx + spread * 1.4 * (rng.next() * 2 - 1), z = zb + spread * (rng.next() * 2 - 1);
      if (x - fp < xmin || x + fp > xmax || z - fp < zmin || z + fp > zmax) continue;
      if (placed.some((q) => Math.hypot(q.x - x, q.z - z) < q.fp + fp + 0.006)) continue;
      if (reserved.some(([rx, rz, rr, clear]) => Math.hypot(rx - x, rz - z) < rr + fp && o.h > clear)) continue;
      best = { x, z };
    }
    if (!best) { o.skip = true; continue; }
    o.x = r3(best.x); o.z = r3(best.z); o.rot = r3(rng.range(0, 6.28));
    placed.push({ x: o.x, z: o.z, fp });
  }
  R.objects = objs.filter((o) => !o.skip);

  // ── caméra et réflecteur, ajustés ensemble ──
  // Le trumeau et la psyché se placent d'après l'œil (le reflet de l'ampoule
  // doit tomber dans la glace) ; l'œil se place d'après tout ce qui doit être
  // dans le cadre, réflecteur entier compris (« Echo » ne se lit pas sans
  // lui). Trois allers-retours suffisent : les écarts tombent sous le mm.
  const C = R.camera;
  C.target = v3([cx * 0.5 + s[0] * 0.3, 0.24, -0.08]);
  const pre = { px: rng.range(-0.05, 0.08), py: rng.range(0.3, 0.38) };
  const eyeAt = () => cameraAt(C, (TIMELINE.slow + TIMELINE.end) / 2).pos;
  for (let it = 0; it < 3; it++) {
    placeReflector(R, eyeAt(), pre);
    fitCamera(R);
  }
  placeReflector(R, eyeAt(), pre);
  // galerie : la caméra une fois placée, les glaces vont jusqu'à 45 cm d'elle
  // (leur partie avant, hors du cadre, porte les images lointaines de la lampe)
  if (R.family === 'galerie') {
    for (let it = 0; it < 2; it++) { placeReflector(R, eyeAt(), pre); fitCamera(R); }
    placeReflector(R, eyeAt(), pre);
    let zmax = -1;
    for (let k = 0; k <= 64; k++) zmax = Math.max(zmax, cameraAt(C, k / 64).pos[2]);
    R.room.frontZ = r3(zmax + 0.6);
  }
  return R;
}

function placeReflector(R, eEcho, pre) {
  const T = R.table, Lp = R.lamp, Rf = R.reflector, wallZ = R.room.wallZ;
  const s = [Lp.x, Lp.y, Lp.z];
  if (R.family === 'galerie') {
    // deux grandes glaces face à face, accrochées aux murs latéraux juste
    // au-delà des bouts de la table, du mur du fond sur 1,35 m
    const xm = T.width / 2 + 0.14, z0 = wallZ + 0.06;
    const z1 = Math.min(z0 + 1.35, eEcho[2] - 0.6);
    const hw = r3((z1 - z0) / 2), hh = 0.7, cz = (z0 + z1) / 2, cy = 0.35;
    for (const [key, sx] of [['plane', -1], ['planeB', 1]]) {
      const n = [-sx, 0, 0];
      const { u, v } = planeBasis(n);
      Rf[key] = { c: v3([sx * xm, cy, cz]), n, u: v3(u), v: v3(v), hw, hh, shape: 'rect' };
    }
  } else if (R.family === 'trumeau') {
    const zg = wallZ + 0.03;
    const n = [0, 0, 1];
    const sv = [s[0], s[1], 2 * zg - s[2]];
    const d = sub(sv, eEcho), t = (zg - eEcho[2]) / d[2];
    const hit = add(eEcho, mul(d, t));
    const hw = Rf.w / 2, hh = Rf.h / 2;
    let c = [hit[0] - Rf.jx * hw * 0.6, hit[1] - Rf.jy * hh * 0.5, zg];
    if (c[1] - hh < 0.08) c[1] = 0.08 + hh; // (la glace commence au-dessus de la table)
    if (hit[1] > c[1] + hh * 0.85) c[1] = hit[1] - hh * 0.85;
    const { u, v } = planeBasis(n);
    Rf.plane = { c: v3(c), n, u, v, hw: r3(hw), hh: r3(hh), shape: Rf.shape };
  } else if (R.family === 'psyche') {
    const hw = r3(Rf.w * 0.36), hh = r3(Rf.h * 0.62);
    // (debout derrière le coin droit de la table, entre la table et le mur)
    const c = [T.width / 2 - 0.1 + pre.px, pre.py, wallZ + 0.3];
    // la glace pivote entre ses montants (inclinaison) et le pied tourne (lacet)
    let n = norm(add(norm(sub(s, c)), norm(sub(eEcho, c))));
    const yaw = Math.atan2(n[0], n[2]) + Rf.jx * 0.06;
    const tilt = Math.max(-0.22, Math.min(0.22, Math.asin(n[1]) + Rf.jy * 0.04));
    n = [Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), Math.cos(yaw) * Math.cos(tilt)];
    const { u, v } = planeBasis(n);
    Rf.plane = { c: v3(c), n: v3(n), u: v3(u), v: v3(v), hw, hh, shape: Rf.shape === 'arch' ? 'arch' : 'oval' };
    Rf.yaw = r3(yaw); Rf.tilt = r3(tilt);
  } else if (R.family === 'ardent') {
    // (posé dans place() : il ne dépend pas de l'œil)
  } else if (R.family === 'facettes') {
    Rf.ballSpin = 1; // (tours par boucle, en temps réel)
  }
}

// Ce qui doit être dans le cadre : l'ampoule et sa douille, chaque vase, le
// réflecteur entier (au-dessus du plateau) ; la caméra garde son azimut et sa
// hauteur, vise le centre de ces points et recule juste assez (marge 14 % : le
// glissement et l'avancée du film restent dans le cadre)
export function framePoints(R) {
  const Lp = R.lamp, Rf = R.reflector, pts = [[Lp.x, Lp.y - 0.08, Lp.z], [Lp.x, Lp.y + 0.12, Lp.z]];
  for (const o of R.objects) pts.push([o.x - o.r, 0, o.z], [o.x + o.r, 0, o.z], [o.x, o.h, o.z]);
  if (R.family === 'galerie') {
    for (const P of [Rf.plane, Rf.planeB].filter(Boolean)) {
      const zb = P.c[2] - P.hw;
      for (const y of [P.c[1] - P.hh * 0.6, P.c[1] + P.hh]) pts.push([P.c[0], Math.max(0, y), zb], [P.c[0], Math.max(0, y), zb + 0.5]);
    }
  } else if (Rf.plane) {
    const P = Rf.plane;
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const q = add(add(P.c, mul(P.u, a * (P.hw + 0.04))), mul(P.v, b * (P.hh + 0.04)));
      pts.push([q[0], Math.max(0, q[1]), q[2]]);
    }
  }
  if (R.family === 'ardent') { const m = Rf.center; pts.push([m[0], m[1] + Rf.cap + 0.04, m[2]], [m[0], m[1] - Rf.cap - 0.04, m[2]], [m[0] + 0.05, m[1], m[2]]); }
  if (R.family === 'facettes') { const c = Rf.ballC, r = Rf.ball.r; pts.push([c[0], c[1] + r + 0.06, c[2]], [c[0] - r, c[1], c[2]], [c[0] + r, c[1], c[2]]); }
  return pts;
}
export function fitCamera(R, aspect = 1.7, margin = 0.86) {
  const C = R.camera, pts = framePoints(R);
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  const tg = lo.map((v, i) => (v + hi[i]) / 2);
  const dv = [Math.cos(C.el) * Math.sin(C.az), Math.sin(C.el), Math.cos(C.el) * Math.cos(C.az)];
  const f = mul(dv, -1), r = norm(cross(f, [0, 1, 0])), up = cross(r, f);
  const ty = Math.tan((C.fov * Math.PI) / 360) * margin, tx = ty * aspect;
  const fits = (d) => {
    const e = add(tg, mul(dv, d));
    return pts.every((q) => { const v = sub(q, e), z = dot(v, f); return z > 0.2 && Math.abs(dot(v, r) / z) <= tx && Math.abs(dot(v, up) / z) <= ty; });
  };
  let a = 0.9, b = 4.5;
  for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (fits(m)) b = m; else a = m; }
  C.target = v3(tg);
  C.dist = Math.round(b * 100) / 100;
}

// ── Grandeurs dérivées (lues par la scène et par les tests) ──
export function derive(R) {
  const Lp = R.lamp, Rf = R.reflector;
  const s = [Lp.x, Lp.y, Lp.z];
  const out = { s, family: R.family };
  if (Rf.plane) {
    out.plane = Rf.plane;
    out.sv = reflectPoint(s, Rf.plane.c, Rf.plane.n);
  }
  if (R.family === 'ardent') {
    out.E = makeEllipse(s, Rf.focus, Rf.center, Rf.cap);
  }
  if (Rf.planeB) {
    const A = Rf.plane, B = Rf.planeB;
    out.G = { zA: A.c[0], zB: B.c[0], A: { cx: A.c[2], cy: A.c[1], hw: A.hw, hh: A.hh }, B: { cx: B.c[2], cy: B.c[1], hw: B.hw, hh: B.hh } };
  }
  if (R.family === 'facettes') {
    out.B = { c: Rf.ballC, r: Rf.ball.r, rows: Rf.ball.rows, cols: Math.round((Math.PI * Rf.ball.rows) / 1.25), spin: 0 };
  }
  // rebonds diffus (une source secondaire sur la table sous la lampe, une sur
  // le mur au plus près de la lampe) : ce sont les premiers « échos » diffus
  out.vpl = [
    { p: [s[0], 0.002, s[2]], n: [0, 1, 0], what: 'table' },
    { p: [s[0], s[1], R.room.wallZ + 0.002], n: [0, 0, 1], what: 'wall' },
  ];
  return out;
}

// Étendue des fronts : rhoStart, juste avant que la première lumière (celle de
// l'ampoule) n'atteigne l'objectif ; rhoEnd, quand le dernier point visible
// (direct, écho, rebond, ou vu dans la glace) a reçu sa lumière.
export function frontRange(R) {
  const D = derive(R);
  const C = R.camera;
  const e0 = cameraAt(C, TIMELINE.slow).pos;
  const rhoStart = dist(D.s, e0) - 0.12;
  const e = cameraAt(C, (TIMELINE.slow + TIMELINE.end) / 2).pos;
  const ev = D.plane ? reflectPoint(e, D.plane.c, D.plane.n) : null;
  const W = R.table.width, wz = R.room.wallZ;
  const probes = [];
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 4; j++) probes.push([-W / 2 + (W * i) / 8, 0, -R.table.depth / 2 + (R.table.depth * j) / 4]);
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 5; j++) probes.push([-1.1 + (2.4 * i) / 8, -0.1 + (1.3 * j) / 5, wz + 0.01]);
  for (const o of R.objects) probes.push([o.x, o.h, o.z]);
  // (ce qui est au centre du cadre : la nature morte, la table, le réflecteur ;
  // c'est sur eux que le film doit prendre son temps)
  const inFrame = [];
  for (const o of R.objects) inFrame.push([o.x - o.r, 0.01, o.z], [o.x + o.r, o.h, o.z]);
  for (const q of framePoints(R)) inFrame.push([...q]); // (copies : ne jamais marquer un tableau de la recette)
  for (const q of inFrame) { q.inFrame = true; probes.push(q); }
  let far = 0, near = 0;
  for (const x of probes) {
    const Ls = [dist(x, D.s)];
    if (D.plane) { const q = planeEcho(x, D.s, D.plane); if (q) Ls.push(q.L); }
    if (D.E) { const q = ellipseEcho(x, D.E); if (q) Ls.push(q.L); }
    if (D.B) { const q = facetEcho(x, D.s, D.B); if (q) Ls.push(q.L); }
    const seen = Ls.slice(); // (la lumière directe et le premier écho)
    for (const v of D.vpl) Ls.push(dist(v.p, D.s) + dist(x, v.p));
    const Ds = [dist(x, e)];
    if (ev && dot(sub(x, D.plane.c), D.plane.n) > 0) Ds.push(dist(x, ev));
    for (const L of Ls) for (const d of Ds) far = Math.max(far, L + d);
    // (ce qui se voit vraiment : la lumière directe et le premier écho, vus
    // en face ; les rebonds diffus et le reflet du fond de la pièce sont
    // trop faibles pour retenir le film)
    if (x.inFrame) for (const L of seen) near = Math.max(near, L + Ds[0]);
    if (D.G) for (const q of galleryEcho(x, D.s, D.G, 3)) for (const d of Ds) far = Math.max(far, q.L + d);
  }
  // fenêtres où il se passe quelque chose à l'image : la lumière directe et
  // le premier écho ; puis, dans la galerie, chaque éclair qui reparaît dans
  // la glace (|qₙ − œil|), précédé du couloir reflété qui s'éclaire
  const windows = [[rhoStart - 0.5, near + 0.3]];
  if (D.G) {
    for (const im of galleryImages(D.s, D.G, 3)) {
      const r = dist(im.q, e);
      far = Math.max(far, r);
      windows.push([r - 0.6, r + 0.9]);
    }
  }
  windows.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const w of windows) { const l = merged[merged.length - 1]; if (l && w[0] <= l[1]) l[1] = Math.max(l[1], w[1]); else merged.push([...w]); }
  far = Math.max(far, near);
  const rhoEnd = Math.min(far + 0.25, 11);
  return { rhoStart: r3(rhoStart), rhoEnd: r3(rhoEnd), windows: merged.map(([a, b]) => [r3(a), r3(Math.min(b, rhoEnd + 1))]) };
}
