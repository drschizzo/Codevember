// Point d'entrée : recette, recherche des orbites, mondes emboîtés, plongée,
// panneau, boucle de rendu.
//
// La plongée. Chaque astre est une boule de verre qui contient un autre monde
// (sa machine, son sol, son studio), réduit d'un facteur k. La recette décrit
// trois mondes différents (orbite, humeur, machine, matières) : les astres du
// premier contiennent le deuxième, ceux du deuxième le troisième, ceux du
// troisième le premier. Les trois sont emboîtés à la fois (le courant, celui
// de la boule visée, celui de sa boule) ; τ avance d'une couche par segment, et
// la boucle dure trois segments : on plonge dans trois boules, puis tout
// recommence. Les trois mondes sont entièrement construits et compilés pendant
// l'écran de chargement : rien ne se crée pendant la plongée.
// Dans un segment (u ∈ [0, 1)), on regarde d'abord la machine, puis la
// caméra entre dans une boule : c'est le monde qui subit une similitude
// A(s)⁻¹, A(s) = translation p·(1 − kˢ)/(1 − k) ∘ homothétie kˢ, de point
// fixe la boule visée (en p). À s = 1, la couche suivante occupe exactement
// la place de la précédente : on change de racine sans que rien ne bouge. Tout
// ne dépend que de τ : la boucle (M segments) est parfaite par construction.
//
// Paramètres d'URL : ?seed=… (la scène), #r=… (une scène retouchée, partagée
// par « Copier le lien »), ?ui=0 (sans panneau), ?mobile=1 / ?mobile=0 (version
// allégée imposée / interdite), ?debug (outils dans window.chor).
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPool } from './orbit/client.js';
import { createCore } from './core.js';
import { exportLoop, exportPNG } from './app/capture.js';
import { createLoader } from './app/loader.js';
import { createUI } from './app/ui.js';
import { installChrome } from '../../shared/app/chrome.js';
import { loadRender, saveRender, applyQuality, defaultsFor } from './app/settings.js';
import { wantsMobile, switchMobile, createGovernor, createPacer, bindTouch } from './app/mobile.js';
import { generate, generateLayer, upgrade, packRecipe, unpackRecipe, MOODS } from './recipe.js';
import { createRng } from '../../shared/rng.js';

const TAU = Math.PI * 2;
const params = new URLSearchParams(location.search);
const DEFAULT_SEED = 'bwkwvk';
const $ = (s) => document.querySelector(s);
const randomSeed = () => Math.random().toString(36).slice(2, 8);

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

async function main() {
  const loader = createLoader($('#loader'));
  loader.show();
  if (params.has('debug')) loader.probe();
  // ── Version mobile (fixée au chargement) ──
  const LITE = wantsMobile(params);
  if (LITE) document.body.classList.add('lite');
  const RENDER = loadRender(LITE);
  if (params.has('handheld')) RENDER.handheld = +params.get('handheld') || 0; // (?handheld=0 : la caméra calculée seule, pour comparer)
  const S = { worlds: [], k: [], target: [], tau: 0, paused: false, busy: true, run: 0, exporting: false, loading: false, landing: false, handoff: false, root: -1, good: null };
  // résolution dynamique : vise ~45 images / s, entre 50 et 100 % de la résolution de base
  const governor = createGovernor({ target: 1 / 45, min: 0.5, max: 1, onChange: () => !S.busy && resize() });
  const pace = createPacer(() => RENDER.maxFps);
  const pixelRatio = () => Math.min(devicePixelRatio || 1, RENDER.pixelRatio) * (RENDER.dynRes ? governor.scale : 1);

  // ── Moteur ──
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  try { await renderer.init(); } catch (e) { return loader.error(`Impossible d’initialiser le rendu : ${e.message}`); }
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // (PCFSoftShadowMap n'existe plus en 0.186 : c'était déjà celui-ci)
  const canvas = renderer.domElement;
  $('#app').appendChild(canvas);

  // ── Compilation sans gel de l'écran de chargement. three.js crée ses
  // pipelines de rendu de façon synchrone au premier dessin : le processus
  // graphique du navigateur est alors bloqué pendant la compilation de chaque
  // shader, et avec lui tout l'affichage de la page (l'écran de chargement se
  // fige, bien qu'il soit dessiné dans un worker). Pendant le chargement, on
  // les demande donc en asynchrone (compilées en parallèle, hors du fil
  // d'affichage) : tant qu'une pipeline n'est pas prête, three.js saute les
  // objets qui l'utilisent (c'est son traitement d'une pipeline en erreur), et
  // l'on redessine jusqu'à ce qu'il n'en manque plus.
  const pipes = { on: false, pending: [], made: 0 };
  {
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
    pipes.flush = async () => { while (pipes.pending.length) await Promise.all(pipes.pending.splice(0)); };
  }

  // ── Recette ──
  let R = null;
  if (location.hash.startsWith('#r=')) {
    try { R = upgrade(await unpackRecipe(location.hash.slice(3))); } catch { R = null; }
  }
  R ??= generate(params.get('seed') || DEFAULT_SEED);

  // ── La scène, les trois mondes et le rendu d'un instant : core.js, partagé
  // avec le relais de la méga-scène. La page y ajoute la recherche sous les
  // yeux, l'écran de chargement et son atterrissage.
  // (mobile : moins de workers, la recherche ne doit pas étouffer le rendu)
  const pool = createPool(LITE ? Math.max(2, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)) : undefined);
  const core = await createCore({ renderer, width: innerWidth, height: innerHeight, gen: pool, lite: LITE, RENDER, S, onRoot: () => caption() });
  core.use(R);
  const { scene, camera, root, post, orbits, M, designOf, buildWorlds } = core;
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false; controls.enableDamping = true;
  controls.target.set(0, -0.16, 0);
  const setTime = (tau) => core.setTime(tau);
  const applyLive = () => core.applyLive();
  function applyRender() {
    if (!RENDER.dynRes) governor.reset();
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(innerWidth, innerHeight);
    core.applyRender();
    saveRender(RENDER);
  }

  function caption() {
    const Wa = S.worlds[Math.max(0, S.root)];
    if (!Wa) return;
    const p = Wa.params;
    const [pw, qw] = p.omegaFrac;
    const parts = [MOODS[Wa.L.mood].label, `${p.N} corps`];
    if (p.sym) parts.push(`${p.sym.m} pétales`);
    parts.push(pw ? `plateau : ${qw === 1 ? pw : `${pw}/${qw}`} tour par période` : 'plateau fixe');
    const gears = Wa.machine.design.trains.filter(Boolean).reduce((x, t) => x + t.gears.length, 0) * p.N;
    parts.push(`${Wa.epi.arms.length} bras · ${gears} roues`);
    $('#title p').textContent = parts.join(' · ');
    $('#seed').textContent = `graine ${R.seed}`;
    ui?.setInfo(`${p.N} corps · ${Wa.info.crossings} croisements`);
  }

  // ── recherche des orbites de toutes les couches (sous les yeux), puis les mondes.
  // Chaque échec (aucune orbite, essai planté, machine impossible à construire,
  // recherche trop longue) est dit à l'écran, avec de quoi repartir : une autre
  // graine, réessayer, ou revenir à la dernière scène qui marchait.
  function fail(msg, err) {
    if (err) console.error(err);
    S.busy = !S.worlds.length;
    S.loading = false; pipes.on = false;
    const actions = [{ label: 'Autre graine', run: () => on.random() }, { label: 'Réessayer', run: () => { orbits.length = 0; load(); } }];
    if (S.good) actions.push({ label: 'Revenir à la scène précédente', run: () => restoreGood() });
    loader.error(msg, actions);
  }
  function restoreGood() {
    R = core.use(JSON.parse(JSON.stringify(S.good.R)));
    orbits.length = 0; orbits.push(...S.good.orbits);
    ui?.build();
    load();
  }
  const marks = [];
  const mark = (k) => marks.push({ k, at: Math.round(performance.timeOrigin + performance.now()) });
  async function load(only = null) {
    const run = ++S.run;
    marks.length = 0; mark('search');
    S.busy = true;
    // (pendant le chargement : pipelines asynchrones, et la boucle ne dessine plus la scène)
    S.landing = false; S.handoff = false;
    S.loading = true; pipes.on = !params.has('syncpipes'); // (?syncpipes : l'ancienne compilation, pour comparer)
    loader.show();
    for (let m = 0; m < R.layers.length; m++) {
      if (only !== null && m !== only && orbits[m]) continue;
      if (only === null && orbits[m]) continue;
      loader.layer(m, R.layers.map((_, i) => !!orbits[i]));
      const res = await core.searchLayer(m, {
        onStatus: (t) => loader.status(t), onBegin: (seed, n) => loader.begin(seed, n),
        onSnap: (i, sn) => loader.snap(i, sn), onTry: (i, r) => loader.result(i, r), alive: () => run === S.run,
      });
      if (run !== S.run) return;
      if (!res.ok) return fail(res.message, res.error);
      orbits[m] = res.orbit;
    }
    const url = new URL(location.href);
    url.searchParams.set('seed', R.seed); url.hash = ''; history.replaceState(null, '', url);
    loader.status('');
    try {
      mark('design'); loader.step('design');
      loader.text('conception de la machine : un bras par cercle de la courbe (épicycles), des engrenages aux rapports exacts, des étages sans collision…');
      // (les trois machines sont conçues en parallèle, chacune dans un worker)
      const Ds = await Promise.all(R.layers.map((_, l) => designOf(orbits[l])));
      if (run !== S.run) return;
      // (le schéma montre désormais le monde sur lequel la scène s'ouvre, tel qu'on le verra)
      loader.scene(Ds[0], {
        omega: orbits[0].params.omega, rate: (TAU * R.layers[0].motion.periodsPerLayer) / R.motion.segment,
        rot: R.layers[0].camera.az - Math.PI / 2,
      });
      mark('build'); loader.step('build');
      await buildWorlds(() => {});
      if (run !== S.run) return;
      ui?.build();
      S.root = -1;
      setTime(S.tau);
    } catch (e) {
      if (run !== S.run) return;
      return fail(`La machine de cette orbite n’a pas pu être construite (${e.message}).`, e);
    }
    mark('render'); loader.step('render');
    await new Promise((res) => setTimeout(res, 30));
    try { await warm(true, () => run === S.run, (f) => loader.progress(f)); } catch (e) { if (run === S.run) return fail(`Le rendu n’a pas pu être préparé (${e.message}).`, e); }
    if (run !== S.run) return;
    pipes.on = false; S.loading = false;
    for (let i = 0; i < 3; i++) { await post.render(); await new Promise((res) => requestAnimationFrame(res)); }
    if (run !== S.run) return;
    S.good = { R: JSON.parse(JSON.stringify(R)), orbits: orbits.slice() };
    mark('done');
    // le schéma se cale sur la scène (même instant, même perspective), puis
    // l'écran s'efface sur le même mouvement ; la scène attend, immobile
    if (S.tau <= R.motion.hold) {
      S.landing = true;
      setTime(S.tau); await post.render();
      await loader.land(scenePose(), 1500);
      S.landing = false;
      if (run !== S.run) return;
      S.handoff = true;
      setTimeout(() => { if (run === S.run) S.handoff = false; }, 1800);
    }
    loader.hide();
    S.busy = false;
  }

  // Préparation du rendu : tout ce que la boucle dessinera est dessiné une fois
  // ici, pour que les matériaux, les ombres et les studios des trois mondes
  // soient compilés avant la première image, pas au premier passage (un gel à
  // chaque plongée, sinon). On passe par les six moments qui comptent (avant
  // et en fin de plongée, dans chacun des trois mondes), sans tri par le champ
  // de la caméra (un objet hors champ ne serait pas compilé).
  // deferred : pendant l'écran de chargement, les pipelines sont compilées en
  // asynchrone (voir pipes) ; on redessine tant qu'il en manque.
  // (nodeFrame : sans nouvelle image, la passe de scène réutiliserait la précédente)
  async function warm(deferred = false, alive = () => true, onProgress = null) {
    const tau0 = S.tau, fresh = () => renderer._nodes?.nodeFrame?.update?.();
    const culled = [];
    scene.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
    const pause = () => new Promise((res) => setTimeout(res, 0));
    const hidden = [];
    try {
      const views = [];
      for (let d = 0; d < M(); d++) views.push(d + 0.97, d + R.motion.hold * 0.5);
      if (deferred) {
        // d'abord par petits lots d'objets : un premier dessin de toute la scène
        // d'un coup enverrait d'un bloc toutes les géométries et tous les shaders
        // au processus graphique (un gel de l'affichage), et tiendrait la page
        // plusieurs secondes sans rendre la main
        scene.traverse((o) => { if ((o.isMesh || o.isLine || o.isPoints || o.isSprite) && o.visible) hidden.push(o); });
        for (const o of hidden) o.visible = false;
        setTime(views[0]);
        for (let i = 0; i < hidden.length;) {
          // (un lot : des objets six par six, jusqu'à 4 shaders nouveaux ou 30 ms)
          const t0 = performance.now(), before = pipes.made;
          do {
            for (let n = 0; n < 6 && i < hidden.length; n++) hidden[i++].visible = true;
            fresh(); await post.render();
          } while (i < hidden.length && pipes.made - before < 4 && performance.now() - t0 < 30);
          onProgress?.(i / hidden.length);
          await pause(); if (!alive()) return;
        }
        mark(`lots (${hidden.length} objets, ${pipes.made} shaders)`);
        await pipes.flush();
        // (les studios ont été préfiltrés avec des pipelines pas encore prêtes :
        // à refaire, un par image)
        for (const W of S.worlds) { W.env.needsPMREMUpdate = true; fresh(); await post.render(); await pipes.flush(); await pause(); }
        mark('studios');
      }
      for (let round = 0; round < 6; round++) {
        const before = pipes.made;
        for (const tau of views) {
          setTime(tau); fresh(); await post.render();
          if (deferred) { await pipes.flush(); await pause(); if (!alive()) return; }
        }
        if (!deferred || pipes.made === before) break;
      }
    } finally {
      for (const o of hidden) o.visible = true;
      for (const o of culled) o.frustumCulled = true;
      setTime(tau0);
      fresh();
    }
  }

  // ── Panneau ──
  const on = {
    random: () => { R = core.use(generate(randomSeed())); orbits.length = 0; S.tau = 0; ui?.build(); load(); },
    regenerate: (seed) => { R = core.use(generate(seed || randomSeed())); orbits.length = 0; S.tau = 0; ui?.build(); load(); },
    copyLink: async () => {
      const url = new URL(location.href);
      url.hash = `r=${await packRecipe(R)}`;
      try { await navigator.clipboard.writeText(url.href); toast('Lien copié.'); } catch { toast(url.href, 6000); }
    },
    togglePause: () => { S.paused = !S.paused; },
    orbitChanged: (m) => { orbits[m] = null; load(m); },
    moodChanged: (m) => {
      const keep = R.layers[m].orbit;
      R.layers[m] = generateLayer(createRng(`recipe:${R.seed}`).fork(`layer${m}:${R.layers[m].mood}`), R.layers[m].mood);
      R.layers[m].orbit = keep;
      ui?.build(); rebuild();
    },
    recipeChanged: () => rebuild(),
    rebuild: () => rebuild(),
    motionChanged: () => { controls.enabled = R.motion.free; },
    renderChanged: () => { applyRender(); rebuild(); },
    qualityChanged: (q) => {
      if ((q === 'mobile') !== LITE) { toast('Rechargement…', 0); return switchMobile(q === 'mobile'); }
      applyQuality(RENDER, q); ui?.refreshRender(); on.renderChanged();
    },
    resetRender: () => { Object.assign(RENDER, defaultsFor(LITE)); ui?.refreshRender(); on.renderChanged(); },
    exportVideo: (o) => exportVideo(o),
    exportPNG: () => exportPNG(canvas, () => post.render(), `orrery-${R.seed}.png`),
  };
  let rebuildTimer = 0;
  function rebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(async () => {
      if (!(orbits.length >= R.layers.length && orbits.slice(0, R.layers.length).every(Boolean))) return;
      try { await buildWorlds(); S.root = -1; setTime(S.tau); await warm(); } catch (e) { console.error(e); toast(`Réglage impossible : ${e.message}`, 5000); }
    }, 80);
  }
  const ui = params.get('ui') === '0' ? null : createUI({ recipe: () => R, render: RENDER, on });
  installChrome(ui, params);
  ui?.build();
  if (LITE || matchMedia?.('(pointer: coarse)').matches) {
    ui?.gui.close();
    bindTouch(canvas, {
      onTap: () => !R.motion.free && on.togglePause(),
      onDoubleTap: () => on.random(),
      onLongPress: () => document.body.classList.toggle('clean'),
    });
  }
  applyRender();

  // l'état du premier monde, pour l'écran de chargement : temps de l'orbite,
  // angle du plateau, hauteur des astres, et la matrice qui projette un point
  // de ce monde sur l'écran
  const PV = new THREE.Matrix4();
  function scenePose() {
    const W = S.worlds[0];
    camera.updateMatrixWorld(); W.group.updateWorldMatrix(true, false);
    PV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(W.group.matrixWorld);
    return { tau: W.clock.tau, th: W.clock.th, y: W.yGlobe, M: PV.toArray() };
  }

  // ── Boucle ──
  let last = performance.now(), frames = 0, fpsT = last;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!pace(now)) return; // (écrans 90 / 120 Hz : cadence plafonnée)
    const dt0 = (now - last) / 1000, dt = Math.min(0.1, dt0); last = now;
    if (RENDER.dynRes && !S.busy) governor.frame(dt0);
    if (!S.paused && S.worlds.length && !S.exporting && !S.loading && !S.landing) setTime(S.tau + dt / R.motion.segment);
    if (R.motion.free) controls.update();
    if (!S.loading) core.render();
    if (S.handoff) loader.pose(scenePose()); // (chargement : la scène est préparée dans warm())
    frames++;
    if (now - fpsT > 500) { ui?.setFps(`${(frames * 1000 / (now - fpsT)).toFixed(0)}${RENDER.dynRes ? `  ·  ${Math.round(governor.scale * 100)} %` : ''}`); frames = 0; fpsT = now; }
  }
  requestAnimationFrame(frame);

  function resize() {
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);

  // ── Export ──
  async function exportVideo({ width = 1920, height = 1080, fps = 30, mbps = 24 } = {}) {
    if (S.busy || !S.worlds.length) return;
    S.busy = true; S.exporting = true;
    const bar = $('#progress');
    bar.classList.add('on');
    try {
      await exportLoop({
        canvas, duration: R.motion.segment * R.layers.length,
        renderAt: (v) => core.renderAt(v),
        setSize: (w, h) => { renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
        restore: () => { canvas.style.width = ''; canvas.style.height = ''; resize(); },
      }, { width, height, fps, mbps }, (f) => { $('#progress u').style.width = `${(f * 100).toFixed(1)}%`; }, `orrery-${R.seed}.mp4`);
    } catch (e) { toast(`Export impossible : ${e.message}`, 5000); }
    bar.classList.remove('on');
    S.busy = false; S.exporting = false;
  }

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, select, textarea')) return;
    const kk = e.key.toLowerCase();
    if (kk === 'n') on.random();
    else if (kk === ' ') { S.paused = !S.paused; e.preventDefault(); }
    else if (kk === 'arrowright' || kk === 'arrowleft') { S.paused = true; setTime(S.tau + (kk === 'arrowright' ? 1 : -1) / 120); }
    else if (kk === 'h') document.body.classList.toggle('clean');
    else if (kk === 'f') (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
    else if (kk === 'e') exportVideo();
    else if (kk === 'p') on.exportPNG();
  });

  if (params.has('debug')) {
    window.chor = { marks, pipes, warm, loader, S, get R() { return R; }, setTime, render: () => post.render(), renderer, scene, camera, controls, post, load, on, root, core };
    // image fixe à la phase v de la boucle entière (0..1 : les trois plongées),
    // rendue n fois (historique de l'anticrénelage), dès que les mondes sont
    // construits et préparés ; la boucle reste en pause sur cet instant.
    // (On n'attend pas l'atterrissage de l'écran de chargement : il passe par
    // requestAnimationFrame, suspendu quand le panneau est masqué. Attentes par
    // messages : les minuteries d'une page masquée sont ralenties.)
    const yieldNow = () => new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => res(); c.port2.postMessage(0); });
    window.chor.shot = async (v, n = 12) => {
      while (S.loading || !S.worlds.length) await yieldNow();
      S.paused = true;
      document.body.classList.add('clean');
      for (let i = 0; i < n; i++) {
        renderer._nodes?.nodeFrame?.update(); // (sans nouvelle image, la passe de scène réutiliserait la précédente)
        core.renderAt(v);
        await renderer.backend.device?.queue.onSubmittedWorkDone();
      }
    };
    // l'image de la chaîne complète, relue sur le GPU : ImageData (comme shared/app/debug.js)
    window.chor.grab = async () => {
      const w = canvas.width, h = canvas.height;
      const rt = new THREE.RenderTarget(w, h, { type: THREE.UnsignedByteType });
      renderer.setRenderTarget(rt); post.render(); renderer.setRenderTarget(null);
      const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
      rt.dispose();
      const img = new ImageData(w, h), stride = Math.ceil((w * 4) / 256) * 256; // (lignes alignées sur 256 octets)
      for (let y = 0; y < h; y++) img.data.set(px.subarray(y * stride, y * stride + w * 4), y * w * 4);
      return img;
    };
    window.planetaire_v2 = window.chor; // (sous le nom du dossier aussi : tools/relay-check.html cherche window[<jour>])
  }
  load();
}

main();
