// Point d'entrée : moteur, scène, génération, interface, boucle de rendu.
//
// Paramètres d'URL : ?seed=… (la scène), #r=… (une scène retouchée, partagée
// par « Copier le lien »), ?ui=0 (sans panneau), ?mobile=1 / ?mobile=0
// (version allégée imposée / interdite), ?debug (outils dans window.tension),
// ?syncpipes (compilation synchrone des shaders, pour comparer).
//
// Invariant central : renderAt(u) ne dépend que de la recette R et de la
// phase u. La lecture, l'export image par image, le rendu accumulé et les
// outils de mise au point passent tous par lui.
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generate, upgrade, MOODS, FAMILIES } from './recipe.js';
import { createGenerator } from '../../shared/gen/client.js';
import { createStage, partSpecs } from './scene/stage.js';
import { makeFilm } from './gen/film.js';
import { makeShot, cameraAt } from './scene/shot.js';
import { makeEnvironment } from '../../shared/scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from '../../shared/scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { createAccumulator, jitter } from '../../shared/render/accum.js';
import { createUI } from './app/ui.js';
import { loadRender, saveRender, applyQuality, defaultsFor } from './app/settings.js';
import { wantsMobile, switchMobile, createGovernor, createPacer, bindTouch } from '../../shared/app/mobile.js';
import { exportLoop, exportPNG } from '../../shared/app/capture.js';
import { loader } from '../../shared/app/loader.js';
import { asyncPipelines, warmScene } from '../../shared/app/warmup.js';

const NAME = 'tension';
const DEFAULT_SEED = 't5'; // scène d'ouverture : Midi, la Chenille aux barres vermillon sur le sol clair (choisie sur une planche des sept humeurs : la structure remplit le cadre, là où le Culbute de la Scène se perdait dans le noir)
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

  // Chargement sans gel : pipelines asynchrones pendant le chargement, et
  // préparation découpée en petits lots (app/warmup.js).
  const pipes = asyncPipelines(renderer);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 80);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  const camState = { free: false };

  // ── Modules ──
  const gen = createGenerator(LITE ? Math.max(2, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)) : undefined);
  setNoiseVolume(await gen.request({ seed: `${NAME}-noise` }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, { lite: LITE });
  let film = null, shot = null, built = 0;
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
  R ??= generate(params.get('seed') || DEFAULT_SEED, { ...(params.get('mood') ? { mood: params.get('mood') } : {}), ...(params.get('family') ? { family: params.get('family') } : {}) });
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
  // étapes de l'écran de chargement (libellés propres au thème) ; le dessin
  // (app/loaderArt.js) reçoit ce que la recette en dit, par loader.art()
  const STEPS = [['form', 'la forme se tend'], ['gait', "l'allure se cherche"], ['cycle', 'le pas se referme'], ['parts', 'les pièces se tournent'], ['compile', 'la lumière se prépare'], ['settle', 'premières images']];
  let firstRecipe = true, simProgress = 0, version = 0;
  function applyRecipe() {
    const recipe = R, v = ++version;
    loading.active = true; loading.applied = false; loading.warming = false; loading.settle = 0;
    simProgress = 0;
    loader.show({ steps: STEPS });
    loader.step('form');
    loader.art({ seed: R.seed, family: R.family, sim: R.sim });
    if (params.has('artshot')) loader.art({ debugSend: `http://127.0.0.1:8137/art-${R.seed}.jpg` });
    // 1. la simulation (worker) : forme, allure, cycle limite, enregistrement
    gen.request(R.sim, 'sim', (p, label) => {
      if (v !== version) return;
      simProgress = p;
      if (label === 'gait' || label === 'cycle' || label === 'record') loader.step(label === 'record' ? 'cycle' : label);
      loader.progress(Math.min(1, p));
    }).then(async (o) => {
      if (v !== version) return;
      const P = unpackSim(o);
      const F = makeFilm(P);
      F.T = P.T;
      loader.art({ chrono: chronoOf(F, P.T) });
      // 2. les pièces tournées
      loader.step('parts');
      const spec = partSpecs(P.T);
      const parts = { struts: {} };
      const jobs = Object.entries(spec.struts).map(([k, sp]) => gen.request(sp, 'strut').then((g) => { parts.struts[k] = g; }));
      if (spec.ball) jobs.push(gen.request(spec.ball, 'ball').then((g) => { parts.ball = g; }));
      if (spec.winch) jobs.push(gen.request(spec.winch, 'winch').then((g) => { parts.winch = g; }));
      if (spec.hub) jobs.push(gen.request(spec.hub, 'hub').then((g) => { parts.hub = g; }));
      jobs.push(gen.request(spec.cable, 'cable').then((g) => { parts.cable = g; }));
      await Promise.all(jobs);
      if (v !== version) return;
      film = F;
      shot = makeShot(F);
      R.loop.duration = +F.dur.toFixed(2);
      stage.setScene(R, F, parts);
      syncEnv();
      loading.applied = true;
      ui?.rebuild();
    }).catch((e) => { console.error(e); if (v === version) fail(`La simulation a échoué (${e.message.split('\n')[0]}).`); });
    firstRecipe = false;
    ui?.rebuild();
    const url = new URL(location.href);
    url.searchParams.set('seed', R.seed);
    url.hash = '';
    history.replaceState(null, '', url);
    document.title = `Tension · ${R.seed}`;
  }
  // le résultat du worker (tableaux à plat) → la forme attendue par makeFilm
  function unpackSim(o) {
    const frames = [], rests = [];
    for (let k = 0; k < o.nf; k++) { frames.push(o.frames.subarray(k * o.N * 3, (k + 1) * o.N * 3)); rests.push(o.rests.subarray(k * o.NC, (k + 1) * o.NC)); }
    return { ...o, frames, rests };
  }
  // chronophotographie pour l'écran de chargement : quelques poses projetées de profil
  function chronoOf(F, T) {
    const K = 24, poses = [], P = new Float32Array(F.N * 3);
    for (let k = 0; k < K; k++) { F.pose(k / K, P); const q = []; for (let i = 0; i < F.N; i++) q.push(+P[i * 3].toFixed(3), +P[i * 3 + 1].toFixed(3)); poses.push(q); }
    return { poses, bars: T.bars.map((b) => [b.i, b.j]), cables: T.cables.map((c) => [c.i, c.j]), dist: F.dist };
  }

  // Préparation : tout ce que la boucle dessinera, aux moments qui comptent
  // (ceux qui montrent des objets ou des états qu'on ne voit pas au début),
  // compilé sous l'écran de chargement, sans gel (app/warmup.js).
  async function warm() {
    loading.warming = true;
    loader.step('compile');
    const recipe = R;
    try {
      return await warmScene({
        renderer, scene, pipes, render: renderStep, phases: [0, 0.2, 0.4, 0.6, 0.8],
        onProgress: (f) => loader.progress(f), alive: () => R === recipe,
      });
    } finally {
      loading.warming = false;
      if (R === recipe) loader.step('settle');
    }
  }

  // ── Rendu d'une phase ──
  const TAU = Math.PI * 2;
  // un saut dans la boucle (fin de boucle, ← →, image fixe) ne compte pas comme un mouvement
  let lastU = null;
  const jumped = (u) => { const j = lastU === null || Math.abs(u - lastU) > 0.02 || Math.floor(u) !== Math.floor(lastU); lastU = u; return j; };
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
  // u : phase « déroulée » (partie entière = nombre de boucles accomplies) ;
  // sub : décalages d'un rendu accumulé (lentille, pixel), facultatif
  function renderAt(u, sub = null) {
    const ph = u - Math.floor(u);
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    // travelling latéral : le repère de la marche, plus l'écart lissé du centre (scene/shot.js)
    const cam = cameraAt(shot, film, C, u, camera.aspect);
    const { tgt, tw, ext } = cam;
    if (camState.free) controls.update();
    else {
      camera.position.set(...cam.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(tgt[0], tgt[1], tgt[2]);
    }
    // lumières : dans le repère de la marche, autour du centre suivi
    {
      const L = R.light, K = L.key;
      const kd = tw(Math.cos(K.az) * Math.cos(K.el), Math.sin(K.el), Math.sin(K.az) * Math.cos(K.el));
      stage.key.position.set(tgt[0] + kd[0] * K.dist, tgt[1] + kd[1] * K.dist, tgt[2] + kd[2] * K.dist);
      stage.key.target.position.set(tgt[0], 0, tgt[2]);
      stage.key.color.set(K.color); stage.key.intensity = 7 * K.scale * K.dist * K.dist; stage.key.angle = K.angle; stage.key.penumbra = K.penumbra;
      const span = Math.max(ext[0], ext[1], ext[2]) * 0.75 + 1;
      stage.key.shadow.focus = Math.min(1, Math.max(0.05, Math.atan(span / K.dist) / K.angle));
      stage.key.shadow.camera.near = Math.max(0.5, K.dist - 9); stage.key.shadow.camera.far = K.dist + 9;
      stage.rims.forEach((l, i) => {
        const r = L.rim[i], d = tw(Math.cos(r.az) * Math.cos(r.el), Math.sin(r.el), Math.sin(r.az) * Math.cos(r.el));
        l.position.set(tgt[0] + d[0] * 9, tgt[1] + d[1] * 9, tgt[2] + d[2] * 9);
        l.target.position.set(tgt[0], tgt[1], tgt[2]);
        l.color.set(r.color); l.intensity = 7 * r.scale * 81 * (LITE && i === 0 ? 1.4 : 1);
      });
      stage.floor.position.set(tgt[0], 0, tgt[2]);
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub) {
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(_r.set(tgt[0], tgt[1], tgt[2]));
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    // (brume comptée depuis le sujet : elle ne noie jamais la structure, quel que soit le recul)
    { const dS = Math.hypot(camera.position.x - tgt[0], camera.position.y - tgt[1], camera.position.z - tgt[2]); scene.fog.near = dS + R.fog.near; scene.fog.far = dS + R.fog.far; }
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    stage.update(u, jumped(u));
    stage.CU.pxScale.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, canvas.height);
    const fd = Math.hypot(camera.position.x - tgt[0], camera.position.y - tgt[1], camera.position.z - tgt[2]);
    post.update({ ...RENDER, lite: LITE, focus: RENDER.focus * fd, focusRange: RENDER.focusRange * fd }, R);
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
    moodChanged: (mood) => { R = generate(R.seed, { mood, family: R.family }); applyRecipe(); },
    familyChanged: (family) => { R = generate(R.seed, { mood: R.mood, family }); applyRecipe(); },
    copyLink: async () => {
      const url = new URL(location.href);
      url.hash = `r=${await packRecipe(R)}`;
      await navigator.clipboard.writeText(url.href).then(() => toast('Lien copié (scène et retouches)'), () => toast(url.href, 8000));
    },
    togglePause: () => { paused = !paused; toast(paused ? 'Pause' : 'Lecture', 900); },
    recipeChanged: () => {},
    finishChanged: () => stage.syncFinishes(),
    simChanged: () => applyRecipe(),
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
      if (v) { const F = shot.frame(phi); controls.target.set(F.x, F.y, F.z); }
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
  const ui = params.get('ui') === '0' ? null : createUI({ recipe: () => R, render: RENDER, on, moods: MOODS, families: FAMILIES });
  // Écran tactile : panneau replié ; une touche = pause, deux touches = nouvelle
  // scène, appui long = masquer l'interface
  const touch = LITE || !!matchMedia?.('(pointer: coarse)').matches;
  let hinted = false;
  if (touch) {
    ui?.gui.close();
    bindTouch(canvas, { onTap: () => on.togglePause(), onDoubleTap: () => on.random(), onLongPress: () => document.body.classList.toggle('clean') });
  }

  retry = { random: () => on.random(), again: () => applyRecipe() };
  applyRender();
  applyRecipe();

  if (params.has('debug')) {
    window[NAME] = {
      renderer, scene, camera, controls, stage, post, gen, RENDER, G, pipes, errors, on, renderAt: renderStep, renderAccum,
      get film() { return film; }, get shot() { return shot; },
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
      async send(name, scale = 0.5, url = 'http://127.0.0.1:8137/') {
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
      // image à une taille donnée (capture de la documentation, vignettes de l'accueil)
      async still(name, ph, w = 1600, h = 900, scale = 1) {
        await this.run();
        frozen = true;
        document.body.classList.add('clean');
        busy = true;
        renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
        for (let i = 0; i < 14; i++) { renderStep(ph); await renderer.backend.device?.queue.onSubmittedWorkDone(); }
        const n = await this.send(name, scale);
        busy = false; canvas.style.width = ''; canvas.style.height = ''; resize();
        return n;
      },
      // planche : les graines × les phases, chaque image envoyée au collecteur
      // (une graine peut s'écrire « graine:humeur:famille » : l'humeur et la
      // famille sont alors imposées — pour comparer toutes les humeurs d'un coup)
      async sheet(seeds, phases = [0, 0.2, 0.4, 0.6, 0.8], prefix = 'sheet') {
        for (const s of seeds) {
          const [sd, mood, family] = String(s).split(':');
          R = generate(sd, { ...(mood ? { mood } : {}), ...(family ? { family } : {}) }); applyRecipe();
          await new Promise((r) => setTimeout(r, 400));
          for (const ph of phases) { await this.shot(ph); await this.send(`${prefix}-${s}-${String(Math.round(ph * 100)).padStart(3, '0')}.jpg`); }
        }
      },
      // posemètre de plusieurs scènes : { graine: [[médiane du centre, médiane de l'image, brûlé] par phase] }
      async meters(seeds, phases = [0.3, 0.6]) {
        const out = {};
        for (const s of seeds) {
          const [sd, mood, family] = String(s).split(':');
          R = generate(sd, { ...(mood ? { mood } : {}), ...(family ? { family } : {}) }); applyRecipe();
          await new Promise((r) => setTimeout(r, 400));
          out[s] = [];
          for (const ph of phases) { await this.shot(ph); const m = await this.meter(); out[s].push([m.centre.p50, m.image.p50, m.image.brule]); }
        }
        return out;
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
      // raccord : l'image à u et à u + 1 est la même — la scène s'est déplacée du
      // pas, la caméra aussi ; on compare donc les nœuds dans le repère de la
      // caméra, comme des ensembles (le Culbute finit ré-étiqueté par une symétrie)
      seam(u = 0) {
        const sig = () => {
          camera.updateMatrixWorld();
          const P = stage.nodes(), out = [], v = new THREE.Vector3();
          for (let i = 0; i < film.N; i++) { v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(camera.matrixWorldInverse); out.push(v.toArray()); }
          return out;
        };
        renderStep(u); const a = sig();
        renderStep(u + 1 - 1e-9); const b = sig();
        return Math.max(...a.map((p) => Math.min(...b.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])))));
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
      if (!loading.settle) {}
      else if (loading.settle >= 2) loader.progress((loading.settle - 2) / 7);
      if (loading.applied && stage.ready()) {
        if (!loading.settle) {
          loading.settle = 1;
          warm().then((ok) => { if (ok) loading.settle = 2; }, (e) => fail(`Le rendu n'a pas pu être préparé (${e.message}).`));
        } else if (loading.settle >= 2 && ++loading.settle > 8) {
          loading.active = false;
          loader.hide();
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
