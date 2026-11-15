// La recette et la mise en place : déterminisme, humeurs et familles tirées,
// rien ne se traverse sur la table, l'écho est dans le cadre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, MOODS, FAMILIES } from '../src/recipe.js';
import { derive, frontRange, footprint, beadRest } from '../src/gen/layout.js';
import { cameraAt, TIMELINE } from '../src/film.js';
import { sub, dot, norm, cross, planeEcho, reflectPoint } from '../src/gen/optics.js';

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

test('nature morte : au moins trois vases, aucun ne se traverse, tous sur la table', () => {
  for (const s of SEEDS) {
    const R = generate(s);
    assert.ok(R.objects.length >= 3, `${s} : ${R.objects.length} vases`);
    const T = R.table;
    for (const [i, o] of R.objects.entries()) {
      const f = footprint(o);
      assert.ok(Math.abs(o.x) + f <= T.width / 2 && Math.abs(o.z) + f <= T.depth / 2, `${s} : vase ${i} hors de la table`);
      for (const q of R.objects.slice(i + 1)) assert.ok(Math.hypot(o.x - q.x, o.z - q.z) >= f + footprint(q), `${s} : vases qui se touchent`);
      // la perle du cordon ne tombe pas dans un vase
      const b = beadRest(R.lamp);
      if (Math.hypot(o.x - b[0], o.z - b[2]) < f + 0.01) assert.ok(o.h < b[1] - 0.02, `${s} : la perle touche un vase`);
    }
  }
});

test('trumeau et psyché : la caméra voit le reflet de l’ampoule dans la glace', () => {
  let n = 0;
  for (const s of SEEDS) {
    const R = generate(s);
    if (!R.reflector.plane) continue;
    const D = derive(R);
    const e = cameraAt(R.camera, (TIMELINE.on.slow + TIMELINE.on.end) / 2).pos;
    // le rayon de l'œil vers l'ampoule image traverse la glace
    const hit = planeEcho(e, D.s, D.plane);
    assert.ok(hit, `${s} (${R.family}) : le reflet de l'ampoule n'est pas dans la glace`);
    n++;
  }
  assert.ok(n > 100);
});

test('miroir ardent : le foyer est sur la table, devant la calotte, sans vase dessus', () => {
  for (const s of SEEDS) {
    const R = generate(s, { family: 'ardent' });
    const D = derive(R), E = D.E;
    assert.ok(Math.abs(E.f2[1]) < 0.01);
    // la calotte regarde la lampe et le foyer
    assert.ok(dot(E.normal, norm(sub(E.f1, E.M))) > 0 && dot(E.normal, norm(sub(E.f2, E.M))) > 0);
    for (const o of R.objects) assert.ok(Math.hypot(o.x - E.f2[0], o.z - E.f2[2]) > footprint(o) + 0.03, `${s} : un vase sur le foyer`);
  }
});

test('les fronts : tout est encore noir au début du ralenti, tout est allumé à sa fin', () => {
  for (const s of SEEDS.slice(0, 120)) {
    const R = generate(s);
    const { rhoStart, rhoEnd } = frontRange(R);
    assert.ok(rhoStart > 1 && rhoEnd > rhoStart + 2 && rhoEnd < 11.5, `${s} : ${rhoStart} → ${rhoEnd}`);
  }
});
