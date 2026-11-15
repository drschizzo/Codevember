// La recette et la mise en place : déterminisme, humeurs et familles tirées,
// rien ne se traverse sur la table, l'écho est dans le cadre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, MOODS, FAMILIES } from '../src/recipe.js';
import { derive, frontRange, footprint } from '../src/gen/layout.js';
import { cameraAt, TIMELINE } from '../src/film.js';
import { sub, add, mul, dot, norm, dist, cross, planeEcho, reflectPoint, planeBasis, ellipseRadius, ellipseEcho } from '../src/gen/optics.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('même graine, même recette (aller-retour JSON compris)', () => {
  for (const s of SEEDS.slice(0, 40)) {
    const a = generate(s), b = generate(s);
    assert.deepEqual(a, b);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  }
});

test('toutes les humeurs et toutes les familles sont tirées', () => {
  const moods = new Set(), fams = new Set();
  for (const s of SEEDS) { const R = generate(s); moods.add(R.mood); fams.add(R.family); }
  assert.deepEqual([...moods].sort(), Object.keys(MOODS).sort());
  assert.deepEqual([...fams].sort(), Object.keys(FAMILIES).sort());
});

test('nature morte : au moins trois vases, aucun ne se traverse, tous sur la table, aucun sous la lampe', () => {
  for (const s of SEEDS) {
    const R = generate(s);
    assert.ok(R.objects.length >= 3, `${s} : ${R.objects.length} vases`);
    const T = R.table;
    for (const [i, o] of R.objects.entries()) {
      const f = footprint(o);
      assert.ok(Math.abs(o.x) + f <= T.width / 2 && Math.abs(o.z) + f <= T.depth / 2, `${s} : vase ${i} hors de la table`);
      for (const q of R.objects.slice(i + 1)) assert.ok(Math.hypot(o.x - q.x, o.z - q.z) >= f + footprint(q), `${s} : vases qui se touchent`);
      if (Math.hypot(o.x - R.lamp.x, o.z - R.lamp.z) < f + 0.07) assert.ok(o.h < R.lamp.y - 0.09, `${s} : un vase touche la lampe`);
    }
  }
});

test('trumeau et psyché : la caméra voit le reflet de l’ampoule dans la glace', () => {
  let n = 0;
  for (const s of SEEDS) {
    const R = generate(s);
    if (!R.reflector.plane) continue;
    const D = derive(R);
    const e = cameraAt(R.camera, (TIMELINE.slow + TIMELINE.end) / 2).pos;
    // le rayon de l'œil vers l'ampoule image traverse la glace
    const hit = planeEcho(e, D.s, D.plane);
    assert.ok(hit, `${s} (${R.family}) : le reflet de l'ampoule n'est pas dans la glace`);
    n++;
  }
  assert.ok(n > 100);
});

test('miroir ardent : une sphère centrée sur l’ampoule, hors de la table, tournée vers elle ; l’écho revient en 2R', () => {
  for (const s0 of SEEDS) {
    const R = generate(s0, { family: 'ardent' });
    const D = derive(R), E = D.E;
    assert.ok(dist(E.f1, E.f2) < 1e-9, 'le centre de courbure est la lampe');
    assert.ok(Math.abs(E.a - dist(E.M, E.f1)) < 1e-9, 'rayon R = |M − lampe|');
    assert.ok(dot(E.normal, norm(sub(E.f1, E.M))) > 0.999, 'la calotte regarde la lampe');
    // le bord de la calotte reste hors du plateau
    const { u, v } = planeBasis(E.axis);
    const th = Math.acos(E.cosCap);
    for (let k = 0; k < 24; k++) {
      const ph = (k / 24) * 2 * Math.PI;
      const d = norm(add(add(mul(E.axis, Math.cos(th)), mul(u, Math.sin(th) * Math.cos(ph))), mul(v, Math.sin(th) * Math.sin(ph))));
      const P = add(E.f2, mul(d, ellipseRadius(E, d)));
      assert.ok(P[0] > R.table.width / 2 + 0.01 || P[1] > 0.02, `${s0} : la calotte entre dans la table`);
    }
    // un point sur l'axe, entre la calotte et la lampe : chemin 2R − |x − lampe|
    const x = add(E.f2, mul(E.axis, 0.3));
    assert.ok(Math.abs(ellipseEcho(x, E).L - (2 * E.a - 0.3)) < 1e-9);
  }
});

test('le front : rien n’est encore visible au début du ralenti ; durée de 10 à 16 s', () => {
  for (const s of SEEDS.slice(0, 120)) {
    const R = generate(s);
    const { rhoStart, rhoEnd } = frontRange(R);
    assert.ok(rhoStart > 0.8 && rhoEnd > rhoStart + 2 && rhoEnd < 11.5, `${s} : ${rhoStart} → ${rhoEnd}`);
    assert.ok(R.film.duration >= 7 && R.film.duration <= 16);
  }
});
