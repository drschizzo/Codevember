// Point d'entrée : moteur, scène, génération, interface, boucle de rendu.
//
// Paramètres d'URL : ?seed=… (la scène), #r=… (une scène retouchée, partagée
// par « Copier le lien »), ?ui=0 (sans panneau), ?debug (outils dans
// window.membrane, dont shot(u) : une image fixe à une phase donnée).
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generate, makeLevel, makeArmature, makeMembrane, finishesFor, upgrade, MOODS } from './recipe.js';
import { createRng } from './rng.js';
import { createGenerator } from './gen/client.js';
import { createNest, XMAX, MAIN } from './scene/nest.js';
import { createLights } from './scene/lights.js';
import { makeEnvironment } from './scene/env.js';
import { setNoiseVolume } from './scene/materials.js';
import { G } from './scene/globals.js';
import { createPost } from './render/post.js';
import { createUI } from './app/ui.js';
import { loadRender, saveRender, applyQuality, RENDER_DEFAULTS } from './app/settings.js';
import { exportLoop, exportPNG } from './app/capture.js';

const D = 1; // distance caméra–centre (échelle de la plongée)
const params = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const randomSeed = () => Math.random().toString(36).slice(2, 8);

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
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  try { await renderer.init(); } catch (e) { return fail(`Impossible d’initialiser le rendu : ${e.message}`); }
  // (la simulation des membranes tourne en shaders de calcul WebGPU)
  if (!renderer.backend.isWebGPUBackend) return fail('Membrane demande WebGPU (Chrome, Edge, Safari 26 ou plus récent).');
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  $('#app').appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 2, 7);
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.002, 60);
  camera.layers.mask = MAIN;
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  const camState = { free: false };

  const gen = createGenerator();
  setNoiseVolume(await gen.request({ seed: 'membrane-noise' }, 'noise'));
  const nest = createNest(scene, gen, renderer);
  nest.onError = (e) => toast(`Simulation impossible : ${e.message}`, 6000);
  const lights = createLights(scene);
  const post = createPost(renderer, scene, camera);
  const RENDER = loadRender();

  let R;
  if (location.hash.startsWith('#r=')) { try { R = upgrade(await unpackRecipe(location.hash.slice(3))); } catch { R = null; } }
  R ??= generate(params.get('seed') || randomSeed());
  if (params.has('fast')) R.sim = { ...R.sim, res: 28, frames: 60, substeps: 10, settle: 30 }; // (mise au point : simulation grossière)

  let envKey = '';
  function syncEnv() {
    if (R.env.preset === envKey) return;
    envKey = R.env.preset;
    const old = scene.environment;
    scene.environment = makeEnvironment(envKey);
    old?.dispose();
  }

  const loading = { active: true, settle: 0, t0: performance.now() };
  let ui = null, resetMotion = true;
  function applyRecipe() {
    loading.active = true; loading.settle = 0; loading.t0 = performance.now();
    $('#loader').classList.remove('gone');
    nest.setRecipe(R);
    syncEnv();
    resetMotion = true;
    ui?.rebuild();
    const url = new URL(location.href);
    url.searchParams.set('seed', R.seed);
    url.hash = '';
    history.replaceState(null, '', url);
    document.title = `Membrane · ${R.seed}`;
  }
  // une retouche qui demande une nouvelle simulation (sans écran de chargement :
  // l'ancienne version reste affichée jusqu'à l'arrivée de la nouvelle)
  const resim = (i) => { if (i == null) R.levels.forEach((_, k) => nest.syncLevel(k, R)); else nest.syncLevel(i, R); };

  // ── Rendu d'une phase ──
  function rigCamera(ph) {
    const K = R.camera, w = ph * Math.PI * 2;
    // léger balancement (nombre entier d'oscillations par boucle) ; la caméra
    // reste dans l'axe des ouvertures
    const sx = K.sway * 0.03 * Math.sin(w * 2), sy = K.sway * 0.02 * Math.sin(w * 3 + 1.1);
    camera.position.set(sx * D, sy * D, D);
    camera.up.set(Math.sin(K.roll + w * K.rollTurns), Math.cos(K.roll + w * K.rollTurns), 0);
    camera.lookAt(0, 0, 0);
    if (camera.fov !== K.fov) { camera.fov = K.fov; camera.updateProjectionMatrix(); }
  }
  let info = null;
  function renderAt(u) {
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
    if (camState.free) controls.update(); else rigCamera(ph);
    info = nest.update({ tau, D, R, reset: resetMotion, render: RENDER });
    resetMotion = false;
    lights.update(R, camera, D, D * R.nest.ratio ** (XMAX - 0.6));
    scene.background.set(R.bg);
    G.bgColor.value.set(R.bg);
    scene.fog.color.set(R.bg);
    scene.fog.near = R.fog.near * D;
    scene.fog.far = R.fog.far * D;
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    post.update({ ...RENDER, focus: D * RENDER.focus * 0.6, focusRange: RENDER.focusRange * D }, R);
    post.render();
  }
  function renderStep(u) {
    renderer._nodes?.nodeFrame?.update();
    renderAt(u);
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
  const on = {
    camState,
    random: () => { R = generate(randomSeed()); applyRecipe(); },
    regenerate: (seed) => { if (seed && seed !== R.seed) { R = generate(seed); applyRecipe(); } },
    moodChanged: () => { R = generate(R.seed, { mood: R.mood }); applyRecipe(); },
    levelsChanged: (n) => { R = generate(R.seed, { mood: R.mood, levels: n }); applyRecipe(); },
    copyLink: async () => {
      const url = new URL(location.href);
      url.hash = `r=${await packRecipe(R)}`;
      await navigator.clipboard.writeText(url.href).then(() => toast('Lien copié (scène et retouches)'), () => toast(url.href, 8000));
    },
    togglePause: () => { paused = !paused; toast(paused ? 'Pause' : 'Lecture', 900); },
    recipeChanged: () => {},
    envChanged: () => syncEnv(),
    // (allumer ou éteindre la lumière polarisée recompile les membranes)
    polarChanged: () => R.levels.forEach((_, k) => nest.syncLevel(k, R)),
    resim,
    look: (i) => nest.syncLevel(i, R),
    armSet: (i, s) => { R.levels[i].armSet = s; R.levels[i].armFinish = finishesFor(s, rngUI()); nest.syncLevel(i, R); ui?.rebuildLevels(); },
    accentSet: (i, s) => { R.levels[i].accentSet = s; R.levels[i].accentFinish = finishesFor(s, rngUI()); nest.syncLevel(i, R); ui?.rebuildLevels(); },
    armKind: (i, k) => { R.levels[i].arm = makeArmature(k, rngUI()); resim(i); ui?.rebuildLevels(); },
    membrane: (i, k) => { const m = makeMembrane(k, rngUI()); Object.assign(R.levels[i], { membrane: k, look: m.look, phys: m.phys }); resim(i); ui?.rebuildLevels(); },
    rerollLevel: (i) => { R.levels[i] = makeLevel(rngUI(), R.mood); resim(i); ui?.rebuildLevels(); },
    renderChanged: () => applyRender(),
    quality: (k) => { applyQuality(RENDER, k); applyRender(); },
    resetRender: () => { Object.assign(RENDER, RENDER_DEFAULTS); applyRender(); ui?.refresh(); },
    freeCam: (v) => { camState.free = v; controls.enabled = v; if (v) controls.target.set(0, 0, 0); toast(v ? 'Caméra libre' : 'Caméra du film', 1600); },
    exportPNG: () => exportPNG(canvas, () => renderStep(phi), `membrane-${R.seed}.png`),
    exportVideo: async (o) => {
      if (busy) return;
      busy = true;
      const wasPaused = paused;
      paused = true;
      $('#progress').classList.add('on');
      try {
        await exportLoop({
          canvas, duration: R.loop.beat * R.levels.length, renderAt: renderStep,
          setSize: (w, h) => { renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
          restore: () => { canvas.style.width = ''; canvas.style.height = ''; resize(); },
        }, o, (p) => { $('#progress u').style.width = `${(p * 100).toFixed(1)}%`; }, `membrane-${R.seed}-${o.width}x${o.height}.mp4`);
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
  ui = params.get('ui') === '0' ? null : createUI({ recipe: () => R, render: RENDER, on, nest });

  applyRender();
  applyRecipe();
  if (params.has('debug')) {
    window.membrane = {
      renderer, scene, camera, nest, lights, post, gen, RENDER, renderAt: renderStep, on, G,
      get R() { return R; },
      get info() { return info; },
      seek: (p) => { phi = p; paused = true; },
      play: () => { paused = false; frozen = false; },
      async shot(u, n = 10) {
        while (!nest.ready()) await new Promise((r) => setTimeout(r, 200));
        frozen = true;
        $('#loader').classList.add('gone');
        document.body.classList.add('clean');
        for (let i = 0; i < n; i++) { renderStep(u); await renderer.backend.device?.queue.onSubmittedWorkDone(); }
      },
      // une couche seule, vue de l'extérieur, à la profondeur x (k : recul en rayons)
      async level(j, x, k = 3.2, dir = [0.35, 0.3, 1], all = false) {
        while (!nest.ready()) await new Promise((r) => setTimeout(r, 200));
        frozen = true;
        const d = new THREE.Vector3(...dir).normalize(), q = R.nest.ratio;
        for (let i = 0; i < 6; i++) {
          renderer._nodes.nodeFrame.update();
          renderAt(0);
          nest.update({ tau: j - x, D, R, reset: i === 0, render: RENDER });
          if (!all) nest.slots.forEach((s, jj) => { if (jj !== j) s.group.visible = false; });
          camera.position.copy(d).multiplyScalar(k * q ** x); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
          lights.update(R, camera, D, D * q ** (XMAX - 0.6));
          renderer._nodes.nodeFrame.update();
          post.render();
          await renderer.backend.device.queue.onSubmittedWorkDone();
        }
      },
      // image rendue → JPEG envoyé à un récepteur local (mise au point, panneau masqué)
      async send(name, scale = 0.6, url = 'http://127.0.0.1:8099/') {
        const w = canvas.width, h = canvas.height;
        const rt = new THREE.RenderTarget(w, h, { type: THREE.UnsignedByteType });
        renderer.setRenderTarget(rt); post.render(); renderer.setRenderTarget(null);
        const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
        rt.dispose();
        const c = new OffscreenCanvas(w, h), img = c.getContext('2d').createImageData(w, h), stride = Math.ceil((w * 4) / 256) * 256;
        for (let y = 0; y < h; y++) img.data.set(px.subarray(y * stride, y * stride + w * 4), y * w * 4);
        c.getContext('2d').putImageData(img, 0, 0);
        const s = new OffscreenCanvas(Math.round(w * scale), Math.round(h * scale));
        s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
        const b = await s.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        await fetch(url + name, { method: 'POST', body: b });
        return b.size;
      },
    };
  }
  addEventListener('resize', () => !busy && resize());
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); on.togglePause(); }
    else if (e.key === 'n' || e.key === 'N') on.random();
    else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('clean');
    else if (e.key === 'f' || e.key === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    else if (e.key === 'ArrowRight') phi += 0.004;
    else if (e.key === 'ArrowLeft') phi -= 0.004;
  });

  let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0;
  renderer.setAnimationLoop((now) => {
    if (busy || frozen) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused && !loading.active) phi += dt / (R.loop.beat * R.levels.length);
    renderAt(phi);
    if (loading.active) {
      const k = nest.progress(), el = (performance.now() - loading.t0) / 1000;
      // (progression : couches prêtes, et une estimation du temps de simulation)
      $('#loadbar u').style.width = `${Math.min(99, (k * 0.7 + Math.min(1, el / 9) * 0.3) * 100).toFixed(1)}%`;
      if (nest.ready() && ++loading.settle > 8) { loading.active = false; $('#loader').classList.add('gone'); }
    }
    fpsAcc += dt; fpsN++;
    if ((fpsT += dt) > 0.5) {
      ui?.setFps(`${(fpsN / fpsAcc).toFixed(0)}  ·  ${info?.shown ?? 0} couches`);
      fpsAcc = fpsN = fpsT = 0;
    }
  });
}

main().catch((e) => { console.error(e); fail(e.message); });
export { MOODS };
