// Point d'entrée : moteur, scène, génération, interface, boucle de rendu.
//
// Paramètres d'URL : ?seed=… (la scène), #r=… (une scène retouchée, partagée
// par « Copier le lien »), ?ui=0 (sans panneau), ?export (panneau d'export ouvert).
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generate, geometryFor, finishesFor, makeLayer, randomType } from './recipe.js';
import { SETS } from './finishes.js';
import { createRng } from './rng.js';
import { createGenerator } from './gen/client.js';
import { createNest } from './scene/nest.js';
import { createLights } from './scene/lights.js';
import { makeEnvironment } from './scene/env.js';
import { G, setNoiseVolume } from './scene/materials.js';
import { createPost } from './render/post.js';
import { createUI } from './app/ui.js';
import { loadRender, saveRender, applyQuality, RENDER_DEFAULTS } from './app/settings.js';
import { exportLoop, exportPNG } from './app/capture.js';

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
  const post = createPost(renderer, scene, camera, lights);
  const RENDER = loadRender();

  // ── Recette ──
  let R;
  if (location.hash.startsWith('#r=')) {
    try { R = await unpackRecipe(location.hash.slice(3)); } catch { R = null; }
  }
  R ??= generate(params.get('seed') || randomSeed());
  let envKey = '';

  function syncEnv() {
    const k = R.env.preset;
    if (k === envKey) return;
    envKey = k;
    const old = scene.environment;
    scene.environment = makeEnvironment(k);
    old?.dispose();
  }

  function applyRecipe() {
    nest.setRecipe(R);
    syncEnv();
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
  let shells = 0;
  // u : phase « déroulée » (le nombre de boucles accomplies en partie entière),
  // pour que chaque instance de coquille garde sa couche d'une boucle à l'autre
  function renderAt(u) {
    const cycle = Math.floor(u), ph = u - cycle;
    const dive = R.loop.dive;
    const tau = dive ? ph * R.layers.length : R.loop.depth;
    if (camState.free) controls.update(); else rig(ph);
    if (camera.fov !== R.camera.fov) { camera.fov = R.camera.fov; camera.updateProjectionMatrix(); }
    G.phase.value = ph;
    G.D.value = D;
    G.envFalloff.value = RENDER.envFalloff;
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    scene.fog.near = R.fog.near * D;
    scene.fog.far = R.fog.far * D;
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    const info = nest.update({ tau, phi: ph, cycle, dive, ratio: R.nest.ratio, D, coreRel: R.nest.core, detail: RENDER.detail });
    shells = info?.shells ?? 0;
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
  const rngUI = () => createRng(`${R.seed}:${performance.now()}`);
  const layerChanged = (i, rebuildUI = false) => { nest.syncLayer(i); if (rebuildUI) ui.rebuildLayers(); };
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
    recipeChanged: () => {},
    envChanged: () => syncEnv(),
    layerGeometry: (i) => layerChanged(i),
    layerMaterial: (i) => layerChanged(i),
    layerType: (i, t) => {
      const L = R.layers[i], rng = rngUI();
      L.type = t;
      L.geo = geometryFor(t, rng, `${R.seed}:${i}:${rng.int(0, 1e6)}`);
      if (t === 'geode') { L.set = 'geode'; L.finish = finishesFor('geode', rng); }
      else if (L.set === 'geode') { const N = makeLayer(t, rng, 'x', R.mood); L.set = N.set; L.finish = N.finish; }
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
      L.geo.chamfer = SETS[s].chamfer;
      layerChanged(i, true);
    },
    layerAxis: (i) => { R.layers[i].motion.axis = rngUI().dir(); },
    addLayer: () => {
      const rng = rngUI();
      R.layers.push(makeLayer(randomType(rng), rng, `${R.seed}:${R.layers.length}:${rng.int(0, 1e6)}`, R.mood));
      nest.setRecipe(R); ui.rebuildLayers();
    },
    removeLayer: () => {
      if (R.layers.length <= 2) return toast('Il faut au moins deux couches.');
      R.layers.pop();
      nest.setRecipe(R); ui.rebuildLayers();
    },
    renderChanged: () => applyRender(),
    quality: (k) => { applyQuality(RENDER, k); applyRender(); },
    resetRender: () => { Object.assign(RENDER, RENDER_DEFAULTS); applyRender(); ui.refresh(); },
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
      renderer, scene, camera, nest, lights, post, gen, RENDER, renderAt, on,
      get R() { return R; },
      seek: (p) => { phi = p; paused = true; },
      play: () => { paused = false; },
      freeze: (v) => { frozen = v; },
    };
  }
  addEventListener('resize', () => !busy && resize());

  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); on.togglePause(); }
    else if (e.key === 'n' || e.key === 'N') on.random();
    else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('clean');
    else if (e.key === 'f' || e.key === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    else if (e.key === 'ArrowRight') phi += 0.01;
    else if (e.key === 'ArrowLeft') phi -= 0.01;
  });

  // ── Boucle ──
  let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0, ready = false;
  renderer.setAnimationLoop((now) => {
    if (busy || frozen) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) phi += dt / R.loop.duration;
    renderAt(phi);
    if (!ready && shells > 0) { ready = true; $('#loader').classList.add('gone'); }
    fpsAcc += dt; fpsN++;
    if ((fpsT += dt) > 0.5) { ui?.setFps(`${(fpsN / fpsAcc).toFixed(0)}  ·  ${shells} coquilles  ·  ${gen.busy() ? 'génération…' : 'prêt'}`); fpsAcc = fpsN = fpsT = 0; }
  });
}

main().catch((e) => { console.error(e); fail(e.message); });
