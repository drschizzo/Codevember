// Le cœur de Moss : la scène, sa recette et le rendu d'une phase. C'est la
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
// setRecipe et syncEnv rendent la promesse du ciel (calculé par un worker).
// renderAt(u, { push, sub, free, target }) : push ∈ [0, 1) avance la caméra
// vers le coussin (passages du relais) ; sub : décalages d'un rendu accumulé ;
// free : caméra libre (la page la pose elle-même, OrbitControls, dont target
// est le point visé).
import * as THREE from 'three/webgpu';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from './scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from '../../shared/scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { createHandheld } from '../../shared/scene/handheld.js';

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.02, 900);
  setLite(lite);
  setNoiseVolume(await gen.request({ seed: 'moss-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite });
  const post = createPost(renderer, scene, camera);

  // (le ciel HDR est calculé par un worker de génération : le fil principal
  // ne fait que poser la texture)
  let R = null, envKey = '', envReq = null, envReady = false;
  function syncEnv() {
    const k = R.env.preset;
    if (k === envKey) return envReq ?? Promise.resolve();
    envKey = k;
    envReady = false;
    const W = lite ? 512 : 1024;
    return (envReq = gen.request({ key: k, W }, 'env').then(({ data }) => {
      if (envKey !== k) return;
      const old = scene.environment;
      scene.environment = makeEnvironment(k, 0, W, data);
      old?.dispose();
      envReady = true;
    }));
  }
  function setRecipe(r) {
    R = r;
    stage.setRecipe(R);
    return syncEnv();
  }

  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _t = new THREE.Vector3();
  let lastPh = 0;
  const hand = createHandheld('moss'), _hA = new THREE.Vector3(), _hT = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  function renderAt(u, { push = 0, sub = null, free = false, target = null } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    const st = stage.update(u, camera);
    const pose = st?.pose;
    if (!free && pose) {
      camera.position.set(...pose.pos);
      // (relais : la caméra avance vers le coussin)
      if (push) camera.position.lerp(_t.set(...pose.target), push);
      camera.up.set(0, 1, 0);
      camera.lookAt(hand.aim(camera, _r.set(...pose.target), ph, { amp: RENDER.handheld ?? 0, duration: R.loop.duration }, _hA));
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    const canvas = renderer.domElement;
    if (sub && pose) {
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      // (ouverture de l'objectif macro : la vraie profondeur de champ du rendu accumulé)
      const ap = 0.05 * (RENDER.dof ? RENDER.bokeh / 2 : 0.3) * C.aperture;
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(!free ? _hA : _r.set(...pose.target));
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    stage.moss.U.px.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, canvas.height);
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    if (st) {
      scene.background.copy(st.fogColor);
      scene.fog.color.copy(st.fogColor);
      scene.fog.near = 3; scene.fog.far = 3 + 90 / Math.max(0.05, st.fogDensity);
    }
    scene.environmentIntensity = R.env.intensity * (st ? 0.55 + 0.45 * st.clear : 1);
    scene.environmentRotation.set(0, R.env.rotation, 0);
    const focus = free ? camera.position.distanceTo(target) : (pose?.focus ?? 5) * (1 - push);
    post.update({ ...RENDER, lite, focus: focus * RENDER.focus, focusRange: focus * RENDER.focusRange / C.aperture }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, syncEnv, renderAt,
    isReady: () => stage.ready() && envReady,
    progress: () => stage.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => [0, 0.16, 0.3, 0.5, 0.7, 0.9],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
