// Les tirages de shared/rng.js sont figés : toutes les scènes de tous les
// projets en dépendent (une graine = une scène). Si ce test échoue, ce n'est
// pas le test qu'il faut corriger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, createNoise3, hashSeed, jitter } from '../rng.js';

test('rng : la suite d’une graine ne change pas', () => {
  const r = createRng('codevember');
  assert.equal(hashSeed('codevember'), 1098245072);
  assert.deepEqual([r.next(), r.range(0, 1), r.int(0, 1000), r.gauss()], [0.8649681345559657, 0.9947843991685659, 564, 1.5851853943717071]);
  assert.deepEqual(r.dir(), [-0.5604715146120546, 0.7612696995233905, 0.32609833776950836]);
});

test('rng : un flux dérivé ne dépend pas des tirages du parent', () => {
  const a = createRng('codevember'), b = createRng('codevember');
  for (let i = 0; i < 50; i++) a.next();
  const fa = a.fork('camera'), fb = b.fork('camera');
  assert.deepEqual([fa.range(0, 1), fa.int(0, 1000)], [0.515373504254967, 114]);
  assert.deepEqual([fb.range(0, 1), fb.int(0, 1000)], [0.515373504254967, 114]);
});

test('rng : bruit et décalages du rendu accumulé déterministes', () => {
  const n = createNoise3('codevember'), m = createNoise3('codevember');
  assert.equal(n.noise(0.3, 1.7, 2.9), m.noise(0.3, 1.7, 2.9));
  assert.ok(Math.abs(n.noise(0.3, 1.7, 2.9)) <= 1);
  assert.deepEqual(jitter(3, 7).pixel, [0.08887191492398672, 0.1833673391851004]);
});
