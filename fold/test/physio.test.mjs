// Le signal, les pulvinus, le temps physique, la boucle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growPlant } from '../src/gen/plant.js';
import { propagate, closeCurve, lifetime, buildTimeMap, SIGNAL } from '../src/physio.js';
import { containerShape } from '../src/container.js';
import { planLoop } from '../src/plan.js';
import { createPoser } from '../src/pose.js';
import { buildCameraPath } from '../src/camera.js';

test('le signal : arrivée croissante avec la distance, amplitude décroissante', () => {
  const P = growPlant({ kind: 'bush', seed: 'sig' });
  const { arr, amp } = propagate(P.graph, P.graph.root, 2.5);
  for (const [a, b] of P.graph.edges) {
    if (!Number.isFinite(arr[a]) || !Number.isFinite(arr[b])) continue;
    // (le long d'une arête, l'écart d'arrivée ne dépasse pas le temps de parcours)
    assert.ok(Math.abs(arr[a] - arr[b]) <= 1e-9 + Math.max(...SIGNAL.speed.map((v) => 1 / v)) * 10);
  }
  for (const L of P.leaves) {
    if (!Number.isFinite(arr[L.nodeS])) continue;
    assert.ok(arr[L.nodeS] > arr[L.nodeP] && amp[L.nodeS] < amp[L.nodeP]);
    let prev = arr[L.nodeS];
    for (const q of L.pinnae[0].pairs) { if (!Number.isFinite(arr[q.node])) break; assert.ok(arr[q.node] > prev); prev = arr[q.node]; }
  }
});

test('un pulvinus se ferme, tient, se rouvre, et revient exactement ouvert', () => {
  for (const lv of ['leaflet', 'pinna', 'petiole']) {
    assert.equal(closeCurve(lv, -1), 0);
    assert.ok(closeCurve(lv, 3) > 0.95, lv);
    assert.equal(closeCurve(lv, lifetime(lv) + 0.01), 0);
    // continuité
    for (let d = 0; d < lifetime(lv); d += 0.37) assert.ok(Math.abs(closeCurve(lv, d + 1e-4) - closeCurve(lv, d)) < 0.01);
  }
});

let cache = null;
function scene() {
  if (cache) return cache;
  const plant = growPlant({ kind: 'bush', seed: 'loop' });
  const E = plant.leaves.reduce((m, L) => Math.max(m, Math.hypot(L.tip[0], L.tip[2]) + 0.5), 0.6);
  const S = containerShape('terracotta', plant.H, E);
  const plan = planLoop(plant, S, { seed: 'loop', events: [{ cause: 'drop', source: 'burette' }, { cause: 'tap' }, { cause: 'drop', source: 'burette' }], spacing: 560, duration: 58, view: { az: 0, el: 0.1, close: 1.3, wide: 5, fov: 32 } });
  const tm = buildTimeMap({ P: plan.P, T: 58, windows: plan.windows });
  cache = { plant, S, plan, tm };
  return cache;
}

test('le temps : réel à la chute, caméra rapide AU contact (pas avant), accéléré ailleurs', () => {
  const { plan, tm } = scene();
  assert.equal(tm.tauAt(0), 0);
  assert.ok(Math.abs(tm.tauAt(1) - plan.P) < 1e-9);
  let prev = -1;
  for (let i = 0; i <= 4000; i++) { const t = tm.tauAt(i / 4000); assert.ok(t >= prev); prev = t; }
  const rate = (tau) => { // dτ/dt au voisinage de l'instant physique tau
    let lo = 0, hi = 1; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (tm.tauAt(m) < tau) lo = m; else hi = m; }
    return tm.speedAt(lo);
  };
  for (const E of plan.events) {
    assert.ok(Math.abs(rate(E.tc - 0.05) - 1) < 0.05, 'temps réel juste avant le contact');
    assert.ok(Math.abs(rate(E.tc + 0.06) - 1 / 8) < 0.02, 'caméra rapide juste après');
  }
  assert.ok(rate(plan.events[0].tc + 250) > 40, 'accéléré pendant la réouverture');
});

test('boucle parfaite : la pose de toute la plante à τ + P est celle à τ', () => {
  const { plant, plan } = scene();
  const ps = createPoser(plant, plan);
  for (const tau of [3, plan.events[0].tc + 1.3, plan.events[1].tc + 0.4, plan.P - 0.5]) {
    const a = ps.update(tau), A = [a.left.slice(), a.right.slice(), a.petiole.slice(), a.rachis.slice()];
    const b = ps.update(tau + plan.P);
    const B = [b.left, b.right, b.petiole, b.rachis];
    for (let k = 0; k < 4; k++) for (let i = 0; i < A[k].length; i++) assert.ok(Math.abs(A[k][i] - B[k][i]) < 1e-5);
  }
});

test('la caméra : périodique, lente, jamais dans le pot ni sous la table', () => {
  const { plan, tm, S } = scene();
  const at = buildCameraPath({ plan, tm, cam: { orbit: 0, sway: 0.03, fov: 32 } });
  const a = at(0), b = at(1 - 1e-9);
  assert.ok(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]) < 1e-5);
  let sum = 0; const N = 800; let p = at(0);
  for (let i = 1; i <= N; i++) {
    const c = at(i / N);
    const d1 = p.tgt.map((x, k) => x - p.pos[k]), d2 = c.tgt.map((x, k) => x - c.pos[k]);
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    sum += (Math.acos(Math.min(1, (d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) / l1 / l2)) * 180) / Math.PI;
    assert.ok(c.pos[1] > S.tableY + 0.1);
    p = c;
  }
  assert.ok(sum / tm.T < 30, `${(sum / tm.T).toFixed(1)} °/s`);
});

test('une boucle lisible : la goutte ferme toute la feuille touchée et elle seule ; le marteau ferme toute la plante', () => {
  for (const kind of ['bush', 'oxalis', 'biophytum']) {
    const plant = growPlant({ kind, seed: 'read' });
    const E0 = plant.leaves.reduce((m, L) => Math.max(m, Math.hypot(L.tip[0], L.tip[2]) + 0.5), 0.6);
    const S = containerShape('cloche', plant.H, E0);
    const plan = planLoop(plant, S, { seed: 'read', events: [{ cause: 'drop', source: 'roof' }, { cause: 'tap' }], spacing: 560, duration: 44, view: { az: 0, el: 0.1, close: 1.3, wide: 5, fov: 32 } });
    const ps = createPoser(plant, plan);
    const D = plan.events.find((e) => e.cause === 'drop'), Tp = plan.events.find((e) => e.cause === 'tap');
    const o = ps.update(D.tc + 30);
    ps.pairs.forEach((q, k) => {
      if (q.leaf === D.leaf) assert.ok(o.state[k] > 0.97, `${kind} : une foliole de la feuille touchée reste ouverte`);
      else assert.equal(o.state[k], 0, `${kind} : une autre feuille se ferme`);
    });
    const o2 = ps.update(Tp.tc + 30);
    for (let k = 0; k < o2.state.length; k++) assert.ok(o2.state[k] > 0.97, `${kind} : le marteau laisse une foliole ouverte`);
    // tout est rouvert avant le toucher suivant
    const o3 = ps.update(Tp.tc - 2);
    for (let k = 0; k < o3.state.length; k++) assert.ok(o3.state[k] < 0.02);
  }
});

test('la caméra ne s’emballe jamais : pointe < 25°/s, tour dans un seul sens', () => {
  const { plan, tm } = scene();
  const at = buildCameraPath({ plan, tm, cam: { sway: 0.02, fov: 32 } });
  const N = 2000; let p = at(0), peak = 0;
  for (let i = 1; i <= N; i++) {
    const c = at(i / N);
    const d1 = p.tgt.map((x, k) => x - p.pos[k]), d2 = c.tgt.map((x, k) => x - c.pos[k]);
    const a = (Math.acos(Math.min(1, (d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) / Math.hypot(...d1) / Math.hypot(...d2))) * 180) / Math.PI;
    peak = Math.max(peak, a / (tm.T / N));
    p = c;
  }
  assert.ok(peak < 25, `${peak.toFixed(1)} °/s`);
});
