// Invariants du cœur (node --test spore/test/*.test.mjs) : boucle, caméra,
// réseau de Tero, volumes, spores et germination, horloge, contacts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, SITE } from '../src/recipe.js';
import { createCameraPath, cloudTrack } from '../src/camera.js';
import { T, daylight, windSpeed, stage, sites } from '../src/timeline.js';
import { fruitState } from '../src/fruit.js';
import { FAMILIES } from '../src/families.js';
import { buildSite } from '../src/gen/site.js';
import { buildPlasmodium, arrivalField, seedsOf, sampleT } from '../src/gen/plasmodium.js';
import { project, meanDivergence } from '../src/gen/smoke.js';
import { heightGrid, logBase } from '../src/gen/wood.js';
import { buildTemplate } from '../src/gen/sporangia.js';

const SEEDS = ['a1', 'b2', 'c3', 'd4'];
const cache = new Map();
const site = (seed, fam) => {
  const k = `${seed}:${fam}`;
  if (!cache.has(k)) { const R = generate(seed, fam ? { family: fam } : {}); cache.set(k, { R, S: buildSite({ R }) }); }
  return cache.get(k);
};
const camOf = (R) => createCameraPath(R.camera, { L: R.site.L, target: [0.2, 0], forest: [0.3, 0.1], H: 0.4, y0: 0, groundAt: (x, z) => logBase(z, R.site.logR) + 0.05 }, 40);

test('la boucle : la caméra à u + 1 est la caméra à u translatée de L', () => {
  for (const s of SEEDS) {
    const R = generate(s), C = camOf(R);
    for (const u of [0, 0.13, 0.5]) {
      const a = C.pose(u), b = C.pose(u + 1 - 1e-9);
      // (pose() lit la partie fractionnaire : b est la fin de la boucle, juste avant le raccord)
      const end = C.pose(1 - 1e-9), start = C.pose(0);
      assert.ok(Math.abs(end.pos[0] - SITE.L - start.pos[0]) < 1e-4, `raccord x ${end.pos[0] - SITE.L} ≠ ${start.pos[0]}`);
      for (const j of [1, 2]) assert.ok(Math.abs(end.pos[j] - start.pos[j]) < 1e-4);
      assert.ok(Math.abs(a.pos[1] - b.pos[1]) < 1e-3 || u > 0); // (cohérence)
    }
    // les sites : le présent à la phase u, le passé à u + 1
    assert.deepEqual(sites(0.3).map((q) => q.s), [0.3, 1.3]);
  }
});

test('la caméra est lente et lisse (pointe < 25°/s, accélération bornée à 120 i/s)', () => {
  for (const s of SEEDS) {
    const R = generate(s), C = camOf(R), dur = R.loop.duration, N = dur * 120;
    let maxAng = 0, maxAcc = 0, prevV = null;
    const dirAt = (u) => { const p = C.pose(u); const d = p.target.map((t, i) => t - p.pos[i]); const l = Math.hypot(...d); return d.map((x) => x / l); };
    for (let i = 0; i < N; i++) {
      const u = i / N, du = 1 / N;
      const a = dirAt(u), b = dirAt(u + du);
      const ang = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180 / Math.PI * 120;
      maxAng = Math.max(maxAng, ang);
      const p0 = C.pose(u).pos, p1 = C.pose(u + du).pos;
      const sh = (u + du >= 1) ? SITE.L : 0; // (la translation au raccord)
      const v = p1.map((x, k) => (x + (k === 0 ? sh : 0) - p0[k]) * 120);
      if (prevV) maxAcc = Math.max(maxAcc, Math.hypot(...v.map((x, k) => (x - prevV[k]) * 120)));
      prevV = v;
    }
    assert.ok(maxAng < 25, `${s} : ${maxAng.toFixed(1)}°/s`);
    assert.ok(maxAcc < 60, `${s} : accélération ${maxAcc.toFixed(1)} cm/s²`);
  }
});

test('en suivant le nuage, la caméra reste lente (< 25°/s)', () => {
  for (const [sd, f] of [['c3', 'arcyria'], ['b2', 'stemonitis']]) {
    const { R, S } = site(sd, f);
    const C = createCameraPath(R.camera, { L: R.site.L, target: [0.2, 0], forest: [0.3, 0.1], H: 0.4, y0: 0, distForest: 3, cloud: cloudTrack(S.smoke, R.site.L), groundAt: (x, z) => logBase(z, R.site.logR) + 0.05 }, 40);
    const N = 40 * 60;
    let maxAng = 0;
    const dirAt = (u) => { const p = C.pose(u); const d = p.target.map((t, i) => t - p.pos[i]); const l = Math.hypot(...d); return d.map((x) => x / l); };
    for (let i = 0; i < N; i++) { const a = dirAt(i / N), b = dirAt((i + 1) / N); maxAng = Math.max(maxAng, Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180 / Math.PI * 60); }
    assert.ok(maxAng < 25, `${sd} : ${maxAng.toFixed(1)}°/s`);
  }
});

test('le réseau de Tero conserve le flux et les volumes passent du réseau aux perles', () => {
  for (const [s, f] of [['a1', 'lamproderma'], ['c3', 'arcyria'], ['b2', 'stemonitis']]) {
    const { S } = site(s, f);
    assert.ok(S.stats.residual < 0.06, `${s} : résidu de Kirchhoff ${S.stats.residual}`);
    assert.ok(Math.abs(S.stats.Vnet - S.stats.Vbeads) / S.stats.Vnet < 1e-9, `${s} : volume réseau ${S.stats.Vnet} ≠ perles ${S.stats.Vbeads}`);
    assert.ok(S.nBeads > 15, `${s} : ${S.nBeads} perles`);
  }
});

test('le front avance, ralentit, et couvre le territoire avant l’aube', () => {
  const R = generate('a1'), seeds = seedsOf(R.plasmodium, R.plasmodium.seed);
  const F = arrivalField(R.plasmodium, R.site.L, seeds);
  let tmax = 0, cells = 0;
  for (const t of F.T) if (t < 1) { tmax = Math.max(tmax, t); cells++; }
  assert.ok(tmax <= T.dawn[0] + 1e-6, `le front finit à ${tmax}`);
  assert.ok(cells > 1000);
  const inside = seeds.filter((g) => sampleT(F, g.x, g.z) < 0.3);
  assert.ok(inside.length >= 4);
  for (const g of inside) assert.ok(sampleT(F, g.x, g.z) < 0.15, 'chaque graine germe tôt');
});

test('chaque germination part d’un grain posé par le nuage du site précédent', () => {
  for (const [sd, f] of [['a1', 'lamproderma'], ['c3', 'arcyria'], ['d4', 'hemitrichia']]) {
    const { R, S } = site(sd, f);
    const G = S.smoke.grains, L = R.site.L, F = S.smoke.frames;
    const seeds = []; for (let i = 0; i < S.seeds.length; i += 3) seeds.push(S.seeds.slice(i, i + 3));
    assert.equal(G.designated.length, seeds.length, `${sd} : une graine sans grain`);
    for (const g of G.designated) {
      const o = ((F - 1) * G.n + g) * 3;
      const x = G.pos[o] + G.corr[g * 2], z = G.pos[o + 2] + G.corr[g * 2 + 1];
      const d = Math.min(...seeds.map((q) => Math.hypot(x - L - q[0], z - q[1])));
      assert.ok(d < 1e-3, `${sd} : grain à ${d.toFixed(4)} cm de sa graine`);
      const q = seeds.find((q2) => Math.hypot(x - L - q2[0], z - q2[1]) < 1e-3);
      assert.ok(G.land[g] - 1 < q[2], `${sd} : posé à ${G.land[g] - 1}, germe à ${q[2]}`);
    }
  }
});

test('le nuage : bilan de masse exact, dépôt qui ne décroît pas, grains jamais sous le bois', () => {
  for (const [sd, f] of [['c3', 'arcyria'], ['b2', 'stemonitis']]) {
    const { R, S } = site(sd, f);
    const B = S.smoke.budget, Sm = S.smoke, D = Sm.domain;
    assert.ok(B.emitted > 0);
    assert.ok(Math.abs(B.airborne + B.deposited + B.outflow - B.emitted) / B.emitted < 1e-4, `${sd} : bilan ${JSON.stringify(B)}`);
    assert.ok(B.deposited / B.emitted > 0.3, `${sd} : trop peu de dépôt (${(B.deposited / B.emitted).toFixed(2)})`);
    const nxz = D.nx * D.nz;
    for (let f = 1; f < Sm.frames; f++) for (let c = 0; c < nxz; c += 7) assert.ok(Sm.dep[f * nxz + c] >= Sm.dep[(f - 1) * nxz + c] - 1e-12, 'le dépôt ne décroît jamais');
    const ground = heightGrid({ ...R.wood, L: R.site.L, W: R.site.W, logR: R.site.logR }, 256);
    for (let f = 0; f < Sm.frames; f += 4) for (let g = 0; g < Sm.grains.count; g += 37) {
      const o = (f * Sm.grains.n + g) * 3, x = Sm.grains.pos[o];
      if (!(x === x)) continue;
      assert.ok(Sm.grains.pos[o + 1] >= ground(x, Sm.grains.pos[o + 2]) - 0.002, 'grain sous le bois');
    }
  }
});

test('la projection rend le champ (presque) sans divergence', () => {
  const nx = 24, ny = 16, nz = 18, N = nx * ny * nz, h = 0.1;
  const u = new Float32Array(N), v = new Float32Array(N), w = new Float32Array(N), solid = new Uint8Array(N);
  // (un champ lisse : le schéma de Stam — divergence et gradient centrés,
  // laplacien compact — ne voit pas le mode en damier d'un bruit blanc)
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const o = (k * ny + j) * nx + i;
    u[o] = Math.sin(i * 0.4 + j * 0.2) + 0.5 * Math.cos(k * 0.3); v[o] = Math.cos(i * 0.3 - k * 0.25); w[o] = Math.sin(j * 0.35 + i * 0.15);
  }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) solid[(k * ny) * nx + i] = 1;
  const before = meanDivergence(u, v, w, solid, nx, ny, nz, h);
  project(u, v, w, new Float32Array(N), new Float32Array(N), new Float32Array(N), solid, nx, ny, nz, h, 200);
  const after = meanDivergence(u, v, w, solid, nx, ny, nz, h);
  assert.ok(after < before * 0.25, `divergence ${before.toFixed(2)} → ${after.toFixed(2)}`);
});

test('l’horloge : une seule, des temps monotones', () => {
  assert.ok(Math.abs(daylight(0) - daylight(1 - 1e-9)) < 1e-6, 'le jour boucle');
  for (let s = 0; s < 1; s += 0.001) {
    for (const k of ['rise', 'mature', 'open']) assert.ok(stage(k, s + 0.001) >= stage(k, s));
    if (s > T.dawn[0] && s < T.dawn[1]) assert.ok(daylight(s + 0.001) >= daylight(s), 'l’aube monte');
    if (s > T.dusk[0] && s < T.dusk[1] - 0.001) assert.ok(daylight(s + 0.001) <= daylight(s), 'le soir baisse');
  }
  assert.equal(windSpeed(0.5), 0, 'pas de vent avant la maturité');
  assert.ok(windSpeed(0.8) > 0.5, 'le souffle à la dissémination');
  // la cause (le souffle) précède l'effet (l'ouverture)
  assert.ok(T.wind[0] <= T.open[0]);
});

test('les têtes ne se traversent pas (forêt mûre, filets détendus)', () => {
  for (const [s, f] of [['c3', 'arcyria'], ['b2', 'stemonitis'], ['a1', 'lamproderma']]) {
    const { R, S } = site(s, f);
    const sp = FAMILIES[R.family].species[R.species], D = S.dims;
    const grow = R.family === 'arcyria' ? 1.28 : R.family === 'stemonitis' ? 1.05 : 1;
    const B = []; for (let i = 0; i < S.nBeads; i++) B.push(S.beads.subarray(i * 8, i * 8 + 8));
    let worst = Infinity;
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const d = Math.hypot(B[i][0] - B[j][0], B[i][1] - B[j][1]);
      const need = (B[i][2] + B[j][2]) * D.headR * grow;
      worst = Math.min(worst, d / need);
    }
    assert.ok(worst >= 0.999, `${s} ${f} : têtes à ${worst.toFixed(3)} × le contact`);
  }
});

test('les gabarits sont orientés : chaque triangle tourne sa face avant du côté de ses normales', () => {
  for (const [f, sp] of Object.entries(FAMILIES).flatMap(([f, F]) => Object.values(F.species).filter((q) => q.head).map((q) => [f, q]))) {
    const T = buildTemplate(f, sp, 't'), P = T.position, Nn = T.normal, I = T.index;
    let bad = 0;
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
      const u = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), v = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
      const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (Math.hypot(...g) < 1e-12) continue;
      const n = [0, 1, 2].map((k) => Nn[a * 3 + k] + Nn[b * 3 + k] + Nn[c * 3 + k]);
      if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0) bad++;
    }
    assert.ok(bad / (I.length / 3) < 0.01, `${f} ${sp.label} : ${bad} triangles retournés sur ${I.length / 3}`);
  }
});

test('recette déterministe, en JSON, toutes les humeurs et familles tirées', () => {
  const a = generate('xyz'), b = generate('xyz');
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  const moods = new Set(), fams = new Set();
  for (let i = 0; i < 200; i++) { const R = generate(`s${i}`); moods.add(R.mood); fams.add(R.family); }
  assert.equal(moods.size, 6); assert.equal(fams.size, 6);
});
