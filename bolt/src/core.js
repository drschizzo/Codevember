// Le cœur de Bolt : la scène, sa recette et le rendu d'une phase. C'est la
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
// renderAt(u, { push, sub, free }) : push ∈ [0, 1) avance la caméra vers le
// récipient (passages du relais) ; sub : décalages d'un rendu accumulé ;
// free : caméra libre (la page la pose elle-même, OrbitControls).
import * as THREE from 'three/webgpu';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from '../../shared/scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from '../../shared/scene/materials.js';
import { createPost } from './render/post.js'; // (variante locale : le nuage absorbe)
import { cameraAt, stateAt } from './film.js';

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 80);
  // (le bruit commun et les deux volumes du nuage, en parallèle dans le pool)
  const [noiseVol, cloudNoise] = await Promise.all([gen.request({ seed: 'bolt-noise' }, 'noise'), gen.request({}, 'cloudnoise')]);
  setNoiseVolume(noiseVol); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite });
  stage.cloud.setNoise(cloudNoise);
  const post = createPost(renderer, scene, camera, { haze: stage.cloud.haze, aoSamples: 8 });

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
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _flash = new THREE.Color();
  let lastPh = 0;
  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera, Lay = stage.layout;
    // (le plan de l'humeur, réglé sur ce récipient et son nuage)
    const pose = cameraAt({ ...C, target: Lay?.target ?? C.target, dist: C.dist * (Lay ? Lay.frame / 2.5 : 1) * Math.max(1, 1.45 / camera.aspect) }, ph);
    if (!free) {
      camera.position.set(...pose.pos);
      // (relais : la caméra avance vers ce qu'elle regarde)
      if (push) camera.position.lerp(_r.set(...pose.target), push);
      camera.up.set(0, 1, 0);
      camera.lookAt(...pose.target);
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    // la secousse du coup de foudre : un à-coup du pied de la caméra à chaque arc, amorti en un quart de seconde
    const F0 = stateAt(R.film, ph);
    if (!free && F0.tau > 0) {
      let k = 0;
      for (const s of R.film.strokes) { const x = F0.tau - s.t; if (x > 0) k += s.amp * Math.exp(-x / 0.16) * Math.sin(x * 2 * Math.PI * 11); }
      camera.position.y += k * 0.0035 * C.dist;
    }
    camera.clearViewOffset();
    const canvas = renderer.domElement; // (dans le relais : la cible du jour)
    if (sub) {
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(_r.set(...pose.target));
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    // (distance réelle : elle suit l'avancée du relais, la mise au point et le brouillard aussi)
    const camDist = camera.position.distanceTo(_r.set(...pose.target));
    // (le mur aussi reçoit l'éclair : c'est la couleur de fond, que les lampes n'atteignent pas)
    scene.background.set(R.fog.color).lerp(_flash.set(R.bolt.color), Math.min(0.6, F0.light * (0.08 + 0.4 * R.fog.wall)));
    scene.fog.color.copy(scene.background);
    scene.fog.near = camDist + 0.8; scene.fog.far = camDist + 6.2; // (la table se fond dans le mur : pas d'horizon)
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    R.film.duration = R.loop.duration;
    stage.update(ph, camera, canvas.height); // (hauteur en pixels de l'image dessinée)
    post.update({ ...RENDER, exposure: RENDER.exposure * F0.expo, lite, focus: RENDER.focus * camDist, focusRange: RENDER.focusRange * camDist }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, syncEnv, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => [0.12, 0.3, 0.45, 0.502, 0.53, 0.6, 0.76],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
