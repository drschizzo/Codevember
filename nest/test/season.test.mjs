// L'horloge de la saison, la caméra du film, les guêpes : node --test 'nest/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, plan, colony, SLOW, FILM, T_SEASON } from '../src/season.js';
import { cameraScale, filmCamera } from '../src/camera.js';
import { waspsAt } from '../src/flight.js';
import { generate } from '../src/recipe.js';

const C = makeClock(generate('a1').loop.duration), P = plan(C);

test('la boucle se referme : s(0) = 0, s(1) = 1, s croissant', () => {
  assert.equal(C.s(0), 0);
  assert.ok(Math.abs(C.s(1 - 1e-12) - 1) < 1e-6);
  let last = -1;
  for (let i = 0; i < 4000; i++) { const s = C.s(i / 4000); assert.ok(s >= last - 1e-12, `recul à u = ${i / 4000}`); last = s; }
});

test('les ralentis tombent au temps réel (× k), l’accéléré ailleurs', () => {
  for (const w of SLOW) {
    const v = C.speed(w.c);
    assert.ok(v > w.k * 0.6 && v < w.k * 2, `${w.name} : ${v.toFixed(2)} s physiques par seconde de film`);
  }
  assert.ok(C.speed(0.3) > 1e5, 'la croissance est un accéléré');
});

test('le plan de la saison est ordonné et tient dans la boucle', () => {
  const order = ['queen', 'comb', 'strip', 'peak', 'decline', 'wet', 'frost', 'fall', 'spring'];
  for (let i = 1; i < order.length; i++) assert.ok(P[order[i]] >= P[order[i - 1]], `${order[i - 1]} → ${order[i]}`);
  P.bells.forEach((b, k) => {
    assert.ok(b.s0 < b.s1 && b.s1 <= P.peak + 1e-9, `cloche ${k}`);
    if (k) assert.ok(b.s0 >= P.bells[k - 1].s0, `cloche ${k} avant la précédente`);
  });
  // le temps fort tombe pendant la construction de la cloche 4, ni au début ni à la fin
  const b4 = P.bells[4], f = (P.strip - b4.s0) / (b4.s1 - b4.s0);
  assert.ok(f > 0.25 && f < 0.75, `temps fort à ${f.toFixed(2)} de la cloche 4`);
});

test('la colonie : vide aux deux bouts, une seule montée et une seule descente', () => {
  assert.equal(colony(C.s(0), P), 0);
  assert.equal(colony(C.s(0.99), P), 0);
  let rising = true, prev = 0;
  for (let i = 0; i <= 2000; i++) {
    const c = colony(C.s(i / 2000), P);
    if (rising && c < prev - 1e-9) rising = false;
    else if (!rising) assert.ok(c <= prev + 1e-9, `la colonie repart à u = ${i / 2000}`);
    prev = c;
  }
});

test('la caméra du film : continue, raccord exact, moins de 25°/s', () => {
  for (const seed of ['a1', 'b2', 'c3', 'd4']) {
    const R = generate(seed), L = cameraScale(C, P);
    const pose = (u) => filmCamera(R.camera, R.decor.yBeam, L(u));
    const a = pose(0), b = pose(1 - 1e-9);
    for (const k of [0, 1, 2]) { assert.ok(Math.abs(a.pos[k] - b.pos[k]) < 1e-4, `${seed} : raccord`); }
    const n = R.loop.duration * 120;
    let prevDir = null, maxDeg = 0, maxJump = 0, prevPos = null;
    for (let i = 0; i <= n; i++) {
      const p = pose(i / n), d = p.target.map((x, k) => x - p.pos[k]), l = Math.hypot(...d), dir = d.map((x) => x / l);
      if (prevDir) {
        const ang = Math.acos(Math.min(1, dir.reduce((s, x, k) => s + x * prevDir[k], 0))) * 180 / Math.PI * 120;
        maxDeg = Math.max(maxDeg, ang);
        maxJump = Math.max(maxJump, Math.hypot(...p.pos.map((x, k) => x - prevPos[k])) / l);
      }
      prevDir = dir; prevPos = p.pos;
    }
    assert.ok(maxDeg < 25, `${seed} : ${maxDeg.toFixed(1)}°/s`);
    assert.ok(maxJump < 0.05, `${seed} : saut de ${(maxJump * 100).toFixed(1)} % de la distance en une image`);
  }
});

test('les guêpes : aucune au raccord, la reine au printemps, des ouvrières en été', () => {
  const R = generate('a1');
  assert.equal(waspsAt(0, C, P, R.nest.spec).filter(Boolean).length, 0);
  assert.equal(waspsAt(0.999, C, P, R.nest.spec).filter(Boolean).length, 0);
  assert.ok(waspsAt(FILM.queen + 0.01, C, P, R.nest.spec)[0], 'la reine');
  assert.ok(waspsAt(0.55, C, P, R.nest.spec).filter(Boolean).length > 20, 'la colonie');
  for (const w of waspsAt(0.5, C, P, R.nest.spec).filter(Boolean)) {
    assert.ok(w.p.every(Number.isFinite) && w.q.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...w.q) - 1) < 1e-6, 'quaternion unitaire');
  }
  assert.ok(T_SEASON > 1e7);
});
