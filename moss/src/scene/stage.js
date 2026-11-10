// La scène : lumières, décor, mousse, pluie. update(u) ne dépend que de la
// recette et de la phase.
//
// Une boucle est une année en accéléré (field.js). La lumière suit les
// saisons : soleil dur et haut de la sécheresse, ciel bas et gris des
// pluies ; chaque averse assombrit le ciel pendant qu'elle passe. Le soleil
// ne saute jamais (pas de jour et de nuit qui clignotent : la convention de
// l'accéléré qui garde l'heure de la prise de vue) ; il monte et descend
// lentement avec les saisons, et les ombres glissent.
// Toutes les lumières sont créées une fois, dans un ordre fixe, au premier
// niveau de la scène (changer leur ordre recompile tous les matériaux).
import * as THREE from 'three/webgpu';
import { Fn, attribute, positionLocal, positionPrevious, vec2, vec3, float, uniform, mix, smoothstep, sin, cos, fract, select } from 'three/tsl';
import { createMoss, BLUR_TAPS } from './moss.js';
import { buildDecor, createDecorLook, rockTextures } from './decor.js';
import { sampleField, bilerp, wetSeason, rainAt, rainNow, FIELD_N } from '../field.js';
import { createCameraPath } from '../camera.js';
import { isLite, stableVelocity, noise } from './materials.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// pluie : stries tirées à chaque image (l'obturateur d'un accéléré saisit
// les gouttes qui tombent à cet instant), dans une boîte autour du sujet
function rainMaterial(RU) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const id = attribute('rid', 'float');
  const h = (k) => fract(sin(id.mul(12.9898).add(RU.frame.mul(78.233)).add(k * 37.719)).mul(43758.5453));
  const x = h(1).sub(0.5).mul(RU.box), z = h(2).sub(0.5).mul(RU.box), y = h(3).mul(RU.height);
  const live = h(4).lessThan(RU.rate);
  const len = h(5).mul(1.5).add(2.2), wdt = float(0.016);
  const p0 = vec3(x, y, z).add(RU.center);
  const p = p0.add(RU.right.mul(positionLocal.x.mul(wdt))).add(vec3(0.05, -1, 0).mul(positionLocal.y.mul(len)));
  const q = select(live, p, vec3(0, -80, 0));
  m.positionNode = Fn(() => { if (!isLite()) positionPrevious.assign(q); return q; })();
  const fade = float(1).sub(positionLocal.y.mul(2).sub(1).abs()).mul(float(1).sub(positionLocal.x.abs()));
  m.colorNode = RU.color.mul(fade).mul(h(6).mul(0.8).add(0.7));
  m.mrtNode = stableVelocity();
  return m;
}

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const sun = new THREE.SpotLight(0xffffff, 1, 0, 0.2, 0.3, 2);
  sun.castShadow = true;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.006;
  sun.shadow.radius = 2;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 30; sun.shadow.camera.far = 110;
  sun.shadow.focus = 0.6;
  const rim = new THREE.SpotLight(0xffffff, 1, 0, 0.35, 0.8, 2);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  if (lite) rim.visible = false;
  for (const l of [sun, rim]) { scene.add(l); scene.add(l.target); }
  scene.add(hemi);
  // taches de soleil (couvert du sous-bois) : masque procédural qui dérive
  const fleck = { on: uniform(0), phase: uniform(0) };
  sun.colorNode = Fn(([uv]) => {
    const a = fleck.phase.mul(6.283);
    const q = uv.xy.mul(7).add(vec2(cos(a), sin(a)).mul(0.6));
    const n = noise(vec3(q.x, q.y, sin(a).mul(0.4)).mul(1.3)).add(noise(vec3(q.x.mul(2.3), q.y.mul(2.3), cos(a).mul(0.5))).mul(0.5));
    return vec3(mix(float(1), smoothstep(0.05, 0.4, n).mul(1.15).add(0.08), fleck.on));
  });

  // ── Champ (mousse B, eau W) en textures, lu par le feutre et la roche ──
  const mkTex = () => { const t = new THREE.DataTexture(new Float32Array(FIELD_N * FIELD_N * 4), FIELD_N, FIELD_N, THREE.RGBAFormat, THREE.FloatType); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
  const FIELD = { tex: mkTex(), prev: mkTex(), E: uniform(5) };

  const group = new THREE.Group(), decorGroup = new THREE.Group();
  scene.add(group); scene.add(decorGroup);
  const moss = createMoss(group, FIELD);
  const DU = createDecorLook(FIELD);
  let rockT = null, failed = null, R = null, data = null, cam = null, pending = 0, version = 0, decorMeshes = [];
  const fieldArr = new Float32Array(2 * FIELD_N * FIELD_N);
  let state = new Float32Array(4);
  const RU = { frame: uniform(0), rate: uniform(0), box: uniform(10), height: uniform(14), center: uniform(new THREE.Vector3()), right: uniform(new THREE.Vector3(1, 0, 0)), color: uniform(new THREE.Color(1, 1, 1)) };
  let lastU = null;

  function clearDecor() {
    for (const o of decorMeshes) { decorGroup.remove(o); o.geometry.dispose(); o.material.dispose(); }
    decorMeshes = [];
  }
  // (stries de pluie : une lame par goutte, gabarit commun)
  {
    const NR = lite ? 900 : 2600;
    const g = new THREE.BufferGeometry(), pos = [], rid = [], idx = [];
    for (let i = 0; i < NR; i++) {
      for (const [x, y] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) { pos.push(x, y, 0); rid.push(i); }
      const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('rid', new THREE.Float32BufferAttribute(rid, 1));
    g.setIndex(idx);
    const rain = new THREE.Mesh(g, rainMaterial(RU));
    rain.frustumCulled = false; rain.castShadow = false; rain.receiveShadow = false; rain.renderOrder = 10;
    group.add(rain);
  }

  const camFor = (d) => {
    const tops = d.colony.shoots.map((s) => s.top[1]).sort((x, y) => x - y);
    return createCameraPath(R.camera, { top: tops[Math.floor(tops.length * 0.6)], E: d.habitat.E, hero: d.hero, heroDir: d.heroDir }, R.loop.duration);
  };

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    pending = 1;
    const rockReq = R.decor.rock ? gen.request({ type: R.decor.rock, seed: R.colony.support.seed, X: 14, M: lite ? 640 : 1024 }, 'rock') : Promise.resolve(null);
    Promise.all([gen.request({ colony: R.colony, loop: R.loop, water: R.hydro }, 'moss'), rockReq]).then(([d, rk]) => {
      if (v !== version) return;
      if (rockT) { rockT.rel.dispose(); rockT.col.dispose(); }
      rockT = rk ? rockTextures(rk) : null;
      data = d;
      FIELD.E.value = d.habitat.E;
      moss.set(d, R);
      clearDecor();
      decorMeshes = buildDecor(decorGroup, R, d.colony, DU, rockT);
      state = new Float32Array((d.colony.n + d.colony.sporCount) * 4);
      cam = camFor(d);
      lastU = null;
      pending = 0;
    }).catch((e) => { console.error(e); pending = 0; failed = e; });
  }

  const place = (l, az, el, r, target) => {
    l.position.set(target[0] + Math.cos(az) * Math.cos(el) * r, target[1] + Math.sin(el) * r, target[2] + Math.sin(az) * Math.cos(el) * r);
    l.target.position.set(...target);
  };

  // u : phase déroulée
  function update(u) {
    if (!R || !data) return null;
    const ph = u - Math.floor(u);
    const jump = lastU == null || Math.abs(u - lastU) > 0.02;
    lastU = u;
    // champ : textures (courante, précédente)
    sampleField(data.rec, ph, fieldArr);
    const NN = FIELD_N * FIELD_N, E = data.habitat.E;
    const a = FIELD.tex.image.data, b = FIELD.prev.image.data;
    const write = (t) => { for (let k = 0; k < NN; k++) { t[k * 4] = fieldArr[k]; t[k * 4 + 1] = fieldArr[NN + k]; t[k * 4 + 3] = 1; } };
    if (jump) write(b); else b.set(a);
    write(a);
    FIELD.tex.needsUpdate = true; FIELD.prev.needsUpdate = true;
    // tiges : ouverture (l'eau), croissance (la mousse), eau de surface (la pluie), eau
    const C = data.colony, SH = data.showers;
    for (let i = 0; i < C.n; i++) {
      const S = C.shoots[i];
      let Bv = 0;
      for (const [a, b2] of BLUR_TAPS) Bv += bilerp(fieldArr, FIELD_N, E, S.x + a, S.z + b2);
      Bv /= BLUR_TAPS.length;
      const Wv = bilerp(fieldArr, FIELD_N, E, S.x, S.z, NN);
      const rr = rainAt(ph, S.x, S.z, SH, E);
      state[i * 4] = sst(0.2, 0.65, Wv);
      state[i * 4 + 1] = Math.max(0, sst(0.04, 0.9, Bv) * (1 + 0.12 * S.grow) - 0.12 * S.grow); // (même loi que le dôme du feutre : le bord recule, le dôme garde sa forme)
      state[i * 4 + 2] = Math.min(1, rr * 1.4 + Wv * 0.25);
      state[i * 4 + 3] = Wv;
    }
    for (let k = 0; k < C.sporCount; k++) {
      const si = C.spors[k].shoot, j = (C.n + k) * 4;
      state[j] = state[si * 4 + 3]; state[j + 1] = state[si * 4 + 1]; state[j + 2] = 0; state[j + 3] = 0;
    }
    moss.update(state, jump);
    // ciel : les pluies voilent le soleil, les averses l'éteignent en passant
    const L = R.light, season = wetSeason(ph), shower = rainNow(ph, SH, E);
    const cloud = Math.min(1, season * 0.75 + shower * 0.9);
    const clear = 1 - cloud;
    DU.wet.value = Math.min(1, season * 0.85 + shower);
    // soleil : haut à la sécheresse (été), plus bas aux pluies ; jamais de saut
    const el = L.sun.el + 0.18 * Math.cos(2 * Math.PI * (ph - 0.82));
    const target = [0, 0.4, 0];
    place(sun, L.sun.az, el, 70, target);
    sun.color.set(L.sun.color);
    sun.intensity = 28000 * L.sun.intensity * (L.sun.cloud + (1 - L.sun.cloud) * clear);
    fleck.on.value = L.sun.flecks ? 1 : 0;
    fleck.phase.value = ph * 3;
    place(rim, L.rim.az, L.rim.el, 40, target);
    rim.color.set(L.rim.color);
    rim.intensity = 2200 * L.rim.intensity * (0.35 + 0.65 * clear);
    hemi.color.set(L.hemi.sky); hemi.groundColor.set(L.hemi.ground);
    hemi.intensity = L.hemi.intensity * (1 + 0.6 * cloud);
    // ciel et brume
    const low = new THREE.Color(R.sky.dry[0]).lerp(new THREE.Color(R.sky.wet[0]), cloud), high = new THREE.Color(R.sky.dry[1]).lerp(new THREE.Color(R.sky.wet[1]), cloud);
    DU.skyLow.value.copy(low); DU.skyHigh.value.copy(high);
    DU.sunDir.value.set(Math.cos(L.sun.az) * Math.cos(el), Math.sin(el), Math.sin(L.sun.az) * Math.cos(el));
    DU.sunColor.value.set(L.sun.color); DU.sunGlow.value = 2.5 * clear; DU.gaps.value = (R.camera.gaps ?? 0) * (0.35 + 0.65 * clear);
    const fogD = R.fog.dry + (R.fog.wet - R.fog.dry) * cloud + shower * 0.6;
    // pluie : autour du sujet ; plus nombreuse là où il pleut
    const pose = cam ? cam.pose(u) : null;
    if (pose) {
      const f = [pose.target[0] - pose.pos[0], pose.target[2] - pose.pos[2]], fl = Math.hypot(f[0], f[1]) || 1;
      RU.right.value.set(-f[1] / fl, 0, f[0] / fl);
      RU.center.value.set(pose.target[0], pose.target[1] - 1, pose.target[2]);
      RU.box.value = Math.min(24, pose.focus * 1.4);
    }
    RU.rate.value = Math.min(1, rainAt(ph, pose ? pose.target[0] : 0, pose ? pose.target[2] : 0, SH, E) * 1.2);
    RU.frame.value = (RU.frame.value + 1) % 4096;
    RU.color.value.copy(high).lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(1.4);
    return { fogColor: low, fogDensity: fogD, pose, clear };
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (sun.shadow.mapSize.x !== s) { sun.shadow.mapSize.set(s, s); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  }

  return {
    setRecipe, update, setShadowQuality, group, sun, rim, hemi, moss, DU, FIELD,
    cameraChanged: () => { if (data) cam = camFor(data); },
    syncFinishes: () => R && moss.syncLook(R),
    get data() { return data; },
    ready: () => pending === 0 && !!data, get failed() { return failed; },
    progress: () => (pending ? 0.3 : 1),
  };
}
