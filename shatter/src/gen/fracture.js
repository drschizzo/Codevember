// Fracture d'une coque de verre, et chorégraphie de ses éclats.
//
// 1. Les germes : placés selon le mécanisme de rupture, dans un espace de
//    coordonnées qui lui est propre (la « métrique » de la fissuration) :
//    - bille : coordonnées log-polaires autour du point d'impact (log ρ, φ). Des
//      germes uniformes dans cet espace donnent, sur le verre, des éclats dont
//      la taille croît comme la distance à l'impact (loi de puissance de la
//      fragmentation), des fissures radiales en étoile et des fissures
//      concentriques qui les relient (la toile d'araignée) ; zone broyée au centre ;
//    - résonance : (angle autour de l'axe, abscisse le long du profil), très
//      étirée : des lames méridiennes qui partent du bord ;
//    - trempe : distance euclidienne, germes nombreux : des dés ;
//    - choc thermique : distance euclidienne sur un espace fortement gauchi,
//      germes rares : de grandes pièces aux fissures sinueuses.
// 2. L'étiquetage exact : chaque triangle de la surface est découpé en régions
//    (Sutherland-Hodgman sur les différences de distances aux germes, qui
//    varient linéairement sur le triangle) : les fissures sont des lignes nettes
//    qui traversent les triangles, pas des escaliers qui les suivent.
// 3. Chaque région devient un éclat fermé : paroi externe, paroi interne
//    (décalée de l'épaisseur), chants le long des fissures et du bord.
// 4. Chorégraphie : front de fissure (plus court chemin dans le graphe des
//    éclats, à vitesse finie), vitesse, rotation, effritement.
import { createRng, createNoise3 } from '../rng.js';
import { shellSurface } from './forms.js';
import { PH } from '../cycle.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const wrapPi = (x) => x - 2 * Math.PI * Math.round(x / (2 * Math.PI));

// vitesses physiques (u/s) : la pièce mesure 2 u ≈ 25 cm
const PHYS = 6.5;

export const MECHS = {
  ball: { label: 'Pendule (bille d’acier)' },
  resonance: { label: 'Haut-parleur (résonance)' },
  tempered: { label: 'Percussion (verre trempé)' },
  thermal: { label: 'Chalumeau (choc thermique)' },
};

// ── Métrique et germes propres au mécanisme ──────────────────────────────────
function makeMetric(spec, surf, rng) {
  const S = surf.size, mech = spec.mech;
  const noise = createNoise3(`${spec.seed}:warp`);
  const warpAmp = S * (spec.warp ?? 0.02) * (mech === 'thermal' ? 4 : 1), wf = mech === 'thermal' ? 1.6 / S : 4 / S;
  const warp = (p) => [
    p[0] + warpAmp * noise.fbm(p[0] * wf, p[1] * wf, p[2] * wf, 3),
    p[1] + warpAmp * noise.fbm(p[0] * wf + 17.1, p[1] * wf, p[2] * wf, 3),
    p[2] + warpAmp * noise.fbm(p[0] * wf, p[1] * wf + 31.7, p[2] * wf, 3),
  ];
  // point d'origine de la rupture (sur la surface externe)
  const nv = surf.pos.length / 3;
  const P = (i) => [surf.pos[3 * i], surf.pos[3 * i + 1], surf.pos[3 * i + 2]];
  const Nn = (i) => [surf.nor[3 * i], surf.nor[3 * i + 1], surf.nor[3 * i + 2]];
  const pickVertex = (lo, hi, az) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < nv; i++) {
      const a = surf.acc[i];
      if (a < lo || a > hi) continue;
      const p = P(i), ang = Math.atan2(p[2], p[0]);
      const d = Math.abs(wrapPi(ang - az)) + Math.abs(a - (lo + hi) / 2);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const az = rng.range(-Math.PI, Math.PI);
  // (sur la coupe ou la panse, jamais sur le pied ni la jambe)
  const sB = surf.sBowl ?? 0, at = (f) => sB + (1 - sB) * f;
  const oi = mech === 'resonance' ? pickVertex(0.97, 1, az) : pickVertex(at(spec.impactAt?.[0] ?? 0.3), at(spec.impactAt?.[1] ?? 0.72), az);
  const O = P(oi), n0 = Nn(oi);
  const t1 = norm(cross(Math.abs(n0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], n0)), t2 = cross(n0, t1);

  let coords, dist, seeds = [];
  if (mech === 'ball') {
    const rmin = S * (spec.crush ?? 0.035), A = spec.aspect ?? 0.6;
    coords = (p) => { const d = sub(warp(p), O); return [Math.log(Math.max(rmin, len(d))) * A, Math.atan2(dot(d, t2), dot(d, t1))]; };
    dist = (a, b) => Math.hypot(a[0] - b[0], wrapPi(a[1] - b[1]));
    const rays = spec.rays ?? 11, lo = Math.log(rmin * 1.4), hi = Math.log(S * 1.6);
    const step = ((2 * Math.PI) / rays) / A * (spec.ringStep ?? 0.5);
    // Loin de l'impact, la loi de puissance seule donnerait des lamelles de la
    // hauteur de la pièce (15 à 30 cm), qui, couchées sur leur dos courbe, se
    // dressent en arceaux au-dessus du tas. Les fissures radiales se
    // ramifient et les anneaux se resserrent pour qu'aucun éclat ne dépasse
    // ~cap (≈ 6 cm), comme sur un vrai verre creux percé par une bille.
    const cap = S * 0.26;
    let ring = 0;
    for (let L = lo; L < hi; ring++) {
      const rho = Math.exp(L), dL = Math.min(step, Math.log(1 + cap / rho));
      const n = Math.max(rays * (ring >= (spec.branchAt ?? 3) ? 2 : 1), Math.round((2 * Math.PI * rho) / cap)), off = rng.next() * 2 * Math.PI;
      for (let j = 0; j < n; j++) seeds.push([(L + rng.range(-0.25, 0.25) * dL) * A, wrapPi(off + (2 * Math.PI * (j + rng.range(-0.3, 0.3))) / n)]);
      L += dL * (0.85 + 0.3 * rng.next());
    }
    seeds.push([Math.log(rmin) * A, 0]); // (zone broyée)
  } else if (mech === 'resonance') {
    const m = spec.strips ?? 10, k = spec.elong ?? 0.22;
    coords = (p, a) => { const q = warp(p); return [Math.atan2(q[2], q[0]), a]; };
    dist = (a, b) => Math.hypot(wrapPi(a[0] - b[0]), (a[1] - b[1]) / k * 0.6);
    for (let j = 0; j < m; j++) {
      const th = (2 * Math.PI * (j + rng.range(-0.25, 0.25))) / m;
      const rows = rng.int(2, 3);
      for (let r = 0; r < rows; r++) seeds.push([th + rng.range(-0.1, 0.1), 1 - Math.pow(rng.next(), 0.7) * 1.05]);
    }
  } else {
    coords = (p) => warp(p);
    dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    // germes : points de la surface tirés selon l'aire
    const n = mech === 'tempered' ? (spec.dice ?? 180) : (spec.pieces ?? 10);
    const T = surf.tri, cum = [];
    let tot = 0;
    for (let t = 0; t < T.length; t += 3) {
      tot += len(cross(sub(P(T[t + 1]), P(T[t])), sub(P(T[t + 2]), P(T[t])))) / 2;
      cum.push(tot);
    }
    for (let i = 0; i < n; i++) {
      const x = rng.next() * tot;
      let lo2 = 0, hi2 = cum.length - 1;
      while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (cum[mid] < x) lo2 = mid + 1; else hi2 = mid; }
      let u = rng.next(), v = rng.next();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const t = lo2 * 3, a = P(T[t]), b = P(T[t + 1]), c = P(T[t + 2]);
      seeds.push(coords(add(a, add(mul(sub(b, a), u), mul(sub(c, a), v)))));
    }
  }
  return { coords, dist, seeds, O, n0, warp, noise };
}

// ── Découpage d'un triangle en régions ───────────────────────────────────────
// sommet de polygone : { p, n, a, d: Map label → distance } ; tag de l'arête
// (i → i+1) : -1 intérieur, -2 bord de la coque, m ≥ 0 fissure avec m
const before = (A, B) => A.p[0] < B.p[0] || (A.p[0] === B.p[0] && (A.p[1] < B.p[1] || (A.p[1] === B.p[1] && A.p[2] < B.p[2])));
function lerpV(A, B, t, labels) {
  // (ordre canonique : deux triangles voisins calculent exactement le même point
  // sur leur arête commune)
  if (before(B, A)) { const C = A; A = B; B = C; t = 1 - t; }
  const d = {};
  for (const l of labels) d[l] = A.d[l] + (B.d[l] - A.d[l]) * t;
  return { p: add(A.p, mul(sub(B.p, A.p), t)), n: add(A.n, mul(sub(B.n, A.n), t)), a: A.a + (B.a - A.a) * t, d };
}
function clip(poly, tags, l, m, labels) {
  const out = [], otags = [];
  const n = poly.length;
  const g = (V) => V.d[l] - V.d[m];
  for (let i = 0; i < n; i++) {
    const A = poly[i], B = poly[(i + 1) % n], ga = g(A), gb = g(B);
    const ina = ga <= 0, inb = gb <= 0;
    if (ina) {
      out.push(A);
      if (inb) otags.push(tags[i]);
      else { otags.push(tags[i]); out.push(lerpV(A, B, ga / (ga - gb), labels)); otags.push(m); }
    } else if (inb) {
      out.push(lerpV(A, B, ga / (ga - gb), labels)); otags.push(tags[i]);
    }
  }
  return { poly: out, tags: otags };
}

// ── Composantes connexes d'un ensemble de polygones ──────────────────────────
// (polygones qui partagent un sommet ; positions arrondies au 1/100 000)
const qk = (p) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`;
function components(polys) {
  const par = polys.map((_, i) => i);
  const find = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  const owner = new Map();
  polys.forEach(({ poly }, i) => {
    for (const V of poly) { const k = qk(V.p); if (owner.has(k)) par[find(i)] = find(owner.get(k)); else owner.set(k, i); }
  });
  const groups = new Map();
  polys.forEach((pp, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(pp); });
  return [...groups.values()];
}

// ── Éclats secondaires ───────────────────────────────────────────────────────
// Un grand éclat est pré-découpé en n morceaux (Voronoï euclidien, germes
// espacés par l'échantillonnage de Mitchell), qui restent collés : la
// simulation (sim.js) ne les sépare que si l'éclat heurte assez fort la sole
// ou un autre éclat. Distances au carré : leurs différences varient
// linéairement le long d'une arête, les fissures secondaires sont donc des
// segments exacts. Les chants créés portent l'étiquette -3 (chant, mais pas de
// ligne de fissure allumée par le front primaire).
function splitSecondary(polys, n, r) {
  const tris = [];
  let tot = 0;
  for (const { poly } of polys) for (let k = 1; k < poly.length - 1; k++) {
    const a = poly[0].p, b = poly[k].p, c = poly[k + 1].p;
    tot += len(cross(sub(b, a), sub(c, a))) / 2;
    tris.push([tot, a, b, c]);
  }
  const pick = () => {
    const x = r.next() * tot;
    let lo = 0, hi = tris.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tris[m][0] < x) lo = m + 1; else hi = m; }
    let u = r.next(), v = r.next();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const [, a, b, c] = tris[lo];
    return add(a, add(mul(sub(b, a), u), mul(sub(c, a), v)));
  };
  const seeds = [pick()];
  while (seeds.length < n) {
    let best = null, bd = -1;
    for (let i = 0; i < 12; i++) { const p = pick(), d = Math.min(...seeds.map((q) => len(sub(p, q)))); if (d > bd) { bd = d; best = p; } }
    seeds.push(best);
  }
  const L = seeds.map((_, j) => 1e6 + j);
  const outs = new Map(L.map((l) => [l, []]));
  for (const { poly, tags } of polys) {
    const verts = poly.map((V) => {
      const d = {};
      L.forEach((l, j) => { const q = seeds[j]; d[l] = (V.p[0] - q[0]) ** 2 + (V.p[1] - q[1]) ** 2 + (V.p[2] - q[2]) ** 2; });
      return { p: V.p, n: V.n, a: V.a, d };
    });
    const nearest = verts.map((V) => L.reduce((b, l) => (V.d[l] < V.d[b] ? l : b), L[0]));
    // (tous les sommets du même côté de chaque bissectrice : le polygone entier)
    if (nearest.every((x) => x === nearest[0])) { outs.get(nearest[0]).push({ poly: verts, tags: tags.slice() }); continue; }
    for (const l of L) {
      let cur = { poly: verts, tags };
      for (const m of L) {
        if (m === l) continue;
        cur = clip(cur.poly, cur.tags, l, m, L);
        if (cur.poly.length < 3) break;
      }
      if (cur.poly.length >= 3) outs.get(l).push({ poly: cur.poly, tags: cur.tags.map((t) => (t >= 1e6 ? -3 : t)) });
    }
  }
  const groups = [];
  for (const g of outs.values()) if (g.length) groups.push(...components(g));
  return groups;
}

// ── Fracture complète ────────────────────────────────────────────────────────
// spec : { seed, form, size, thickness, mech, … , Ts } ; renvoie les tampons du
// maillage (tous les éclats dans un seul maillage) et la table des éclats
export function fracture(spec, opts = {}) {
  const rng = createRng(`${spec.seed}:fracture`);
  const surf = shellSurface(spec, opts);
  const M = makeMetric(spec, surf, rng);
  const S = surf.size, h = surf.thickness, Ts = spec.Ts ?? 9;
  const nv = surf.pos.length / 3;
  const P = (i) => [surf.pos[3 * i], surf.pos[3 * i + 1], surf.pos[3 * i + 2]];
  const Nn = (i) => [surf.nor[3 * i], surf.nor[3 * i + 1], surf.nor[3 * i + 2]];

  // coordonnées et deux plus proches germes de chaque sommet
  // (K plus proches germes de chaque sommet ; un triangle considère ceux de ses
  // sommets ET de leurs voisins : deux triangles qui partagent une arête voient
  // alors les mêmes concurrents le long de cette arête, et la découpent pareil)
  const K = spec.mech === "ball" ? 5 : 3;
  const C = new Array(nv), nearK = new Int32Array(nv * K);
  for (let i = 0; i < nv; i++) {
    C[i] = M.coords(P(i), surf.acc[i]);
    const bi = new Array(K).fill(-1), bd = new Array(K).fill(Infinity);
    for (let s = 0; s < M.seeds.length; s++) {
      const d = M.dist(C[i], M.seeds[s]);
      if (d >= bd[K - 1]) continue;
      let k = K - 1;
      while (k > 0 && bd[k - 1] > d) { bd[k] = bd[k - 1]; bi[k] = bi[k - 1]; k--; }
      bd[k] = d; bi[k] = s;
    }
    for (let k = 0; k < K; k++) nearK[i * K + k] = bi[k];
  }
  const near = new Int32Array(nv * 2);
  for (let i = 0; i < nv; i++) { near[2 * i] = nearK[i * K]; near[2 * i + 1] = nearK[i * K + 1]; }
  // labels vus depuis chaque sommet : les siens et ceux de ses voisins
  const ring = Array.from({ length: nv }, (_, i) => new Set([...nearK.subarray(i * K, i * K + K)].filter((x) => x >= 0)));
  const seen = ring.map((s) => new Set(s));
  for (let t = 0; t < surf.tri.length; t += 3) {
    const a = surf.tri[t], b = surf.tri[t + 1], c = surf.tri[t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { for (const x of ring[v]) seen[u].add(x); for (const x of ring[u]) seen[v].add(x); }
  }

  // régions de chaque triangle
  let regions = new Map(); // label → [{ poly, tags }]
  const T = surf.tri;
  const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let t = 0; t < T.length; t += 3) {
    const vi = [T[t], T[t + 1], T[t + 2]];
    // (tous les concurrents plausibles : un germe qui l'emporte sur une arête est
    // vu par ses deux triangles, qui la découpent donc au même endroit)
    const labels = [...new Set(vi.flatMap((i) => [...seen[i]]))];
    const verts = vi.map((i) => {
      const d = {};
      for (const l of labels) d[l] = M.dist(C[i], M.seeds[l]);
      return { p: P(i), n: Nn(i), a: surf.acc[i], d };
    });
    const tags = [0, 1, 2].map((k) => (surf.border.has(edgeKey(vi[k], vi[(k + 1) % 3])) ? -2 : -1));
    // label sans concurrent sur le triangle : pas de découpage
    const own = vi.map((i) => near[2 * i]);
    if (own[0] === own[1] && own[1] === own[2]) {
      const l = own[0];
      // (un germe voisin peut-il l'emporter à l'intérieur ? non : distances linéaires)
      let pure = true;
      for (const m of labels) if (m !== l && verts.some((V) => V.d[m] < V.d[l])) pure = false;
      if (pure) { if (!regions.has(l)) regions.set(l, []); regions.get(l).push({ poly: verts, tags }); continue; }
    }
    for (const l of labels) {
      let cur = { poly: verts, tags };
      for (const m of labels) {
        if (m === l) continue;
        cur = clip(cur.poly, cur.tags, l, m, labels);
        if (cur.poly.length < 3) break;
      }
      if (cur.poly.length < 3) continue;
      if (!regions.has(l)) regions.set(l, []);
      regions.get(l).push(cur);
    }
  }

  // ── Composantes connexes ──
  // Une métrique projetée (log-polaire de la bille, angle × abscisse de la
  // résonance) envoie plusieurs zones disjointes de la coque — devant et
  // derrière du col, deux côtés de la panse — vers le même germe. Gardées
  // ensemble, elles formeraient un « éclat » en morceaux séparés qui bougent
  // d'un bloc : l'un repose sur la sole, l'autre flotte à côté. Chaque région
  // est donc découpée en ses composantes (polygones qui partagent un sommet).
  const keyComp = new Map(); // germe | sommet → composante
  {
    const split = new Map();
    let next = 0;
    for (const [l, polys] of regions) {
      for (const g of components(polys)) {
        const id = next++;
        split.set(id, g);
        for (const { poly } of g) for (const V of poly) keyComp.set(`${l}|${qk(V.p)}`, id);
      }
    }
    regions = split;
  }
  const compOf = (m, a, b) => keyComp.get(`${m}|${qk(a)}`) ?? keyComp.get(`${m}|${qk(b)}`);

  // ── Éclats : statistiques, graphe ──
  const labels = [...regions.keys()];
  const index = new Map(labels.map((l, i) => [l, i]));
  const frags = labels.map(() => ({ area: 0, c: [0, 0, 0], n: [0, 0, 0], amax: 0, rad: 0, nb: new Set() }));
  for (const l of labels) {
    const F = frags[index.get(l)];
    for (const { poly, tags } of regions.get(l)) {
      for (let k = 1; k < poly.length - 1; k++) {
        const ar = len(cross(sub(poly[k].p, poly[0].p), sub(poly[k + 1].p, poly[0].p))) / 2;
        const ctr = mul(add(poly[0].p, add(poly[k].p, poly[k + 1].p)), 1 / 3);
        F.area += ar; F.c = add(F.c, mul(ctr, ar)); F.n = add(F.n, mul(poly[0].n, ar));
      }
      for (const V of poly) F.amax = Math.max(F.amax, V.a);
      tags.forEach((m, k) => {
        if (m < 0) return;
        const c = compOf(m, poly[k].p, poly[(k + 1) % poly.length].p);
        if (c !== undefined && index.has(c)) F.nb.add(index.get(c));
      });
    }
  }
  for (const F of frags) {
    F.n = norm(F.n); F.c = sub(mul(F.c, 1 / Math.max(1e-12, F.area)), mul(F.n, h / 2));
    // normale moyenne en octaédrique (deux flottants : l'éclat se couche dessus)
    const l1 = Math.abs(F.n[0]) + Math.abs(F.n[1]) + Math.abs(F.n[2]);
    let ox = F.n[0] / l1, oz = F.n[2] / l1;
    if (F.n[1] < 0) { const tx = (1 - Math.abs(oz)) * Math.sign(ox || 1), tz = (1 - Math.abs(ox)) * Math.sign(oz || 1); ox = tx; oz = tz; }
    F.oct = [ox, oz];
  }

  // ── Front de fissure : plus court chemin depuis l'éclat d'origine ──
  const speed = S * ({ ball: 6, resonance: 3.5, tempered: 14, thermal: 0.7 }[spec.mech]) * (spec.frontSpeed ?? 1);
  const t0 = PH.rupture * Ts;
  const tc = new Float64Array(frags.length).fill(Infinity);
  const starts = spec.mech === 'resonance'
    ? frags.map((F, i) => (F.amax > 0.985 && F.amax < 1.5 ? i : -1)).filter((i) => i >= 0)
    : [frags.reduce((b, F, i) => (len(sub(F.c, M.O)) < len(sub(frags[b].c, M.O)) ? i : b), 0)];
  const queue = [];
  for (const s of starts) { tc[s] = t0 + (spec.mech === 'resonance' ? rng.range(0, 0.05) : 0); queue.push(s); }
  while (queue.length) { // (Dijkstra simple : graphes de quelques centaines de nœuds)
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (tc[queue[i]] < tc[queue[bi]]) bi = i;
    const u = queue.splice(bi, 1)[0];
    for (const v of frags[u].nb) {
      const w = (len(sub(frags[u].c, frags[v].c)) / speed) * rng.range(0.85, 1.25);
      if (tc[u] + w < tc[v]) { tc[v] = tc[u] + w; queue.push(v); }
    }
  }
  const tmax = Math.max(...[...tc].filter(Number.isFinite));
  for (let i = 0; i < tc.length; i++) if (!Number.isFinite(tc[i])) tc[i] = tmax; // (îlots isolés)

  // ── Vitesses, rotations, effritement ──
  const center = [0, 0, 0];
  const topY = frags.reduce((m, F) => Math.max(m, F.c[1]), 0);
  // (la bille du pendule arrive à l'horizontale, au bas de sa course)
  const dirIn = norm([-M.n0[0] + rng.range(-0.12, 0.12), 0, -M.n0[2] + rng.range(-0.12, 0.12)]);
  const force = spec.force ?? 1;
  frags.forEach((F, i) => {
    const r = rng.fork(i);
    const jit = [r.gauss() * 0.12, r.gauss() * 0.12, r.gauss() * 0.12];
    let v;
    if (spec.mech === 'ball') {
      const d = sub(F.c, M.O), rho = len(d);
      const radial = norm(sub(d, mul(M.n0, dot(d, M.n0))));
      const k = 0.22 + 1.35 / (1 + (rho / (0.16 * S)) ** 1.3);
      v = mul(norm(add(add(mul(dirIn, 0.55 + k * 0.5), mul(radial, 0.55)), add(mul(F.n, 0.35), jit))), k * S * 0.95 * PHYS);
    } else if (spec.mech === 'resonance') {
      const out = norm([F.n[0], 0, F.n[2]]);
      v = mul(norm(add(add(out, [0, 0.12, 0]), jit)), S * (0.25 + 0.9 * Math.min(1, F.amax) ** 2) * PHYS);
    } else if (spec.mech === 'tempered') {
      // (la paroi se détend : les dés partent à l'horizontale, depuis l'axe de la
      // pièce à leur hauteur, un peu vers le haut ; dirigés depuis le pied, ceux
      // du col jaillissaient à la verticale, en geyser hors du cadre)
      const outw = norm([F.c[0] - center[0], 0, F.c[2] - center[2]]);
      v = mul(norm(add(add(outw, [0, 0.3, 0]), add(mul(F.n, 0.4), mul(jit, 2.2)))), S * r.range(0.35, 0.65) * PHYS);
    } else {
      // (choc thermique : les pièces se séparent à peine, puis la gravité les
      // couche. Lâchées à la verticale, celles du haut descendaient à travers
      // celles du bas : la pièce s'ouvre donc vers l'extérieur, d'autant plus
      // que l'éclat est haut, et le col retombe à côté de la panse)
      const outw = norm([F.c[0] + 1e-4, 0, F.c[2]]), hn = Math.min(1, Math.max(0, F.c[1] / (topY || 1)));
      v = add(mul(norm(add(F.n, mul(jit, 1.5))), S * r.range(0.02, 0.05) * PHYS), mul(outw, S * PHYS * (0.03 + 0.11 * hn * hn)));
    }
    v = mul(v, force);
    F.v = v;
    F.axis = r.dir();
    F.rad = 0;
    const sz = Math.sqrt(F.area) / S;
    F.w = PHYS * 2 * r.sign() * r.range(1.2, 3.2) * Math.min(3, Math.sqrt(0.25 / Math.max(0.02, sz))) * (spec.mech === 'thermal' ? 0.4 : 1);
    F.tc = tc[i];
    F.tm = Ts * PH.melt; // (l'instant de fonte dépend de l'endroit où l'éclat s'arrête : sim.js)
  });

  // ── Éclats secondaires (collés dans leur parent) ──
  // (pas pour la trempe : ses dés sont déjà à la taille finale)
  const sec = spec.mech === 'tempered' ? 0 : (spec.secondary ?? 1);
  const shards = [];
  labels.forEach((l, fi) => {
    const F = frags[fi], polys = regions.get(l);
    const n = sec ? Math.max(1, Math.min(6, Math.floor(F.area / (0.0225 * S * S)))) : 1;
    const groups = n > 1 ? splitSecondary(polys, n, rng.fork(`sec${fi}`)) : [polys];
    F.children = [];
    for (const g of groups) {
      const Sh = { parent: fi, polys: g, area: 0, c: [0, 0, 0], n: [0, 0, 0], v: F.v, w: F.w, axis: F.axis, tc: F.tc, tm: F.tm, rad: 0 };
      for (const { poly } of g) for (let k = 1; k < poly.length - 1; k++) {
        const ar = len(cross(sub(poly[k].p, poly[0].p), sub(poly[k + 1].p, poly[0].p))) / 2;
        Sh.area += ar; Sh.c = add(Sh.c, mul(mul(add(poly[0].p, add(poly[k].p, poly[k + 1].p)), 1 / 3), ar)); Sh.n = add(Sh.n, mul(poly[0].n, ar));
      }
      Sh.n = norm(Sh.n); Sh.c = sub(mul(Sh.c, 1 / Math.max(1e-12, Sh.area)), mul(Sh.n, h / 2));
      F.children.push(shards.length);
      shards.push(Sh);
    }
  });

  // ── Maillage ──
  const out = { position: [], normal: [], surf: [], rigA: [], rigB: [], rigC: [], rigD: [], index: [] };
  const OUT = [255, 0, 0], IN = [0, 255, 0], EDGE = [0, 0, 255];
  let fragVerts = null;
  const accNoise = (p) => 0.05 * M.noise.noise(p[0] * 3 / S + 5, p[1] * 3 / S, p[2] * 3 / S);
  const vert = (F, p, n, s, a, key) => {
    if (key && fragVerts.has(key)) return fragVerts.get(key);
    const i = out.position.length / 3;
    out.position.push(...p); out.normal.push(...norm(n)); out.surf.push(s[0], s[1], s[2], 0); // (w : 255 sur les lignes de fissure, voir plus bas)
    // rigA : centre de l'éclat au repos, instant de fissure ; rigB.x : indice de
    // l'éclat (sa ligne dans la texture de trajectoire) ; rigC.w : début de la
    // fonte (sim.js) ; rigD.x : paramètre de soufflage
    out.rigA.push(...F.c, F.tc); out.rigB.push(F.index, 0, 0, 0); out.rigC.push(0, 0, 0, F.tm);
    out.rigD.push(a > 1.5 ? a : Math.min(1, Math.max(0, a + accNoise(p))), 0, 0, 0);
    F.rad = Math.max(F.rad, len(sub(p, F.c)));
    if (key) fragVerts.set(key, i);
    return i;
  };
  const tri = (a, b, c, nsum) => {
    const pa = out.position.slice(a * 3, a * 3 + 3), pb = out.position.slice(b * 3, b * 3 + 3), pc = out.position.slice(c * 3, c * 3 + 3);
    if (dot(cross(sub(pb, pa), sub(pc, pa)), nsum) < 0) out.index.push(a, c, b); else out.index.push(a, b, c);
  };
  const q = (x) => Math.round(x * 1e6);
  const kp = (p, tag) => `${tag}${q(p[0])},${q(p[1])},${q(p[2])}`;
  const fragRanges = [];
  shards.forEach((F, si) => {
    F.index = si;
    fragVerts = new Map();
    const first = out.position.length / 3;
    for (const { poly, tags } of F.polys) {
      const o = poly.map((V) => vert(F, V.p, V.n, OUT, V.a, kp(V.p, 'o')));
      const inn = poly.map((V) => { const nn = norm(V.n); return vert(F, sub(V.p, mul(nn, h)), mul(nn, -1), IN, V.a, kp(V.p, 'i')); });
      const nAvg = poly.reduce((s, V) => add(s, V.n), [0, 0, 0]);
      for (let k = 1; k < poly.length - 1; k++) {
        tri(o[0], o[k], o[k + 1], nAvg);
        tri(inn[0], inn[k], inn[k + 1], mul(nAvg, -1));
      }
      // chants : fissures et bord
      const cpoly = mul(poly.reduce((s, V) => add(s, V.p), [0, 0, 0]), 1 / poly.length);
      // lignes de fissure : les sommets des parois externe et interne posés sur une
      // fissure (pas sur le bord de la pièce) ; le shader les allume au passage du front
      tags.forEach((m, k) => {
        if (m < 0) return;
        for (const i of [o[k], o[(k + 1) % poly.length], inn[k], inn[(k + 1) % poly.length]]) out.surf[4 * i + 3] = 255;
      });
      tags.forEach((m, k) => {
        if (m === -1) return;
        const A = poly[k], B = poly[(k + 1) % poly.length];
        const nn = norm(add(A.n, B.n));
        let w = norm(cross(sub(B.p, A.p), nn));
        if (dot(w, sub(mul(add(A.p, B.p), 0.5), cpoly)) < 0) w = mul(w, -1);
        if (!Number.isFinite(w[0]) || len(sub(B.p, A.p)) < 1e-9) return;
        const a0 = vert(F, A.p, w, EDGE, A.a), b0 = vert(F, B.p, w, EDGE, B.a);
        const b1 = vert(F, sub(B.p, mul(norm(B.n), h)), w, EDGE, B.a), a1 = vert(F, sub(A.p, mul(norm(A.n), h)), w, EDGE, A.a);
        tri(a0, b0, b1, w); tri(a0, b1, a1, w);
      });
    }
    fragRanges.push([first, out.position.length / 3]);
  });
  const nVert = out.position.length / 3;
  return {
    mesh: {
      position: Float32Array.from(out.position), normal: Float32Array.from(out.normal), surf: Uint8Array.from(out.surf),
      rigA: Float32Array.from(out.rigA), rigB: Float32Array.from(out.rigB), rigC: Float32Array.from(out.rigC), rigD: Float32Array.from(out.rigD),
      index: nVert < 65536 ? Uint16Array.from(out.index) : Uint32Array.from(out.index),
    },
    // frags : les éclats dessinés (sous-éclats compris), chacun avec son parent ;
    // bodies : les éclats primaires, corps de la simulation tant qu'ils ne se
    // brisent pas
    frags: shards.map((F, i) => ({ c: F.c, v: F.v, axis: F.axis, w: F.w, tc: F.tc, tm: F.tm, n: F.n, rad: F.rad, area: F.area, range: fragRanges[i], parent: F.parent })),
    bodies: frags.map((F) => ({ c: F.c, v: F.v, axis: F.axis, w: F.w, tc: F.tc, area: F.area, children: F.children })),
    origin: M.O, normal: M.n0, dir: dirIn, size: S, thickness: h,
    tFront: [t0, Math.max(...frags.map((F, i) => tc[i]))],
  };
}
