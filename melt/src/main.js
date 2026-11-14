// Point d'entrée : moteur, scène, génération, interface, boucle de rendu.
//
// Paramètres d'URL : ?seed=… (la scène), #r=… (une scène retouchée, partagée
// par « Copier le lien »), ?ui=0 (sans panneau), ?mobile=1 / ?mobile=0
// (version allégée imposée / interdite), ?debug (outils dans window.melt),
// ?syncpipes (compilation synchrone des shaders, pour comparer).
//
// Invariant central : renderAt(u) ne dépend que de la recette R et de la
// phase u. La lecture, l'export image par image, le rendu accumulé et les
// outils de mise au point passent tous par lui.
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generate, upgrade, MOODS } from './recipe.js';
import { createGenerator } from '../../shared/gen/client.js';
import { createStage, cameraAt } from './scene/stage.js';
import { G } from '../../shared/scene/globals.js';
import { setLite } from '../../shared/scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { createAccumulator, jitter } from '../../shared/render/accum.js';
import { createUI } from './app/ui.js';
import { loadRender, saveRender, applyQuality, defaultsFor } from './app/settings.js';
import { wantsMobile, switchMobile, createGovernor, createPacer, bindTouch } from '../../shared/app/mobile.js';
import { exportLoop, exportPNG } from '../../shared/app/capture.js';
import { loader } from '../../shared/app/loader.js';
import { asyncPipelines, warmScene } from '../../shared/app/warmup.js';
import { createDebugTools, packRecipe, unpackRecipe, sleep } from '../../shared/app/debug.js';

const NAME = 'melt';
const DEFAULT_SEED = 'b92'; // scène d'ouverture (sans ?seed=) : forge, gros plan, oxyde or et magenta
const params = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const randomSeed = () => Math.random().toString(36).slice(2, 8);

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
  const canvas = renderer.domElement;
  $('#app').appendChild(canvas);

  // Chargement sans gel : pipelines asynchrones pendant le chargement, et
  // préparation découpée en petits lots (app/warmup.js).
  const pipes = asyncPipelines(renderer);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.5, 400); // (en cm)
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  const camState = { free: false };

  // ── Modules ──
  const gen = createGenerator(LITE ? Math.max(2, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)) : undefined);
  const stage = createStage(scene, gen, { lite: LITE, renderer });
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
  R ??= generate(params.get('seed') || DEFAULT_SEED);
  function syncEnv() {}

  // ── Écran de chargement ──
  // Une scène ne s'affiche que lorsque toute sa géométrie est arrivée, que ses
  // shaders sont compilés et que quelques images ont été rendues (historique
  // de l'anticrénelage temporel). On ne voit jamais une forme se transformer.
  const loading = { active: true, applied: false, warming: false, settle: 0 };
  // étapes de l'écran de chargement (libellés propres au thème) ; le dessin
  // (app/loaderArt.js) reçoit ce que la recette en dit, par loader.art()
  const STEPS = [['build', 'le bain se prépare'], ['compile', 'la lumière se prépare'], ['settle', 'premières images']];
  let firstRecipe = true;
  function applyRecipe() {
    const recipe = R;
    loading.active = true; loading.applied = false; loading.warming = false; loading.settle = 0;
    loader.show({ steps: STEPS });
    loader.art({ seed: R.seed, oxRate: R.oxRate, habit: R.habit });
    // (le fondu d'entrée de l'écran se termine avant que la scène ne change)
    // (sleep et non setTimeout : une page masquée ralentit les minuteries)
    sleep(firstRecipe ? 0 : 280).then(() => {
      if (R !== recipe) return;
      stage.setRecipe(R);
      syncEnv();
      loading.applied = true;
    });
    firstRecipe = false;
    ui?.rebuild();
    const url = new URL(location.href);
    url.searchParams.set('seed', R.seed);
    url.hash = '';
    history.replaceState(null, '', url);
    document.title = `Melt · ${R.seed}`;
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
        renderer, scene, pipes, render: renderStep, phases: [0, 0.25, 0.5, 0.75],
        onProgress: (f) => loader.progress(f), alive: () => R === recipe,
      });
    } finally {
      loading.warming = false;
      if (R === recipe) loader.step('settle');
    }
  }

  // ── Rendu d'une phase ──
  // u : phase « déroulée » (partie entière = nombre de boucles accomplies) ;
  // sub : décalages d'un rendu accumulé (lentille, pixel), facultatif
  function renderAt(u, sub = null) {
    const ph = u - Math.floor(u);
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = cameraAt(R, ph);
    if (camState.free) controls.update();
    else {
      // caméra périodique en ph (même pose à 0 et à 1) : un balancement lent
      camera.position.set(...C.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(...C.tgt);
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    stage.update(ph, camera, [canvas.width, canvas.height], sub ? sub.pixel : [0, 0]);
    post.update({ ...RENDER, lite: LITE }, R);
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
    // (humeur, colonne, glace, section : nouvelle recette de la même graine, les autres choix gardés)
    overrideChanged: (k, v) => { R = generate(R.seed, { mood: R.mood, habit: R.habit, oxide: R.oxide, cluster: R.cluster, framing: R.framing, [k]: v }); applyRecipe(); },
    resimulate: () => applyRecipe(),
    copyLink: async () => {
      const url = new URL(location.href);
      url.hash = `r=${await packRecipe(R)}`;
      await navigator.clipboard.writeText(url.href).then(() => toast('Lien copié (scène et retouches)'), () => toast(url.href, 8000));
    },
    togglePause: () => { paused = !paused; toast(paused ? 'Pause' : 'Lecture', 900); },
    recipeChanged: () => {},
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
      if (v) controls.target.set(...cameraAt(R, phi).tgt);
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

  retry = { random: () => on.random(), again: () => applyRecipe() };
  applyRender();
  applyRecipe();

  if (params.has('debug')) {
    window[NAME] = {
      renderer, scene, camera, controls, stage, post, gen, RENDER, G, pipes, errors, on, renderAt: renderStep, renderAccum,
      get R() { return R; },
      seek: (p) => { phi = p; paused = true; },
      play: () => { paused = false; frozen = false; },
      freeze: (v = true) => { frozen = v; },
      // image fixe, envoi au collecteur, planches, posemètre, temps d'image,
      // raccord, boucle à la main quand le panneau est masqué : shot(ph),
      // send(nom), sheet(graines, phases), film(u0, u1, n), meter(), meters(),
      // poster(), bench(ph), seam(u), size(w, h), run(s) — shared/app/debug.js
      ...createDebugTools({
        renderer, canvas, camera, post, renderStep,
        tick: (now) => tick(now),
        isLoading: () => loading.active,
        freeze: (v) => { frozen = v; },
        resize: () => resize(),
        load: (seed, forced) => { R = generate(seed, forced); applyRecipe(); },
        poses: () => [stage.group],
        hiCap: () => RENDER.hiCap,
        ...(params.get('sink') ? { sink: `http://127.0.0.1:${params.get('sink')}/` } : {}),
      }),
    };
    Object.defineProperty(window[NAME], 'loading', { get: () => ({ ...loading }) });
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
      if (!loading.settle) loader.progress(stage.progress());
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
}

main().catch((e) => { console.error(e); fail(e.message); });
