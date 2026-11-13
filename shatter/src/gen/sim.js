// Simulation des éclats, précalculée dans le worker juste après la fracture.
//
// Jusqu'ici chaque éclat suivait une formule fermée (parabole, choc, rebond,
// glissement, pose stable) sans rien savoir des autres : ils se traversaient,
// et le col d'une pièce coupée au chalumeau descendait à travers la panse. Ici
// les éclats sont des corps rigides qui se heurtent :
//
// - forme de collision : un nuage de sphères posé sur la paroi de chaque éclat
//   (rayon ≈ épaisseur, espacement de Poisson) ; les éclats fins et courbes se
//   posent les uns sur les autres sans enveloppe convexe gonflée ;
// - sole : la cuvette exacte (cycle.js, floorH, floorN) ;
// - un éclat encore attaché à la pièce (avant le passage du front de fissure)
//   est un obstacle fixe ; la bille du pendule est un obstacle mobile (sa vraie
//   trajectoire, kinematics.js) ;
// - deux éclats qui se touchent au repos (le long d'une fissure) s'ignorent
//   jusqu'à ce qu'ils se soient séparés une fois ;
// - impulsions séquentielles (Coulomb, restitution), pas de 1/480 s, mise en
//   sommeil des éclats immobiles (ni tremblement ni dérive au repos) ;
// - éclats secondaires : un éclat primaire pré-découpé (fracture.js) se brise
//   en ses morceaux quand il heurte assez fort la sole ou un autre éclat ; les
//   morceaux héritent de sa vitesse au point où ils sont, plus une petite
//   détente.
//
// Sortie : pour chaque éclat dessiné, sa pose (centre, quaternion) échantillonnée
// à RATE Hz de temps physique depuis le choc. Le vertex shader la lit dans une
// texture (scene/glass.js) ; les mêmes formules sont en JS ci-dessous
// (sampleTrack) pour les tests. Tout dépend de la seule recette : la boucle
// reste parfaite.
import { createRng } from '../rng.js';
import { PH, GRAV, MU, BOUNCE, floorH, floorN, physTime } from '../cycle.js';
import { pendulum, PENDULUM } from '../kinematics.js';

export const RATE = 240;          // échantillons par seconde de temps physique
const SUB = 2;                    // pas de simulation par échantillon (480 Hz)
const DT = 1 / (RATE * SUB);
const ITER = 8;                   // itérations du solveur par pas

// ── petites opérations ──
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qnorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
// rotation d'un vecteur par un quaternion unitaire
export const qrot = (q, v) => {
  const u = [q[0], q[1], q[2]], t = cross(u, v).map((x) => 2 * x), s = cross(u, t);
  return [v[0] + q[3] * t[0] + s[0], v[1] + q[3] * t[1] + s[1], v[2] + q[3] * t[2] + s[2]];
};
const mat = (q) => { // matrice de rotation (lignes)
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
};
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mtv = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C || 1e-12;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

// ── Nuage de sphères de chaque éclat ─────────────────────────────────────────
// échantillonnage de Poisson (fléchettes) sur la paroi externe, puis recul
// d'une demi-épaisseur : les sphères sont au milieu du verre
function sampleSpheres(res, r, sp, rng) {
  const { position: P, normal: Nm, surf, index: I } = res.mesh, h = res.thickness;
  const nS = res.frags.length, byShard = Array.from({ length: nS }, () => []);
  const shardOf = new Int32Array(P.length / 3).fill(-1);
  res.frags.forEach((F, s) => { for (let i = F.range[0]; i < F.range[1]; i++) shardOf[i] = s; });
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (surf[4 * a] < 200 || surf[4 * b] < 200 || surf[4 * c] < 200) continue; // (paroi externe seulement)
    const s = shardOf[a];
    if (s >= 0) byShard[s].push(a, b, c);
  }
  const pos = [], owner = [];
  const v3 = (A, i) => [A[3 * i], A[3 * i + 1], A[3 * i + 2]];
  for (let s = 0; s < nS; s++) {
    const T = byShard[s], cum = [];
    let tot = 0;
    for (let k = 0; k < T.length; k += 3) {
      const A = v3(P, T[k]), B = v3(P, T[k + 1]), C = v3(P, T[k + 2]);
      tot += Math.hypot(...cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]])) / 2;
      cum.push(tot);
    }
    const acc = [];
    const want = Math.max(1, Math.ceil((tot / (sp * sp)) * 1.2)), tries = want * 8;
    for (let k = 0; k < tries && T.length; k++) {
      const x = rng.next() * tot;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; }
      let u = rng.next(), v = rng.next();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const ia = T[3 * lo], ib = T[3 * lo + 1], ic = T[3 * lo + 2], w = 1 - u - v;
      const p = [0, 1, 2].map((j) => P[3 * ia + j] * w + P[3 * ib + j] * u + P[3 * ic + j] * v);
      const n = [0, 1, 2].map((j) => Nm[3 * ia + j] * w + Nm[3 * ib + j] * u + Nm[3 * ic + j] * v);
      const ln = Math.hypot(...n) || 1;
      const q = [p[0] - (n[0] / ln) * h * 0.5, p[1] - (n[1] / ln) * h * 0.5, p[2] - (n[2] / ln) * h * 0.5];
      if (acc.some((o) => (o[0] - q[0]) ** 2 + (o[1] - q[1]) ** 2 + (o[2] - q[2]) ** 2 < sp * sp)) continue;
      acc.push(q);
    }
    if (!acc.length) acc.push(res.frags[s].c.slice());
    for (const q of acc) { pos.push(...q); owner.push(s); }
  }
  return { pos: Float64Array.from(pos), owner: Int32Array.from(owner) };
}

// ── Grille de hachage (tri par comptage) ──
function createHash(cell, size = 1 << 16) {
  const start = new Int32Array(size + 1), ids = [], key = (x, y, z) => ((Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663) ^ (Math.floor(z / cell) * 83492791)) & (size - 1);
  let order = new Int32Array(0);
  return {
    key,
    build(W, n) {
      start.fill(0);
      const ks = new Int32Array(n);
      for (let i = 0; i < n; i++) { ks[i] = key(W[3 * i], W[3 * i + 1], W[3 * i + 2]); start[ks[i] + 1]++; }
      for (let k = 0; k < size; k++) start[k + 1] += start[k];
      if (order.length < n) order = new Int32Array(n);
      const fill = start.slice(0, size);
      for (let i = 0; i < n; i++) order[fill[ks[i]]++] = i;
      ids.length = 0;
    },
    // appelle f(j) pour chaque sphère des 27 cellules voisines de (x, y, z)
    near(x, y, z, f) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const k = (((cx + dx) * 73856093) ^ ((cy + dy) * 19349663) ^ ((cz + dz) * 83492791)) & (size - 1);
        for (let t = start[k]; t < start[k + 1]; t++) f(order[t]);
      }
    },
  };
}

// res : sortie de fracture() ; spec : { seed, Ts, slow, mech }
export function simulate(res, spec) {
  const rng = createRng(`${spec.seed}:sim`);
  const S = res.size, h = res.thickness, Ts = spec.Ts ?? 12;
  const slow = spec.slow ?? { k: 16, pre: -0.09, plat: 2, post: 1 };
  const t0 = PH.rupture * Ts, p0 = physTime(t0, Ts, slow);
  const tauMax = physTime(Ts, Ts, slow) - p0;
  const nSamples = Math.floor(tauMax * RATE) + 1;
  const r = 0.0145 * S, sp = 1.3 * r, rf = h * 0.5 + 0.001; // (rayon de contact entre éclats, espacement, rayon sur la sole)

  // sphères
  const SPH = sampleSpheres(res, r, sp, rng.fork('spheres'));
  const nSph = SPH.owner.length, rest = SPH.pos, W = Float64Array.from(rest);
  const nShard = res.frags.length;
  const shardSph = Array.from({ length: nShard }, () => []);
  for (let i = 0; i < nSph; i++) shardSph[SPH.owner[i]].push(i);

  // palpeurs : les sommets extrêmes de chaque éclat (74 directions), qui ne
  // touchent que la sole — les sphères, au milieu de la paroi, laissaient les
  // angles des chants passer quelques millimètres dessous
  const DIRS = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (a || b || c) DIRS.push([a, b, c]);
  for (let i = 0; i < 48; i++) { const y = 1 - (2 * (i + 0.5)) / 48, rr = Math.sqrt(1 - y * y), t = i * 2.399963; DIRS.push([rr * Math.cos(t), y, rr * Math.sin(t)]); }
  const shardProbe = res.frags.map((F) => {
    const P = res.mesh.position, best = DIRS.map(() => [-Infinity, -1]);
    for (let i = F.range[0]; i < F.range[1]; i++) DIRS.forEach((d, k) => { const v = P[3 * i] * d[0] + P[3 * i + 1] * d[1] + P[3 * i + 2] * d[2]; if (v > best[k][0]) best[k] = [v, i]; });
    return [...new Set(best.map((b) => b[1]).filter((i) => i >= 0))].map((i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
  });

  // corps : un par éclat primaire
  const bodies = [];
  const shardBody = new Int32Array(nShard);
  const makeBody = (shards, tRel, v, w) => {
    const sph = shards.flatMap((s) => shardSph[s]);
    const C0 = [0, 0, 0];
    for (const i of sph) for (let j = 0; j < 3; j++) C0[j] += rest[3 * i + j] / sph.length;
    const I = [0, 0, 0, 0, 0, 0, 0, 0, 0], e = sp * sp / 6;
    for (const i of sph) {
      const d = [rest[3 * i] - C0[0], rest[3 * i + 1] - C0[1], rest[3 * i + 2] - C0[2]], dd = dot(d, d) + e;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) I[3 * a + b] += (a === b ? dd : 0) - d[a] * d[b];
    }
    const B = { id: bodies.length, shards, sph, C0, x: C0.slice(), q: [0, 0, 0, 1], v, w, m: sph.length, invM: 1 / sph.length, Iinv0: inv3(I), state: 'static', tRel, still: 0, broken: shards.length < 2, R: mat([0, 0, 0, 1]), Iw: null, touch: false };
    B.Iw = B.Iinv0;
    for (const s of shards) shardBody[s] = B.id;
    bodies.push(B);
    return B;
  };
  for (const Fb of res.bodies) {
    const v = Fb.v.slice(), w = Fb.axis.map((a) => a * Fb.w);
    const B = makeBody(Fb.children, Math.max(0, physTime(Fb.tc, Ts, slow) - p0), v, w);
    // seuil de rupture secondaire (u/s de vitesse d'approche) : plus bas pour un
    // grand éclat (il fléchit davantage)
    B.breakV = 7.5 * rng.range(0.85, 1.4) * Math.min(1.5, Math.max(0.55, Math.sqrt((0.06 * S * S) / Math.max(1e-4, Fb.area))));
  }
  const sphBody = new Int32Array(nSph);
  const syncOwners = () => { for (let i = 0; i < nSph; i++) sphBody[i] = shardBody[SPH.owner[i]]; };
  syncOwners();

  // paires d'éclats qui se touchent au repos : ignorées tant qu'elles ne se
  // sont pas séparées une fois
  const pairKey = (a, b) => (a < b ? a * 8192 + b : b * 8192 + a);
  const ignore = new Set();
  const hash = createHash(2 * r);
  hash.build(W, nSph);
  for (let i = 0; i < nSph; i++) {
    const si = SPH.owner[i];
    hash.near(W[3 * i], W[3 * i + 1], W[3 * i + 2], (j) => {
      const sj = SPH.owner[j];
      if (sj === si) return;
      const d2 = (W[3 * i] - W[3 * j]) ** 2 + (W[3 * i + 1] - W[3 * j + 1]) ** 2 + (W[3 * i + 2] - W[3 * j + 2]) ** 2;
      if (d2 < (2 * r + 0.004) ** 2) ignore.add(pairKey(si, sj));
    });
  }

  // bille du pendule (repère de la pièce)
  let bob = null;
  if (spec.mech === 'ball' && res.origin) {
    const nh = [res.normal[0], 0, res.normal[2]], ln = Math.hypot(nh[0], nh[2]) || 1;
    bob = { O: res.origin, nh: [nh[0] / ln, 0, nh[2] / ln], c: [0, 0, 0], v: [0, 0, 0], r: PENDULUM.rb };
  }
  const bobAt = (tau) => pendulum(bob.O, bob.nh, tau, t0, Ts).center;

  const updateWorld = (B) => {
    B.R = mat(B.q);
    const Rm = B.R;
    // (inertie inverse dans le monde : R I⁻¹ Rᵀ)
    const M = B.Iinv0, T = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { let s = 0; for (let k = 0; k < 3; k++) for (let l = 0; l < 3; l++) s += Rm[3 * a + k] * M[3 * k + l] * Rm[3 * b + l]; T[3 * a + b] = s; }
    B.Iw = T;
    for (const i of B.sph) {
      const d = [rest[3 * i] - B.C0[0], rest[3 * i + 1] - B.C0[1], rest[3 * i + 2] - B.C0[2]], p = mv(Rm, d);
      W[3 * i] = p[0] + B.x[0]; W[3 * i + 1] = p[1] + B.x[1]; W[3 * i + 2] = p[2] + B.x[2];
    }
  };
  const velAt = (B, rr) => (B && B.state === 'awake' ? [B.v[0] + B.w[1] * rr[2] - B.w[2] * rr[1], B.v[1] + B.w[2] * rr[0] - B.w[0] * rr[2], B.v[2] + B.w[0] * rr[1] - B.w[1] * rr[0]] : [0, 0, 0]);
  const dyn = (B) => B && B.state === 'awake';
  const applyImp = (B, rr, J) => {
    if (!dyn(B)) return;
    B.v[0] += J[0] * B.invM; B.v[1] += J[1] * B.invM; B.v[2] += J[2] * B.invM;
    const dw = mv(B.Iw, cross(rr, J));
    B.w[0] += dw[0]; B.w[1] += dw[1]; B.w[2] += dw[2];
  };
  const kEff = (B, rr, n) => (dyn(B) ? B.invM + dot(cross(mv(B.Iw, cross(rr, n)), rr), n) : 0);

  // éclat secondaire : le corps se brise en ses morceaux
  const breakBody = (B) => {
    B.state = 'gone';
    const kids = [];
    for (const s of B.shards) {
      const K = makeBody([s], 0, [0, 0, 0], [0, 0, 0]);
      const d = mv(B.R, [K.C0[0] - B.C0[0], K.C0[1] - B.C0[1], K.C0[2] - B.C0[2]]);
      K.x = [B.x[0] + d[0], B.x[1] + d[1], B.x[2] + d[2]]; K.q = B.q.slice();
      const vp = velAt(B, d), ld = Math.hypot(...d) || 1, kick = rng.range(0.35, 1.0);
      K.v = [vp[0] + (d[0] / ld) * kick, vp[1] + (d[1] / ld) * kick * 0.5 + 0.2, vp[2] + (d[2] / ld) * kick];
      K.w = [B.w[0] + rng.gauss() * 3, B.w[1] + rng.gauss() * 3, B.w[2] + rng.gauss() * 3];
      K.state = 'awake';
      updateWorld(K);
      kids.push(K);
    }
    syncOwners();
    return kids;
  };

  // ── Boucle ──
  const track = new Float32Array(nShard * nSamples * 8);
  const shardC = res.frags.map((F) => F.c);
  const record = (k) => {
    for (let s = 0; s < nShard; s++) {
      const B = bodies[shardBody[s]], c = shardC[s];
      const d = mv(B.R, [c[0] - B.C0[0], c[1] - B.C0[1], c[2] - B.C0[2]]);
      const o = (s * nSamples + k) * 8;
      track[o] = B.x[0] + d[0]; track[o + 1] = B.x[1] + d[1]; track[o + 2] = B.x[2] + d[2];
      track[o + 4] = B.q[0]; track[o + 5] = B.q[1]; track[o + 6] = B.q[2]; track[o + 7] = B.q[3];
    }
  };
  const contacts = [];
  let tau = 0, stats = { steps: 0, contacts: 0, breaks: 0, maxContacts: 0, endDepth: 0 };
  record(0);
  for (let k = 1; k < nSamples; k++) {
    for (let sub = 0; sub < SUB; sub++) {
      tau += DT;
      stats.steps++;
      // libération au passage du front de fissure
      for (const B of bodies) if (B.state === 'static' && tau >= B.tRel) { B.state = 'awake'; B.still = 0; }
      const awake = bodies.filter((B) => B.state === 'awake');
      if (!awake.length && bodies.every((B) => B.state !== 'static')) continue;
      for (const B of awake) { B.v[1] -= GRAV * DT; B.touch = false; }
      if (bob) {
        const c = bobAt(tau), c1 = bobAt(tau + 1e-4);
        bob.v = [(c1[0] - c[0]) / 1e-4, (c1[1] - c[1]) / 1e-4, (c1[2] - c[2]) / 1e-4]; bob.c = c;
      }
      // contacts
      contacts.length = 0;
      hash.build(W, nSph);
      const seen = new Set();
      for (const B of awake) for (const s of B.shards) for (const pr of shardProbe[s]) {
        const d = mv(B.R, [pr[0] - B.C0[0], pr[1] - B.C0[1], pr[2] - B.C0[2]]), x = d[0] + B.x[0], y = d[1] + B.x[1], z = d[2] + B.x[2];
        const fh = floorH(Math.hypot(x, z));
        if (y < fh + 0.001) { const n = floorN(x, z); contacts.push({ a: B, b: null, p: [x, y, z], n, depth: (fh - y) * n[1], mu: MU, e: BOUNCE }); }
      }
      for (const B of awake) for (const i of B.sph) {
        const x = W[3 * i], y = W[3 * i + 1], z = W[3 * i + 2];
        // sole
        const fh = floorH(Math.hypot(x, z)), n = floorN(x, z), dist = (y - fh) * n[1];
        if (dist < rf) contacts.push({ a: B, b: null, p: [x - n[0] * dist, y - n[1] * dist, z - n[2] * dist], n, depth: rf - dist, mu: MU, e: BOUNCE });
        // bille
        if (bob) {
          const d = [x - bob.c[0], y - bob.c[1], z - bob.c[2]], l = Math.hypot(...d);
          if (l < bob.r + r && l > 1e-9) contacts.push({ a: B, b: null, kin: bob.v, p: [x, y, z], n: d.map((u) => u / l), depth: bob.r + r - l, mu: 0.2, e: 0.3 });
        }
        // autres éclats
        hash.near(x, y, z, (j) => {
          const Bj = bodies[sphBody[j]];
          if (Bj === B || (Bj.state === 'awake' && Bj.id < B.id)) return;
          const dx = x - W[3 * j], dy = y - W[3 * j + 1], dz = z - W[3 * j + 2], d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= 4 * r * r || d2 < 1e-14) return;
          const pk = pairKey(SPH.owner[i], SPH.owner[j]);
          if (ignore.has(pk)) { seen.add(pk); return; }
          const l = Math.sqrt(d2);
          contacts.push({ a: B, b: Bj, p: [(x + W[3 * j]) / 2, (y + W[3 * j + 1]) / 2, (z + W[3 * j + 2]) / 2], n: [dx / l, dy / l, dz / l], depth: 2 * r - l, mu: 0.4, e: 0.1 });
          if (tau > tauMax - 0.2) stats.endDepth = Math.max(stats.endDepth, 2 * r - l);
        });
      }
      // (une paire ignorée qui ne se touche plus redevient solide)
      for (const pk of ignore) if (!seen.has(pk)) {
        const sa = Math.floor(pk / 8192), sb = pk % 8192;
        if (dyn(bodies[shardBody[sa]]) || dyn(bodies[shardBody[sb]])) ignore.delete(pk);
      }
      // préparation : bras de levier, masses effectives, vitesse d'approche ;
      // ruptures secondaires et réveils
      const toBreak = new Set();
      for (const c of contacts) {
        c.ra = [c.p[0] - c.a.x[0], c.p[1] - c.a.x[1], c.p[2] - c.a.x[2]];
        c.rb = c.b ? [c.p[0] - c.b.x[0], c.p[1] - c.b.x[1], c.p[2] - c.b.x[2]] : null;
        const va = velAt(c.a, c.ra), vb = c.b ? velAt(c.b, c.rb) : (c.kin ?? [0, 0, 0]);
        const rel = [va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]], vn = dot(rel, c.n);
        if (c.b && c.b.state === 'asleep' && vn < -0.4) { c.b.state = 'awake'; c.b.still = 0; }
        if (-vn > c.a.breakV && !c.a.broken) toBreak.add(c.a);
        if (c.b && dyn(c.b) && -vn > c.b.breakV && !c.b.broken) toBreak.add(c.b);
        c.kn = 1 / Math.max(1e-9, kEff(c.a, c.ra, c.n) + (c.b ? kEff(c.b, c.rb, c.n) : 0));
        const t1 = Math.abs(c.n[0]) < 0.9 ? cross(c.n, [1, 0, 0]) : cross(c.n, [0, 1, 0]), l1 = Math.hypot(...t1);
        c.t1 = t1.map((u) => u / l1); c.t2 = cross(c.n, c.t1);
        c.k1 = 1 / Math.max(1e-9, kEff(c.a, c.ra, c.t1) + (c.b ? kEff(c.b, c.rb, c.t1) : 0));
        c.k2 = 1 / Math.max(1e-9, kEff(c.a, c.ra, c.t2) + (c.b ? kEff(c.b, c.rb, c.t2) : 0));
        c.target = Math.max(vn < -0.8 ? -c.e * vn : 0, Math.min(2, Math.max(0, c.depth - 0.0015) * 0.25 / DT));
        c.jn = 0; c.j1 = 0; c.j2 = 0;
        c.a.touch = true; if (c.b) c.b.touch = true;
      }
      if (toBreak.size) {
        for (const B of toBreak) { B.broken = true; if (B.shards.length > 1) { breakBody(B); stats.breaks++; } }
        // (les contacts du corps brisé sont abandonnés ce pas-ci)
        for (let i = contacts.length - 1; i >= 0; i--) if (contacts[i].a.state === 'gone' || contacts[i].b?.state === 'gone') contacts.splice(i, 1);
      }
      stats.contacts += contacts.length; stats.maxContacts = Math.max(stats.maxContacts, contacts.length);
      // impulsions séquentielles
      for (let it = 0; it < ITER; it++) for (const c of contacts) {
        const va = velAt(c.a, c.ra), vb = c.b ? velAt(c.b, c.rb) : (c.kin ?? [0, 0, 0]);
        const rel = [va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]];
        const vn = dot(rel, c.n);
        let dj = c.kn * (c.target - vn);
        const jn = Math.max(0, c.jn + dj); dj = jn - c.jn; c.jn = jn;
        let J = c.n.map((u) => u * dj);
        // frottement (Coulomb)
        const lim = c.mu * c.jn;
        const d1 = -c.k1 * dot(rel, c.t1), j1 = Math.max(-lim, Math.min(lim, c.j1 + d1)), e1 = j1 - c.j1; c.j1 = j1;
        const d2 = -c.k2 * dot(rel, c.t2), j2 = Math.max(-lim, Math.min(lim, c.j2 + d2)), e2 = j2 - c.j2; c.j2 = j2;
        J = [J[0] + c.t1[0] * e1 + c.t2[0] * e2, J[1] + c.t1[1] * e1 + c.t2[1] * e2, J[2] + c.t1[2] * e1 + c.t2[2] * e2];
        applyImp(c.a, c.ra, J);
        if (c.b) applyImp(c.b, c.rb, J.map((u) => -u));
      }
      // intégration, amortissement au contact, sommeil
      for (const B of bodies) {
        if (B.state !== 'awake') continue;
        if (B.touch) { const kv = 1 - 1.2 * DT, kw = 1 - 5 * DT; for (let j = 0; j < 3; j++) { B.v[j] *= kv; B.w[j] *= kw; } }
        for (let j = 0; j < 3; j++) B.x[j] += B.v[j] * DT;
        const dq = qmul([B.w[0], B.w[1], B.w[2], 0], B.q);
        B.q = qnorm([B.q[0] + 0.5 * DT * dq[0], B.q[1] + 0.5 * DT * dq[1], B.q[2] + 0.5 * DT * dq[2], B.q[3] + 0.5 * DT * dq[3]]);
        updateWorld(B);
        // projection : un corps qui tourne vite peut enfoncer un angle dans la sole
        // entre deux pas ; il est remonté aussitôt de ce qui dépasse (ses palpeurs)
        let pen = 0;
        for (const s of B.shards) for (const pr of shardProbe[s]) {
          const d = mv(B.R, [pr[0] - B.C0[0], pr[1] - B.C0[1], pr[2] - B.C0[2]]), x = d[0] + B.x[0], z = d[2] + B.x[2];
          pen = Math.max(pen, floorH(Math.hypot(x, z)) - (d[1] + B.x[1]));
        }
        if (pen > 0.002) { B.x[1] += pen - 0.001; updateWorld(B); }
        const still = B.touch && Math.hypot(...B.v) < 0.15 && Math.hypot(...B.w) < 1.5;
        B.still = still ? B.still + DT : 0;
        if (B.still > 0.15) { B.state = 'asleep'; B.v = [0, 0, 0]; B.w = [0, 0, 0]; }
      }
    }
    record(k);
  }

  // fonte : la sole chauffe ; les éclats arrêtés près du centre fondent d'abord
  const tm = new Float32Array(nShard);
  const rj = rng.fork('fonte');
  for (let s = 0; s < nShard; s++) {
    const o = (s * nSamples + nSamples - 1) * 8;
    tm[s] = Ts * (PH.melt + PH.meltSpan * Math.min(1, Math.hypot(track[o], track[o + 2]) / 3) + 0.01 * rj.next());
  }
  stats.awakeAtEnd = bodies.filter((B) => B.state === 'awake').length;
  stats.bodies = bodies.filter((B) => B.state !== 'gone').length;
  stats.spheres = nSph;
  return { track, samples: nSamples, rate: RATE, tm, stats, radius: r };
}

// pose d'un éclat au temps physique tau (depuis le choc) : centre, quaternion
// (mêmes formules que le vertex shader : interpolation linéaire, quaternion
// normalisé, signe aligné)
export function sampleTrack(sim, s, tau) {
  const f = Math.min(sim.samples - 1, Math.max(0, tau * sim.rate)), i0 = Math.floor(f), i1 = Math.min(sim.samples - 1, i0 + 1), u = f - i0;
  const A = (s * sim.samples + i0) * 8, B = (s * sim.samples + i1) * 8, T = sim.track;
  const x = [0, 1, 2].map((j) => T[A + j] * (1 - u) + T[B + j] * u);
  const sg = T[A + 4] * T[B + 4] + T[A + 5] * T[B + 5] + T[A + 6] * T[B + 6] + T[A + 7] * T[B + 7] < 0 ? -1 : 1;
  const q = qnorm([4, 5, 6, 7].map((j) => T[A + j] * (1 - u) + sg * T[B + j] * u));
  return { x, q };
}
