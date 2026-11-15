// La géométrie : chaque famille construit son réflecteur, sans NaN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, FAMILIES } from '../src/recipe.js';
import { buildScene } from '../src/gen/build.js';

const KEYS = { trumeau: ['mirror'], psyche: ['mirror'], galerie: ['mirror', 'mirrorB', 'frontWall'], ardent: ['ardent'], facettes: ['ball'] };

test('chaque famille construit son réflecteur, sans NaN', () => {
  for (const f of Object.keys(FAMILIES)) {
    for (const seed of ['b1', 'b2']) {
      const o = buildScene(generate(seed, { family: f }), { dust: 100 });
      for (const k of KEYS[f]) assert.ok(o[k], `${f} : ${k} manquant`);
      const walk = (v) => { if (!v || typeof v !== 'object') return; if (v.position) for (const x of v.position) assert.ok(Number.isFinite(x), `${f} : NaN`); else if (!ArrayBuffer.isView(v)) for (const w of Object.values(v)) walk(w); };
      walk(o);
    }
  }
});
