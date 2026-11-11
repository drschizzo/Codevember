// Le banc des traversées : ce que l'on voit à l'écran, mesuré.
//
// sceneState(u) rend l'état de TOUTES les plumes à l'instant u — exactement ce
// que la scène envoie au GPU (scene/stage.js le lit) : la nouvelle plume, l'ancienne,
// les voisines avec leurs mouvements. featherLines() pose les barbes et le
// rachis d'une plume en lignes brisées, par la même formule que le vertex shader
// (barbPose). crossings() cherche où une ligne d'une plume traverse la surface
// d'une autre : on construit, dans le repère de la plume B, une carte de hauteur
// à partir de ses propres barbes posées, et un segment de la plume A dont les
// deux extrémités sont de part et d'autre de cette surface (de plus de 0,15 mm)
// la traverse. Rien n'est supposé sur l'ordre des plumes : une traversée est
// une traversée.
//
// Module pur (sans three.js) : tests, outils, worker.
import {
  featherFrame, bodyFrame, qrot, betaAt, settleAt, wearAt, ejection, LIE, LIE_BETA, SCHED, barbPose, rachisPoint, bendOf,
  BARB_STRIDE, mix, clamp,
} from './feather.js';

// quaternions (x, y, z, w)
export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qaxis = (ax, a) => { const s = Math.sin(a / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(a / 2)]; };
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];

// lecture d'une table échantillonnée sur la boucle (interpolation linéaire)
export function sampleTable(tab, n, u, stride = 1, k = 0) {
  const N = tab.length / stride - 1, x = clamp(u, 0, 1) * N, i = Math.min(N - 1, Math.floor(x)), f = x - i;
  void n;
  return tab[i * stride + k] * (1 - f) + tab[(i + 1) * stride + k] * f;
}

// L'état de la scène à l'instant u. solved : ce que le worker a résolu
//   { beta: Float32Array (pose de la plume), old: Float32Array (soulèvement de
//     l'ancienne, cm), tiles: Map(indice → Float32Array [lacet, bascule] × (N+1)) }
// Rend une liste d'objets { id, kind: 'new'|'old'|'tile', p, q, scale, u, wear, rnd, vis, tile }.
export function sceneState(R, lay, u, solved = null) {
  const P = R.shape, T = R.tile ?? P;
  const out = [];
  const beta = (x) => (solved?.beta ? sampleTable(solved.beta, 0, x) : betaAt(x, P.radial));
  const omega = P.radial ? 0 : LIE.omega;
  // la nouvelle plume
  const fr = featherFrame(lay.Rd, lay.thH, 0, beta(u), omega * settleAt(u));
  out.push({ id: 0, kind: 'new', p: fr.p, q: fr.q, scale: 1, u, wear: wearAt(u), rnd: 0.5, vis: 1 });
  // l'ancienne : la pose de la nouvelle à u = 1, poussée puis chassée, soulevée
  // au-dessus des rangées sur lesquelles elle glisse
  const ej = ejection(u, P, lay);
  const fo = featherFrame(lay.Rd, ej.th, 0, beta(1), omega);
  let q = qmul(qaxis(fo.X, -ej.tilt), fo.q);
  q = qmul(qaxis(qrot(q, [0, 1, 0]), ej.roll), q);
  const lift = solved?.old ? sampleTable(solved.old, 0, u) : 0;
  const n = bodyFrame(lay.Rd, ej.th, 0).n;
  const po = [0, 1, 2].map((i) => fo.p[i] + ej.off[i] + n[i] * lift);
  const vis = u < SCHED.fall[1] + 0.05 && !ej.gone ? 1 : 0;
  out.push({ id: 1, kind: 'old', p: po, q, scale: 1, u: 1, wear: 1, rnd: 0.5, vis });
  // les voisines : au repos, ou écartées par la plume qui pousse (lacet et bascule résolus)
  lay.tiles.forEach((t, j) => {
    let yaw = 0, tilt = 0;
    const tab = solved?.tiles?.get(j);
    if (tab) { yaw = sampleTable(tab, 0, u, 2, 0); tilt = sampleTable(tab, 0, u, 2, 1); }
    const f = featherFrame(lay.Rd, t.th, t.ph, LIE_BETA(T.radial) - tilt, LIE.omega, t.yaw + yaw);
    out.push({ id: j + 2, kind: 'tile', p: f.p, q: f.q, scale: t.scale, u: 1, wear: t.wear, rnd: t.rnd, vis: 1, tile: j, yaw, tilt });
  });
  return out;
}

// Les lignes d'une plume dans le monde : ses barbes (nt points chacune) et son
// rachis. table : la table de barbes ; F : sa forme ; o : son état (sceneState).
// skipPlum : sans la base duveteuse (libre, cachée sous la rangée du dessus)
export function featherLines(F, table, o, lay, { nt = 8, every = 1, skipPlum = true } = {}) {
  if (!o.vis) return [];
  const k = bendOf(F, lay.Rd) * o.scale;
  const g = qrot(qinv(o.q), [0, -1, 0]);
  const S = { u: o.u, L: F.L, k, wear: o.wear, g, radial: F.radial, cal: F.calamus, over: F.over };
  const W = (p) => { const r = qrot(o.q, [p[0] * o.scale, p[1] * o.scale, p[2] * o.scale]); return [r[0] + o.p[0], r[1] + o.p[1], r[2] + o.p[2]]; };
  const lines = [];
  for (let b = 0; b < table.length / BARB_STRIDE; b += every) {
    const B = Array.from(table.subarray(b * BARB_STRIDE, (b + 1) * BARB_STRIDE));
    if (skipPlum && B[7] > 0.35) continue;
    const line = [];
    for (let i = 0; i <= nt; i++) {
      const r = barbPose(B, i / nt, 0, 0, S);
      if (r.hidden) continue;
      line.push(W(r.p));
    }
    // (une barbe agrafée fait partie d'une surface pleine ; une barbe libre —
    // les fils du paon, l'autruche — se mêle à ses voisines comme un cheveu)
    line.solid = B[11] > 0.5;
    if (line.length > 1) lines.push(line);
  }
  if (!F.radial) {
    const line = [];
    for (let i = 0; i <= 24; i++) { const r = rachisPoint(i / 24, S); if (!r.hidden) line.push(W(r.p)); }
    line.solid = true;
    if (line.length > 1) lines.push(line);
  }
  return lines;
}

// Carte de hauteur d'une plume dans son propre repère (cellules de c cm) :
// la hauteur moyenne de ses barbes dans chaque cellule.
// (seules les parties pleines font une surface : barbes agrafées et rachis)
export function heightField(lines, o, c = 0.12) {
  const iq = qinv(o.q), cells = new Map();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const line of lines) if (line.solid !== false) for (const w of line) {
    const l = qrot(iq, [w[0] - o.p[0], w[1] - o.p[1], w[2] - o.p[2]]);
    const key = `${Math.floor(l[0] / c)},${Math.floor(l[1] / c)}`;
    const e = cells.get(key);
    if (e) { e[0] += l[2]; e[1]++; } else cells.set(key, [l[2], 1]);
    x0 = Math.min(x0, l[0]); x1 = Math.max(x1, l[0]); y0 = Math.min(y0, l[1]); y1 = Math.max(y1, l[1]);
  }
  for (const e of cells.values()) e[0] /= e[1];
  // centre et rayon (écarter vite les plumes lointaines)
  const ctr = qrot(o.q, [(x0 + x1) / 2, (y0 + y1) / 2, 0]).map((v, i) => v + o.p[i]);
  if (!cells.size) return { o, iq, c, cells, ctr: o.p, rad: 0 };
  return { o, iq, c, cells, ctr, rad: Math.hypot(x1 - x0, y1 - y0) / 2 + 0.3 };
}
const hAt = (H, x, y) => { const e = H.cells.get(`${Math.floor(x / H.c)},${Math.floor(y / H.c)}`); return e ? e[0] : null; };

// Les traversées des lignes de A à travers la surface de B : { count, depth (cm), at }
export function crossings(linesA, H, eps = 0.015) {
  let count = 0, depth = 0, at = null;
  const o = H.o, rr = H.rad * H.rad;
  for (const line of linesA) {
    let prev = null;
    for (const w of line) {
      const dx = w[0] - H.ctr[0], dy = w[1] - H.ctr[1], dz = w[2] - H.ctr[2];
      if (dx * dx + dy * dy + dz * dz > rr) { prev = null; continue; }
      const l = qrot(H.iq, [w[0] - o.p[0], w[1] - o.p[1], w[2] - o.p[2]]);
      const h = hAt(H, l[0], l[1]);
      const d = h === null ? null : l[2] - h;
      if (d !== null && prev !== null && Math.abs(d) > eps && Math.abs(prev) > eps && (d > 0) !== (prev > 0)) {
        // (un segment de part et d'autre de la surface, dans son contour : il la traverse ;
        // au-delà de 1 cm d'écart, ce n'est plus la même nappe — une autre partie de la plume)
        const m = Math.min(Math.abs(d), Math.abs(prev));
        if (Math.max(Math.abs(d), Math.abs(prev)) < 1.0) { count++; if (m > depth) { depth = m; at = w; } }
      }
      prev = d;
    }
  }
  return { count, depth, at };
}

// Toutes les traversées de la scène à l'instant u, entre les plumes proches de
// la plume qui pousse (et de l'ancienne). tables : { hero, tile } (tables de
// barbes) ; rend { depth, count, pair }.
export function sceneCrossings(R, lay, u, tables, solved = null, { reach = 1.6, nt = 8 } = {}) {
  const P = R.shape, T = R.tile ?? P;
  const st = sceneState(R, lay, u, solved);
  const root = bodyFrame(lay.Rd, lay.thH, 0).p;
  const near = st.filter((o) => o.vis && (o.kind !== 'tile' || Math.hypot(o.p[0] - root[0], o.p[1] - root[1], o.p[2] - root[2]) < (P.L + T.L) * reach * 0.5 + T.L));
  const geo = near.map((o) => {
    const F = o.kind === 'tile' ? T : P;
    const lines = featherLines(F, o.kind === 'tile' ? tables.tile : tables.hero, o, lay, { nt });
    return { o, lines, H: heightField(lines, o) };
  });
  let worst = { depth: 0, count: 0, pair: null };
  let total = 0;
  for (const A of geo) for (const B of geo) {
    if (A === B) continue;
    // (deux voisines au repos ne bougent pas l'une par rapport à l'autre : leur
    // chevauchement est celui du plumage, vérifié à part)
    if (A.o.kind === 'tile' && B.o.kind === 'tile' && !A.o.yaw && !A.o.tilt && !B.o.yaw && !B.o.tilt) continue; // (ni l'une ni l'autre n'a bougé)
    const c = crossings(A.lines, B.H);
    total += c.count;
    if (c.depth > worst.depth) worst = { depth: c.depth, count: c.count, pair: `${A.o.kind}${A.o.tile ?? ''} → ${B.o.kind}${B.o.tile ?? ''}` };
  }
  return { ...worst, total };
}
void mix;

// ── Le solveur : ce qui bouge pour que rien ne traverse ──────────────────────
// Les plumes ne se déforment pas pour s'éviter (une tente ou une fente locales
// poussaient leurs barbes dans les plumes d'à côté) : elles bougent en bloc,
// comme une vraie plume qu'on pousse, autour de leur follicule.
//   1. l'ancienne plume, chassée, est soulevée juste assez au-dessus des
//      rangées sur lesquelles elle glisse (dichotomie sur la hauteur) ;
//   2. chaque voisine que la nouvelle plume (ou l'ancienne) traverserait
//      s'écarte : un lacet (elle pivote de côté, d'un sens choisi une fois pour
//      toute la boucle) et, s'il ne suffit pas, une bascule (elle se soulève),
//      le plus petit mouvement qui supprime toute traversée, dans les deux sens
//      (les lignes de l'une à travers la surface de l'autre) ;
//   3. ces mouvements sont dilatés puis lissés dans le temps : les voisines
//      s'écartent un peu avant le contact et se reposent en douceur.
const featherAt = (lay, t, T, yaw, tilt) => featherFrame(lay.Rd, t.th, t.ph, LIE_BETA(T.radial) - tilt, LIE.omega, t.yaw + yaw);

// lignes d'une plume dans son propre repère (pour les retransformer vite)
function localLines(lines, o) {
  const iq = qinv(o.q);
  return lines.map((line) => Object.assign(line.map((w) => qrot(iq, [w[0] - o.p[0], w[1] - o.p[1], w[2] - o.p[2]])), { solid: line.solid }));
}
const toWorld = (local, p, q) => local.map((line) => Object.assign(line.map((l) => { const r = qrot(q, l); return [r[0] + p[0], r[1] + p[1], r[2] + p[2]]; }), { solid: line.solid }));
const cross2 = (A, HA, B, HB, eps) => Math.max(crossings(A, HB, eps).depth, crossings(B, HA, eps).depth);

// dilatation (max sur ±w échantillons) puis lissage gaussien (σ échantillons) ;
// w ≥ 3σ : le lissage ne descend jamais sous l'exigence d'un instant
// (périodique : l'échantillon N est l'échantillon 0, le même instant de la boucle)
function dilateSmooth(arr, w, sig) {
  const n = arr.length - 1, d = new Float32Array(n), out = new Float32Array(n + 1);
  const at = (i) => arr[((i % n) + n) % n];
  for (let i = 0; i < n; i++) { let m = Math.max(arr[i], i === 0 ? arr[n] : -Infinity); for (let j = -w; j <= w; j++) m = Math.max(m, at(i + j), (i + j) % n === 0 ? arr[n] : -Infinity); d[i] = m; }
  const W = Math.ceil(sig * 3);
  for (let i = 0; i < n; i++) {
    let s = 0, ws = 0;
    for (let j = -W; j <= W; j++) { const g = Math.exp(-0.5 * (j / sig) ** 2); s += d[(((i + j) % n) + n) % n] * g; ws += g; }
    out[i] = s / ws;
  }
  out[n] = out[0];
  return out;
}

// La pose de la plume qui se couche : à chaque instant, l'angle le plus couché
// pour lequel elle ne traverse aucune voisine qu'elle recouvre (sa rangée et
// celles du dessous, au repos), mesuré comme le banc (lignes et cartes de
// hauteur, dans les deux sens) ; puis monotone — elle se pose et y reste.
export function solveSettle(R, lay, tables, { N = 200, eps = 0.012 } = {}) {
  const P = R.shape, T = R.tile ?? P;
  const out = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) out[i] = betaAt(i / N, P.radial);
  if (P.radial) return out;
  const rest = sceneState(R, lay, 0.5, null).filter((o) => o.kind === 'tile' && lay.tiles[o.tile].k >= 0);
  const root = bodyFrame(lay.Rd, lay.thH, 0).p;
  const geo = rest.filter((o) => Math.hypot(o.p[0] - root[0], o.p[1] - root[1], o.p[2] - root[2]) < P.L + T.L * 1.2)
    .map((o) => { const lines = featherLines(T, tables.tile, o, lay, { nt: 8 }); return { o, lines, H: heightField(lines, o) }; });
  const omega = LIE.omega;
  const lim = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const u = i / N, bn = out[i];
    lim[i] = bn;
    if (u < SCHED.settle[0] - 0.05) continue;
    const bad = (beta) => {
      const fr = featherFrame(lay.Rd, lay.thH, 0, beta, omega * settleAt(u));
      const o = { p: fr.p, q: fr.q, scale: 1, u, wear: wearAt(u), vis: 1 };
      const lines = featherLines(P, tables.hero, o, lay, { nt: 10 }), H = heightField(lines, o);
      for (const g of geo) if (cross2(lines, H, g.lines, g.H, eps) > 0) return true;
      return false;
    };
    if (!bad(bn)) continue;
    let lo = LIE.erect, hi = bn;
    for (let it = 0; it < 10; it++) { const m = 0.5 * (lo + hi); if (bad(m)) hi = m; else lo = m; }
    lim[i] = lo;
  }
  let m = Infinity;
  for (let i = N; i >= 0; i--) { m = Math.min(m, lim[i]); out[i] = Math.min(out[i], m); }
  return out;
}

export function solveScene(R, lay, tables, { N = 200, beta = null, onProgress = null, eps = 0.012 } = {}) {
  beta ??= solveSettle(R, lay, tables, { N, eps });
  const P = R.shape, T = R.tile ?? P;
  const root = bodyFrame(lay.Rd, lay.thH, 0).p;
  const solved = { beta, old: null, tiles: new Map() };
  // les voisines au repos : lignes et cartes de hauteur (dans leur repère, fixes)
  const restState = sceneState(R, lay, 0.5, { beta }).filter((o) => o.kind === 'tile');
  const tilesGeo = restState.map((o) => {
    const lines = featherLines(T, tables.tile, o, lay, { nt: 8 });
    return { o, t: lay.tiles[o.tile], local: localLines(lines, o), H: heightField(lines, o), lines };
  });
  const nearRoot = tilesGeo.filter((g) => Math.hypot(g.o.p[0] - root[0], g.o.p[1] - root[1], g.o.p[2] - root[2]) < P.L * 1.6 + T.L);
  const moversAt = (u, oldLift) => {
    const st = sceneState(R, lay, u, { beta, old: oldLift });
    return st.filter((o) => o.kind !== 'tile' && o.vis).map((o) => { const lines = featherLines(P, tables.hero, o, lay, { nt: 8 }); return { o, lines, H: heightField(lines, o) }; });
  };
  // 1. l'ancienne plume : soulevée au-dessus des rangées qu'elle recouvre (rangée 0 et en dessous)
  const oldReq = new Float32Array(N + 1);
  const below = tilesGeo.filter((g) => g.t.k >= 0);
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    if (u > SCHED.fall[1] + 0.06) break;
    const test = (h) => {
      const tab = new Float32Array(N + 1).fill(h);
      const m = moversAt(u, tab).find((x) => x.o.kind === 'old');
      if (!m) return 0;
      let d = 0;
      for (const g of below) { if (Math.hypot(g.o.p[0] - m.o.p[0], g.o.p[1] - m.o.p[1], g.o.p[2] - m.o.p[2]) > P.L + T.L) continue; d = Math.max(d, cross2(m.lines, m.H, g.lines, g.H, eps)); if (d > 0) break; }
      return d;
    };
    if (test(0) <= 0) continue;
    let lo = 0, hi = 1.5;
    for (let it = 0; it < 9; it++) { const mm = 0.5 * (lo + hi); if (test(mm) > 0) lo = mm; else hi = mm; }
    oldReq[i] = hi;
  }
  solved.old = dilateSmooth(oldReq, 5, 1.5);
  // 2. les voisines s'écartent, et soulèvent celles qui sont posées sur elles.
  // Ordre d'empilement au repos : pour deux voisines qui se chevauchent, celle
  // qui est au-dessus de l'autre là où elles se recouvrent.
  const zone = tilesGeo.filter((g) => Math.hypot(g.o.p[0] - root[0], g.o.p[1] - root[1], g.o.p[2] - root[2]) < P.L * 2.2 + T.L);
  const above = new Map(); // indice → ensemble des voisines posées sur elle
  for (const A of zone) {
    const set = new Set();
    for (const B of zone) {
      if (A === B || Math.hypot(A.o.p[0] - B.o.p[0], A.o.p[1] - B.o.p[1], A.o.p[2] - B.o.p[2]) > T.L * 1.4) continue;
      // B est au-dessus de A si les points de B, dans le contour de A, sont plus hauts
      let sum = 0, n = 0;
      for (const line of B.lines) if (line.solid !== false) for (const w of line) { // (parties pleines seulement : les fils libres se mêlent)
        const l = qrot(A.H.iq, [w[0] - A.o.p[0], w[1] - A.o.p[1], w[2] - A.o.p[2]]);
        const e = A.H.cells.get(`${Math.floor(l[0] / A.H.c)},${Math.floor(l[1] / A.H.c)}`);
        if (e && Math.abs(l[2] - e[0]) < 1) { sum += l[2] - e[0]; n++; }
      }
      if (n > 3 && sum > 0) set.add(B.o.tile);
    }
    above.set(A.o.tile, set);
  }
  const byIdx = new Map(zone.map((g) => [g.o.tile, g]));
  const DIRS = [[1, 0], [-1, 0], [0.8, 0.45], [-0.8, 0.45], [0, 1]];
  const LMAX = 0.5;
  const dirOf = new Map(), lamReq = new Map();
  const reachT = P.L * 1.3 + T.L;
  const geoAt = (g, lam, dir) => {
    const f = featherAt(lay, g.t, T, dir[0] * lam, dir[1] * lam);
    const o = { ...g.o, p: f.p, q: f.q };
    const H = { ...g.H, o, iq: qinv(f.q), ctr: qrot(f.q, qrot(g.H.iq, g.H.ctr.map((v, k) => v - g.o.p[k]))).map((v, k) => v + f.p[k]) };
    return { o, H, lines: toWorld(g.local, f.p, f.q) };
  };
  const dist = (a, b) => Math.hypot(a.o.p[0] - b.o.p[0], a.o.p[1] - b.o.p[1], a.o.p[2] - b.o.p[2]);
  // passe préalable : pour chaque voisine que la plume (ou l'ancienne) traverse,
  // la direction d'écart qui demande le moins, à l'instant où elle en demande le plus
  {
    const worst = new Map();
    for (let i = 0; i <= N; i += 4) {
      const movers = moversAt(i / N, solved.old);
      for (const g of zone) {
        let dmax = 0;
        for (const m of movers) if (dist(m, g) < reachT) dmax = Math.max(dmax, cross2(g.lines, g.H, m.lines, m.H, eps));
        if (dmax > 0 && dmax > (worst.get(g.o.tile)?.[0] ?? 0)) worst.set(g.o.tile, [dmax, movers]);
      }
    }
    for (const [j, [, movers]] of worst) {
      const g = byIdx.get(j);
      const near = movers.filter((m) => dist(m, g) < reachT);
      const badM = (lam, dd) => { const G = geoAt(g, lam, dd); return near.some((m) => cross2(G.lines, G.H, m.lines, m.H, eps) > 0); };
      let best = null;
      for (const dd of DIRS) {
        if (badM(LMAX, dd)) continue;
        let lo = 0, hi = LMAX;
        for (let it = 0; it < 7; it++) { const m = 0.5 * (lo + hi); if (badM(m, dd)) lo = m; else hi = m; }
        // (à amplitude égale, un écart de côté plutôt qu'un soulèvement : plus naturel)
        const cost = hi * (dd[1] > 0.9 ? 1.4 : 1);
        if (!best || cost < best[0]) best = [cost, dd];
      }
      dirOf.set(j, best ? best[1] : [0, 1]);
    }
  }
  // par étages : 0 — les voisines que la plume traverse ; 1 — celles posées sur
  // les premières et qu'elles traversent une fois écartées (lissées) ; etc.
  // Chaque étage est résolu sur les poses LISSÉES des étages précédents : le
  // lissage dans le temps ne peut plus pousser une plume dans celle d'au-dessus.
  const movers = Array.from({ length: N + 1 }, (_, i) => moversAt(i / N, solved.old));
  const poseAt = (j, i) => { const tab = solved.tiles.get(j); return tab ? [tab[i * 2], tab[i * 2 + 1]] : null; };
  const placedGeo = (i) => {
    const m = new Map();
    for (const [j] of solved.tiles) { const g = byIdx.get(j), pz = poseAt(j, i); if (g && pz && (pz[0] || pz[1])) m.set(j, geoAt(g, 1, pz)); }
    return m;
  };
  let level = zone.filter((g) => dirOf.has(g.o.tile));
  for (let L = 0; L < 4 && level.length; L++) {
    const lam = new Map(level.map((g) => [g.o.tile, new Float32Array(N + 1)]));
    for (let i = 0; i <= N; i++) {
      const placed = placedGeo(i), now = new Map();
      const order = level.slice().sort((a, b) => dist(a, { o: { p: root } }) - dist(b, { o: { p: root } }));
      for (const g of order) {
        const j = g.o.tile, d = dirOf.get(j) ?? [0, 1];
        const near = movers[i].filter((m) => dist(m, g) < reachT);
        const ups = above.get(j) ?? new Set();
        const neigh = zone.filter((h) => h !== g && dist(h, g) < T.L * 1.4);
        const bad = (lm) => {
          const G = lm > 0 ? geoAt(g, lm, d) : g;
          for (const m of near) if (cross2(G.lines, G.H, m.lines, m.H, eps) > 0) return true;
          for (const h of neigh) {
            const pl = placed.get(h.o.tile) ?? now.get(h.o.tile);
            if (!pl && ups.has(h.o.tile)) continue; // (posée dessus : un étage suivant la soulèvera)
            const H2 = pl ?? h;
            if (cross2(G.lines, G.H, H2.lines, H2.H, eps) > 0) return true;
          }
          return false;
        };
        let lm = 0;
        if (bad(0)) {
          if (bad(LMAX)) lm = LMAX;
          else { let lo = 0, hi = LMAX; for (let it = 0; it < 8; it++) { const m = 0.5 * (lo + hi); if (bad(m)) lo = m; else hi = m; } lm = hi; }
        }
        lam.get(j)[i] = lm;
        if (lm > 0) now.set(j, geoAt(g, lm, d));
      }
      onProgress?.((L + i / N) / 4);
    }
    // lissage, puis l'étage suivant : les voisines posées sur celles-ci, qu'elles traversent
    const next = new Set();
    for (const [j, l] of lam) {
      if (!l.some((x) => x > 0)) continue;
      const d = dirOf.get(j) ?? [0, 1], ls = dilateSmooth(l, 5, 1.5);
      const tab = new Float32Array((N + 1) * 2);
      for (let i = 0; i <= N; i++) { tab[i * 2] = d[0] * ls[i]; tab[i * 2 + 1] = d[1] * ls[i]; }
      solved.tiles.set(j, tab);
      for (const k of above.get(j) ?? []) if (!solved.tiles.has(k) && !lam.has(k)) next.add(k);
    }
    // (ne garder que celles qui sont vraiment traversées à un instant)
    level = [];
    for (const k of next) {
      const h = byIdx.get(k);
      if (!h) continue;
      let hit = false;
      for (let i = 0; i <= N && !hit; i += 2) {
        for (const [, G] of placedGeo(i)) if (dist(G, h) < T.L * 1.4 && cross2(G.lines, G.H, h.lines, h.H, eps) > 0) { hit = true; break; }
      }
      if (hit) { dirOf.set(k, [0, 1]); level.push(h); }
    }
  }
  return solved;
}
