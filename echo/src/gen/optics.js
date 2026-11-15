// Optique de la pièce : les chemins exacts de la lumière, de la lampe à chaque
// point, directement ou par un réflecteur. Module pur (aucun import de three) :
// la scène s'en sert pour poser ses lumières et ses uniformes, les tests pour
// vérifier chaque formule contre un rayon lancé et réfléchi pas à pas.
//
// Un point x s'allume, pour la caméra placée en e, quand le rayon du front
// (en mètres de chemin depuis l'instant où la lampe s'allume) atteint
// L(x) + |x − e| : L est le chemin de la lampe à x, |x − e| celui de x à
// l'œil (le retard que montrent les vraies femto-photographies).
//
// Les échos :
// - miroir plan (psyché, trumeau) : source image s' symétrique de s, valable
//   si le segment s' → x traverse la glace ; L = |x − s'| ;
// - miroir elliptique (ardent) : une calotte d'ellipsoïde de foyers s et f ;
//   tout rayon parti de s repasse par f, et tous les chemins s → paroi → f
//   valent 2a. Avant le foyer L = 2a − |x − f|, après L = 2a + |x − f|, dans
//   le cône de la calotte vue de f ;
// - boule à facettes : chaque facette plane est un petit miroir ; la facette
//   qui renvoie la lampe vers x a pour normale la bissectrice de (x − B) et
//   (s − B) ; L = |x − s'ᶠ|, s'ᶠ image de s dans le plan de la facette, si le
//   rayon s'ᶠ → x traverse la facette.

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => len(sub(a, b));
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const reflectDir = (d, n) => sub(d, mul(n, 2 * dot(d, n)));
export const reflectPoint = (p, c, n) => sub(p, mul(n, 2 * dot(sub(p, c), n)));

// repère orthonormé (u, v) d'un plan de normale n, u horizontal quand c'est possible
export function planeBasis(n) {
  const up = Math.abs(n[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(up, n));
  const v = cross(n, u);
  return { u, v };
}

// ── Miroir plan ─────────────────────────────────────────────────────────────
// M = { c, n, u, v, hw, hh, shape } : centre de la glace, normale vers la
// pièce, axes, demi-largeur, demi-hauteur, forme ('rect', 'oval', 'arch').
// Position sur la glace (coordonnées locales) → 1 dedans, 0 dehors.
export function insideShape(M, a, b) {
  const x = a / M.hw, y = b / M.hh;
  if (M.shape === 'oval') return x * x + y * y <= 1;
  if (M.shape === 'arch') { // rectangle couronné d'un demi-cercle (arc en plein cintre)
    const k = M.hw / M.hh; // (hauteur du cintre en part de la demi-hauteur)
    if (Math.abs(x) > 1 || y < -1) return false;
    if (y <= 1 - k) return true;
    const yy = (y - (1 - k)) / k;
    return x * x + yy * yy <= 1;
  }
  return Math.abs(x) <= 1 && Math.abs(y) <= 1;
}

export function planeEcho(x, s, M) {
  const sv = reflectPoint(s, M.c, M.n);
  if (dot(sub(x, M.c), M.n) <= 0 || dot(sub(s, M.c), M.n) <= 0) return null; // (derrière la glace)
  const d = sub(x, sv);
  const t = dot(sub(M.c, sv), M.n) / dot(d, M.n);
  if (!(t > 0 && t < 1)) return null;
  const hit = add(sv, mul(d, t));
  const r = sub(hit, M.c);
  if (!insideShape(M, dot(r, M.u), dot(r, M.v))) return null;
  return { L: len(d), hit, source: sv };
}

// ── Miroir elliptique ───────────────────────────────────────────────────────
// E = { f1, f2, a, axis, cosCap } : foyers (la lampe, le point visé), demi-
// grand axe, direction de f2 vers le centre de la calotte, ouverture de la
// calotte vue de f2 (cosinus).
// Distance de f2 à l'ellipsoïde dans la direction d (unitaire)
export function ellipseRadius(E, d) {
  const D = sub(E.f2, E.f1);
  return (4 * E.a * E.a - dot(D, D)) / (2 * dot(D, d) + 4 * E.a);
}

// Calotte posée par son centre M (un point de la paroi) et son rayon (corde
// vue de f2) : a = (|M − f1| + |M − f2|) / 2
export function makeEllipse(f1, f2, M, capRadius) {
  const a = (dist(M, f1) + dist(M, f2)) / 2;
  const axis = norm(sub(M, f2));
  const dM = dist(M, f2);
  const cosCap = Math.cos(Math.atan(capRadius / dM));
  const E = { f1, f2, a, axis, cosCap, M, capRadius };
  // normale de la paroi en M (vers l'intérieur) : bissectrice des directions
  // vers les deux foyers
  E.normal = norm(add(norm(sub(f1, M)), norm(sub(f2, M))));
  return E;
}

export function ellipseEcho(x, E) {
  const r = sub(x, E.f2), dr = len(r);
  if (dr < 1e-9) return { L: 2 * E.a, focus: true, before: true };
  const d = mul(r, 1 / dr);
  const c = dot(d, E.axis);
  if (c >= E.cosCap) { // du côté de la calotte : la lumière converge vers f2
    const rr = ellipseRadius(E, d);
    if (dr >= rr) return null; // (au-delà de la paroi)
    return { L: 2 * E.a - dr, before: true, wall: add(E.f2, mul(d, rr)) };
  }
  if (-c >= E.cosCap) { // de l'autre côté de f2 : elle en repart
    const wall = add(E.f2, mul(d, -ellipseRadius(E, mul(d, -1))));
    return { L: 2 * E.a + dr, before: false, wall };
  }
  return null;
}

// angle solide d'une calotte vue d'un point (échantillonnage du disque de la
// calotte : sert au dosage de l'écho)
export function capSolidAngle(E, from, n = 48) {
  // la calotte est échantillonnée en direction depuis f2 (cône d'ouverture
  // cosCap), chaque élément pesé par son angle solide vu de « from »
  const { u, v } = planeBasis(E.axis);
  const th = Math.acos(E.cosCap);
  let Om = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 2 * n; j++) {
      const t0 = (th * i) / n, t1 = (th * (i + 1)) / n, tm = (t0 + t1) / 2;
      const p = (2 * Math.PI * (j + 0.5)) / (2 * n);
      const dOm2 = (Math.cos(t0) - Math.cos(t1)) * (Math.PI / n); // angle solide de l'élément vu de f2
      const d = add(add(mul(E.axis, Math.cos(tm)), mul(u, Math.sin(tm) * Math.cos(p))), mul(v, Math.sin(tm) * Math.sin(p)));
      const rr = ellipseRadius(E, d);
      const P = add(E.f2, mul(d, rr));
      // normale de la paroi en P
      const nP = norm(add(norm(sub(E.f1, P)), norm(sub(E.f2, P))));
      const area = (dOm2 * rr * rr) / Math.abs(dot(nP, d));
      const w = sub(from, P), dw = len(w);
      Om += (area * Math.abs(dot(nP, w))) / (dw * dw * dw);
    }
  }
  return Om;
}

// ── Boule à facettes ────────────────────────────────────────────────────────
// B = { c, r, rows, cols, spin } : centre, rayon, rangées entre ±BALL_LAT,
// facettes de la rangée de l'équateur, rotation autour de la verticale.
export const BALL_LAT = 1.25; // (latitude maximale des rangées, rad : les pôles sont nus)

// latitude de la rangée i, et nombre de facettes de cette rangée (∝ cos lat :
// l'écart en longitude reste celui de l'équateur, les facettes ne se
// chevauchent pas vers les pôles)
export const rowLat = (B, i) => -BALL_LAT + ((i + 0.5) / B.rows) * 2 * BALL_LAT;
export const rowCols = (B, i) => Math.max(6, Math.round(B.cols * Math.cos(rowLat(B, i))));
// côté d'une facette : 88 % du plus petit des deux pas (joints sombres entre elles)
export const facetSize = (B) => 0.88 * B.r * Math.min((2 * BALL_LAT) / B.rows, (2 * Math.PI) / B.cols);

export function facetFrame(B, i, j) {
  const lat = rowLat(B, i), nc = rowCols(B, i);
  const lon = ((j + 0.5 * (i % 2)) / nc) * 2 * Math.PI + B.spin;
  const n = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
  const t = [-Math.sin(lon), 0, Math.cos(lon)]; // (est)
  const b = cross(n, t); // (nord)
  return { n, t, b: mul(b, -1), lat, lon, c: add(B.c, mul(n, B.r)) };
}

// la facette dont la normale est la plus proche de h (unitaire)
export function nearestFacet(B, h) {
  const lat = Math.asin(Math.max(-1, Math.min(1, h[1])));
  let i = Math.round(((lat + BALL_LAT) / (2 * BALL_LAT)) * B.rows - 0.5);
  if (i < 0 || i >= B.rows) return null;
  const nc = rowCols(B, i);
  const lon = Math.atan2(h[2], h[0]) - B.spin;
  const j = ((Math.round((lon / (2 * Math.PI)) * nc - 0.5 * (i % 2)) % nc) + nc) % nc;
  return [i, j];
}

export function facetEcho(x, s, B) {
  const w = norm(sub(x, B.c)), l = norm(sub(s, B.c));
  const h = norm(add(w, l));
  const ij = nearestFacet(B, h);
  if (!ij) return null;
  const F = facetFrame(B, ij[0], ij[1]);
  if (dot(sub(s, F.c), F.n) <= 0 || dot(sub(x, F.c), F.n) <= 0) return null;
  const sv = reflectPoint(s, F.c, F.n);
  const d = sub(x, sv);
  const t = dot(sub(F.c, sv), F.n) / dot(d, F.n);
  if (!(t > 0 && t < 1)) return null;
  const hit = add(sv, mul(d, t));
  const q = sub(hit, F.c);
  const half = facetSize(B) / 2;
  if (Math.abs(dot(q, F.t)) > half || Math.abs(dot(q, F.b)) > half) return null;
  return { L: len(d), hit, source: sv, facet: ij };
}

// ── Le front ────────────────────────────────────────────────────────────────
// largeur du front (m) : la lumière monte de 0 à 1 sur cette longueur de chemin
export const FRONT = 0.02;
export const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// part de la lumière d'un chemin de longueur L vue par l'œil à la distance D
// du point, quand les fronts d'allumage et d'extinction ont parcouru rhoOn et
// rhoOff mètres (mêmes formules dans scene/paths.js, en TSL)
// L'allumage commence par un éclair : la lumière qui part la première est
// (1 + flash) fois plus forte, et cet excès s'éteint sur flashLen mètres de
// chemin. Sur chaque surface, le front passe en anneau brillant, puis la
// lumière s'établit ; dans la brume, il dessine une coquille. L'écho porte le
// même anneau : on le voit revenir.
export const FLASH = 3, FLASH_LEN = 0.12;
export function gate(rhoOn, rhoOff, L, D, w = FRONT, flash = 0, flashLen = FLASH_LEN) {
  const k = L + D;
  const a = rhoOn - k;
  const on = sstep(-w / 2, w / 2, a) * (1 + flash * Math.exp(-Math.max(0, a) / flashLen));
  return on - sstep(-w / 2, w / 2, rhoOff - k) * (1 + flash * Math.exp(-Math.max(0, rhoOn - k) / flashLen));
}

// ── Lancer de rayons (tests) ────────────────────────────────────────────────
// intersection d'un rayon (o, d unitaire) avec l'ellipsoïde de foyers f1, f2 :
// résolution de |p − f1| + |p − f2| = 2a par dichotomie le long du rayon
// (o est à l'intérieur)
export function rayEllipsoid(o, d, f1, f2, a) {
  const g = (t) => { const p = add(o, mul(d, t)); return dist(p, f1) + dist(p, f2) - 2 * a; };
  let lo = 0, hi = 4 * a;
  for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (g(m) < 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
