// Invariants de la recette et de la direction artistique, vérifiés sans
// navigateur : node --test 'anamorph/test/*.test.mjs'
//
// À compléter avec les invariants du thème : géométrie (maillage étanche, pas
// de triangle nul), boucle (l'état à u = 1 rejoint celui à u = 0), collisions,
// et les règles de direction artistique, sur quelques centaines de graines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS } from '../src/recipe.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur est tirée, et chaque sol existe', async () => {
  const seen = new Set(SEEDS.map((s) => generate(s).mood));
  for (const m of Object.keys(MOODS)) assert.ok(seen.has(m), `humeur jamais tirée : ${m}`);
  const GROUNDS = ['snow', 'rock', 'sand', 'concrete', 'planks', 'basalt'];
  for (const [m, M] of Object.entries(MOODS)) assert.ok(GROUNDS.includes(M.ground), `${m} : sol inconnu ${M.ground}`);
  assert.equal(new Set(Object.values(MOODS).map((M) => M.ground)).size, Object.keys(MOODS).length, 'deux humeurs sur le même sol');
});

test('boucle parfaite : le soleil fait exactement un tour, sans jamais reculer', async () => {
  const { hourAngle, timeline } = await import('../src/gen/clock.js');
  for (const sd of SEEDS.slice(0, 40)) {
    const R = generate(sd);
    assert.ok(Math.abs(hourAngle(R, 1) - hourAngle(R, 0) - 2 * Math.PI) < 1e-9);
    let prev = hourAngle(R, 0);
    for (let i = 1; i <= 400; i++) { const h = hourAngle(R, i / 400); assert.ok(h > prev, `${sd} : le soleil recule`); prev = h; }
    // aux tenues, le soleil est exactement à l'heure de chaque figure
    const T = timeline(R), TAU = 2 * Math.PI;
    R.object.figs.forEach((f, k) => {
      const d = (((hourAngle(R, [T.u1, T.u2][k]) - f.H) % TAU) + TAU) % TAU;
      assert.ok(Math.min(d, TAU - d) < 1e-6, `${sd} : figure ${k} décalée de ${d}`);
    });
  }
});

test('caméra : raccord exact, mouvement continu et borné (≤ 25°/s à 120 i/s)', async () => {
  const { cameraAt, poseToCamera } = await import('../src/gen/clock.js');
  for (const sd of SEEDS.slice(0, 20)) {
    const R = generate(sd);
    const place = R.object.figs.map((f, k) => ({ center: [k, 2], len: 4 }));
    const a = poseToCamera(cameraAt(R, 0, place)), b = poseToCamera(cameraAt(R, 1 - 1e-9, place));
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(a.position[i] - b.position[i]) < 1e-3, `${sd} : raccord`);
    const n = Math.round(R.loop.duration * 120);
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const P = poseToCamera(cameraAt(R, i / n, place));
      const d = [P.target[0] - P.position[0], P.target[1] - P.position[1], P.target[2] - P.position[2]];
      const l = Math.hypot(...d); const dir = d.map((x) => x / l);
      if (prev) {
        const ang = Math.acos(Math.min(1, dir[0] * prev[0] + dir[1] * prev[1] + dir[2] * prev[2])) * 180 / Math.PI * 120;
        assert.ok(ang < 25, `${sd} : ${ang.toFixed(1)}°/s à u = ${(i / n).toFixed(3)}`);
      }
      prev = dir;
    }
  }
});
