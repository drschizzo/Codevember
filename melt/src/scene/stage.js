// La scène : le support, le cristal couché dessus, les perles d'eau, et trois
// lumières fixes dans le monde (le ciel froid, le soleil de la fonte, un
// contre-jour). Tout est lu depuis la recette et la phase (timeline.js).
//
// Principes (voir la skill) : update(ph) ne dépend que de la recette et de la
// phase ; un maillage reçoit un matériau neuf à chaque nouvelle géométrie ;
// les lumières sont créées une fois, dans un ordre fixe, au premier niveau.
import * as THREE from 'three/webgpu';
import { clock, TL, sstep } from '../timeline.js';
import { crystalSpec } from '../recipe.js';
import { capBase, capVolume, MAX_BLOBS } from '../gen/crystal.js';
import { createIceUniforms, buildIceMaterial, buildIceShadow, iceGeometry } from './ice.js';
import { createContact, setCover, contactAO, packBlobs } from './contact.js';
import { createWaterUniforms, buildWaterMaterial, buildWaterShadow, capGeometry, SHADOW_LAYER } from './water.js';
import { createSubstrate } from './substrate.js';
import { createFrost } from './frost.js';
import { createBacklight, setBacklight } from './backlight.js';
import { G } from './globals.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
const ramp = (x, a, b) => sstep((x - a) / (b - a));

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 80 });
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.004;
  sun.shadow.radius = 3;
  sun.shadow.camera.layers.enable(SHADOW_LAYER);
  const key = new THREE.SpotLight(0xffffff, 1, 0, 0.55, 1, 0); // (décroissance nulle : un ciel, une boîte à lumière lointaine)
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 5; key.shadow.camera.far = 90;
  key.shadow.bias = -0.0003;
  key.shadow.radius = 10;
  key.shadow.camera.layers.enable(SHADOW_LAYER);
  const rim = new THREE.SpotLight(0xffffff, 1, 0, 0.5, 1, 0);
  if (lite) rim.visible = false;
  for (const l of [sun, key, rim]) { scene.add(l); scene.add(l.target); }

  // ── Uniformes du cristal, de l'eau, du contact ──
  const IU = createIceUniforms(), WU = createWaterUniforms(), BL = createBacklight(), CT = createContact();

  // ── Le support ──
  const substrate = createSubstrate(scene, gen, { lite, contact: () => contactAO(CT, IU, WU) });
  const frost = createFrost(scene, { lite });
  let frostSet = null;

  // ── Le cristal et l'eau (repère du cristal : plan xy, couché sur y = 0) ──
  const group = new THREE.Group();
  scene.add(group);
  const ice = new THREE.Mesh(new THREE.BufferGeometry());
  ice.castShadow = false; ice.receiveShadow = true;
  ice.frustumCulled = false;
  const waterGeo = capGeometry(lite ? 14 : 22, lite ? 32 : 56);
  const water = new THREE.Mesh(waterGeo);
  water.frustumCulled = false;
  water.receiveShadow = true;
  water.renderOrder = 2;
  const waterShadow = new THREE.Mesh(waterGeo);
  waterShadow.layers.set(SHADOW_LAYER);
  waterShadow.castShadow = true;
  waterShadow.frustumCulled = false;
  const iceShadow = new THREE.Mesh(new THREE.BufferGeometry());
  iceShadow.layers.set(SHADOW_LAYER);
  iceShadow.castShadow = true;
  iceShadow.frustumCulled = false;
  group.add(ice, water, waterShadow, iceShadow);

  let R = null, C = null, pending = 0, version = 0, backlitKey = null;

  function makeMaterials() {
    const bl = substrate.backlit() ? BL : null;
    for (const m of [ice.material, water.material, waterShadow.material, iceShadow.material]) if (m && m.dispose) m.dispose();
    ice.material = buildIceMaterial(IU, { backlit: bl });
    iceShadow.material = buildIceShadow(IU, ice.material);
    water.material = buildWaterMaterial(WU, { backlit: bl });
    waterShadow.material = buildWaterShadow(WU, water.material);
  }

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    C = null;
    ice.visible = water.visible = waterShadow.visible = iceShadow.visible = false;
    const spec = crystalSpec(R, lite);
    substrate.setRecipe(R, spec.size / 2 + 0.25);
    if (R.sub.kind === 'glass' || R.sub.kind === 'sapphire') setBacklight(BL, R.sub);
    pending = 1;
    return gen.request(spec, 'crystal').then((o) => {
      if (v !== version) return;
      ice.geometry.dispose();
      ice.geometry = iceGeometry(o);
      iceShadow.geometry = ice.geometry;
      setCover(CT, o.cover);
      C = o;
      const thSub = R.water.theta;
      C.Vbead = capVolume(R.water.bead, thSub);
      C.dropR = capBase(C.Vbead + C.Vwater, thSub);
      IU.tau.value = o.tau; IU.tauM.value = o.tauMelt; IU.h0.value = o.thick;
      makeMaterials(); // (matériaux APRÈS la géométrie)
      ice.visible = water.visible = waterShadow.visible = iceShadow.visible = true;
      pending = 0;
    }).catch((e) => { console.error(e); pending = 0; throw e; });
  }

  // perles à la phase u → tableau (x, y, a, 0) par emplacement
  function blobsAt(u, k, out) {
    const thSub = R.water.theta, thIce = R.water.thetaIce;
    const offIce = ramp(k.sm, 0.9, 1.0);
    const liq = ramp(u, TL.bead0, TL.bead1) * (1 - offIce);
    const th = thIce + (thSub - thIce) * offIce;
    const th0 = thSub + (thIce - thSub) * liq;
    const W = C.water, F = W.frames, D = W.data;
    const melting = k.sm > -0.04 && u >= TL.melt0 - 0.001 && u <= TL.melt1 + 0.02;
    // (après la fonte, les perles qui restent — le chapelet d'une colonne —
    // s'évaporent, les petites plus vite)
    const after = u > TL.melt1 + 0.02;
    const fr = after ? F - 1 : Math.min(F - 1, Math.max(0, k.sm * (F - 1)));
    const f0 = Math.floor(fr), f1 = Math.min(F - 1, f0 + 1), w = fr - f0;
    for (let s = 0; s < MAX_BLOBS; s++) {
      let x = 0, y = 0, V = 0;
      if (melting || after) {
        const o0 = (f0 * MAX_BLOBS + s) * 4, o1 = (f1 * MAX_BLOBS + s) * 4;
        const v0 = D[o0 + 2], v1 = D[o1 + 2];
        if (v0 > 0 || v1 > 0) {
          x = D[o0] * (1 - w) + D[o1] * w; y = D[o0 + 1] * (1 - w) + D[o1 + 1] * w; V = v0 * (1 - w) + v1 * w;
        }
      }
      if (s === 0) {
        // la goutte du centre : la perle, plus l'eau rassemblée, moins l'évaporation
        const all = u > TL.melt1 - 0.001 || k.sm >= 1;
        const V0 = (D[((F - 1) * MAX_BLOBS) * 4 + 2]); // (eau réunie au centre à la fin de la fonte)
        const Vw = all ? V0 * (1 - k.evap) : (melting ? V : 0);
        if (!melting || all) { x = 0; y = 0; }
        V = C.Vbead + Vw;
        out[s].set(x, y, capBase(V, th0), 0);
      } else out[s].set(x, y, capBase(after ? V * Math.max(0, 1 - k.evap) ** 1.4 : V, th), 0);
    }
    return { th, th0 };
  }

  const place = (l, az, el, r) => {
    l.position.set(Math.cos(az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r);
    l.target.position.set(0, 0, 0);
  };
  const _c = new THREE.Color();

  function update(ph) {
    if (!R) return;
    const k = clock(ph, C ?? {});
    const L = R.light;
    // soleil : il entre pour la fonte et passe ensuite
    place(sun, L.sun.az, L.sun.el, 40);
    sun.color.set(L.sun.color);
    sun.intensity = L.sun.intensity * k.sun;
    sun.visible = k.sun > 1e-3;
    // le ciel froid (lumière principale pendant le gel), un peu plus faible au soleil
    place(key, L.key.az, L.key.el, 50);
    key.color.set(L.key.color);
    key.intensity = L.key.intensity * (1 - 0.35 * k.sun);
    key.angle = 0.35 + 0.35 * L.key.soft; key.penumbra = 1;
    key.shadow.radius = 4 + 14 * L.key.soft;
    // contre-jour : à l'opposé de la caméra (fixe : sa direction moyenne)
    place(rim, R.camera.az + Math.PI, 0.32, 45);
    rim.color.set(L.rim.color);
    rim.intensity = L.rim.intensity * (0.8 + 0.2 * k.cold);
    substrate.update(k);
    if (frostSet !== R && substrate.ready() && substrate.frostPoints) { frost.setRecipe(R, substrate.frostPoints, R.crystal.size / 2 + 0.15); frostSet = R; }
    { const php = G.phasePrev.value - Math.floor(G.phasePrev.value); frost.update(k, clock(php, C ?? {}), ph, php); }
    group.rotation.set(-Math.PI / 2, 0, R.crystal.spin);
    CT.spin.value = R.crystal.spin;
    if (!C) return;
    // cristal
    const kp = clock(G.phasePrev.value, C);
    IU.tg.value = k.tg; IU.sm.value = k.sm; IU.tgP.value = kp.tg; IU.smP.value = kp.sm;
    IU.wet.value = k.wet;
    IU.relief.value = 1;
    // eau
    const a = blobsAt(ph, k, WU.cur), b = blobsAt(G.phasePrev.value - Math.floor(G.phasePrev.value), kp, WU.prev);
    WU.theta.value = a.th; WU.theta0.value = a.th0; WU.thetaP.value = b.th; WU.theta0P.value = b.th0;
    WU.BL.array = WU.cur; WU.BLP.array = WU.prev;
    packBlobs(CT, WU.cur);
    WU.freezeFront.value = k.frozen * 1.4 - 0.2;
    // (la pointe se soulève quand le gel atteint le sommet, et s'efface dès que la perle fond)
    WU.tip.value = sstep((k.frozen - 0.72) / 0.28);
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (sun.shadow.mapSize.x !== s) { sun.shadow.mapSize.set(s, s); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  }

  return {
    setRecipe, update, setShadowQuality, group, sun, key, rim, substrate,
    get C() { return C; },
    ready: () => pending === 0 && substrate.ready(),
    progress: () => (pending === 0 ? 0.5 : 0) + (substrate.ready() ? 0.5 : 0),
  };
}
