// Continuité de la caméra d'une graine : node fold/tools/cam-check.mjs <graine>
globalThis.self = {};
const { buildScene } = await import('../src/gen/worker.js');
const { generate } = await import('../src/recipe.js');
const { buildTimeMap } = await import('../src/physio.js');
const { buildCameraPath } = await import('../src/camera.js');
const { containerShape } = await import('../src/container.js');
const seed = process.argv[2] ?? 'c2p3j5';
const R = generate(seed);
const o = buildScene({ seed: R.seed, plant: R.plant, container: R.container, mulch: R.decor.mulch, events: R.events, spacing: R.loop.spacing, view: { az: R.camera.az, el: R.camera.el, close: R.camera.close, wide: R.camera.wide, fov: R.camera.fov }, duration: R.loop.duration, rot: R.camera.rot });
const S = containerShape(R.container, o.H, o.E);
const tm = buildTimeMap({ P: o.plan.P, T: R.loop.duration, windows: o.plan.windows });
const guard = (p) => p[1] > S.tableY + 0.12 && !(S.inside && S.inside(p[0], p[1], p[2])) && Math.hypot(p[0], p[2]) < 10.5 && !(Math.hypot(p[0], p[2]) < (S.bell ? S.bell.R + 0.12 : S.case ? Math.hypot(S.case.W, S.case.D) + 0.1 : S.rimR + 0.1) && p[1] < (S.bell ? S.bell.top + 0.2 : S.case ? S.case.eave + S.case.W * 0.7 : S.rimY + 0.05));
const at = buildCameraPath({ plan: o.plan, tm, cam: R.camera, guard });
console.log(seed, R.mood, R.leaf.family, R.container, 'T', R.loop.duration);
const N = R.loop.duration * 120; let prev = at(0), pv = null, worst = [];
for (let i = 1; i <= N; i++) {
  const c = at(i / N), v = c.pos.map((x, k) => (x - prev.pos[k]) * 120);
  if (pv) { const acc = Math.hypot(...v.map((x, k) => (x - pv[k]) * 120)); worst.push([acc, i / 120, c.dist.toFixed(3), Math.hypot(...v).toFixed(3)]); }
  pv = v; prev = c;
}
worst.sort((a, b) => b[0] - a[0]);
let out = 0; for (let i = 0; i <= N; i++) if (!guard(at(i / N).pos)) out++;
console.log('images où la caméra serait dans la cloche / sous la table :', out);
console.log('pires accélérations (u/s², t, dist, vitesse):', worst.slice(0, 8).map((w) => `${w[0].toFixed(0)}@${w[1].toFixed(2)}s d=${w[2]} v=${w[3]}`).join('  '));
