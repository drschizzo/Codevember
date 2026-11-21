// Le cœur de Shatter : la scène, sa recette et le rendu d'une phase. C'est la
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
// renderAt(u, { push, sub, free }) : push ∈ [0, 1) avance la caméra vers la
// pièce (passages du relais) ; sub : décalages d'un rendu accumulé ; free :
// caméra libre (la page la pose elle-même, OrbitControls).
import * as THREE from 'three/webgpu';
import { loopDuration } from './recipe.js';
import { PH, floorH } from './cycle.js';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from './scene/env.js';
import { G } from './scene/globals.js';
import { setNoiseVolume, setLite } from './scene/materials.js';
import { createPost } from '../../shared/render/post.js';

const TAU = Math.PI * 2;

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 80);
  setNoiseVolume(await gen.request({ seed: 'calcin-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite });
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
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
  // azimut de la caméra du film (position : sin az, cos az)
  // (pendant la caméra rapide, elle glisse en arc autour des éclats suspendus,
  // d'un côté puis de l'autre, et revient : u·e^(−u²/2), nul loin de la rupture,
  // donc périodique comme le reste)
  const camAzAt = (ph) => {
    const C = R.camera, N = R.pieces.length, Ts = R.loop.stage, S = R.loop.slow, t = ph * Ts * N;
    let arc = 0;
    for (let k = -1; k <= N; k++) {
      const u = (t - ((k + PH.rupture) * Ts + S.plat * 0.5)) / (S.plat * 0.55);
      arc += (R.pieces[((k % N) + N) % N].side ?? 1) * u * Math.exp(-0.5 * u * u);
    }
    return C.az + TAU * C.orbit * ph + C.sway * Math.sin(TAU * ph) + (C.arc ?? 0) * arc;
  };
  let lastT = null, focusDist = 6;
  // Recul minimal pour qu'en plongée le sommet de la plus haute pièce reste dans
  // l'image (le recul calculé pour une caméra horizontale coupait le bouchon).
  // Calculé une fois par scène et par format, par bissection, sur la caméra la
  // plus haute de la boucle : continu, il ne fait jamais sauter le cadre.
  let fitKey = '', fitD = 0;
  const _cam = new THREE.PerspectiveCamera();
  function plungeFit(H) {
    const C = R.camera, k = `${R.seed}|${H}|${camera.aspect}|${C.height}|${C.fov}`;
    if (k === fitKey) return fitD;
    _cam.fov = C.fov; _cam.aspect = camera.aspect; _cam.updateProjectionMatrix();
    const top = (d) => {
      _cam.position.set(0, Math.max(C.height + 0.15, floorH(d) + 0.3), d); _cam.lookAt(0, H * 0.48, 0); _cam.updateMatrixWorld();
      return _f.set(0, H * 1.04 + 0.08, 0).project(_cam).y;
    };
    let lo = 1, hi = 40;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (top(m) > 0.84) lo = m; else hi = m; }
    fitKey = k; fitD = hi;
    return hi;
  }
  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  function renderAt(u, { push: look = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    const N = R.pieces.length, Ts = R.loop.stage, T = loopDuration(R);
    // temps de la boucle, ralenti autour de chaque rupture (cycle.js, warp)
    const t = ph * T; // (le ralenti de caméra rapide est appliqué aux objets : la caméra garde sa vitesse)
    // (un saut dans la boucle — pas à pas, fin de boucle — n'est pas un mouvement)
    const jump = lastT === null || Math.abs(t - lastT) > 0.5;
    G.timePrev.value = jump ? t : lastT;
    G.time.value = t;
    lastT = t;
    G.phase.value = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    G.uvLight.value = R.light.uv ?? 0;
    const C = R.camera;
    if (!free) {
      // caméra périodique : un tour par boucle (ou un balancement), et elle
      // s'approche un peu à chaque rupture (même noyau, périodique)
      let push = 0;
      for (let k = -1; k <= N; k++) push += Math.exp(-(((t - ((k + PH.rupture) * Ts + R.loop.slow.plat * 0.45)) / 3.2) ** 2));
      const az = camAzAt(ph);
      // (recul minimal pour que la plus haute pièce tienne dans l'image, bord compris)
      const fit = (stage.maxHeight() * 0.55 + 0.45) / Math.tan(((C.fov / 2) * Math.PI) / 180);
      const H = stage.maxHeight();
      const d = Math.max(C.dist, fit, plungeFit(H)) * (1 - C.push * push);
      const y = C.height + 0.15 * Math.sin(TAU * ph * 2 + 1) - 0.2 * push;
      const tgtY = H * 0.48 + 0.12 * push; // (elle monte un peu avec les éclats du haut, qui s'envolent)
      // (jamais sous le bord relevé de la sole)
      camera.position.set(Math.sin(az) * d, Math.max(y, floorH(d) + 0.3), Math.cos(az) * d);
      // (relais : la caméra avance vers la pièce, en restant au-dessus de la sole)
      if (look) { _r.set(0, tgtY, 0); camera.position.lerp(_r, look); }
      camera.up.set(0, 1, 0);
      camera.lookAt(0, tgtY, 0);
      focusDist = camera.position.distanceTo(_r.set(0, stage.maxHeight() * 0.45, 0));
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(_r.set(0, 0.95, 0));
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    scene.fog.near = R.fog.near; scene.fog.far = R.fog.far;
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    stage.update(t, camera, (tt) => camAzAt(tt / loopDuration(R)));
    // (mise au point sur la pièce : la vraie distance, qui suit le recul et l'approche)
    post.update({ ...RENDER, exposure: RENDER.exposure * (R.grade?.exposure ?? 1), lite, focus: RENDER.focus * focusDist, focusRange: RENDER.focusRange * focusDist }, R);
    post.render();
  }

  // Préparation : les moments qui comptent, à chaque étape (accrétion, rupture
  // et bille, constellation, poussière)
  function warmPhases() {
    const N = R.pieces.length, phases = [];
    for (let k = 0; k < N; k++) for (const f of [0.08, 0.5, 0.62, 0.9, 1.05]) phases.push(((k + f) / N) % 1);
    return phases;
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, syncEnv, renderAt, warmPhases,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => loopDuration(R),
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
