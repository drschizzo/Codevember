// Le cœur de Mirage : la scène, sa recette et le rendu d'une phase. C'est la
// source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement, export) et par la méga-scène (day.js : le relais).
// Retoucher la caméra, l'éclairage ou la chaîne d'image se fait ici, et vaut
// pour les deux.
//
// createCore({ renderer, width, height, gen, lite, RENDER })
//   gen    : le pool de workers de génération (shared/gen/client.js)
//   RENDER : les réglages de rendu, lus à chaque image (la page passe ceux du
//            panneau, qu'elle modifie en place ; le relais, ceux par défaut)
// → { scene, camera, stage, post, R, setRecipe, renderAt, isReady, progress,
//     duration, warmPhases, applyRender, noSeam }
// renderAt(u, { push, sub, free }) : push ∈ [0, 1) avance la caméra vers ce
// qu'elle regarde (passages du relais) ; sub : décalages d'un rendu accumulé ;
// free : caméra libre (la page la pose elle-même, OrbitControls ; le champ et
// le format restent ceux du film).
//
// Toute la scène est un seul lancer de rayons plein écran (scene/raytrace.js).
// La seconde caméra (celle du raccord, un niveau plus bas) n'est jamais
// rendue : sa pose n'est passée au tracé que par des uniformes.
import * as THREE from 'three/webgpu';
import { cameraAt, seamAt, compExp } from './timeline.js';
import { createStage } from './scene/stage.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from '../../shared/scene/materials.js';
import { createPost } from '../../shared/render/post.js';

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(25, width / height, 0.01, 10);
  setNoiseVolume(await gen.request({ seed: 'mirage-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { renderer, camera, lite });
  const post = createPost(renderer, scene, camera);

  // (le studio est posé par stage.setRecipe : ses pixels sont calculés ici,
  // sur le fil principal — gen/envmap.js)
  let R = null;
  function setRecipe(r) {
    R = r;
    stage.setRecipe(R);
  }

  // ── Rendu d'une phase ──
  const _r = new THREE.Vector3();
  const altCam = new THREE.PerspectiveCamera(25, 1, 0.01, 10);
  let dbgNoSeam = false; // (?debug : window.mirage.noSeam(true) montre chaque vue sans le fondu)
  // pose d'une caméra : position, visée, champ (élargi en portrait), étirement
  // horizontal du raccord (le format du dessin, multiplié par ax) ; place :
  // false garde la position et la visée (caméra libre)
  function pose(cam, P, sub, push = 0, place = true) {
    const canvas = renderer.domElement; // (dans le relais : la cible du jour)
    if (place) {
      cam.position.set(...P.pos);
      // (relais : la caméra avance vers ce qu'elle regarde)
      if (push) cam.position.lerp(_r.set(...P.tgt), push);
      cam.up.set(0, 1, 0);
      cam.lookAt(_r.set(...P.tgt));
    }
    const base = canvas.width / Math.max(1, canvas.height);
    const fovDeg = P.fov * (base >= 1 ? 1 : Math.min(1.7, 1.1 / base)), asp = base * (P.ax ?? 1);
    if (cam.fov !== fovDeg || cam.aspect !== asp) { cam.fov = fovDeg; cam.aspect = asp; cam.updateProjectionMatrix(); }
    cam.clearViewOffset();
    if (sub) cam.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    cam.updateMatrixWorld();
  }
  let lastPh = 0;
  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const canvas = renderer.domElement;
    // la caméra de la chorégraphie : la spirale de l'abyme
    const P = cameraAt(R, ph);
    pose(camera, P, sub, push, !free);
    // le raccord : la même image vue depuis l'autre niveau, mêlée en fondu ;
    // l'argent perdu par l'image du petit, compensé à mesure qu'elle grandit
    const U = stage.raytrace.U, rho = U.inner.value;
    const pixA = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, canvas.height);
    const dist = (Q) => Math.hypot(Q.pos[0] - Q.tgt[0], Q.pos[1] - Q.tgt[1], Q.pos[2] - Q.tgt[2]);
    U.pixFoot.value = pixA * dist(P) * (1 - push); // (un pixel, à la distance de la visée ; le tracé le convertit au niveau touché)
    const comp = (e) => [rho.r, rho.g, rho.b].map((c) => c ** (-2 * e));
    U.comp.value.set(...comp(compExp(P.level)));
    const S = dbgNoSeam ? null : seamAt(R, ph);
    if (S) {
      // (la caméra du raccord avance avec l'autre : le fondu reste en place)
      pose(altCam, cameraAt(R, ph, S.alt), sub, push);
      U.altPos.value.copy(altCam.position); U.altWorld.value.copy(altCam.matrixWorld); U.altProjInv.value.copy(altCam.projectionMatrixInverse);
      U.altComp.value.set(...comp(compExp(S.alt)));
      const A2 = cameraAt(R, ph, S.alt);
      U.altPixFoot.value = pixA * dist(A2) * (1 - push);
      U.altW.value = S.w;
    } else U.altW.value = 0;
    stage.update(ph, camera);
    post.update({ ...RENDER, lite, exposure: RENDER.exposure * stage.exposure() }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => [0, 0.25, 0.5, 0.75],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
    noSeam: (v = true) => { dbgNoSeam = v; },
  };
}
