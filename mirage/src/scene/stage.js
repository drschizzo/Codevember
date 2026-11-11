// La scène du mirascope : le lancer de rayons plein écran (les coupes, l'objet,
// la table, le studio), et par-dessus le mécanisme dessiné comme des objets
// ordinaires — le pied tourné, la potence à crémaillère, le pignon et sa
// manivelle, le bras à fourche qui tient la coupe du haut par son bord.
// update(ph) ne dépend que de la recette et de la phase.
import * as THREE from 'three/webgpu';
import { createRaytrace } from './raytrace.js';
import { MOODS, FAMILIES, FINISHES, kelvin } from '../recipe.js';
import { liftAt, objectAt } from '../timeline.js';
import { PARAB } from '../gen/mirascope.js';
import { buildMachine, machineMaterial, SHELL, PINION_R, SCREW_PITCH, DRUM_R } from './machine.js';
import { envPixels } from '../gen/envmap.js';

export const TABLE_Y = -0.03;
export { SHELL };

function toGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('mat', new THREE.BufferAttribute(o.mat, 4, true));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}

export function createStage(scene, gen, { renderer, camera, lite = false } = {}) {
  // (un lancer de rayons par famille d'objet : le shader ne contient que l'objet de la scène)
  const RTs = {};
  let RT = null;
  const raytraceFor = (kind) => {
    if (!RTs[kind]) RTs[kind] = createRaytrace({ lite, kind });
    if (RT !== RTs[kind]) { if (RT) scene.remove(RT.quad); RT = RTs[kind]; scene.add(RT.quad); }
    return RT;
  };
  const group = new THREE.Group();
  scene.add(group);
  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera; sc.left = -0.2; sc.right = 0.2; sc.top = 0.2; sc.bottom = -0.2; sc.near = 0.01; sc.far = 2;
  key.shadow.bias = -0.0003;
  scene.add(key, key.target);
  let R = null, ready = false, envKey = '', mech = null, f = PARAB.f, envTex = null, movers = {}, cords = [];
  // l'ombre de la machinerie sur la table (la table est tracée par le quad :
  // un plan qui ne garde que les ombres, posé dessus)
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShadowNodeMaterial({ opacity: 0.55 }));
  const casterMat = new THREE.MeshBasicNodeMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  catcher.rotation.x = -Math.PI / 2; catcher.position.y = TABLE_Y + 0.00005; catcher.receiveShadow = true;

  function setRecipe(recipe) {
    R = recipe;
    ready = false;
    f = R.mirascope.f;
    const M = MOODS[R.mood];
    raytraceFor(FAMILIES[R.family].kind);
    if (M.env !== envKey) {
      envKey = M.env;
      const W = lite ? 512 : 1024;
      const tex = new THREE.DataTexture(envPixels(M.env, 0, W), W, W / 2, THREE.RGBAFormat, THREE.HalfFloatType);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true;
      tex.needsUpdate = true;
      envTex = tex;
      scene.environment = tex;
    }
    if (RT.T.env.value !== envTex) RT.T.env.value = envTex;
    scene.environmentIntensity = M.envI;
    // la machinerie : socle, appareil, bords des coupes (tournée de « yaw »)
    group.traverse((o) => { if (o.isMesh && o !== catcher) { o.geometry.dispose(); if (o.material !== casterMat) o.material.dispose(); } });
    group.clear();
    mech = buildMachine(R.mechanism.kind, f, TABLE_Y);
    group.rotation.y = (R.mechanism.yaw * Math.PI) / 180;
    const add = (parent, M, kind) => {
      const o = M.out(); if (!o.index.length) return;
      const m = new THREE.Mesh(toGeometry(o), machineMaterial(kind));
      m.castShadow = true; m.receiveShadow = true; parent.add(m);
    };
    add(group, mech.P.metal, 'metal'); add(group, mech.P.wood, 'wood'); add(group, mech.P.stone, 'stone'); add(group, mech.P.cord, 'cord'); add(group, mech.P.lo, 'metal');
    movers = {};
    for (const [k, mv] of Object.entries(mech.mov)) {
      if (k === 'cords') continue;
      const gq = new THREE.Group(); gq.position.set(...mv.pivot); group.add(gq);
      add(gq, mv.M, 'metal'); add(gq, mv.W, 'wood');
      movers[k] = { g: gq, mv };
    }
    // cordes du couvercle (poulies) : trois cylindres unité, posés à chaque image
    cords = [];
    if (mech.mov.cords) for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0005, 0.0005, 1, 6, 1, true), new THREE.MeshStandardNodeMaterial({ color: 0xc4b8a0, roughness: 0.9 }));
      m.castShadow = true; group.add(m); cords.push(m);
    }
    group.add(catcher);
    // les coupes elles-mêmes (tracées par le quad) portent leur ombre par des
    // doublures invisibles, qui n'écrivent que dans la carte d'ombre
    const R0 = PARAB.rimK * f, rh = PARAB.holeK * f, N = 40;
    const lo = [], up = [];
    for (let k = 0; k <= N; k++) { const r = (R0 * k) / N; lo.push(new THREE.Vector2(r, (r * r) / (4 * f) - SHELL / 2)); }
    for (let k = 0; k <= N; k++) { const r = rh + ((R0 - rh) * k) / N; up.push(new THREE.Vector2(r, f - (r * r) / (4 * f) + SHELL / 2)); }
    for (const [pts, parent] of [[lo, group], [up, movers.lid.g]]) {
      const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 96), casterMat);
      m.castShadow = true; m.receiveShadow = false; parent.add(m);
    }
    // uniformes de la recette
    const U = RT.U, Fi = FINISHES[R.mirascope.finish], Fa = FAMILIES[R.family];
    U.f.value = f; U.shell.value = SHELL; U.rimR.value = PARAB.rimK * f; U.holeR.value = PARAB.holeK * f; U.tableY.value = TABLE_Y;
    U.outer.value.set(Fi.color); U.outerRough.value = Fi.rough; U.engrave.value = Fi.engrave;
    U.table.value.set(M.table); U.tableRough.value = M.tableRough; U.tableKind.value = M.tableKind; U.envI.value = M.envI;
    U.kind.value = Fa.kind; U.objCol.value.set(R.object.c1); U.objCol2.value.set(R.object.c2); U.tilt.value = R.object.tilt;
    const lc = new THREE.Color(kelvin(M.lamp));
    U.keyCol.value.set(lc.r * M.key, lc.g * M.key, lc.b * M.key);
    U.ambient.value.setScalar(M.ambient);
    U.flicker.value = R.family === 'bougie' ? 1 : 0;
    key.color.copy(lc); key.intensity = M.key * 1.2;
    ready = true;
  }

  function update(ph) {
    if (!ready) return;
    const U = RT.U, L = liftAt(ph) * R.mirascope.liftMax, o = objectAt(R, ph);
    U.lift.value = L;
    U.needle.value = o.needle; U.cardRot.value = R.object.cardRot ?? 0;
    U.spin.value = o.spin; U.hands.value.set(...o.hands); U.time.value = o.time;
    // la lampe : de côté, haute, fixe dans le monde
    const kd = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
    U.keyDir.value.copy(kd);
    key.position.copy(kd).multiplyScalar(0.8); key.target.position.set(0, 0, 0); key.target.updateMatrixWorld();
    // la machinerie suit la levée
    for (const [k, { g: gq, mv }] of Object.entries(movers)) {
      if (k === 'lid') gq.position.y = L;
      else if (k === 'knob') { gq.position.y = mv.pivot[1] + L; gq.rotation.z = -L / PINION_R; } // (le pignon roule sur la crémaillère)
      else if (k.startsWith('screw')) gq.rotation.y = -(2 * Math.PI * L) / SCREW_PITCH; // (un tour de vis = un pas)
      else if (k === 'drum') gq.rotation.z = L / DRUM_R; // (le tambour enroule la corde)
    }
    if (cords.length) {
      const { pul, R: Rr, f: ff, yS } = mech.mov.cords;
      for (let k = 0; k < 3; k++) {
        const [c, s2] = pul[k];
        const a = new THREE.Vector3(c * (Rr + 0.004), ff / 2 + SHELL + 0.0046 + L, s2 * (Rr + 0.004)), b = new THREE.Vector3(c * (Rr + 0.0042), yS + 0.005, s2 * (Rr + 0.0042));
        cords[k].position.copy(a).add(b).multiplyScalar(0.5);
        cords[k].scale.set(1, a.distanceTo(b), 1);
        cords[k].quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      }
    }
  }

  return {
    group, get raytrace() { return RT; },
    setRecipe, update,
    ready: () => ready,
    exposure: () => 1,
    progress: () => (ready ? 1 : 0),
    error: () => null,
    setShadowQuality: () => {},
    syncFinishes: () => {},
  };
}
