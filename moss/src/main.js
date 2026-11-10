// Point d'entrée : moteur, scène, génération, interface, boucle de rendu.
//
// Paramètres d'URL : ?seed=… (la scène), #r=… (une scène retouchée, partagée
// par « Copier le lien »), ?ui=0 (sans panneau), ?mobile=1 / ?mobile=0
// (version allégée imposée / interdite), ?debug (outils dans window.moss),
// ?syncpipes (compilation synchrone des shaders, pour comparer).
//
// Invariant central : renderAt(u) ne dépend que de la recette R et de la
// phase u. La lecture, l'export image par image, le rendu accumulé et les
// outils de mise au point passent tous par lui.
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generate, upgrade, MOODS } from './recipe.js';
import { createGenerator } from './gen/client.js';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from './scene/env.js';
import { G } from './scene/globals.js';
import { setNoiseVolume, setLite } from './scene/materials.js';
import { createPost } from './render/post.js';
import { createAccumulator, jitter } from './render/accum.js';
import { createUI } from './app/ui.js';
import { loadRender, saveRender, applyQuality, defaultsFor } from './app/settings.js';
import { wantsMobile, switchMobile, createGovernor, createPacer, bindTouch } from './app/mobile.js';
import { exportLoop, exportPNG } from './app/capture.js';

const NAME = 'moss';
const DEFAULT_SEED = 'b88'; // Sous-bois, tortule : un tapis sur une souche, soies dressées
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
  $('#loader').classList.remove('gone');
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
  const errors = [];
  if (params.has('debug')) { // (avant toute compilation : les erreurs du chargement sinon échappent)
    const orig = console.error;
    console.error = (...a) => { orig(...a); errors.push(String(a[0]).slice(0, 400)); };
  }
  // ── Version mobile (fixée au chargement : elle change les shaders) ──
  const LITE = wantsMobile(params);
  setLite(LITE);
  if (LITE) document.body.classList.add('lite');

  // ── Moteur ──
  if (!navigator.gpu) return fail('Ce navigateur ne prend pas en charge WebGPU (Chrome, Edge, Safari 26 ou Firefox récents).');
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  try { await renderer.init(); } catch (e) { return fail(`Impossible d'initialiser le rendu : ${e.message}`); }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.transmitted = true; // (verre : ombres colorées)
  const canvas = renderer.domElement;
  $('#app').appendChild(canvas);

  // Chargement sans gel : three.js crée ses pipelines de façon synchrone au
  // premier dessin, et le processus graphique du navigateur (donc toute la
  // page) reste bloqué pendant chaque compilation. Pendant le chargement, on
  // les demande en asynchrone ; tant qu'une pipeline n'est pas prête, l'objet
  // est sauté, et l'on redessine jusqu'à ce qu'il n'en manque plus.
  const pipes = { on: false, pending: [], made: 0 };
  if (renderer.backend.isWebGPUBackend && !params.has('syncpipes')) {
    const be = renderer.backend, create = be.createRenderPipeline.bind(be);
    be.createRenderPipeline = (renderObject, promises) => {
      if (!pipes.on || promises) return create(renderObject, promises);
      const list = [];
      create(renderObject, list);
      const data = be.get(renderObject.pipeline);
      data.error = true;
      pipes.made++;
      pipes.pending.push(Promise.all(list).then(() => { if (data.pipeline) data.error = false; }));
    };
  }
  const flushPipes = async () => { while (pipes.pending.length) await Promise.all(pipes.pending.splice(0)); };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.02, 900);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  const camState = { free: false };

  // ── Modules ──
  const gen = createGenerator(LITE ? Math.max(2, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)) : undefined);
  setNoiseVolume(await gen.request({ seed: `${NAME}-noise` }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite: LITE });
  const post = createPost(renderer, scene, camera);
  const accum = createAccumulator(renderer);
  const RENDER = loadRender(LITE);
  const governor = createGovernor({ target: 1 / 45, min: 0.5, max: 1, onChange: () => !busy && resize() });
  const pace = createPacer(() => RENDER.maxFps);

  // ── Recette ──
  let R = null;
  if (location.hash.startsWith('#r=')) {
    try { R = upgrade(await unpackRecipe(location.hash.slice(3))); } catch { R = null; }
  }
  const forced = Object.fromEntries(['mood', 'family', 'water'].filter((k) => params.get(k)).map((k) => [k, params.get(k)]));
  R ??= generate(params.get('seed') || DEFAULT_SEED, forced);
  let envKey = '';
  function syncEnv() {
    const k = R.env.preset;
    if (k === envKey) return;
    envKey = k;
    const old = scene.environment;
    scene.environment = makeEnvironment(k, 0, LITE ? 512 : 1024);
    old?.dispose();
  }

  // ── Écran de chargement ──
  // Une scène ne s'affiche que lorsque toute sa géométrie est arrivée, que ses
  // shaders sont compilés et que quelques images ont été rendues (historique
  // de l'anticrénelage temporel). On ne voit jamais une forme se transformer.
  const loading = { active: true, applied: false, warming: false, settle: 0 };
  let firstRecipe = true;
  function applyRecipe() {
    const recipe = R;
    loading.active = true; loading.applied = false; loading.warming = false; loading.settle = 0;
    $('#loader').classList.remove('gone', 'error');
    $('#loader p').textContent = 'les tiges poussent, l\'eau passe…';
    $('#loadbar u').style.width = '0%';
    document.body.classList.add('loading');
    // (le fondu d'entrée de l'écran se termine avant que la scène ne change)
    setTimeout(() => {
      if (R !== recipe) return;
      stage.setRecipe(R);
      syncEnv();
      loading.applied = true;
    }, firstRecipe ? 0 : 280);
    firstRecipe = false;
    ui?.rebuild();
    const url = new URL(location.href);
    url.searchParams.set('seed', R.seed);
    url.hash = '';
    history.replaceState(null, '', url);
    document.title = `Moss · ${R.seed}`;
  }

  // Préparation : pipelines asynchrones, rendus aux moments qui comptent
  // (ceux qui montrent des objets ou des états qu'on ne voit pas au début),
  // frustum désactivé (un objet hors champ n'est pas compilé).
  async function warm() {
    loading.warming = true;
    pipes.on = true;
    const culled = [];
    scene.traverse((o) => { if (o.isMesh && o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
    try {
      for (let pass = 0; pass < 6; pass++) {
        const before = pipes.made;
        for (const ph of [0, 0.16, 0.3, 0.5, 0.7, 0.9]) { renderStep(ph); await flushPipes(); await new Promise((r) => setTimeout(r, 0)); }
        if (pipes.made === before) break;
      }
      if (scene.environment) scene.environment.needsPMREMUpdate = true; // (préfiltré pendant des dessins sautés)
    } finally {
      for (const o of culled) o.frustumCulled = true;
      pipes.on = false;
      loading.warming = false;
    }
  }

  // ── Rendu d'une phase ──
  const TAU = Math.PI * 2;
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
  // u : phase « déroulée » (partie entière = nombre de boucles accomplies) ;
  // sub : décalages d'un rendu accumulé (lentille, pixel), facultatif
  function renderAt(u, sub = null) {
    const ph = u - Math.floor(u);
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    const st = stage.update(u, camera);
    const pose = st?.pose;
    if (camState.free) controls.update();
    else if (pose) {
      camera.position.set(...pose.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(_r.set(...pose.target));
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub && pose) {
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      // (ouverture de l'objectif macro : la vraie profondeur de champ du rendu accumulé)
      const ap = 0.05 * (RENDER.dof ? RENDER.bokeh / 2 : 0.3) * C.aperture;
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(_r.set(...pose.target));
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    if (st) {
      scene.background.copy(st.fogColor);
      scene.fog.color.copy(st.fogColor);
      scene.fog.near = 3; scene.fog.far = 3 + 90 / Math.max(0.05, st.fogDensity);
    }
    scene.environmentIntensity = R.env.intensity * (st ? 0.55 + 0.45 * st.clear : 1);
    scene.environmentRotation.set(0, R.env.rotation, 0);
    const focus = camState.free ? camera.position.distanceTo(controls.target) : (pose?.focus ?? 5);
    post.update({ ...RENDER, lite: LITE, focus: focus * RENDER.focus, focusRange: focus * RENDER.focusRange / C.aperture }, R);
    post.render();
  }
  // Rendu hors de la boucle d'animation (export, image fixe, débogage) : three.js
  // ne refait la passe de scène, les ombres et les vitesses de la caméra
  // qu'une fois par « image » de son compteur, qui n'avance que dans
  // setAnimationLoop. Sans cette ligne, la vidéo exportée a des images dupliquées.
  function renderStep(u, sub) {
    renderer._nodes?.nodeFrame?.update();
    renderAt(u, sub);
  }
  // image accumulée : n rendus décalés (temps, lentille, pixel), moyennés
  function renderAccum(u, n, frame = 0, shutter = 0) {
    accum.begin(canvas.width, canvas.height);
    for (let i = 0; i < n; i++) {
      const s = jitter(i, frame);
      renderStep(u + s.time * shutter, s);
      accum.add(1 / n);
    }
    camera.clearViewOffset();
    accum.present();
  }

  function resize() {
    renderer.setPixelRatio(Math.min(devicePixelRatio, RENDER.pixelRatio) * (RENDER.dynRes ? governor.scale : 1));
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  function applyRender() {
    if (!RENDER.dynRes) governor.reset();
    resize();
    stage.setShadowQuality(RENDER.shadows);
    saveRender(RENDER);
  }

  // ── Interface ──
  let phi = 0, paused = false, busy = false, frozen = false;
  const on = {
    camState,
    random: () => { R = generate(randomSeed()); applyRecipe(); },
    regenerate: (seed) => { if (seed && seed !== R.seed) { R = generate(seed); applyRecipe(); } },
    moodChanged: (mood) => { R = generate(R.seed, { mood }); applyRecipe(); },
    regen: (o) => { R = generate(R.seed, { mood: R.mood, family: R.family, water: R.water, ...o }); applyRecipe(); },
    rebuild: () => applyRecipe(),
    cameraChanged: () => stage.cameraChanged(),
    copyLink: async () => {
      const url = new URL(location.href);
      url.hash = `r=${await packRecipe(R)}`;
      await navigator.clipboard.writeText(url.href).then(() => toast('Lien copié (scène et retouches)'), () => toast(url.href, 8000));
    },
    togglePause: () => { paused = !paused; toast(paused ? 'Pause' : 'Lecture', 900); },
    recipeChanged: () => {},
    finishChanged: () => stage.syncFinishes(),
    envChanged: () => syncEnv(),
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
      if (v) controls.target.set(0, 0.6, 0);
      toast(v ? 'Caméra libre' : 'Caméra du film', 1600);
    },
    exportPNG: (o = {}) => exportPNG(canvas, () => (o.samples > 1 ? renderAccum(phi, o.samples) : renderStep(phi)), `${NAME}-${R.seed}.png`),
    exportVideo: async (o) => {
      if (busy) return;
      busy = true;
      const wasPaused = paused;
      paused = true;
      $('#progress').classList.add('on');
      const n = o.samples ?? 1;
      try {
        await exportLoop({
          canvas, duration: R.loop.duration, prime: n <= 1,
          // (rendu accumulé : obturateur à 180°, soit une demi-image, en phase)
          renderAt: n > 1 ? (u, i = 0) => renderAccum(u, n, i, 0.5 / (R.loop.duration * o.fps)) : (u) => renderStep(u), // (exportLoop passe aussi l'indice de l'image : ce n'est pas un décalage)
          setSize: (w, h) => { renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
          restore: () => { canvas.style.width = ''; canvas.style.height = ''; resize(); },
        }, o, (p) => { $('#progress u').style.width = `${(p * 100).toFixed(1)}%`; }, `${NAME}-${R.seed}-${o.width}x${o.height}.mp4`);
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
  const ui = params.get('ui') === '0' ? null : createUI({ recipe: () => R, render: RENDER, on, moods: MOODS });
  // Écran tactile : panneau replié ; une touche = pause, deux touches = nouvelle
  // scène, appui long = masquer l'interface
  const touch = LITE || !!matchMedia?.('(pointer: coarse)').matches;
  let hinted = false;
  if (touch) {
    ui?.gui.close();
    bindTouch(canvas, { onTap: () => on.togglePause(), onDoubleTap: () => on.random(), onLongPress: () => document.body.classList.toggle('clean') });
  }

  applyRender();
  applyRecipe();

  if (params.has('debug')) {
    window[NAME] = {
      renderer, scene, camera, controls, stage, post, gen, RENDER, G, pipes, errors, on, renderAt: renderStep, renderAccum,
      get R() { return R; },
      seek: (p) => { phi = p; paused = true; },
      play: () => { paused = false; frozen = false; },
      freeze: (v = true) => { frozen = v; },
      // image fixe à la phase ph (n images : historique de l'anticrénelage)
      async shot(ph, n = 12) {
        await this.run(); // (fin du chargement, même panneau masqué)
        frozen = true;
        document.body.classList.add('clean');
        for (let i = 0; i < n; i++) { renderStep(ph); await renderer.backend.device?.queue.onSubmittedWorkDone(); }
      },
      // image rendue, envoyée au collecteur local (tools/sink.py) : la capture
      // d'écran du panneau de navigateur est périmée quand il est masqué
      async send(name, scale = 0.5, url = 'http://127.0.0.1:8109/') {
        const w = canvas.width, h = canvas.height;
        const rt = new THREE.RenderTarget(w, h, { type: THREE.UnsignedByteType });
        renderer.setRenderTarget(rt); post.render(); renderer.setRenderTarget(null);
        const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
        rt.dispose();
        const c = new OffscreenCanvas(w, h), img = c.getContext('2d').createImageData(w, h), stride = Math.ceil((w * 4) / 256) * 256;
        for (let y = 0; y < h; y++) img.data.set(px.subarray(y * stride, y * stride + w * 4), y * w * 4);
        c.getContext('2d').putImageData(img, 0, 0);
        const sc = new OffscreenCanvas(Math.round(w * scale), Math.round(h * scale));
        sc.getContext('2d').drawImage(c, 0, 0, sc.width, sc.height);
        const b = await sc.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
        await fetch(url + name, { method: 'POST', body: b });
        return b.size;
      },
      // planche : les graines × les phases, chaque image envoyée au collecteur
      async sheet(seeds, phases = [0, 0.2, 0.4, 0.6, 0.8], prefix = 'sheet') {
        for (const s of seeds) {
          const [seed, mood, family] = String(s).split(':');
          R = generate(seed, { ...(mood ? { mood } : {}), ...(family ? { family } : {}) }); applyRecipe();
          await new Promise((r) => setTimeout(r, 400));
          for (const ph of phases) { await this.shot(ph); await this.send(`${prefix}-${String(s).replace(/:/g, '_')}-${String(Math.round(ph * 100)).padStart(3, '0')}.jpg`); }
        }
      },
      // posemètre : luminance de la passe de scène (HDR, avant étalonnage) sur
      // l'image et sur son centre — médiane, centiles, part de noir et de brûlé
      async meter(box = 0.18) {
        const rt = post.nodes.scenePass.renderTarget, w = rt.width, h = rt.height;
        const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h, 0);
        const half = px instanceof Uint16Array, val = (i) => (half ? THREE.DataUtils.fromHalfFloat(px[i]) : px[i]);
        const stride = Math.ceil((w * (half ? 8 : 16)) / 256) * 256 / (half ? 2 : 4);
        const all = [], mid = [], b = box * h;
        for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
          const i = y * stride + x * 4, L = 0.2126 * val(i) + 0.7152 * val(i + 1) + 0.0722 * val(i + 2);
          if (!(L >= 0)) continue;
          all.push(L);
          if (Math.abs(x - w / 2) < b && Math.abs(y - h / 2) < b) mid.push(L);
        }
        const stat = (a) => { a.sort((p, q) => p - q); const q = (t) => +a[Math.min(a.length - 1, Math.floor(t * a.length))].toFixed(3); return { p50: q(0.5), p90: q(0.9), p99: q(0.99), noir: +(a.filter((v) => v < 0.01).length / a.length).toFixed(2), brule: +(a.filter((v) => v > RENDER.hiCap * 0.5).length / a.length).toFixed(3) }; };
        return { image: stat(all), centre: stat(mid) };
      },
      // temps GPU moyen d'une image (boucle arrêtée, n rendus d'affilée)
      async bench(ph = 0.3, n = 30) {
        frozen = true;
        renderStep(ph); await renderer.backend.device?.queue.onSubmittedWorkDone();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) renderStep(ph);
        await renderer.backend.device?.queue.onSubmittedWorkDone();
        return +((performance.now() - t0) / n).toFixed(2);
      },
      // signature de la boucle : la pose de la caméra et des pièces à u et à u + 1
      // doit être identique (raccord parfait)
      seam(u = 0) {
        const sig = () => { const v = [...camera.matrixWorld.elements]; v.push(...stage.moss.meshes.length ? [] : []); return v; };
        renderStep(u); const a = sig();
        renderStep(u + 1 - 1e-9); const b = sig();
        return Math.max(...a.map((x, i) => Math.abs(x - b[i])));
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
    else if (e.key === 'ArrowRight') phi += 0.005;
    else if (e.key === 'ArrowLeft') phi -= 0.005;
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
      $('#loadbar u').style.width = `${(stage.progress() * 90).toFixed(1)}%`;
      if (loading.applied && stage.ready()) {
        if (!loading.settle) {
          loading.settle = 1;
          warm().then(() => { loading.settle = 2; }, (e) => fail(`Le rendu n'a pas pu être préparé (${e.message}).`));
        } else if (loading.settle >= 2 && ++loading.settle > 8) {
          loading.active = false;
          $('#loadbar u').style.width = '100%';
          $('#loader').classList.add('gone');
          document.body.classList.remove('loading');
          if (touch && !hinted) { hinted = true; toast('touche : pause · deux touches : nouvelle scène · appui long : masquer', 4500); }
        }
      }
      if (!loading.applied || !stage.ready() || loading.settle < 2) return;
    }
    renderAt(phi);
    fpsAcc += dt; fpsN++;
    if ((fpsT += dt) > 0.5) { ui?.setFps(`${(fpsN / fpsAcc).toFixed(0)}${RENDER.dynRes ? `  ·  ${Math.round(governor.scale * 100)} %` : ''}  ·  ${gen.busy() ? 'génération…' : 'prêt'}`); fpsAcc = fpsN = fpsT = 0; }
  }
  renderer.setAnimationLoop(tick);
  if (window[NAME]) {
    // fait tourner la boucle à la main jusqu'à la fin du chargement (ou pendant
    // `seconds` de film) : à utiliser quand le panneau est masqué
    window[NAME].run = async (seconds = 0) => {
      frozen = false; // (une image fixe gèle la boucle : le chargement suivant ne finirait jamais)
      const t0 = performance.now();
      while (loading.active || performance.now() - t0 < seconds * 1000) {
        renderer._nodes?.nodeFrame?.update();
        tick(performance.now());
        await new Promise((r) => setTimeout(r, 16));
      }
    };
    Object.defineProperty(window[NAME], 'loading', { get: () => ({ ...loading }) });
  }
}

main().catch((e) => { console.error(e); fail(e.message); });
