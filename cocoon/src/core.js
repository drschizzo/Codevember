// Le cœur de Cocoon : la scène, sa recette et le rendu d'une phase. C'est la
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
// renderAt(u, { push, sub, free, live }) : push ∈ [0, 1) avance la caméra vers
// ce qu'elle regarde (passages du relais) ; sub : décalages d'un rendu
// accumulé ; free : caméra libre (la page la pose elle-même, OrbitControls) ;
// live : la lecture (ombres des lampes en alternance, stage.update).
import * as THREE from 'three/webgpu';
import { createStage } from './scene/stage.js';
import { cameraPose } from './timeline.js';
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
  const camera = new THREE.PerspectiveCamera(32, width / height, 0.03, 40);
  setNoiseVolume(await gen.request({ seed: 'cocoon-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite, renderer });
  camera.layers.enable(1); // (les fils)
  const post = createPost(renderer, scene, camera, { haze: stage.haze, aoSamples: 8 }); // (sous le TRAA, 8 échantillons d'occlusion suffisent)

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

  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _t = new THREE.Vector3();
  let lastPh = 0;
  const hand = createHandheld('cocoon'), _hA = new THREE.Vector3(), _hT = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  function renderAt(u, { push = 0, sub = null, free = false, live = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    const lay = stage.data()?.lay ?? { yc: 1.2 };
    const pose = cameraPose(R, ph, lay);
    if (!free) {
      // (le cadrage est calculé pour du 16:9 ; un écran plus étroit recule la
      // caméra pour garder les deux lanternes)
      const narrow = Math.min(2.2, Math.max(1, 16 / 9 / camera.aspect)) ** 0.62;
      for (let i = 0; i < 3; i++) pose.pos[i] = pose.target[i] + (pose.pos[i] - pose.target[i]) * narrow;
      camera.position.set(...pose.pos);
      // (relais : la caméra avance vers ce qu'elle vise)
      if (push) camera.position.lerp(_t.set(...pose.target), push);
      camera.up.set(0, 1, 0);
      camera.lookAt(hand.aim(camera, _hT.set(...pose.target), ph, { amp: RENDER.handheld ?? 0, duration: R.loop.duration }, _hA));
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(!free ? _hA : _r.set(...pose.target));
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    scene.fog.near = R.fog.near; scene.fog.far = R.fog.far;
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    stage.update(ph, camera, { live });
    // (mise au point sur la visée de la caméra du film : la lanterne qui s'enroule en gros plan)
    const fd = Math.hypot(pose.pos[0] - pose.target[0], pose.pos[1] - pose.target[1], pose.pos[2] - pose.target[2]) * (1 - push);
    // (SSR seulement sur un sol assez brillant pour refléter : ailleurs, elle coûte sans se voir)
    post.update({ ...RENDER, ssr: RENDER.ssr && (R.room.floorRough ?? 1) < 0.6, lite, focus: RENDER.focus * fd, focusRange: RENDER.focusRange * fd }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, syncEnv, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => [0, 0.25, 0.5, 0.75],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
