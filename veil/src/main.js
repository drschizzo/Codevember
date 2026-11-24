// Point d'entrée : moteur, scène, génération, interface, boucle de rendu.
//
// Paramètres d'URL : ?seed=… (la scène), #r=… (une scène retouchée, partagée
// par « Copier le lien »), ?ui=0 (sans panneau), ?mobile=1 / ?mobile=0
// (version allégée imposée / interdite), ?debug (outils dans window.veil),
// ?syncpipes (compilation synchrone des shaders, pour comparer).
//
// Invariant central : renderAt(u) ne dépend que de la recette R et de la
// phase u. La lecture, l'export image par image, le rendu accumulé et les
// outils de mise au point passent tous par lui.
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generate, upgrade, MOODS, lum } from './recipe.js';
import { descDuration, riseDuration } from './timeline.js';
import { createGenerator } from '../../shared/gen/client.js';
import { createCore } from './core.js';
import { FINE } from './scene/stage.js';
import { G } from '../../shared/scene/globals.js';
import { setLite } from '../../shared/scene/materials.js';
import { createAccumulator, jitter } from '../../shared/render/accum.js';
import { createUI } from './app/ui.js';
import { installChrome } from '../../shared/app/chrome.js';
import { loadRender, saveRender, applyQuality, defaultsFor } from './app/settings.js';
import { wantsMobile, switchMobile, createGovernor, createPacer, bindTouch } from '../../shared/app/mobile.js';
import { exportLoop, exportPNG } from '../../shared/app/capture.js';
import { loader } from '../../shared/app/loader.js';
import { asyncPipelines, warmScene } from '../../shared/app/warmup.js';
import { createDebugTools, packRecipe, unpackRecipe, sleep } from '../../shared/app/debug.js';

const NAME = 'veil';
const DEFAULT_SEED = 'k4'; // scène d'ouverture (sans ?seed=) : à choisir parmi les plus belles
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

  // ── Modules ──
  // (la scène, sa recette et le rendu d'une phase : core.js, partagé avec le
  // relais de la méga-scène — day.js)
  const gen = createGenerator(LITE ? Math.max(2, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)) : undefined);
  const RENDER = loadRender(LITE);
  if (params.has('handheld')) RENDER.handheld = +params.get('handheld') || 0; // (?handheld=0 : la caméra calculée seule, pour comparer)
  const core = await createCore({ renderer, width: innerWidth, height: innerHeight, gen, lite: LITE, RENDER });
  const { scene, camera, stage, post } = core;
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  const camState = { free: false };
  const accum = createAccumulator(renderer);
  const governor = createGovernor({ target: 1 / 45, min: 0.5, max: 1, onChange: () => !busy && resize() });
  const pace = createPacer(() => RENDER.maxFps);

  // ── Recette ──
  let R = null;
  if (location.hash.startsWith('#r=')) {
    try { R = upgrade(await unpackRecipe(location.hash.slice(3))); } catch { R = null; }
  }
  R ??= generate(params.get('seed') || DEFAULT_SEED);
  const syncEnv = () => core.syncEnv();

  // ── Écran de chargement ──
  // Une scène ne s'affiche que lorsque toute sa géométrie est arrivée, que ses
  // shaders sont compilés et que quelques images ont été rendues (historique
  // de l'anticrénelage temporel). On ne voit jamais une forme se transformer.
  const loading = { active: true, applied: false, warming: false, settle: 0 };
  // étapes de l'écran de chargement (libellés propres au thème) ; le dessin
  // (app/loaderArt.js) reçoit ce que la recette en dit, par loader.art()
  const STEPS = [['build', 'le voile tombe sur les statues'], ['compile', 'la lumière se prépare'], ['settle', 'premières images']];
  let firstRecipe = true;
  function applyRecipe() {
    const recipe = R;
    loading.active = true; loading.applied = false; loading.warming = false; loading.settle = 0;
    loader.show({ steps: STEPS });
    // (le dessin : les formes de la graine, le voile ; un voile sombre se dessine clair sur l'écran noir)
    loader.art({ seed: R.seed, forms: R.forms, L: R.veil.L, color: lum(R.veil.color) > 0.3 ? R.veil.color : '#e9e3d8', color2: R.veil.lace.color2 !== R.veil.color ? R.veil.lace.color2 : null, motif: 'semis', mScale: R.veil.lace.scale, plinth: R.plinth });
    // (le fondu d'entrée de l'écran se termine avant que la scène ne change)
    // (sleep et non setTimeout : une page masquée ralentit les minuteries)
    sleep(firstRecipe ? 0 : 280).then(() => {
      if (R !== recipe) return;
      core.setRecipe(R);
      // Le film de la nouvelle scène repart de la pose (u = 0), seul moment
      // prêt à la fin du chargement. La phase gardait celle de l'ancienne
      // scène : tombée au milieu d'un morceau pas encore calculé, elle y
      // restait figée, le voile invisible, jusqu'à ce que le calcul l'ait
      // rejointe — et l'on ne voyait que la fin du geste, d'un coup. Les
      // morceaux déjà derrière elle étaient en plus calculés sans hâte (leur
      // échéance était un tour de boucle plus loin).
      phi = 0;
      loading.applied = true;
    });
    firstRecipe = false;
    ui?.rebuild();
    const url = new URL(location.href);
    url.searchParams.set('seed', R.seed);
    url.hash = '';
    history.replaceState(null, '', url);
    document.title = `Veil · ${R.seed}`;
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
        renderer, scene, pipes, render: renderStep, phases: core.warmPhases(),
        onProgress: (f) => loader.progress(f), alive: () => R === recipe,
      });
    } finally {
      loading.warming = false;
      if (R === recipe) loader.step('settle');
    }
  }

  // ── Rendu d'une phase ──
  // (core.js : la caméra du film, la lumière, la chaîne d'image ; ici, la
  // caméra libre et les décalages du rendu accumulé)
  function renderAt(u, sub = null) {
    if (camState.free) controls.update();
    core.renderAt(u, { sub, free: camState.free });
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
    core.applyRender();
    saveRender(RENDER);
  }

  // ── Interface ──
  let phi = 0, paused = false, busy = false, frozen = false;
  const on = {
    camState,
    random: () => { R = generate(randomSeed()); applyRecipe(); },
    regenerate: (seed) => { if (seed && seed !== R.seed) { R = generate(seed); applyRecipe(); } },
    moodChanged: (mood) => { R = generate(R.seed, { mood, lace: R.veil.lace.kind }); applyRecipe(); },
    resimulate: () => { R.loop.duration = Math.round(R.forms.length * (descDuration(R.timing.desc) + riseDuration(R.timing.rise)) * 100) / 100; applyRecipe(); },
    copyLink: async () => {
      const url = new URL(location.href);
      url.hash = `r=${await packRecipe(R)}`;
      await navigator.clipboard.writeText(url.href).then(() => toast('Lien copié (scène et retouches)'), () => toast(url.href, 8000));
    },
    togglePause: () => { paused = !paused; toast(paused ? 'Pause' : 'Lecture', 900); },
    recipeChanged: () => {},
    finishChanged: () => stage.syncLook(),
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
      if (v) controls.target.set(0, 0.35, 0);
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
      // (l'export attend que tout le film soit calculé)
      while (!stage.complete()) await sleep(200);
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
  installChrome(ui, params);
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
        isLoading: () => loading.active || !stage.complete(), // (les outils attendent le film entier)
        freeze: (v) => { frozen = v; },
        resize: () => resize(),
        load: (seed, forced) => { R = generate(seed, forced); applyRecipe(); },
        poses: () => [stage.veil?.group, stage.cord].filter(Boolean),
        hiCap: () => RENDER.hiCap,
      }),
    };
    // une scène imposée : look('b2', { mood: 'galerie', lace: 'guipure', color: 'noir' })
    window[NAME].look = (seed, o = {}) => { R = generate(seed, o); applyRecipe(); };
    // réglages de l'étage fin, en direct (scene/stage.js : FINE)
    window[NAME].FINE = FINE;
    // l'étage fin du GPU contre sa version JS (src/gen/fineRef.js), sur l'image affichée
    // l'enregistrement chargé, aux critères des tests CPU (test/cloth.test.mjs)
    window[NAME].clothCheck = async () => {
      const { makeCloth } = await import('./gen/cloth.js');
      const { plinthSDF } = await import('./gen/forms.js');
      const { deq } = await import('./gen/quant.js');
      const D = stage.data, n = stage.veil.n, cl = makeCloth(n, R.veil.L, R.fabric), N = n * n, P = plinthSDF(R.plinth);
      const out = { etirementP99: 0, etirementMax: 0, socleMin: 0, raccords: 0, temps: {} };
      const all = [];
      const X = new Float32Array(N * 3);
      const frame = (S, f) => { for (let i = 0; i < N * 3; i++) X[i] = deq(S.frames[f * N * 3 + i], i % 3); return X; };
      for (const [key, S] of D.segs) {
        for (let f = 0; f < S.count; f += 3) {
          frame(S, f);
          for (let c = 0; c < cl.nc; c++) { if (cl.kind[c]) continue; const a = cl.ca[c] * 3, b = cl.cb[c] * 3; all.push(Math.hypot(X[a] - X[b], X[a + 1] - X[b + 1], X[a + 2] - X[b + 2]) / cl.rest[c] - 1); }
          for (let k = 0; k < N; k++) out.socleMin = Math.min(out.socleMin, P(X[k * 3], X[k * 3 + 1], X[k * 3 + 2]));
        }
      }
      all.sort((a, b) => a - b);
      out.etirementP99 = all[Math.floor(all.length * 0.99)]; out.etirementMax = all[all.length - 1];
      // raccords : fin de la descente k = début de la montée k ; fin de la montée k = début de la descente k + 1
      const nF = R.forms.length;
      for (let k = 0; k < nF; k++) {
        const d = D.segs.get('desc:' + k), r = D.segs.get('rise:' + k), d2 = D.segs.get('desc:' + ((k + 1) % nF));
        for (let i = 0; i < N * 3; i++) {
          out.raccords = Math.max(out.raccords, Math.abs(d.frames[(d.count - 1) * N * 3 + i] - r.frames[i]) * 6.4e-5, Math.abs(r.frames[(r.count - 1) * N * 3 + i] - d2.frames[i]) * 6.4e-5);
        }
      }
      return out;
    };
    window[NAME].fineCheck = async () => {
      const { fineSolve } = await import('./gen/fineRef.js');
      const { buildForm, bakeForm } = await import('./gen/forms.js');
      const fine = stage.fine, lf = stage.lastFine;
      const X = await fine.read();
      const f = bakeForm(buildForm(R.forms[lf.k]));
      const ref = fineSolve(lf.coarse, stage.veil.n, fine.R, f, R.plinth, { ...FINE, L: R.veil.L, RC: 0.004, seed: 1, adh: FINE.adh * (R.wind.wet ?? 0) });
      let d = 0, s = 0;
      for (let k = 0; k < fine.m * fine.m; k++) { const e = Math.hypot(X[k * 4] - ref.X[k * 3], X[k * 4 + 1] - ref.X[k * 3 + 1], X[k * 4 + 2] - ref.X[k * 3 + 2]); d = Math.max(d, e); s += e; }
      return { max: d, moyenne: s / (fine.m * fine.m) };
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
    if (!paused && !loading.active) {
      // (les morceaux se calculent pendant que le film joue : s'il les
      // rattrape, il attend sur l'image en cours)
      const next = phi + dt / R.loop.duration;
      if (stage.has((next - Math.floor(next)) * stage.TL.total)) phi = next;
    }
    if (loading.active) {
      if (!loading.settle) loader.progress(stage.progress());
      if (stage.error()) { fail(`La simulation a échoué (${stage.error().message}).`); loading.applied = false; }
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
