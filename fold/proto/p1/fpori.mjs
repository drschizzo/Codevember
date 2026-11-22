// Fold · essai p1 : la tour FP-ori (Liu et al., Sci. Rep. 14, 145, 2024).
//
// Un prisme à n côtés dont chaque face latérale porte une diagonale pliée
// (vallée, du coin bas B_k au coin haut T_{k+1}) et l'autre diagonale coupée.
// Les quatre triangles d'une face se répartissent entre deux « membres » :
// autour de l'arête verticale B_k T_k, le triangle bas de la face k, son
// triangle gauche, le triangle droit de la face k−1 et son triangle haut.
// Le point central X_k de la face k est donc dédoublé : X_k (membre k) et
// Y_k (membre k+1) s'écartent quand le prisme tourne, et la coupe s'ouvre.
//
// Les faces sont rigides. Le dessus tourne de θ et descend : la longueur de
// l'arête verticale fixe h (éq. 6 de l'article) ; X_k est à la distance d (la
// demi-diagonale) de B_k, B_{k+1} et T_k, intersection de trois sphères, en
// forme close. Y_k est à la distance d de T_k, T_{k+1} et B_{k+1}.
// À α = 45°, le prisme se plie à plat pour θ = 2π/n.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));

// Point à la distance d de p, q, r, du côté `side` du plan (p, q, r).
function apex(p, q, r, d, side) {
  const u = sub(q, p), v = sub(r, p), w = cross(u, v), w2 = dot(w, w);
  // centre du cercle circonscrit
  const c = add(p, mul(add(mul(cross(w, u), dot(v, v)), mul(cross(v, w), dot(u, u))), 1 / (2 * w2)));
  const rho2 = dot(sub(c, p), sub(c, p));
  const t = Math.sqrt(Math.max(d * d - rho2, 0));
  return add(c, mul(w, side * t / Math.sqrt(w2)));
}

export function unitParams(n, alpha, l = 1) {
  const R = l / (2 * Math.sin(Math.PI / n));
  const H0 = l * Math.tan(alpha), d = l / (2 * Math.cos(alpha));
  // rotation maximale : là où h s'annule (à 45°, θ = 2π/n, le prisme est à plat)
  const c = 1 - (H0 * H0) / (2 * R * R);
  const thetaMax = c <= -1 ? Math.PI : Math.acos(c);
  return { n, alpha, l, R, H0, d, thetaMax };
}

export const heightAt = (P, th) => Math.sqrt(Math.max(P.H0 * P.H0 - 2 * P.R * P.R * (1 - Math.cos(th)), 0));

// Sommets d'une unité en repère local : dessous à y = 0, non tourné ; dessus
// à y = h, tourné de θ (sens trigonométrique vu d'en haut dans le plan x, −z).
// Renvoie B[k], T[k], X[k], Y[k].
export function unitPose(P, th, side = -1) {
  const { n, R, d } = P, h = heightAt(P, th);
  const B = [], T = [], X = [], Y = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    B.push([R * Math.cos(a), 0, -R * Math.sin(a)]);
    T.push([R * Math.cos(a + th), h, -R * Math.sin(a + th)]);
  }
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    // (B_k, B_{k+1}, T_k) : la normale de ce triangle pointe vers l'extérieur
    X.push(apex(B[k], B[k1], T[k], d, side));
    Y.push(apex(T[k1], T[k], B[k1], d, side));
  }
  return { B, T, X, Y, h };
}

// Triangles d'une unité : 4 par membre, indices dans [B, T, X, Y] concaténés,
// orientés pour que la face avant regarde dehors. `kind` des arêtes (dans
// l'ordre a-b, b-c, c-a) : 0 bord libre (coupe), 1 pli montagne, 2 pli vallée.
export function unitTriangles(n) {
  const iB = (k) => k % n, iT = (k) => n + (k % n), iX = (k) => 2 * n + ((k + n) % n), iY = (k) => 3 * n + ((k + n) % n);
  const tris = [];
  for (let k = 0; k < n; k++) {
    // face k : bas (B_k, B_{k+1}, X_k) — pli montagne sur B_k B_{k+1}, vallée sur X_k B_k
    tris.push({ v: [iB(k), iB(k + 1), iX(k)], e: [1, 0, 2], limb: k, part: 0 });
    // gauche (B_k, X_k, T_k) — vallée B_k X_k, coupe X_k T_k, montagne T_k B_k
    tris.push({ v: [iB(k), iX(k), iT(k)], e: [2, 0, 1], limb: k, part: 1 });
    // face k : droite (B_{k+1}, T_{k+1}, Y_k) — montagne sur l'arête verticale, vallée Y_k T_{k+1}, coupe B_{k+1} Y_k
    tris.push({ v: [iB(k + 1), iT(k + 1), iY(k)], e: [1, 2, 0], limb: (k + 1) % n, part: 2 });
    // haut (T_{k+1}, T_k, Y_k) — montagne sur le bord du dessus, coupe T_k Y_k, vallée Y_k T_{k+1}
    tris.push({ v: [iT(k + 1), iT(k), iY(k)], e: [1, 0, 2], limb: (k + 1) % n, part: 3 });
  }
  return tris;
}

export function unitPoints(pose) { return [...pose.B, ...pose.T, ...pose.X, ...pose.Y]; }

// ── vérifications ──
export function rigidityError(P, pose0, pose1) {
  const a = unitPoints(pose0), b = unitPoints(pose1);
  let e = 0;
  for (const t of unitTriangles(P.n)) for (let i = 0; i < 3; i++) {
    const p = t.v[i], q = t.v[(i + 1) % 3];
    e = Math.max(e, Math.abs(len(sub(a[p], a[q])) - len(sub(b[p], b[q]))));
  }
  return e;
}

// Intersection segment–triangle stricte (les contacts aux sommets partagés sont exclus).
function segTri(p, q, a, b, c, eps) {
  const e1 = sub(b, a), e2 = sub(c, a), dir = sub(q, p);
  const pv = cross(dir, e2), det = dot(e1, pv);
  if (Math.abs(det) < 1e-12) return false;
  const tv = sub(p, a), u = dot(tv, pv) / det;
  if (u < eps || u > 1 - eps) return false;
  const qv = cross(tv, e1), v = dot(dir, qv) / det;
  if (v < eps || u + v > 1 - eps) return false;
  const t = dot(e2, qv) / det;
  return t > eps && t < 1 - eps;
}
export function intersections(pts, tris, eps = 1e-4) {
  const out = [];
  for (let i = 0; i < tris.length; i++) for (let j = i + 1; j < tris.length; j++) {
    const A = tris[i].v, B = tris[j].v;
    const shared = A.filter((x) => B.includes(x)).length;
    if (shared >= 2) continue;
    // triangles rétrécis vers leur centre : le voisinage d'un sommet partagé ne compte pas
    const shrink = (T) => { const c = mul(add(add(pts[T[0]], pts[T[1]]), pts[T[2]]), 1 / 3); return T.map((k) => add(c, mul(sub(pts[k], c), 0.995))); };
    const a = shrink(A), b = shrink(B);
    let hit = false;
    for (let s = 0; s < 3 && !hit; s++) hit = segTri(a[s], a[(s + 1) % 3], b[0], b[1], b[2], eps) || segTri(b[s], b[(s + 1) % 3], a[0], a[1], a[2], eps);
    if (hit) out.push([i, j]);
  }
  return out;
}

// ── La tour : des unités empilées, de chiralités alternées ──
// Les plateaux sont partagés : le dessus de l'unité j est le dessous de j+1.
// Une unité sur deux est le miroir de l'autre (z → −z) : son dessus tourne
// dans l'autre sens, et les plateaux pairs reviennent à leur orientation.
// Chaque unité reste dans sa tranche [y_j, y_j + h_j] et dans le rayon R :
// deux unités ne peuvent pas se traverser.
export function towerPose(P, thetas) {
  const units = [];
  let y = 0, psi = 0;
  thetas.forEach((th, j) => {
    const mirror = j % 2 === 1, p = unitPose(P, th, -1);
    const c = Math.cos(psi), s = Math.sin(psi);
    // repère local → monde : miroir éventuel, rotation psi autour de y, montée de y
    const W = (q) => { const z = mirror ? -q[2] : q[2]; return [q[0] * c + z * s, q[1] + y, -q[0] * s + z * c]; };
    units.push({ pts: unitPoints(p).map(W), mirror, y, h: p.h, psi });
    y += p.h; psi += mirror ? -th : th;
  });
  // plateaux : orientation et hauteur de chaque frontière
  const plates = [];
  { let yy = 0, pp = 0; plates.push({ y: 0, psi: 0 }); thetas.forEach((th, j) => { yy += units[j].h; pp += j % 2 ? -th : th; plates.push({ y: yy, psi: pp }); }); }
  return { units, plates, height: y };
}
