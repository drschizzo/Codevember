// La scène du mirascope : le lancer de rayons plein écran (les coupes, l'objet,
// la table, le studio), et par-dessus le mécanisme dessiné comme des objets
// ordinaires — le pied tourné, la potence à crémaillère, le pignon et sa
// manivelle, le bras à fourche qui tient la coupe du haut par son bord.
// update(ph) ne dépend que de la recette et de la phase.
import * as THREE from 'three/webgpu';
import { vec3, float, attribute, pow } from 'three/tsl';
import { createRaytrace } from './raytrace.js';
import { MOODS, FAMILIES, FINISHES, kelvin } from '../recipe.js';
import { liftAt, objectAt } from '../timeline.js';
import { PARAB } from '../gen/mirascope.js';
import { Mesh, box, cyl, lathe } from '../gen/subjects.js';
import { envPixels } from '../gen/envmap.js';

const BRASS = [205, 168, 98, 70], WOOD = [70, 44, 28, 160];
export const TABLE_Y = -0.03;
export const SHELL = 0.0025; // (épaisseur des coupes, comme U.shell)

function toGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('mat', new THREE.BufferAttribute(o.mat, 4, true));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}
function material(metal) {
  const m = new THREE.MeshStandardNodeMaterial();
  const a = attribute('mat', 'vec4');
  m.colorNode = pow(a.rgb, vec3(2.2));
  m.roughnessNode = a.a.mul(0.9).add(0.06);
  m.metalnessNode = float(metal ? 1 : 0);
  return m;
}

// le mécanisme (m) : fixe (pied, potence, crémaillère) et mobile (bras, fourche)
function mechanism(f) {
  const R = PARAB.rimK * f, fixedB = new Mesh(), fixedW = new Mesh(), mob = new Mesh(), knob = new Mesh();
  const cx = R + 0.05;
  // pied tourné sous la coupe du bas, coupelle qui épouse sa coque
  lathe(fixedW, 0, 0, [[0, TABLE_Y], [0.034, TABLE_Y], [0.035, TABLE_Y + 0.004], [0.026, TABLE_Y + 0.007], [0.012, TABLE_Y + 0.016], [0.011, TABLE_Y + 0.022], ...[0.018, 0.012, 0.006, 0].map((r) => [r, (r * r) / (4 * f) - SHELL])], WOOD, 48);
  lathe(fixedB, 0, 0, [[0.0185, TABLE_Y + 0.0215], [0.0185, TABLE_Y + 0.0235]], BRASS, 48);
  // socle et colonne de la potence, crémaillère
  box(fixedW, [cx, TABLE_Y + 0.006, 0], [0.03, 0.006, 0.03], WOOD);
  cyl(fixedB, [cx, TABLE_Y + 0.012, 0], [cx, 0.17, 0], 0.0065, 0.0055, BRASS, 20);
  lathe(fixedB, cx, 0, [[0.012, TABLE_Y + 0.012], [0.011, TABLE_Y + 0.016], [0.0075, TABLE_Y + 0.02]], BRASS, 24);
  lathe(fixedB, cx, 0, [[0.0075, 0.168], [0.009, 0.171], [0.006, 0.176], [0, 0.177]], BRASS, 20);
  for (let k = 0; k < 34; k++) box(fixedB, [cx - 0.0068, 0.012 + k * 0.0042, 0], [0.0012, 0.0011, 0.0028], BRASS);
  // le bras (monte avec le couvercle) : coulisseau, potence, fourche qui pince le bord
  const yA = f / 2 + 0.006;
  box(mob, [cx, yA, 0], [0.011, 0.012, 0.011], BRASS);
  cyl(mob, [cx - 0.004, yA + 0.006, 0], [R + 0.012, yA + 0.006, 0], 0.0035, 0.0035, BRASS, 14);
  for (const s of [-1, 1]) {
    const a = s * 0.55;
    cyl(mob, [R + 0.012, yA + 0.006, 0], [(R + 0.004) * Math.cos(a), yA + 0.004, (R + 0.004) * Math.sin(a)], 0.0026, 0.0026, BRASS, 12);
    box(mob, [(R + 0.003) * Math.cos(a), f / 2 + 0.002, (R + 0.003) * Math.sin(a)], [0.003, 0.004, 0.0025], BRASS, -a);
  }
  // pignon et manivelle (tournent avec la levée)
  cyl(knob, [0, 0, -0.012], [0, 0, 0.012], 0.0075, 0.0075, BRASS, 24);
  cyl(knob, [0, 0, 0.012], [0.02, 0, 0.016], 0.0022, 0.0022, BRASS, 10);
  cyl(knob, [0.02, 0, 0.016], [0.02, 0, 0.03], 0.0032, 0.003, WOOD, 12);
  return { fixedB: fixedB.out(), fixedW: fixedW.out(), mob: mob.out(), knob: knob.out(), cx, yA };
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
  let R = null, ready = false, envKey = '', mech = null, f = PARAB.f, envTex = null;
  const meshes = {};

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
    for (const m of Object.values(meshes)) { group.remove(m); m.geometry.dispose(); m.material.dispose(); }
    mech = mechanism(f);
    for (const [k, metal] of [['fixedB', 1], ['fixedW', 0], ['mob', 1], ['knob', 1]]) {
      const m = new THREE.Mesh(toGeometry(mech[k]), material(metal));
      m.castShadow = true; m.receiveShadow = true;
      group.add(m); meshes[k] = m;
    }
    // uniformes de la recette
    const U = RT.U, Fi = FINISHES[R.mirascope.finish], Fa = FAMILIES[R.family];
    U.f.value = f; U.shell.value = SHELL; U.rimR.value = PARAB.rimK * f; U.holeR.value = PARAB.holeK * f; U.tableY.value = TABLE_Y;
    U.outer.value.set(Fi.color); U.outerRough.value = Fi.rough; U.engrave.value = Fi.engrave;
    U.table.value.set(M.table); U.tableRough.value = M.tableRough; U.envI.value = M.envI;
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
    U.spin.value = o.spin; U.hands.value.set(...o.hands); U.time.value = o.time;
    // la lampe : de côté, haute, fixe dans le monde
    const kd = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
    U.keyDir.value.copy(kd);
    key.position.copy(kd).multiplyScalar(0.8); key.target.position.set(0, 0, 0); key.target.updateMatrixWorld();
    // le mécanisme suit la levée
    meshes.mob.position.y = L;
    meshes.knob.position.set(mech.cx + 0.012, TABLE_Y + 0.05, 0);
    meshes.knob.rotation.z = -L / 0.0075; // (le pignon roule sur la crémaillère : θ = L / r)
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
