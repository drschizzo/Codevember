// Le cœur de Veil : la scène, sa recette et le rendu d'une phase. C'est la
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

const TAU = Math.PI * 2;

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(32, width / height, 0.05, 60);
  setNoiseVolume(await gen.request({ seed: 'veil-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite, renderer });
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
  // La caméra suit le geste : de trois quarts, à hauteur de visage, pendant le
  // repos ; elle recule et lève un peu le regard quand le voile monte, pour
  // tenir à la fois le socle vide et le voile pendu. Un balancement lent, un
  // seul aller-retour par boucle. Tout est périodique en u.
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3();
  let lastPh = 0;
  function cameraPose(ph, push = 0) {
    const C = R.camera, TLt = stage.TL.total;
    const o = stage.openness(ph * TLt);
    const top = stage.data ? stage.data.tops.reduce((a, b) => a + b, 0) / stage.data.tops.length : 0.55;
    // repos : le haut de la statue au tiers ; pendaison : du dessus du socle
    // jusqu'aux prises du hamac, tout le voile dans le cadre
    const tan = Math.tan((C.fov * Math.PI) / 360);
    const yH = stage.data?.yH ?? top + 0.8;
    const tyHang = yH * 0.46, dHang = Math.max(C.dist * 1.15, ((yH + 0.3) / 2 / tan) * 1.04); // (le hamac, ses cordons et le dessus du socle)
    const ty = mix(top * 0.55, tyHang, o);
    const az = C.az + C.sway * Math.sin(TAU * ph);
    const el = C.el * (1 - o);
    const d = mix(C.dist, dHang, o) * (1 - push);
    _t.set(0, ty, 0);
    camera.position.set(Math.sin(az) * Math.cos(el) * d, ty + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    camera.up.set(0, 1, 0);
    camera.lookAt(_t);
    return d;
  }
  const mix = (a, b, t) => a + (b - a) * t;
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phasePrev.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phase.value = ph;
    const TLt = stage.TL.total;
    const prev = lastPh;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    let dS = C.dist;
    if (!free) dS = cameraPose(ph, push);
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.006 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(_t);
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.bg.color);
    scene.fog.color.set(R.bg.color);
    scene.fog.near = 7; scene.fog.far = 22;
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    stage.update(ph * TLt, prev * TLt);
    post.update({ ...RENDER, lite, focus: RENDER.focus * dS, focusRange: RENDER.focusRange * dS }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, syncEnv, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => stage.TL?.total ?? R.loop.duration,
    warmPhases: () => [0, 0.03, 0.2, 0.4, 0.6, 0.8], // (0,03 : l'hologramme luit, sa doublure de profondeur se compile)
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
