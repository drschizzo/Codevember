// La galerie : l'intérieur en enfilade (recipe.js, toGallery).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, toGallery, GALLERY_ROOMS } from '../src/recipe.js';
import { validNet, netCenters, stepOrientations, innerCell, ROOT } from '../src/math4.js';

const SEEDS = ['atl45i', 'abc', 'k3z9', 'zz1', 'q7', 'm0ss', 'h2o', 'x'];
const gallery = (s) => toGallery(generate(s));

test('quatre pièces distinctes, en ligne droite, et retour au départ', () => {
  for (const s of SEEDS) {
    const R = gallery(s), Q = stepOrientations(R.moves), rooms = Q.slice(0, 4).map(innerCell);
    assert.equal(R.moves.length, 4);
    assert.ok(R.moves.every((m) => m.a === 0 && m.b === undefined), 'un seul plan, le long de x');
    assert.equal(new Set(rooms).size, 4);
    assert.equal(rooms[0], ROOT);
    assert.equal(innerCell(Q[4]), ROOT);
    assert.equal(rooms[2], rooms[0] ^ 1); assert.equal(rooms[3], rooms[1] ^ 1);
  }
});

test('le patron est valide et montre les quatre pièces en rangée', () => {
  for (const s of SEEDS) {
    const R = gallery(s), rooms = stepOrientations(R.moves).slice(0, 4).map(innerCell), C = netCenters(R.net.parent);
    assert.ok(validNet(R.net.parent), s);
    const xs = rooms.map((c) => Math.round(C[c][0])).sort((a, b) => a - b);
    for (const c of rooms) { assert.equal(Math.round(C[c][1]), 0); assert.equal(Math.round(C[c][2]), 0); }
    assert.deepEqual(xs.map((x) => x - xs[0]), [0, 2, 4, 6]);
    // (aucune pièce latérale devant la rangée, du côté de la caméra)
    C.forEach((p, c) => { if (!rooms.includes(c)) assert.ok(!(Math.round(p[1]) === 0 && Math.round(p[2]) > 0), `pièce ${c} devant la rangée (${s})`); });
  }
});

test('chaque pièce : sa matière dehors comme dedans, un relief plein sur deux murs, un sol, un objet abaissé', () => {
  for (const s of SEEDS) {
    const R = gallery(s), rooms = stepOrientations(R.moves).slice(0, 4).map(innerCell);
    rooms.forEach((c, i) => {
      const cell = R.cells[c], room = GALLERY_ROOMS[i];
      assert.equal(cell.panel.inner.preset, room.finish);
      assert.equal(cell.panel.outer.preset, room.finish);
      assert.equal(cell.faces.filter((f) => f === room.side).length, 2);
      assert.equal(cell.faces.filter((f) => f === 'plate').length, 4);
      assert.ok(cell.content.drop && cell.content.drop.some((x) => x !== 0));
      if (cell.content.type !== 'gem') assert.ok(room.objects.includes(cell.content.set));
    });
    R.cells.forEach((cell, c) => { if (!rooms.includes(c)) assert.ok(cell.faces.every((f) => f === 'plate')); });
    assert.equal(R.voyage.gallery, true);
  }
});

test('la même graine donne la même galerie', () => {
  assert.deepEqual(gallery('atl45i'), gallery('atl45i'));
});
