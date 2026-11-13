// Point d'entrée : moteur, scène, génération, interface, boucle de rendu.
//
// Paramètres d'URL : ?seed=… (la scène), #r=… (une scène retouchée, partagée
// par « Copier le lien »), ?ui=0 (sans panneau), ?mobile=1 / ?mobile=0
// (version allégée imposée / interdite), ?debug (outils dans window.bolt),
// ?syncpipes (compilation synchrone des shaders, pour comparer).
//
// Invariant central : renderAt(u) ne dépend que de la recette R et de la
// phase u. La lecture, l'export image par image, le rendu accumulé et les
// outils de mise au point passent tous par lui.
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generate, upgrade, MOODS } from './recipe.js';
import { createGenerator } from '../../shared/gen/client.js';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from '../../shared/scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from '../../shared/scene/materials.js';
import { createPost } from './render/post.js'; // (variante locale : le nuage absorbe)
import { cameraAt, stateAt } from './film.js';
import { createAccumulator, jitter } from '../../shared/render/accum.js';
import { createUI } from './app/ui.js';
import { loadRender, saveRender, applyQuality, defaultsFor } from './app/settings.js';
import { wantsMobile, switchMobile, createGovernor, createPacer, bindTouch } from '../../shared/app/mobile.js';
import { exportLoop, exportPNG } from '../../shared/app/capture.js';
import { loader } from '../../shared/app/loader.js';
import { asyncPipelines, warmScene } from '../../shared/app/warmup.js';
import { createDebugTools, packRecipe, unpackRecipe, sleep } from '../../shared/app/debug.js';

const NAME = 'bolt';
const DEFAULT_SEED = 'f9'; // scène d'ouverture (sans ?seed=) : à choisir parmi les plus belles
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
  const stage = createStage(scene, gen, { lite: LITE });
  const post = createPost(renderer, scene, camera, { haze: stage.cloud.haze, aoSamples: 8 });
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
  const STEPS = [['build', 'le traceur cherche sa pointe'], ['compile', 'le nuage se charge'], ['settle', 'premières images']];
  let firstRecipe = true;
  function applyRecipe() {
    const recipe = R;
    loading.active = true; loading.applied = false; loading.warming = false; loading.settle = 0;
    loader.show({ steps: STEPS });
    loader.art({ seed: R.seed, family: R.bolt.family, eta: R.bolt.eta, bw: R.mood === 'plaque' });
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
    document.title = `Bolt · ${R.seed}`;
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
        renderer, scene, pipes, render: renderStep, phases: [0.12, 0.3, 0.45, 0.502, 0.53, 0.6, 0.76],
        onProgress: (f) => loader.progress(f), alive: () => R === recipe,
      });
    } finally {
      loading.warming = false;
      if (R === recipe) loader.step('settle');
    }
  }

  // ── Rendu d'une phase ──
  const TAU = Math.PI * 2;
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _flash = new THREE.Color();
  // u : phase « déroulée » (partie entière = nombre de boucles accomplies) ;
  // sub : décalages d'un rendu accumulé (lentille, pixel), facultatif
  function renderAt(u, sub = null) {
    const ph = u - Math.floor(u);
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera, Lay = stage.layout;
    // (le plan de l'humeur, réglé sur ce récipient et son nuage)
    const pose = cameraAt({ ...C, target: Lay?.target ?? C.target, dist: C.dist * (Lay ? Lay.frame / 2.5 : 1) * Math.max(1, 1.45 / camera.aspect) }, ph);
    if (camState.free) controls.update();
    else {
      camera.position.set(...pose.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(...pose.target);
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    // la secousse du coup de foudre : un à-coup du pied de la caméra à chaque arc, amorti en un quart de seconde
    const F0 = stateAt(R.film, ph);
    if (!camState.free && F0.tau > 0) {
      let k = 0;
      for (const s of R.film.strokes) { const x = F0.tau - s.t; if (x > 0) k += s.amp * Math.exp(-x / 0.16) * Math.sin(x * 2 * Math.PI * 11); }
      camera.position.y += k * 0.0035 * C.dist;
    }
    camera.clearViewOffset();
    if (sub) {
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(_r.set(...pose.target));
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    const camDist = camera.position.distanceTo(_r.set(...pose.target));
    // (le mur aussi reçoit l'éclair : c'est la couleur de fond, que les lampes n'atteignent pas)
    scene.background.set(R.fog.color).lerp(_flash.set(R.bolt.color), Math.min(0.6, F0.light * (0.08 + 0.4 * R.fog.wall)));
    scene.fog.color.copy(scene.background);
    scene.fog.near = camDist + 0.8; scene.fog.far = camDist + 6.2; // (la table se fond dans le mur : pas d'horizon)
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    R.film.duration = R.loop.duration;
    stage.update(ph, camera, canvas.height);
    post.update({ ...RENDER, exposure: RENDER.exposure * F0.expo, lite: LITE, focus: RENDER.focus * camDist, focusRange: RENDER.focusRange * camDist }, R);
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
    copyLink: async () => {
      const url = new URL(location.href);
      url.hash = `r=${await packRecipe(R)}`;
      await navigator.clipboard.writeText(url.href).then(() => toast('Lien copié (scène et retouches)'), () => toast(url.href, 8000));
    },
    togglePause: () => { paused = !paused; toast(paused ? 'Pause' : 'Lecture', 900); },
    recipeChanged: () => {},
    finishChanged: () => stage.syncFinishes(),
    rebuild: () => applyRecipe(), // (une retouche qui change la géométrie ou l'éclair : même recette, recalculée)
    variantChanged: (o) => { R = generate(R.seed, { mood: R.mood, ...o }); applyRecipe(); },
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
      if (v) controls.target.set(...(stage.layout?.target ?? [0, 1, 0]));
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
        ...(params.get('sink') ? { sink: `http://127.0.0.1:${params.get('sink')}/` } : {}), // (collecteur sur un autre port)
      }),
    };
    // planche à taille imposée, en tâche détachée (panneau masqué : les appels
    // expirent à 45 s) : go(['a1:plaque:bol', …], [0.3, 0.6], 'p') puis lire window.__job
    window[NAME].go = (seeds, phases, prefix = 'p', w = 960, h = 600) => {
      const T = window[NAME], shot = T.shot;
      window.__job = 'run';
      (async () => {
        try {
          T.shot = async (ph) => { await T.run(); T.size(w, h); return shot(ph, 6); };
          await T.sheet(seeds, phases, prefix);
          window.__job = `done ${errors.slice(0, 3).join(' | ')}`;
        } catch (e) { window.__job = `err ${e.message} ${e.stack}`; } finally { T.shot = shot; }
      })();
    };
    // gros plans de mise au point : load(graine, { mood, family, variant }, retouche) puis look(position, cible) ; look() rend la caméra au film
    window[NAME].load = (seed, o = {}, patch = null) => { R = generate(seed, o); patch?.(R); applyRecipe(); };
    window[NAME].look = (pos, target) => {
      camState.free = !!pos;
      if (pos) { controls.enableDamping = false; camera.position.set(...pos); controls.target.set(...target); controls.update(); }
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
      if (stage.failed()) { loading.active = false; return fail('La scène n’a pas pu être calculée.'); }
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
