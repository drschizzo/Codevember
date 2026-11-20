// Pièces tournées (dans le worker) : barres et leurs embouts, rotules, treuils
// en ligne, moyeu, et le tube générique des câbles. Profils lisses (congés,
// gorges, chanfreins arrondis) aux normales calculées sur le profil ; trois
// rôles de surface : OUT (le tube), IN (viroles, manchons), EDGE (laiton des
// embouts et des pièces mécaniques).
import { Buffers, lathe, sphere, tube, roundedBox, OUT, IN, EDGE } from '../../../shared/gen/mesh.js';

const PI = Math.PI;

// ── Constructeur de profils (r, z) ──────────────────────────────────────────
function Profile() {
  const pts = [];
  const P = {
    pts,
    // point (la finition s'applique au tronçon qui part de ce point)
    at(r, z, s) { pts.push({ r: Math.max(0, r), z, s }); return P; },
    line(r1, z1, s, n = 2) { const a = pts[pts.length - 1]; for (let i = 1; i <= n; i++) P.at(a.r + ((r1 - a.r) * i) / n, a.z + ((z1 - a.z) * i) / n, s); return P; },
    arc(cr, cz, rad, a0, a1, s, n = 8) { for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; P.at(cr + rad * Math.cos(a), cz + rad * Math.sin(a), s); } return P; },
  };
  return P;
}
// profil → sommets pour lathe() : normales par différences centrées (lisses),
// sommet dédoublé quand la finition change (pas de mélange entre matières)
function toLathe(pts) {
  const out = [];
  const nrm = (i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dr = b.r - a.r, dz = b.z - a.z;
    const l = Math.hypot(dr, dz) || 1;
    // normale sortante : (dz, −dr) pour un profil parcouru de z bas vers z haut
    return [dz / l, -dr / l];
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], [nr, nz] = nrm(i);
    if (i > 0 && pts[i - 1].s !== p.s) out.push({ r: p.r, z: p.z, nr, nz, s: pts[i - 1].s });
    out.push({ r: p.r, z: p.z, nr, nz, s: p.s });
  }
  // (supprime les tronçons nuls consécutifs de même finition)
  return out.filter((q, i) => i === 0 || !(q.r === out[i - 1].r && q.z === out[i - 1].z && q.s === out[i - 1].s));
}

// ── Barre : tube, viroles, embouts tournés ──────────────────────────────────
// Le nœud (centre de l'embout) est à z = 0 et à z = L ; l'embout est une
// calotte sphérique de rayon capR centrée sur le nœud (c'est elle qui touche le
// sol), un fût à gorge, un épaulement, une virole puis le tube.
// style 'cap' (embout massif : Culbute) ou 'fork' (embout fin qui entre dans
// une rotule : Chenille, Cerceau).
function strutHalf(L, r, capR, style) {
  const P = Profile();
  const half = L / 2;
  if (style === 'cap') {
    // calotte
    P.arc(0, 0, capR, -PI / 2, 0, EDGE, 12);
    // fût à gorge
    P.line(capR, capR * 0.42, EDGE, 2);
    P.arc(capR, capR * 0.54, capR * 0.12, -PI / 2, -PI * 1.5, EDGE, 8); // (gorge : demi-cercle rentrant)
    P.line(capR, capR * 0.95, EDGE, 2);
    // congé de l'épaulement
    P.arc(capR - capR * 0.18, capR * 0.95, capR * 0.18, 0, PI / 2, EDGE, 6);
    const rf = r * 1.5;
    P.line(rf + capR * 0.06, capR * 1.13, EDGE, 3);
    P.arc(rf + capR * 0.06, capR * 1.13 + capR * 0.06, capR * 0.06, -PI / 2, -PI, EDGE, 4);
    // virole
    P.line(rf, capR * 1.75, IN, 3);
    P.arc(rf - r * 0.25, capR * 1.75, r * 0.25, 0, PI / 2, IN, 4);
    P.line(r, capR * 1.75 + r * 0.25 + 0.002, OUT, 1);
    // manchon central : le logement de la batterie et de la carte, entre deux colliers de serrage
    const sl = Math.min(0.34, half * 0.24), rs = r * 1.5, rc = r * 1.78, cw = r * 0.5;
    P.line(r, half - sl - cw - r * 0.5, OUT, Math.max(2, Math.round(half / 0.25)));
    P.arc(r + r * 0.25, half - sl - cw - r * 0.5, r * 0.25, -PI, -PI * 1.5, IN, 4); // (congé vers le collier)
    P.line(rc - r * 0.12, half - sl - cw - r * 0.25, IN, 1);
    P.arc(rc - r * 0.12, half - sl - cw - r * 0.13, r * 0.12, -PI / 2, 0, IN, 4);
    P.line(rc, half - sl - r * 0.12, IN, 2);
    P.arc(rc - r * 0.12, half - sl - r * 0.12, r * 0.12, 0, PI / 2, IN, 4);
    P.line(rs, half - sl, OUT, 1);
    // (trois gorges fines : les ailettes du logement)
    for (let g = 0; g < 3; g++) { const z0 = half - sl + sl * (0.16 + 0.22 * g); P.line(rs, z0, OUT, 1); P.arc(rs + r * 0.03, z0 + r * 0.05, r * 0.05, -PI / 2, -PI * 1.5, OUT, 3); }
    P.line(rs, half, OUT, 2);
  } else {
    // embout fin : un bout arrondi qui entre dans la rotule
    const re = r * 1.25;
    P.arc(0, capR * 0.35, re, -PI / 2, 0, EDGE, 8);
    P.line(re, capR * 1.15, EDGE, 2);
    P.arc(re - re * 0.25, capR * 1.15, re * 0.25, 0, PI / 2, EDGE, 4);
    P.line(r * 1.3, capR * 1.15 + re * 0.25, IN, 1);
    P.line(r * 1.3, capR * 1.6, IN, 2);
    P.arc(r * 1.3 - r * 0.3, capR * 1.6, r * 0.3, 0, PI / 2, IN, 4);
    P.line(r, capR * 1.6 + r * 0.3 + 0.002, OUT, 1);
    P.line(r, half, OUT, Math.max(2, Math.round(half / 0.25)));
  }
  return P.pts;
}
export function strut({ L, r, capR, style = 'cap', M = 28 }) {
  const half = strutHalf(L, r, capR, style);
  // seconde moitié : symétrique (z → L − z), parcourue dans le même sens
  const mirror = half.slice(0, -1).reverse().map((p, i, arr) => ({ r: p.r, z: L - p.z, s: (arr[i + 1] ?? half[half.length - 1]).s }));
  // (la finition d'un tronçon est celle de son point de départ : en miroir, on la décale d'un cran)
  const pts = [...half, ...mirror];
  const B = new Buffers();
  lathe(B, toLathe(pts), M);
  if (style === 'cap') {
    // sur le manchon : un boîtier de connecteur à deux vis, et sa prise
    const rs = r * 1.5, hb = [r * 0.5, r * 0.34, r * 1.5];
    roundedBox(B, [0, rs + hb[1] * 0.55, L / 2], hb, r * 0.14, 1, EDGE, IN);
    for (const dz of [-1, 1]) sphere(B, [0, rs + hb[1] * 1.5, L / 2 + dz * hb[2] * 0.68], r * 0.15, 10, 6, EDGE);
    tube(B, [[0, -(rs - r * 0.1), L / 2], [0, -(rs + r * 0.42), L / 2]], r * 0.3, 12, EDGE, true);
  }
  return B.out();
}

// ── Rotule (nœud commun à deux barres) : sphère à gorge équatoriale ─────────
export function nodeBall({ R, M = 28 }) {
  const P = Profile();
  P.arc(0, 0, R, -PI / 2, -0.12, EDGE, 10);
  P.arc(R * Math.cos(0.12) - R * 0.07, 0, R * 0.07, -0.9, 0.9, IN, 6);
  P.arc(0, 0, R, 0.12, PI / 2, EDGE, 10);
  const B = new Buffers();
  lathe(B, toLathe(P.pts), M);
  return B.out();
}

// ── Treuil en ligne : un barillet qui tourne, deux tambours à joues ─────────
// Centré sur l'origine, axe z ; le câble entre par les deux bouts. Deux têtes
// de vis sur le corps : on voit le barillet tourner.
export function winch({ len = 0.34, R = 0.06, M = 18 }) {
  const P = Profile(), h = len / 2;
  const fl = R * 1.25, dr = R * 0.5, body = R * 0.82, dl = len * 0.18;
  // guide-câble : un pavillon évasé, par où la corde entre sans s'user
  P.at(R * 0.2, -h - R * 0.3, EDGE);
  P.arc(R * 0.2 + R * 0.12, -h - R * 0.3, R * 0.12, -PI, -PI / 2, EDGE, 3);
  P.arc(R * 0.32, -h - R * 0.12, R * 0.3, -PI / 2, 0, EDGE, 3);
  P.line(R * 0.62, -h, EDGE, 1);
  P.line(fl * 0.9, -h + R * 0.2, EDGE, 1);
  P.arc(fl * 0.9, -h + R * 0.28, R * 0.08, -PI / 2, PI / 2, EDGE, 3); // (joue extérieure)
  P.line(dr, -h + R * 0.36, EDGE, 1);
  // tambour : les spires de corde enroulée (cinq tours, en relief)
  const z0 = -h + R * 0.36, turns = 5, rr = dl / turns / 2;
  for (let t = 0; t < turns; t++) P.arc(dr - rr * 0.25, z0 + (2 * t + 1) * rr, rr, -PI * 0.3, PI * 0.3, IN, 2);
  P.line(fl * 0.9, z0 + dl, EDGE, 1);
  P.arc(fl * 0.9, z0 + dl + R * 0.08, R * 0.08, -PI / 2, PI / 2, EDGE, 3); // (joue intérieure)
  // réducteur : une bague plus large, à épaulement
  const zg = z0 + dl + R * 0.16, gr = R * 0.98;
  P.line(gr - R * 0.06, zg, IN, 1);
  P.arc(gr - R * 0.06, zg + R * 0.06, R * 0.06, -PI / 2, 0, IN, 2);
  P.line(gr, zg + R * 0.34, IN, 2);
  P.arc(gr - R * 0.06, zg + R * 0.34, R * 0.06, 0, PI / 2, IN, 2);
  const zb = zg + R * 0.4;
  P.line(body, zb, OUT, 1);
  // moteur : corps à ailettes de refroidissement
  const nf = 2, span = -zb, pitch = span / (nf + 0.5);
  for (let f = 0; f < nf; f++) { const zf = zb + pitch * (f + 0.45); P.line(body, zf, OUT, 1); P.arc(body + pitch * 0.05, zf + pitch * 0.1, pitch * 0.1, -PI / 2, -PI * 1.5, OUT, 3); }
  P.line(body, 0, OUT, 1);
  const half = P.pts.slice();
  const mirror = half.slice(0, -1).reverse().map((p, i, arr) => ({ r: p.r, z: -p.z, s: (arr[i + 1] ?? half[half.length - 1]).s }));
  const B = new Buffers();
  lathe(B, toLathe([...half, ...mirror]), M);
  // six vis sur chaque réducteur, une plaque et deux têtes de vis sur le corps : on voit le barillet tourner
  for (const sg of [-1, 1]) for (let k = 0; k < 6; k++) { const a = (k / 6) * 2 * PI + (sg > 0 ? PI / 6 : 0); sphere(B, [Math.cos(a) * gr, Math.sin(a) * gr, sg * (zg + R * 0.2)], R * 0.1, 6, 3, EDGE); }
  roundedBox(B, [0, body + R * 0.05, 0], [R * 0.34, R * 0.07, Math.min(-zb * 0.6, R * 0.5)], R * 0.03, 1, EDGE, EDGE);
  for (const a of [PI / 2 + 1.2, PI / 2 - 1.2, -PI / 2]) sphere(B, [Math.cos(a) * body, Math.sin(a) * body, 0], R * 0.15, 8, 4, EDGE);
  return B.out();
}

// ── Moyeu du Cerceau : axe, deux flasques, carter des moteurs ───────────────
export function hub({ W, flR = 0.34, M = 40 }) {
  const P = Profile(), h = W / 2;
  const ax = 0.055, fl = 0.045, drum = flR * 0.62;
  P.at(0, -h - 0.12, EDGE);
  P.arc(ax * 0.6, -h - 0.12, ax * 0.6, -PI / 2, 0, EDGE, 3);
  P.line(ax, -h - fl, EDGE, 1);
  // flasque (disque aux bords arrondis)
  P.line(flR - fl / 2, -h - fl, EDGE, 3);
  P.arc(flR - fl / 2, -h - fl / 2, fl / 2, -PI / 2, PI / 2, EDGE, 8);
  P.line(drum + 0.03, -h, EDGE, 2);
  // carter : un tambour bombé
  P.arc(drum, -h + 0.03, 0.03, -PI / 2, 0, IN, 3);
  { const nf = Math.max(2, Math.round((h - 0.12) / 0.34)), pitch = (h - 0.09) / (nf + 0.4); for (let f = 0; f < nf; f++) { const zf = -h + 0.03 + pitch * (f + 0.4); P.line(drum, zf, IN, 1); P.arc(drum + 0.006, zf + 0.012, 0.012, -PI / 2, -PI * 1.5, IN, 4); } } // (ailettes du carter)
  P.line(drum, -0.06, IN, 1);
  P.arc(drum + 0.02, -0.04, 0.02, -PI, -PI / 2 - 0.0001, OUT, 3); // (bague centrale)
  P.line(drum + 0.02, 0, OUT, 1);
  const half = P.pts.slice();
  const mirror = half.slice(0, -1).reverse().map((p, i, arr) => ({ r: p.r, z: -p.z, s: (arr[i + 1] ?? half[half.length - 1]).s }));
  const B = new Buffers();
  lathe(B, toLathe([...half, ...mirror]), M);
  // goujons d'ancrage des rayons, sur le pourtour de chaque flasque, et six vis de carter
  for (const sg of [-1, 1]) {
    for (let k = 0; k < 12; k++) { const a = (k / 12) * 2 * PI; tube(B, [[Math.cos(a) * flR * 0.86, Math.sin(a) * flR * 0.86, sg * (h + fl * 0.6)], [Math.cos(a) * flR * 0.86, Math.sin(a) * flR * 0.86, sg * (h + fl * 1.5)]], 0.016, 6, EDGE, true); }
    for (let k = 0; k < 6; k++) { const a = ((k + 0.5) / 6) * 2 * PI; sphere(B, [Math.cos(a) * flR * 0.42, Math.sin(a) * flR * 0.42, sg * (h + fl)], 0.02, 10, 6, EDGE); }
  }
  return B.out();
}

// ── Câble : un tube générique, posé dans le vertex shader ───────────────────
// attribut cab = (s ∈ [0, 1] le long du câble, φ autour) ; la position, la
// normale et la tangente sont calculées dans le shader (scene/cables.js).
export function cableTube({ S = 40, R = 6 }) {
  const n = (S + 1) * R;
  const cab = new Float32Array(n * 2), position = new Float32Array(n * 3), normal = new Float32Array(n * 3);
  const index = [];
  for (let j = 0; j <= S; j++) for (let k = 0; k < R; k++) {
    const i = j * R + k, s = j / S, ph = (2 * PI * k) / R;
    cab[i * 2] = s; cab[i * 2 + 1] = ph;
    position[i * 3] = Math.cos(ph) * 0.01; position[i * 3 + 1] = Math.sin(ph) * 0.01; position[i * 3 + 2] = s;
    normal[i * 3] = Math.cos(ph); normal[i * 3 + 1] = Math.sin(ph);
  }
  for (let j = 0; j < S; j++) for (let k = 0; k < R; k++) {
    const a = j * R + k, b = j * R + ((k + 1) % R), c = (j + 1) * R + ((k + 1) % R), d = (j + 1) * R + k;
    index.push(a, b, c, a, c, d);
  }
  return { cab, position, normal, index: new Uint32Array(index) };
}
