// Labyrinthes : arbres couvrants uniformes (algorithme de Wilson) sur deux
// topologies — grille rectangulaire et grille polaire (anneaux subdivisés) —,
// portes, rigole périphérique, poche de noria. Module pur (Node, workers).
//
// Unités : millimètres, dans le repère du plateau (x à droite, y en haut du
// plan du plateau, z normal au plateau). La même liste de parois sert au rendu
// (maillage extrudé), à la physique (capsules et arcs épaissis) et aux tests :
// ce que la bille touche est exactement ce que l'on voit.
import { createRng } from '../rng.js';

const TAU = Math.PI * 2;

// ── Dimensions communes (mm) ─────────────────────────────────────────────────
export const DIM = {
  ball: 6,        // rayon de la bille (diamètre 12 mm)
  hw: 2,          // demi-épaisseur d'une paroi
  H: 9,           // hauteur des parois au-dessus du fond
  post: 2.7,      // rayon des poteaux aux carrefours
  rim: 16,        // largeur du cadre (bord du plateau, au-delà de la rigole)
  slab: 16,       // épaisseur de la dalle
};

// ── Topologies : cellules, centres, voisinages ───────────────────────────────
// cell : { id, x, y, k?, j? } ; adj : liste de [a, b, mur] (le mur qui les
// sépare : segment ou arc), gate : arêtes du bord (cellule, mur extérieur)

function gridTopology({ nx, ny, c }) {
  const W = nx * c, Hh = ny * c, x0 = -W / 2, y0 = -Hh / 2;
  const cells = [], adj = [], border = [];
  const id = (i, j) => j * nx + i;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cells.push({ id: id(i, j), i, j, x: x0 + (i + 0.5) * c, y: y0 + (j + 0.5) * c });
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const X = x0 + (i + 1) * c, Y = y0 + (j + 1) * c;
    if (i < nx - 1) adj.push([id(i, j), id(i + 1, j), seg(X, Y - c, X, Y)]);
    if (j < ny - 1) adj.push([id(i, j), id(i, j + 1), seg(X - c, Y, X, Y)]);
  }
  // bord : [cellule, mur, côté (normale sortante), position le long du périmètre]
  for (let i = 0; i < nx; i++) {
    border.push({ cell: id(i, 0), wall: seg(x0 + i * c, y0, x0 + (i + 1) * c, y0), side: [0, -1] });
    border.push({ cell: id(i, ny - 1), wall: seg(x0 + i * c, y0 + Hh, x0 + (i + 1) * c, y0 + Hh), side: [0, 1] });
  }
  for (let j = 0; j < ny; j++) {
    border.push({ cell: id(0, j), wall: seg(x0, y0 + j * c, x0, y0 + (j + 1) * c), side: [-1, 0] });
    border.push({ cell: id(nx - 1, j), wall: seg(x0 + W, y0 + j * c, x0 + W, y0 + (j + 1) * c), side: [1, 0] });
  }
  return { kind: 'grid', cells, adj, border, extent: { hx: W / 2, hy: Hh / 2 }, c };
}

// anneaux : 0 = chambre centrale (une cellule), puis k = 1..K-1 ; un anneau
// double son nombre de secteurs quand ses cellules deviendraient trop longues
export function polarRings({ K, c, r0 }) {
  const radii = [0, r0];
  for (let k = 1; k < K; k++) radii.push(r0 + k * c);
  const counts = [1];
  // un anneau double son nombre de secteurs tant que chaque cellule garde, à
  // son rayon intérieur, au moins 0,92·c d'arc : toute brèche laisse passer la
  // bille entre ses deux poteaux
  let n = 6;
  for (let k = 1; k < K; k++) {
    if (k > 1 && (TAU * radii[k]) / (2 * n) >= 0.92 * c) n *= 2;
    counts.push(n);
  }
  return { radii, counts };
}

function polarTopology({ K, c, r0 }) {
  const { radii, counts } = polarRings({ K, c, r0 });
  const cells = [], adj = [], border = [], ring = [];
  cells.push({ id: 0, k: 0, j: 0, x: 0, y: 0, a0: 0, a1: TAU });
  ring.push([0]);
  for (let k = 1; k < K; k++) {
    const n = counts[k], row = [], rm = (radii[k] + radii[k + 1]) / 2;
    for (let j = 0; j < n; j++) {
      const a0 = (j / n) * TAU, a1 = ((j + 1) / n) * TAU, am = (a0 + a1) / 2;
      const cl = { id: cells.length, k, j, x: rm * Math.cos(am), y: rm * Math.sin(am), a0, a1 };
      cells.push(cl); row.push(cl.id);
    }
    ring.push(row);
  }
  for (let k = 1; k < K; k++) {
    const n = counts[k];
    for (let j = 0; j < n; j++) {
      const a = ring[k][j], b = ring[k][(j + 1) % n], th = ((j + 1) / n) * TAU;
      adj.push([a, b, seg(radii[k] * Math.cos(th), radii[k] * Math.sin(th), radii[k + 1] * Math.cos(th), radii[k + 1] * Math.sin(th))]);
    }
    // vers l'intérieur : l'arc de rayon radii[k] sous la cellule
    for (let j = 0; j < n; j++) {
      const cl = cells[ring[k][j]];
      const inner = k === 1 ? 0 : ring[k - 1][Math.floor((j * counts[k - 1]) / n)];
      adj.push([inner, cl.id, arc(0, 0, radii[k], cl.a0, cl.a1)]);
    }
  }
  const n = counts[K - 1];
  for (let j = 0; j < n; j++) {
    const cl = cells[ring[K - 1][j]];
    const am = (cl.a0 + cl.a1) / 2;
    border.push({ cell: cl.id, wall: arc(0, 0, radii[K], cl.a0, cl.a1), side: [Math.cos(am), Math.sin(am)] });
  }
  return { kind: 'polar', cells, adj, border, ring, radii, counts, extent: { r: radii[K] }, c };
}

// ── Parois ───────────────────────────────────────────────────────────────────
export const seg = (ax, ay, bx, by) => ({ t: 'seg', ax, ay, bx, by });
export const arc = (cx, cy, r, a0, a1) => ({ t: 'arc', cx, cy, r, a0, a1 });
export const post = (x, y, r) => ({ t: 'post', x, y, r });

// ── Algorithme de Wilson ─────────────────────────────────────────────────────
// Arbre couvrant tiré uniformément parmi tous les arbres couvrants du graphe :
// marches aléatoires depuis une cellule hors de l'arbre, boucles effacées, la
// marche s'arrête en touchant l'arbre et y est greffée. `trace` (facultatif)
// reçoit chaque pas de chaque marche (écran de chargement).
export function wilson(nCells, nbrs, rng, root = 0, trace = null) {
  const inTree = new Uint8Array(nCells), next = new Int32Array(nCells).fill(-1);
  inTree[root] = 1;
  const order = [...Array(nCells).keys()];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const edges = [];
  for (const start of order) {
    if (inTree[start]) continue;
    let u = start;
    while (!inTree[u]) { // marche ; next[u] garde le dernier pas (efface les boucles)
      const v = nbrs[u][Math.floor(rng.next() * nbrs[u].length)];
      next[u] = v;
      trace?.walk(u, v);
      u = v;
    }
    u = start;
    const path = [];
    while (!inTree[u]) { inTree[u] = 1; edges.push([u, next[u]]); path.push(u); u = next[u]; }
    trace?.graft(path.map((x) => [x, next[x]]));
  }
  return edges;
}

// ── Construction d'un labyrinthe complet ─────────────────────────────────────
// spec : { topo: 'grid'|'polar', nx, ny | K, c, family, seed, race: true }
export function buildMaze(spec, trace = null) {
  const rng = createRng(`${spec.seed}:maze`);
  const T = spec.topo === 'polar' ? polarTopology(spec) : gridTopology(spec);
  const N = T.cells.length;
  const nbrs = Array.from({ length: N }, () => []);
  for (const [a, b] of T.adj) { nbrs[a].push(b); nbrs[b].push(a); }
  const tree = wilson(N, nbrs, rng, Math.floor(rng.next() * N), trace);
  const open = new Set(tree.map(([a, b]) => key(a, b)));
  const links = Array.from({ length: N }, () => []);
  for (const [a, b] of tree) { links[a].push(b); links[b].push(a); }

  // portes : entrée et sortie sur le bord, éloignées (le chemin traverse)
  const gates = chooseGates(T, links, rng, spec);
  const walls = [];
  for (const [a, b, w] of T.adj) if (!open.has(key(a, b))) walls.push({ ...w, role: 'maze' });
  T.border.forEach((B, i) => { if (i !== gates.E && i !== gates.X) walls.push({ ...B.wall, role: 'border' }); });
  addPosts(walls, T);
  const race = raceOf(T, spec, gates);
  for (const w of race.walls) walls.push(w);

  const path = solve(links, T.border[gates.E].cell, T.border[gates.X].cell);
  return {
    spec, topo: T.kind, cells: T.cells.map(({ id, x, y, k, j, a0, a1 }) => ({ id, x, y, k, j, a0, a1 })),
    links, walls, gates: { E: T.border[gates.E], X: T.border[gates.X] }, path, race,
    extent: T.extent, radii: T.radii, counts: T.counts, c: T.c, rim: race.rim,
  };
}

const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);

function bfs(links, s) {
  const d = new Int32Array(links.length).fill(-1), prev = new Int32Array(links.length).fill(-1);
  d[s] = 0;
  const q = [s];
  for (let h = 0; h < q.length; h++) for (const v of links[q[h]]) if (d[v] < 0) { d[v] = d[q[h]] + 1; prev[v] = q[h]; q.push(v); }
  return { d, prev };
}
export function solve(links, a, b) {
  const { prev } = bfs(links, a);
  const p = [b];
  while (p[p.length - 1] !== a) p.push(prev[p[p.length - 1]]);
  return p.reverse();
}

function chooseGates(T, links, rng, spec) {
  const B = T.border;
  if (T.kind === 'grid') {
    // entrée et sortie sur deux côtés opposés (gauche / droite, ou haut / bas)
    const vertical = spec.gateAxis === 'y';
    const sideA = B.map((b, i) => [b, i]).filter(([b]) => (vertical ? b.side[1] === 1 : b.side[0] === -1));
    const sideB = B.map((b, i) => [b, i]).filter(([b]) => (vertical ? b.side[1] === -1 : b.side[0] === 1));
    let best = null;
    for (let t = 0; t < 6; t++) {
      const [, e] = rng.pick(sideA), [, x] = rng.pick(sideB);
      const L = bfs(links, B[e].cell).d[B[x].cell];
      if (!best || L > best.L) best = { E: e, X: x, L };
    }
    return best;
  }
  // polaire : deux cellules de l'anneau extérieur, au moins un quart de tour d'écart
  let best = null;
  for (let t = 0; t < 8; t++) {
    const e = Math.floor(rng.next() * B.length), x = Math.floor(rng.next() * B.length);
    const da = Math.abs(((Math.atan2(B[e].side[1], B[e].side[0]) - Math.atan2(B[x].side[1], B[x].side[0]) + 3 * Math.PI) % TAU) - Math.PI);
    if (da < Math.PI / 2) continue;
    const L = bfs(links, B[e].cell).d[B[x].cell];
    if (!best || L > best.L) best = { E: e, X: x, L };
  }
  return best ?? { E: 0, X: Math.floor(B.length / 2), L: 0 };
}

// poteaux : à chaque point où se rejoignent au moins deux parois (ou une
// extrémité libre de paroi) — ils couvrent les jonctions, comme les clous
// d'un vrai plateau
function addPosts(walls, T) {
  const pts = new Map();
  const add = (x, y) => {
    const k = `${Math.round(x * 10)},${Math.round(y * 10)}`;
    const p = pts.get(k);
    if (p) p.n++; else pts.set(k, { x, y, n: 1 });
  };
  for (const w of walls) {
    if (w.t === 'seg') { add(w.ax, w.ay); add(w.bx, w.by); }
    else if (w.t === 'arc') { add(w.cx + w.r * Math.cos(w.a0), w.cy + w.r * Math.sin(w.a0)); add(w.cx + w.r * Math.cos(w.a1), w.cy + w.r * Math.sin(w.a1)); }
  }
  for (const p of pts.values()) walls.push({ ...post(p.x, p.y, DIM.post), role: 'post' });
}

// ── Rigole, cadre, poche ─────────────────────────────────────────────────────
// La rigole fait le tour du labyrinthe entre son mur extérieur et le cadre.
// Plateau : une butée la coupe du côté opposé, pour que la bille sortie fasse
// le tour par un seul chemin. Cadran et Roue : une poche contre l'entrée
// soulève la bille quand le disque tourne (noria).
function raceOf(T, spec, gates) {
  const w = spec.raceWidth ?? T.c;
  const walls = [];
  const E = T.border[gates.E], X = T.border[gates.X];
  if (T.kind === 'grid') {
    const hx = T.extent.hx + w, hy = T.extent.hy + w, rr = w; // (coins arrondis : la bille y tourne)
    const rim = { t: 'rect', hx, hy, rr };
    walls.push({ t: 'outRect', hx, hy, rr, role: 'rim' });
    // centre de la rigole : rectangle à mi-largeur
    const mid = { hx: T.extent.hx + w / 2, hy: T.extent.hy + w / 2 };
    const pocket = pocketFor(T, spec, E, X, w);
    if (pocket) walls.push(pocket);
    return { walls, rim, width: w, mid, pocket };
  }
  const r = T.radii[T.radii.length - 1];
  const rim = { t: 'circle', r: r + w };
  walls.push({ t: 'outCircle', cx: 0, cy: 0, r: r + w, role: 'rim' });
  const pocket = pocketFor(T, spec, E, X, w);
  if (pocket) walls.push(pocket);
  return { walls, rim, width: w, mid: { r: r + w / 2 }, pocket };
}

// position d'une porte le long du bord : son milieu et sa direction
export function gateFrame(B) {
  const w = B.wall;
  if (w.t === 'seg') return { x: (w.ax + w.bx) / 2, y: (w.ay + w.by) / 2, nx: B.side[0], ny: B.side[1], len: Math.hypot(w.bx - w.ax, w.by - w.ay) };
  const am = (w.a0 + w.a1) / 2;
  return { x: w.r * Math.cos(am), y: w.r * Math.sin(am), nx: Math.cos(am), ny: Math.sin(am), len: w.r * (w.a1 - w.a0) };
}

function pocketFor(T, spec, E, X, w) {
  if (spec.family === 'plateau') {
    // butée : au point du pourtour opposé au milieu des deux portes (la bille
    // fait le tour par le côté le plus court… ou le plus long, selon `lap`)
    const e = gateFrame(E), x = gateFrame(X);
    const ae = Math.atan2(e.y, e.x), ax = Math.atan2(x.y, x.x);
    let mid = (ae + ax) / 2;
    if (Math.abs(ae - ax) < Math.PI) mid += Math.PI; // (le grand arc entre les portes est du côté de mid+π)
    if (spec.lap === 'long') mid += Math.PI;
    return radialBar(T, mid, w, 'stop');
  }
  // noria : la poche juste derrière l'entrée, dans le sens de rotation du retour
  const e = gateFrame(E), ae = Math.atan2(e.y, e.x);
  const half = (e.len / 2 + DIM.hw * 2 + 1) / gateRadius(T, ae);
  return radialBar(T, ae - spec.turn * half, w, 'pocket');
}
const gateRadius = (T, a) => (T.kind === 'grid' ? rayToRect(T.extent.hx, T.extent.hy, a) : T.radii[T.radii.length - 1]);
function rayToRect(hx, hy, a) {
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return Math.min(c > 1e-9 ? hx / c : Infinity, s > 1e-9 ? hy / s : Infinity);
}
// barre radiale qui coupe la rigole, du mur extérieur du labyrinthe au cadre
function radialBar(T, a, w, role) {
  const ca = Math.cos(a), sa = Math.sin(a);
  if (T.kind === 'grid') {
    // perpendiculaire au côté du rectangle atteint par le rayon
    const hx = T.extent.hx, hy = T.extent.hy, r = rayToRect(hx, hy, a);
    const px = r * ca, py = r * sa;
    const onX = Math.abs(Math.abs(px) - hx) < 1e-6; // côté vertical
    // (on écarte la barre des coins : elle reste sur un côté droit)
    const cx = onX ? Math.sign(px) * hx : Math.max(-hx + w, Math.min(hx - w, px));
    const cy = onX ? Math.max(-hy + w, Math.min(hy - w, py)) : Math.sign(py) * hy;
    const dx = onX ? Math.sign(px) : 0, dy = onX ? 0 : Math.sign(py);
    return { ...seg(cx, cy, cx + dx * (w + DIM.hw), cy + dy * (w + DIM.hw)), role, a: Math.atan2(cy, cx) };
  }
  const r = T.radii[T.radii.length - 1];
  return { ...seg(r * ca, r * sa, (r + w + DIM.hw) * ca, (r + w + DIM.hw) * sa), role, a };
}

// ── Distance signée aux parois (négative dans la matière) ─────────────────────
// Le rayon effectif d'une paroi est sa demi-épaisseur (segments, arcs) ou son
// rayon (poteaux) ; le cadre est l'extérieur d'un rectangle arrondi ou d'un
// cercle. Sert à la physique (contact de la bille), aux tests et au rendu.
export function wallDistance(w, x, y, out = null) {
  let d, nx, ny;
  if (w.t === 'seg') {
    const ex = w.bx - w.ax, ey = w.by - w.ay, L2 = ex * ex + ey * ey;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - w.ax) * ex + (y - w.ay) * ey) / L2)) : 0;
    const qx = x - (w.ax + t * ex), qy = y - (w.ay + t * ey), L = Math.hypot(qx, qy) || 1e-9;
    d = L - DIM.hw; nx = qx / L; ny = qy / L;
  } else if (w.t === 'arc') {
    const qx = x - w.cx, qy = y - w.cy, rho = Math.hypot(qx, qy) || 1e-9;
    let a = Math.atan2(qy, qx);
    // angle ramené dans [a0, a0 + 2π)
    while (a < w.a0) a += TAU;
    while (a >= w.a0 + TAU) a -= TAU;
    if (a <= w.a1) { const s = rho >= w.r ? 1 : -1; d = Math.abs(rho - w.r) - DIM.hw; nx = (s * qx) / rho; ny = (s * qy) / rho; }
    else {
      const e0x = w.cx + w.r * Math.cos(w.a0), e0y = w.cy + w.r * Math.sin(w.a0);
      const e1x = w.cx + w.r * Math.cos(w.a1), e1y = w.cy + w.r * Math.sin(w.a1);
      const d0 = Math.hypot(x - e0x, y - e0y), d1 = Math.hypot(x - e1x, y - e1y);
      if (d0 < d1) { d = d0 - DIM.hw; nx = (x - e0x) / (d0 || 1e-9); ny = (y - e0y) / (d0 || 1e-9); }
      else { d = d1 - DIM.hw; nx = (x - e1x) / (d1 || 1e-9); ny = (y - e1y) / (d1 || 1e-9); }
    }
  } else if (w.t === 'post') {
    const qx = x - w.x, qy = y - w.y, L = Math.hypot(qx, qy) || 1e-9;
    d = L - w.r; nx = qx / L; ny = qy / L;
  } else if (w.t === 'outRect') {
    // intérieur d'un rectangle arrondi : distance au bord, signée (le cadre est dehors)
    const ix = w.hx - w.rr, iy = w.hy - w.rr;
    const qx = Math.abs(x) - ix, qy = Math.abs(y) - iy;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), L = Math.hypot(ox, oy);
    const sd = L + Math.min(Math.max(qx, qy), 0) - w.rr; // < 0 dedans
    d = -sd;
    if (L > 0) { nx = -(ox / L) * Math.sign(x); ny = -(oy / L) * Math.sign(y); }
    else if (qx > qy) { nx = -Math.sign(x); ny = 0; } else { nx = 0; ny = -Math.sign(y); }
  } else if (w.t === 'outCircle') {
    const qx = x - w.cx, qy = y - w.cy, rho = Math.hypot(qx, qy) || 1e-9;
    d = w.r - rho; nx = -qx / rho; ny = -qy / rho;
  }
  if (out) { out.d = d; out.nx = nx; out.ny = ny; }
  return d;
}

// boîte englobante d'une paroi (pour le classement en cases)
export function wallBounds(w) {
  const m = DIM.hw;
  if (w.t === 'seg') return [Math.min(w.ax, w.bx) - m, Math.min(w.ay, w.by) - m, Math.max(w.ax, w.bx) + m, Math.max(w.ay, w.by) + m];
  if (w.t === 'post') return [w.x - w.r, w.y - w.r, w.x + w.r, w.y + w.r];
  if (w.t === 'arc') {
    const pts = [[w.a0], [w.a1]];
    for (let q = Math.ceil(w.a0 / (Math.PI / 2)); q * (Math.PI / 2) <= w.a1; q++) pts.push([q * (Math.PI / 2)]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [a] of pts) { const x = w.cx + w.r * Math.cos(a), y = w.cy + w.r * Math.sin(a); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0 - m, y0 - m, x1 + m, y1 + m];
  }
  return null; // cadre : partout (testé à part)
}
