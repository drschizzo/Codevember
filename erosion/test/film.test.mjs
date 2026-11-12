// La chronologie et la caméra : raccord exact, phases monotones, la lame
// au contact de la surface de départ, caméra lente et continue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmState, U, PARK, BLADE_UP, EDGE, reliefK } from '../src/timeline.js';
import { buildCamera, SHOTS } from '../src/camera.js';
import { generate, specOf } from '../src/recipe.js';
import { TABLE, longProfile, crossProfile, FAMILIES } from '../src/gen/table.js';

const seeds = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].flatMap((s) => Object.keys(FAMILIES).map((f) => generate(s, { family: f })));

test('raccord : l’état du film à u → 1 est celui de u = 0', () => {
  for (const R of seeds) {
    const S = specOf(R), a = filmState(0, S), b = filmState(1 - 1e-9, S);
    // (à 0 : le relief de départ ; à 1 : le bac entier régalé — les deux sont b₀, sans eau)
    assert.equal(a.T, 0); assert.equal(a.water, 0); assert.equal(b.water, 0);
    assert.equal(a.screed, -2); assert.equal(b.screed, -1);
    assert.ok(Math.abs(a.gantryX - b.gantryX) < 1e-9 && Math.abs(a.bladeLift - b.bladeLift) < 1e-9);
    assert.equal(a.inflow, 0); assert.equal(b.inflow, 0); assert.equal(a.rain, 0);
  }
});

test('la lame balaie tout le bac en remontant, sans jamais revenir en arrière', () => {
  const S = specOf(seeds[0]);
  let prev = Infinity;
  for (let u = U.cut0; u < U.cut1; u += 0.0005) {
    const F = filmState(u, S);
    assert.ok(F.screed <= prev + 1e-12, `recul à u = ${u}`);
    assert.equal(F.bladeLift, 0);
    prev = F.screed;
  }
  assert.ok(filmState(U.cut0, S).screed >= TABLE.Lx);
  assert.ok(filmState(U.cut1 - 1e-6, S).screed <= 0.001 && EDGE < 0);
});

test('la lame touche la surface de départ : son bord bas est b₀ (écart nul), levée avant et après', () => {
  for (const R of seeds) {
    const S = specOf(R);
    for (let u = U.cut0; u < U.cut1; u += 0.002) {
      const F = filmState(u, S), x = Math.min(TABLE.Lx, Math.max(0, F.gantryX));
      const blade = longProfile(S.form, x) + F.bladeLift;
      assert.ok(Math.abs(blade - longProfile(S.form, x)) < 1e-12);
    }
    assert.ok(filmState(U.roll0 + 0.01, S).bladeLift > 0.9 * BLADE_UP, 'levée pendant le retour');
    assert.equal(filmState(0.3, S).gantryX, PARK);
  }
});

test('phases monotones : le séchage ne revient jamais en arrière, l’eau ne revient pas après la vidange', () => {
  const S = specOf(seeds[1]);
  let d = 0;
  for (let u = 0; u < 1; u += 0.001) {
    const F = filmState(u, S);
    if (u < U.cut0) { assert.ok(F.dry >= d - 1e-12, `séchage qui recule à ${u}`); d = F.dry; }
    if (u > U.sim1 + 0.03) assert.equal(F.water, 0);
  }
});

test('fin de l’expérience : le relief s’arrête en douceur, l’eau s’infiltre avant de disparaître', () => {
  // relief : monotone, part et arrive juste, vitesse continue, nulle à la fin
  let prev = 0, prevV = 1;
  for (let k = 0.001; k <= 1; k += 0.001) {
    const v = reliefK(k), sp = (v - reliefK(k - 0.001)) / 0.001;
    assert.ok(v >= prev - 1e-12, `recul à ${k}`);
    assert.ok(Math.abs(sp - prevV) < 0.05, `saut de vitesse à ${k.toFixed(3)} : ${prevV.toFixed(3)} → ${sp.toFixed(3)}`);
    prev = v; prevV = sp;
  }
  assert.ok(Math.abs(reliefK(1) - 1) < 1e-12 && (reliefK(1) - reliefK(0.9999)) / 0.0001 < 0.01);
  // eau : l'infiltration est complète quand l'eau cesse d'être dessinée
  const S = specOf(seeds[0]);
  let last = null;
  for (let u = U.sim1 - 0.1; u < U.sim1 + 0.05; u += 0.0005) {
    const F = filmState(u, S);
    if (last && last.water === 1 && F.water === 0) assert.ok(last.drain > 0.99, `l'eau disparaît à ${(last.drain * 100).toFixed(0)} % d'infiltration`);
    if (last) assert.ok(F.drain >= last.drain - 1e-12);
    last = F;
  }
});

test('découpage : six plans de plus de 4 s, un raccord par plan', () => {
  for (const R of seeds) {
    const S = specOf(R), pose = buildCamera(R, S), dur = R.loop.duration;
    for (let k = 0; k < SHOTS.length; k++) {
      const len = ((SHOTS[(k + 1) % SHOTS.length].u0 - SHOTS[k].u0 + 1) % 1) * dur;
      assert.ok(len > 4, `plan ${SHOTS[k].kind} de ${len.toFixed(1)} s`);
    }
    let cuts = 0, prev = pose(0).shot;
    for (let i = 1; i <= 2000; i++) { const s2 = pose(i / 2000).shot; if (s2 !== prev) cuts++; prev = s2; }
    assert.equal(cuts, SHOTS.length);
  }
});

test('caméra : périodique, pointe < 25 °/s, accélération bornée dans chaque plan (120 i/s)', () => {
  for (const R of seeds) {
    const S = specOf(R), pose = buildCamera(R, S), dur = R.loop.duration;
    const a = pose(0), b = pose(1 - 1e-12);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(a.position[k] - b.position[k]) < 1e-6);
    const dirAt = (u) => { const p = pose(u), d = p.target.map((v, i) => v - p.position[i]), n = Math.hypot(...d); return d.map((v) => v / n); };
    const n = Math.round(dur * 120), dt = 1 / 120;
    let peak = 0, prevV = null, peakAcc = 0;
    for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n;
      // (un raccord est un saut voulu : on ne mesure qu'à l'intérieur d'un plan)
      if (pose(u0).shot !== pose(u1).shot || (i > 0 && pose((i - 1) / n).shot !== pose(u0).shot)) { prevV = null; continue; }
      const d0 = dirAt(u0), d1 = dirAt(u1);
      const ang = Math.acos(Math.min(1, d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2])) * 180 / Math.PI / dt;
      peak = Math.max(peak, ang);
      const p0 = pose(u0).position, p1 = pose(u1).position, v = p1.map((x, k) => (x - p0[k]) / dt);
      if (prevV) peakAcc = Math.max(peakAcc, Math.hypot(...v.map((x, k) => (x - prevV[k]) / dt)));
      prevV = v;
    }
    assert.ok(peak < 25, `${R.seed}/${R.family} : ${peak.toFixed(1)} °/s`);
    assert.ok(peakAcc < 1.5, `${R.seed}/${R.family} : ${peakAcc.toFixed(2)} m/s²`);
  }
});

test('caméra : au-dessus des parois quand elle survole le bac, ou dans le bac à distance du sable et des parois', () => {
  for (const R of seeds) {
    const S = specOf(R), pose = buildCamera(R, S);
    for (let u = 0; u < 1; u += 0.002) {
      const P = pose(u), p = P.position;
      const inside = Math.abs(p[0]) < TABLE.Lx / 2 + 0.1 && Math.abs(p[2]) < TABLE.Ly / 2 + 0.1;
      if (inside && P.kind === 'ras') {
        // le plan au ras du sable : dans le bac, loin des parois, au-dessus du sable de départ et du lac
        const x = p[0] + TABLE.Lx / 2, y = p[2] + TABLE.Ly / 2;
        assert.ok(x > 0.05 && x < TABLE.Lx - 0.04 && y > 0.04 && y < TABLE.Ly - 0.04, `${R.seed}/${R.family} u=${u.toFixed(3)} : trop près d'une paroi`);
        const lake = Math.max(...S.base.map((b) => b[1]));
        assert.ok(p[1] > longProfile(S.form, x) + crossProfile(S.form, y) + 0.025 && p[1] > lake + 0.02, `${R.seed}/${R.family} u=${u.toFixed(3)} : caméra dans le sable`);
        // (et la poutre du portique, garée, est loin)
        assert.ok(filmState(u, S).gantryX < 0, 'le portique roule pendant le plan au ras du sable');
      } else if (inside) assert.ok(p[1] > 0.26, `${R.seed}/${R.family} u=${u.toFixed(3)} : caméra à ${p[1].toFixed(3)} m au-dessus du bac`);
      else assert.ok(p[1] > 0.12, `${R.seed}/${R.family} u=${u.toFixed(3)} : caméra trop basse hors du bac`);
    }
  }
});

test('caméra : jamais à moins de 12 cm d’un montant, d’un rail ou de la poutre du portique', () => {
  const HX = TABLE.Lx / 2, HZ = TABLE.Ly / 2;
  for (const R of seeds) {
    const S = specOf(R), pose = buildCamera(R, S);
    for (let u = 0; u < 1; u += 0.002) {
      const p = pose(u).position, F = filmState(u, S);
      // montants du simulateur de pluie (si la famille en a), de 0,2 à 1,44 m
      if (S.rain) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const d = Math.hypot(p[0] - sx * (HX + 0.11), p[2] - sz * (HZ + 0.1));
        if (p[1] < 1.5) assert.ok(d > 0.12, `${R.seed}/${R.family} u=${u.toFixed(3)} : montant à ${d.toFixed(3)} m`);
      }
      // rails ronds (Y 0,225, Z ±(HZ + 0,055))
      for (const s of [-1, 1]) {
        if (Math.abs(p[0]) < HX + 0.1) assert.ok(Math.hypot(p[1] - 0.225, p[2] - s * (HZ + 0.055)) > 0.12, `${R.seed}/${R.family} u=${u.toFixed(3)} : rail`);
      }
      // poutre du portique (Y 0,315, X = position du portique)
      const gx = F.gantryX - HX;
      if (Math.abs(p[2]) < HZ + 0.1) assert.ok(Math.hypot(p[0] - gx, p[1] - 0.315) > 0.12, `${R.seed}/${R.family} u=${u.toFixed(3)} : poutre du portique`);
    }
  }
});
