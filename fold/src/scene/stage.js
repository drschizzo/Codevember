// Le plateau : lumières, cyclorama et table, pot et monture, plante, eau,
// appareils (burette, marteau), caméra du film.
//
// Principes :
// - update(u) ne dépend que de la recette et de la phase (u → temps physique
//   τ par la carte du temps, puis tout est fonction de τ) ;
// - un maillage reçoit son matériau quand SA géométrie est arrivée, et un
//   matériau neuf à chaque nouvelle géométrie ;
// - toutes les lumières sont créées une fois, dans un ordre fixe, au premier
//   niveau de la scène (changer leur ordre recompile tous les matériaux).
import * as THREE from 'three/webgpu';
import { uniform, uniformArray, lights } from 'three/tsl';
import { buildPieceMaterial, finishUniforms, applyFinish, signature } from './materials.js';
import { createPlant } from './plant.js';
import { buildCyclorama, backdropMaterial, soilMaterial, glassMaterial, waterMaterial, mulchMaterial, liquidMaterial, WET_MAX } from './decor.js';
import { createPoser } from '../pose.js';
import { cameraGuard } from './guard.js';
import { buildTimeMap } from '../physio.js';
import { buildCameraPath, filmTime } from '../camera.js';
import { containerShape } from '../container.js';
import { waterAt, waterCount, soilWet, leafletWet, hammerAt, shakeAt } from '../effects.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 4096, ultra: 4096 };

function toGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}
const finishU = (f) => ({ outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(f.wear) });

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const key = new THREE.SpotLight(0xffffff, 600, 0, 0.5, 0.7, 2);
  key.castShadow = true;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 2.5;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 3; key.shadow.camera.far = 22;
  key.shadow.focus = 0.55;
  const rims = [new THREE.SpotLight(0xffffff, 300, 0, 0.55, 0.9, 2), new THREE.SpotLight(0xffffff, 100, 0, 0.55, 0.9, 2)];
  if (lite) rims[1].visible = false;
  // lumière du lieu (ciel d'une serre, pièce claire) : un hémisphère sans
  // ombre, dosé par décor ; c'est elle qui éclaire le sol loin de la lampe
  const sky = new THREE.HemisphereLight(0xffffff, 0x808080, 0);
  for (const l of [key, ...rims]) { scene.add(l); scene.add(l.target); }
  scene.add(sky);
  const keyOnly = lights([key, sky]);

  // ── Groupes ──
  const group = new THREE.Group();     // tout ce qui appartient à la scène courante
  const potGroup = new THREE.Group();  // le pot et ce qu'il porte (il tremble sous le marteau)
  potGroup.matrixAutoUpdate = false;
  group.add(potGroup);
  const plantGroup = new THREE.Group();
  potGroup.add(plantGroup);
  scene.add(group);
  const plant = createPlant(plantGroup, { lite });

  // uniformes du décor
  const DU = {
    base: uniform(new THREE.Color('#ffffff')), wall: uniform(1), y0: uniform(-1), winAz: uniform(0), Rw: uniform(8),
    moss: uniform(0), peat: uniform(0), wet: uniformArray(Array.from({ length: WET_MAX }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4'),
    glassTint: uniform(new THREE.Color('#e8f2ee')), dropGlow: uniform(0.02),
  };

  let R = null, built = null, version = 0, pending = 0, total = 1;
  let S = null, tm = null, camAt = null;
  const own = [];       // maillages de la scène courante (libérés au changement)
  const finishes = [];  // { mesh, finish, U, key }
  let water = null, hammerArm = null, waterBuf = [], prevWater = null;

  function disposeAll() {
    for (const m of own) { m.parent?.remove(m); m.geometry?.dispose(); m.material?.dispose?.(); }
    own.length = 0; finishes.length = 0; water = null; hammerArm = null; prevWater = null;
  }
  const addMesh = (parent, geo, mat, { cast = true, receive = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = receive;
    parent.add(m); own.push(m);
    return m;
  };
  const addFinished = (parent, o, finish, opts = {}) => {
    if (!o || !finish) return null;
    const U = finishU(finish), M = { seedOff: uniform(new THREE.Vector3(finishes.length * 3.7, 1.3, 0.4)) };
    const mat = buildPieceMaterial(finish, U, M);
    if (opts.keyOnly) mat.lightsNode = keyOnly;
    const mesh = addMesh(parent, toGeometry(o), mat, opts);
    finishes.push({ mesh, finish, U, M, key: signature(finish), opts });
    return mesh;
  };

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    pending = 1; total = 1;
    gen.request({
      seed: R.seed, plant: R.plant, container: R.container, mulch: R.decor.mulch ?? 'gravel', lite, events: R.events, spacing: R.loop.spacing,
      view: { az: R.camera.az, el: R.camera.el, close: R.camera.close, wide: R.camera.wide, fov: R.camera.fov }, duration: R.loop.duration, rot: R.camera.rot ?? 1,
    }, 'scene').then((o) => {
      if (v !== version) return;
      try { build(o); } catch (e) { console.error(e); built = { error: e }; }
      pending = 0;
    }, (e) => { console.error(e); pending = 0; built = { error: e }; });
  }

  function build(o) {
    disposeAll();
    built = o;
    const { plant: P, plan, meshes } = o;
    S = containerShape(R.container, o.H, o.E);
    // carte du temps et caméra
    tm = buildTimeMap({ P: plan.P, T: R.loop.duration, windows: plan.windows });
    const guard = cameraGuard(S);
    camAt = buildCameraPath({ plan, tm, cam: R.camera, guard });
    // plante
    const poser = createPoser(P, plan);
    plant.set(meshes, P, poser);
    // décor : table (sol) et cyclorama
    const D = R.decor;
    DU.y0.value = S.tableY;
    DU.base.value.set(R.fog.color);
    DU.wall.value = D.wall;
    DU.winAz.value = R.light.key.az;
    DU.peat.value = R.decor.mulch === 'sphagnum' || R.decor.mulch === 'perlite' ? 1 : 0; // (tourbe noire sous la sphaigne)
    DU.moss.value = R.mood === 'serre' || R.mood === 'shoji' ? 0.8 : R.mood === 'cabinet' ? 0.4 : 0;
    const Rw = 14;
    DU.Rw.value = Rw;
    {
      const g = new THREE.CircleGeometry(Rw - 2.5 + 0.02, 160).rotateX(-Math.PI / 2);
      const n = g.attributes.position.count, surf = new Uint8Array(n * 4), tan = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { surf[i * 4] = 255; surf[i * 4 + 3] = 128; tan[i * 4] = 1; tan[i * 4 + 3] = 1; }
      g.setAttribute('surf', new THREE.BufferAttribute(surf, 4, true));
      g.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
      g.translate(0, S.tableY, 0);
      if (D.backdrop === 'cyclo' || D.backdrop === 'velvet') {
        // cyclorama continu : le sol est la même matière que la paroi (pas d'horizon)
        const dec = new Float32Array(g.attributes.position.count * 2);
        for (let i = 0; i < g.attributes.position.count; i++) { dec[i * 2] = 0; dec[i * 2 + 1] = S.tableY; }
        g.setAttribute('dec', new THREE.BufferAttribute(dec, 2));
        const fm = backdropMaterial(D.backdrop, DU);
        fm.lightsNode = keyOnly;
        addMesh(group, g, fm, { cast: false, receive: true });
      } else {
        const U = finishU(D.table), M = { seedOff: uniform(new THREE.Vector3(5, 2, 9)) };
        const mat = buildPieceMaterial(D.table, U, M);
        mat.lightsNode = keyOnly;
        const floor = addMesh(group, g, mat, { cast: false, receive: true });
        finishes.push({ mesh: floor, finish: D.table, U, M, key: signature(D.table), opts: { keyOnly: true } });
      }
      const wall = addMesh(group, buildCyclorama(Rw, S.tableY, 20, 2.5), backdropMaterial(D.backdrop, DU), { cast: false, receive: true });
      wall.material.lightsNode = keyOnly;
    }
    // pot, terre, monture
    addFinished(potGroup, meshes.pot, D.pot);
    addMesh(potGroup, toGeometry(meshes.soil), soilMaterial(DU), { cast: false, receive: true });
    // le paillage, grain par grain (il porte ombre et en reçoit)
    {
      const g = toGeometry(meshes.mulch);
      g.setAttribute('grain', new THREE.BufferAttribute(meshes.mulch.grain, 4));
      addMesh(potGroup, g, mulchMaterial(DU, R.decor.mulch ?? 'gravel'), { cast: true, receive: true });
    }
    if (meshes.base) addFinished(potGroup, meshes.base, D.base);
    if (meshes.frame) addFinished(potGroup, meshes.frame, D.base?.set === 'whiteIron' ? D.base : { ...D.stand });
    if (meshes.glass) addMesh(potGroup, toGeometry(meshes.glass), glassMaterial(DU, { condensation: true }), { cast: false, receive: false }).renderOrder = 10;
    // appareils
    if (meshes.burette) {
      addFinished(group, meshes.burette.metal, D.stand);
      addMesh(group, toGeometry(meshes.burette.liquid), liquidMaterial(), { cast: false, receive: false }).renderOrder = 8;
      addMesh(group, toGeometry(meshes.burette.glass), glassMaterial(DU, { graduations: true, presence: 2.6 }), { cast: false, receive: false }).renderOrder = 9;
    }
    if (meshes.hammer) {
      addFinished(group, meshes.hammer.base, D.coil);
      hammerArm = addFinished(group, meshes.hammer.arm, D.brass);
      hammerArm.matrixAutoUpdate = false;
    }
    // eau : une instance par goutte et par perle
    const nW = Math.max(1, waterCount(plan));
    const wg = new THREE.InstancedBufferGeometry();
    const sph = meshes.sphere;
    wg.setAttribute('position', new THREE.BufferAttribute(sph.position, 3));
    wg.setAttribute('normal', new THREE.BufferAttribute(sph.normal, 3));
    wg.setIndex(new THREE.BufferAttribute(sph.index, 1));
    const ib = new THREE.InstancedInterleavedBuffer(new Float32Array(nW * 28), 28, 1).setUsage(THREE.DynamicDrawUsage);
    for (let q = 0; q < 3; q++) wg.setAttribute(`im${q}`, new THREE.InterleavedBufferAttribute(ib, 4, 4 * q));
    for (let q = 0; q < 3; q++) wg.setAttribute(`ip${q}`, new THREE.InterleavedBufferAttribute(ib, 4, 12 + 4 * q));
    wg.setAttribute('ix', new THREE.InterleavedBufferAttribute(ib, 4, 24));
    wg.instanceCount = nW;
    wg.userData.ib = ib;
    water = addMesh(group, wg, waterMaterial(), { cast: false, receive: false });
    water.frustumCulled = false;
    syncLook();
  }

  // couleurs de la plante (recette)
  function syncLook() {
    if (!R) return;
    const L = R.leaf, U = plant.U;
    DU.wall.value = R.decor.wall;
    DU.base.value.set(R.fog.color);
    // (teintes données en sRGB : un vert de feuille a un albédo de ~5–10 %)
    const C = THREE.SRGBColorSpace;
    U.leaf.value.setHSL(L.hue / 360, L.sat, L.light * 0.82, C);
    // revers nettement plus pâle, bleuté (la cire du dessous) : quand la feuille
    // se ferme, on voit soudain le revers — le pli se lit à la couleur
    // (revers : plus pâle et plus froid, mais toujours une feuille — un revers
    // presque blanc donnait des folioles de papier crayeux)
    U.leafBack.value.setHSL((L.hue + 12) / 360, L.sat * 0.62, Math.min(0.52, L.light * 1.38), C);
    U.leafYoung.value.setHSL((L.hue - 12) / 360, Math.min(1, L.sat * 1.1), L.light * 1.15, C);
    U.trans.value.setHSL((L.hue - 16) / 360, Math.min(1, L.sat * 1.3), Math.min(0.36, L.light * 1.35), C); // (contre-jour : un vert lumineux, pas un jaune fluo)
    U.translucency.value = L.translucency;
    U.stemHigh.value.setHSL((L.hue - 8) / 360, L.sat * 0.75, L.light * 0.95, C);
    U.flower.value.set(L.flower);
    const fam = L.family ?? 'sensitive';
    U.trap.value = fam === 'dionaea' ? 1 : 0;
    // matière propre à chaque famille : relief des nervures (à l'échelle de la
    // feuille), lustre, duvet
    U.relief.value = { sensitive: 0.00018, biophytum: 0.00025, oxalis: 0.0009, dionaea: 0.0007 }[fam] ?? 0.0002;
    U.veinFreq.value = fam === 'oxalis' ? 26 : fam === 'dionaea' ? 30 : 46;
    U.rough.value = fam === 'oxalis' ? 0.5 : fam === 'dionaea' ? 0.3 : 0.38;
    // (duvet : un voile à peine visible ; fort, il blanchit les feuilles comme
    // un plastique poudré)
    U.sheenTop.value.set(fam === 'oxalis' ? '#24162a' : '#070906');
    U.sheenBack.value.set(fam === 'oxalis' ? '#2e2034' : fam === 'dionaea' ? '#10140c' : '#1f2819');
    U.inner.value.set(L.inner ?? '#9c1f1a');
    U.eyeAmt.value = L.eye ?? 0;
    U.eye.value.setHSL((L.hue + 14) / 360, 0.45, Math.min(0.5, L.light * 2.1), C); // (la tache du trèfle pourpre : un mauve, pas un rose bonbon)
    if (fam === 'oxalis') { U.stemLow.value.setHSL(L.hue / 360, L.sat * 0.7, L.light * 1.2, C); U.stemHigh.value.setHSL(L.hue / 360, L.sat * 0.6, L.light * 1.4, C); }
    if (fam === 'dionaea') U.leafBack.value.setHSL((L.hue + 4) / 360, L.sat * 0.85, L.light * 1.05, C); // (dehors du piège : vert)
    if (fam === 'dionaea') { U.stemLow.value.setHSL(L.hue / 360, L.sat, L.light * 0.9, C); U.stemHigh.value.setHSL(L.hue / 360, L.sat, L.light, C); }
    // gousses : vertes en été, brunes sous la lampe d'un cabinet
    U.pod.value.setHSL((L.hue - 40) / 360, 0.35, 0.2, C);
  }
  function syncFinishes() {
    for (const f of finishes) {
      if (signature(f.finish) !== f.key) {
        const old = f.mesh.material;
        f.U = finishU(f.finish); f.key = signature(f.finish);
        f.mesh.material = buildPieceMaterial(f.finish, f.U, f.M);
        if (f.opts.keyOnly) f.mesh.material.lightsNode = keyOnly;
        old.dispose();
      } else { applyFinish(f.U.outer, f.finish.outer); applyFinish(f.U.inner, f.finish.inner); applyFinish(f.U.edge, f.finish.edge); f.U.wear.value = f.finish.wear; }
    }
    syncLook();
  }

  const place = (l, az, el, r, tgt) => {
    l.position.set(tgt[0] + Math.cos(az) * Math.cos(el) * r, tgt[1] + Math.sin(el) * r, tgt[2] + Math.sin(az) * Math.cos(el) * r);
    l.target.position.set(...tgt);
  };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();
  let lastWaterTau = null;

  // u : phase déroulée ; renvoie la pose de la caméra
  function update(u) {
    if (!built || !tm || built.error) return null;
    const plan = built.plan;
    const tau = tm.tauAt(u);
    const H = built.H;
    const center = [0, H * 0.45, 0];
    const Lk = R.light.key;
    // (les lampes sont dans la pièce : à 6,5 u ; intensités de la recette
    // données pour 9 u, ramenées à la même éclairement sur la plante)
    place(key, Lk.az, Lk.el, 6.5, center);
    key.color.set(Lk.color); key.intensity = Lk.intensity * (6.5 / 9) ** 2; key.angle = Lk.angle; key.penumbra = Lk.penumbra;
    // carte d'ombre resserrée sur la plante et son pot, quelle que soit
    // l'ouverture du faisceau (sinon les folioles, 1,6 mm, n'ont pas d'ombre)
    const reach = Math.max(built.E, built.H * 0.6) + 0.5;
    const f = Math.min(1, Math.max(0.15, Math.atan(reach / 6.5) / Lk.angle));
    if (Math.abs(key.shadow.focus - f) > 1e-4) { key.shadow.focus = f; key.shadow.camera.updateProjectionMatrix?.(); }
    sky.intensity = R.light.sky?.intensity ?? 0;
    sky.color.set(R.light.sky?.color ?? '#ffffff'); sky.groundColor.set(R.light.sky?.ground ?? '#777777');
    // contre-jours : derrière le sujet, de part et d'autre, par rapport à la
    // caméra (ils dessinent les bords et font briller les feuilles par
    // transparence, sous tous les angles) ; la lampe principale, elle, reste
    // fixe dans le monde (les ombres ne bougent pas)
    const cam = camAt(u), camAz = Math.atan2(cam.pos[2] - cam.tgt[2], cam.pos[0] - cam.tgt[0]);
    rims.forEach((l, i) => {
      const r = R.light.rim[i];
      place(l, camAz + Math.PI + (i ? -0.75 : 0.6), i ? 0.55 : 0.32, 5, cam.tgt);
      l.color.set(r.color); l.intensity = r.intensity * 0.9 * (lite && i === 0 ? 1.4 : 1);
    });
    // la plante
    const wet = leafletWet(tau, plan);
    plant.update(tau, (k, side) => wet.get(`${k}:${side}`) ?? 0);
    // le pot tremble sous le marteau (rotation amortie autour de son pied)
    const sh = shakeAt(tau, plan);
    _m.makeTranslation(0, -S.potBottom, 0);
    potGroup.matrix.makeRotationAxis(_v.set(...sh.axis), sh.ang).multiply(_m).premultiply(_m.makeTranslation(0, S.potBottom, 0));
    potGroup.matrixWorldNeedsUpdate = true;
    // le bras du marteau
    if (hammerArm) {
      const h = hammerAt(tau, plan);
      if (h) {
        const E = h.E, d = E.dir;
        const axis = _v.set(-d[2], 0, d[0]).normalize();
        const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(d[0], 0, d[2]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(d[0], 0, d[2]).cross(new THREE.Vector3(0, 1, 0)));
        hammerArm.matrix.makeRotationAxis(axis, h.angle).multiply(basis).setPosition(d[0] * E.hammer.pivot[0], E.hammer.pivot[1], d[2] * E.hammer.pivot[0]);
        hammerArm.matrixWorldNeedsUpdate = true;
      }
    }
    // terre mouillée
    const spots = soilWet(tau, plan);
    for (let i = 0; i < WET_MAX; i++) { const s = spots[i]; DU.wet.array[i].set(s ? s[0] : 0, s ? s[1] : 0, s ? s[2] : 0, s ? s[3] : 0); }
    // eau
    if (water) {
      waterBuf = waterAt(tau, plan, waterBuf);
      const ib = water.geometry.userData.ib, a = ib.array;
      const jump = lastWaterTau == null || Math.abs(tau - lastWaterTau) > 30;
      lastWaterTau = tau;
      for (let i = 0; i < water.geometry.instanceCount; i++) {
        const w = waterBuf[i], b = i * 28;
        for (let j = 0; j < 12; j++) a[b + 12 + j] = jump ? 0 : a[b + j];
        if (w) { a[b] = w.s[0]; a[b + 1] = 0; a[b + 2] = 0; a[b + 3] = w.p[0]; a[b + 4] = 0; a[b + 5] = w.s[1]; a[b + 6] = 0; a[b + 7] = w.p[1]; a[b + 8] = 0; a[b + 9] = 0; a[b + 10] = w.s[2]; a[b + 11] = w.p[2]; }
        else { a.fill(0, b, b + 12); a[b] = a[b + 5] = a[b + 10] = 1e-6; }
        if (jump) for (let j = 0; j < 12; j++) a[b + 12 + j] = a[b + j];
      }
      ib.needsUpdate = true;
    }
    return cam;
  }
  // phases à préchauffer : juste avant et juste après chaque contact (tout
  // ce qui n'existe qu'à ces moments-là : gouttes, perles, bras levé)
  function warmPhases() {
    if (!built?.plan || !tm) return [0, 0.25, 0.5, 0.75];
    const out = [0, 0.5];
    for (const E of built.plan.events) { const u = filmTime(tm, E.tc) / tm.T; out.push(u - 0.4 / tm.T, u + 0.05 / tm.T, u + 1.5 / tm.T); }
    return out.map((x) => ((x % 1) + 1) % 1);
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setRecipe, update, warmPhases, sky, syncFinishes, syncLook, setShadowQuality, group, key, rims, plant,
    ready: () => pending === 0 && !!built && !built.error,
    error: () => built?.error ?? null,
    progress: () => (pending ? 0.3 : 1),
    get built() { return built; }, get tm() { return tm; }, get S() { return S; },
  };
}
