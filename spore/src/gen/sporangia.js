// Gabarits usinés des sporanges (module pur : worker, tests). Un gabarit par
// espèce, à la taille 1, debout sur l'origine (axe y), dans sa forme MÛRE ;
// le vertex shader le replie en perle, le dresse, le fléchit, l'ouvre et
// l'use (scene/sporangia.js), d'après l'attribut tp de chaque sommet :
//   tp.x  partie : 0 hypothallus, 1 pied, 2 péridium / masse de spores,
//         3 capillitium (filet), 4 calice, 5 columelle
//   tp.y  hauteur relative dans la partie (0 base … 1 sommet)
//   tp.z  tirage propre (écaille du péridium, maille)
//   tp.w  angle autour de l'axe (0…1)
// Unités : cm. Toutes les pièces sont des solides fermés (pas de nappe nue) :
// le calice a une paroi épaisse et une lèvre roulée, le pied s'évase à la
// base, la tête est arrondie au sommet.
import { createRng } from '../../../shared/rng.js';

const TAU = Math.PI * 2;

class Mesh {
  constructor() { this.p = []; this.n = []; this.t = []; this.i = []; }
  v(p, n, t) { this.p.push(...p); const l = Math.hypot(...n) || 1; this.n.push(n[0] / l, n[1] / l, n[2] / l); this.t.push(...t); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  out() { return { position: Float32Array.from(this.p), normal: Float32Array.from(this.n), tp: Float32Array.from(this.t), index: Uint32Array.from(this.i) }; }
}

// révolution d'un profil [[r, y], …] (de bas en haut, extérieur), normales du
// profil lissées ; part, tirage
function lathe(M, prof, part, seg = 28, { y0 = 0, y1 = 1, closeTop = false, closeBot = false, inward = false } = {}) {
  const n = prof.length, rows = [];
  // normales du profil : perpendiculaires à la tangente (moyenne des deux côtés)
  const nrm = prof.map((q, k) => {
    const a = prof[Math.max(0, k - 1)], b = prof[Math.min(n - 1, k + 1)];
    const dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1;
    return inward ? [-dy / l, dr / l] : [dy / l, -dr / l];
  });
  for (let k = 0; k < n; k++) {
    const row = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU, c = Math.cos(a), s = Math.sin(a);
      const [r, y] = prof[k], [nr, ny] = nrm[k];
      row.push(M.v([c * r, y, s * r], [c * nr, ny, s * nr], [part, (y - y0) / Math.max(1e-6, y1 - y0), 0, i / seg]));
    }
    rows.push(row);
  }
  for (let k = 0; k + 1 < n; k++) for (let i = 0; i < seg; i++) {
    const a = rows[k][i], b = rows[k][i + 1], c = rows[k + 1][i + 1], d = rows[k + 1][i];
    // (sens direct vu du côté de la normale : sinon le GPU élimine la face
    // extérieure et montre l'intérieur de la coque)
    if (inward) { M.tri(a, b, c); M.tri(a, c, d); } else { M.tri(a, c, b); M.tri(a, d, c); }
  }
  return rows;
}

// profil arrondi aux deux bouts : cylindre de rayon r de y0 à y1, calottes
// d'aplatissement k (0 plat … 1 hémisphère)
function capsuleProfile(r, y0, y1, kb, kt, n = 18) {
  const P = [];
  const hb = r * kb, ht = r * kt;
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; P.push([Math.max(1e-4, r * Math.sin(a)), y0 + hb * (1 - Math.cos(a))]); }
  for (let i = 1; i < n; i++) P.push([r * (1 + 0.04 * Math.sin((i / n) * Math.PI)), y0 + hb + ((y1 - ht - y0 - hb) * i) / n]);
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; P.push([Math.max(1e-4, r * Math.cos(a)), y1 - ht + ht * Math.sin(a)]); }
  return P;
}

// pied : tube effilé, évasé à la base, fermé
function stalk(M, h, r0, r1, part = 1, seg = 12) {
  const P = [[1e-4, 0], [r0 * 1.45, 0.0004], [r0 * 1.15, h * 0.04], [r0, h * 0.12]];
  for (let i = 1; i <= 10; i++) P.push([r0 + (r1 - r0) * (i / 10) ** 0.8, h * (0.12 + 0.88 * (i / 10))]);
  P.push([1e-4, h + r1 * 0.3]);
  lathe(M, P, part, seg, { y0: 0, y1: h });
}

// hypothallus : galette mince à bord arrondi
function hypothallus(M, R, th = 0.0012) {
  const P = [[1e-4, -0.0004], [R * 0.98, -0.0004], [R, th * 0.4], [R * 0.9, th], [1e-4, th * 1.1]];
  lathe(M, P, 0, 24, { y0: -0.0004, y1: th });
}

// sphère découpée en écailles (Voronoï de la sphère). La frontière entre deux
// écailles est tracée au pixel (le fragment retrouve son écaille d'après les
// germes, scene/sporangia.js) : chaque quadrilatère est émis une fois par
// écaille qui le touche (sommets dupliqués, étiquetés), et chaque copie ne
// garde que ses propres pixels. (Une écaille par triangle donnait des bords
// en escalier de la taille de la grille.)
function flakySphere(M, c, r, part, nFlakes, rng, res = 26) {
  const centers = Array.from({ length: nFlakes }, () => { const z = rng.next() * 2 - 1, a = rng.next() * TAU, s = Math.sqrt(1 - z * z); return [s * Math.cos(a), z, s * Math.sin(a)]; });
  const flake = (d) => { let b = 0, bd = -2; centers.forEach((q, i) => { const v = q[0] * d[0] + q[1] * d[1] + q[2] * d[2]; if (v > bd) { bd = v; b = i; } }); return b; };
  const dir = (i, j) => { const th = (j / res) * Math.PI, ph = (i / (2 * res)) * TAU; return [Math.sin(th) * Math.cos(ph), -Math.cos(th), Math.sin(th) * Math.sin(ph)]; };
  for (let j = 0; j < res; j++) for (let i = 0; i < 2 * res; i++) {
    const q = [dir(i, j), dir(i + 1, j), dir(i + 1, j + 1), dir(i, j + 1)];
    const m = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, (q[0][2] + q[2][2]) / 2];
    // (les écailles qui touchent le quadrilatère : ses coins, son centre, ses milieux d'arêtes)
    const probe = [...q, m, ...q.map((a, k) => { const b = q[(k + 1) % 4]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; })];
    const fs = [...new Set(probe.map(flake))];
    for (const f of fs) {
      const tag = (f + 0.5) / nFlakes;
      const vs = q.map((d) => M.v([c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r], d, [part, (d[1] + 1) / 2, tag, (i / (2 * res))]));
      M.tri(vs[0], vs[2], vs[1]); M.tri(vs[0], vs[3], vs[2]);
    }
  }
  return centers;
}

// fibre : tube fin (3 faces) le long d'une polyligne, normales du tube ;
// tp = [part, hauteur relative (y0..y1), tirage, angle autour de l'axe]
function tube(M, pts0, rad, part, tag, y0, y1) {
  // (brin adouci par une passe de Chaikin : un coude vif replie le tube sur lui-même)
  let pts = pts0;
  for (let it = 0; it < 1; it++) {
    const q = [pts[0]];
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1];
      q.push(a.map((x, i) => x * 0.75 + b[i] * 0.25), a.map((x, i) => x * 0.25 + b[i] * 0.75));
    }
    q.push(pts[pts.length - 1]); pts = q;
  }
  const n = pts.length, rows = [];
  let u = null; // (repère transporté le long du brin : pas de torsion entre deux anneaux)
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
    let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const lt = Math.hypot(...t) || 1; t = t.map((x) => x / lt);
    if (!u) { const ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; u = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]]; }
    const dt = u[0] * t[0] + u[1] * t[1] + u[2] * t[2];
    u = [u[0] - dt * t[0], u[1] - dt * t[1], u[2] - dt * t[2]]; const lu = Math.hypot(...u) || 1; u = u.map((x) => x / lu);
    const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    const q = pts[k], rr = rad * (k === 0 || k === n - 1 ? 0.4 : 1), row = [];
    const hy = (q[1] - y0) / Math.max(1e-6, y1 - y0), ang = (Math.atan2(q[2], q[0]) / TAU + 1) % 1;
    for (let i = 0; i < 3; i++) {
      const c = Math.cos((i / 3) * TAU), sn = Math.sin((i / 3) * TAU), d = [u[0] * c + v[0] * sn, u[1] * c + v[1] * sn, u[2] * c + v[2] * sn];
      row.push(M.v([q[0] + d[0] * rr, q[1] + d[1] * rr, q[2] + d[2] * rr], d, [part, hy, tag, ang]));
    }
    rows.push(row);
  }
  for (let k = 0; k + 1 < n; k++) for (let i = 0; i < 3; i++) {
    const a = rows[k][i], b = rows[k][(i + 1) % 3], c = rows[k + 1][(i + 1) % 3], d = rows[k + 1][i];
    M.tri(a, b, c); M.tri(a, c, d);
  }
}

// capillitium et élatères en fibres (partie 7 : elles suivent le filet, partie
// 3, dans tous ses gestes). Le filet plein (une coque) donnait des têtes de
// coton lisses ; les fibres dessinent le contour duveteux et, ouvertes, la
// houppe ou le filet ajouré qu'on voit sur les photographies.
//   net    : brins errants dans une capsule (Arcyria), surtout près de la paroi
//   burst  : élatères courts, courbes, rayonnant du centre (Trichia)
//   spokes : branches de la columelle à la surface (Stemonitis)
function fibers(M, kind, rng, o) {
  const P = (k) => rng.next() * k;
  if (kind === 'net') {
    const { r, y0, y1, n = 34, rad = 0.0006 } = o;
    for (let f = 0; f < n; f++) {
      let a = P(TAU), y = y0 + P(y1 - y0), rho = r * (0.6 + 0.4 * Math.sqrt(rng.next()));
      const pts = [], da = (rng.next() - 0.5) * 0.5, dy = (rng.next() - 0.5) * (y1 - y0) * 0.09;
      for (let k = 0; k < 14; k++) {
        a += da + (rng.next() - 0.5) * 0.35; y = Math.min(y1, Math.max(y0, y + dy + (rng.next() - 0.5) * (y1 - y0) * 0.05));
        rho = Math.min(r * 1.04, Math.max(r * 0.35, rho + (rng.next() - 0.5) * r * 0.18));
        pts.push([Math.cos(a) * rho, y, Math.sin(a) * rho]);
      }
      tube(M, pts, rad, 7, rng.next(), y0, y1);
    }
  } else if (kind === 'burst') {
    const { c, r, n = 64, rad = 0.0005, y0, y1 } = o;
    for (let f = 0; f < n; f++) {
      const z = rng.next() * 2 - 1, a = P(TAU), s = Math.sqrt(1 - z * z), d = [s * Math.cos(a), z, s * Math.sin(a)];
      const r0 = r * (0.1 + 0.3 * rng.next()), r1 = r * (0.62 + 0.42 * rng.next());
      // (élatères courbes et de longueurs inégales : droits et égaux, la houppe
      // se lisait comme un oursin)
      const curl = (rng.next() - 0.5) * 2.2, side = [d[2], 0, -d[0]];
      const pts = [];
      for (let k = 0; k < 6; k++) {
        const t = k / 5, rr = r0 + (r1 - r0) * t, w = Math.sin(t * Math.PI) * curl * r * 0.25;
        pts.push([c[0] + d[0] * rr + side[0] * w, c[1] + d[1] * rr + 0.15 * w, c[2] + d[2] * rr + side[2] * w]);
      }
      tube(M, pts, rad, 7, rng.next(), y0, y1);
    }
  } else if (kind === 'spokes') {
    const { r, y0, y1, n = 40, rad = 0.0005 } = o;
    for (let f = 0; f < n; f++) {
      const y = y0 + (y1 - y0) * (0.08 + 0.84 * rng.next()), a = P(TAU), pts = [];
      for (let k = 0; k < 6; k++) {
        const t = k / 5, rr = r * 0.12 + (r * 1.02 - r * 0.12) * t, aa = a + 0.6 * t * t * (rng.next() - 0.5);
        pts.push([Math.cos(aa) * rr, y + (rng.next() - 0.5) * r * 0.3 * t, Math.sin(aa) * rr]);
      }
      tube(M, pts, rad, 7, rng.next(), y0, y1);
    }
  }
}

// Gabarit d'une espèce ; renvoie aussi les cotes utiles au shader
export function buildTemplate(familyKey, sp, seed = 't') {
  const M = new Mesh(), rng = createRng(seed);
  const H = sp.stalk.h, r = sp.head.r, hh = sp.head.h;
  const dims = { stalkH: H, headR: r, headH: hh, top: H + hh, beadR: Math.cbrt(0.75 * r * r * hh) * 1.15, cupTop: 0, netR: r, family: familyKey };
  hypothallus(M, Math.max(r * 0.75, sp.stalk.r * 2.6));
  if (familyKey === 'arcyria') {
    stalk(M, H, sp.stalk.r, sp.stalk.r * 0.75);
    // calice : coupe à paroi épaisse et lèvre roulée (cupule)
    const ct = hh * sp.cup, w = r * 0.12;
    const out = [[sp.stalk.r * 0.8, H - 0.002], [r * 0.55, H + ct * 0.15], [r * 0.9, H + ct * 0.55], [r * 1.02, H + ct * 0.9], [r * 1.06, H + ct]];
    const lip = [[r * 1.0, H + ct + w * 0.4], [r * 0.93, H + ct + w * 0.2]];
    const inner = [[r * 0.94, H + ct * 0.9], [r * 0.82, H + ct * 0.55], [r * 0.45, H + ct * 0.2], [1e-4, H + ct * 0.12]];
    lathe(M, [...out, ...lip, ...inner], 4, 30, { y0: H, y1: H + ct });
    dims.cupTop = H + ct;
    // péridium (le haut, fugace) et capillitium serré dedans, du calice au sommet
    lathe(M, capsuleProfile(r, H + ct * 0.6, H + hh, 0.15, 0.85), 2, 30, { y0: H + ct * 0.6, y1: H + hh });
    lathe(M, capsuleProfile(r * 0.93, H + ct * 0.5, H + hh * 0.98, 0.1, 0.8, 22), 3, 30, { y0: H + ct * 0.5, y1: H + hh });
    fibers(M, 'net', rng, { r: r * 0.93, y0: H + ct * 0.55, y1: H + hh * 0.97 });
    dims.netR = r * 0.93;
  } else if (familyKey === 'stemonitis') {
    stalk(M, H, sp.stalk.r, sp.stalk.r * 0.7);
    // columelle : le pied continue dans la tête jusque près du sommet
    lathe(M, [[sp.stalk.r * 0.6, H - 0.001], [sp.stalk.r * 0.45, H + hh * 0.5], [sp.stalk.r * 0.25, H + hh * 0.94], [1e-4, H + hh * 0.96]], 5, 8, { y0: H, y1: H + hh });
    // masse de spores (cylindre effilé, arrondi aux bouts) et cage (capillitium de surface)
    const kb = sp.label.startsWith('Comatricha') ? 0.9 : 0.6, kt = sp.label.startsWith('Comatricha') ? 1 : 0.9;
    lathe(M, capsuleProfile(r, H, H + hh, kb, kt, 26), 2, 26, { y0: H, y1: H + hh });
    lathe(M, capsuleProfile(r * 1.05, H - r * 0.05, H + hh + r * 0.05, kb, kt, 26), 3, 26, { y0: H, y1: H + hh });
    fibers(M, 'spokes', rng, { r: r * 1.0, y0: H, y1: H + hh });
    dims.netR = r * 1.05;
  }
  if (familyKey === 'lamproderma') {
    stalk(M, H, sp.stalk.r, sp.stalk.r * 0.6);
    const c = [0, H + r * 0.92, 0];
    dims.top = H + r * 1.92; dims.headH = r * 2; dims.headC = c[1];
    lathe(M, [[sp.stalk.r * 0.5, H - 0.001], [sp.stalk.r * 0.4, c[1]], [1e-4, c[1] + r * 0.45]], 5, 8, { y0: H, y1: c[1] + r * 0.45 });
    dims.flakes = flakySphere(M, c, r, 2, 26, rng);
    // masse de spores sombre, un peu plus petite, et son filet de capillitium
    lathe(M, Array.from({ length: 13 }, (_, i) => { const a = -Math.PI / 2 + (i / 12) * Math.PI; return [Math.max(1e-4, Math.cos(a) * r * 0.9), c[1] + Math.sin(a) * r * 0.9]; }), 3, 24, { y0: c[1] - r * 0.9, y1: c[1] + r * 0.9 });
    dims.netR = r * 0.9;
  }
  else if (familyKey === 'trichia') {
    // toupie dorée : pied court, tête en sphère un peu étirée, péridium en
    // plaques, élatères comprimés dedans
    if (H > 0.02) stalk(M, H, sp.stalk.r, sp.stalk.r * 0.8);
    const c = [0, H + r * 0.95, 0];
    dims.headC = c[1]; dims.top = c[1] + r; dims.headH = r * 2;
    dims.flakes = flakySphere(M, c, r, 2, 14, rng);
    // (masse d'élatères : un cœur un peu plus petit, d'où les fibres dépassent)
    // (un cœur petit : la houppe est faite des fibres, pas d'une coque lisse)
    lathe(M, Array.from({ length: 13 }, (_, i) => { const a = -Math.PI / 2 + (i / 12) * Math.PI; return [Math.max(1e-4, Math.cos(a) * r * 0.6), c[1] + Math.sin(a) * r * 0.6]; }), 3, 26, { y0: c[1] - r, y1: c[1] + r });
    fibers(M, 'burst', rng, { c, r: r * 0.97, n: 100, rad: 0.00045, y0: c[1] - r, y1: c[1] + r });
    dims.netR = r * 0.93;
  } else if (familyKey === 'lycogala') {
    // coussin sans pied (æthalium) : un dôme aplati posé, verruqueux ; la
    // masse de spores dedans
    // (dôme tronqué à sa base : une semelle plate posée sur le bois)
    const a0 = -0.55, yb = hh / 2 + Math.sin(a0) * hh / 2;
    const P = [[1e-4, 0.001], [Math.cos(a0) * r * 0.97, 0.001]];
    for (let i = 0; i <= 18; i++) { const a = a0 + (i / 18) * (Math.PI / 2 - a0); P.push([Math.max(1e-4, Math.cos(a) * r), 0.001 + (hh / 2 + Math.sin(a) * hh / 2 - yb) * hh / (hh - yb)]); }
    lathe(M, P, 2, 40, { y0: 0, y1: hh });
    lathe(M, P.map(([x, y]) => [x * 0.9, y * 0.9 + 0.002]), 3, 32, { y0: 0, y1: hh });
    dims.headC = hh / 2; dims.top = hh; dims.headH = hh; dims.netR = r * 0.9; dims.stalkH = 0;
  }
  // rosée : des gouttelettes posées sur la tête (partie 6 ; tp.z = leur rayon),
  // qui suivent la tête quand elle se replie, et sèchent avec elle
  if (familyKey !== 'hemitrichia') {
    const nd = familyKey === 'lycogala' ? 22 : familyKey === 'stemonitis' ? 10 : 7;
    const round = familyKey === 'lamproderma' || familyKey === 'trichia' || familyKey === 'lycogala';
    for (let q = 0; q < nd; q++) {
      const a = rng.next() * TAU, rd = r * (familyKey === 'lycogala' ? 0.05 + 0.08 * rng.next() : 0.07 + 0.08 * rng.next()); // (fines : grosses, elles faisaient des oreilles aux têtes)
      let c, n;
      if (round) {
        const el = 0.15 + rng.next() * 1.25, cy = dims.headC, ry = familyKey === 'lycogala' ? hh / 2 : r;
        n = [Math.cos(el) * Math.cos(a), Math.sin(el) * (ry / r), Math.cos(el) * Math.sin(a)];
        const l = Math.hypot(...n); n = n.map((x) => x / l);
        c = [Math.cos(el) * Math.cos(a) * r, cy + Math.sin(el) * ry, Math.cos(el) * Math.sin(a) * r];
      } else {
        const y0 = familyKey === 'arcyria' ? dims.cupTop + hh * 0.1 : H + hh * 0.1, y = y0 + rng.next() * (H + hh - y0 - r * 0.6);
        n = [Math.cos(a), 0, Math.sin(a)]; c = [Math.cos(a) * r, y, Math.sin(a) * r];
      }
      const cc = c.map((x, i) => x + n[i] * rd * 0.55);
      const hyD = (cc[1] - H) / Math.max(1e-4, dims.top - H);
      for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++) {
        const quad = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([ii, jj]) => {
          const th = (jj / 6) * Math.PI, ph = (ii / 8) * TAU, d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
          return M.v([cc[0] + d[0] * rd, cc[1] + d[1] * rd, cc[2] + d[2] * rd], d, [6, hyD, rd, q / nd]);
        });
        M.tri(quad[0], quad[1], quad[2]); M.tri(quad[0], quad[2], quad[3]);
      }
    }
  }
  return { ...M.out(), dims };
}
