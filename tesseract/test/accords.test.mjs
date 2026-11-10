// Direction artistique : les règles des accords de matières et de la
// distribution des motifs (node --test tesseract/test), sur tous les accords
// et sur quelques centaines de graines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, MOODS, familyOf, calmSet, ornate, SEE, OWN_LINING } from '../src/recipe.js';
import { FINISHES, SETS } from '../src/finishes.js';
import { twinFace, embedLocal, adjacent } from '../src/math4.js';

const outer = (k) => FINISHES[SETS[k].outer];
const fam = (k) => (['anodized', 'lacquer'].includes(SETS[k].outer) ? 'couleur' : familyOf(outer(k)));
// (une pièce sans motif montre sa doublure : la face interne pour quelques jeux, l'externe sinon)
const famRich = (k) => (OWN_LINING.has(k) ? familyOf(FINISHES[SETS[k].inner]) : fam(k));
const SEEDS = Array.from({ length: 400 }, (_, i) => `ad${i}`);

test('une paroi partagée : la face jumelle de la jumelle est la face, au même endroit en 4D', () => {
  for (let c = 0; c < 8; c++) for (let f = 0; f < 6; f++) {
    const [b, g] = twinFace(c, f);
    assert.ok(adjacent(c, b));
    assert.deepEqual(twinFace(b, g), [c, f]);
    const at = (cell, face) => { const l = [0, 0, 0]; l[face >> 1] = face & 1 ? 1 : -1; return embedLocal(cell, l); };
    assert.deepEqual(at(c, f), at(b, g));
  }
});

test('accords : jeux unis pour les motifs, matières riches pour les pièces sans motif, trois familles, l’or en accent', () => {
  for (const [mood, M] of Object.entries(MOODS)) {
    assert.ok(M.accords.length >= 4, `${mood} : au moins quatre accords`);
    M.accords.forEach(([frame, motif, counter, rich, objects], i) => {
      const at = `${mood} #${i + 1}`;
      for (const k of [frame, motif, counter, ...rich, ...objects]) assert.ok(SETS[k] && !SETS[k].only, `${at} : jeu ${k}`);
      assert.ok(calmSet(motif) && calmSet(counter), `${at} : le motif et le contrepoint portent des jeux unis`);
      assert.notEqual(motif, counter);
      assert.notEqual(fam(motif), fam(counter), `${at} : le contrepoint tranche sur le motif (${fam(motif)})`);
      // une pièce sans motif n'est pas vide : sa matière dessine, ou c'est la couleur de la scène
      for (const k of rich) assert.ok(!calmSet(k) || fam(k) === 'couleur' || ['nacre', 'soap', 'carbon', 'titanium'].includes(k), `${at} : ${k} n'est pas une matière riche`);
      assert.ok(rich.length >= 2 && new Set(rich).size === rich.length);
      const families = new Set([...[frame, motif, counter].map(fam), ...rich.map(famRich)]);
      assert.ok(families.size >= 3, `${at} : ${[...families]} (trois familles au moins)`);
      assert.ok(!(fam(frame) === 'or' && fam(motif) === 'or'), `${at} : l'or sur l'ossature et sur le motif`);
      assert.ok([fam(motif), fam(counter), ...rich.map(famRich)].filter((x) => x === 'or').length <= 1, `${at} : l'or sur plus d'un jeu de parois`);
      assert.ok(objects.length >= 3 && new Set(objects.map(fam)).size >= 2, `${at} : des objets de deux familles au moins`);
    });
  }
});

test('scènes : deux motifs au plus, un par pièce et par paroi, une pièce sur deux environ, aucune pièce vide', () => {
  let ornFaces = 0;
  for (const seed of SEEDS) {
    const R = generate(seed), P = R.palette, at = `graine ${seed}`;
    const motifs = new Set(R.cells.flatMap((c) => c.faces.filter(ornate)));
    assert.ok(motifs.size >= 1 && motifs.size <= 2, `${at} : ${[...motifs]}`);
    if (motifs.size === 2) assert.equal(new Set([...motifs].map((m) => SEE.has(m))).size, 2, `${at} : le contrepoint est de l'autre nature`);
    let withMotif = 0;
    R.cells.forEach((cell, c) => {
      const orn = cell.faces.filter(ornate);
      ornFaces += orn.length;
      assert.ok(new Set(orn).size <= 1 && orn.length <= 4, `${at}, cellule ${c} : ${cell.faces}`);
      if (orn.length) {
        withMotif++;
        assert.ok(calmSet(cell.panelSet), `${at}, cellule ${c} : motif sur ${cell.panelSet}`);
        assert.equal(cell.panelSet, orn[0] === P.sig && !(P.solo && cell.kind === 'mixte') ? P.motif : P.counter);
      } else assert.ok(P.rich.includes(cell.panelSet), `${at}, cellule ${c} : pièce sans motif en ${cell.panelSet}`);
      // une paroi, un motif
      cell.faces.forEach((k, f) => { const [b, g] = twinFace(c, f); assert.ok(!(ornate(k) && ornate(R.cells[b].faces[g])), `${at} : paroi ${c}/${b}`); });
      // tous les panneaux d'un motif ont le même dessin
      assert.deepEqual(cell.perf, R.cells[0].perf);
    });
    assert.ok(withMotif >= 2 && withMotif <= 5, `${at} : ${withMotif} pièces à motif`);
    // des matières variées : trois jeux de parois au moins, aucun sur plus de quatre pièces
    const sets = {};
    for (const cell of R.cells) sets[cell.panelSet] = (sets[cell.panelSet] || 0) + 1;
    assert.ok(Object.keys(sets).length >= 3 && Math.max(...Object.values(sets)) <= 4, `${at} : ${JSON.stringify(sets)}`);
    // l'or en accent : moins de la moitié des pièces, dehors comme dedans
    for (const side of ['outer', 'inner']) assert.ok(R.cells.filter((c) => familyOf(c.panel[side]) === 'or').length <= 4, `${at} : trop d'or (${side})`);
    // l'objet tranche sur les murs de sa pièce
    for (const cell of R.cells) {
      if (SETS[cell.content.set].only || cell.content.type === 'gem') continue;
      const wall = familyOf(cell.panel.inner);
      if (P.objects.some((k) => familyOf(outer(k)) !== wall)) assert.notEqual(familyOf(cell.content.finish.outer), wall, `${at} : objet ${cell.content.set} sur ${cell.panelSet}`);
    }
    const types = {};
    for (const cell of R.cells) types[cell.content.type] = (types[cell.content.type] || 0) + 1;
    assert.ok(Math.max(...Object.values(types)) <= 2, `${at} : ${JSON.stringify(types)}`);
  }
  const mean = ornFaces / SEEDS.length;
  assert.ok(mean > 8 && mean < 14, `faces à motif par scène : ${mean.toFixed(1)} sur 48`);
});
