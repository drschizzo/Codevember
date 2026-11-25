// Le cœur de Hive : la scène, sa recette et le rendu d'une phase. C'est la
// source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement, export) et par la méga-scène (day.js : le relais de
// mega/). Retoucher la caméra, l'éclairage ou la chaîne d'image se fait ici, et
// vaut pour les deux.
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
// Règles (le relais tient plusieurs projets dans une seule page) :
// - rien ici ne lit la page (location, document, innerWidth, le canvas) :
//   tailles en pixels par renderer.domElement ;
// - G (shared/scene/globals.js) est commun aux jours : la phase précédente
//   est la nôtre (lastPh) ;
// - tout calcul lourd de la génération va dans le worker (gen/worker.js) ;
// - ce qui est créé hors de three.js (device.createBuffer…) se libère par
//   l'option extraDispose de day.js.
import * as THREE from 'three/webgpu';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from '../../shared/scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from '../../shared/scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { createHandheld } from '../../shared/scene/handheld.js';

const TAU = Math.PI * 2;

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 80);
  setNoiseVolume(await gen.request({ seed: 'hive-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite });
  const post = createPost(renderer, scene, camera, { prePassScale: 0.5 }); // (la pré-passe de l'occlusion en demi-définition : l'occlusion l'est aussi)

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
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
  const hand = createHandheld('hive'), _hA = new THREE.Vector3(), _hT = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  let lastPh = 0;
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    const top = R.comb.top;
    // la caméra du film : du plan d'ensemble (la langue entière) au gros plan
    // (les alvéoles remplissent le cadre) et retour, en glissant de côté ;
    // tout est périodique en ph
    const w = Math.pow(0.5 - 0.5 * Math.cos(TAU * (ph - C.peak + 0.5)), 1.6); // (0 au large, 1 au plus près)
    const az = C.az + C.sway * Math.sin(TAU * (ph - C.peak) + 0.6) + C.rake[0] * w, el = C.el + 0.05 * Math.sin(TAU * ph + 1.3) + C.rake[1] * w;
    const d = Math.exp(Math.log(C.dist) * (1 - w) + Math.log(C.close) * w);
    _hT.set(C.look[0] * w, top - (R.comb.frame.Hi + R.comb.frame.gap) * 0.5 * (1 - w) + C.look[1] * w, 0.06 * w);
    if (!free) {
      camera.position.set(_hT.x + Math.sin(az) * Math.cos(el) * d, _hT.y + Math.sin(el) * d, _hT.z + Math.cos(az) * Math.cos(el) * d);
      if (push) camera.position.lerp(_hT, push); // (relais : la caméra avance vers ce qu'elle regarde)
      camera.up.set(0, 1, 0);
      // caméra tenue : les imperfections d'un opérateur, par-dessus la pose calculée (shared/scene/handheld.js)
      camera.lookAt(hand.aim(camera, _hT, ph, { amp: RENDER.handheld ?? 0, duration: R.loop.duration }, _hA));
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(free ? _r.copy(_hT) : _hA); // (la visée tremblée, comme la pose)
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
    const dS = d * (1 - push);
    post.update({ ...RENDER, lite, focus: RENDER.focus * dS, focusRange: RENDER.focusRange * dS * (1 + 2.5 * (1 - w)) }, R); // (zone nette large au plan d'ensemble, mince au gros plan)
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
    target: () => _hT,
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
