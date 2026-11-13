// Le plateau : la table à érosion dans son lieu.
//
// - la simulation (scene/gpusim.js), lancée sous l'écran de chargement,
//   puis relue à chaque image selon la chronologie (timeline.js) ;
// - le sable et l'eau (scene/sand.js) ;
// - l'appareil (scene/apparatus.js) : bac, châssis, boîte d'alimentation,
//   vanne, portique et lame, rampe de pluie ;
// - les lumières de l'humeur, créées une fois, dans un ordre fixe, au premier
//   niveau de la scène (changer leur ordre recompilerait tous les matériaux).
import * as THREE from 'three/webgpu';
import { lights as tLights, float } from 'three/tsl';
import { createGpuSim } from './gpusim.js';
import { createSand } from './sand.js';
import { createApparatus } from './apparatus.js';
import { createRain } from './rain.js';
import { initialTerrain, TABLE } from '../gen/table.js';
import { specOf, kelvinToHex } from '../recipe.js';
import { filmState, reliefK } from '../timeline.js';
import { G } from './globals.js';

const SHADOW = { mobile: 2048, low: 2048, medium: 4096, high: 4096, ultra: 4096 };

export function createStage(scene, renderer, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const key = new THREE.SpotLight(0xffffff, 10, 0, 0.5, 0.7, 2);
  key.castShadow = true;
  key.shadow.bias = -0.00005;
  key.shadow.normalBias = 0.0015;
  key.shadow.radius = 3;
  key.shadow.mapSize.set(lite ? 2048 : 4096, lite ? 2048 : 4096);
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 12;
  const fill = new THREE.SpotLight(0xffffff, 1, 0, 1.0, 1, 2);
  const rim = new THREE.SpotLight(0xffffff, 1, 0, 0.8, 1, 2);
  if (lite) rim.visible = false;
  for (const l of [key, fill, rim]) { scene.add(l); scene.add(l.target); }

  // ── Sol du lieu (sous la table) ──
  const floorMat = new THREE.MeshStandardNodeMaterial({ color: 0x555555, roughness: 0.9 });
  floorMat.lightsNode = tLights([key, fill]);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64).rotateX(-Math.PI / 2), floorMat);
  floor.position.y = -0.82;
  floor.receiveShadow = true;
  scene.add(floor);

  // ── Simulation, sable, appareil ──
  const gs = createGpuSim(renderer, { lite });
  const sand = createSand(gs);
  sand.material.lightsNode = tLights([key, fill, rim]);
  scene.add(sand.mesh);
  sand.skirtMat.lightsNode = tLights([key, fill, rim]);
  scene.add(sand.skirt);
  const app = createApparatus(scene, { lite, lights: [key, fill, rim] });
  const rain = createRain(gs, { lite });
  rain.mesh.material.lightsNode = tLights([key, fill, rim]);
  scene.add(rain.mesh);
  const group = new THREE.Group();
  scene.add(group);

  let R = null, S = null, version = 0, ready = false, prog = 0;
  let onPreview = null;

  // Nouvelle recette : surface du gabarit, strates, simulation complète.
  async function setRecipe(recipe) {
    R = recipe; S = specOf(R);
    const v = ++version;
    ready = false; prog = 0;
    const b0 = initialTerrain(S.form, gs.NX, gs.NY, R.seedN);
    gs.setup({ b0, strata: R.strata, S, seed: R.seedN });
    sand.setStrata(R);
    app.setRecipe(R, S);
    floorMat.color.set(R.floor);
    await gs.run({
      alive: () => v === version,
      onProgress: (f) => { if (v === version) prog = f; },
      onPreview: (a, f) => { if (v === version) onPreview?.(a, f, gs); },
    });
    if (v !== version) return false;
    await gs.finish();
    if (v !== version) return false;
    ready = true;
    return true;
  }

  // (azimuts donnés pour une caméra du côté +Z : réfléchis si elle vole de l'autre côté)
  const place = (l, az, el, d, T = [0, 0.06, 0]) => {
    const side = R.camera.side ?? 1;
    l.position.set(T[0] + Math.sin(az) * Math.cos(el) * d, T[1] + Math.sin(el) * d, T[2] + side * Math.cos(az) * Math.cos(el) * d);
    l.target.position.set(...T);
  };
  // intensité (cd) donnant l'éclairement `lux` (unités de scène) à la distance d, sous le faisceau
  const cd = (lux, d) => lux * d * d;

  // ph : phase de la boucle [0, 1)
  function update(ph, duration) {
    if (!R) return;
    const F = filmState(ph, S);
    const L = R.light;
    const kd = L.key.kind === 'sun' ? 6 : L.key.dist;
    place(key, L.key.az, L.key.el, kd);
    // (demi-pénombre de l'ombre du relief : soleil net, lampe plus douce)
    const lightPen = L.key.kind === 'sun' ? 0.012 : 0.012 + 0.03 * (L.key.pen ?? 0.5);
    gs.resolve({ light: key.position.toArray(), lightPen, tT: reliefK(F.k) * (gs.FT - 1), tW: F.k * (gs.FW - 1), water: F.water, drain: F.drain, screed: F.screed, bead: 0.003, bermTan: Math.tan((33 * Math.PI) / 180) });
    sand.U.dry.value = F.dry;
    sand.U.pits.value = S.rain ? Math.min(1, F.k * 6) : 0; // (le sable se crible dès les premières averses)
    sand.U.waterOn.value = F.water;
    sand.U.flowPhase.value = ph * Math.round(duration * 0.8); // (un nombre entier de cycles par boucle)
    app.duration = duration;
    app.update(F, ph);
    rain.update(F, ph, duration, S);
    key.color.set(kelvinToHex(L.key.K));
    key.intensity = cd(L.key.lux, kd);
    key.angle = L.key.kind === 'sun' ? 0.16 : L.key.angle;
    key.penumbra = L.key.pen;
    key.shadow.focus = 1;
    key.shadow.radius = L.key.kind === 'sun' ? 1.5 : 3;
    place(fill, L.fill.az, L.fill.el, 3); fill.color.set(kelvinToHex(L.fill.K)); fill.intensity = cd(L.fill.lux, 3);
    place(rim, L.rim.az, L.rim.el, 3); rim.color.set(kelvinToHex(L.rim.K)); rim.intensity = cd(L.rim.lux, 3) * (lite ? 1.4 : 1);
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 4096;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setRecipe, update, setShadowQuality, group, key, fill, rim, gs, sand, app,
    set onPreview(f) { onPreview = f; },
    ready: () => ready,
    progress: () => prog,
    get S() { return S; },
    syncFinishes() {},
  };
}
