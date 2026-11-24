// Le cœur de Labyrinth : la scène, sa recette et le rendu d'une phase. C'est
// la source unique du rendu, partagée par la page (main.js : interface, URL,
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
// qu'elle suit (passages du relais) ; sub : décalages d'un rendu accumulé ;
// free : caméra libre (la page la pose elle-même, OrbitControls).
//
// La bille ne s'intègre pas en temps réel : sa course (et celle du plateau)
// est simulée une fois par le worker (gen/plan.js), puis relue au temps
// t = phase × durée (stage.update). L'image ne dépend que de la recette et de
// la phase : le relais peut la dessiner à n'importe quel moment.
import * as THREE from 'three/webgpu';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from '../../shared/scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from './scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { createHandheld } from '../../shared/scene/handheld.js';

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 80);
  setNoiseVolume(await gen.request({ seed: 'labyrinth-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite });
  const post = createPost(renderer, scene, camera);

  let R = null, envKey = '';
  function syncEnv() {
    const k = R.env.preset;
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
  const hand = createHandheld('labyrinth'), _hA = new THREE.Vector3(), _hT = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    const pose = stage.cameraPose(ph, camera.aspect);
    if (!free && pose) {
      camera.position.set(...pose.pos);
      // (relais : la caméra avance vers le point qu'elle suit)
      if (push) camera.position.lerp(_r.set(...pose.target), push);
      camera.up.set(0, 1, 0);
      camera.lookAt(hand.aim(camera, _hT.set(...pose.target), ph, { amp: RENDER.handheld ?? 0, duration: stage.duration() }, _hA));
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub && pose) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(!free ? _hA : _r.set(...pose.target));
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    const camDist = pose?.dist ?? 5;
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    // (brume en distances du plan : elle ne suit pas l'avancée du relais)
    scene.fog.near = camDist * 1.6; scene.fog.far = camDist * 5;
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    stage.update(ph);
    // (mise au point : elle suit l'avancée du relais)
    const dS = camDist * (1 - push);
    post.update({ ...RENDER, lite, focus: RENDER.focus * dS, focusRange: RENDER.focusRange * dS }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, syncEnv, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => stage.duration(),
    warmPhases: () => [0, 0.25, 0.5, 0.75],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
