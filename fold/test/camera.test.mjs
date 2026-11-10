// La caméra du film : aucun à-coup (accélération bornée à chaque image, à
// 120 i/s), jamais dans la cloche, la caisse, le pot ni sous la table.
// (c2p3j5 : un garde-fou appliqué par paliers faisait sauter la caméra.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.self = {};
const { buildScene } = await import('../src/gen/worker.js');
const { generate } = await import('../src/recipe.js');
const { buildTimeMap } = await import('../src/physio.js');
const { buildCameraPath } = await import('../src/camera.js');
const { containerShape } = await import('../src/container.js');
const { cameraGuard } = await import('../src/scene/guard.js');

for (const seed of ['c2p3j5', 'whr8od', 'c1']) {
  test(`caméra sans à-coup ni intrusion (${seed})`, () => {
    const R = generate(seed);
    const o = buildScene({ seed: R.seed, plant: R.plant, container: R.container, mulch: R.decor.mulch, events: R.events, spacing: R.loop.spacing, view: { az: R.camera.az, el: R.camera.el, close: R.camera.close, wide: R.camera.wide, fov: R.camera.fov }, duration: R.loop.duration, rot: R.camera.rot });
    const S = containerShape(R.container, o.H, o.E), guard = cameraGuard(S);
    const tm = buildTimeMap({ P: o.plan.P, T: R.loop.duration, windows: o.plan.windows });
    const at = buildCameraPath({ plan: o.plan, tm, cam: R.camera, guard });
    const N = Math.round(R.loop.duration * 120);
    let prev = at(0), pv = null, peak = 0;
    for (let i = 1; i <= N; i++) {
      const c = at(i / N);
      assert.ok(guard(c.pos), `${seed} : caméra dans la monture à t = ${(i / 120).toFixed(2)} s`);
      const v = c.pos.map((x, k) => (x - prev.pos[k]) * 120);
      if (pv) peak = Math.max(peak, Math.hypot(...v.map((x, k) => (x - pv[k]) * 120)));
      pv = v; prev = c;
    }
    assert.ok(peak < 40, `${seed} : accélération de ${peak.toFixed(0)} u/s²`);
  });
}
