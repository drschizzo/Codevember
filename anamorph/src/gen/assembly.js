// L'assemblage et le démontage du tas (le scénario de la boucle).
//
// Au début et à la fin de la boucle, les pièces sont éparpillées à plat sur le
// sol autour du tas, sans se toucher. Pendant l'assemblage, elles viennent une à
// une dans l'ordre de construction (src/gen/pieces.js : chaque mère avant ses
// filles) : elles montent à la verticale, passent au-dessus du tas, prennent leur
// orientation, puis descendent se poser par une approche LIBRE (un couloir où
// elles ne rencontrent aucune pièce déjà posée). Le démontage est le même film
// à l'envers : la boucle est symétrique autour du milieu des deux figures.
//
// Pose d'une pièce : x' = c(t) + R(t)·(x − c_f), avec c_f le milieu de son axe
// à sa place, R(t) la rotation depuis sa pose finale (identité une fois posée).
// Module pur (Node, worker, page) : la scène et les tests lisent les mêmes poses.
import { axisAt, supportAt, pieceFrame } from './forge.js';
import { segDist, jointZone } from './pieces.js';

// ── quaternions (x, y, z, w) ──
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export function qrot(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
// rotation d'une base orthonormée (colonnes A) vers une autre (colonnes B) : R = B·Aᵀ
function qFromBases(A, B) {
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) m[r][c] += B[k][r] * A[k][c];
  const t = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; q = [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, 0.25 * s]; }
  else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; q = [0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s]; }
  else if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; q = [(m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s]; }
  else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; q = [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s, (m[1][0] - m[0][1]) / s]; }
  const l = Math.hypot(...q); return q.map((x) => x / l);
}
function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], bb = b;
  if (d < 0) { d = -d; bb = b.map((x) => -x); }
  if (d > 0.9995) { const q = a.map((x, i) => x + (bb[i] - x) * t); const l = Math.hypot(...q); return q.map((x) => x / l); }
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((x, i) => (x * Math.sin((1 - t) * th) + bb[i] * Math.sin(t * th)) / s);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const nrm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mid = (P) => mul(add(P.p0, P.p1), 0.5);

// Le point le plus bas de la vraie section d'une pièce (cintrage, écrasement, amincissement)
function lowest(P) {
  let low = Infinity;
  for (let k = 0; k <= 16; k++) low = Math.min(low, axisAt(P, k / 16)[1] - supportAt(P, [0, -1, 0], k / 16));
  return low;
}

// Plan : pour chaque pièce, sa place au sol (centre, rotation depuis la pose
// finale), sa direction d'approche et l'altitude de son passage au-dessus du tas.
export function planAssembly(pieces, bounds, rnd, { ring = [0.45, 2.6], height = 0.8 } = {}) {
  const N = pieces.length;
  const cx = (bounds[0] + bounds[3]) / 2, cz = (bounds[2] + bounds[5]) / 2;
  const rx = (bounds[3] - bounds[0]) / 2, rz = (bounds[5] - bounds[2]) / 2;
  const plan = [];
  const ground = []; // segments posés au sol (xz) déjà placés
  for (let i = 0; i < N; i++) {
    const P = pieces[i], F0 = pieceFrame(P), cf = mid(P), L = Math.hypot(...sub(P.p1, P.p0));
    // ── la place au sol : à plat, cap tiré, hors de l'emprise du tas, sans toucher les autres
    let g = null;
    for (let tries = 0; tries < 400 && !g; tries++) {
      const a = rnd() * 2 * Math.PI, d = ring[0] + (ring[1] - ring[0]) * Math.sqrt(rnd());
      const c = [cx + Math.cos(a) * (rx + d), 0, cz + Math.sin(a) * (rz + d)];
      const yaw = rnd() * Math.PI;
      const X = [Math.cos(yaw), 0, Math.sin(yaw)];
      const Pg = { ...P, p0: sub(c, mul(X, L / 2)), p1: add(c, mul(X, L / 2)) };
      const s0 = [Pg.p0[0], 0, Pg.p0[2]], s1 = [Pg.p1[0], 0, Pg.p1[2]];
      if (ground.some((o) => segDist(s0, s1, o.s0, o.s1) < P.rc + o.rc + 0.01)) continue;
      // (le passage vertical de la pièce, au-dessus de sa place, est libre : rien au sol n'y est)
      const low = lowest(Pg);
      Pg.p0[1] -= low; Pg.p1[1] -= low;
      ground.push({ s0, s1, rc: P.rc });
      const Fg = pieceFrame(Pg);
      g = { c: mid(Pg), q: qFromBases([F0.X, F0.Y, F0.Z], [Fg.X, Fg.Y, Fg.Z]) };
    }
    if (!g) g = { c: [cx + rx + ring[1] + 0.3 * i, -1, cz], q: [0, 0, 0, 1] }; // (jamais vu en pratique : sous le sol, hors champ)
    const alt = height + 0.45 + 0.35 * ((i * 0.618034) % 1); // (des altitudes étagées : les pièces en vol se croisent peu)
    plan.push({ cf, g, alt });
  }
  // ── l'ordre de montage et les approches : calculés à rebours, comme un démontage
  orderAndApproaches(pieces, plan);
  return plan;
}

// Démontage glouton : on retire, tant qu'il en reste, les pièces sans fille
// restante dont un couloir de sortie (de la verticale vers l'oblique, jusqu'à
// l'altitude de passage) ne rencontre aucune autre pièce restante. Si aucune ne
// peut sortir, celle qui en rencontre le moins sort (comptée, testée).
// L'assemblage est ce démontage à l'envers : chaque pièce descend par le couloir
// par lequel elle sortirait, parmi exactement les pièces déjà posées.
function orderAndApproaches(pieces, plan) {
  const N = pieces.length;
  const box = pieces.map((P) => [0, 1, 2].map((d) => [Math.min(P.p0[d], P.p1[d]) - P.rc, Math.max(P.p0[d], P.p1[d]) + P.rc]));
  const dirs = [[0, 1, 0]];
  for (const pol of [20, 35, 50, 65, 78]) for (let k = 0; k < 10; k++) { const az = (k / 10) * 2 * Math.PI; const p = pol * Math.PI / 180; dirs.push([Math.sin(p) * Math.cos(az), Math.cos(p), Math.sin(p) * Math.sin(az)]); }
  const alive = new Uint8Array(N).fill(1);
  const kids = new Int32Array(N);
  for (const P of pieces) if (P.parent >= 0) kids[P.parent]++;
  const test = (i) => {
    const P = pieces[i], alt = plan[i].alt;
    let best = null;
    for (const v of dirs) {
      const S = Math.max(0.05, (alt - Math.min(P.p0[1], P.p1[1])) / v[1]);
      // pièces dont la boîte touche le couloir
      const e0 = add(P.p0, mul(v, S)), e1 = add(P.p1, mul(v, S));
      const lo = [0, 1, 2].map((d) => Math.min(P.p0[d], P.p1[d], e0[d], e1[d]) - P.rc), hi = [0, 1, 2].map((d) => Math.max(P.p0[d], P.p1[d], e0[d], e1[d]) + P.rc);
      const near = [];
      for (let j = 0; j < N; j++) if (j !== i && alive[j] && box[j].every(([a, b], d) => b >= lo[d] && a <= hi[d])) near.push(j);
      let hits = 0;
      for (let s = 0.02; s <= S && !hits; s += 0.025) {
        const a0 = add(P.p0, mul(v, s)), a1 = add(P.p1, mul(v, s));
        for (const j of near) {
          const o = pieces[j];
          if (j === P.parent && s < jointZone(P.rc, o.rc)) continue;
          if (segDist(a0, a1, o.p0, o.p1) < P.rc + o.rc) { hits++; break; }
        }
      }
      if (!hits) return { v, S, hits: 0 };
      // (sinon : à quelle distance le couloir se bloque ; on garde le plus long)
      if (!best || hits < best.hits) best = { v, S, hits };
    }
    return best;
  };
  const out = []; // ordre de démontage
  let left = N;
  while (left) {
    const leaves = [];
    for (let i = 0; i < N; i++) if (alive[i] && kids[i] === 0) leaves.push(i);
    const res = leaves.map((i) => ({ i, r: test(i) }));
    let go = res.filter((x) => x.r.hits === 0);
    if (!go.length) go = [res.reduce((a, b) => (b.r.hits < a.r.hits ? b : a))];
    // (les plus hautes d'abord : le démontage se lit du haut vers le bas)
    go.sort((a, b) => Math.max(pieces[b.i].p0[1], pieces[b.i].p1[1]) - Math.max(pieces[a.i].p0[1], pieces[a.i].p1[1]));
    for (const { i, r } of go) {
      alive[i] = 0; left--;
      if (pieces[i].parent >= 0) kids[pieces[i].parent]--;
      Object.assign(plan[i], { v: r.v, S: r.S, free: r.hits === 0 });
      out.push(i);
    }
  }
  out.reverse().forEach((i, k) => { plan[i].k = k; }); // rang dans l'assemblage
}

// Avancement de la pièce i dans son vol (0 au sol, 1 posée) à la phase u.
// Assemblage de a0 à a1 (arrivées régulières, dans l'ordre), vol de T ;
// démontage : le même film, renversé autour de m (le milieu des deux figures).
export function flightAt(u, i, N, { a0 = 0.07, a1 = 0.28, T = 0.05, m = 0.5 } = {}) {
  let x = u - Math.floor(u);
  if (x > m) x = 2 * m - x; // (le film à l'envers)
  const arr = a0 + (a1 - a0) * (N > 1 ? i / (N - 1) : 0);
  return Math.min(1, Math.max(0, (x - (arr - T)) / T));
}

const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// Pose de la pièce (centre, rotation depuis la pose finale) pour un avancement s.
// Montée verticale (0–0,22), traversée à l'altitude en prenant l'orientation
// finale (0,22–0,6), descente le long de l'approche, ralentie à la fin (0,6–1).
export function poseAt(pl, s) {
  if (s <= 0) return { c: pl.g.c, q: pl.g.q };
  if (s >= 1) return { c: pl.cf, q: [0, 0, 0, 1] };
  const top0 = [pl.g.c[0], pl.alt, pl.g.c[2]];
  const top1 = add(pl.cf, mul(pl.v, pl.S));
  const I = [0, 0, 0, 1];
  if (s < 0.22) { const t = ease(s / 0.22); return { c: add(pl.g.c, mul(sub(top0, pl.g.c), t)), q: slerp(pl.g.q, I, 0.15 * t) }; }
  if (s < 0.6) {
    const t = ease((s - 0.22) / 0.38);
    // (un léger arc : la traversée bombe vers le haut)
    const c = add(add(top0, mul(sub(top1, top0), t)), [0, 0.12 * Math.sin(Math.PI * t), 0]);
    return { c, q: slerp(pl.g.q, I, 0.15 + 0.85 * t) };
  }
  const t = (s - 0.6) / 0.4, e = 1 - (1 - t) ** 3; // (approche : rapide puis posée en douceur)
  return { c: add(top1, mul(sub(pl.cf, top1), e)), q: I };
}

// Le plan tel que le worker l'envoie (16 nombres par pièce) → objets de poseAt.
export function unpackPlan(data, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = i * 16, a = (k, m) => Array.from(data.subarray(o + k, o + k + m));
    out.push({ cf: a(0, 3), g: { c: a(3, 3), q: a(6, 4) }, v: a(10, 3), S: data[o + 13], alt: data[o + 14], k: data[o + 15] });
  }
  return out;
}
