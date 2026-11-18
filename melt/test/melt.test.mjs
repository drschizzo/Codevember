// Invariants de Melt (la mini-usine) : node --test melt/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, MOODS, WAXES, HEATS, CIRCUITS } from '../src/recipe.js';
import { OBJECTS, VOLUME, BOX, MOULD, scaleOf, volumeOf, seedPoints, heightOf, sdObject, mouldField, surfaceNets } from '../src/objects.js';
import { TL, circuit, along, stateAt, carriers } from '../src/cycle.js';

test('recette déterministe, JSON, tous les choix tirés', () => {
  assert.deepEqual(generate('x1'), generate('x1'));
  const R = generate('x1');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  const seen = { mood: new Set(), wax: new Set(), heat: new Set(), circuit: new Set(), object: new Set(), count: new Set() };
  for (let i = 0; i < 400; i++) {
    const r = generate(`s${i}`);
    seen.mood.add(r.mood); seen.wax.add(r.wax); seen.heat.add(r.heat); seen.circuit.add(r.factory.circuit); seen.count.add(r.objects.length);
    for (const o of r.objects) seen.object.add(o);
    assert.equal(new Set(r.objects).size, r.objects.length, 'une usine ne refond pas deux fois la même figurine');
    assert.equal(r.loop.duration, r.loop.half * r.objects.length);
  }
  assert.equal(seen.mood.size, Object.keys(MOODS).length);
  assert.equal(seen.wax.size, Object.keys(WAXES).length);
  assert.equal(seen.heat.size, Object.keys(HEATS).length);
  assert.equal(seen.circuit.size, Object.keys(CIRCUITS).length);
  assert.equal(seen.object.size, Object.keys(OBJECTS).length);
  assert.deepEqual([...seen.count].sort(), [2]);
});

test('toutes les figurines ont le même volume de cire et tiennent dans leur boîte', () => {
  const counts = [];
  for (const k of Object.keys(OBJECTS)) {
    const sc = scaleOf(k), P = OBJECTS[k].prims;
    assert.ok(Math.abs(volumeOf(P, sc) / VOLUME - 1) < 0.02, `${k} : volume ${volumeOf(P, sc)}`);
    const h = heightOf(k, sc);
    assert.ok(h > 25 && h < BOX.min[1] + BOX.size[1] - 1.5, `${k} : hauteur ${h}`);
    // rien ne touche le bord de la boîte (la texture de distance y serait coupée)
    for (let y = 0.5; y < BOX.size[1] - 1; y += 2) for (let a = 0; a < 24; a++) {
      const c = Math.cos((a / 24) * Math.PI * 2), s = Math.sin((a / 24) * Math.PI * 2);
      assert.ok(sdObject(P, sc, c * (BOX.size[0] / 2 - 0.5), y, s * (BOX.size[2] / 2 - 0.5)) > 0, `${k} touche le bord de sa boîte`);
    }
    counts.push(seedPoints(k, sc, 0.6).length / 3);
  }
  assert.ok(Math.max(...counts) / Math.min(...counts) < 1.04, `particules : ${counts}`);
  assert.ok(Math.max(...counts) <= 40000, 'la capacité de la simulation suffit');
});

test('circuit : la chaleur est à l’aplomb du moule, les deux demi-chemins se referment', () => {
  for (let i = 0; i < 200; i++) {
    const F = generate(`c${i}`).factory, C = circuit(F);
    assert.deepEqual(C.down[0], [0, F.y1]); assert.deepEqual(C.down.at(-1), [0, F.y0]);
    assert.deepEqual(C.up[0], [0, F.y0]); assert.deepEqual(C.up.at(-1), [0, F.y1]);
    // la cloche levée passe sous la ligne haute (buse comprise)
    assert.ok(F.y0 + 0.56 + 2 * F.bellH + 0.14 + 0.12 < F.y1 - 0.12, 'la cloche levée heurte la ligne haute');
    for (const poly of [C.down, C.up]) for (let u = 0; u <= 1; u += 0.01) {
      const p = along(poly, u);
      assert.ok(p[1] >= F.y0 - 1e-9 && p[1] <= F.y1 + 1e-9);
    }
  }
});

test('cycle : continu, périodique, un plateau sous la chaleur et un sous le moule pendant la fonte', () => {
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const R = generate(seed), F = R.factory, n = R.objects.length, K = 6000;
    let prev = stateAt(R, 0);
    const r3 = (v) => Math.round(v * 1000) / 1000 || 0;
    const key = (S) => S.pallets.map((p) => `${r3(p[0])},${r3(p[1])}`).sort().join('|');
    // (les deux plateaux sont identiques : c'est l'ensemble de leurs places qui doit être continu)
    assert.equal(key(stateAt(R, 0)), key(stateAt(R, 1 - 1e-9)));
    for (let i = 1; i <= K; i++) {
      const S = stateAt(R, i / K);
      const a = [...S.pallets].sort((p, q) => p[0] - q[0] || p[1] - q[1]), b = [...prev.pallets].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      const d1 = Math.hypot(a[0][0] - b[0][0], a[0][1] - b[0][1]) + Math.hypot(a[1][0] - b[1][0], a[1][1] - b[1][1]);
      const d2 = Math.hypot(a[0][0] - b[1][0], a[0][1] - b[1][1]) + Math.hypot(a[1][0] - b[0][0], a[1][1] - b[0][1]);
      assert.ok(Math.min(d1, d2) < 0.2, `saut des plateaux à ${i / K} (${seed})`);
      assert.ok(Math.abs(S.bell - prev.bell) < 0.05 || S.k !== prev.k && S.bell < 0.05 && prev.bell < 0.05, `saut de la cloche à ${i / K}`);
      assert.ok(Math.abs(S.heat - prev.heat) < 0.05, `saut de la chaleur à ${i / K}`);
      if (S.heat > 0) {
        const w = S.pallets[S.wax], o = S.pallets[1 - S.wax];
        assert.ok(Math.hypot(w[0], w[1] - F.y1) < 1e-9, 'la cire fond sous la source');
        assert.ok(Math.hypot(o[0], o[1] - F.y0) < 1e-9, 'le plateau vide attend sous la cloche');
        assert.ok(S.bell < 1e-6 && S.open < 1e-6, 'le moule est posé et fermé quand la cire coule');
      }
      // le barillet ne tourne que cloche levée
      if (Math.abs(S.arm - prev.arm) > 1e-9 && S.k === prev.k) assert.ok(S.bell > 0.98, `le barillet tourne moule bas à ${i / K}`);
      { const fr = S.arm - Math.floor(S.arm); if (fr > 0.2 && fr < 0.999) assert.ok(S.open < 0.02, `le moule pivote ouvert à ${i / K}`); }
      assert.ok(Math.abs(S.open - prev.open) < 0.05 || S.k !== prev.k, `saut de l'ouverture à ${i / K}`);
      prev = S;
    }
    assert.equal(stateAt(R, 0.999999).k, n - 1);
  }
  assert.ok(TL.lift < TL.move && TL.move < TL.lower && TL.lower <= TL.heat && TL.heat < TL.melt && TL.melt < TL.half);
});

test('chariots : à demeure, jamais de plateau sans chariot hors des lignes, retour à vide continu', () => {
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const R = generate(seed), F = R.factory, C = circuit(F), K = 8000;
    const n0 = stateAt(R, 0).carriers.length;
    assert.equal(n0, F.circuit === 'rampe' ? 2 : 2, 'un chariot par ascenseur ou par rampe');
    let prev = stateAt(R, 0);
    for (let i = 1; i <= K; i++) {
      const S = stateAt(R, i / K);
      assert.equal(S.carriers.length, n0, 'un chariot ne disparaît jamais');
      S.carriers.forEach((c, j) => {
        const q = prev.carriers[j];
        if (S.k === prev.k) assert.ok(Math.hypot(c.pos[0] - q.pos[0], c.pos[1] - q.pos[1]) < 0.06, `saut d'un chariot à ${i / K} (${seed})`);
      });
      // un plateau qui n'est sur aucune ligne est sur un chariot
      for (const p of S.pallets) {
        const onLine = Math.abs(p[1] - F.y0) < 1e-6 || Math.abs(p[1] - F.y1) < 1e-6;
        if (!onLine) assert.ok(S.carriers.some((c) => Math.hypot(c.pos[0] - p[0], c.pos[1] - p[1]) < 1e-6), `plateau sans chariot à ${i / K} (${seed})`);
      }
      prev = S;
    }
    // au début comme à la fin d'un demi-cycle, chaque chariot attend au départ de son tronçon
    for (const t of [0, TL.half - 1e-6]) for (const c of carriers(C, t === 0 ? 0 : 1, t)) assert.ok(Math.hypot(c.pos[0] - c.p[0], c.pos[1] - c.p[1]) < 1e-3, 'chariot hors de sa place d’attente');
  }
  assert.ok(TL.back0 > TL.move && TL.back1 < TL.half);
});

test('moule : deux demi-coques fermées autour de la figurine, canal de coulée dans l’axe', () => {
  for (const k of ['lapin', 'quille']) {
    const sc = scaleOf(k);
    for (const side of [1, -1]) {
      const F = mouldField(k, sc, side), G = surfaceNets(F);
      assert.ok(G.position.length > 3000 && G.index.length % 3 === 0);
      for (let i = 0; i < G.position.length; i += 3) {
        assert.ok(side * G.position[i] > 0.05, 'une demi-coque reste de son côté du plan de joint');
        assert.ok(G.position[i + 1] > 0.2 && G.position[i + 1] < F.top + 0.5);
        // le métal ne mord jamais sur la figurine
        assert.ok(sdObject(OBJECTS[k].prims, sc, G.position[i], G.position[i + 1], G.position[i + 2]) > MOULD.tIn - 0.6, 'le moule entre dans l’objet');
      }
      // chaque arête appartient à deux faces (surface fermée)
      const edges = new Map();
      for (let i = 0; i < G.index.length; i += 3) for (let e = 0; e < 3; e++) { const a = G.index[i + e], b = G.index[i + (e + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`; edges.set(key, (edges.get(key) || 0) + 1); }
      let open = 0; for (const v of edges.values()) if (v !== 2) open++;
      assert.ok(open / edges.size < 0.01, `${open} arêtes ouvertes sur ${edges.size}`);
    }
  }
});
