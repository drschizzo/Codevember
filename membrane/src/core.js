// Le cœur de Membrane : la scène, sa recette et le rendu d'une phase. C'est
// la source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement, export) et par la méga-scène (day.js : le relais).
// Retoucher la caméra, l'éclairage ou la chaîne d'image se fait ici, et vaut
// pour les deux. (Membrane est d'avant les modules communs : ses variantes
// locales de globals, materials, env et post sont celles de la page.)
//
// createCore({ renderer, width, height, gen, lite, RENDER, nextFrame })
//   gen       : le pool de workers de génération (gen/client.js pour la page,
//               shared/gen/client.js pour le relais : même protocole)
//   RENDER    : les réglages de rendu, lus à chaque image (la page passe ceux
//               du panneau, qu'elle modifie en place ; le relais, ceux par défaut)
//   nextFrame : (relais seulement) attendre l'image suivante de l'hôte — les
//               couches se simulent alors par lots de 8 pas, un lot par image
// → { scene, camera, nest, lights, post, R, info, setRecipe, syncEnv,
//     resetMotion, syncSlot, renderAt, isReady, progress, duration,
//     warmPhases, applyRender, dispose }
// renderAt(u, { push, free }) : push ∈ [0, 1) avance la caméra vers le cœur du
// nid (passages du relais) ; free : caméra libre (la page la pose elle-même,
// OrbitControls). (Pas de rendu accumulé : sub est sans effet.)
//
// L'image dépend de u déroulé, non de sa seule partie fractionnaire : la
// plongée τ avance de N couches par boucle, et les emplacements (nest.js) la
// suivent modulo M. La scène à u + 1 est celle à u (modèle d mod N). Les
// vitesses (images précédentes des couches) sont un état : après un saut de
// phase, resetMotion() ou un écart de plus d'une demi-couche les remet.
import * as THREE from 'three/webgpu';
import { createNest, XMAX, MAIN } from './scene/nest.js';
import { createLights } from './scene/lights.js';
import { makeEnvironment } from './scene/env.js';
import { setNoiseVolume, setLite } from './scene/materials.js';
import { G } from './scene/globals.js';
import { createPost } from './render/post.js';
import { createHandheld } from '../../shared/scene/handheld.js';

const D = 1; // distance caméra–centre (échelle de la plongée)

// Variation de vitesse autour de chaque déchirure : τ = t − Σ a·w·K((t − k)/w),
// K(x) = x − 3x³ + 3x⁵ − x⁷ (primitive d'une bosse d'intégrale nulle) : la
// vitesse vaut 1 − a au moment de la déchirure, remonte de part et d'autre et
// rejoint 1 sans à-coup ; τ(k) = k. Le ralenti est centré sur l'instant où une
// couche atteint la profondeur « at » (celle de la rupture).
const K7 = (x) => x - 3 * x ** 3 + 3 * x ** 5 - x ** 7;
function choreo(t, C) {
  const c = C.at - Math.floor(C.at);
  const u = t + c;
  let tau = u;
  for (let k = Math.round(u) - 1; k <= Math.round(u) + 1; k++) {
    const x = (u - k) / C.width;
    if (Math.abs(x) < 1) tau -= C.slow * C.width * K7(x);
  }
  return tau - c;
}

export async function createCore({ renderer, width, height, gen, lite = false, RENDER, nextFrame = null }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 2, 7);
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.002, 60);
  camera.layers.mask = MAIN;
  setNoiseVolume(await gen.request({ seed: 'membrane-noise' }, 'noise'));
  // (relais : les couches se simulent pendant qu'un autre jour joue, 8 pas
  // par image de l'hôte pour tout le nid — ≈ 7 ms de GPU —, au lieu de lots
  // de 8 à 10 images de simulation, 130 à 160 pas, qui lui prenaient le GPU)
  const nest = createNest(scene, gen, renderer, { lite, simPace: nextFrame ? { batch: 8, pace: nextFrame } : null });
  const lights = createLights(scene, { lite });
  const post = createPost(renderer, scene, camera);

  let R = null, envKey = '', resetMotion = true, info = null;
  function syncEnv() {
    if (R.env.preset === envKey) return;
    envKey = R.env.preset;
    const old = scene.environment;
    // (mobile : carte de 512 px, quatre fois moins de pixels à calculer et à préfiltrer)
    scene.environment = makeEnvironment(envKey, 0, lite ? 512 : 1024);
    old?.dispose();
  }
  function setRecipe(r) {
    R = r;
    nest.setRecipe(R);
    syncEnv();
    resetMotion = true;
  }
  // Un emplacement de plus construit (maillages et matériaux), un seul par
  // appel : vrai quand tous le sont (la page les construit en boucle sous son
  // écran de chargement ; le relais, un par image, dans isReady).
  function syncSlot() {
    for (const sl of nest.slots) {
      const was = sl.built;
      if (!sl.sync(RENDER.depthBlur)) return false;
      if (sl.built !== was) return false;
    }
    return true;
  }

  // ── Rendu d'une phase ──
  const hand = createHandheld('membrane'), _hA = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  const _o = new THREE.Vector3();
  function rigCamera(ph, push) {
    const K = R.camera, w = ph * Math.PI * 2;
    // léger balancement (nombre entier d'oscillations par boucle) ; la caméra
    // reste dans l'axe des ouvertures
    const sx = K.sway * 0.03 * Math.sin(w * 2), sy = K.sway * 0.02 * Math.sin(w * 3 + 1.1);
    camera.position.set(sx * D, sy * D, D);
    // (relais : la caméra avance vers le cœur du nid)
    if (push) camera.position.multiplyScalar(1 - push);
    camera.up.set(Math.sin(K.roll + w * K.rollTurns), Math.cos(K.roll + w * K.rollTurns), 0);
    camera.lookAt(hand.aim(camera, _o.set(0, 0, 0), ph, { amp: RENDER.handheld ?? 0, duration: R.loop.beat * R.levels.length }, _hA));
    if (camera.fov !== K.fov) { camera.fov = K.fov; camera.updateProjectionMatrix(); }
  }
  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const cycle = Math.floor(u), ph = u - cycle;
    const N = R.levels.length;
    const tau = cycle * N + choreo(ph * N, R.chor);
    G.phase.value = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    G.backdropBlur.value = RENDER.backdropBlur;
    G.sssBoost.value = RENDER.sssBoost;
    G.grazing.value = RENDER.grazing ?? 1;
    G.armEnv.value = RENDER.armEnv;
    const pz = R.polar;
    G.polar.value = pz.amount; G.polCross.value = pz.cross ? 1 : 0; G.polCirc.value = pz.mode === 'circular' ? 1 : 0;
    G.polPlate.value = pz.mode === 'plate' ? 1 : 0; G.polAngle.value = pz.angle; G.polTurns.value = Math.round(pz.turns); G.polGain.value = pz.gain;
    if (!free) rigCamera(ph, push);
    info = nest.update({ tau, D, R, reset: resetMotion, render: RENDER });
    resetMotion = false;
    lights.update(R, camera, D, D * R.nest.ratio ** (XMAX - 0.6));
    scene.background.set(R.bg);
    G.bgColor.value.set(R.bg);
    scene.fog.color.set(R.bg);
    scene.fog.near = R.fog.near * D;
    scene.fog.far = R.fog.far * D;
    G.fogNear.value = scene.fog.near; G.fogFar.value = scene.fog.far;
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    // (mise au point : elle suit l'avancée du relais)
    const dS = D * (1 - push);
    post.update({ ...RENDER, focus: dS * RENDER.focus * 0.6, focusRange: RENDER.focusRange * dS }, R);
    post.render();
  }

  // Les moments à préparer : les emplacements parcourent toutes les
  // profondeurs en M/N boucles, on les échantillonne toutes (chaque variante
  // de matériau — avec ou sans copie de l'image, mélangée — et chaque maillage
  // sont ainsi préparés).
  function warmPhases() {
    const N = R.levels.length, loops = nest.slots.length / N, phases = [];
    for (let i = 0, n = Math.round(loops * N * 4); i < n; i++) phases.push((i / n) * loops);
    return phases;
  }

  return {
    scene, camera, nest, lights, post, gen,
    get R() { return R; },
    get info() { return info; },
    setRecipe, syncEnv, syncSlot, renderAt, warmPhases,
    resetMotion: () => { resetMotion = true; },
    isReady: () => nest.ready() && syncSlot(),
    progress: () => nest.progress(),
    duration: () => R.loop.beat * R.levels.length,
    applyRender: () => lights.setShadowQuality(RENDER.shadows),
    // (tampons de la simulation et des poses, créés sur le device, hors du
    // registre du relais)
    dispose: () => nest.dispose(),
  };
}
