// Le cœur de Hollow : la scène, sa recette et le rendu d'une phase. C'est la
// source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement, son, export) et par la méga-scène (day.js : le relais).
// Retoucher la plongée, la caméra, la lumière ou la chaîne d'image se fait
// ici, et vaut pour les deux.
//
// Hollow est d'avant le gabarit commun : ses modules sont des variantes
// locales (pool de workers, matériaux et leurs globales G, studio, chaîne
// d'image). Ses globales n'étant qu'à lui, il n'a pas à reposer la phase
// précédente avant de dessiner (voir melt/src/core.js).
//
// createCore({ renderer, width, height, gen, lite, RENDER })
//   gen    : le pool de workers de génération (gen/client.js, la variante locale)
//   RENDER : les réglages de rendu, lus à chaque image (la page passe ceux du
//            panneau, qu'elle modifie en place ; le relais, ceux par défaut)
// → { scene, camera, nest, lights, dust, post, gen, R, D, curTau, shells,
//     setRecipe, syncEnv, renderAt, isReady, progress, duration, warmPhases,
//     applyRender }
// renderAt(u, { push, sub, free }) : push ∈ [0, 1) avance la caméra vers ce
// qu'elle regarde (passages du relais) ; sub : sans objet ici (pas de rendu
// accumulé) ; free : caméra libre (la page la pose elle-même, OrbitControls).
import * as THREE from 'three/webgpu';
import { createNest } from './scene/nest.js';
import { createLights } from './scene/lights.js';
import { createDust } from './scene/dust.js';
import { makeEnvironment } from './scene/env.js';
import { G, setNoiseVolume, setLite } from './scene/materials.js';
import { createPost } from './render/post.js';

export const D = 4; // distance caméra–centre (toutes les longueurs de la scène en dépendent)

// Variation de vitesse autour du passage k (t entier) : τ = t − Σ a·w·K((t − k)/w),
// K(x) = x − 3x³ + 3x⁵ − x⁷ (primitive de k(x) = (1 − 7x²)(1 − x²)², d'intégrale
// nulle) : la vitesse vaut 1 − a au passage, remonte jusqu'à 1 + 0,65·a de part
// et d'autre, et rejoint 1 sans à-coup en ±w ; τ(k) = k. a > 0 : ralenti ;
// a < 0 : accélération. beats : un battement par couche, { a, w }.
const K7 = (x) => x - 3 * x ** 3 + 3 * x ** 5 - x ** 7;
function beatShift(t, N, cam) {
  const beats = cam.beats?.length ? cam.beats : [{ a: 1, w: 0.5 }];
  const amp = cam.ramp ?? 0;
  let tau = t, open = 0;
  for (let k = Math.round(t) - 1; k <= Math.round(t) + 1; k++) {
    const b = beats[(((k % N) + N) % N) % beats.length], x = (t - k) / b.w;
    if (Math.abs(x) >= 1) continue;
    tau -= amp * b.a * b.w * K7(x);
    open += Math.max(0, b.a) * (1 - x * x) ** 2;
  }
  return { tau, open };
}

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.01, 60);
  camera.position.set(0, 0, D);
  setNoiseVolume(await gen.request({ seed: 'hollow-noise' }, 0, 'noise')); // (les matériaux en dépendent)
  const nest = createNest(scene, gen, { minLod: lite ? 1 : 0 });
  const lights = createLights(scene, { lite });
  const dust = createDust(scene, { lite });
  const post = createPost(renderer, scene, camera, lights);

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
    nest.setRecipe(R);
    syncEnv();
  }

  // ── Rendu d'une phase ──
  // pose de la caméra du film à la phase ph ; rend le point visé
  const _t = new THREE.Vector3();
  function rig(ph, push) {
    const w = ph * Math.PI * 2, s = R.camera.sway * D;
    camera.position.set(s * Math.sin(w + 0.7), s * 0.65 * Math.sin(2 * w + 1.3), D);
    const roll = R.camera.roll * Math.sin(w + 2.1);
    camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    _t.set(s * 0.25 * Math.sin(w + 2.4), s * 0.2 * Math.cos(w), 0);
    // (relais : la caméra avance vers ce qu'elle regarde)
    if (push) camera.position.lerp(_t, push);
    camera.lookAt(_t);
  }
  let shells = 0, curTau = 0;
  // u : phase « déroulée » (le nombre de boucles accomplies en partie entière),
  // pour que chaque instance de coquille garde sa couche d'une boucle à l'autre
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const cycle = Math.floor(u), ph = u - cycle;
    const dive = R.loop.dive;
    // Chorégraphie : chaque passage d'oculus a sa propre « respiration » (voir
    // beatShift) — un ralenti plus ou moins appuyé, un passage filé, une
    // accélération — et le champ s'ouvre un peu dans les ralentis. Les passages
    // se répètent d'une boucle à l'autre : la boucle est intacte.
    const N = R.layers.length, t = ph * N;
    const { tau, open } = dive ? beatShift(t, N, R.camera) : { tau: R.loop.depth, open: 0 };
    // (image précédente, pour les vecteurs vitesse des pièces animées ; un saut
    // dans la boucle ne compte pas comme un mouvement)
    let dTau = tau - curTau;
    if (dTau < -N / 2) dTau += N; // (fin de boucle : τ repart de 0)
    const jump = Math.abs(dTau) > 0.5;
    G.dTau.value = jump ? 0 : dTau;
    G.phasePrev.value = jump ? ph : G.phase.value;
    curTau = tau;
    if (!free) rig(ph, push);
    const fov = R.camera.fov * (1 + (R.camera.kick ?? 0) * open);
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    G.phase.value = ph;
    G.D.value = D;
    G.ratio.value = R.nest.ratio;
    G.envFalloff.value = RENDER.envFalloff;
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    G.coreR.value = R.nest.core * D;
    G.coreColor.value.set(R.core.color);
    G.coreGlow.value = R.core.glow;
    G.halo.value = R.core.halo ?? 2.4;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    scene.fog.near = R.fog.near * D;
    scene.fog.far = R.fog.far * D;
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    const canvas = renderer.domElement; // (dans le relais : sa hauteur est celle de la cible du jour)
    const pxPerUnit = canvas.height / (2 * Math.tan((camera.fov * Math.PI) / 360)); // (pixels par unité à distance 1)
    const info = nest.update({ tau, phi: ph, cycle, dive, ratio: R.nest.ratio, D, coreRel: R.nest.core, detail: RENDER.detail, pxPerUnit });
    shells = info?.shells ?? 0;
    dust.update({ tau, N: R.layers.length, ratio: R.nest.ratio, xMax: info?.birth ?? 6 }, R.dust);
    lights.update(R, camera, D, Math.sin(ph * Math.PI * 4));
    // (mise au point : la distance au centre suit l'avancée du relais)
    const dS = D * (1 - push);
    post.update({ ...RENDER, focus: RENDER.focus * dS, focusRange: RENDER.focusRange * dS }, R);
    post.render();
  }

  // Préparation : deux boucles de la plongée (chaque couche passe à toutes les
  // profondeurs et tous les niveaux de détail, et les instances des deux
  // boucles sont construites).
  const PHASES = Array.from({ length: 16 }, (_, i) => i / 8);

  return {
    scene, camera, nest, lights, dust, post, gen, D,
    get R() { return R; },
    get curTau() { return curTau; },
    get shells() { return shells; },
    setRecipe, syncEnv, renderAt,
    isReady: () => !!R && nest.ready(),
    progress: () => nest.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => PHASES,
    applyRender: () => lights.setShadowQuality(RENDER.shadows),
  };
}
