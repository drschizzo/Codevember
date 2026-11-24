// Le cœur d'Echo : la scène, sa recette et le rendu d'une phase. C'est la
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
// qu'elle regarde (passages du relais) ; sub : décalages d'un rendu accumulé ;
// free : caméra libre (la page la pose elle-même, OrbitControls).
//
// Les glaces (reflector de three.js) rendent la pièce depuis la caméra
// symétrique dans leur propre cible, puis reviennent à la cible en cours :
// rien n'est dessiné dans le canvas hors de la chaîne d'image.
import * as THREE from 'three/webgpu';
import { MOODS } from './recipe.js';
import './gen/envmap.js'; // (studios propres à Echo, ajoutés aux préréglages communs)
import { createStage } from './scene/stage.js';
import { makeEnvironment } from '../../shared/scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from '../../shared/scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { createHandheld } from '../../shared/scene/handheld.js';

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 80);
  setNoiseVolume(await gen.request({ seed: 'echo-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite, renderer });
  const post = createPost(renderer, scene, camera, { haze: stage.haze, aoSamples: 8 });

  let R = null, envKey = '';
  function syncEnv() {
    const k = MOODS[R.mood].env;
    if (k === envKey) return;
    envKey = k;
    const old = scene.environment;
    scene.environment = makeEnvironment(k, 0, lite ? 512 : 1024);
    old?.dispose();
  }
  function setRecipe(r) {
    R = r;
    stage.setRecipe(R);
    syncEnv();
  }

  // ── Rendu d'une phase ──
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
  let lastPh = 0;
  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  const hand = createHandheld('echo'), _hA = new THREE.Vector3(), _hT = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = stage.camera(ph);
    if (!free) {
      // caméra du film (film.js, cameraAt) : un plan fixe qui glisse, périodique en u
      camera.position.set(...C.pos);
      // (relais : la caméra avance vers ce qu'elle regarde)
      if (push) camera.position.lerp(_r.set(...C.target), push);
      camera.up.set(0, 1, 0);
      camera.lookAt(hand.aim(camera, _hT.set(...C.target), ph, { amp: RENDER.handheld ?? 0, duration: R.film.duration }, _hA));
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    const focusD = Math.hypot(C.pos[0] - C.target[0], C.pos[1] - C.target[1], C.pos[2] - C.target[2]) * (1 - push);
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(!free ? _hA : _r.set(...C.target));
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    const Md = MOODS[R.mood];
    scene.background.set(Md.bg);
    scene.fog.color.set(Md.bg);
    scene.fog.near = 6; scene.fog.far = 30;
    scene.environmentIntensity = 1;
    scene.environmentRotation.set(0, 0, 0);
    stage.update(ph, camera);
    post.update({ ...RENDER, lite, focus: RENDER.focus * focusD, focusRange: RENDER.focusRange * focusD }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, syncEnv, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => R.film.duration,
    warmPhases: () => [0.02, 0.2, 0.3, 0.47, 0.7],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
