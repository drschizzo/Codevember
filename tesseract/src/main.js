// Point d'entrée : moteur, scène, génération, interface, boucle de rendu.
//
// Paramètres d'URL : ?seed=… (la scène), #r=… (une scène retouchée, partagée
// par « Copier le lien »), ?ui=0 (sans panneau), ?debug (outils dans
// window.tess, dont shot(phase) : une image fixe à une phase donnée),
// ?mobile=1 / ?mobile=0 (version allégée imposée / interdite ; voir app/mobile.js).
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generate, makeCell, finishesFor, upgrade, ornate } from './recipe.js';
import { randomNet, randomMoves } from './math4.js';
import { createRng } from '../../shared/rng.js';
import { createGenerator } from '../../shared/gen/client.js';
import { createTesseract } from './scene/tesseract.js';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from './scene/env.js';
import { G, setNoiseVolume, setLite } from './scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { createProbe, PROBE } from './scene/probe.js';
import { createAccumulator, jitter } from '../../shared/render/accum.js';
import { createUI } from './app/ui.js';
import { loadRender, saveRender, applyQuality, defaultsFor } from './app/settings.js';
import { wantsMobile, switchMobile, createGovernor, createPacer, bindTouch } from '../../shared/app/mobile.js';
import { exportLoop, exportPNG } from '../../shared/app/capture.js';
import { createOverlay, drawOverlay } from './app/overlay.js';
import { smoothInsidePose, entryAxis } from './scene/voyage.js';
import { voyageSeconds, timelineFor } from './math4.js';
import { loader } from '../../shared/app/loader.js';
import { asyncPipelines, warmScene } from '../../shared/app/warmup.js';

const TARGET = 1.9; // rayon de l'objet à l'écran (unités du monde)
const params = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const randomSeed = () => Math.random().toString(36).slice(2, 8);
const DEFAULT_SEED = 'atl45i'; // (la scène de l'ouverture, sans ?seed=)

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

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 10, 30);
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  const camState = { free: false };

  // (mobile : moins de workers, la génération ne doit pas étouffer le rendu)
  const gen = createGenerator(LITE ? Math.max(2, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)) : undefined);
  setNoiseVolume(await gen.request({ seed: 'tesseract-noise' }, 'noise'));
  const stage = createStage(scene, { lite: LITE });
  const tess = createTesseract(scene, gen, { studioLights: stage.studio });
  const post = createPost(renderer, scene, camera);
  const probe = LITE ? null : createProbe(renderer, scene);
  const overlay = createOverlay();
  const RENDER = loadRender(LITE);
  // résolution dynamique : vise ~45 images / s, entre 50 et 100 % de la résolution de base
  const governor = createGovernor({ target: 1 / 45, min: 0.5, max: 1, onChange: () => !busy && resize() });
  const pace = createPacer(() => RENDER.maxFps);

  let R;
  if (location.hash.startsWith('#r=')) { try { R = upgrade(await unpackRecipe(location.hash.slice(3))); } catch { R = null; } }
  R ??= generate(params.get('seed') || DEFAULT_SEED);

  // (les pixels de l'environnement sont calculés dans un worker de génération :
  // sur le fil principal, ils tenaient la page plusieurs secondes)
  let envKey = '', envJob = Promise.resolve();
  function syncEnv() {
    if (R.env.preset === envKey) return envJob; // (déjà là, ou en cours)
    const key = envKey = R.env.preset, W = LITE ? 512 : 1024;
    return (envJob = gen.request({ key, warmth: 0, W }, 'env').then(({ data }) => {
      if (envKey !== key) return;
      const old = scene.environment;
      scene.environment = makeEnvironment(data, 0, W);
      old?.dispose();
    }));
  }

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
  let ui = null, firstRecipe = true, resetMotion = true;
  function applyRecipe() {
    const recipe = R;
    loading.active = true; loading.applied = false; loading.settle = 0; loading.warming = false; loading.cells = '';
    loader.show({ steps: STEPS });
    showNet();
    setTimeout(() => {
      if (R !== recipe) return;
      tess.setRecipe(R);
      phi = 0; // (chaque scène commence par le patron déplié)
      resetMotion = true;
      syncEnv().then(() => { if (R === recipe) loading.applied = true; }, (e) => fail(`L’éclairage n’a pas pu être calculé (${e.message}).`));
    }, firstRecipe ? 0 : 280);
    firstRecipe = false;
    ui?.rebuild();
    const url = new URL(location.href);
    url.searchParams.set('seed', R.seed);
    url.hash = '';
    history.replaceState(null, '', url);
    document.title = `Tesseract · ${R.seed}`;
  }

  // ── Rendu d'une phase ──
  // pose extérieure (repère du monde) à la phase ph ; fold : pliage moyen
  function outsideCamera(ph, fold, target) {
    const K = R.camera, w = ph * Math.PI * 2;
    const az = K.az + w * K.orbit + K.sway * 0.35 * Math.sin(w);
    const el = K.elev + K.sway * 0.06 * Math.sin(2 * w + 0.7);
    // recul : l'objet occupe ~60 % de la demi-hauteur (ou de la demi-largeur, en portrait)
    // travelling : la caméra s'approche quand le tesseract est plié (il est
    // alors plus petit, et l'on veut voir l'intérieur des cellules)
    // (et déplié, le patron est vu d'un peu plus près)
    const close = (1 - (R.view?.dolly ?? 0) * 0.3 * fold * fold * (3 - 2 * fold)) * (1 - 0.28 * (1 - fold));
    const d = close * (K.dist * TARGET) / (0.6 * Math.tan((K.fov * Math.PI) / 360) * Math.min(1, camera.aspect));
    return target.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
  }
  // rayon d'entrée (ou de sortie) : choisi d'après la caméra extérieure au
  // début de la plongée (ou à la fin de la remontée), dans le repère local
  const _e = new THREE.Euler(), _gq = new THREE.Quaternion();
  function axisAt(ph) {
    const g = tess.group, p = outsideCamera(ph, 1, new THREE.Vector3());
    _gq.setFromEuler(_e.set(R.proj.tiltX, Math.PI * 2 * R.proj.spin * ph, R.proj.tiltZ, 'YXZ')).invert();
    return entryAxis(p.sub(g.position).divideScalar(g.scale.x).applyQuaternion(_gq));
  }
  function rigCamera(ph) {
    const K = R.camera;
    const fold = info?.state ? Math.min(1, Math.max(0, info.state.fold)) : 0;
    outsideCamera(ph, fold, camera.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, -0.15, 0);
    let fov = K.fov;
    // voyage intérieur : la caméra entre dans l'hypersphère (voir scene/voyage.js)
    const st = info?.state, kc = info?.kc ?? 0;
    G.tunnel.value = 0;
    if (st?.seg !== undefined && ['plunge', 'dwell', 'travel', 'surface'].includes(st.phase) && info.frames) {
      const g = tess.group, qi = g.quaternion.clone().invert();
      const tl = info.timeline;
      const out = {
        pos: g.worldToLocal(camera.position.clone()),
        fwd: _f.set(0, 0, -1).applyQuaternion(camera.quaternion).applyQuaternion(qi).clone(),
        up: _u.set(0, 1, 0).applyQuaternion(camera.quaternion).applyQuaternion(qi).clone(),
        upL: new THREE.Vector3(0, 1, 0).applyQuaternion(qi),
        uIn: axisAt(tl.find((p) => p.k === 'plunge').a),
        uOut: axisAt(tl.find((p) => p.k === 'surface').b),
      };
      // passage percé dans les parois : il s'ouvre devant la caméra et se
      // referme derrière elle (voir scene/project.js, revealMask)
      const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
      if (st.phase === 'plunge') { G.tunnelDir.value.copy(out.uIn); G.tunnel.value = ss(0.06, 0.22, st.f) * (1 - ss(0.66, 0.8, st.f)); }
      else if (st.phase === 'surface') { G.tunnelDir.value.copy(out.uOut); G.tunnel.value = ss(0.2, 0.34, st.f) * (1 - ss(0.78, 0.94, st.f)); }
      const P = smoothInsidePose(ph, st, R, info.frames, out, tl, R.loop.duration);
      const pos = P.pos, fwd = P.fwd.normalize(), up = P.up.normalize();
      g.localToWorld(pos);
      fwd.applyQuaternion(g.quaternion); up.applyQuaternion(g.quaternion);
      camera.position.copy(pos);
      camera.up.copy(up);
      camera.lookAt(_t.copy(pos).add(fwd));
      fov = K.fov + ((R.voyage.fov ?? 68) - K.fov) * kc;
    }
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3(), _j = new THREE.Vector3(), _dark = new THREE.Color();
  // ouverture de la lentille du rendu accumulé (rayon, en part de la distance de mise au point)
  const LENS = { wide: 0.005, inside: 0.004 };
  let lastPhase = 0, info = null;
  // sub : décalages d'une passe du rendu accumulé (voir render/accum.js)
  function renderAt(u, sub = null) {
    const ph = u - Math.floor(u);
    // (un saut dans la boucle n'est pas un mouvement : pas de vecteurs vitesse)
    let dph = Math.abs(ph - lastPhase); dph = Math.min(dph, 1 - dph);
    const reset = resetMotion || dph > 0.02;
    resetMotion = false;
    lastPhase = ph;
    G.phase.value = ph;
    G.microDetail.value = RENDER.microDetail;
    G.patina.value = RENDER.patina;
    G.roughFloor.value = RENDER.roughFloor;
    G.nestEnv.value = RENDER.nestEnv;
    G.crystalThick.value = RENDER.crystalThick;
    G.dither.value = RENDER.aa === 'traa' || sub ? 1 : 0; // (bord des trous tramé, moyenné par l'anticrénelage temporel ou par l'accumulation)
    const floorY = -R.floor.level * TARGET;
    // (le tesseract d'abord : la caméra du voyage se règle sur son état)
    info = tess.update(ph, { target: TARGET, floorY, reset });
    if (camState.free) controls.update(); else rigCamera(ph);
    const kc0 = info?.kc ?? 0;
    const focusOut = camera.position.length(), focusIn = tess.group.position.distanceTo(camera.position);
    const focusDist = (focusOut + (focusIn - focusOut) * kc0) * RENDER.focus;
    if (sub) {
      // la lentille a un diamètre : la caméra se décale dans son plan et vise
      // toujours le point de netteté (ouverture : part de la distance de mise
      // au point)
      const ap = focusDist * (kc0 > 0.5 ? LENS.inside : LENS.wide) * (RENDER.lens ?? 1);
      _f.set(0, 0, -1).applyQuaternion(camera.quaternion);
      _t.copy(camera.position).addScaledVector(_f, focusDist);
      _f.set(1, 0, 0).applyQuaternion(camera.quaternion); _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.up.copy(_u);
      camera.lookAt(_t);
      // (et un décalage dans le pixel : anticrénelage)
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    } else if (camera.view?.enabled) camera.clearViewOffset();
    camera.updateMatrixWorld();
    tess.setViewer(camera.position);
    const kp = info?.kp ?? 0, kc = info?.kc ?? 0, sc = info?.scale ?? 1;
    overlay.draw(info, R, RENDER);
    stage.update(R, floorY, { kc, kp, camera, scale: sc, lamp: R.voyage?.lamp ?? 1, top: info?.top, gain: info?.top?.gain ?? 1, jitter: sub ? _j.set(sub.light[0], 0, sub.light[1]) : null });
    // sonde de pièce (voir scene/probe.js) : une face par image, dans les pièces
    PROBE.k.value = probe && info?.top ? kc * (RENDER.probe ?? 1) : 0;
    if (PROBE.k.value > 0.01) probe.update(info.top.target, 0.03 * sc, reset); else probe?.invalidate();
    // (dans l'hypersphère, le lointain est sombre : la teinte de la scène,
    // très assombrie ; un fond clair, vu par tous les ajours, noyait l'image
    // dans un voile laiteux)
    scene.background.set(R.bg);
    if (kc > 0) {
      const L = 0.2126 * scene.background.r + 0.7152 * scene.background.g + 0.0722 * scene.background.b;
      _dark.copy(scene.background).multiplyScalar(Math.min(1, 0.012 / Math.max(L, 1e-4)));
      scene.background.lerp(_dark, Math.min(1, kc * 1.3));
    }
    scene.fog.color.copy(scene.background);
    const V = R.voyage ?? {};
    scene.fog.near = R.fog.near + ((V.fogNear ?? 1.4) * sc - R.fog.near) * kc;
    scene.fog.far = R.fog.far + ((V.fogFar ?? 6.5) * sc - R.fog.far) * kc;
    // (un univers clos : le studio ne s'y reflète presque plus)
    scene.environmentIntensity = R.env.intensity * (1 - 0.65 * kp);
    scene.environmentRotation.set(0, R.env.rotation, 0);
    // (dans les pièces, tout est proche : halo et flou de mouvement atténués,
    // sinon l'image entière se voile ; reflets en espace écran aussi : des
    // parois polies qui se reflètent l'une l'autre font une galerie des
    // glaces où l'œil ne sait plus où se poser)
    post.update({
      ...RENDER, focus: focusDist, focusRange: RENDER.focusRange * TARGET * 2,
      halation: RENDER.halation * (1 - 0.7 * kc), dirt: RENDER.dirt * (1 - 0.6 * kc), motionBlur: RENDER.motionBlur * (1 - 0.5 * kc),
      ssrIntensity: RENDER.ssrIntensity * (1 - 0.6 * kc),
      // (rendu accumulé : ni anticrénelage temporel ni flou de mouvement calculé, la moyenne les fait)
      ...(sub ? { aa: 'none', motionBlur: 0, dof: false } : {}),
    }, R);
    post.render();
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
  function warmPhases() {
    const tl = timelineFor(R), out = [0];
    for (const p of tl) out.push(p.a + (p.b - p.a) * 0.5);
    for (const k of ['plunge', 'dwell']) { const p = tl.find((x) => x.k === k); if (p) out.push(p.a + (p.b - p.a) * 0.97); }
    return out;
  }
  async function warmUp() {
    loading.warming = true;
    loader.step('compile');
    const recipe = R;
    try {
      const ok = await warmScene({
        renderer, scene, pipes, render: renderAt, phases: warmPhases(),
        onProgress: (f) => loader.progress(f), alive: () => R === recipe,
      });
      probe?.invalidate();
      resetMotion = true;
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
    stage.setShadowQuality(RENDER.shadows);
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
    netChanged: (shape) => { R.net.shape = shape; R.net.parent = randomNet(rngUI(), shape); tess.refresh(); },
    movesChanged: () => { R.moves = randomMoves(rngUI(), R.moveMode, true); if (R.voyage?.on) R.loop.duration = Math.round(voyageSeconds(R)); tess.refresh(); ui?.rebuild(); },
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
          overlay: (ctx, w, h) => drawOverlay(ctx, w, h, info, R, RENDER),
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
      renderer, scene, camera, tess, stage, post, probe, gen, RENDER, renderAt: renderStep, on, G, warmUp, pipes, errors,
      get R() { return R; },
      get info() { return info; },
      seek: (p) => { phi = p; paused = true; },
      play: () => { paused = false; frozen = false; },
      // phase d'un moment du voyage : at('travel', 1, 0.5)
      at(k, i = 0, f = 0) { const t = info?.timeline?.find((p) => p.k === k && p.i === i); return t ? t.a + (t.b - t.a) * f : null; },
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
      const st = info?.state;
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
  }
}

main().catch((e) => { console.error(e); fail(e.message); });
