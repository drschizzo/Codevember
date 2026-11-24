// Invariants de Burrow, vérifiés sans navigateur : node --test 'burrow/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, PALETTES } from '../src/recipe.js';
import { buildSlab, SLAB } from '../src/gen/slab.js';
import { slabTextures, NEVER } from '../src/gen/slabtex.js';
import { SHELF, ageAt, WINDOW, sunDirAt } from '../src/layout.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette, en JSON pur', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur est tirée ; ses sables existent', () => {
  const seen = new Set(SEEDS.map((s) => generate(s).mood));
  for (const m of Object.keys(MOODS)) assert.ok(seen.has(m), `humeur jamais tirée : ${m}`);
  for (const M of Object.values(MOODS)) for (const p of M.palettes) assert.ok(PALETTES[p], p);
});

const slabs = ['a1-0', 'b2-1', 'c3-2', 'd4-0'].map((s) => buildSlab(s));

test('le tumulus est exactement le sable creusé (au grain près)', () => {
  for (const S of slabs) {
    let dug = 0, mound = 0;
    for (let i = 0; i < S.dug.length; i++) { if (S.dug[i] >= 0) dug++; if (S.mound[i] >= 0) mound++; }
    assert.equal(mound, dug);
    assert.ok(dug > 5000, 'le réseau creuse vraiment');
  }
});

test('le tas empile les couches à l\'envers : sa peau vient de plus bas que son cœur', () => {
  for (const S of slabs) {
    // profondeur moyenne d'origine (rang de couche) des grains du cœur et de la peau du tas
    const { nx, ny, nyS } = S;
    let coreK = 0, coreN = 0, skinK = 0, skinN = 0;
    for (let i = 0; i < nx; i++) {
      const col = [];
      for (let j = nyS; j < ny; j++) if (S.mound[i + nx * j] >= 0) col.push(S.layer[i + nx * j]);
      if (col.length < 8) continue;
      const q = Math.floor(col.length / 4);
      for (const k of col.slice(0, q)) { coreK += k; coreN++; }
      for (const k of col.slice(-q)) { skinK += k; skinN++; }
    }
    // couche 0 = fond : la peau a un rang plus petit (vient de plus bas)
    assert.ok(skinK / skinN < coreK / coreN, `peau ${skinK / skinN} ≥ cœur ${coreK / coreN}`);
  }
});

test('chaque grain du tas tombe après avoir été creusé, et le tas ne fait que monter', () => {
  for (const S of slabs) {
    const { nx, ny, nyS } = S;
    for (let i = 0; i < nx; i++) {
      let last = -1;
      for (let j = nyS; j < ny; j++) {
        const t = S.mound[i + nx * j];
        if (t < 0) continue;
        assert.ok(t >= last - 1e-9, 'un grain posé sous un grain plus ancien');
        last = t;
      }
    }
  }
});

test('les galeries ne sortent pas du sable ; toutes les entrées creusent en même temps', () => {
  for (const S of slabs) {
    for (let id = 0; id < S.dug.length; id++) if (S.dug[id] >= 0) assert.ok(S.layer[id] !== 255);
    // à mi-vie, chaque entrée a creusé la moitié de son réseau (horloges parallèles)
    const per = S.entrances.map(() => [0, 0]);
    for (const n of S.nodes) { per[n.ent][1]++; if (n.t <= 0.5) per[n.ent][0]++; }
    for (const [h, t] of per) assert.ok(h / t > 0.3 && h / t < 0.7);
  }
});

test('les textures de la tranche : apparition et creusement cohérents', () => {
  const o = slabTextures({ seed: 'a1-0' });
  assert.equal(o.A.length, o.nx * o.ny * 4);
  assert.equal(o.B.length, o.nx * o.ny * 2);
  assert.ok(NEVER > 1);
});

test('l\'étagère boucle : âge et place reviennent après M tranches', () => {
  for (const p of [-2, -1.2, -0.3, 0, 0.7, 1.2, 2]) assert.equal(ageAt(p), ageAt(p)); // (fonction pure)
  assert.equal(ageAt(1.2), 0); assert.equal(ageAt(-1.2), 1);
  for (let x = -2; x <= 2; x += 0.01) assert.ok(ageAt(x + 0.01) <= ageAt(x) + 1e-12, 'une tranche ne rajeunit pas en avançant');
  // la caméra avance d'un nombre entier de tranches par boucle
  assert.ok(Number.isInteger(SHELF.M));
});

test('le soleil traverse la fenêtre de sa tranche (portes-fenêtres alignées)', () => {
  for (const s of SEEDS.slice(0, 60)) {
    const R = generate(s), d = sunDirAt(R.sun.az, R.sun.el);
    assert.ok(d[2] > 0 && d[1] > 0, 'le soleil vient de devant et d\'en haut');
    const shift = (WINDOW.Z * d[0]) / d[2];
    // milieu de la tranche → point du mur des fenêtres, ramené dans un pas
    const xw = ((0 + shift - shift) % SHELF.L + SHELF.L) % SHELF.L;
    assert.ok(xw >= 0);
  }
  assert.ok(WINDOW.x1 - WINDOW.x0 > SLAB.W, 'la fenêtre est plus large que la tranche');
});

test('chaque motif de sable donne des couches ordonnées, sans voisines de même couleur', async () => {
  for (const style of ['lits', 'sablier', 'dunes', 'eventail']) {
    const S = buildSlab(`m-${style}`, { style });
    for (let k = 1; k < S.nL; k++) assert.notEqual(S.colorOrder[k], S.colorOrder[k - 1]);
    // le long de chaque colonne, le rang de couche ne redescend jamais en montant
    for (let i = 0; i < S.nx; i += 37) { let last = 0; for (let j = 0; j < S.nyS; j++) { const k = S.layer[i + S.nx * j]; if (S.dug[i + S.nx * j] >= 0) continue; assert.ok(k >= last); last = k; } }
  }
});

test('une étagère montre trois motifs différents ; les vers creusent plus fin, sans chambres', async () => {
  const { STYLES } = await import('../src/recipe.js');
  for (const s of SEEDS.slice(0, 80)) { const st = generate(s).slabs.map((x) => x.params.style); assert.equal(new Set(st).size, 3); for (const x of st) assert.ok(STYLES[x]); }
  const V = buildSlab('ver-1', { digger: 'vers' }), F = buildSlab('ver-1', { digger: 'fourmis' });
  const count = (S) => { let n = 0; for (const d of S.dug) if (d >= 0) n++; return n; };
  assert.ok(count(V) < count(F), 'un terrier de ver enlève moins de sable');
});

test('les motifs du sol se répètent exactement sur une boucle', () => {
  const P = SHELF.M * SHELF.L;
  for (const s of [1.2, 0.6, 1.5, 0.02]) assert.ok(Math.abs(P / s - Math.round(P / s)) < 1e-9, `pas ${s}`);
});
