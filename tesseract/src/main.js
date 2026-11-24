// Point d'entrée : moteur, scène, génération, interface, boucle de rendu.
//
// Paramètres d'URL : ?seed=… (la scène), ?interior=classic (l'ancien intérieur), #r=… (une scène retouchée, partagée
// par « Copier le lien »), ?ui=0 (sans panneau), ?debug (outils dans
// window.tess, dont shot(phase) : une image fixe à une phase donnée),
// ?mobile=1 / ?mobile=0 (version allégée imposée / interdite ; voir app/mobile.js).
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generate as generate0, makeCell, finishesFor, upgrade, ornate, toGallery } from './recipe.js';
import { randomNet, randomMoves } from './math4.js';
import { createRng } from '../../shared/rng.js';
import { createGenerator } from '../../shared/gen/client.js';
import { createCore } from './core.js';
import { G, setLite } from './scene/materials.js';
import { createAccumulator, jitter } from '../../shared/render/accum.js';
import { createUI } from './app/ui.js';
import { installChrome } from '../../shared/app/chrome.js';
import { loadRender, saveRender, applyQuality, defaultsFor } from './app/settings.js';
import { wantsMobile, switchMobile, createGovernor, createPacer, bindTouch } from '../../shared/app/mobile.js';
import { exportLoop, exportPNG } from '../../shared/app/capture.js';
import { createOverlay, drawOverlay } from './app/overlay.js';
import { voyageSeconds } from './math4.js';
import { loader } from '../../shared/app/loader.js';
import { asyncPipelines, warmScene } from '../../shared/app/warmup.js';

const params = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const randomSeed = () => Math.random().toString(36).slice(2, 8);
const DEFAULT_SEED = 'atl45i'; // (la scène de l'ouverture, sans ?seed=)
// L'intérieur est une galerie en enfilade (voir recipe.js, toGallery) ;
// ?interior=classic : l'ancien voyage, aux parois ornées et ajourées.
const CLASSIC = params.get('interior') === 'classic';
const generate = (seed, o) => (CLASSIC ? generate0(seed, o) : toGallery(generate0(seed, o)));

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
  // ── Version mobile (fixée au chargement) ──
  const LITE = wantsMobile(params);
  setLite(LITE);
  if (LITE) document.body.classList.add('lite');
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  try { await renderer.init(); } catch (e) { return fail(`Impossible d’initialiser le rendu : ${e.message}`); }
  if (!renderer.backend.isWebGPUBackend) toast('WebGPU indisponible : repli WebGL 2 (plus lent).', 5000);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.transmitted = true; // (verre et pierres : ombres colorées)
  const canvas = renderer.domElement;
  $('#app').appendChild(canvas);
  // Chargement sans gel : pipelines asynchrones pendant le chargement, et
  // préparation découpée en petits lots (app/warmup.js).
  const pipes = asyncPipelines(renderer);

  // (la scène, sa recette et le rendu d'une phase : core.js, partagé avec le
  // relais de la méga-scène)
  // (mobile : moins de workers, la génération ne doit pas étouffer le rendu)
  const gen = createGenerator(LITE ? Math.max(2, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)) : undefined);
  const RENDER = loadRender(LITE);
  if (params.has('handheld')) RENDER.handheld = +params.get('handheld') || 0; // (?handheld=0 : la caméra calculée seule, pour comparer)
  const core = await createCore({ renderer, width: innerWidth, height: innerHeight, gen, lite: LITE, RENDER });
  const { scene, camera, tess, stage, post, probe } = core;
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  const camState = { free: false };
  const overlay = createOverlay();
  // résolution dynamique : vise ~45 images / s, entre 50 et 100 % de la résolution de base
  const governor = createGovernor({ target: 1 / 45, min: 0.5, max: 1, onChange: () => !busy && resize() });
  const pace = createPacer(() => RENDER.maxFps);

  let R;
  if (location.hash.startsWith('#r=')) { try { R = upgrade(await unpackRecipe(location.hash.slice(3))); } catch { R = null; } }
  R ??= generate(params.get('seed') || DEFAULT_SEED);

  // (le studio : calculé par un worker de génération, voir core.js)
  const syncEnv = () => core.syncEnv();

  // ── Écran de chargement : le patron de la scène, en fil de fer (app/loaderArt.js) ──
  // La scène n'apparaît que prête : géométries arrivées, shaders compilés
  // (sans dessin synchrone : app/warmup.js), quelques images rendues
  // (historique de l'anticrénelage temporel).
  const loading = { active: true, applied: false, settle: 0, warming: false, cells: '' };
  const STEPS = [['build', 'les cellules se construisent'], ['compile', 'la lumière se prépare'], ['settle', 'premières images']];
  const showNet = () => loader.art({ recipe: {
    parent: R.net.parent, moves: R.moves, az: R.camera.az, elev: R.camera.elev, antic: R.chor.antic, stagger: R.chor.stagger, lamp: R.view?.practicalColor,
    proj: { d: R.proj.d, inflate: R.proj.inflate, inset: R.proj.inset, tiltX: R.proj.tiltX, tiltZ: R.proj.tiltZ },
  } });
  let ui = null, firstRecipe = true;
  function applyRecipe() {
    const recipe = R;
    loading.active = true; loading.applied = false; loading.settle = 0; loading.warming = false; loading.cells = '';
    loader.show({ steps: STEPS });
    showNet();
    setTimeout(() => {
      if (R !== recipe) return;
      phi = 0; // (chaque scène commence par le patron déplié)
      core.setRecipe(R).then(() => { if (R === recipe) loading.applied = true; }, (e) => fail(`L’éclairage n’a pas pu être calculé (${e.message}).`));
    }, firstRecipe ? 0 : 280);
    firstRecipe = false;
    ui?.rebuild();
    const url = new URL(location.href);
    url.searchParams.set('seed', R.seed);
    url.hash = '';
    history.replaceState(null, '', url);
    document.title = `Tesseract · ${R.seed}`;
  }

  // ── Rendu d'une phase ── (core.js ; les légendes, sur leur propre canevas)
  // sub : décalages d'une passe du rendu accumulé (voir render/accum.js)
  function renderAt(u, sub = null) {
    if (camState.free) controls.update();
    core.renderAt(u, { sub, free: camState.free });
    overlay.draw(core.info, R, RENDER);
  }
  // Rendu hors de la boucle d'animation (export, images de mise au point).
  // Les nœuds rafraîchis une fois par image (passe de scène, cartes d'ombre,
  // vitesses) ne le sont que si le numéro d'image avance, ce que seule la
  // boucle fait : on l'avance à la main. (API privée de three 0.186 : à
  // revérifier à chaque mise à jour.)
  function renderStep(u) {
    renderer._nodes?.nodeFrame?.update();
    renderAt(u);
  }
  // Amorçage, sous l'écran de chargement : chaque temps de la boucle, y
  // compris les moments du voyage dont les shaders ne servent que là (sonde de
  // pièce et ses doublures, gorges lumineuses, portes), est dessiné par petits
  // lots, pipelines compilées en asynchrone (app/warmup.js). Sans cela la
  // première image de la plongée gelait la page une demi-seconde, et
  // l'animation repartait par un à-coup. Rend false si un autre chargement a
  // été demandé entre-temps.
  async function warmUp() {
    loading.warming = true;
    loader.step('compile');
    const recipe = R;
    try {
      const ok = await warmScene({
        renderer, scene, pipes, render: renderAt, phases: core.warmPhases(),
        onProgress: (f) => loader.progress(f), alive: () => R === recipe,
      });
      probe?.invalidate();
      core.resetMotion();
      return ok;
    } finally {
      loading.warming = false;
      if (R === recipe) loader.step('settle');
    }
  }
  // Image accumulée (voir render/accum.js) : n passes autour de la phase u,
  // moyennées sur le canevas. frame : numéro de l'image (décorrèle les
  // décalages d'une image à l'autre) ; shutter : durée d'obturation, en phase.
  const accum = createAccumulator(renderer);
  function renderAccum(u, n, frame = 0, shutter = 0) {
    accum.begin(canvas.width, canvas.height);
    for (let i = 0; i < n; i++) {
      const sub = jitter(i, frame);
      renderer._nodes?.nodeFrame?.update();
      renderAt(u + sub.time * shutter, sub);
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
  const rngUI = () => createRng(`${R.seed}:${performance.now()}`);
  const cellCtx = (c) => {
    const others = R.cells.filter((_, i) => i !== c), tally = (get) => others.reduce((o, k) => { const v = get(k); o[v] = (o[v] || 0) + 1; return o; }, {});
    return { palette: R.palette, motifs: [...new Set(others.flatMap((k) => k.faces.filter(ornate)))], usedContent: tally((k) => k.content.type), usedObjects: tally((k) => k.content.set) };
  };
  const on = {
    camState,
    random: () => { R = generate(randomSeed()); applyRecipe(); },
    regenerate: (seed) => { if (seed && seed !== R.seed) { R = generate(seed); applyRecipe(); } },
    moodChanged: () => { R = generate(R.seed, { mood: R.mood }); applyRecipe(); },
    voyageChanged: () => { R.loop.duration = R.voyage.on ? Math.round(voyageSeconds(R)) : Math.round(R.moves.length * 7.5); tess.refresh(); ui?.rebuild(); },
    copyLink: async () => {
      const url = new URL(location.href);
      url.hash = `r=${await packRecipe(R)}`;
      await navigator.clipboard.writeText(url.href).then(() => toast('Lien copié (scène et retouches)'), () => toast(url.href, 8000));
    },
    togglePause: () => { paused = !paused; toast(paused ? 'Pause' : 'Lecture', 900); },
    recipeChanged: () => tess.refresh(),
    envChanged: () => syncEnv(),
    // (galerie : le patron en rangée et le voyage en ligne droite vont ensemble)
    netChanged: (shape) => { if (R.voyage?.gallery) return toast('Patron fixé par la galerie (?interior=classic pour le changer)', 3200); R.net.shape = shape; R.net.parent = randomNet(rngUI(), shape); tess.refresh(); },
    movesChanged: () => { if (R.voyage?.gallery) return toast('Voyage fixé par la galerie (?interior=classic pour le changer)', 3200); R.moves = randomMoves(rngUI(), R.moveMode, true); if (R.voyage?.on) R.loop.duration = Math.round(voyageSeconds(R)); tess.refresh(); ui?.rebuild(); },
    frameGeometry: () => tess.syncGeometry(null),
    frameSet: (s) => { R.frame.set = s; R.frame.finish = finishesFor(s, rngUI(), R.palette); tess.syncMaterial(null); ui?.rebuild(); },
    frameMaterial: () => tess.syncMaterial(null),
    cellGeometry: (c) => tess.syncGeometry(c),
    cellMaterial: (c) => tess.syncMaterial(c),
    // (une cellule retirée au panneau reste dans la palette et les motifs de la scène)
    cellKind: (c, k) => { R.cells[c] = makeCell(k, rngUI(), R.mood, rngUI().int(0, 1e6), cellCtx(c)); tess.syncGeometry(c); ui?.rebuildCells(); },
    cellReroll: (c) => { R.cells[c] = makeCell(R.cells[c].kind, rngUI(), R.mood, rngUI().int(0, 1e6), cellCtx(c)); tess.syncGeometry(c); ui?.rebuildCells(); },
    cellSet: (c, s) => { R.cells[c].panelSet = s; R.cells[c].panel = finishesFor(s, rngUI(), R.palette); tess.syncMaterial(c); ui?.rebuildCells(); },
    contentSet: (c, s) => { const k = R.cells[c].content; k.set = s; k.finish = finishesFor(s, rngUI(), R.palette); tess.syncMaterial(c); ui?.rebuildCells(); },
    contentAxis: (c) => { R.cells[c].content.axis = rngUI().dir(); },
    rebuildCells: () => ui?.rebuildCells(),
    renderChanged: () => applyRender(),
    quality: (k) => {
      // (entrer dans le mode mobile ou en sortir recompile les matériaux : rechargement)
      if ((k === 'mobile') !== LITE) { toast('Rechargement…', 0); return switchMobile(k === 'mobile'); }
      applyQuality(RENDER, k); applyRender();
    },
    resetRender: () => { Object.assign(RENDER, defaultsFor(LITE)); applyRender(); ui?.refresh(); },
    freeCam: (v) => { camState.free = v; controls.enabled = v; if (v) controls.target.set(0, -0.15, 0); toast(v ? 'Caméra libre' : 'Caméra du film', 1600); },
    exportPNG: (o = {}) => exportPNG(canvas, () => (o.samples > 1 ? renderAccum(phi, o.samples) : renderStep(phi)), `tesseract-${R.seed}.png`),
    exportVideo: async (o) => {
      if (busy) return;
      busy = true;
      const wasPaused = paused;
      paused = true;
      $('#progress').classList.add('on');
      try {
        await exportLoop({
          canvas, duration: R.loop.duration,
          // (obturateur ouvert la moitié de l'intervalle entre deux images)
          renderAt: o.samples > 1 ? (u, i, total) => renderAccum(u, o.samples, i, 0.5 / total) : renderStep, prime: !(o.samples > 1),
          // (légendes et analogie composées sur chaque image)
          overlay: (ctx, w, h) => drawOverlay(ctx, w, h, core.info, R, RENDER),
          setSize: (w, h) => { renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
          restore: () => { canvas.style.width = ''; canvas.style.height = ''; resize(); },
        }, o, (p) => { $('#progress u').style.width = `${(p * 100).toFixed(1)}%`; }, `tesseract-${R.seed}-${o.width}x${o.height}.mp4`);
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
  ui = params.get('ui') === '0' ? null : createUI({ recipe: () => R, render: RENDER, on });
  installChrome(ui, params);
  // Écran tactile : le panneau reste replié (il couvrirait l'image) ; une touche
  // met en pause, deux touches tirent une nouvelle scène, un appui long masque
  // l'interface.
  const touch = LITE || !!matchMedia?.('(pointer: coarse)').matches;
  let hinted = false;
  if (touch) {
    ui?.gui.close();
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
    window.tess = {
      renderer, scene, camera, tess, stage, post, probe, gen, RENDER, renderAt: renderStep, on, G, warmUp, pipes, errors, core,
      get R() { return R; },
      get info() { return core.info; },
      seek: (p) => { phi = p; paused = true; },
      play: () => { paused = false; frozen = false; },
      // phase d'un moment du voyage : at('travel', 1, 0.5)
      at(k, i = 0, f = 0) { const t = core.info?.timeline?.find((p) => p.k === k && p.i === i); return t ? t.a + (t.b - t.a) * f : null; },
      // image rendue, envoyée à un collecteur local (mise au point, panneau masqué)
      async send(name, scale = 0.5, url = 'http://127.0.0.1:8099/') {
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
      // posemètre : luminance de la passe de scène (HDR, avant étalonnage),
      // sur toute l'image et sur son centre (box : demi-côté, en part de la
      // hauteur) — médiane, 90e et 99e centiles, part de noir et de brûlé
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
      // image accumulée (n passes, obturation en phase) envoyée au collecteur
      async sendAccum(name, ph, n = 16, shutter = 0, scale = 0.5, url = 'http://127.0.0.1:8099/') {
        frozen = true;
        renderAccum(ph, n, 0, shutter);
        await renderer.backend.device?.queue.onSubmittedWorkDone();
        const rt = accum.sum, w = rt.width, h = rt.height;
        const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
        const c = new OffscreenCanvas(w, h), img = c.getContext('2d').createImageData(w, h), stride = (Math.ceil((w * 8) / 256) * 256) / 2;
        const enc = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = y * stride + x * 4, o = (y * w + x) * 4;
          for (let k = 0; k < 3; k++) img.data[o + k] = enc(Math.min(1, Math.max(0, THREE.DataUtils.fromHalfFloat(px[i + k]))));
          img.data[o + 3] = 255;
        }
        c.getContext('2d').putImageData(img, 0, 0);
        const sc = new OffscreenCanvas(Math.round(w * scale), Math.round(h * scale));
        sc.getContext('2d').drawImage(c, 0, 0, sc.width, sc.height);
        await fetch(url + name, { method: 'POST', body: await sc.convertToBlob({ type: 'image/jpeg', quality: 0.9 }) });
      },
      async shot(ph, n = 12) {
        await this.run(); // (fin du chargement, même panneau masqué)
        frozen = true;
        loader.hide();
        document.body.classList.add('clean');
        for (let i = 0; i < n; i++) { renderStep(ph); await renderer.backend.device?.queue.onSubmittedWorkDone(); }
      },
      // l'image de la chaîne complète, relue sur le GPU : ImageData (comme shared/app/debug.js)
      async grab() {
        const w = canvas.width, h = canvas.height;
        const rt = new THREE.RenderTarget(w, h, { type: THREE.UnsignedByteType });
        renderer.setRenderTarget(rt); post.render(); renderer.setRenderTarget(null);
        const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
        rt.dispose();
        const img = new ImageData(w, h), stride = Math.ceil((w * 4) / 256) * 256; // (lignes alignées sur 256 octets)
        for (let y = 0; y < h; y++) img.data.set(px.subarray(y * stride, y * stride + w * 4), y * w * 4);
        return img;
      },
    };
  }
  addEventListener('resize', () => !busy && resize());
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); on.togglePause(); }
    else if (e.key === 'n' || e.key === 'N') on.random();
    else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('clean');
    else if (e.key === 'l' || e.key === 'L') { RENDER.captions = !RENDER.captions; saveRender(RENDER); }
    else if (e.key === 'a' || e.key === 'A') { RENDER.analogy = !RENDER.analogy; saveRender(RENDER); }
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
      if (!loading.settle) {
        loader.progress(tess.progress());
        // (chaque cellule s'allume à l'écran quand ses pièces sont construites)
        const cp = tess.cellsProgress(), key = `${cp.frame}:${cp.cells}`;
        if (key !== loading.cells) { loading.cells = key; loader.art(cp); }
      } else if (loading.settle >= 2) loader.progress((loading.settle - 2) / 7);
      if (loading.applied && tess.ready()) {
        if (!loading.settle) {
          loading.settle = 1;
          warmUp().then((ok) => { if (ok) loading.settle = 2; }, (e) => fail(`Le rendu n'a pas pu être préparé (${e.message}).`));
        } else if (loading.settle >= 2 && ++loading.settle > 8) {
          loading.active = false;
          loader.hide();
          if (touch && !hinted) { hinted = true; toast('touche : pause · deux touches : nouvelle scène · appui long : masquer', 4500); }
        }
      }
      // (rien n'est dessiné avant que tout soit compilé : pas de pipeline synchrone)
      if (!loading.applied || !tess.ready() || loading.settle < 2) return;
    }
    renderAt(phi);
    fpsAcc += dt; fpsN++;
    if ((fpsT += dt) > 0.5) {
      const st = core.info?.state;
      ui?.setFps(`${(fpsN / fpsAcc).toFixed(0)}${RENDER.dynRes ? `  ·  ${Math.round(governor.scale * 100)} %` : ''}  ·  étape ${st ? st.step + 1 : '–'}/${R.moves.length}  ·  ${st?.phase ?? ''}`);
      fpsAcc = fpsN = fpsT = 0;
    }
  }
  renderer.setAnimationLoop(tick);
  if (window.tess) {
    // fait tourner la boucle à la main jusqu'à la fin du chargement (ou pendant
    // `seconds` de film) : à utiliser quand le panneau est masqué
    window.tess.run = async (seconds = 0) => {
      frozen = false; // (une image fixe gèle la boucle : le chargement suivant ne finirait jamais)
      const t0 = performance.now();
      while (loading.active || performance.now() - t0 < seconds * 1000) {
        renderer._nodes?.nodeFrame?.update();
        tick(performance.now());
        await new Promise((r) => setTimeout(r, 16));
      }
    };
    Object.defineProperty(window.tess, 'loading', { get: () => ({ ...loading }) });
    window.tesseract = window.tess; // (sous le nom du dossier aussi : tools/relay-check.html cherche window[<jour>])
  }
}

main().catch((e) => { console.error(e); fail(e.message); });
