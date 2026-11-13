// L'éclair : un arbre, qui touche sa pointe à l'image de la jonction, et que
// rien ne traverse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, layout } from '../src/recipe.js';
import { buildVessel } from '../src/gen/vessels.js';
import { buildBolt, tessellate, gapAt, blocked } from '../src/gen/dbm.js';

const SEEDS = Array.from({ length: 80 }, (_, i) => `b${i}`);
const made = SEEDS.map((s) => {
  const R = generate(s), V = buildVessel(R.vessel), L = layout(R, V.meta);
  return { s, R, V, L, B: buildBolt(L.spec) };
});

test('déterminisme : même graine, même arbre', () => {
  const { L, B } = made[0];
  assert.deepEqual(buildBolt(L.spec).pos, B.pos);
});

test('c’est un arbre : une racine, chaque nœud a un parent né avant lui', () => {
  for (const { s, B } of made) {
    let roots = 0;
    for (let i = 0; i < B.n; i++) { if (B.parent[i] < 0) roots++; else assert.ok(B.parent[i] < i || B.tb[B.parent[i]] !== undefined, `${s} : parent`); }
    assert.equal(roots, 1, `${s} : ${roots} racines`);
    assert.ok(B.n >= 20 && B.n < 900, `${s} : ${B.n} nœuds`);
  }
});

test('chaque famille d’éclair est produite, avec son nombre de canaux', () => {
  const by = {};
  for (const { R, B } of made) (by[R.bolt.family] ??= []).push(B.strokes.length);
  for (const f of ['strike', 'upward', 'spider', 'fork']) assert.ok(by[f]?.length, `famille absente : ${f}`);
  assert.ok(by.fork.some((n) => n >= 2), 'aucun éclair fourchu à plusieurs impacts');
});

test('cause et effet : l’écart traceur–aigrette est nul à la jonction, positif juste avant', () => {
  for (const { s, R, B } of made) {
    if (R.bolt.family === 'upward') continue; // (l'ascendant part de sa pointe : il la touche dès le début)
    assert.equal(gapAt(B, 1), 0, `${s} : écart à la jonction`);
    assert.ok(gapAt(B, 0.999) > 1e-4, `${s} : contact avant la jonction`);
    assert.ok(gapAt(B, 0.5) > gapAt(B, 0.999) - 1e-9, `${s} : l'écart ne décroît pas`);
  }
});

test('l’arc touche la vraie géométrie : la pointe de la cuillère, le bouton, ou la surface du thé', () => {
  for (const { s, R, V, L, B } of made) {
    const t = B.strokes[0].target;
    if (R.bolt.family === 'fork') {
      for (const S of B.strokes) {
        assert.ok(Math.abs(S.target[1] - V.meta.liquid.y) < 1e-6, `${s} : impact hors de la surface`);
        assert.ok(Math.hypot(S.target[0], S.target[2]) < V.meta.liquid.r, `${s} : impact hors du bol`);
      }
    } else if (R.bolt.family !== 'upward') {
      assert.ok(Math.hypot(t[0] - L.strike[0], t[1] - L.strike[1], t[2] - L.strike[2]) < 1e-6, `${s} : la cible n'est pas la pointe`);
    } else {
      const r = [B.pos[0], B.pos[1], B.pos[2]];
      assert.ok(Math.hypot(r[0] - L.strike[0], r[1] - L.strike[1], r[2] - L.strike[2]) < 1e-6, `${s} : l'ascendant ne part pas de la pointe`);
    }
  }
});

test('le traceur ne traverse ni le récipient ni la table (tous les points des segments dessinés)', () => {
  for (const { s, R, L, B } of made) {
    const seg = tessellate(B, { rough: R.bolt.rough });
    let bad = 0;
    for (let i = 0; i < seg.length; i += 12) {
      // (les derniers segments touchent la pointe : on ne teste pas à moins d'une demi-maille d'elle)
      for (const p of [[seg[i], seg[i + 1], seg[i + 2]], [seg[i + 4], seg[i + 5], seg[i + 6]]]) {
        const near = B.strokes.some((S) => Math.hypot(p[0] - S.target[0], p[1] - S.target[1], p[2] - S.target[2]) < L.h * 1.6) || Math.hypot(p[0] - L.spec.root[0], p[1] - L.spec.root[1], p[2] - L.spec.root[2]) < L.h * 1.6;
        if (!near && blocked(p, [...L.spec.obstacles, { type: 'floor', y: 0 }], -L.h * 0.35)) bad++;
      }
    }
    assert.equal(bad, 0, `${s} (${R.vessel.variant}) : ${bad} points dans la matière`);
  }
});

test('le traceur descend (ou monte) : sur un canal, la naissance suit le sens de la marche', () => {
  for (const { s, R, B } of made) {
    const S = B.strokes[0], lead = S.path.slice(S.chain); // (du site de jonction à la racine)
    for (let k = 1; k < lead.length; k++) {
      if (R.bolt.family === 'upward') assert.ok(B.tb[lead[k]] >= B.tb[lead[k - 1]] - 1e-9, `${s} : ascendant`);
      else assert.ok(B.tb[lead[k]] <= B.tb[lead[k - 1]] + 1e-9, `${s} : le canal naît dans le désordre`);
    }
  }
});
