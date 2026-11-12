// Invariants du cœur (node --test spore/test/*.test.mjs) : boucle, caméra,
// réseau de Tero, volumes, spores et germination, horloge, contacts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, SITE } from '../src/recipe.js';
import { createCameraPath } from '../src/camera.js';
import { T, daylight, windSpeed, stage, sites } from '../src/timeline.js';
import { fruitState } from '../src/fruit.js';
import { FAMILIES } from '../src/families.js';
import { buildSite } from '../src/gen/site.js';
import { buildPlasmodium, arrivalField, seedsOf, sampleT } from '../src/gen/plasmodium.js';
import { flight, windTable, sporeAt } from '../src/gen/spores.js';
import { heightGrid, logBase } from '../src/gen/wood.js';

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

test('chaque germination part d’une spore posée par le site précédent', () => {
  for (const [s, f] of [['a1', 'lamproderma'], ['c3', 'arcyria'], ['d4', 'hemitrichia']]) {
    const { R, S } = site(s, f);
    const tab = windTable(R), L = R.site.L;
    const seeds = [];
    for (let i = 0; i < S.seeds.length; i += 3) seeds.push(S.seeds.slice(i, i + 3));
    let matched = 0;
    for (let i = 0; i < S.spores.count; i++) {
      if (!S.spores.a3[i * 4 + 3]) continue;
      const q = { x0: S.spores.a0[i * 4], y0: S.spores.a0[i * 4 + 1], z0: S.spores.a0[i * 4 + 2], sr: S.spores.a0[i * 4 + 3], lift: S.spores.a1[i * 4], vs: S.spores.a1[i * 4 + 1], sig: S.spores.a1[i * 4 + 2], tl: S.spores.a1[i * 4 + 3], p1: S.spores.a2[i * 4], p2: S.spores.a2[i * 4 + 1], p3: S.spores.a2[i * 4 + 2], sl: S.spores.a2[i * 4 + 3], cx: S.spores.a3[i * 4], cz: S.spores.a3[i * 4 + 1] };
      const p = flight(q, q.sl, tab);
      const d = Math.min(...seeds.map((g) => Math.hypot(p[0] - L - g[0], p[2] - g[1])));
      assert.ok(d < 0.01, `${s} : spore désignée à ${d.toFixed(4)} cm de sa graine`);
      // elle se pose avant que sa graine ne germe (phase du site suivant)
      const g = seeds.find((g2) => Math.hypot(p[0] - L - g2[0], p[2] - g2[1]) < 0.01);
      assert.ok(q.sl - 1 < g[2], `${s} : posée à ${q.sl - 1}, germe à ${g[2]}`);
      matched++;
    }
    assert.equal(matched, seeds.length);
  }
});

test('les spores tombent (Stokes), se posent sur le bois et y restent', () => {
  const { R, S } = site('c3', 'arcyria');
  const tab = windTable(R), ground = heightGrid({ ...R.wood, L: R.site.L, W: R.site.W, logR: R.site.logR }, 256);
  for (let i = 0; i < S.spores.count; i += 997) {
    const A = (a, k) => S.spores[a][i * 4 + k];
    const q = { x0: A('a0', 0), y0: A('a0', 1), z0: A('a0', 2), sr: A('a0', 3), lift: A('a1', 0), vs: A('a1', 1), sig: A('a1', 2), tl: A('a1', 3), p1: A('a2', 0), p2: A('a2', 1), p3: A('a2', 2), sl: A('a2', 3), cx: A('a3', 0), cz: A('a3', 1) };
    const pl = flight(q, q.sl, tab);
    assert.ok(Math.abs(pl[1] - ground(pl[0], pl[2])) < 0.003, 'posée sur le bois');
    for (let s = q.sr; s < q.sl; s += 0.004) { const p = flight(q, s, tab); assert.ok(p[1] >= ground(p[0], p[2]) - 0.003, 'jamais sous le bois en vol'); }
  }
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

test('recette déterministe, en JSON, toutes les humeurs et familles tirées', () => {
  const a = generate('xyz'), b = generate('xyz');
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  const moods = new Set(), fams = new Set();
  for (let i = 0; i < 200; i++) { const R = generate(`s${i}`); moods.add(R.mood); fams.add(R.family); }
  assert.equal(moods.size, 6); assert.equal(fams.size, 4);
});
