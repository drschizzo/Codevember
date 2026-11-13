// La scène : le bois, les deux sites montrés (le présent, à la phase u, et le
// passé, à u + 1, une période plus loin en amont), les lumières.
//
// update(u, pose) ne dépend que de la recette, de la phase et de la pose de la
// caméra (qui ne dépend elle-même que de la phase). Toutes les lumières sont
// créées une fois, dans un ordre fixe, au premier niveau de la scène.
import * as THREE from 'three/webgpu';
import { uniform, Fn, vec3, float, mix, smoothstep, exp, dot, normalize, positionWorldDirection, clamp, max as tmax } from 'three/tsl';
import { woodTextures, createWood } from './wood.js';
import { createDebris } from './debris.js';
import { createSiteView } from './site.js';
import { daylight } from '../timeline.js';
import { FAMILIES } from '../families.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.004; sun.shadow.radius = 3;
  Object.assign(sun.shadow.camera, { left: -3.2, right: 3.2, top: 3.2, bottom: -3.2, near: 0.5, far: 40 });
  const lamp = new THREE.SpotLight(0xffffff, 0, 0, 0.42, 0.85, 2);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.bias = -0.0002; lamp.shadow.normalBias = 0.004; lamp.shadow.radius = 3;
  lamp.shadow.camera.near = 0.5; lamp.shadow.camera.far = 30;
  const rim = new THREE.DirectionalLight(0xffffff, 0);
  for (const l of [sun, lamp, rim]) { scene.add(l); scene.add(l.target); }

  const group = new THREE.Group();
  scene.add(group);
  // ── Le fond : pas un aplat — un dégradé (plus clair à l'horizon, plus sombre
  // en haut) et le halo du soleil dans sa direction (on le voit à contre-jour) ;
  // la brume du lieu prend la couleur de l'horizon ──
  const bgU = { col: uniform(new THREE.Color()), sun: uniform(new THREE.Vector3(0, 1, 0)), sunCol: uniform(new THREE.Color()), glow: uniform(0), lift: uniform(new THREE.Color()) };
  scene.backgroundNode = Fn(() => {
    const d = normalize(positionWorldDirection);
    const up = clamp(d.y, -1, 1);
    const grad = mix(float(1.12), float(0.62), smoothstep(-0.05, 0.6, up)).mul(mix(float(0.85), float(1), smoothstep(-0.4, 0, up)));
    const c = tmax(dot(d, bgU.sun), 0);
    const halo = exp(float(1).sub(c).mul(-7)).mul(0.6).add(exp(float(1).sub(c).mul(-60)).mul(0.9));
    // (fonds noirs : une très faible lueur de la lumière du lieu vers l'horizon,
    // pour que le noir ait une profondeur et ne soit pas un trou)
    const horizon = exp(tmax(up, 0).mul(-5)).mul(smoothstep(-0.35, 0, up));
    return bgU.col.mul(grad).add(bgU.sunCol.mul(halo).mul(bgU.glow)).add(bgU.lift.mul(horizon));
  })();
  let R = null, version = 0, pending = 0, total = 1;
  let wood = null, woodTex = null, views = [], siteData = null, debris = null;
  const look = { wet: uniform(0) };
  // (lumière vue par les spores : direction et couleur du soleil, ambiance)
  const light = { sunDir: new THREE.Vector3(0, 1, 0), sunCol: new THREE.Color(), amb: new THREE.Color() };

  function clear() {
    if (wood) { group.remove(wood.mesh); wood.mesh.geometry.dispose(); wood.mesh.material.dispose(); wood = null; }
    debris?.dispose(group); debris = null;
    for (const v of views) v.dispose(group);
    views = [];
    woodTex?.rel.dispose(); woodTex?.col.dispose(); woodTex?.smooth.dispose(); woodTex = null;
    siteData = null;
  }

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    clear();
    pending = 2; total = 2;
    const spW = { ...R.wood, L: R.site.L, W: R.site.W, logR: R.site.logR, M: lite ? 640 : 1024 };
    const wP = gen.request(spW, 'wood');
    const sP = gen.request({ R, M: lite }, 'site');
    wP.then((maps) => { if (v !== version) return; woodTex = woodTextures(maps); pending--; }).catch((e) => { console.error(e); stage.error = e; });
    sP.then((S) => { if (v !== version) return; siteData = S; pending--; }).catch((e) => { console.error(e); stage.error = e; });
    Promise.all([wP, sP]).then(() => {
      if (v !== version) return;
      const sp = FAMILIES[R.family].species[R.species];
      // le bois porte la trace du plasmodium (des deux sites montrés)
      views = [0, -1].map((off) => createSiteView({ R, sp, S: siteData, wood: woodTex, off, lite, light }));
      wood = createWood(woodTex, { lite, look: { trail: (x, z) => views.reduce((acc, w) => acc.max(w.trailAt(x, z)), views[0].trailAt(x, z)), dust: views[0].dustLook((x, z) => views.reduce((acc, w) => acc.add(w.dustAt(x, z)), views[0].dustAt(x, z).mul(0))) } });
      group.add(wood.mesh);
      debris = createDebris(woodTex, R, { lite });
      for (const m of debris.meshes) group.add(m);
      for (const w of views) w.attach(group);
      ready = true;
    }).catch((e) => { console.error(e); stage.error = e; });
    ready = false;
  }
  let ready = false;

  const _d = new THREE.Vector3();
  // u : phase de la boucle [0, 1) ; pose : caméra du film (camera.js)
  function update(u, pose, camera) {
    if (!R || !ready) return;
    const ph = u - Math.floor(u);
    const day = daylight(ph);
    const L = R.light, tgt = pose.target;
    const dim = L.night + (1 - L.night) * day;
    // soleil : direction fixe, carte d'ombre centrée sur la cible (elle suit la caméra)
    const dir = (az, el) => _d.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    if (L.key.kind === 'sun') {
      sun.visible = true; lamp.visible = false;
      dir(L.key.az, L.key.el);
      sun.position.set(tgt[0] + _d.x * 20, tgt[1] + _d.y * 20, tgt[2] + _d.z * 20);
      sun.target.position.set(...tgt);
      sun.color.set(L.key.color); sun.intensity = L.key.intensity * dim;
    } else {
      // lampe frontale : au-dessus et à gauche de l'objectif, visée sur la cible
      sun.visible = false; lamp.visible = true;
      const c = camera.position;
      lamp.position.set(c.x - 0.9, c.y + 0.7, c.z - 0.2);
      lamp.target.position.set(...tgt);
      // (une lampe frontale ne suit pas le jour : réglée sur la nuit, elle
      // surexposait tout le bois quand le jour montait)
      lamp.color.set(L.key.color); lamp.intensity = L.key.intensity * 60 * L.night;
    }
    dir(L.rim.az, L.rim.el);
    rim.position.set(tgt[0] + _d.x * 20, tgt[1] + _d.y * 20, tgt[2] + _d.z * 20);
    rim.target.position.set(...tgt);
    rim.color.set(L.rim.color); rim.intensity = L.rim.intensity * (0.5 + 0.5 * dim);
    // pour les spores (nuage éclairé par diffusion vers l'avant)
    if (L.key.kind === 'sun') { dir(L.key.az, L.key.el); light.sunDir.copy(_d); }
    else light.sunDir.set(camera.position.x - tgt[0], camera.position.y - tgt[1], camera.position.z - tgt[2]).normalize();
    light.sunCol.set(L.key.color).multiplyScalar(L.key.intensity * dim * 0.35);
    light.amb.set(R.fog.color).multiplyScalar(0.25 * R.env.intensity).add(new THREE.Color(0.03, 0.03, 0.03));
    // fond : couleur du lieu, halo du soleil (dosé par le jour)
    bgU.col.value.set(R.fog.color);
    if (L.key.kind === 'sun') { dir(L.key.az, L.key.el); bgU.sun.value.copy(_d); bgU.glow.value = 0.35 * dim * (R.mood === 'brume' ? 2.2 : 1); }
    else bgU.glow.value = 0;
    bgU.sunCol.value.set(L.key.color).multiplyScalar(0.12);
    { const c = new THREE.Color(R.fog.color), lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      bgU.lift.value.set(L.key.color).lerp(c, 0.5).multiplyScalar(Math.max(0, 0.05 - lum) * 0.5 * (0.6 + 0.4 * dim)); }
    for (const v of views) v.update(ph, camera);
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    for (const l of [sun, lamp]) if (l.shadow.mapSize.x !== s) { l.shadow.mapSize.set(s, s); l.shadow.map?.dispose(); l.shadow.map = null; }
  }

  const stage = {
    setRecipe, update, setShadowQuality, group, sun, lamp, rim, error: null,
    syncFinishes: () => {},
    ready: () => ready,
    progress: () => (ready ? 1 : (total - pending) / (total + 1)),
    site: () => siteData,
    views: () => views,
  };
  return stage;
}
