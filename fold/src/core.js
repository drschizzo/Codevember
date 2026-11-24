// Le cœur de Fold : la scène, sa recette et le rendu d'une phase. C'est la
// source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement, export) et par la méga-scène (day.js : le relais).
// Retoucher la caméra, l'éclairage ou la chaîne d'image se fait ici, et vaut
// pour les deux.
//
// createCore({ renderer, width, height, gen, lite, RENDER })
//   gen    : le pool de workers de génération (shared/gen/client.js)
//   RENDER : les réglages de rendu, lus à chaque image (la page passe ceux du
//            panneau, qu'elle modifie en place ; le relais, ceux par défaut)
// → { scene, camera, stage, post, R, setRecipe, syncEnv, renderAt, isReady,
//     progress, duration, warmPhases, applyRender }
// renderAt(u, { push, sub, free }) : push ∈ [0, 1) avance la caméra vers ce
// qu'elle regarde (passages du relais) ; sub : sans effet (pas de décalages de
// lentille ni de pixel dans le rendu de Fold) ; free : caméra libre (la page la
// pose elle-même, OrbitControls).
import * as THREE from 'three/webgpu';
import { MOODS } from './recipe.js';
import { createStage, cameraAt } from './scene/stage.js';
import { G } from '../../shared/scene/globals.js';
import { makeEnvironment } from '../../shared/scene/env.js';
import { setLite } from '../../shared/scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { createHandheld } from '../../shared/scene/handheld.js';

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(26, width / height, 0.2, 90);
  const stage = createStage(scene, gen, { lite });
  const post = createPost(renderer, scene, camera);

  let R = null, envKey = '';
  function syncEnv() {
    const M = MOODS[R.mood];
    if (envKey !== 'cyclo') { envKey = 'cyclo'; scene.environment = makeEnvironment('cyclo', 0, lite ? 512 : 1024); }
    scene.environmentIntensity = M.envI;
    scene.background.set(M.wall);
  }
  function setRecipe(r) {
    R = r;
    stage.setRecipe(R);
    syncEnv();
  }

  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  const _t = new THREE.Vector3();
  let lastPh = 0;
  const hand = createHandheld('fold'), _hA = new THREE.Vector3(), _hT = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = cameraAt(R, ph, camera.aspect);
    if (!free) {
      // caméra périodique en ph (même pose à 0 et à 1) : un balancement lent
      camera.position.set(...C.pos);
      // (relais : la caméra avance vers ce qu'elle regarde)
      if (push) camera.position.lerp(_t.set(...C.tgt), push);
      camera.up.set(0, 1, 0);
      camera.lookAt(hand.aim(camera, _hT.set(...C.tgt), ph, { amp: RENDER.handheld ?? 0, duration: R.loop.duration }, _hA));
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    stage.update(ph);
    const dS = (C.dist ?? 5) * (1 - push);
    post.update({ ...RENDER, lite, exposure: RENDER.exposure * (R.grade?.exposure ?? 1), focus: RENDER.focus * dS, focusRange: RENDER.focusRange * dS }, R);
    // (ombres colorées, la lumière qui traverse le papier : le moteur est
    // commun aux jours du relais, le réglage commun est rendu après. Le
    // filtre doux, PCFSoftShadowMap, n'existe plus dans three.js 0.186 : le
    // moteur prenait PCFShadowMap en le signalant à chaque image)
    const sm = renderer.shadowMap, transmitted = sm.transmitted;
    sm.transmitted = true;
    try { post.render(); } finally { sm.transmitted = transmitted; }
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, syncEnv, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => [0.001],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
