// L'enveloppe et la fondation : géométrie, naissances, contacts.
//   node --test 'nest/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelope, buildScar } from '../src/gen/envelope.js';
import { buildFoundation } from '../src/gen/comb.js';
import { buildWasp, buildWings } from '../src/gen/wasp.js';
import { makeClock, plan } from '../src/season.js';
import { generate } from '../src/recipe.js';

const C = makeClock(48), P = plan(C);
const R = generate('a1', { mood: 'comble' });
const decode = (o, v) => { const code = o.pat[v * 4 + 3], idc = Math.floor(code / 4 + 0.01); return { id: idc - 1, role: code - idc * 4 }; };
const bell = (k, extra = {}) => buildEnvelope({ ...R.nest.spec, k, lam: P.bells[k].lam, s0: P.bells[k].s0, s1: P.bells[k].s1, ...extra });

test('maillages finis : aucun NaN, des indices valides', () => {
  for (const o of [bell(0), buildFoundation({ seed: 'a1', s0: P.queen, s1: P.comb }), buildWasp(), buildWings(), buildScar({})]) {
    for (const v of o.position) assert.ok(Number.isFinite(v));
    for (const v of o.normal) assert.ok(Number.isFinite(v));
    const n = o.position.length / 3;
    for (const i of o.index) assert.ok(i < n);
  }
});

// Une écaille posée après une autre (plus haut sur le nid) ne passe jamais sous
// elle : sur une grille (θ, φ) autour du centre de la cloche, chaque sommet du
// dessus d'une écaille est au moins aussi loin du centre que les dessus des
// écailles posées avant, au même endroit (tolérance : l'épaisseur du papier).
// Le témoin sans dilatation de la pile doit échouer : c'est lui qui laissait
// les lèvres des écailles du bas percer les faces du dessus.
function piercings(o) {
  const W = 720, H = 360, best = new Float32Array(W * H).fill(-1);
  const scales = new Map();
  const n = o.position.length / 3;
  for (let v = 0; v < n; v++) {
    const { id, role } = decode(o, v);
    if (role !== 0) continue;
    if (!scales.has(id)) scales.set(id, []);
    scales.get(id).push(v);
  }
  const cell = (x, y, z) => { const r = Math.hypot(x, y, z), th = Math.acos(y / r), ph = Math.atan2(z, x); return [Math.min(H - 1, Math.floor((th / Math.PI) * H)), Math.floor(((ph + Math.PI) / (2 * Math.PI)) * W) % W, r]; };
  let bad = 0;
  // ordre de pose : du bas vers le haut (θ décroissant) — l'ordre des numéros
  for (const id of [...scales.keys()].sort((a, b) => a - b)) {
    const vs = scales.get(id), mine = [];
    for (const v of vs) {
      const [j, i, r] = cell(o.position[v * 3], o.position[v * 3 + 1], o.position[v * 3 + 2]);
      const b = best[j * W + i];
      if (b > 0 && r < b - 0.0045) bad++;
      mine.push([j * W + i, r]);
    }
    for (const [k, r] of mine) best[k] = Math.max(best[k], r);
  }
  return bad;
}

test('les écailles ne se traversent pas (et le témoin sans dilatation échoue)', () => {
  for (const k of [2, 5]) assert.equal(piercings(bell(k)), 0, `cloche ${k}`);
  assert.ok(piercings(bell(5, { dilate: false })) > 0, 'le banc ne voit pas les lèvres qui percent');
});

test('le front de construction descend : une écaille naît dans sa fenêtre, après celles du dessus', () => {
  for (const k of [0, 3, 5]) {
    const o = bell(k), B = P.bells[k];
    const first = new Map();
    const n = o.position.length / 3;
    for (let v = 0; v < n; v++) {
      const { id, role } = decode(o, v);
      if (role === 3 || first.has(id)) continue;
      first.set(id, { b: o.grow[v * 2], d: o.grow[v * 2 + 1], y: o.position[v * 3 + 1] });
    }
    for (const { b, d } of first.values()) { assert.ok(b >= B.s0 - 1e-6 && b + d <= B.s1 + 1e-6, `cloche ${k} : écaille hors de sa fenêtre`); }
    // monotone à l'échelle d'une rangée : une écaille nettement plus haute ne naît pas après une plus basse
    const arr = [...first.values()].sort((p, q) => q.y - p.y);
    const span = Math.max(...arr.map((a) => a.y)) - Math.min(...arr.map((a) => a.y));
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j += 7) {
      if (arr[i].y - arr[j].y > span * 0.2) assert.ok(arr[i].b <= arr[j].b + 1e-9, `cloche ${k} : le front remonte`);
    }
  }
});

test('le corps (la feuille sous les écailles) ne paraît jamais avant les écailles de sa rangée', () => {
  const o = bell(4), n = o.position.length / 3;
  const rows = new Map();
  for (let v = 0; v < n; v++) {
    const { role } = decode(o, v);
    const y = Math.round(o.position[v * 3 + 1] * 20);
    if (!rows.has(y)) rows.set(y, { scale: -1, body: Infinity });
    const r = rows.get(y);
    if (role === 0) r.scale = Math.max(r.scale, o.grow[v * 2]);
    if (role === 3) r.body = Math.min(r.body, o.grow[v * 2]);
  }
  for (const [y, r] of rows) if (r.scale > 0 && r.body < Infinity) assert.ok(r.body >= r.scale - 1e-3, `rangée ${y / 20} : le corps devance le front`);
});

test('la cicatrice est la même aux deux bouts de la boucle (une géométrie fixe, née avant tout)', () => {
  const a = buildScar({ seed: 'a1', radius: 0.5 }), b = buildScar({ seed: 'a1', radius: 0.5 });
  assert.deepEqual(a.position, b.position);
  for (let v = 0; v < a.grow.length / 2; v++) assert.ok(a.grow[v * 2] < 0);
});
