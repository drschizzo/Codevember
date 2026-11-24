// Le cœur d'Erosion : la scène, sa recette et le rendu d'une phase. C'est la
// source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement, export) et par la méga-scène (day.js : le relais).
// Retoucher la caméra, l'éclairage ou la chaîne d'image se fait ici, et vaut
// pour les deux.
//
// createCore({ renderer, width, height, gen, lite, RENDER, nextFrame })
//   gen       : le pool de workers de génération (shared/gen/client.js)
//   RENDER    : les réglages de rendu, lus à chaque image (la page passe ceux
//               du panneau, qu'elle modifie en place ; le relais, ceux par défaut)
//   nextFrame : (relais seulement) attendre l'image suivante de l'hôte — la
//               simulation tourne alors par lots de 32 pas, un lot par image
// → { scene, camera, stage, post, R, setRecipe, syncEnv, rebuildCamera,
//     renderAt, isReady, progress, duration, warmPhases, applyRender, dispose }
// renderAt(u, { push, sub, free, target }) : push ∈ [0, 1) avance la caméra
// vers ce que regarde le plan (passages du relais) ; sub : décalages d'un rendu
// accumulé ; free : caméra libre (la page la pose elle-même, OrbitControls,
// dont target est le point visé).
import * as THREE from 'three/webgpu';
import { buildCamera } from './camera.js';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from './scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from '../../shared/scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { createHandheld } from '../../shared/scene/handheld.js';

export async function createCore({ renderer, width, height, gen, lite = false, RENDER, nextFrame = null }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 80);
  // (le worker ne sert qu'au volume de bruit : la simulation tourne sur le GPU, scene/gpusim.js)
  setLite(lite);
  setNoiseVolume(await gen.request({ seed: 'erosion-noise' }, 'noise')); // (les matériaux en dépendent)
  // (relais : la simulation tourne pendant qu'un autre jour joue, 32 pas par
  // image au plus, au lieu de lots de 256 qui lui prenaient le GPU)
  const stage = createStage(scene, renderer, nextFrame ? { lite, simPace: { batch: 32, pace: nextFrame } } : { lite });
  const post = createPost(renderer, scene, camera);

  let R = null, pose = null, envKey = '';
  function syncEnv() {
    const k = R.env.preset;
    if (k === envKey) return;
    envKey = k;
    const old = scene.environment;
    scene.environment = makeEnvironment(k, 0, lite ? 512 : 1024);
    old?.dispose();
  }
  const rebuildCamera = () => { pose = buildCamera(R, stage.S); }; // (stage.S est posé dès l'appel de setRecipe)
  // → la promesse de la simulation (un échec : la scène ne sera jamais prête)
  function setRecipe(r) {
    R = r;
    const sim = stage.setRecipe(R);
    rebuildCamera();
    syncEnv();
    return sim;
  }

  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _t = new THREE.Vector3();
  const hand = createHandheld('erosion'); const _a = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  let lastPh = 0, lastShot = null;
  function renderAt(u, { push = 0, sub = null, free = false, target = null } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const Pc = pose(ph);
    const near = free ? 0.05 : Pc.near;
    let aim = _r.set(...Pc.target);
    if (!free) {
      // caméra du film : le plan du découpage qui contient ph (camera.js)
      camera.position.set(...Pc.position);
      // (relais : la caméra avance vers ce que regarde le plan)
      if (push) camera.position.lerp(_t.set(...Pc.target), push);
      camera.up.set(0, 1, 0);
      aim = hand.aim(camera, _r, ph, { amp: RENDER.handheld ?? 0, duration: R.loop.duration, fov: Pc.fov }, _a);
      camera.lookAt(aim);
      // un raccord : l'historique de l'anticrénelage et les vitesses appartiennent au plan précédent
      if (lastShot !== null && Pc.shot !== lastShot) post.cut();
      lastShot = Pc.shot;
    }
    if (Math.abs(camera.fov - Pc.fov) > 1e-6 || camera.near !== near) { camera.fov = Pc.fov; camera.near = near; camera.updateProjectionMatrix(); }
    const dist = free ? camera.position.distanceTo(target) : Math.hypot(Pc.position[0] - Pc.target[0], Pc.position[1] - Pc.target[1], Pc.position[2] - Pc.target[2]) * (1 - push);
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.0012 * (RENDER.dof ? RENDER.bokeh : 0.3) * dist;
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(aim);
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    scene.fog.near = 2.5; scene.fog.far = 9;
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    stage.update(ph, R.loop.duration);
    // (profondeur de champ du plan : faible en macro, grande au ras du sable)
    const dk = free ? 1 : Pc.dof;
    post.update({ ...RENDER, lite, focus: RENDER.focus * dist, focusRange: RENDER.focusRange * dist * dk, bokeh: RENDER.bokeh * Math.min(1.4, 1 / Math.sqrt(dk)) }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, syncEnv, rebuildCamera, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => [0.02, 0.3, 0.55, 0.75, 0.88],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
    // (≈ 270 Mo de tampons créés sur le device, hors du registre du relais)
    dispose: () => stage.gs.dispose(),
  };
}
