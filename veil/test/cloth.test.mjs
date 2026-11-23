// Invariants de la simulation du voile et du raccord de la boucle, sur une
// grille réduite (25 × 25 : mêmes lois, dix fois plus vite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, RC, SELF, makeCloth } from '../src/gen/cloth.js';
import { buildForm, plinthSDF, drawForm } from '../src/gen/forms.js';
import { QB } from '../src/gen/quant.js';
import { buildTimeline, locate } from '../src/timeline.js';
import { generate } from '../src/recipe.js';
import { createRng } from '../../shared/rng.js';

const n = 25, L = 1.0, fabric = 'mousseline';
const plinth = { kind: 'die', height: 1.0, half: 0.3 };
const formSpec = drawForm('bust', createRng('test:bust'));
const form = buildForm(formSpec);
const wind = { dir: [-Math.sin(0.4), -0.05, -Math.cos(0.4)], speed: 2, breath: 2.2, phase: 0 };
const Td = { pre: 0.35, lower: 3, settle: 3 }, Tr = { tug: 0.45, lift: 2.3, hang: 1.8 };

const hang = simulate({ mode: 'hang', n, L, fabric, seed: 't', rot: 0.4, T: { total: 3.5 }, floorY: -10 });
let lowest = 0;
for (let k = 0; k < hang.N; k++) lowest = Math.min(lowest, hang.final[k * 3 + 1]);
const yH = Math.max(form.top, form.box[4] - 0.04) + RC - lowest + 0.08, y1 = form.top + RC;
const H = hang.final.slice();
for (let k = 0; k < hang.N; k++) H[k * 3 + 1] += yH;
const desc = simulate({ mode: 'desc', n, L, fabric, start: H, form: formSpec, plinth, yH, y1, T: Td, wind, floorY: -1 });
const rise = simulate({ mode: 'rise', n, L, fabric, start: desc.final, startVel: desc.vel, target: H, form: formSpec, plinth, y0: y1, yH, T: Tr, wind, windT0: 6.35, floorY: -1 });
const frameOf = (S, f) => S.frames.subarray(f * S.N * 3, (f + 1) * S.N * 3);

test('raccords exacts : la descente part de H, la montée finit sur H et part de la fin de la descente', () => {
  let e0 = 0, e1 = 0, e2 = 0;
  const d0 = frameOf(desc, 0), r0 = frameOf(rise, 0), rN = frameOf(rise, rise.count - 1);
  for (let k = 0; k < H.length; k++) {
    e0 = Math.max(e0, Math.abs(d0[k] - H[k]));
    e1 = Math.max(e1, Math.abs(rN[k] - H[k]));
    e2 = Math.max(e2, Math.abs(r0[k] - desc.final[k]));
  }
  assert.ok(e0 < 1e-6, `départ de la descente : ${e0}`);
  assert.ok(e1 < 1e-6, `fin de la montée : ${e1}`);
  assert.ok(e2 < 1e-6, `départ de la montée : ${e2}`);
});

test('la pendaison H passe au-dessus de la forme (le changement de forme est invisible)', () => {
  let m = Infinity;
  for (let k = 0; k < hang.N; k++) m = Math.min(m, form(H[k * 3], H[k * 3 + 1], H[k * 3 + 2]));
  assert.ok(m > 0.025, `marge ${m.toFixed(3)} m`); // (aucun contact pendant le changement de forme)
});

test('la bague se pose exactement sur le sommet de la forme, à la fin de la descente', () => {
  const c = makeCloth(n, L, fabric).center;
  const y = desc.final[c * 3 + 1];
  assert.ok(Math.abs(y - y1) < 1e-6);
  // et pas avant : au début de la descente, elle est en haut
  assert.ok(frameOf(desc, 0)[c * 3 + 1] > y1 + 0.5);
});

test('le voile ne traverse ni le socle ni le sol, à aucune image', () => {
  const P = plinthSDF(plinth);
  let worst = 0;
  for (const S of [desc, rise]) for (let f = 0; f < S.count; f++) {
    const X = frameOf(S, f);
    for (let k = 0; k < S.N; k++) {
      const d = P(X[k * 3], X[k * 3 + 1], X[k * 3 + 2]);
      worst = Math.min(worst, d);
      assert.ok(X[k * 3 + 1] > -1, 'sous le sol');
    }
  }
  assert.ok(worst > -0.002, `pénétration du socle : ${(worst * 1000).toFixed(2)} mm`);
});

test('le voile ne se traverse pas lui-même (particules non voisines ≥ 0,4 rayon)', () => {
  const cl = makeCloth(n, L, fabric), rs = cl.h * SELF;
  let worst = Infinity;
  for (const S of [desc, rise]) for (let f = 0; f < S.count; f += 3) {
    const X = frameOf(S, f);
    for (let a = 0; a < S.N; a++) for (let b = a + 1; b < S.N; b++) {
      if (Math.abs((a % n) - (b % n)) <= 2 && Math.abs(((a / n) | 0) - ((b / n) | 0)) <= 2) continue;
      const d = Math.hypot(X[a * 3] - X[b * 3], X[a * 3 + 1] - X[b * 3 + 1], X[a * 3 + 2] - X[b * 3 + 2]);
      if (d < worst) worst = d;
    }
  }
  assert.ok(worst > rs * 0.4, `${(worst * 1000).toFixed(1)} mm < ${(rs * 400).toFixed(1)} mm`);
});

test('l’étoffe s’étire peu : 99 % des fils à moins de 8 %, aucun au-delà de 35 %', () => {
  const cl = makeCloth(n, L, fabric);
  let worst = 0;
  const all = [];
  for (const S of [desc, rise]) for (let f = 0; f < S.count; f += 4) {
    const X = frameOf(S, f);
    for (let c = 0; c < cl.nc; c++) {
      if (cl.kind[c]) continue;
      const a = cl.ca[c] * 3, b = cl.cb[c] * 3;
      const e = Math.hypot(X[a] - X[b], X[a + 1] - X[b + 1], X[a + 2] - X[b + 2]) / cl.rest[c] - 1;
      all.push(e); worst = Math.max(worst, e);
    }
  }
  all.sort((a, b) => a - b);
  const p99 = all[Math.floor(all.length * 0.99)];
  assert.ok(p99 < 0.08, `centile 99 : ${(p99 * 100).toFixed(1)} %`);
  assert.ok(worst < 0.35, `étirement maximal ${(worst * 100).toFixed(1)} %`);
});

test('le voile reste dans la boîte de quantification', () => {
  for (const S of [desc, rise]) for (let i = 0; i < S.frames.length; i++) {
    const c = i % 3;
    assert.ok(S.frames[i] > QB.lo[c] && S.frames[i] < QB.hi[c]);
  }
});

test('la vitesse est continue au raccord descente → montée (vent compris)', () => {
  // accélération moyenne (différence seconde par image) au raccord, comparée
  // à celle des images voisines : le raccord ne doit pas se distinguer
  const acc = (a, b, c) => { let m = 0; for (let k = 0; k < b.length; k++) m += Math.abs(c[k] - 2 * b[k] + a[k]); return m / b.length; };
  const seam = acc(frameOf(desc, desc.count - 2), desc.final, frameOf(rise, 1));
  let around = 0;
  for (const f of [desc.count - 4, desc.count - 3]) around = Math.max(around, acc(frameOf(desc, f - 1), frameOf(desc, f), frameOf(desc, f + 1)));
  for (const f of [2, 3]) around = Math.max(around, acc(frameOf(rise, f - 1), frameOf(rise, f), frameOf(rise, f + 1)));
  assert.ok(seam < around * 1.5 + 2e-4, `raccord ${(seam * 1000).toFixed(2)} mm/image² contre ${(around * 1000).toFixed(2)} autour`);
});

test('le programme du film couvre la boucle, sans trou ni chevauchement', () => {
  for (const s of ['a1', 'b2', 'c3']) {
    const R = generate(s), TL = buildTimeline(R);
    // chaque instant appartient à exactement un morceau (aucun repli)
    for (let i = 0; i <= 2000; i++) {
      const tf = (i / 2000) * TL.total;
      const hits = TL.segs.filter((s) => { const l = (((tf % TL.total) - s.t0) % TL.total + TL.total) % TL.total; return l < s.dur; });
      assert.equal(hits.length, 1, `${s} : ${hits.length} morceaux à t = ${tf}`);
      const { seg, local } = locate(TL, tf);
      assert.ok(local >= 0 && local < seg.dur);
    }
    // la fin de la boucle est la fin de la descente 0, juste avant la pose
    const e = locate(TL, TL.total - 1e-6);
    assert.equal(e.seg.kind, 'desc'); assert.equal(e.seg.k, 0);
    assert.ok(Math.abs(e.local - (R.timing.desc.pre + R.timing.desc.lower)) < 1e-5);
    // u = 0 : la bague vient de se poser sur la première forme
    const z = locate(TL, 0);
    assert.equal(z.seg.kind, 'desc'); assert.equal(z.seg.k, 0);
    assert.ok(Math.abs(z.local - (R.timing.desc.pre + R.timing.desc.lower)) < 1e-9);
  }
});
