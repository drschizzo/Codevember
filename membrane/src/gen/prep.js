// Préparation d'une membrane pour la simulation sur GPU (dans un worker) :
// maillage, motif de déchirure, coutures lissées, sommets dédoublés, liens,
// tables de voisinage, lèvres, fibrilles, géométrie de rendu (gen/tess.js), et la pose de
// l'armature à chaque sous-pas. La dynamique elle-même tourne sur le GPU
// (voir scene/gpusim.js).
//
// Tables de voisinage (un enregistrement de 8 mots par relation, par particule) :
//   0 arête   : [j, 0, longueur au repos, —]
//   1 flexion : [j (sommet opposé), 1, distance au repos, lien A + 1, lien B + 1,
//               lien voisin (enroulement) + 1, distance à ce lien, —]
//   2 lien    : [j (partenaire), 2, —, lien]
// Triangles : pour chaque particule, les deux autres coins (sens direct).
// Anneaux (pose : lissage des normales, courbure) : pour chaque particule, ses
// voisines par une arête (un mot), et ses partenaires de couture
// (RING_PARTNER | j, puis le lien) — huit fois moins à lire que les tables.

export const RING_PARTNER = 0x80000000;

import { geodesic, triNeighbors, V3 } from './geo.js';
import { labelTriangles, findSeams } from './tear.js';
import { partPose } from './kin.js';
import { renderMesh, LIP_RING } from './tess.js';
import { createRng } from '../rng.js';

const { min, max, acos, cos, PI, exp } = Math;
const ek = (a, b) => (a < b ? a * 1048576 + b : b * 1048576 + a);

// Lissage des coutures : chaque sommet intérieur d'un tracé glisse vers le
// milieu de ses deux voisins sur le tracé (sur la sphère) ; puis les autres
// sommets se détendent autour. Le zigzag à l'échelle du maillage disparaît,
// l'irrégularité voulue (bruit fractal du motif) demeure.
export function fairSeams(G, seams, iters = 6) {
  const nv = G.nv, pos = G.pos;
  const sn = Array.from({ length: nv }, () => []);
  for (const s of seams) { sn[s.a].push(s.b); sn[s.b].push(s.a); }
  const nb = Array.from({ length: nv }, () => new Set());
  for (let t = 0; t < G.nt; t++) { const a = G.tri[t * 3], b = G.tri[t * 3 + 1], c = G.tri[t * 3 + 2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
  const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const set = (i, p) => { const q = V3.norm(p); pos[i * 3] = q[0]; pos[i * 3 + 1] = q[1]; pos[i * 3 + 2] = q[2]; };
  for (let it = 0; it < iters; it++) {
    const next = new Map();
    for (let v = 0; v < nv; v++) if (sn[v].length === 2) {
      const m = V3.mul(V3.add(P(sn[v][0]), P(sn[v][1])), 0.5);
      next.set(v, V3.add(V3.mul(P(v), 0.45), V3.mul(m, 0.55)));
    }
    for (const [v, p] of next) set(v, p);
    // détente des autres sommets (les sommets de couture restent fixes)
    const next2 = new Map();
    for (let v = 0; v < nv; v++) if (!sn[v].length) {
      let s = [0, 0, 0];
      for (const j of nb[v]) s = V3.add(s, P(j));
      next2.set(v, V3.add(V3.mul(P(v), 0.5), V3.mul(s, 0.5 / nb[v].size)));
    }
    for (const [v, p] of next2) set(v, p);
  }
}

export function prepareMembrane(S, arm) {
  const rng = createRng(`sim:${S.seed}`);
  const G = geodesic(S.res, rng.fork('geo'));
  const nbr = triNeighbors(G.tri, G.nt);
  const L = labelTriangles(G.pos, G.tri, G.nt, nbr, S.pattern);
  const seams = findSeams(G.tri, G.nt, nbr, L, S.pattern);
  fairSeams(G, seams);

  // ── Dédoublement des sommets le long des coutures ──
  const nv = G.nv, nt = G.nt, tri = G.tri;
  const seamKey = new Set();
  for (const s of seams) seamKey.add(ek(s.a, s.b));
  const vt = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vt[tri[t * 3 + k]].push(t);
  const ctri = new Uint32Array(tri);
  const restList = [];
  for (let i = 0; i < nv; i++) restList.push([G.pos[i * 3], G.pos[i * 3 + 1], G.pos[i * 3 + 2]]);
  for (let v = 0; v < nv; v++) {
    const ts = vt[v];
    let ns = 0;
    for (const t of ts) for (let k = 0; k < 3; k++) { const a = tri[t * 3 + k], b = tri[t * 3 + ((k + 1) % 3)]; if ((a === v || b === v) && seamKey.has(ek(a, b))) ns++; }
    if (ns < 4) continue;
    const par = ts.map((_, i) => i);
    const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
      const A = ts[i], Bt = ts[j];
      for (let k = 0; k < 3; k++) {
        const w = tri[A * 3 + k];
        if (w === v) continue;
        if ((tri[Bt * 3] === w || tri[Bt * 3 + 1] === w || tri[Bt * 3 + 2] === w) && !seamKey.has(ek(v, w))) par[find(i)] = find(j);
      }
    }
    const roots = new Map();
    ts.forEach((t, i) => {
      const r = find(i);
      if (!roots.has(r)) { roots.set(r, roots.size === 0 ? v : restList.length); if (roots.size > 1) restList.push([...restList[v]]); }
      const pid = roots.get(r);
      for (let k = 0; k < 3; k++) if (tri[t * 3 + k] === v) ctri[t * 3 + k] = pid;
    });
  }
  const np = restList.length;
  const rest = new Float64Array(np * 3);
  restList.forEach((p, i) => rest.set(p, i * 3));

  // ── Liens ──
  const cornerOf = (t, v) => { for (let k = 0; k < 3; k++) if (tri[t * 3 + k] === v) return ctri[t * 3 + k]; return -1; };
  const bondMap = new Map();
  for (const s of seams) for (const v of [s.a, s.b]) {
    const i = cornerOf(s.tA, v), j = cornerOf(s.tB, v);
    if (i === j || i < 0 || j < 0) continue;
    const k = ek(i, j), o = bondMap.get(k);
    if (!o) bondMap.set(k, { i: min(i, j), j: max(i, j), mult: s.mult });
    else o.mult = min(o.mult, s.mult);
  }
  const bonds = [...bondMap.values()];
  const nb = bonds.length;
  const bondOf = new Map();
  bonds.forEach((b, k) => bondOf.set(ek(b.i, b.j), k));

  // ── Arêtes, paires de flexion ──
  const edgeMap = new Map(), E = [];
  const edgeTris = new Map();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const a = ctri[t * 3 + k], b = ctri[t * 3 + ((k + 1) % 3)], key = ek(a, b);
    let id = edgeMap.get(key);
    if (id === undefined) { id = E.length; edgeMap.set(key, id); E.push([a, b]); }
    (edgeTris.get(id) || edgeTris.set(id, []).get(id)).push(t);
  }
  const dist = (a, b) => Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]);
  let meanEdge = 0;
  for (const [a, b] of E) meanEdge += dist(a, b);
  meanEdge /= E.length;
  const third = (t, a, b) => { for (let k = 0; k < 3; k++) { const c = ctri[t * 3 + k]; if (c !== a && c !== b) return c; } return -1; };
  const bends = []; // [w0, w1, e0, e1, bondA, bondB]
  for (const [id, ts] of edgeTris) if (ts.length === 2) { const [a, b] = E[id]; bends.push([third(ts[0], a, b), third(ts[1], a, b), a, b, -1, -1]); }
  for (const s of seams) {
    const a0 = cornerOf(s.tA, s.a), b0 = cornerOf(s.tA, s.b), a1 = cornerOf(s.tB, s.a), b1 = cornerOf(s.tB, s.b);
    bends.push([third(s.tA, a0, b0), third(s.tB, a1, b1), a0, b0, a0 === a1 ? -1 : bondOf.get(ek(a0, a1)) ?? -1, b0 === b1 ? -1 : bondOf.get(ek(b0, b1)) ?? -1]);
  }

  // ── Voisinage des liens (distance en arêtes) ──
  const adj = Array.from({ length: np }, () => []);
  for (const [a, b] of E) { adj[a].push(b); adj[b].push(a); }
  const nearBond = new Int32Array(np).fill(-1), nearDist = new Float64Array(np).fill(1e9);
  {
    let front = [];
    for (let k = 0; k < nb; k++) for (const p of [bonds[k].i, bonds[k].j]) if (nearDist[p] > 0) { nearDist[p] = 0; nearBond[p] = k; front.push(p); }
    const rings = max(3, Math.round(S.curlWidth / meanEdge) + 3);
    for (let r = 1; r <= rings; r++) {
      const nx = [];
      for (const p of front) for (const o of adj[p]) if (nearDist[o] > r) { nearDist[o] = r; nearBond[o] = nearBond[p]; nx.push(o); }
      front = nx;
    }
  }

  // ── Particules : repos, masse inverse, retroussement, aire ──
  const anchorZ = cos((S.anchor * PI) / 180);
  const peelEnd = min(S.pattern.end, 1.75);
  const meta = new Float32Array(np * 8);
  const A0 = new Float64Array(np);
  for (let t = 0; t < nt; t++) {
    const a = ctri[t * 3], b = ctri[t * 3 + 1], c = ctri[t * 3 + 2];
    const u = V3.sub([rest[b * 3], rest[b * 3 + 1], rest[b * 3 + 2]], [rest[a * 3], rest[a * 3 + 1], rest[a * 3 + 2]]);
    const w = V3.sub([rest[c * 3], rest[c * 3 + 1], rest[c * 3 + 2]], [rest[a * 3], rest[a * 3 + 1], rest[a * 3 + 2]]);
    const ar = V3.len(V3.cross(u, w)) / 6;
    A0[a] += ar; A0[b] += ar; A0[c] += ar;
  }
  for (let i = 0; i < np; i++) {
    const z = rest[i * 3 + 2], wInv = z < anchorZ ? 0 : 1;
    const th = acos(max(-1, min(1, z))), u = max(0, min(1, 1 - th / peelEnd));
    meta.set([rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2], wInv, wInv ? u * u * (3 - 2 * u) : 0, nearBond[i] + 1, min(nearDist[i], 99), A0[i]], i * 8);
  }

  // ── Tables de voisinage ──
  const recs = Array.from({ length: np }, () => []);
  const f2u = new Float32Array(1), u2 = new Uint32Array(f2u.buffer);
  const fb = (x) => { f2u[0] = x; return u2[0]; };
  for (const [a, b] of E) { const l = dist(a, b) * (1 - S.pre); recs[a].push([b, 0, fb(l), 0, 0, 0, 0, 0]); recs[b].push([a, 0, fb(l), 0, 0, 0, 0, 0]); }
  for (const [w0, w1, e0, e1, bA, bB] of bends) {
    if (w0 < 0 || w1 < 0) continue;
    const d0 = dist(w0, w1);
    const nk = nearBond[e0] >= 0 ? nearBond[e0] : nearBond[e1], nd = min(nearDist[e0], nearDist[e1]) * meanEdge;
    const r = (j) => [j, 1, fb(d0), bA + 1, bB + 1, nk + 1, fb(nd), 0];
    recs[w0].push(r(w1)); recs[w1].push(r(w0));
  }
  bonds.forEach((b, k) => { recs[b.i].push([b.j, 2, 0, k, 0, 0, 0, 0]); recs[b.j].push([b.i, 2, 0, k, 0, 0, 0, 0]); });
  const trs = Array.from({ length: np }, () => []);
  for (let t = 0; t < nt; t++) { const a = ctri[t * 3], b = ctri[t * 3 + 1], c = ctri[t * 3 + 2]; trs[a].push(b, c); trs[b].push(c, a); trs[c].push(a, b); }
  const nRec = recs.reduce((s, r) => s + r.length, 0), nTr = trs.reduce((s, r) => s + r.length, 0);
  const csr = new Uint32Array(2 * (np + 1) + nRec * 8 + nTr);
  {
    let o = 2 * (np + 1);
    for (let i = 0; i < np; i++) { csr[i] = o; for (const r of recs[i]) { csr.set(r, o); o += 8; } }
    csr[np] = o;
    for (let i = 0; i < np; i++) { csr[np + 1 + i] = o; for (const v of trs[i]) csr[o++] = v; }
    csr[2 * np + 1] = o;
  }

  // ── Liens : seuil (facteur), instant de dégrafage ──
  const bondBuf = new Float32Array(nb * 8);
  bonds.forEach((b, k) => {
    const th = acos(max(-1, min(1, rest[b.i * 3 + 2])));
    const init = max(0.15, 1 - S.init * max(0, 1 - th / max(0.2, S.pattern.end)));
    const noise = 1 + S.strengthVar * (rng.next() * 2 - 1);
    const pw = min(meta[b.i * 8 + 4], meta[b.j * 8 + 4]);
    const unzip = pw > 0.25 && S.unzip > 0 ? (S.unzipDelay + (1 - pw) * 0.35 + rng.next() * 0.08) / S.unzip : 99;
    const row = new Float32Array(8);
    row[0] = b.i; row[1] = b.j; // (indices en flottants exacts : un motif binaire serait un dénormal, mis à zéro par le GPU)
    row[2] = 0; row[3] = -1; row[4] = unzip; row[5] = b.mult * noise * init; row[6] = 0; row[7] = 0;
    bondBuf.set(row, k * 8);
  });

  // ── Lèvres : particules des coutures et leurs arêtes de bord ──
  const lipOf = new Int32Array(np).fill(-1), lipP = [];
  for (const b of bonds) for (const p of [b.i, b.j]) if (lipOf[p] < 0) { lipOf[p] = lipP.length; lipP.push(p); }
  const nl = lipP.length;
  const bEdges = Array.from({ length: nl }, () => []);
  const boundary = [];
  for (const [id, ts] of edgeTris) {
    if (ts.length !== 1) continue;
    const [a, b] = E[id];
    if (lipOf[a] < 0 || lipOf[b] < 0) continue;
    const c = third(ts[0], a, b);
    boundary.push([a, b]);
    bEdges[lipOf[a]].push(b, c); bEdges[lipOf[b]].push(a, c);
  }
  const lipData = new Uint32Array(nl * 8);
  lipP.forEach((p, l) => { const e = bEdges[l].slice(0, 6); lipData.set([p, e.length / 2, ...e], l * 8); });

  // ── Anneaux ──
  const ring = ringTable(np, adj, bonds);

  // ── Fibrilles : ancrages (le partenaire voisin le long de la couture) ──
  const frng = rng.fork('fib');
  const byP = new Map();
  bonds.forEach((b, k) => (byP.get(b.i) || byP.set(b.i, []).get(b.i)).push(k));
  const fibs = [];
  for (let k = 0; k < nb && fibs.length < S.fibMax; k++) {
    if (frng.next() > S.fibrils) continue;
    const b = bonds[k];
    let nk = k;
    for (const p of adj[b.i]) { const ks = byP.get(p); if (ks) for (const k2 of ks) if (adj[bonds[k2].j].includes(b.j)) { nk = k2; break; } if (nk !== k) break; }
    const strands = 1 + Math.floor(frng.next() * S.fibPer);
    for (let s = 0; s < strands; s++) fibs.push({ k, a: b.i, an: bonds[nk].i, b: b.j, bn: bonds[nk].j, u: frng.next(), snap: S.fibSnap * exp(frng.gauss() * 0.45) * (frng.next() < 0.6 ? 0.35 : 1), r: S.fibRadius * (0.5 + frng.next()), sag: frng.next() * 2 - 1, seed: frng.next() });
  }
  const fibData = new Float32Array(fibs.length * 8);
  fibs.forEach((f, i) => fibData.set([f.a, f.an, f.b, f.bn, f.u, f.snap, f.k, 0], i * 8));
  const fib = fibrilMesh(fibs);

  // ── Géométrie de rendu : deux niveaux de détail (couches lointaines, proches) ──
  const src = { ctri, nt, np, rest, boundary, lipOf, nl };
  const geo = { lo: renderMesh(src, 2), hi: renderMesh(src, 4) };

  // ── Armature : pose à chaque sous-pas (mise en place comprise : t = 0) ──
  const F = S.frames, SUB = S.substeps, nParts = arm.parts.length;
  const nSteps = (F - 1) * SUB + 1;
  const poses = new Float32Array(nSteps * nParts * 16);
  for (let s = 0; s < nSteps; s++) {
    const t = s / ((F - 1) * SUB);
    arm.parts.forEach((P, k) => {
      const p = partPose(P, t, arm.dur), o = (s * nParts + k) * 16;
      // (R, T, σ) : p' = σR·p + T
      poses.set(p.R, o); poses.set(p.T, o + 9); poses[o + 12] = p.sig;
    });
  }
  // volumes de collision à plat
  const cols = [];
  arm.parts.forEach((P, k) => {
    for (const C of P.cols) {
      const row = new Float32Array(20);
      row[0] = C.t; row[1] = k;
      if (C.t === 0) {
        const Lb = C.L;
        row.set([Lb.R, Lb.T, Lb.th0, Lb.th1, Lb.phi, Lb.twist, Lb.w, Lb.tip, C.m], 2);
        row.set(P.bound.c, 16); row[19] = P.bound.r;
      } else {
        row.set([...C.p0, ...C.p1, C.r], 2);
        const c = [(C.p0[0] + C.p1[0]) / 2, (C.p0[1] + C.p1[1]) / 2, (C.p0[2] + C.p1[2]) / 2];
        row.set(c, 16); row[19] = Math.hypot(C.p1[0] - C.p0[0], C.p1[1] - C.p0[1], C.p1[2] - C.p0[2]) / 2 + C.r;
      }
      cols.push(row);
    }
  });
  const colBuf = new Float32Array(cols.length * 20);
  cols.forEach((r, i) => colBuf.set(r, i * 20));

  return {
    np, nb, nl, nf: fibs.length, VV: np + nl * LIP_RING, meanEdge, nParts, nCols: cols.length, nSteps,
    meta, csr, bonds: bondBuf, lipData, ring, fibData, poses, cols: colBuf,
    geo, fib,
    info: { particles: np, triangles: nt, bonds: nb, seams: seams.length, lips: nl, fibrils: fibs.length },
  };
}

// ── Anneaux : [début de chaque particule (np + 1)] puis les entrées ─────────
function ringTable(np, adj, bonds) {
  const part = Array.from({ length: np }, () => []);
  bonds.forEach((b, k) => { part[b.i].push((RING_PARTNER | b.j) >>> 0, k); part[b.j].push((RING_PARTNER | b.i) >>> 0, k); });
  const n = adj.reduce((s, a) => s + a.length, 0) + part.reduce((s, a) => s + a.length, 0);
  const out = new Uint32Array(np + 1 + n);
  let o = np + 1;
  for (let i = 0; i < np; i++) { out[i] = o; out.set(adj[i], o); o += adj[i].length; out.set(part[i], o); o += part[i].length; }
  out[np] = o;
  return out;
}

// ── Fibrilles : maillage (K tronçons × R sommets) ────────────────────────────
function fibrilMesh(list) {
  // Deux tubes par filament, un par moitié (fTime.y : 0, côté A ; 1, côté B),
  // qui partagent leur anneau du milieu tant que le fil tient et se séparent
  // quand il claque : aucun tronçon n'enjambe l'écart entre les lèvres.
  // (48 tronçons : de quoi dessiner les perles des fils humides)
  const K = 48, H = K / 2, R = 5, nRing = 2 * (H + 1), nvf = nRing * R, n = list.length;
  const fIdx = new Float32Array(n * nvf * 4), fPar = new Float32Array(n * nvf * 4), fTime = new Float32Array(n * nvf * 4);
  const index = [];
  list.forEach((fb, s) => {
    for (let side = 0; side < 2; side++) for (let k = 0; k <= H; k++) for (let r = 0; r < R; r++) {
      const ring = side * (H + 1) + k;
      const o = (s * nvf + ring * R + r) * 4;
      fIdx.set([fb.a, fb.an, fb.b, fb.bn], o);
      fPar.set([fb.u, (side * H + k) / K, (r / R) * PI * 2, fb.r], o);
      fTime.set([s, side, fb.sag, fb.seed], o);
    }
    for (let side = 0; side < 2; side++) for (let k = 0; k < H; k++) for (let r = 0; r < R; r++) {
      const a = s * nvf + (side * (H + 1) + k) * R + r, b = s * nvf + (side * (H + 1) + k) * R + ((r + 1) % R), c = a + R, d = b + R;
      index.push(a, c, b, b, c, d);
    }
  });
  return { count: n, fIdx, fPar, fTime, index: Uint32Array.from(index) };
}
