// Le cœur de Pendulum : la scène, sa recette et le rendu d'une phase. C'est
// la source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement, export) et par la méga-scène (day.js : le relais).
// Retoucher la caméra, l'éclairage ou la chaîne d'image se fait ici, et vaut
// pour les deux.
//
// createCore({ renderer, width, height, gen, lite, RENDER })
//   gen    : le pool de workers de génération (gen/client.js pour la page,
//            shared/gen/client.js pour le relais : même protocole)
//   RENDER : les réglages de rendu, lus à chaque image (la page passe ceux du
//            panneau, qu'elle modifie en place ; le relais, ceux par défaut)
// → { scene, camera, stage, post, R, setRecipe, syncEnv, renderAt, camPose,
//     isReady, progress, duration, warmPhases, applyRender }
// renderAt(u, { push, sub, free }) : push ∈ [0, 1) avance la caméra vers ce
// que regarde le plan (passages du relais) ; sub : décalages d'un rendu
// accumulé ; free : caméra libre (la page la pose elle-même, OrbitControls).
//
// Les trajectoires sont résolues par les workers, le film les relit à la
// phase (film.js) : l'image ne dépend que de la recette et de la phase.
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
  setNoiseVolume(await gen.request({ seed: 'pendulum-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite, renderer }); // (renderer : la lampe à gobo, voir stage.js)
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
  const _f = new THREE.Vector3(), _u = new THREE.Vector3();
  // (la pose du plan courant ; la page y prend le point visé de la caméra libre)
  const camPose = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 30 };
  let lastShot = null, lastPh = 0;
  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  const hand = createHandheld('pendulum'), _hA = new THREE.Vector3(), _hT = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    stage.update(ph);
    let fov = C.fov;
    if (!free) {
      // caméra périodique en ph (même pose à 0 et à 1) : le plan du découpage
      // (camera.js) qui contient cette phase
      stage.cameraAt(ph, camera.aspect, camPose);
      camera.position.copy(camPose.position);
      // (relais : la caméra avance vers ce que regarde le plan)
      if (push) camera.position.lerp(camPose.target, push);
      camera.up.set(0, 1, 0);
      camera.lookAt(hand.aim(camera, camPose.target, ph, { amp: RENDER.handheld ?? 0, duration: (stage.film?.duration ?? 20) }, _hA));
      fov = camPose.fov;
      // un raccord (changement de plan) : l'historique de l'anticrénelage et
      // les vitesses de la caméra appartiennent au plan précédent
      const shot = stage.shotIndex(ph);
      if (shot !== lastShot && lastShot !== null) post.cut();
      lastShot = shot;
    }
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(!free ? _hA : camPose.target);
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.stage.bg);
    scene.fog.color.set(R.stage.bg);
    // (brume : seulement quand l'humeur en a une ; sinon repoussée très loin)
    // (distance réelle : la mise au point suit l'avancée du relais)
    const camDist = camera.position.distanceTo(camPose.target);
    // (brume en distances fixes, celles du plan large : elle ne change pas d'un plan à l'autre)
    const fogRef = free ? camDist : camPose.ref ?? camDist;
    scene.fog.near = R.stage.fog > 0 ? fogRef * (1.1 - R.stage.fog) : 200; scene.fog.far = R.stage.fog > 0 ? fogRef * (1.1 - R.stage.fog) + 8 / R.stage.fog * 0.4 : 400;
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    post.update({ ...RENDER, lite, focus: camDist, focusRange: RENDER.focusRange * camDist }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen, camPose,
    get R() { return R; },
    setRecipe, syncEnv, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => stage.film?.duration ?? 20,
    warmPhases: () => [0, 0.25, 0.5, 0.75],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
