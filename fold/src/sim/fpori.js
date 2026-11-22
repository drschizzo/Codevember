// Fold · la tour FP-ori bistable (Liu et al., « Rigid-foldable cylindrical
// origami with tunable mechanical behaviors », Sci. Rep. 14, 145, 2024).
//
// Une unité est un prisme à n côtés dont chaque face latérale porte une
// diagonale pliée (vallée, du coin bas B_k au coin haut T_{k+1}) et l'autre
// diagonale coupée. Les quatre triangles d'une face se répartissent entre deux
// « membres » : autour de l'arête verticale B_k T_k, le triangle bas et le
// triangle gauche de la face k, le triangle droit et le triangle haut de la
// face k−1. Le centre de la face est dédoublé : X_k (membre k), Y_k (membre
// k+1) ; la coupe s'ouvre quand le dessus tourne.
//
// À α = β/2 (n = 6, α = 60°), le pliage rigide se bloque à θ = 2π/n : dans
// chaque membre, le triangle gauche de la face k et le triangle droit de la
// face k−1 se referment l'un sur l'autre (φ3 = 0). Au-delà, le papier se tend.
// À plat (θ = 120°), tout redevient sans contrainte : deux états stables, une
// barrière entre les deux.
//
// Modèle (celui de l'article) : plateaux rigides, plis en barres élastiques.
// Pour un état (h, θ) du dessus, X_k et Y_{k−1} se placent au minimum
// d'énergie sous la condition de contact φ3 ≥ 0 : tant qu'ils le peuvent, à
// la distance d de leurs trois coins (énergie nulle) ; en contact, confondus
// en un point tiré par quatre coins. Par symétrie, un seul membre suffit.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));

export function unitParams(n, alpha, l = 1) {
  const R = l / (2 * Math.sin(Math.PI / n));
  const H0 = l * Math.tan(alpha), d = l / (2 * Math.cos(alpha));
  // rotation maximale : là où h s'annule (à 45°, θ = 2π/n, le prisme est à plat)
  const c = 1 - (H0 * H0) / (2 * R * R);
  const thetaMax = c <= -1 ? Math.PI : Math.acos(c);
  return { n, alpha, l, R, H0, d, thetaMax };
}

export const heightAt = (P, th) => Math.sqrt(Math.max(P.H0 * P.H0 - 2 * P.R * P.R * (1 - Math.cos(th)), 0));


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


// Coins du plateau bas et du plateau haut (tourné de θ, à la hauteur h).
export function corners(P, h, th) {
  const B = [], T = [];
  for (let k = 0; k < P.n; k++) {
    const a = (2 * Math.PI * k) / P.n;
    B.push([P.R * Math.cos(a), 0, -P.R * Math.sin(a)]);
    T.push([P.R * Math.cos(a + th), h, -P.R * Math.sin(a + th)]);
  }
  return { B, T };
}

// Point qui minimise Σ w_i (|x − p_i| − d)², par Newton (3×3), à partir de x.
export function fitPoint(ps, ws, d, x, iters = 12) {
  x = x.slice();
  for (let it = 0; it < iters; it++) {
    const g = [0, 0, 0], H = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < ps.length; i++) {
      const r = sub(x, ps[i]), L = Math.max(len(r), 1e-9), u = mul(r, 1 / L), s = L - d, w = ws[i];
      for (let a = 0; a < 3; a++) {
        g[a] += w * s * u[a];
        // hessienne de ½(L−d)² : u uᵀ + (s/L)(I − u uᵀ), tronquée à sa partie positive
        for (let b = 0; b < 3; b++) H[a * 3 + b] += w * (u[a] * u[b] + Math.max(s / L, 0) * ((a === b) - u[a] * u[b]));
      }
    }
    for (let a = 0; a < 3; a++) H[a * 4] += 1e-9;
    const dx = solve3(H, g);
    x = sub(x, dx);
    if (len(dx) < 1e-13) break;
  }
  return x;
}
function solve3(m, b) {
  const [a, b1, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b1 * B + c * C;
  const inv = [A, -(b1 * i - c * h), b1 * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b1 * g), a * e - b1 * d];
  return [0, 1, 2].map((r) => (inv[r * 3] * b[0] + inv[r * 3 + 1] * b[1] + inv[r * 3 + 2] * b[2]) / det);
}

// Angle de q autour de l'axe (o, o + ax), mesuré depuis la direction ref.
function angleAbout(o, ax, ref, q) {
  const v = sub(q, o), a = mul(ax, 1 / len(ax));
  const p = sub(v, mul(a, dot(v, a))), r = sub(ref, mul(a, dot(ref, a)));
  return Math.atan2(dot(cross(r, p), a), dot(r, p));
}

// Un membre (k = 0) dans l'état (h, θ). `guess` = {X, Y} de l'appel précédent
// (continuation : on reste sur la branche rentrante).
// Renvoie X0, Y_{n−1} (= Y_{-1}), l'énergie du membre (barres de raideur 1,
// énergie ½ Σ (ΔL)²), l'angle φ3 et le contact.
export function limb(P, h, th, guess) {
  const { B, T } = corners(P, h, th), n = P.n, d = P.d;
  const b0 = B[0], b1 = B[1], t0 = T[0], tm = T[n - 1];
  // départ : le centre de la face au repos, rentré vers l'axe
  const inward = (p) => add(p, mul([-p[0], 0, -p[2]], 0.05));
  let X = guess ? guess.X : inward(mul(add(add(b0, b1), add(t0, T[1])), 0.25));
  let Y = guess ? guess.Y : inward(mul(add(add(b0, tm), add(t0, B[n - 1])), 0.25));
  X = fitPoint([b0, b1, t0], [1, 1, 1], d, X);
  Y = fitPoint([t0, tm, b0], [1, 1, 1], d, Y);
  // φ3 : de Y vers X autour de l'arête verticale B_0 T_0, positif tant que
  // les deux triangles ne se sont pas traversés
  const ax = sub(t0, b0), ref = [-b0[0], 0, -b0[2]];
  let phi3 = angleAbout(b0, ax, ref, Y) - angleAbout(b0, ax, ref, X);
  phi3 -= 2 * Math.PI * Math.round(phi3 / (2 * Math.PI));
  const contact = phi3 < 0;
  if (contact) {
    // pressés l'un contre l'autre : un seul point, tiré par les quatre coins
    // (les arêtes B_0 M et T_0 M sont doublées : une dans chaque triangle)
    const M = fitPoint([b0, b1, t0, tm], [2, 1, 2, 1], d, mul(add(X, Y), 0.5));
    X = M; Y = M; phi3 = 0;
  }
  const bar = (p, q, L0) => { const s = len(sub(p, q)) - L0; return 0.5 * s * s; };
  const E = bar(X, b0, d) + bar(X, b1, d) + bar(X, t0, d) + bar(Y, t0, d) + bar(Y, tm, d) + bar(Y, b0, d) + bar(b0, t0, P.H0);
  return { X, Y, E, phi3, contact, B, T };
}

// Énergie de l'unité (n membres) en (h, θ), sans dimension (barres de raideur
// 1, longueurs en unités de l).
export const unitEnergy = (P, h, th, guess) => { const r = limb(P, h, th, guess); return { ...r, U: P.n * r.E }; };

// ── Le chemin de moindre énergie ──
// Paramétré par θ : avant le contact, c'est le chemin rigide (h fixé par
// l'arête verticale, énergie nulle) ; après, h minimise l'énergie à θ donné.
// Renvoie des tableaux échantillonnés sur [0, θ_plat] : h, U, et le θ du
// contact. θ_plat est l'angle où h* s'annule (120° pour n = 6, α = 60°).
export function energyPath(P, samples = 1024) {
  const thEnd = P.thetaMax, th = new Float64Array(samples), h = new Float64Array(samples), U = new Float64Array(samples);
  let guess = null, hPrev = P.H0, thLock = thEnd;
  const rigidH = (t) => Math.sqrt(Math.max(P.H0 * P.H0 - 2 * P.R * P.R * (1 - Math.cos(t)), 0));
  for (let i = 0; i < samples; i++) {
    const t = (thEnd * i) / (samples - 1);
    th[i] = t;
    let r = limb(P, rigidH(t), t, guess);
    if (!r.contact && thLock === thEnd) { h[i] = rigidH(t); U[i] = P.n * r.E; guess = r; hPrev = h[i]; continue; }
    if (thLock === thEnd) thLock = t;
    // minimum en h : section dorée autour du h précédent (U est lisse et unimodal ici)
    const f = (x) => P.n * limb(P, x, t, guess).E;
    let a = Math.max(0, hPrev - 0.25 * P.l), b = Math.min(P.H0, hPrev + 0.05 * P.l);
    const g = (Math.sqrt(5) - 1) / 2;
    let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
    for (let it = 0; it < 60; it++) {
      if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
      else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
    }
    h[i] = 0.5 * (a + b); r = limb(P, h[i], t, guess); U[i] = P.n * r.E; guess = r; hPrev = h[i];
  }
  return { th, h, U, thLock, thEnd };
}

// Interpolation linéaire d'un tableau échantillonné régulièrement sur [0, x1],
// avec sa dérivée (différences centrées, interpolées aussi).
export function sampler(x1, ys) {
  const n = ys.length, dx = x1 / (n - 1), dy = new Float64Array(n);
  for (let i = 0; i < n; i++) dy[i] = (ys[Math.min(i + 1, n - 1)] - ys[Math.max(i - 1, 0)]) / (dx * (Math.min(i + 1, n - 1) - Math.max(i - 1, 0)));
  const at = (arr, x) => { const u = Math.min(Math.max(x / dx, 0), n - 1.000001), i = Math.floor(u), f = u - i; return arr[i] * (1 - f) + arr[i + 1] * f; };
  return { v: (x) => at(ys, x), d: (x) => at(dy, x) };
}

// ── Pose complète d'une unité dans l'état (h, θ) ──
// Le membre 0 est résolu, les autres s'en déduisent par la symétrie d'ordre n
// (rotation de 2π/n autour de l'axe). Deux triangles pressés l'un contre
// l'autre (φ3 < gap) sont écartés de l'épaisseur du papier : `gap` est
// l'angle qu'elle fait vu depuis l'arête verticale.
function rotY(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; }
function rotAbout(p, o, ax, a) { // Rodrigues
  const k = mul(ax, 1 / len(ax)), v = sub(p, o), c = Math.cos(a), s = Math.sin(a);
  return add(o, add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c))));
}
export function poseAt(P, h, th, guess, gap = 0) {
  const r = limb(P, h, th, guess);
  let X0 = r.X, Y0 = r.Y;
  // (presque à plat, les couches s'empilent à l'horizontale : l'écart tourné
  //  autour de l'arête les ferait se croiser ; c'est l'épaisseur entre plateaux qui joue)
  gap *= Math.min(Math.max((h / P.H0 - 0.15) / 0.15, 0), 1);
  if (gap > 0 && r.phi3 < gap) {
    const o = r.B[0], ax = sub(r.T[0], o), e = 0.5 * (gap - r.phi3);
    // φ3 se mesure de X vers Y : on écarte X en arrière, Y en avant
    X0 = rotAbout(X0, o, ax, -e); Y0 = rotAbout(Y0, o, ax, e);
  }
  const X = [], Y = [];
  for (let k = 0; k < P.n; k++) {
    const a = (2 * Math.PI * k) / P.n;
    X.push(rotY(X0, a));
    Y.push(rotY(Y0, a + (2 * Math.PI) / P.n)); // Y_{k} = image de Y_{-1} tournée de k+1 crans
  }
  return { B: r.B, T: r.T, X, Y, h, limb: r };
}
