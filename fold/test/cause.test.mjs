// Cause et effet : la goutte touche la plante à l'instant exact du choc (sur
// la vraie surface), jamais avant ; la tête du marteau touche le pot à
// l'instant du coup, jamais avant ; les éclaboussures ne traversent rien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growPlant, leafletPoint } from '../src/gen/plant.js';
import { containerShape, profileDistance, tapProfile, outerAt, floorRadius } from '../src/container.js';
import { planLoop, surfacePoints } from '../src/plan.js';
import { createPoser } from '../src/pose.js';
import { dropCenterY, hammerAngle, G } from '../src/physio.js';
import { waterAt } from '../src/effects.js';

const cases = [['bush', 'terracotta', 'burette', 'c1'], ['bijuga', 'cloche', 'roof', 'c2'], ['flowering', 'ward', 'roof', 'c3'], ['oxalis', 'terracotta', 'burette', 'whr8od'], ['bush', 'cachepot', 'burette', 'h2'], ['oxalis', 'bonsai', 'burette', 'h3']];
const built = cases.map(([kind, cont, src, seed]) => {
  const plant = growPlant({ kind, seed });
  const E = plant.leaves.reduce((m, L) => Math.max(m, Math.hypot(L.tip[0], L.tip[2]) + 0.5), 0.6);
  const S = containerShape(cont, plant.H, E);
  const plan = planLoop(plant, S, { seed, events: [{ cause: 'drop', source: src }, { cause: 'tap' }], spacing: 560, view: { az: 0.3, el: 0.1, close: 1.3, wide: 5, fov: 32 } });
  return { plant, S, plan, kind };
});

test('la goutte touche la surface de la plante au contact, et pas avant', () => {
  for (const { plant, plan, kind } of built) {
    const D = plan.events.find((e) => e.cause === 'drop');
    if (!D) continue;
    // surface plus fine que celle du plan
    const pts = surfacePoints(plant, createPoser(plant), { du: 48, dv: 20 }); // (le plan en prend 28 × 12)
    const gap = (tau) => {
      const y = dropCenterY(tau, D);
      let g = Infinity;
      for (const [p] of pts) g = Math.min(g, Math.hypot(p[0] - D.axis[0], p[1] - y, p[2] - D.axis[1]) - D.r);
      return g;
    };
    assert.ok(Math.abs(gap(D.tc)) < 6e-4, `${kind} : écart au contact ${gap(D.tc)}`);
    for (const dt of [0.002, 0.01, 0.05, D.fall * 0.9]) assert.ok(gap(D.tc - dt) > 0, `${kind} : la goutte touche ${dt} s trop tôt`);
    // chute libre depuis le repos
    const v = (dropCenterY(D.tc - 1e-4, D) - dropCenterY(D.tc, D)) / 1e-4;
    assert.ok(Math.abs(v - G * 1e-4 / 2) < 1e-3 || v < G * D.fall * 1.01);
  }
});

test('le marteau touche le pot (ou le socle) au coup, et pas avant', () => {
  for (const { S, plan, kind } of built) {
    for (const E of plan.events.filter((e) => e.cause === 'tap')) {
      const H = E.hammer, prof = S.plinth || S.case ? tapProfile(S) : outerAt(S, E.az);
      const gap = (tau) => { const a = hammerAngle(tau, H); const rho = H.pivot[0] + H.arm * Math.sin(a), y = H.pivot[1] - H.arm * Math.cos(a); return profileDistance(prof, rho, y) - H.rh; };
      assert.ok(Math.abs(gap(E.tc)) < 1e-6, `${kind} : écart au coup ${gap(E.tc)}`);
      for (const dt of [0.001, 0.02, 0.1, H.strike * 0.9]) assert.ok(gap(E.tc - dt) > 0, `${kind} : touche trop tôt`);
      for (const dt of [0.001, 0.05, 0.5, 3]) assert.ok(gap(E.tc + dt) >= -1e-9, `${kind} : traverse le pot après le coup`);
      // le bras (une tige de 1,1 cm) ne frôle jamais le pot, à aucun instant
      for (let tau = E.tc - H.strike - 0.1; tau < E.tc + 2; tau += 0.005) {
        const a = hammerAngle(tau, H), hx = H.pivot[0] + H.arm * Math.sin(a), hy = H.pivot[1] - H.arm * Math.cos(a);
        for (let j = 0; j <= 20; j++) {
          const t = (j / 20) * (1 - (H.rh * 0.9) / H.arm);
          const d = profileDistance(prof, H.pivot[0] + (hx - H.pivot[0]) * t, H.pivot[1] + (hy - H.pivot[1]) * t);
          assert.ok(d > 0.011, `${kind} : le bras du marteau traverse le pot (${d.toFixed(4)})`);
        }
      }
    }
  }
});

test('les éclaboussures volent sans rien traverser et se posent', () => {
  for (const { plant, plan, S } of built) {
    const pts = surfacePoints(plant, createPoser(plant), { du: 12, dv: 4 }).map(([p]) => p);
    for (const E of plan.events.filter((e) => e.cause === 'drop')) for (const s of E.splash) {
      for (let t = 0.015; t < s.t; t += 0.004) {
        const p = [s.p0[0] + s.v[0] * t, s.p0[1] + s.v[1] * t - 0.5 * G * t * t, s.p0[2] + s.v[2] * t];
        for (const q of pts) assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > s.r * 0.9, 'une perle traverse la plante');
      }
      assert.ok(['soil', 'rim', 'table'].includes(s.kind));
      assert.ok(s.land[1] >= S.tableY - 1e-6);
    }
  }
});

test("l'eau est continue : aucune goutte n'apparaît ni ne disparaît d'un coup", () => {
  for (const { plan } of built) {
    const D = plan.events.find((e) => e.cause === 'drop');
    if (!D) continue;
    let prev = null;
    for (let tau = D.tc - D.fall - 1; tau < D.tc + 1; tau += 0.0005) {
      const w = waterAt(tau, plan).map((x) => ({ p: [...x.p], s: [...x.s] }));
      if (prev) for (let i = 0; i < w.length; i++) {
        const ds = Math.abs(w[i].s[0] - prev[i].s[0]);
        assert.ok(ds < 0.004, `rayon qui saute de ${ds} à τ − τc = ${(tau - D.tc).toFixed(4)}`);
      }
      prev = w;
    }
  }
});

test('les appareils sont posés à côté du pot, jamais dedans ni l\'un sur l\'autre', () => {
  for (const { S, plan, kind } of built) {
    const R0 = floorRadius(S);
    const T = plan.events.find((e) => e.cause === 'tap');
    if (T && !S.case) assert.ok(T.hammer.pivot[0] >= R0 + 0.04, `${kind} : le socle du marteau entre dans la soucoupe`);
    if (plan.burette) {
      const st = plan.burette.stand;
      assert.ok(Math.hypot(st[0], st[2]) - 0.2 + 0.05 >= R0 + 0.05 - 1e-9, `${kind} : le socle du statif entre dans la soucoupe`);
      if (T) {
        const post = [T.dir[0] * (T.hammer.pivot[0] + 0.16), T.dir[2] * (T.hammer.pivot[0] + 0.16)];
        assert.ok(Math.hypot(st[0] - post[0], st[2] - post[1]) > 0.45, `${kind} : le statif et le marteau se chevauchent`);
      }
    }
  }
});
