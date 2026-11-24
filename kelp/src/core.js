// Le cœur de Kelp : la scène, sa recette et le rendu d'une phase. C'est la
// source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement, export) et par la méga-scène (day.js : le relais).
// Retoucher la caméra, l'éclairage ou la chaîne d'image se fait ici, et vaut
// pour les deux.
//
// createCore({ renderer, width, height, gen, lite, RENDER })
//   gen    : le pool de workers de génération (shared/gen/client.js ; la scène
//            se découpe en gen.size − 2 tranches, quelques Mo par pièce)
//   RENDER : les réglages de rendu, lus à chaque image (la page passe ceux du
//            panneau, qu'elle modifie en place ; le relais, ceux par défaut)
// → { scene, camera, stage, post, R, setRecipe, renderAt, isReady, progress,
//     duration, warmPhases, applyRender }
// renderAt(u, { push, sub, free }) : push ∈ [0, 1) avance la caméra vers ce
// qui est au point, à l'horizontale (passages du relais) ; sub : décalages
// d'un rendu accumulé ; free : caméra libre (la page la pose elle-même,
// OrbitControls).
import * as THREE from 'three/webgpu';
import { createStage } from './scene/stage.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from '../../shared/scene/materials.js';
import { createPost } from './render/post.js';
import { createHandheld } from '../../shared/scene/handheld.js';

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux, commun aux jours du relais)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101418); // (remplacé par la sphère du ciel quand il arrive)
  // (le brouillard est l'eau elle-même : scene.fogNode, posé par la scène)
  const camera = new THREE.PerspectiveCamera(65, width / height, 0.05, 600);
  setNoiseVolume(await gen.request({ seed: 'kelp-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite });
  const post = createPost(renderer, scene, camera, { lens: (sample) => stage.domeLens(sample) });

  let R = null;
  // onProgress : l'avancement de la génération (l'écran de chargement de la page)
  // (la scène et le ciel, demandés ensemble aux workers : stage.ready() attend les deux)
  function setRecipe(r, onProgress = null) {
    R = r;
    stage.setRecipe(R, onProgress);
  }

  // ── Rendu d'une phase ──
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _fw = new THREE.Vector3(), _t = new THREE.Vector3();
  let lastPh = 0;
  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  const hand = createHandheld('kelp'), _hA = new THREE.Vector3(), _hT = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    const pose = stage.camPose(ph);
    // exposition qui suit la plongée, mise au point qui glisse vers la grande vague (stage.trackAt)
    const tk = stage.trackAt(ph);
    const dS = tk.focus * RENDER.focus;
    if (!free) {
      // un trépied au ras de l'eau, un lent travelling périodique (même pose à 0 et à 1)
      camera.position.copy(pose.pos);
      _t.copy(pose.target);
      // (relais : la caméra avance vers ce qui est au point, à l'horizontale —
      // le dôme est à moitié dans l'eau, monter ou descendre traverserait la
      // surface ; la visée garde son cap et sa hauteur)
      if (push) {
        _fw.subVectors(pose.target, pose.pos).setY(0).normalize().multiplyScalar(push * dS);
        camera.position.add(_fw);
        _t.add(_fw);
      }
      camera.up.set(0, 1, 0);
      camera.lookAt(hand.aim(camera, _t, ph, { amp: RENDER.handheld ?? 0, duration: R.loop.duration, move: 0 }, _hA));
      camera.rotateZ(pose.roll ?? 0); // (le caisson roule sous le choc de la vague)
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.002 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(!free ? _hA : pose.target);
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    camera.updateMatrixWorld();
    stage.setDomeCamera(camera);
    stage.update(ph, G.phasePrev.value);
    const k = 1 - push; // (la mise au point suit l'avancée du relais)
    post.update({ ...RENDER, lite, exposure: RENDER.exposure * tk.exp, focus: dS * k, focusRange: RENDER.focusRange * tk.focus * k }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => [0, 0.2, 0.45, 0.66, 0.72, 0.85],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
