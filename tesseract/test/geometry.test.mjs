// Invariants de la géométrie 4D et de la génération (node --test tesseract/test).
// Rien ici ne dépend de three : ce sont les modules purs (math4, recipe, gen,
// reveal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOT, DALI, ident, apply, hinge, unfoldTransforms, normalOf, validNet, randomNet, randomMoves, moveMatrix,
  stepOrientations, innerCell, MOVES, stateAt, cellTransforms, cellMatrix, timelineFor, depthOf, foldOrder, project,
} from '../src/math4.js';
import { generate } from '../src/recipe.js';
import { createRng } from '../src/rng.js';
import { buildPanels, buildContent } from '../src/gen/cell.js';
import { faceLayout } from '../src/scene/reveal.js';

const close = (a, b, eps = 1e-9) => a.every((x, i) => Math.abs(x - b[i]) < eps);
const isIdentity = (m) => close(m, ident().m);
const mulM = (A, B) => {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += A[r * 4 + k] * B[k * 4 + c];
  return o;
};

test('une charnière fermée ne déplace rien ; ouverte, elle couche la cellule dans l’hyperplan du parent', () => {
  for (let s = 0; s < 8; s++) {
    if (s === ROOT || s === (ROOT ^ 1)) continue;
    const h0 = hinge(ROOT, s, 0);
    assert.ok(isIdentity(h0.m) && close(h0.t, [0, 0, 0, 0]));
    // dépliée, la cellule voisine du socle se pose à côté de lui (w = −1)
    const c = apply(hinge(ROOT, s, Math.PI / 2), normalOf(s));
    assert.ok(Math.abs(c[3] + 1) < 1e-9, `cellule ${s} : w = ${c[3]}`);
  }
});

test('les patrons tirés au hasard sont des arbres couvrants sans chevauchement', () => {
  assert.ok(validNet(DALI));
  for (const shape of ['dali', 'cross', 'chain', 'random']) {
    for (let i = 0; i < 40; i++) {
      const parent = randomNet(createRng(`net:${shape}:${i}`), shape);
      assert.equal(parent[ROOT], -1);
      assert.ok(validNet(parent), `${shape} ${i} : ${parent}`);
      // chaque cellule remonte au socle
      assert.ok(depthOf(parent).every((d) => d >= 0 && d < 8));
    }
  }
});

test('les mouvements sont des symétries de l’hypercube, et leur suite se referme', () => {
  for (const mv of MOVES) {
    const m = moveMatrix(mv);
    // matrice de permutation signée : un ±1 par ligne
    for (let r = 0; r < 4; r++) assert.equal(m.slice(r * 4, r * 4 + 4).filter((x) => Math.abs(Math.abs(x) - 1) < 1e-9).length, 1);
  }
  for (const mode of ['same', 'mixed', 'double']) {
    for (let i = 0; i < 30; i++) {
      const moves = randomMoves(createRng(`moves:${mode}:${i}`), mode, mode !== 'mixed');
      const Q = stepOrientations(moves);
      assert.ok(isIdentity(Q[Q.length - 1]), `${mode} ${i}`);
      // pas d’étape qui ramène à un état déjà vu (sauf la dernière, qui referme)
      const seen = Q.slice(0, -1).map((q) => q.map((x) => Math.round(x)).join());
      if (mode !== 'same') assert.equal(new Set(seen).size, seen.length);
    }
  }
});

test('le tour complet fait passer le cube intérieur par les huit cellules, une fois chacune', () => {
  for (let i = 0; i < 40; i++) {
    const moves = randomMoves(createRng(`tour:${i}`), 'tour', i % 2 === 0);
    assert.equal(moves.length, 8);
    const Q = stepOrientations(moves);
    assert.ok(isIdentity(Q[8]));
    assert.equal(new Set(Q.slice(0, 8).map(innerCell)).size, 8);
  }
});

test('la boucle est parfaite : la fin rejoint le début, avec ou sans voyage', () => {
  for (const voyage of [false, true]) {
    for (let i = 0; i < 12; i++) {
      const R = generate(`loop${i}`);
      R.voyage.on = voyage;
      const cache = { timeline: timelineFor(R), Q: stepOrientations(R.moves), depth: depthOf(R.net.parent), order: foldOrder(R.net.parent) };
      const T0 = cellTransforms(stateAt(0, R, cache), R.net.parent);
      const T1 = cellTransforms(stateAt(1 - 1e-7, R, cache), R.net.parent);
      for (let c = 0; c < 8; c++) assert.ok(close(T0[c].m, T1[c].m, 1e-5) && close(T0[c].t, T1[c].t, 1e-5), `voyage ${voyage}, ${R.seed}, cellule ${c}`);
    }
  }
});

// Même formule que le vertex shader (scene/project.js, projectWithJacobian)
function jacobianColumn(y, a, d, g) {
  const r = Math.max(Math.hypot(...y), 1e-4), k = 1 + g * (2 / r - 1);
  const ys = y.map((v) => v * k), den = d - ys[3], s = d / Math.max(den, 0.05);
  const c = (2 * g) / (r * r * r), ya = y.reduce((acc, v, i) => acc + v * a[i], 0);
  const dy = a.map((v, i) => v * k - y[i] * c * ya);
  const sw = den > 0.05 ? (s * s) / d : 0;
  return [0, 1, 2].map((i) => dy[i] * s + ys[i] * sw * dy[3]);
}

test('la jacobienne en forme fermée égale les différences finies de la projection', () => {
  const rng = createRng('jacobian');
  let checked = 0;
  for (let n = 0; n < 200; n++) {
    const y = [0, 1, 2, 3].map(() => rng.range(-1.5, 1.5));
    const a = [0, 1, 2, 3].map(() => rng.range(-1, 1));
    const d = rng.range(2, 4), g = rng.range(0, 1);
    if (d - y[3] * (1 + g * (2 / Math.hypot(...y) - 1)) < 0.2) continue; // (loin du bord borné)
    const e = 1e-6, p0 = project(y, d, g), p1 = project(y.map((v, i) => v + a[i] * e), d, g);
    const fd = p1.map((v, i) => (v - p0[i]) / e);
    const J = jacobianColumn(y, a, d, g);
    assert.ok(close(J, fd, 1e-4 * (1 + Math.hypot(...fd))), `${J} ≠ ${fd}`);
    checked++;
  }
  assert.ok(checked > 150, `${checked} échantillons seulement`);
});

test('l’ajourage connaît l’ancrage et la trame de chaque face, tels que la géométrie les produit', () => {
  for (let i = 0; i < 10; i++) {
    const R = generate(`layout${i}`, { mood: i % 2 ? 'atelier' : 'studio' });
    const layout = faceLayout(R);
    R.cells.forEach((cell, c) => {
      const { panel, glass } = buildPanels(cell, R.frame);
      // ancrages présents dans les maillages
      const anchors = new Set();
      for (const mesh of [panel, glass]) if (mesh) for (let v = 0; v < mesh.anchor.length; v += 3) anchors.add(Array.from(mesh.anchor.slice(v, v + 3), (x) => x.toFixed(5)).join());
      cell.faces.forEach((kind, f) => {
        if (kind === 'open') return;
        const key = layout[c][f].anchor.map((x) => x.toFixed(5)).join();
        assert.ok(anchors.has(key), `${R.seed} cellule ${c} face ${f} (${kind}) : ${key}`);
        assert.equal(layout[c][f].grid[0], kind === 'perf' ? cell.perf.n : 0);
      });
      // largeur de pièce renseignée partout
      for (const mesh of [panel, glass]) if (mesh) assert.ok(mesh.span.every((x) => x > 0 && x <= 1));
    });
  }
});

test('matrice d’une cellule : son centre local va au centre 4D de la cellule', () => {
  const T = unfoldTransforms(DALI, new Array(8).fill(0));
  for (let c = 0; c < 8; c++) {
    const A = cellMatrix(T[c], c, 1);
    assert.ok(close([A[3], A[7], A[11], A[15]], normalOf(c)));
  }
});

test('motifs et objets ajoutés : maillages finis, contenus dans la cellule ; vocabulaire restreint par scène', () => {
  const finite = (m) => m && [m.position, m.normal].every((a) => a.every(Number.isFinite));
  const R = generate('motifs');
  for (const kind of ['miura', 'ripple', 'twist', 'scales', 'comb', 'oculus']) for (const cell of R.cells) {
    const c = { ...cell, faces: [kind, 'open', 'open', 'open', 'open', 'open'] };
    const { panel } = buildPanels(c, R.frame);
    assert.ok(finite(panel), kind);
    let mx = 0; for (const v of panel.position) mx = Math.max(mx, Math.abs(v));
    assert.ok(mx < 1.03, `${kind} déborde : ${mx}`);
  }
  for (const type of ['mobius', 'hyper', 'ammonite', 'egg', 'urchin']) {
    const m = buildContent({ type, size: 0.5 });
    assert.ok(finite(m), type);
    let mx = 0; for (const v of m.position) mx = Math.max(mx, Math.abs(v));
    assert.ok(mx > 0.3 && mx < 0.6, `${type} : ${mx}`);
  }
  for (let i = 0; i < 40; i++) assert.ok(new Set(generate(`voc${i}`).cells.map((c) => c.kind)).size <= 5);
});

test('la boucle courte (par défaut) visite quatre pièces distinctes et revient à la première', () => {
  for (let i = 0; i < 40; i++) {
    const R = generate(`court${i}`);
    assert.equal(R.moveMode, 'short');
    const cells = stepOrientations(R.moves).map(innerCell);
    assert.equal(R.moves.length, 4);
    assert.equal(new Set(cells.slice(0, 4)).size, 4, `${R.seed} : ${cells}`);
    assert.equal(cells[4], cells[0]);
    assert.ok(isIdentity(stepOrientations(R.moves)[4]));
  }
  assert.equal(generate('czyt01').moves.length, 4);
});
