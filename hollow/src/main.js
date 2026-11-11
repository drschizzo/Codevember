// Point d'entrée : moteur, scène, génération, interface, boucle de rendu.
//
// Paramètres d'URL : ?seed=… (la scène), #r=… (une scène retouchée, partagée
// par « Copier le lien »), ?ui=0 (sans panneau), ?export (panneau d'export ouvert),
// ?mobile=1 / ?mobile=0 (version allégée imposée / interdite ; voir app/mobile.js),
// ?debug (outils dans window.hollow, dont run() : la boucle à la main).
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
import { G, setNoiseVolume, setLite } from './scene/materials.js';
import { createPost } from './render/post.js';
import { createUI } from './app/ui.js';
import { loadRender, saveRender, applyQuality, defaultsFor } from './app/settings.js';
import { wantsMobile, switchMobile, createGovernor, createPacer, bindTouch } from './app/mobile.js';
import { exportLoop, exportPNG } from './app/capture.js';
import { createSound } from './app/sound.js';
import { loader } from './app/loader.js';
import { asyncPipelines, warmScene } from './app/warmup.js';

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

// un échec : dit à l'écran, avec de quoi repartir (une fois l'interface prête)
let retry = null;
function fail(msg) {
  loader.error(msg, retry ? [{ label: 'Autre graine', run: () => retry.random() }, { label: 'Réessayer', run: () => retry.again() }] : []);
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
  const errors = [];
  if (params.has('debug')) {
    const orig = console.error;
    window.hollowErrors = errors;
    console.error = (...a) => { orig(...a); if (errors.push(String(a[0]).slice(0, 300)) <= 3) console.log('[pile]', new Error().stack); };
  }
  // ── Version mobile (fixée au chargement) ──
  const LITE = wantsMobile(params);
  setLite(LITE);
  if (LITE) document.body.classList.add('lite');
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
  // Chargement sans gel : pipelines asynchrones pendant le chargement, et
  // préparation découpée en petits lots (app/warmup.js).
  const pipes = asyncPipelines(renderer);

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

  // ── Recette ── (connue avant les modules : l'écran de chargement en dessine les couches)
  let R;
  if (location.hash.startsWith('#r=')) {
    try { R = upgrade(await unpackRecipe(location.hash.slice(3))); } catch { R = null; }
  }
  R ??= generate(params.get('seed') || DEFAULT_SEED);
  // l'écran de chargement : les coquilles de la recette, tracées à mesure qu'elles sont générées (app/loaderArt.js)
  const showNest = () => loader.art({
    seed: R.seed, ratio: R.nest.ratio, core: R.nest.core, coreColor: R.core.color, beats: R.camera.beats, ramp: R.camera.ramp,
    layers: R.layers.map((L) => ({ type: L.type, geo: L.geo, color: L.finish.outer.color, spin: L.motion.spin, phase: L.motion.phase })),
  });
  showNest();

  // ── Modules ──
  // (mobile : moins de workers, la génération ne doit pas étouffer le rendu)
  const gen = createGenerator(LITE ? Math.max(2, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)) : undefined);
  setNoiseVolume(await gen.request({ seed: 'hollow-noise' }, 0, 'noise')); // (les matériaux en dépendent)
  const nest = createNest(scene, gen, { minLod: LITE ? 1 : 0 });
  const lights = createLights(scene, { lite: LITE });
  const dust = createDust(scene, { lite: LITE });
  const post = createPost(renderer, scene, camera, lights);
  const RENDER = loadRender(LITE);
  // résolution dynamique : vise ~45 images / s, entre 50 et 100 % de la résolution de base
  const governor = createGovernor({ target: 1 / 45, min: 0.5, max: 1, onChange: () => !busy && resize() });
  const pace = createPacer(() => RENDER.maxFps);

  let envKey = '';

  function syncEnv() {
    const k = R.env.preset;
    if (k === envKey) return;
    envKey = k;
    const old = scene.environment;
    scene.environment = makeEnvironment(k, 0, LITE ? 512 : 1024);
    old?.dispose();
  }

  // Écran de chargement : une nouvelle scène ne s'affiche que lorsque toutes ses
  // coquilles ont leur forme définitive (tous niveaux de détail, cristaux), que
  // ses matériaux sont préparés (warm : avec la géométrie définitive — nest.js
  // reconstruit les matériaux quand elle arrive) et que quelques images ont été
  // rendues (historique TRAA). Rien n'est dessiné avant : pas de compilation
  // synchrone pendant le chargement.
  const loading = { active: true, applied: false, warming: false, settle: 0 };
  const STEPS = [['build', 'les coquilles se forment'], ['compile', 'la lumière se prépare'], ['settle', 'premières images']];
  let lastProg = '';
  let firstRecipe = true;
  function applyRecipe() {
    const recipe = R;
    loading.active = true; loading.applied = false; loading.warming = false; loading.settle = 0;
    loader.show({ steps: STEPS });
    showNest();
    lastProg = '';
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
    renderer.setPixelRatio(Math.min(devicePixelRatio, RENDER.pixelRatio) * (RENDER.dynRes ? governor.scale : 1));
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  // Rendu hors de la boucle d'animation (export, image fixe, débogage). three.js
  // ne refait la passe de scène, les cartes d'ombre et les vecteurs vitesse de
  // la caméra qu'une fois par « image » de son compteur, qui n'avance que dans
  // setAnimationLoop : plusieurs rendus dans le même tour de boucle
  // réutiliseraient la première image (vidéo exportée aux images dupliquées).
  function renderStep(u) {
    renderer._nodes?.nodeFrame?.update();
    renderAt(u);
  }

  // Préparation de tout ce que la boucle dessinera, sans gel : deux boucles de la
  // plongée (chaque couche passe à toutes les profondeurs et tous les niveaux de
  // détail, et les instances des deux boucles sont construites).
  const PHASES = Array.from({ length: 16 }, (_, i) => i / 8);
  async function warm() {
    loading.warming = true;
    loader.step('compile');
    const recipe = R;
    try {
      return await warmScene({
        renderer, scene, pipes, render: renderStep, phases: PHASES,
        onProgress: (f) => loader.progress(f), alive: () => R === recipe,
      });
    } finally {
      loading.warming = false;
      if (R === recipe) loader.step('settle');
    }
  }

  function applyRender() {
    if (!RENDER.dynRes) governor.reset();
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
    quality: (k) => {
      // (entrer dans le mode mobile ou en sortir recompile les matériaux : rechargement)
      if ((k === 'mobile') !== LITE) { toast('Rechargement…', 0); return switchMobile(k === 'mobile'); }
      applyQuality(RENDER, k); applyRender();
    },
    resetRender: () => { Object.assign(RENDER, defaultsFor(LITE)); applyRender(); ui?.refresh(); },
    freeCam: (v) => {
      camState.free = v;
      controls.enabled = v;
      if (v) controls.target.set(0, 0, 0);
      toast(v ? 'Caméra libre : la plongée n’est plus alignée sur les oculus' : 'Caméra du film', 2600);
    },
    exportPNG: () => exportPNG(canvas, () => renderStep(phi), `hollow-${R.seed}.png`),
    exportVideo: async (o) => {
      if (busy) return;
      busy = true;
      const wasPaused = paused;
      paused = true;
      $('#progress').classList.add('on');
      try {
        await exportLoop({
          canvas, duration: R.loop.duration, renderAt: renderStep,
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
  // Écran tactile : le panneau reste replié (il couvrirait l'image) ; une touche
  // met en pause, deux touches tirent une nouvelle scène, un appui long masque
  // l'interface.
  const touch = LITE || !!matchMedia?.('(pointer: coarse)').matches;
  let hinted = false;
  if (touch) {
    if (!params.has('export')) ui?.gui.close();
    bindTouch(canvas, {
      onTap: () => on.togglePause(),
      onDoubleTap: () => on.random(),
      onLongPress: () => document.body.classList.toggle('clean'),
    });
  }

  retry = { random: () => on.random(), again: () => applyRecipe() };
  applyRender();
  applyRecipe();
  if (params.has('debug')) {
    window.hollow = {
      renderer, scene, camera, controls, nest, lights, dust, post, gen, RENDER, pipes, errors, renderAt: renderStep, on,
      get R() { return R; },
      seek: (p) => { phi = p; paused = true; },
      play: () => { paused = false; frozen = false; },
      freeze: (v) => { frozen = v; },
      // image fixe rendue à la demande (n images : historique de l'anticrénelage)
      async shot(ph, n = 12) {
        await this.run(); // (fin du chargement, même panneau masqué)
        frozen = true;
        document.body.classList.add('clean');
        for (let i = 0; i < n; i++) { renderStep(ph); await renderer.backend.device?.queue.onSubmittedWorkDone(); }
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
  // (la boucle est une fonction nommée : en ?debug, run() la fait tourner à la
  // main quand le navigateur suspend requestAnimationFrame, panneau masqué)
  function tick(now) {
    if (busy || frozen || loading.warming) return;
    if (!pace(now)) return; // (écrans 90 / 120 Hz : cadence plafonnée)
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (RENDER.dynRes && !loading.active) governor.frame(dt); // (pas pendant le chargement : les workers faussent la mesure)
    if (!paused && !loading.active) phi += dt / R.loop.duration;
    if (loading.active) {
      const ready = loading.applied && nest.ready();
      if (!loading.settle) {
        // l'avancement de chaque couche, pour son tracé à l'écran de chargement
        if (loading.applied) {
          const prog = nest.designs.map((d) => +d.progress.toFixed(3)), key = prog.join();
          if (key !== lastProg) { lastProg = key; loader.art({ seed: R.seed, prog }); }
        }
        loader.progress(loading.applied ? nest.progress() : 0);
      } else if (loading.settle >= 2) loader.progress((loading.settle - 2) / 7);
      if (ready) {
        if (!loading.settle) {
          loading.settle = 1;
          warm().then((ok) => { if (ok) loading.settle = 2; }, (e) => fail(`Le rendu n'a pas pu être préparé (${e.message}).`));
        } else if (loading.settle >= 2 && ++loading.settle > 8) {
          loading.active = false;
          loader.hide();
          if (touch && !hinted) { hinted = true; toast('touche : pause · deux touches : nouvelle scène · appui long : masquer', 4500); }
        }
      }
      if (!ready || loading.settle < 2) return;
    }
    renderAt(phi);
    if (!loading.active) sound.update({ tau: curTau, phase: phi - Math.floor(phi), N: R.layers.length, layers: R.layers, mood: R.mood });
    fpsAcc += dt; fpsN++;
    if ((fpsT += dt) > 0.5) { ui?.setFps(`${(fpsN / fpsAcc).toFixed(0)}  ·  ${shells} coquilles  ·  ${RENDER.dynRes ? `${Math.round(governor.scale * 100)} %  ·  ` : ''}${gen.busy() ? 'génération…' : 'prêt'}`); fpsAcc = fpsN = fpsT = 0; }
  }
  renderer.setAnimationLoop(tick);
  if (window.hollow) {
    // fait tourner la boucle à la main jusqu'à la fin du chargement (ou pendant
    // `seconds` de film) : à utiliser quand le panneau est masqué
    window.hollow.run = async (seconds = 0) => {
      frozen = false; // (une image fixe gèle la boucle : le chargement suivant ne finirait jamais)
      const t0 = performance.now();
      while (loading.active || performance.now() - t0 < seconds * 1000) {
        renderer._nodes?.nodeFrame?.update();
        tick(performance.now());
        await new Promise((r) => setTimeout(r, 16));
      }
    };
    Object.defineProperty(window.hollow, 'loading', { get: () => ({ ...loading }) });
  }
}

main().catch((e) => { console.error(e); fail(e.message); });
