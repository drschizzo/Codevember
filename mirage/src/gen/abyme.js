// La mise en abyme : au fond du mirascope, l'objet est un autre mirascope, vingt
// fois plus petit, posé sur son pied — et au fond de celui-ci, un autre encore.
// L'image du petit flotte au-dessus de l'ouverture du grand ; dans cette image,
// au-dessus de sa propre ouverture, flotte l'image du suivant, etc.
//
// Chaque niveau a son repère : le même mirascope canonique (sommet de la coupe
// du bas à l'origine, y vers le haut, mètres), sa table en y = TABLE_Y. Le
// niveau n + 1 est posé au fond du niveau n : x_n = MINI.y·ŷ + K·x_{n+1}. Une
// similitude (échelle uniforme) conserve les angles : un rayon change de repère
// sans changer de nature, la réflexion se calcule dans n'importe lequel.
//
// Ce module sert aux tests, aux outils (ajustement du raccord) et au dessin du
// chargement ; le rendu refait le même calcul en TSL (scene/raytrace.js).
import { PARAB, reflect } from './mirascope.js';

export const TABLE_Y = -0.03;
export const SHELL = 0.0025; // (épaisseur des coupes)
export const K = +(globalThis.process?.env?.ABYME_K ?? 0.05); // (rapport d'un niveau au suivant ; ABYME_K : essais des outils)

const f = PARAB.f, R = PARAB.rimK * f, RH = PARAB.holeK * f;

// Les joncs : un tore à la jointure de chaque coupe, et la lèvre de l'ouverture
// (cotes du couvercle fermé ; le jonc du haut et la lèvre montent avec lui).
export const BEADS = {
  lo: { y: f / 2 - SHELL + 0.0011, R: R + 0.0012, r: 0.0013 },
  hi: { y: f / 2 + SHELL + 0.0001, R: R + 0.0012, r: 0.0013 },
  lip: { y: f - (RH * RH) / (4 * f) + SHELL / 2, R: RH, r: 0.0013 },
};

// Le pied du petit mirascope (au niveau 0, le socle de la machinerie le
// remplace) : une base ronde moulurée et une tige qui porte la coupe.
export const FOOT = {
  base: { r: 0.028, y0: TABLE_Y, y1: TABLE_Y + 0.004 },
  stem: { r: 0.0105, y0: TABLE_Y + 0.004, y1: (0.0105 * 0.0105) / (4 * f) - SHELL + 0.0004 },
};

// Pose du niveau suivant au fond : sa base (r = FOOT.base.r) touche la coupe
// du bas par son arête — au centre, elle flotte de quelques microns.
const bowlAt = (r) => (r * r) / (4 * f);
export const MINI = { y: -TABLE_Y * K + bowlAt(FOOT.base.r * K) };

// L'écorché : un quart du couvercle est ôté (comme sur les maquettes de
// musée), du côté d'où regarde la caméra. On voit à la fois, par l'entaille,
// le vrai petit mirascope posé au fond, et son image qui flotte au-dessus de
// l'ouverture. L'image n'en souffre pas : la lumière qui la forme pour un
// observateur se réfléchit sur les coupes du côté opposé au sien. La coupe du
// bas reste entière (on ne voit donc, par l'entaille, que l'intérieur : pas la
// table, que le petit n'a pas). Chaque niveau est écorché de même, au même
// azimut de son repère. La coupe s'ouvre et se referme au fil de la boucle
// (timeline.js, cutAt) : son demi-angle va de 0 à CUT_HALF. cut : { c: [cx, cz]
// (direction du milieu de l'entaille, dans le plan xz), half : demi-angle }.
export const CUT_HALF = Math.PI / 4;
export const cutOf = (azDeg, half = CUT_HALF) => { if (half < 1e-4) return null; const a = (azDeg * Math.PI) / 180; return { c: [Math.sin(a), Math.cos(a)], half }; }; // (azimut de la caméra : atan2(x, z) ; demi-angle nul : couvercle entier)
const inCut = (cut, x, z) => { if (!cut) return false; const r = Math.hypot(x, z); return r > 1e-12 && (x * cut.c[0] + z * cut.c[1]) / r > Math.cos(cut.half); };

// La couronne de perles serties autour de l'ouverture, sur le dôme.
const DOME = (r) => f + SHELL - (r * r) / (4 * f);
export const JEWELS = { n: 24, R: RH + 0.0036, r: 0.0011, y: DOME(RH + 0.0036) + 0.0007 };

// Sphère qui enveloppe un niveau (dans son repère) : un rayon qui y entre
// passe au repère du niveau ; qui en sort, revient au parent.
export const BOUND = { y: 0.011, r: 0.08 };

// Le petit est posé tourné d'un demi-tour (x, z → −x, −z) : son image, tournée
// d'un demi-tour à son tour, a l'orientation du grand — l'entaille de chaque
// niveau fait face à la même caméra, qui n'a pas à tourner. (Chaque niveau voit
// la salle dans son repère : la sienne, tournée avec lui.)
export const toChild = (p) => [-p[0] / K, (p[1] - MINI.y) / K, -p[2] / K];
export const toParent = (p) => [-p[0] * K, p[1] * K + MINI.y, -p[2] * K];
export const turnDir = (d) => [-d[0], d[1], -d[2]];

function sphere(o, d, c, r) {
  const oc = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
  const b = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2], cc = oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - r * r, D = b * b - cc;
  if (D < 0) return null;
  const s = Math.sqrt(D);
  return [-b - s, -b + s];
}
// cylindre d'axe y, rayon r, y ∈ [y0, y1] : la paroi, puis le disque du haut
function cylY(o, d, r, y0, y1) {
  let best = null;
  const A = d[0] ** 2 + d[2] ** 2, B = 2 * (o[0] * d[0] + o[2] * d[2]), C = o[0] ** 2 + o[2] ** 2 - r * r, D = B * B - 4 * A * C;
  if (A > 1e-14 && D >= 0) {
    const s = Math.sqrt(D);
    for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) {
      if (t <= 1e-9) continue;
      const y = o[1] + d[1] * t;
      if (y >= y0 && y <= y1) { const p = [o[0] + d[0] * t, y, o[2] + d[2] * t], l = Math.hypot(p[0], p[2]); best = { t, p, n: [p[0] / l, 0, p[2] / l] }; break; }
    }
  }
  if (Math.abs(d[1]) > 1e-12) {
    const t = (y1 - o[1]) / d[1];
    if (t > 1e-9 && (!best || t < best.t)) { const p = [o[0] + d[0] * t, y1, o[2] + d[2] * t]; if (Math.hypot(p[0], p[2]) <= r) best = { t, p, n: [0, 1, 0] }; }
  }
  return best;
}
// paraboloïde y = a·r² + b, r ∈ [rMin, rMax], hors de l'entaille : la plus
// proche des deux racines qui convient
function parabCut(o, d, a, b, rMin, rMax, cut) {
  const A = a * (d[0] * d[0] + d[2] * d[2]), B = 2 * a * (o[0] * d[0] + o[2] * d[2]) - d[1], C = a * (o[0] * o[0] + o[2] * o[2]) + b - o[1];
  const ts = [];
  if (Math.abs(A) < 1e-14) { if (Math.abs(B) > 1e-14) ts.push(-C / B); } else { const D = B * B - 4 * A * C; if (D < 0) return null; const q = Math.sqrt(D); ts.push((-B - q) / (2 * A), (-B + q) / (2 * A)); }
  ts.sort((x, y) => x - y);
  for (const t of ts) {
    if (t <= 1e-9) continue;
    const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], r = Math.hypot(p[0], p[2]);
    if (r < rMin || r > rMax || inCut(cut, p[0], p[2])) continue;
    const n = [2 * a * p[0], -1, 2 * a * p[2]], l = Math.hypot(...n);
    return { t, p, n: n.map((v) => v / l) };
  }
  return null;
}
// les deux faces de l'entaille (demi-plans verticaux par l'axe) : on garde le
// point s'il est dans l'épaisseur du couvercle
function cutFaces(o, d, cut) {
  let best = null;
  const th = Math.atan2(cut.c[1], cut.c[0]);
  for (const sg of [-1, 1]) {
    const e = [Math.cos(th + sg * cut.half), Math.sin(th + sg * cut.half)], nrm = [-e[1], e[0]];
    const den = d[0] * nrm[0] + d[2] * nrm[1];
    if (Math.abs(den) < 1e-12) continue;
    const t = -(o[0] * nrm[0] + o[2] * nrm[1]) / den;
    if (t <= 1e-9 || (best && t >= best.t)) continue;
    const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], r = p[0] * e[0] + p[2] * e[1];
    if (r <= 0) continue;
    const hi = r >= RH && r <= R + SHELL && p[1] >= f - bowlAt(r) && p[1] <= f + SHELL - bowlAt(r);
    if (!hi) continue;
    const s2 = den > 0 ? -1 : 1;
    best = { t, p, n: [nrm[0] * s2, 0, nrm[1] * s2] };
  }
  return best;
}
function ball(o, d, c, r) {
  const s = sphere(o, d, c, r);
  if (!s || s[0] <= 1e-9) return null;
  const p = [o[0] + d[0] * s[0], o[1] + d[1] * s[0], o[2] + d[2] * s[0]], n = [(p[0] - c[0]) / r, (p[1] - c[1]) / r, (p[2] - c[2]) / r];
  return { t: s[0], p, n };
}
// tore couché d'axe y, entaillé : sphere tracing (les joncs sont minces)
function torus(o, d, T, tMax, cut = null) {
  const th = cut ? Math.atan2(cut.c[1], cut.c[0]) : 0;
  const n1 = cut ? [-Math.sin(th + cut.half), Math.cos(th + cut.half)] : null, n2 = cut ? [Math.sin(th - cut.half), -Math.cos(th - cut.half)] : null;
  // (le tore, privé du coin de l'entaille : n1·p < 0 et n2·p < 0 dans l'entaille)
  const sd = (p) => { const t0 = Math.hypot(Math.hypot(p[0], p[2]) - T.R, p[1] - T.y) - T.r; return cut ? Math.max(t0, Math.min(-(p[0] * n1[0] + p[2] * n1[1]), -(p[0] * n2[0] + p[2] * n2[1]))) : t0; };
  const s = sphere(o, d, [0, T.y, 0], T.R + T.r);
  if (!s || s[1] < 0) return null;
  let t = Math.max(s[0], 0);
  for (let i = 0; i < 96 && t < Math.min(s[1], tMax); i++) {
    const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], ds = sd(p);
    if (ds < 1e-7) { const rr = Math.hypot(p[0], p[2]) || 1, c = [(p[0] / rr) * T.R, T.y, (p[2] / rr) * T.R], n = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], l = Math.hypot(...n); return { t, p, n: n.map((v) => v / l) }; }
    t += ds;
  }
  return null;
}

// Les surfaces d'un niveau, dans son repère. L : levée du couvercle (0 dans
// la boucle ; gardée pour l'optique). cut : l'entaille (null : coupes entières).
export function surfaces(L = 0, level = 0, cut = null) {
  const a = 1 / (4 * f);
  const jewels = [];
  for (let k = 0; k < JEWELS.n; k++) {
    const t = (k / JEWELS.n) * Math.PI * 2, c = [Math.cos(t) * JEWELS.R, JEWELS.y + L, Math.sin(t) * JEWELS.R];
    if (!inCut(cut, c[0], c[2])) jewels.push({ id: 'jewel', hit: (o, d) => ball(o, d, c, JEWELS.r) });
  }
  const S = [
    { id: 'inLo', mirror: true, hit: (o, d) => parabCut(o, d, a, 0, 0, R, null) },
    { id: 'outLo', hit: (o, d) => parabCut(o, d, a, -SHELL, 0, R + SHELL, null) },
    { id: 'inHi', mirror: true, hit: (o, d) => parabCut(o, d, -a, f + L, RH, R, cut) },
    { id: 'outHi', hit: (o, d) => { const h = parabCut(o, d, -a, f + L + SHELL, RH, R + SHELL, cut); return h && { ...h, n: h.n.map((v) => -v) }; } }, // (normale vers le dehors : vers le haut)
    { id: 'bead', hit: (o, d, tMax) => torus(o, d, BEADS.lo, tMax, null) },
    { id: 'bead', hit: (o, d, tMax) => torus(o, d, { ...BEADS.hi, y: BEADS.hi.y + L }, tMax, cut) },
    { id: 'bead', hit: (o, d, tMax) => torus(o, d, { ...BEADS.lip, y: BEADS.lip.y + L }, tMax, cut) },
    // le pied, à chaque niveau (au niveau 0, sur la table)
    { id: 'foot', hit: (o, d) => cylY(o, d, FOOT.base.r, FOOT.base.y0, FOOT.base.y1) },
    { id: 'foot', hit: (o, d) => cylY(o, d, FOOT.stem.r, FOOT.stem.y0, FOOT.stem.y1) },
    ...jewels,
  ];
  if (cut) S.push({ id: 'cutface', hit: (o, d) => cutFaces(o, d, cut) });
  if (level === 0) S.push({ id: 'table', hit: (o, d) => (d[1] < 0 && o[1] > TABLE_Y ? (() => { const t = (TABLE_Y - o[1]) / d[1]; return { t, p: [o[0] + d[0] * t, TABLE_Y, o[2] + d[2] * t], n: [0, 1, 0] }; })() : null) });
  // le fond du parent, vu du repère de l'enfant (un paraboloïde aussi, entaillé
  // au même azimut) : la sphère englobante le traverse
  else S.push({ id: 'inLoParent', mirror: true, hit: (o, d) => parabCut(o, d, K / (4 * f), -MINI.y / K, 0, BOUND.r * 1.2, null) });
  return S;
}

// Suit un rayon (repère du niveau 0) à travers les niveaux : réflexions sur
// l'argent, passages d'un repère à l'autre. Renvoie la surface atteinte, son
// niveau, le point dans le repère de ce niveau, le nombre de réflexions.
export function traceNested(o, d, { L = 0, maxIt = 28, path = false, escape = true, cut = null } = {}) {
  let level = 0, bounces = 0;
  const touched = [false]; // (le rayon s'est-il réfléchi dans l'argent de ce niveau ?)
  const P = path ? [{ level, p: o }] : null;
  for (let it = 0; it < maxIt; it++) {
    let best = null;
    for (const s of surfaces(level === 0 ? L : 0, level, cut)) {
      const h = s.hit(o, d, best ? best.t : Infinity);
      if (h && h.t > 1e-9 && (!best || h.t < best.t)) best = { ...h, s };
    }
    // l'enfant : entrée dans sa sphère
    const sc = sphere(o, d, [0, MINI.y + BOUND.y * K, 0], BOUND.r * K);
    const tIn = sc && sc[0] > 1e-9 ? sc[0] : Infinity;
    // la sortie de sa propre sphère (niveaux > 0)
    let tOut = Infinity;
    if (level > 0) { const so = sphere(o, d, [0, BOUND.y, 0], BOUND.r); if (so) tOut = so[1]; }
    const tHit = best ? best.t : Infinity;
    if (tIn < tHit && tIn < tOut) {
      const q = [o[0] + d[0] * tIn, o[1] + d[1] * tIn, o[2] + d[2] * tIn];
      o = toChild(q); d = turnDir(d); level++; touched[level] = false;
      P?.push({ level, p: o, enter: true });
      continue;
    }
    if (tOut < tHit) {
      // ressorti de sa propre cavité : il voit la salle, comme s'il sortait du grand
      if (escape && touched[level]) return { id: 'room', level, bounces, d, path: P };
      const q = [o[0] + d[0] * tOut, o[1] + d[1] * tOut, o[2] + d[2] * tOut];
      o = toParent(q); d = turnDir(d); level--;
      // (on sort de la sphère de l'enfant : on la franchit pour ne pas y rentrer)
      const sc2 = sphere(o, d, [0, MINI.y + BOUND.y * K, 0], BOUND.r * K);
      if (sc2 && sc2[1] > 0) o = [o[0] + d[0] * (sc2[1] + 1e-9), o[1] + d[1] * (sc2[1] + 1e-9), o[2] + d[2] * (sc2[1] + 1e-9)];
      P?.push({ level, p: o, leave: true });
      continue;
    }
    if (!best) return { id: 'room', level, bounces, d, path: P };
    if (best.s.mirror) {
      d = reflect(d, best.n);
      o = [best.p[0] + d[0] * 1e-7, best.p[1] + d[1] * 1e-7, best.p[2] + d[2] * 1e-7];
      bounces++;
      touched[best.s.id === 'inLoParent' ? level - 1 : level] = true;
      P?.push({ level, p: best.p });
      continue;
    }
    P?.push({ level, p: best.p });
    return { id: best.s.id, level, bounces, p: best.p, n: best.n, d, path: P };
  }
  return { id: 'lost', level, bounces, path: P };
}

// hauteur totale d'un niveau (base du pied au sommet du dôme) : son image doit
// passer entière par l'ouverture du parent — vue d'en haut, un point à plus de
// ~14 mm du fond n'y a plus de rayons ; le petit reste sous 11,5 mm
export const HEIGHT = f + SHELL + BEADS.lip.r - TABLE_Y;
