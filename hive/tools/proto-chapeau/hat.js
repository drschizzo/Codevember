// La tuile « chapeau » (Smith, Myers, Kaplan, Goodman-Strauss, 2023) : un
// polygone à 13 côtés qui ne pave le plan que sans période, et sa famille
// continue Tile(a, b) (module pur).
//
// Le chapeau est fait de 8 cerfs-volants de la grille [3.4.6.4] duale (chaque
// hexagone coupé en 6 cerfs-volants). On pave un disque par retour arrière sur
// cette grille : 12 poses (6 rotations, 2 reflets), on couvre toujours le
// premier cerf-volant libre.
//
// Tile(a, b) : les arêtes du chapeau sont de deux sortes, a (longueur 1) et b
// (longueur √3). Chaque arête du pavage devient m·u, où u est sa direction
// d'origine et m = a ou b, deux nombres COMPLEXES. Chaque tuile se referme
// séparément en a et en b, donc toute position est A·a + B·b : le pavage reste
// un pavage pour tout (a, b) tant que les tuiles restent simples.
const SQ3 = Math.sqrt(3);
const hexPt = (x, y) => [x + 0.5 * y, (SQ3 / 2) * y];
export const HAT = [[0, 0], [-1, -1], [0, -2], [2, -2], [2, -1], [4, -2], [5, -1], [4, 0], [3, 0], [2, 2], [0, 3], [0, 2], [-1, 2]].map(([x, y]) => hexPt(x, y));

// réseau des centres d'hexagone
const E1 = hexPt(2, 2), E2 = hexPt(4, -2);
const kiteCentroid = (i, j, k) => {
  const cx = i * E1[0] + j * E2[0], cy = i * E1[1] + j * E2[1];
  const a0 = (30 + 60 * k) * Math.PI / 180, a1 = (60 + 60 * k) * Math.PI / 180, a2 = (90 + 60 * k) * Math.PI / 180;
  return [cx + (SQ3 * Math.cos(a0) + 2 * Math.cos(a1) + SQ3 * Math.cos(a2)) / 4, cy + (SQ3 * Math.sin(a0) + 2 * Math.sin(a1) + SQ3 * Math.sin(a2)) / 4];
};
function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** Pose o (0‥11) : rotation de 60°·(o mod 6), précédée d'un reflet si o ≥ 6. */
export const pose = (o, p) => {
  const y = o >= 6 ? -p[1] : p[1], a = (o % 6) * Math.PI / 3, c = Math.cos(a), s = Math.sin(a);
  return [c * p[0] - s * y, s * p[0] + c * y];
};
// les 8 cerfs-volants de chaque pose : [di, dj, k]
const POSES = [];
for (let o = 0; o < 12; o++) {
  const poly = HAT.map((p) => pose(o, p));
  const ks = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (let k = 0; k < 6; k++) { const c = kiteCentroid(i, j, k); if (inside(poly, c[0], c[1])) ks.push([i, j, k]); }
  POSES.push(ks);
}
export const posesOk = () => POSES.every((p) => p.length === 8);

/**
 * Pave le disque de rayon R (en unités de la grille) : liste de { o, i, j }
 * (pose et translation i·E1 + j·E2). order : décalage de l'ordre des poses essayées.
 */
export function tileDisc(R, { maxSteps = 4e6, salt = 0 } = {}) {
  // cerfs-volants à couvrir, du centre vers le bord
  const need = [];
  const n = Math.ceil(R / 3) + 2;
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = 0; k < 6; k++) { const c = kiteCentroid(i, j, k); const d = Math.hypot(c[0], c[1]); if (d < R) need.push([d, i, j, k]); }
  need.sort((p, q) => p[0] - q[0]);
  const S = 64, key = (i, j, k) => ((i + S) * (2 * S) + (j + S)) * 6 + k;
  const covered = new Uint8Array((2 * S) * (2 * S) * 6);
  const placed = [];
  let steps = 0;
  // candidats pour un cerf-volant d'indice k : (pose, cerf-volant de la pose)
  const cand = Array.from({ length: 6 }, () => []);
  for (let oo = 0; oo < 12; oo++) { const o = (oo + salt) % 12; POSES[o].forEach((q, t) => cand[q[2]].push([o, t])); }
  const stack = []; // (indice dans need, indice du candidat essayé)
  let at = 0, ci = 0;
  for (;;) {
    while (at < need.length && covered[key(need[at][1], need[at][2], need[at][3])]) at++;
    if (at >= need.length) return placed.map(({ o, i, j }) => ({ o, i, j }));
    const [, I, J, K] = need[at];
    let done = false;
    for (; ci < cand[K].length; ci++) {
      const [o, t] = cand[K][ci], P = POSES[o], di = I - P[t][0], dj = J - P[t][1];
      let ok = true;
      for (const q of P) if (covered[key(q[0] + di, q[1] + dj, q[2])]) { ok = false; break; }
      if (!ok) continue;
      for (const q of P) covered[key(q[0] + di, q[1] + dj, q[2])] = 1;
      placed.push({ o, i: di, j: dj });
      stack.push([at, ci + 1]);
      ci = 0; done = true;
      break;
    }
    if (done) continue;
    // retour arrière
    if (!stack.length || ++steps > maxSteps) return null;
    const last = placed.pop(), P = POSES[last.o];
    for (const q of P) covered[key(q[0] + last.i, q[1] + last.j, q[2])] = 0;
    [at, ci] = stack.pop();
  }
}

// arêtes du chapeau : [direction unitaire, sorte (0 = a, 1 = b)], l'arête double coupée en deux
export const HAT_EDGES = [];
for (let i = 0; i < 13; i++) {
  const p = HAT[i], q = HAT[(i + 1) % 13], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
  if (Math.abs(l - 2) < 1e-9) { HAT_EDGES.push([[dx / 2, dy / 2], 0], [[dx / 2, dy / 2], 0]); }
  else if (Math.abs(l - 1) < 1e-9) HAT_EDGES.push([[dx, dy], 0]);
  else HAT_EDGES.push([[dx / l, dy / l], 1]);
}
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];

/** Contour (14 sommets) de la tuile de pose o pour les multiplicateurs complexes a, b ; premier sommet à l'origine. */
export function hatOutline(o, a, b) {
  const out = [[0, 0]];
  let x = 0, y = 0;
  for (let e = 0; e < 13; e++) {
    const [u, t] = HAT_EDGES[e];
    const v = cmul(t ? b : a, pose(o, u));
    x += v[0]; y += v[1]; out.push([x, y]);
  }
  return out;
}

/**
 * Coefficients (A, B) du premier sommet de chaque tuile : position = A·a + B·b.
 * Renvoie Float64Array [Ax, Ay, Bx, By] par tuile, et l'écart de fermeture (doit être nul).
 */
export function coefficients(tiles) {
  // sommets du pavage d'origine (a = 1, b = √3), identifiés par position arrondie
  const V = new Map(), adj = [];
  const id = (p) => { const k = Math.round(p[0] * 1e3) + ',' + Math.round(p[1] * 1e3); let v = V.get(k); if (v === undefined) { v = adj.length; V.set(k, v); adj.push([]); } return v; };
  const first = [];
  for (const T of tiles) {
    let x = T.i * E1[0] + T.j * E2[0], y = T.i * E1[1] + T.j * E2[1];
    const p0 = pose(T.o, HAT[0]); x += p0[0]; y += p0[1];
    let v = id([x, y]); first.push(v);
    for (const [u, t] of HAT_EDGES) {
      const d = pose(T.o, u), len = t ? SQ3 : 1;
      x += d[0] * len; y += d[1] * len;
      const w = id([x, y]);
      adj[v].push([w, d, t]); adj[w].push([v, [-d[0], -d[1]], t]);
      v = w;
    }
  }
  const C = new Float64Array(adj.length * 4), seen = new Uint8Array(adj.length);
  let err = 0;
  const queue = [first[0]]; seen[first[0]] = 1;
  while (queue.length) {
    const v = queue.pop();
    for (const [w, d, t] of adj[v]) {
      const ax = C[4 * v] + (t ? 0 : d[0]), ay = C[4 * v + 1] + (t ? 0 : d[1]), bx = C[4 * v + 2] + (t ? d[0] : 0), by = C[4 * v + 3] + (t ? d[1] : 0);
      if (seen[w]) err = Math.max(err, Math.abs(C[4 * w] - ax), Math.abs(C[4 * w + 1] - ay), Math.abs(C[4 * w + 2] - bx), Math.abs(C[4 * w + 3] - by));
      else { seen[w] = 1; C.set([ax, ay, bx, by], 4 * w); queue.push(w); }
    }
  }
  const out = new Float64Array(tiles.length * 4);
  first.forEach((v, k) => out.set(C.subarray(4 * v, 4 * v + 4), 4 * k));
  return { coef: out, err, connected: seen.every((s) => s) };
}
