// node --test fold/proto/p1/fpori.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { unitParams, unitPose, unitTriangles, unitPoints, rigidityError, intersections, heightAt, towerPose } from './fpori.mjs';

// (le prisme triangulaire se traverse à mi-course : n ≥ 4 seulement)
const Ns = [4, 5, 6, 7, 8, 10];

test('à 45°, le prisme se plie à plat pour θ = 2π/n (éq. 14 de l\'article)', () => {
  for (const n of Ns) {
    const P = unitParams(n, Math.PI / 4);
    assert.ok(Math.abs(P.thetaMax - (2 * Math.PI) / n) < 1e-9, `n=${n}`);
    assert.ok(heightAt(P, P.thetaMax) < 1e-6);
  }
});

test('la hauteur suit l\'éq. 6 de l\'article', () => {
  for (const n of Ns) for (const a of [Math.PI / 4, Math.PI / 3]) {
    const P = unitParams(n, a), beta = ((n - 2) / n) * Math.PI;
    for (const th of [0.1, 0.3, 0.5]) {
      const ref = Math.sqrt(Math.tan(a) ** 2 - (1 - Math.cos(th)) / (2 * Math.cos(beta / 2) ** 2));
      if (Number.isFinite(ref)) assert.ok(Math.abs(heightAt(P, th) - ref) < 1e-12);
    }
  }
});

test('les faces restent rigides tout au long du pliage', () => {
  for (const n of Ns) {
    const P = unitParams(n, Math.PI / 4), p0 = unitPose(P, 0);
    for (let i = 1; i < 50; i++) assert.ok(rigidityError(P, p0, unitPose(P, (P.thetaMax * i) / 50)) < 1e-9);
  }
});

test('aucune face ne traverse une autre ni un plateau, et chaque unité reste dans sa tranche', () => {
  for (const n of Ns) {
    const P = unitParams(n, Math.PI / 4), tris = unitTriangles(n);
    for (let i = 1; i < 60; i++) {
      const p = unitPose(P, (P.thetaMax * i) / 60 * 0.995), pts = unitPoints(p);
      const all = [...tris], pp = [...pts, [0, 0, 0], [0, p.h, 0]], c0 = pts.length;
      for (let k = 0; k < n; k++) { all.push({ v: [c0, k, (k + 1) % n] }); all.push({ v: [c0 + 1, n + k, n + ((k + 1) % n)] }); }
      assert.deepEqual(intersections(pp, all), [], `n=${n} i=${i}`);
      for (const q of pts) {
        assert.ok(q[1] >= -1e-9 && q[1] <= p.h + 1e-9);
        assert.ok(Math.hypot(q[0], q[2]) <= P.R + 1e-9);
      }
    }
  }
});

test('la tour : plateaux partagés et rotations alternées', () => {
  const P = unitParams(6, Math.PI / 4), th = [0.3, 0.5, 0.2, 0.4];
  const T = towerPose(P, th);
  for (let j = 0; j + 1 < th.length; j++) {
    const top = T.units[j].pts.slice(6, 12), bot = T.units[j + 1].pts.slice(0, 6);
    // même ensemble de sommets (l'ordre change d'une chiralité à l'autre)
    for (const q of top) assert.ok(bot.some((b) => Math.hypot(b[0] - q[0], b[1] - q[1], b[2] - q[2]) < 1e-9));
  }
  assert.ok(Math.abs(T.plates.at(-1).psi - (0.3 - 0.5 + 0.2 - 0.4)) < 1e-12);
});
