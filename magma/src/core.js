// Le cœur de Magma : la scène, sa recette, son ciel et le rendu d'une phase.
// C'est la source unique du rendu, partagée par la page (main.js : interface,
// URL, écran de chargement, export) et par la méga-scène (day.js : le relais).
// Retoucher la caméra, l'éclairage ou la chaîne d'image se fait ici, et vaut
// pour les deux.
//
// createCore({ renderer, width, height, gen, lite, RENDER, onError })
//   gen     : le pool de workers de génération (shared/gen/client.js)
//   RENDER  : les réglages de rendu, lus à chaque image (la page passe ceux du
//             panneau, qu'elle modifie en place ; le relais, ceux par défaut)
//   onError : (message) → la page l'affiche sur son écran de chargement
// → { scene, camera, stage, post, R, setRecipe, syncEnv, renderAt, isReady,
//     progress, duration, warmPhases, applyRender }
// setRecipe(r) : lance la génération (promesse de stage.setRecipe) et le ciel.
// renderAt(u, { push, sub, free }) : push ∈ [0, 1) avance la caméra vers le
// front (passages du relais) ; sub : décalages d'un rendu accumulé ; free :
// caméra libre (la page la pose elle-même, OrbitControls).
import * as THREE from 'three/webgpu';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from '../../shared/scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from '../../shared/scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { createHandheld } from '../../shared/scene/handheld.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;

export async function createCore({ renderer, width, height, gen, lite = false, RENDER, onError = () => {} }) {
  setLite(lite); // (matériaux partagés : lus à leur construction)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.03, 60);
  setNoiseVolume(await gen.request({ seed: 'magma-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, renderer, gen, { lite });
  const post = createPost(renderer, scene, camera, { overlay: stage.fumes.overlay, aoSamples: 8 });

  let R = null;
  // ciel de l'humeur : calculé dans un worker (gen/sky.js), en radiance de scène
  let envKey = '', envReady = false;
  function syncEnv() {
    const k = JSON.stringify(R.sky);
    if (k === envKey) return;
    envKey = k; envReady = false;
    const W = lite ? 512 : 1024;
    gen.request({ sky: R.sky, W }, 'sky').then(({ pixels }) => {
      if (JSON.stringify(R.sky) !== k) return;
      const old = scene.environment;
      scene.environment = makeEnvironment(pixels, 0, W);
      old?.dispose();
      envReady = true;
    }).catch((e) => onError(`Ciel : ${e.message}`));
  }
  function setRecipe(r) {
    R = r;
    const p = stage.setRecipe(R);
    syncEnv();
    return p;
  }

  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
  let lastPh = 0;
  const hand = createHandheld('magma'), _hA = new THREE.Vector3(), _hT = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    if (!free) {
      // caméra périodique en ph (même pose à 0 et à 1) : un plan fixe qui
      // respire à peine (balancement périodique de quelques cm), jamais une
      // dérive ; relais : la caméra avance vers le front
      const p = C.pitch * DEG, yw = C.yaw + C.sway * Math.sin(TAU * ph);
      const tx = C.target[0] + C.sway * 0.6 * Math.sin(TAU * ph + 1.3), tz = C.target[1];
      const d = C.dist * (1 + C.sway * 0.5 * Math.cos(TAU * ph)) * (1 - push);
      camera.position.set(tx + Math.sin(yw) * Math.cos(p) * d, Math.sin(p) * d, tz + Math.cos(yw) * Math.cos(p) * d);
      camera.up.set(0, 1, 0);
      camera.lookAt(hand.aim(camera, _hT.set(tx, 0, tz), ph, { amp: RENDER.handheld ?? 0, duration: R.loop.duration }, _hA));
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(!free ? _hA : _r.set(C.target[0], 0, C.target[1]));
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    scene.fog.near = R.fog.near ?? 6; scene.fog.far = R.fog.far ?? 20;
    scene.environmentIntensity = 1;
    // (raccord de boucle : la nappe redescend d'un coup, mais l'image est la
    // même — on garde l'historique de l'anticrénelage temporel, avec des
    // vitesses nulles pour cette image (stage.js) ; le réinitialiser rendait
    // une image sans lissage, où la peau changeait d'aspect)
    camera.updateMatrixWorld();
    stage.update(u, camera);
    const dS = C.dist * (1 - push); // (la mise au point suit l'avancée du relais)
    post.update({ ...RENDER, lite, focus: RENDER.focus * dS, focusRange: RENDER.focusRange * dS }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, syncEnv, renderAt,
    isReady: () => stage.ready() && envReady,
    progress: () => stage.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => [0, 0.3, 0.5, 0.8],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
