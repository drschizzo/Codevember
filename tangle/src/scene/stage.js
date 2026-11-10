// La scène : lumières (créées une fois, dans un ordre fixe, au premier niveau),
// décor, banc, corde. setRecipe demande la simulation et la géométrie du banc
// aux workers ; update(t) place tout à l'instant t du film.
import * as THREE from 'three/webgpu';
import { createBench, Y0 } from './bench.js';
import { createCord } from './cord.js';
import { createDecor } from './decor.js';
import { S as SCALE } from '../gen/bench.js';
import { makePlan, makeWarp } from '../plan.js';
import { CORDS } from '../recipe.js';
import { cameraPath } from '../camera.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
const TARGET = [0, 2.0, 0]; // (le milieu de la corde, à peu près)

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const spot = new THREE.SpotLight(0xffffff, 0, 0, 0.5, 0.7, 2);
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  for (const l of [spot, sun]) {
    l.castShadow = true;
    l.shadow.bias = -0.0002;
    l.shadow.normalBias = 0.02;
    l.shadow.radius = 4;
    l.shadow.mapSize.set(2048, 2048);
  }
  spot.shadow.camera.near = 2; spot.shadow.camera.far = 30;
  const sc = sun.shadow.camera;
  sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 0.5; sc.far = 40;
  sc.updateProjectionMatrix();
  const place = new THREE.HemisphereLight(0xffffff, 0x444444, 0);
  const rims = [new THREE.SpotLight(0xffffff, 0, 0, 0.6, 0.9, 2), new THREE.SpotLight(0xffffff, 0, 0, 0.6, 0.9, 2)];
  if (lite) rims[1].visible = false;
  for (const l of [spot, sun, place, ...rims]) { scene.add(l); if (l.target) scene.add(l.target); }

  const decor = createDecor(scene);
  const bench = createBench(scene);
  const cordRoot = new THREE.Group();
  cordRoot.scale.setScalar(SCALE);
  cordRoot.position.set(0, Y0, 0);
  scene.add(cordRoot);
  const cord = createCord(cordRoot);

  let R = null, sim = null, plan = null, warp = null, cam = null, pending = 0, total = 2, version = 0;

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    pending = 2; total = 2;
    const sunKey = R.light.key.kind === 'sun';
    spot.visible = !sunKey; sun.visible = sunKey;
    decor.setRecipe(R, null, [sunKey ? sun : spot, place]);
    bench.setRecipe(R, gen).then(() => { if (v === version) pending--; }, (e) => { console.error(e); });
    gen.request({ family: R.family, cycles: R.cycles, sim: R.sim }, 'sim').then((s) => {
      if (v !== version) return;
      sim = s;
      plan = makePlan(R);
      warp = makeWarp(sim.P, sim.bumps);
      R.loop.duration = Math.round(sim.T * 100) / 100;
      cord.setSim(sim, R, CORDS);
      cam = cameraPath(sim, R, { S: SCALE, Y0 });
      pending--;
    }, (e) => { console.error(e); });
  }
  function relook() { if (sim) cord.setLook(R, CORDS); }
  function recam() { if (sim) cam = cameraPath(sim, R, { S: SCALE, Y0 }); }

  const place3 = (l, az, el, r, target = TARGET) => {
    l.position.set(target[0] + Math.sin(az) * Math.cos(el) * r, target[1] + Math.sin(el) * r, target[2] + Math.cos(az) * Math.cos(el) * r);
    l.target.position.set(...target);
  };

  // u : phase [0, 1) ; renvoie l'état (pour les outils de mise au point)
  function update(u) {
    if (!R || pending) return null;
    const t = u * sim.T;
    const L = R.light;
    // lampe principale
    if (L.key.kind === 'sun') {
      place3(sun, L.key.az, L.key.el, 14);
      sun.color.set(L.key.color); sun.intensity = L.key.intensity;
    } else {
      place3(spot, L.key.az, L.key.el, L.key.dist ?? 8);
      spot.color.set(L.key.color); spot.intensity = L.key.intensity; spot.angle = L.key.angle; spot.penumbra = L.key.penumbra;
      spot.shadow.focus = 0.6;
    }
    place.color.set(L.place.sky); place.groundColor.set(L.place.ground); place.intensity = L.place.i;
    rims.forEach((l, i) => { const r = L.rim[i]; place3(l, r.az, r.el, 7); l.color.set(r.color); l.intensity = r.intensity * (lite && i === 0 ? 1.3 : 1); });
    // la machine : mandrin et barre d'après le plan (temps physique), balancier et corde d'après la simulation
    const tau = warp.tauOf(t);
    const st = cord.update(t);
    bench.update({ theta: plan.theta(tau), bar: plan.bar(tau), flyY: st.flyY, flyPhi: st.flyPhi, N: plan.N });
    return { t, tau, st };
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    for (const l of [spot, sun]) if (l.shadow.mapSize.x !== s) { l.shadow.mapSize.set(s, s); l.shadow.map?.dispose(); l.shadow.map = null; }
  }

  return {
    setRecipe, update, relook, recam, setShadowQuality, syncFinishes: () => bench.syncFinishes(),
    group: bench.root, bench, cord, decor, spot, sun, place, rims,
    get sim() { return sim; }, get plan() { return plan; }, get warp() { return warp; }, get cam() { return cam; },
    ready: () => pending === 0,
    progress: () => (total ? 1 - pending / total : 1),
    resetHistory: () => cord.resetHistory(),
  };
}
