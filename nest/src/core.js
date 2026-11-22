// Le cœur de Nest : la scène, sa recette et le rendu d'une phase. C'est la
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
import { makeClock, plan } from './season.js';
import { cameraScale, filmCamera } from './camera.js';

const TAU = Math.PI * 2;

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 80);
  setNoiseVolume(await gen.request({ seed: 'nest-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite });
  stage.camera = camera; // (niveau de détail des guêpes : leur taille à l'écran)
  // (pré-passe de l'occlusion en demi-définition : l'occlusion est calculée à
  // demi-définition, une pré-passe pleine redessinait tout le papier pour rien)
  const post = createPost(renderer, scene, camera, { prePassScale: 0.5 });

  let R = null, envKey = '';
  function syncEnv() {
    const k = R.env.preset;
    if (k === envKey) return;
    envKey = k;
    const old = scene.environment;
    scene.environment = makeEnvironment(k, 0, lite ? 512 : 1024);
    old?.dispose();
  }
  let clock = null, P = null, camL = null;
  function setRecipe(r) {
    R = r;
    clock = makeClock(R.loop.duration);
    P = plan(clock);
    camL = cameraScale(clock, P);
    stage.setRecipe(R, P, clock);
    syncEnv();
  }

  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _t = new THREE.Vector3(), _h = new THREE.Vector3(), _n = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3();
  let lastPh = 0;
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    const S = clock.s(ph), L = camL(ph);
    // le nid visible : son centre descend à mesure qu'il grandit ; la caméra
    // recule d'autant (il garde la même part de l'image)
    const FC = filmCamera(C, R.decor.yBeam, L);
    _t.set(...FC.target);
    if (!free) {
      camera.position.set(...FC.pos);
      if (push) camera.position.lerp(_t, push); // (relais : la caméra avance vers ce qu'elle regarde)
      camera.up.set(0, 1, 0);
      camera.lookAt(_t);
    }
    // le temps fort : la caméra s'approche de l'écaille où l'ouvrière pose sa bande
    const H = free ? null : stage.heroCam(ph);
    let dHero = 0;
    if (H && H.w > 0) {
      const w = H.w, tgt = _h.set(...H.target);
      // (de profil, un peu sous le bord libre : l'ouvrière se découpe sur la tranche)
      const o = stage.heroOffOverride ?? H.off ?? [0.24, 0.12, 0.12]; // (?debug : un autre angle sur l'ouvrière)
      const pos1 = _p1.copy(tgt).addScaledVector(_n.set(...H.n), o[0]).addScaledVector(_p2.set(...H.e), o[1]).addScaledVector(_f.set(...H.side), o[2]);
      pos1.y = Math.min(pos1.y, R.decor.yBeam - 0.06); // (jamais dans la poutre)
      const d0 = camera.position.distanceTo(_t), d1 = pos1.distanceTo(tgt);
      const dir0 = _p2.copy(camera.position).sub(_t).normalize(), dir1 = _n.copy(pos1).sub(tgt).normalize();
      _t.lerp(tgt, w);
      const dir = dir0.lerp(dir1, w).normalize();
      camera.position.copy(_t).addScaledVector(dir, Math.exp(Math.log(d0) * (1 - w) + Math.log(d1) * w));
      camera.lookAt(_t);
      dHero = w;
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(_t);
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    scene.fog.near = R.fog.near; scene.fog.far = R.fog.far;
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    stage.update(ph, S);
    const dS = camera.position.distanceTo(_t) * (1 - push);
    const dF0 = Math.max(0.05, dS - (C.focusBack ?? 1.1) * Math.max(0, L - 0.055) / 0.945);
    const dF = dHero > 0 ? dF0 * (1 - dHero) + dS * dHero : dF0; // (au printemps, le sujet est sur la cible : le pétiole, le rayon) // (mise au point sur la face du nid, pas sur son centre)
    post.update({ ...RENDER, lite, focus: RENDER.focus * dF, focusRange: RENDER.focusRange * dF }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, syncEnv, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => [0.1, 0.17, 0.24, 0.33, 0.45, 0.55, 0.75, 0.95],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
