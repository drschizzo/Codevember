// Le cœur de Tangle : la scène, sa recette et le rendu d'une phase. C'est la
// source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement, export) et par la méga-scène (day.js : le relais).
// Retoucher la caméra, l'éclairage ou la chaîne d'image se fait ici, et vaut
// pour les deux.
//
// createCore({ renderer, width, height, gen, lite, RENDER, onSimPart, onSim })
//   gen    : le générateur, créé par l'appelant (la page : gen/client.js, qui
//            envoie les états de la simulation en route ; le relais : le pool
//            commun, sans états en route)
//   RENDER : les réglages de rendu, lus à chaque image (la page passe ceux du
//            panneau, qu'elle modifie en place ; le relais, ceux par défaut)
//   onSimPart, onSim : la simulation en route, puis arrivée (le dessin de
//            l'écran de chargement de la page)
// → { scene, camera, stage, post, camPose, R, setRecipe, syncEnv, renderAt,
//     isReady, progress, duration, warmPhases, applyRender }
// renderAt(u, { push, sub, free }) : push ∈ [0, 1) avance la caméra vers ce
// qu'elle regarde (passages du relais) ; sub : décalages d'un rendu accumulé ;
// free : caméra libre (la page la pose elle-même, OrbitControls).
import * as THREE from 'three/webgpu';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from './scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from './scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { createHandheld } from '../../shared/scene/handheld.js';

export async function createCore({ renderer, width, height, gen, lite = false, RENDER, onSimPart, onSim }) {
  setLite(lite); // (matériaux propres au projet : lus à leur construction)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 80);
  setNoiseVolume(await gen.request({ seed: 'tangle-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite, onSimPart, onSim });
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
    stage.setRecipe(R); // (R.loop.duration est posé quand la simulation arrive)
    syncEnv();
  }

  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
  const camPose = { pos: [0, 0, 0], tgt: [0, 2, 0], fov: 35 };
  let lastPh = 0;
  const hand = createHandheld('tangle'), _hA = new THREE.Vector3(), _hT = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    let fov = C.fov;
    if (!free && stage.cam) {
      // caméra du film (camera.js) : périodique, lissée
      const p = stage.cam.at(ph * R.loop.duration, camPose);
      camera.position.set(...p.pos);
      // (relais : la caméra avance vers ce qu'elle regarde)
      if (push) camera.position.lerp(_r.set(...p.tgt), push);
      camera.up.set(0, 1, 0);
      camera.lookAt(hand.aim(camera, _r.set(...p.tgt), ph, { amp: RENDER.handheld ?? 0, duration: R.loop.duration }, _hA));
      fov = p.fov;
    }
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(!free && stage.cam ? _hA : _r.set(...camPose.tgt));
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    scene.fog.near = R.fog.near; scene.fog.far = R.fog.far;
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    stage.update(ph);
    // (distance réelle à la cible : elle suit l'avancée du relais, soit × (1 − push))
    const fd = camera.position.distanceTo(_r.set(...camPose.tgt));
    post.update({ ...RENDER, lite, focus: RENDER.focus * fd, focusRange: RENDER.focusRange * fd }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen, camPose,
    get R() { return R; },
    setRecipe, syncEnv, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => [0, 0.2, 0.4, 0.6, 0.8],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
