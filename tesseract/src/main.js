// Point d'entrée : moteur, scène, génération, interface, boucle de rendu.
//
// Paramètres d'URL : ?seed=… (la scène), #r=… (une scène retouchée, partagée
// par « Copier le lien »), ?ui=0 (sans panneau), ?debug (outils dans
// window.tess, dont shot(phase) : une image fixe à une phase donnée).
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generate, makeCell, finishesFor, upgrade } from './recipe.js';
import { randomNet, randomMoves } from './math4.js';
import { createRng } from './rng.js';
import { createGenerator } from './gen/client.js';
import { createTesseract } from './scene/tesseract.js';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from './scene/env.js';
import { G, setNoiseVolume } from './scene/materials.js';
import { createPost } from './render/post.js';
import { createUI } from './app/ui.js';
import { loadRender, saveRender, applyQuality, RENDER_DEFAULTS } from './app/settings.js';
import { exportLoop, exportPNG } from './app/capture.js';
import { createOverlay, drawOverlay } from './app/overlay.js';
import { insidePose } from './scene/voyage.js';
import { voyageSeconds } from './math4.js';

const TARGET = 1.9; // rayon de l'objet à l'écran (unités du monde)
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
  if (!renderer.backend.isWebGPUBackend) toast('WebGPU indisponible : repli WebGL 2 (plus lent).', 5000);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.transmitted = true; // (verre et pierres : ombres colorées)
  const canvas = renderer.domElement;
  $('#app').appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 10, 30);
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  const camState = { free: false };

  const gen = createGenerator();
  setNoiseVolume(await gen.request({ seed: 'tesseract-noise' }, 'noise'));
  const tess = createTesseract(scene, gen);
  const stage = createStage(scene);
  const post = createPost(renderer, scene, camera);
  const overlay = createOverlay();
  const RENDER = loadRender();

  let R;
  if (location.hash.startsWith('#r=')) { try { R = upgrade(await unpackRecipe(location.hash.slice(3))); } catch { R = null; } }
  R ??= generate(params.get('seed') || randomSeed());

  let envKey = '';
  function syncEnv() {
    if (R.env.preset === envKey) return;
    envKey = R.env.preset;
    const old = scene.environment;
    scene.environment = makeEnvironment(envKey);
    old?.dispose();
  }

  const loading = { active: true, applied: false, settle: 0 };
  let ui = null, firstRecipe = true, resetMotion = true;
  function applyRecipe() {
    const recipe = R;
    loading.active = true; loading.applied = false; loading.settle = 0;
    $('#loader').classList.remove('gone');
    $('#loadbar u').style.width = '0%';
    setTimeout(() => {
      if (R !== recipe) return;
      tess.setRecipe(R);
      syncEnv();
      loading.applied = true;
      resetMotion = true;
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
  function rigCamera(ph) {
    const K = R.camera, w = ph * Math.PI * 2;
    const az = K.az + w * K.orbit + K.sway * 0.35 * Math.sin(w);
    const el = K.elev + K.sway * 0.06 * Math.sin(2 * w + 0.7);
    // recul : l'objet occupe ~60 % de la demi-hauteur (ou de la demi-largeur, en portrait)
    // travelling : la caméra s'approche quand le tesseract est plié (il est
    // alors plus petit, et l'on veut voir l'intérieur des cellules)
    const fold = info?.state ? Math.min(1, Math.max(0, info.state.fold)) : 0;
    const close = 1 - (R.view?.dolly ?? 0) * 0.3 * fold * fold * (3 - 2 * fold);
    const d = close * (K.dist * TARGET) / (0.6 * Math.tan((K.fov * Math.PI) / 360) * Math.min(1, camera.aspect));
    camera.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, -0.15, 0);
    let fov = K.fov;
    // voyage intérieur : la caméra entre dans l'hypersphère (voir scene/voyage.js)
    const kc = info?.kc ?? 0;
    if (kc > 0 && info.frames) {
      const g = tess.group, qi = g.quaternion.clone().invert();
      const out = {
        pos: g.worldToLocal(camera.position.clone()),
        fwd: _f.set(0, 0, -1).applyQuaternion(camera.quaternion).applyQuaternion(qi).clone(),
        up: _u.set(0, 1, 0).applyQuaternion(camera.quaternion).applyQuaternion(qi).clone(),
      };
      const P = insidePose(info.state, R, info.frames, out);
      const pos = out.pos.lerp(P.pos, kc), fwd = out.fwd.lerp(P.fwd, kc).normalize(), up = out.up.lerp(P.up, kc).normalize();
      g.localToWorld(pos);
      fwd.applyQuaternion(g.quaternion); up.applyQuaternion(g.quaternion);
      camera.position.copy(pos);
      camera.up.copy(up);
      camera.lookAt(_t.copy(pos).add(fwd));
      fov = K.fov + ((R.voyage.fov ?? 68) - K.fov) * kc;
    }
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3();
  let lastPhase = 0, info = null;
  function renderAt(u) {
    const ph = u - Math.floor(u);
    // (un saut dans la boucle n'est pas un mouvement : pas de vecteurs vitesse)
    let dph = Math.abs(ph - lastPhase); dph = Math.min(dph, 1 - dph);
    const reset = resetMotion || dph > 0.02;
    resetMotion = false;
    lastPhase = ph;
    G.phase.value = ph;
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    G.nestEnv.value = RENDER.nestEnv;
    G.crystalThick.value = RENDER.crystalThick;
    const floorY = -R.floor.level * TARGET;
    // (le tesseract d'abord : la caméra du voyage se règle sur son état)
    info = tess.update(ph, { target: TARGET, floorY, reset });
    if (camState.free) controls.update(); else rigCamera(ph);
    camera.updateMatrixWorld();
    G.viewPos.value.copy(camera.position);
    tess.group.worldToLocal(G.camLocal.value.copy(camera.position));
    // (en voyage, la coupe côté caméra n'a plus de sens : on est dedans)
    const kp = info?.kp ?? 0, kc = info?.kc ?? 0, sc = info?.scale ?? 1;
    G.cutaway.value = R.view.cutaway * (1 - kp);
    overlay.draw(info, R, RENDER);
    stage.update(R, floorY, { kc, kp, camera, scale: sc, lamp: R.voyage?.lamp ?? 1 });
    scene.background.set(R.bg);
    scene.fog.color.set(R.bg);
    const V = R.voyage ?? {};
    scene.fog.near = R.fog.near + ((V.fogNear ?? 1.4) * sc - R.fog.near) * kc;
    scene.fog.far = R.fog.far + ((V.fogFar ?? 6.5) * sc - R.fog.far) * kc;
    // (un univers clos : le studio ne s'y reflète presque plus)
    scene.environmentIntensity = R.env.intensity * (1 - 0.65 * kp);
    scene.environmentRotation.set(0, R.env.rotation, 0);
    const focusOut = camera.position.length(), focusIn = tess.group.position.distanceTo(camera.position);
    const focusDist = (focusOut + (focusIn - focusOut) * kc) * RENDER.focus;
    post.update({ ...RENDER, focus: focusDist, focusRange: RENDER.focusRange * TARGET * 2 }, R);
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
    stage.setShadowQuality(RENDER.shadows);
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
    frameSet: (s) => { R.frame.set = s; R.frame.finish = finishesFor(s, rngUI()); tess.syncMaterial(null); ui?.rebuild(); },
    frameMaterial: () => tess.syncMaterial(null),
    cellGeometry: (c) => tess.syncGeometry(c),
    cellMaterial: (c) => tess.syncMaterial(c),
    cellKind: (c, k) => { R.cells[c] = makeCell(k, rngUI(), R.mood, rngUI().int(0, 1e6)); tess.syncGeometry(c); ui?.rebuildCells(); },
    cellReroll: (c) => { R.cells[c] = makeCell(R.cells[c].kind, rngUI(), R.mood, rngUI().int(0, 1e6)); tess.syncGeometry(c); ui?.rebuildCells(); },
    cellSet: (c, s) => { R.cells[c].panelSet = s; R.cells[c].panel = finishesFor(s, rngUI()); tess.syncMaterial(c); ui?.rebuildCells(); },
    contentSet: (c, s) => { const k = R.cells[c].content; k.set = s; k.finish = finishesFor(s, rngUI()); tess.syncMaterial(c); ui?.rebuildCells(); },
    contentAxis: (c) => { R.cells[c].content.axis = rngUI().dir(); },
    rebuildCells: () => ui?.rebuildCells(),
    renderChanged: () => applyRender(),
    quality: (k) => { applyQuality(RENDER, k); applyRender(); },
    resetRender: () => { Object.assign(RENDER, RENDER_DEFAULTS); applyRender(); ui?.refresh(); },
    freeCam: (v) => { camState.free = v; controls.enabled = v; if (v) controls.target.set(0, -0.15, 0); toast(v ? 'Caméra libre' : 'Caméra du film', 1600); },
    exportPNG: () => exportPNG(canvas, () => renderStep(phi), `tesseract-${R.seed}.png`),
    exportVideo: async (o) => {
      if (busy) return;
      busy = true;
      const wasPaused = paused;
      paused = true;
      $('#progress').classList.add('on');
      try {
        await exportLoop({
          canvas, duration: R.loop.duration, renderAt: renderStep,
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

  applyRender();
  applyRecipe();
  if (params.has('debug')) {
    window.tess = {
      renderer, scene, camera, tess, stage, post, gen, RENDER, renderAt: renderStep, on, G,
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
      async shot(ph, n = 12) {
        while (!tess.ready()) await new Promise((r) => setTimeout(r, 200));
        frozen = true;
        $('#loader').classList.add('gone');
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

  let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0;
  renderer.setAnimationLoop((now) => {
    if (busy || frozen) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused && !loading.active) phi += dt / R.loop.duration;
    renderAt(phi);
    if (loading.active) {
      $('#loadbar u').style.width = `${(tess.progress() * 100).toFixed(1)}%`;
      if (loading.applied && tess.ready() && ++loading.settle > 8) { loading.active = false; $('#loader').classList.add('gone'); }
    }
    fpsAcc += dt; fpsN++;
    if ((fpsT += dt) > 0.5) {
      const st = info?.state;
      ui?.setFps(`${(fpsN / fpsAcc).toFixed(0)}  ·  étape ${st ? st.step + 1 : '–'}/${R.moves.length}  ·  ${st?.phase ?? ''}`);
      fpsAcc = fpsN = fpsT = 0;
    }
  });
}

main().catch((e) => { console.error(e); fail(e.message); });
