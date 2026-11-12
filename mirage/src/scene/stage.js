// La scène du mirascope : un seul lancer de rayons plein écran — les coupes et
// leurs joncs, la chaîne des petits mirascopes au fond, la table, la salle.
// Une coupe s'ouvre dans le couvercle, face à la caméra (un écorché de musée) :
// on voit le vrai petit au fond, et son image au-dessus de l'ouverture.
// La lumière ne change pas : la salle du décor, et un projecteur au-dessus de
// l'axe.
// update(ph) ne dépend que de la recette et de la phase.
import * as THREE from 'three/webgpu';
import { createRaytrace } from './raytrace.js';
import { MOODS, FAMILIES, FINISHES, kelvin } from '../recipe.js';
import { PARAB } from '../gen/mirascope.js';
import { SHELL, TABLE_Y } from '../gen/abyme.js';
import { cutAt } from '../timeline.js';
import { envPixels } from '../gen/envmap.js';

export { SHELL, TABLE_Y };

// le projecteur : une lampe ronde au-dessus de l'axe, en cône
const SPOT = { h: 0.55, lampR: 0.03, tanIn: 0.081, tanOut: 0.14 };

export function createStage(scene, gen, { lite = false } = {}) {
  const RT = createRaytrace({ lite });
  scene.add(RT.quad);
  const group = new THREE.Group(); // (vide : gardé pour les outils de mise au point)
  scene.add(group);
  let R = null, ready = false, envKey = '', envTex = null;

  function setRecipe(recipe) {
    R = recipe;
    ready = false;
    const f = R.mirascope.f, M = MOODS[R.mood];
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
    const U = RT.U, Fi = FINISHES[R.mirascope.finish];
    U.f.value = f; U.shell.value = SHELL; U.rimR.value = PARAB.rimK * f; U.holeR.value = PARAB.holeK * f; U.tableY.value = TABLE_Y;
    U.outer.value.set(Fi.color); U.outerRough.value = Fi.rough; U.engrave.value = Fi.engrave;
    const Fa = FAMILIES[R.family];
    U.style.value = Fa.style; U.jewel.value = Fa.jewel; U.pattern.value = ['vagues', 'soleil', 'spirale'].indexOf(R.pattern);
    U.jewelCol.value.set(R.stones[0]); U.jewelCol2.value.set(R.stones[1]);
    // la garniture (joncs, lèvre, pied) : le métal de la famille
    U.trim.value.set(Fa.trim ?? Fi.color);
    U.table.value.set(M.table); U.tableRough.value = M.tableRough; U.tableKind.value = M.tableKind; U.envI.value = M.envI;
    const lc = new THREE.Color(kelvin(M.lamp));
    U.keyCol.value.set(lc.r * M.key, lc.g * M.key, lc.b * M.key);
    U.ambient.value.setScalar(M.ambient);
    U.keyDir.value.set(0.45, 0.8, 0.35).normalize(); // (la lampe : de côté, haute, fixe dans le monde)
    U.room.value = 1; U.lift.value = 0;
    U.enamel.value.set(R.mirascope.enamel);
    // la coupe du couvercle : face à la caméra (azimut az, convention atan2(x, z))
    const az = (R.camera.az * Math.PI) / 180;
    U.cutC.value.set(Math.sin(az), 0, Math.cos(az));
    // le projecteur : une lampe à incandescence, un peu plus chaude que blanche
    const sc = new THREE.Color(kelvin(R.light.spotK));
    U.spotCol.value.set(sc.r, sc.g, sc.b).multiplyScalar(R.light.spot);
    U.spotSheen.value = R.light.sheen;
    U.spotH.value = SPOT.h; U.lampR.value = SPOT.lampR; U.spotIn.value = SPOT.tanIn; U.spotOut.value = SPOT.tanOut;
    ready = true;
  }

  return {
    group, get raytrace() { return RT; },
    setRecipe,
    // la coupe : son ouverture à la phase ph (la même dans le repère de chaque niveau)
    update(ph) {
      if (!ready) return;
      const U = RT.U, h = cutAt(R, ph), az = (R.camera.az * Math.PI) / 180, th = Math.atan2(Math.cos(az), Math.sin(az));
      U.cutOn.value = h > 1e-4 ? 1 : 0; U.cutCos.value = Math.cos(h);
      U.cutE1.value.set(Math.cos(th + h), 0, Math.sin(th + h)); U.cutE2.value.set(Math.cos(th - h), 0, Math.sin(th - h));
    },
    ready: () => ready,
    exposure: () => 1,
    progress: () => (ready ? 1 : 0),
    error: () => null,
    setShadowQuality: () => {},
    syncFinishes: () => {},
  };
}
