// Invariants de Fold (le papier qui se plie seul) : node --test fold/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, MOODS, PATTERNS, BACKDROPS, HALF, GAP } from '../src/recipe.js';
import { pleatedU, dihedral, bake, renderMesh } from '../src/sim/fold.js';

test('recette déterministe, JSON, tous les choix tirés', () => {
  assert.deepEqual(generate('x1'), generate('x1'));
  const R = generate('x1');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  const seen = { mood: new Set(), backdrop: new Set(), pattern: new Set(), count: new Set() };
  for (let i = 0; i < 300; i++) {
    const r = generate(`s${i}`);
    seen.mood.add(r.mood); seen.backdrop.add(r.backdrop); seen.count.add(r.sheets.length);
    assert.equal(new Set(r.patterns).size, r.patterns.length, 'deux feuilles ne portent pas le même patron');
    assert.equal(r.loop.duration, 2 * HALF);
    for (const s of r.sheets) {
      seen.pattern.add(s.pattern);
      assert.notEqual(s.top % 2, s.bot % 2, 'les deux faces : une chaude, une froide');
      if (s.pattern === 'tour') {
        // une tour : posée sur son plateau de laiton (sur le socle, ou au sol)
        assert.ok(Math.abs(s.base - ((s.plinth?.h ?? 0) + 0.012)) < 1e-3 && s.y > s.base + 0.3 && s.y < 1.9, `tour mal posée (${r.seed})`);
        // (tirée au hasard, elle est le sujet : au centre, et grande)
        assert.ok(s.size >= 1.3 * s.l && r.sheets.indexOf(s) === 0 && s.y > 1.5 && s.l > 0.19, `tour pas mise en avant (${r.seed})`);
        continue;
      }
      // le bas de la selle ne touche ni son socle ni le sol
      assert.ok(s.y - (s.pattern === 'soleil' ? 0.95 : 0.62) * s.size > (s.plinth?.h ?? 0), `feuille trop basse (${r.seed})`);
    }
    // deux feuilles ne peuvent pas se toucher : leurs cylindres (rayon = taille) sont disjoints
    r.sheets.forEach((a, i) => r.sheets.slice(i + 1).forEach((b) => assert.ok(Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) >= a.size + b.size + GAP - 0.02, `feuilles trop proches (${r.seed})`)));
  }
  assert.equal(seen.mood.size, Object.keys(MOODS).length);
  assert.equal(seen.backdrop.size, Object.keys(BACKDROPS).length);
  assert.equal(seen.pattern.size, Object.keys(PATTERNS).length);
  assert.deepEqual([...seen.count].sort(), [2, 3]);
});

test('les choix du panneau gardent le reste de la scène', () => {
  const A = generate('k7'), B = generate('k7', { mood: 'reglisse', patterns: ['rosace', 'carre'] });
  assert.equal(B.mood, 'reglisse');
  assert.deepEqual(B.patterns, ['rosace', 'carre']);
  assert.deepEqual(B.camera, A.camera);
  assert.equal(B.sheets[0].size, A.sheets[0].size);
});

test('angle dièdre : nul à plat, gradient exact', () => {
  assert.equal(dihedral(new Float64Array([0, 0, 0, 1, 0, 0, 0.5, 0, 1, 0.5, 0, -1]), 0, 1, 2, 3), 0);
  const x = new Float64Array([0, 0, 0, 1, 0.1, 0, 0.4, 0.3, 0.9, 0.5, -0.2, -0.8]), g = new Float64Array(12), t0 = dihedral(x, 0, 1, 2, 3, g);
  for (let i = 0; i < 12; i++) { const y = x.slice(); y[i] += 1e-6; assert.ok(Math.abs((dihedral(y, 0, 1, 2, 3) - t0) / 1e-6 - g[i]) < 1e-4); }
});

test('patron : maillage fermé, plis alternés, tour de 2π/n', () => {
  for (const k of Object.keys(PATTERNS)) {
    if (PATTERNS[k].kind === 'tour') continue; // (pas une feuille : test/tower.test.mjs)
    const { label, eps, amp, ...spec } = PATTERNS[k];
    const S = pleatedU({ ...spec, rings: 8, sub: 2, m: 10 });
    if (S.soleil) { assert.ok(S.mirror); continue; }
    // chaque arête porte un ou deux triangles
    assert.equal(S.bars.length / 3, S.N + S.tris.length / 3, `${k} : un anneau (caractéristique d'Euler 0)`);
    // les anneaux alternent montagne et vallée
    const byRing = new Map();
    for (let h = 0; h < S.hinges.length; h += 6) { const a = S.hinges[h], b = S.hinges[h + 1], c = S.hinges[h + 4]; if (Math.abs(c) === 1 && S.ringOf[a] === S.ringOf[b]) byRing.set(S.ringOf[a], c); }
    const rings = [...byRing.keys()].sort((a, b) => a - b);
    assert.equal(rings.length, 7);
    rings.forEach((r, i) => i && assert.equal(byRing.get(r), -byRing.get(rings[i - 1])));
    // le tour envoie chaque sommet sur un sommet
    const c = Math.cos(S.w), s = Math.sin(S.w);
    for (let i = 0; i < S.N; i++) { const j = S.perm[i]; assert.ok(Math.hypot(S.P[3 * j] - (S.P[3 * i] * c - S.P[3 * i + 2] * s), S.P[3 * j + 2] - (S.P[3 * i] * s + S.P[3 * i + 2] * c)) < 1e-5, k); }
  }
});

test('film : la selle se forme, bascule, et la boucle se referme', () => {
  for (const k of ['carre', 'rosace', 'soleil']) {
    const { label, eps, amp, ...spec } = PATTERNS[k];
    const S = pleatedU({ ...spec, rings: 9, sub: 2, m: 11 }), B = bake(S, { eps, amp }), { frames, F, N } = B, my = S.mirror ? -1 : 1;
    assert.ok(B.gap < 0.06, `${k} : la selle a bien basculé (écart ${B.gap.toFixed(3)})`);
    assert.ok(B.strain[1] < 0.02, `${k} : le papier ne s'étire pas (${B.strain[1].toFixed(4)})`);
    let h = 0;
    for (let i = 0; i < N; i++) h = Math.max(h, Math.abs(frames[3 * i + 1]));
    assert.ok(h > 0.3, `${k} : un vrai volume (${h.toFixed(2)})`);
    // fin d'une bascule = début, tourné d'un cran ; et chaque image a la symétrie de la selle
    const c = Math.cos(S.w), s = Math.sin(S.w), c2 = Math.cos(2 * S.w), s2 = Math.sin(2 * S.w), o = F * 3 * N, f = 77 * 3 * N;
    for (let i = 0; i < N; i++) {
      const j = S.perm[i], l = S.perm[j];
      assert.ok(Math.hypot(frames[o + 3 * j] - (frames[3 * i] * c - frames[3 * i + 2] * s), frames[o + 3 * j + 1] - my * frames[3 * i + 1], frames[o + 3 * j + 2] - (frames[3 * i] * s + frames[3 * i + 2] * c)) < 1e-5);
      assert.ok(Math.hypot(frames[f + 3 * l] - (frames[f + 3 * i] * c2 - frames[f + 3 * i + 2] * s2), frames[f + 3 * l + 1] - frames[f + 3 * i + 1], frames[f + 3 * l + 2] - (frames[f + 3 * i] * s2 + frames[f + 3 * i + 2] * c2)) < 1e-5);
    }
    const M = renderMesh(S, B);
    assert.equal(M.pos.length, M.F1 * M.RN * 4);
    for (let r = 0; r < M.RN; r += 7) { const q = (50 * M.RN + r) * 4; assert.ok(Math.abs(Math.hypot(M.nor[q], M.nor[q + 1], M.nor[q + 2]) - 1) < 1e-4); }
    for (let i = 0; i < M.near.length; i += 4) assert.ok(M.near[i] >= 0 && M.near[i] < M.RN);
  }
});
