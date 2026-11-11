// Invariants du cœur : forme d'équilibre, dynamique, boucle, contacts, caméra.
// node --test 'tension/test/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import { prism, chain, hoop, prismTwist } from '../src/gen/topology.js';
import { formFind } from '../src/gen/sim.js';
import { prepare, prismPerms } from '../src/gen/gait.js';
import { makeFilm } from '../src/gen/film.js';
import { makeShot, cameraAt } from '../src/scene/shot.js';
import { sagOf, arcLength } from '../src/gen/cable.js';
import { generate } from '../src/recipe.js';

// une simulation par famille, partagée par les tests
const SPECS = { culbute: { family: 'culbute', n: 6 }, chenille: { family: 'chenille', m: 4 }, cerceau: { family: 'cerceau', m: 12 } };
const cache = {};
const sim = (f) => (cache[f] ??= (() => { const P = prepare(SPECS[f]); const F = makeFilm(P); return { P, F }; })());

const segDist = (p1, q1, p2, q2) => {
  // distance minimale entre deux segments (Ericson, Real-Time Collision Detection)
  const d1 = [0, 1, 2].map((a) => q1[a] - p1[a]), d2 = [0, 1, 2].map((a) => q2[a] - p2[a]), r = [0, 1, 2].map((a) => p1[a] - p2[a]);
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
  let s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
  return Math.hypot(...[0, 1, 2].map((k) => p1[k] + d1[k] * s - (p2[k] + d2[k] * t)));
};
const at = (Q, i) => [Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]];

test('recherche de forme : un prisme régulier se tord de π/2 − π/n', () => {
  for (const n of [3, 4, 5, 6]) {
    // (départ volontairement faux : torsion de +20°)
    const T0 = prism({ n });
    const k = 20 * Math.PI / 180;
    T0.nodes.forEach((nd) => { if (nd.ring === 1) { const [x, y, z] = nd.p; nd.p = [x * Math.cos(k) - y * Math.sin(k), x * Math.sin(k) + y * Math.cos(k), z]; } });
    const T = formFind(T0, { time: 6 });
    const P = T.nodes.map((nd) => nd.p), ang = (p) => Math.atan2(p[1], p[0]);
    let tw = ang(P[n + n - 1]) - ang(P[0]);
    tw = ((tw % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    assert.ok(Math.abs(tw - prismTwist(n)) < 0.15 * Math.PI / 180, `n=${n} : ${(tw * 180 / Math.PI).toFixed(3)}°`);
  }
});

test('câble mou : la parabole a exactement la longueur au repos', () => {
  for (const [d, L] of [[1, 1.001], [1, 1.05], [2.3, 2.9], [0.5, 1.2]]) assert.ok(Math.abs(arcLength(d, sagOf(d, L)) - L) < 1e-9);
  assert.equal(sagOf(1, 0.9), 0);
});

test('symétries du prisme : chaque permutation conserve barres et câbles', () => {
  const T = prism({ n: 6 });
  for (const p of prismPerms(6)) {
    for (const c of T.cables) assert.ok(T.cables.some((q) => (q.i === p[c.i] && q.j === p[c.j]) || (q.i === p[c.j] && q.j === p[c.i])));
    for (const c of T.bars) assert.ok(T.bars.some((q) => (q.i === p[c.i] && q.j === p[c.j]) || (q.i === p[c.j] && q.j === p[c.i])));
  }
});

for (const fam of Object.keys(SPECS)) {
  test(`${fam} : le pas avance, le cycle limite est atteint`, () => {
    const { P, F } = sim(fam);
    assert.ok(F.dist > 1.5, `pas trop court : ${F.dist}`);
    assert.ok(P.residual < 2e-3, `point fixe non atteint : ${P.residual}`);
    assert.ok(F.seamErr < 0.06, `écart de raccord : ${F.seamErr}`);
  });

  test(`${fam} : raccord exact (la fin est le début déplacé par le pas)`, () => {
    const { F } = sim(fam);
    const a = F.pose(0), b = F.pose(1 - 1e-9);
    const g = (x, z) => {
      if (F.arc) { const c = Math.cos(F.theta), s = Math.sin(F.theta), X = x - F.C[0], Z = z - F.C[1]; return [c * X - s * Z + F.C[0], s * X + c * Z + F.C[1]]; }
      return [x + F.dist, z];
    };
    let err = 0;
    for (let i = 0; i < F.N; i++) {
      const [x, z] = g(a[i * 3], a[i * 3 + 2]);
      let best = Infinity;
      for (let j = 0; j < F.N; j++) best = Math.min(best, Math.hypot(x - b[j * 3], a[i * 3 + 1] - b[j * 3 + 1], z - b[j * 3 + 2]));
      err = Math.max(err, best);
    }
    assert.ok(err < 1e-4, `raccord : ${err}`);
  });

  test(`${fam} : barres rigides, rien sous le sol, aucune barre n'en traverse une autre`, () => {
    const { F } = sim(fam);
    const T = F.T, Q = new Float32Array(F.N * 3);
    let lenErr = 0, under = 0, clash = Infinity;
    for (let k = 0; k <= 400; k++) {
      F.pose(k / 400, Q);
      for (const b of T.bars) lenErr = Math.max(lenErr, Math.abs(Math.hypot(...[0, 1, 2].map((a) => Q[b.i * 3 + a] - Q[b.j * 3 + a])) - b.L) / b.L);
      // embouts : leur sphère ne descend pas sous le sol ; corps des barres : au-dessus de leur rayon
      T.nodes.forEach((nd, i) => { under = Math.max(under, nd.r - Q[i * 3 + 1]); });
      for (const b of T.bars) for (let t = 0.1; t < 0.95; t += 0.1) {
        const y = Q[b.i * 3 + 1] * (1 - t) + Q[b.j * 3 + 1] * t;
        under = Math.max(under, b.r - y);
      }
      for (let p = 0; p < T.bars.length; p++) for (let q = p + 1; q < T.bars.length; q++) {
        const A = T.bars[p], B = T.bars[q];
        if (A.i === B.i || A.i === B.j || A.j === B.i || A.j === B.j) continue; // (rotule commune)
        const d = segDist(at(Q, A.i), at(Q, A.j), at(Q, B.i), at(Q, B.j)) - A.r - B.r;
        clash = Math.min(clash, d);
      }
    }
    assert.ok(lenErr < 2e-3, `longueur des barres : ${lenErr}`);
    assert.ok(under < 2e-3, `sous le sol : ${under}`);
    assert.ok(clash > 0, `barres qui se touchent : ${clash}`);
  });

  test(`${fam} : la caméra glisse (vitesse angulaire et accélération bornées à 120 i/s)`, () => {
    const { F } = sim(fam);
    const R = generate('cam', { family: fam });
    const S = makeShot(F);
    const dt = 1 / 120, n = Math.round(F.dur / dt);
    const dir = (u) => { const c = cameraAt(S, F, R.camera, u, 16 / 9); const v = c.tgt.map((x, a) => x - c.pos[a]); const l = Math.hypot(...v); return v.map((x) => x / l); };
    const pos = (u) => cameraAt(S, F, R.camera, u, 16 / 9).pos;
    let wMax = 0, aMax = 0, vPrev = null;
    for (let k = 0; k < n - 1; k++) { // (le raccord n'est pas un mouvement : la scène entière se déplace du pas)
      const u0 = k / n, u1 = (k + 1) / n;
      const d0 = dir(u0), d1 = dir(u1);
      const w = Math.acos(Math.min(1, d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2])) / dt;
      wMax = Math.max(wMax, w);
      const p0 = pos(u0), p1 = pos(u1), v = p1.map((x, a) => (x - p0[a]) / dt);
      if (vPrev) aMax = Math.max(aMax, Math.hypot(...v.map((x, a) => (x - vPrev[a]) / dt)));
      vPrev = v;
    }
    assert.ok(wMax * 180 / Math.PI < 25, `pointe : ${(wMax * 180 / Math.PI).toFixed(1)}°/s`);
    assert.ok(aMax < 40, `accélération : ${aMax.toFixed(1)} u/s²`);
  });
}

test('Culbute : les culbutes sont des chutes (le centre descend puis remonte à chaque basculement)', () => {
  const { F } = sim('culbute');
  assert.ok(F.ks.length >= 6, 'au moins six basculements par boucle');
});
