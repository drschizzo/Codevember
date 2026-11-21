// Le cœur de Caustic : la scène, sa recette et le rendu d'une phase. C'est la
// source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement du transport optimal, export) et par la méga-scène
// (day.js : le relais). Retoucher la caméra, l'éclairage ou la chaîne d'image
// se fait ici, et vaut pour les deux.
//
// createCore({ renderer, width, height, gen, lite, RENDER })
//   gen    : le générateur, sous la signature du client local de Caustic :
//            request(spec, what, { onProgress, noCache }) (le relais adapte
//            le pool commun, voir day.js)
//   RENDER : les réglages de rendu, lus à chaque image (la page passe ceux du
//            panneau, qu'elle modifie en place ; le relais, ceux par défaut)
// → { scene, camera, stage, post, R, setRecipe, syncEnv, syncClock, renderAt,
//     isReady, progress, duration, warmPhases, applyRender }
// renderAt(u, { push, sub, free }) : push ∈ [0, 1) avance la caméra vers le
// fond de la cuve (passages du relais) ; sub : décalages d'un rendu accumulé ;
// free : caméra libre (la page la pose elle-même, OrbitControls).
import * as THREE from 'three/webgpu';
import { cameraPose, foyerClock } from './timeline.js';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from './scene/env.js';
import { G } from './scene/globals.js';
import { setNoiseVolume, setLite } from './scene/materials.js';
import { createPost } from '../../shared/render/post.js';

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.01, 40); // (unités : mètres)
  setNoiseVolume(await gen.request({ seed: 'caustic-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite, renderer });
  const post = createPost(renderer, scene, camera);

  let R = null, envKey = '', clock = null;
  function syncEnv() {
    const k = R.env.preset;
    if (k === envKey) return;
    envKey = k;
    const old = scene.environment;
    scene.environment = makeEnvironment(k, 0, lite ? 512 : 1024);
    old?.dispose();
  }
  // l'horloge des Foyers (timeline.js), à refaire quand la recette est retouchée
  function syncClock() { if (R) clock = R.family === 'foyer' ? foyerClock(R) : null; }
  function setRecipe(r) {
    R = r;
    syncEnv(); // (avant les matériaux : l'eau et la vitre reflètent le studio)
    syncClock();
    stage.setRecipe(R);
  }

  // ── Rendu d'une phase ──
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    // (G est propre à Caustic : pas de phase précédente à remettre dans le relais)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    if (!free) {
      // caméra périodique en ph (même pose à 0 et à 1), voir timeline.js
      const pose = cameraPose(R, ph, clock);
      camera.position.set(...pose.pos);
      // (relais : la caméra avance vers ce qu'elle regarde)
      if (push) camera.position.lerp(_r.set(...pose.target), push);
      camera.up.set(0, 1, 0);
      camera.lookAt(...pose.target);
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(_r.set(...C.target));
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.bg[1]);
    scene.environmentIntensity = R.env.intensity;
    G.envI.value = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    stage.update(ph);
    const dS = C.dist * (1 - push); // (la mise au point suit l'avancée du relais)
    post.update({ ...RENDER, lite, focus: RENDER.focus * dS, focusRange: RENDER.focusRange * dS }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, syncEnv, syncClock, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => [0, 0.25, 0.5, 0.75],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
