// Point d'entrée : moteur, scène, génération, interface, boucle de rendu.
//
// Paramètres d'URL : ?seed=… (la scène), #r=… (une scène retouchée, partagée
// par « Copier le lien »), ?ui=0 (sans panneau), ?export (panneau d'export ouvert).
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generate, geometryFor, finishesFor, makeLayer, randomType, upgrade, beatsFor } from './recipe.js';
import { SETS } from './finishes.js';
import { TYPES } from './types.js';
import { createRng } from './rng.js';
import { createGenerator } from './gen/client.js';
import { createNest } from './scene/nest.js';
import { createLights } from './scene/lights.js';
import { createDust } from './scene/dust.js';
import { makeEnvironment } from './scene/env.js';
import { G, setNoiseVolume } from './scene/materials.js';
import { createPost } from './render/post.js';
import { createUI } from './app/ui.js';
import { loadRender, saveRender, applyQuality, RENDER_DEFAULTS } from './app/settings.js';
import { exportLoop, exportPNG } from './app/capture.js';
import { createSound } from './app/sound.js';

const DEFAULT_SEED = 'ce0gkq'; // scène d'ouverture (sans ?seed=)
const D = 4; // distance caméra–centre (toutes les longueurs de la scène en dépendent)
const params = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const randomSeed = () => Math.random().toString(36).slice(2, 8);

// ── Partage d'une scène retouchée : JSON compressé dans l'ancre ──────────────
async function packRecipe(R) {
  const s = new Blob([JSON.stringify(R)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const b = new Uint8Array(await new Response(s).arrayBuffer());
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpackRecipe(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const s = new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(s).text());
}

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

function fail(msg) {
  $('#loader').classList.add('error');
  $('#loader p').textContent = msg;
}

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

async function main() {
  if (params.has('debug')) {
    const orig = console.error;
    window.hollowErrors = [];
    console.error = (...a) => { orig(...a); if (window.hollowErrors.push(String(a[0]).slice(0, 300)) <= 3) console.log('[pile]', new Error().stack); };
  }
  // ── Moteur ──
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  try { await renderer.init(); } catch (e) { return fail(`Impossible d’initialiser le rendu : ${e.message}`); }
  if (!renderer.backend.isWebGPUBackend) toast('WebGPU indisponible : repli WebGL 2 (plus lent).', 5000);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.transmitted = true; // (vitraux : ombres colorées)
  renderer.toneMappingExposure = 1;
  const canvas = renderer.domElement;
  $('#app').appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 60);
  camera.position.set(0, 0, D);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.minDistance = 0.3;
  controls.maxDistance = 20;
  const camState = { free: false };

  // ── Modules ──
  const gen = createGenerator();
  setNoiseVolume(await gen.request({ seed: 'hollow-noise' }, 0, 'noise')); // (les matériaux en dépendent)
  const nest = createNest(scene, gen);
  const lights = createLights(scene);
  const dust = createDust(scene);
  const post = createPost(renderer, scene, camera, lights);
  const RENDER = loadRender();

  // ── Recette ──
  let R;
  if (location.hash.startsWith('#r=')) {
    try { R = upgrade(await unpackRecipe(location.hash.slice(3))); } catch { R = null; }
  }
  R ??= generate(params.get('seed') || DEFAULT_SEED);
  let envKey = '';

  function syncEnv() {
    const k = R.env.preset;
    if (k === envKey) return;
    envKey = k;
    const old = scene.environment;
    scene.environment = makeEnvironment(k);
    old?.dispose();
  }

  // Écran de chargement : une nouvelle scène ne s'affiche que lorsque toutes ses
  // coquilles ont leur forme définitive (tous niveaux de détail, cristaux) et
  // que quelques images ont été rendues (pipelines compilés, historique TRAA).
  const loading = { active: true, applied: false, settle: 0 };
  function showLoader() {
    loading.active = true;
    loading.applied = false;
    loading.settle = 0;
    $('#loader').classList.remove('gone');
    $('#loader p').textContent = 'génération des coquilles…';
    $('#loadbar u').style.width = '0%';
  }
  let firstRecipe = true;
  function applyRecipe() {
    const recipe = R;
    showLoader();
    // (le fondu d'entrée de l'écran se termine avant que la scène ne change)
    setTimeout(() => {
      if (R !== recipe) return; // (une autre scène a été demandée entre-temps)
      nest.setRecipe(R);
      syncEnv();
      loading.applied = true;
    }, firstRecipe ? 0 : 280);
    firstRecipe = false;
    ui?.rebuild();
    const url = new URL(location.href);
    url.searchParams.set('seed', R.seed);
    url.hash = '';
    history.replaceState(null, '', url);
    document.title = `Hollow · ${R.seed}`;
  }

  // ── Rendu d'une phase ──
  function rig(ph) {
    const w = ph * Math.PI * 2, s = R.camera.sway * D;
    camera.position.set(s * Math.sin(w + 0.7), s * 0.65 * Math.sin(2 * w + 1.3), D);
    const roll = R.camera.roll * Math.sin(w + 2.1);
    camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    camera.lookAt(s * 0.25 * Math.sin(w + 2.4), s * 0.2 * Math.cos(w), 0);
  }
  let shells = 0, curTau = 0;
  // u : phase « déroulée » (le nombre de boucles accomplies en partie entière),
  // pour que chaque instance de coquille garde sa couche d'une boucle à l'autre
  function renderAt(u) {
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
    if (camState.free) controls.update(); else rig(ph);
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
    const pxPerUnit = canvas.height / (2 * Math.tan((camera.fov * Math.PI) / 360)); // (pixels par unité à distance 1)
    const info = nest.update({ tau, phi: ph, cycle, dive, ratio: R.nest.ratio, D, coreRel: R.nest.core, detail: RENDER.detail, pxPerUnit });
    shells = info?.shells ?? 0;
    dust.update({ tau, N: R.layers.length, ratio: R.nest.ratio, xMax: info?.birth ?? 6 }, R.dust);
    lights.update(R, camera, D, Math.sin(ph * Math.PI * 4));
    post.update({ ...RENDER, focus: RENDER.focus * D, focusRange: RENDER.focusRange * D }, R);
    post.render();
  }

  function resize() {
    renderer.setPixelRatio(Math.min(devicePixelRatio, RENDER.pixelRatio));
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  function applyRender() {
    resize();
    lights.setShadowQuality(RENDER.shadows);
    saveRender(RENDER);
  }

  // ── Interface ──
  let phi = 0, paused = false, busy = false, frozen = false;
  const sound = createSound();
  const rngUI = () => createRng(`${R.seed}:${performance.now()}`);
  const layerChanged = (i, rebuildUI = false) => { nest.syncLayer(i); if (rebuildUI) ui?.rebuildLayers(); };
  const on = {
    camState,
    random: () => { R = generate(randomSeed()); applyRecipe(); },
    regenerate: (seed) => { if (seed && seed !== R.seed) { R = generate(seed); applyRecipe(); } },
    moodChanged: () => { R = generate(R.seed, { mood: R.mood }); applyRecipe(); },
    copyLink: async () => {
      const url = new URL(location.href);
      url.hash = `r=${await packRecipe(R)}`;
      await navigator.clipboard.writeText(url.href).then(() => toast('Lien copié (scène et retouches)'), () => toast(url.href, 8000));
    },
    togglePause: () => { paused = !paused; toast(paused ? 'Pause' : 'Lecture', 900); },
    toggleSound: () => toast(sound.toggle() ? 'Son' : 'Silence', 900),
    recipeChanged: () => {},
    envChanged: () => syncEnv(),
    layerGeometry: (i, rebuildUI = false) => layerChanged(i, rebuildUI),
    layerMaterial: (i) => layerChanged(i),
    layerType: (i, t) => {
      const L = R.layers[i], rng = rngUI();
      L.type = t;
      L.geo = geometryFor(t, rng, `${R.seed}:${i}:${rng.int(0, 1e6)}`);
      // (jeu imposé par le type, ou jeu réservé à l'ancien type : on en tire un autre)
      const forced = TYPES[t].set;
      if (forced) { L.set = forced; L.finish = finishesFor(forced, rng); }
      else if (SETS[L.set]?.only) { const N = makeLayer(t, rng, 'x', R.mood); L.set = N.set; L.finish = N.finish; }
      if (TYPES[t].noGroove) L.finish.groove = 0;
      L.finish.seam = L.geo.burst ? 0.07 : 0;
      L.geo.chamfer = SETS[L.set]?.chamfer ?? false;
      layerChanged(i, true);
    },
    layerReroll: (i) => {
      const L = R.layers[i], rng = rngUI(), chamfer = L.geo.chamfer;
      L.geo = geometryFor(L.type, rng, `${R.seed}:${i}:${rng.int(0, 1e6)}`);
      L.geo.chamfer = chamfer;
      layerChanged(i, true);
    },
    layerSet: (i, s) => {
      const L = R.layers[i];
      L.set = s;
      L.finish = finishesFor(s, rngUI());
      if (L.geo.burst) L.finish.seam = 0.07;
      L.geo.chamfer = SETS[s].chamfer;
      layerChanged(i, true);
    },
    layerAxis: (i) => { R.layers[i].motion.axis = rngUI().dir(); },
    rerollBeats: () => { R.camera.beats = beatsFor(rngUI(), 6); },
    addLayer: () => {
      const rng = rngUI();
      const count = {};
      for (const L of R.layers) count[L.type] = (count[L.type] || 0) + 1;
      R.layers.push(makeLayer(randomType(rng, count), rng, `${R.seed}:${R.layers.length}:${rng.int(0, 1e6)}`, R.mood));
      nest.setRecipe(R); ui?.rebuildLayers();
    },
    removeLayer: () => {
      if (R.layers.length <= 2) return toast('Il faut au moins deux couches.');
      R.layers.pop();
      nest.setRecipe(R); ui?.rebuildLayers();
    },
    renderChanged: () => applyRender(),
    quality: (k) => { applyQuality(RENDER, k); applyRender(); },
    resetRender: () => { Object.assign(RENDER, RENDER_DEFAULTS); applyRender(); ui?.refresh(); },
    freeCam: (v) => {
      camState.free = v;
      controls.enabled = v;
      if (v) controls.target.set(0, 0, 0);
      toast(v ? 'Caméra libre : la plongée n’est plus alignée sur les oculus' : 'Caméra du film', 2600);
    },
    exportPNG: () => exportPNG(canvas, () => renderAt(phi), `hollow-${R.seed}.png`),
    exportVideo: async (o) => {
      if (busy) return;
      busy = true;
      const wasPaused = paused;
      paused = true;
      $('#progress').classList.add('on');
      try {
        await exportLoop({
          canvas, duration: R.loop.duration, renderAt,
          setSize: (w, h) => { renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
          restore: () => { canvas.style.width = ''; canvas.style.height = ''; resize(); },
        }, o, (p) => { $('#progress u').style.width = `${(p * 100).toFixed(1)}%`; }, `hollow-${R.seed}-${o.width}x${o.height}.mp4`);
        toast('Boucle exportée');
      } catch (e) {
        console.error(e);
        toast(`Export impossible : ${e.message}`, 6000);
      } finally {
        $('#progress').classList.remove('on');
        busy = false;
        paused = wasPaused;
      }
    },
  };
  const ui = params.get('ui') === '0' ? null : createUI({ recipe: () => R, render: RENDER, on });
  if (ui && params.has('export')) ui.gui.folders[0]?.open();

  applyRender();
  applyRecipe();
  if (params.has('debug')) {
    window.hollow = {
      renderer, scene, camera, controls, nest, lights, dust, post, gen, RENDER, renderAt, on,
      get R() { return R; },
      seek: (p) => { phi = p; paused = true; },
      play: () => { paused = false; },
      freeze: (v) => { frozen = v; },
      // image fixe rendue à la demande (n images : historique de l'anticrénelage)
      async shot(ph, n = 12) {
        while (!nest.ready()) await new Promise((r) => setTimeout(r, 200));
        frozen = true;
        $('#loader').classList.add('gone');
        document.body.classList.add('clean');
        for (let i = 0; i < n; i++) { renderAt(ph); await renderer.backend.device?.queue.onSubmittedWorkDone(); }
      },
      // la couche i à la profondeur relative x (seule, ou dans la scène)
      view(i, x, solo = true) {
        const N = R.layers.length;
        nest.solo = solo ? i : null;
        return this.shot((((i - x) % N) + N) % N / N);
      },
    };
  }
  addEventListener('resize', () => !busy && resize());

  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); on.togglePause(); }
    else if (e.key === 'n' || e.key === 'N') on.random();
    else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('clean');
    else if (e.key === 's' || e.key === 'S') on.toggleSound();
    else if (e.key === 'f' || e.key === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    else if (e.key === 'ArrowRight') phi += 0.01;
    else if (e.key === 'ArrowLeft') phi -= 0.01;
  });

  // ── Boucle ──
  let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0;
  renderer.setAnimationLoop((now) => {
    if (busy || frozen) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused && !loading.active) phi += dt / R.loop.duration;
    renderAt(phi);
    if (!loading.active) sound.update({ tau: curTau, phase: phi - Math.floor(phi), N: R.layers.length, layers: R.layers, mood: R.mood });
    if (loading.active) {
      $('#loadbar u').style.width = `${(nest.progress() * 100).toFixed(1)}%`;
      if (loading.applied && nest.ready() && ++loading.settle > 8) { loading.active = false; $('#loader').classList.add('gone'); }
    }
    fpsAcc += dt; fpsN++;
    if ((fpsT += dt) > 0.5) { ui?.setFps(`${(fpsN / fpsAcc).toFixed(0)}  ·  ${shells} coquilles  ·  ${gen.busy() ? 'génération…' : 'prêt'}`); fpsAcc = fpsN = fpsT = 0; }
  });
}

main().catch((e) => { console.error(e); fail(e.message); });
