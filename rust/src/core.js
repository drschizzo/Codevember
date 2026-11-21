// Le cœur de Rust : la scène, sa recette et le rendu d'une phase. C'est la
// source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement et sa carte de corrosion, export) et par la méga-scène
// (day.js : le relais). Retoucher la caméra, l'éclairage ou la chaîne d'image
// se fait ici, et vaut pour les deux.
//
// createCore({ renderer, width, height, gen, lite, RENDER })
//   gen    : le pool de workers de génération (shared/gen/client.js)
//   RENDER : les réglages de rendu, lus à chaque image (la page passe ceux du
//            panneau, qu'elle modifie en place ; le relais, ceux par défaut)
// → { scene, camera, stage, post, R, setRecipe, syncEnv, renderAt, isReady,
//     progress, duration, warmPhases, applyRender }
// renderAt(u, { push, sub, free }) : push ∈ [0, 1) avance la caméra vers ce
// qu'elle suit (la tête du laser, la buse, la surface du bain : passages du
// relais) ; sub : décalages d'un rendu accumulé ; free : caméra libre (la page
// la pose elle-même, OrbitControls).
import * as THREE from 'three/webgpu';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from './scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from './scene/materials.js';
import { createPost } from '../../shared/render/post.js';

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (matériaux propres au projet : lus à leur construction)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.03, 60); // (unités : mètres)
  setNoiseVolume(await gen.request({ seed: 'rust-noise' }, 'noise')); // (les matériaux en dépendent)
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

  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  let camTarget = [0, 0.6, 0];
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
  let lastPh = 0;
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    stage.update(ph);
    const pose = stage.camera(ph);
    if (!free && pose) {
      camera.position.set(...pose.pos);
      // (relais : la caméra avance vers ce qu'elle suit)
      if (push) camera.position.lerp(_r.set(...pose.target), push);
      camera.up.set(0, 1, 0);
      camera.lookAt(...pose.target);
    }
    camTarget = pose ? pose.target : camTarget;
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.006 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(_r.set(...camTarget));
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    scene.fog.near = R.fog.near; scene.fog.far = R.fog.far;
    scene.environmentRotation.set(0, R.env.rotation + R.camera.az, 0);
    // (distance réelle à la cible : elle suit l'avancée du relais, soit × (1 − push))
    const fd = camera.position.distanceTo(_r.set(...camTarget));
    post.update({ ...RENDER, lite, focus: RENDER.focus * fd, focusRange: RENDER.focusRange * fd }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, syncEnv, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => [0.02, 0.2, 0.42, 0.5, 0.6, 0.7, 0.8, 0.88, 0.95],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
