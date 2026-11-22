// La tour FP-ori bistable : node --test fold/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { unitParams, energyPath, poseAt, limb } from '../src/sim/fpori.js';
import { unitTriangles, unitPoints, intersections } from '../src/sim/fpori.js';
import { simulate, towerFilm } from '../src/sim/tower.js';
import { generate } from '../src/recipe.js';

const deg = Math.PI / 180;

test('α = 60°, n = 6 : contact à 2π/n, barrière, puis plat sans contrainte (bistable)', () => {
  const P = unitParams(6, 60 * deg), E = energyPath(P, 400);
  assert.ok(Math.abs(E.thLock - 60 * deg) < 0.5 * deg, `contact à ${E.thLock / deg}°`);
  const m = E.U.length, peak = Math.max(...E.U);
  for (let i = 0; i < m; i++) if (E.th[i] < E.thLock - 1e-9) assert.ok(E.U[i] < 1e-12);
  assert.ok(peak > 5e-3, `barrière ${peak}`);
  assert.ok(E.U[m - 1] < 1e-9 && E.h[m - 1] < 1e-6, 'à plat, sans contrainte');
});

test('α = 54° : l\'énergie reste piégée à plat (monostable) ; α = 45° : aucune énergie', () => {
  const E54 = energyPath(unitParams(6, 54 * deg), 300), E45 = energyPath(unitParams(6, 45 * deg), 300);
  assert.ok(E54.U[E54.U.length - 1] > 5e-3);
  assert.ok(Math.max(...E45.U) < 1e-9);
});

test('n = 8, α = 67,5° (= β/2) : bistable aussi', () => {
  const E = energyPath(unitParams(8, 67.5 * deg), 400), m = E.U.length;
  assert.ok(Math.max(...E.U) > 5e-3 && E.U[m - 1] < 1e-9);
});

test('pose : symétrie exacte, et seuls les deux triangles pressés se touchent', () => {
  const P = unitParams(6, 60 * deg), E = energyPath(P, 200), tris = unitTriangles(6);
  // paires gauche_k / droite_{k−1} : elles partagent l'arête verticale, le test les ignore déjà
  for (let i = 0; i < E.th.length - 1; i += 7) {
    const pose = poseAt(P, E.h[i], E.th[i], null, 0.01);
    const hits = intersections(unitPoints(pose), tris);
    assert.equal(hits.length, 0, `θ = ${(E.th[i] / deg).toFixed(1)}° : ${JSON.stringify(hits)}`);
    // X_1 doit être l'image de X_0 : distances aux coins du membre 1
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    assert.ok(Math.abs(d(pose.X[1], pose.B[1]) - d(pose.X[0], pose.B[0])) < 1e-9);
    assert.ok(Math.abs(d(pose.Y[0], pose.T[1]) - d(pose.Y[5], pose.T[0])) < 1e-9);
  }
});

test('la tour sous presse : tout claque, tout se redéploie, la boucle raccorde', () => {
  const S = simulate({ cycles: 2 }), F = S.frames, L = F.length;
  const mid = F[Math.round(L * 0.37)], end = F[L - 1];
  for (const th of mid.th) assert.ok(th > 110 * deg, `à plat : ${th / deg}`);
  for (const th of end.th) assert.ok(th < 4 * deg, `déployé : ${th / deg}`);
  for (let j = 0; j < F[0].th.length; j++) assert.ok(Math.abs(F[0].th[j] - end.th[j]) < 0.05 * deg);
});

test('le film du worker : une boucle de la scène, à plat au milieu, déployé aux bords', () => {
  const F = towerFilm({ units: 4, loop: 14, fps: 30 });
  assert.equal(F.F, 14 * 30);
  for (let a = 0; a < 4; a++) {
    assert.ok(F.th[Math.round(F.F * 0.37) * 4 + a] > 110 * deg);
    assert.ok(Math.abs(F.th[(F.F - 1) * 4 + a] - F.th[a]) < 0.1 * deg);
  }
});

test('graines : une tour de temps en temps, et les autres scènes inchangées', () => {
  let n = 0;
  for (let i = 0; i < 200; i++) if (generate(`s${i}`).patterns.includes('tour')) n++;
  assert.ok(n > 40 && n < 110, `${n} tours sur 200`);
  assert.deepEqual(generate('2nwhb5').patterns, ['tour', 'carre', 'soleil'], "la scène d'ouverture (page et relais) : la tour au centre");
});
