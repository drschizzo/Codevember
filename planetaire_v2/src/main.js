// Point d'entrée : recette, recherche de l'orbite, scène, panneau, boucle de rendu.
//
// La scène : un plateau qui tourne à ω = p/q sur un pied, dans un studio. Sur
// le plateau, la courbe de la chorégraphie est fixe ; les bras de la machine
// de Fourier tournent à des vitesses entières et portent les astres. Dans le
// studio, les astres suivent donc exactement la solution newtonienne. Après q
// périodes, le plateau a fait p tours : la boucle est parfaite.
//
// Paramètres d'URL : ?seed=… (la scène), #r=… (une scène retouchée, partagée
// par « Copier le lien »), ?ui=0 (sans panneau), ?debug (outils dans window.chor).
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPool } from './orbit/client.js';
import { curveAt } from './orbit/action.js';
import { epicycles, sampleCurve } from './scene/epicycles.js';
import { createOrbitVisual } from './scene/orbit3d.js';
import { createMachine, materials, Y_PLATE } from './scene/machine.js';
import { makeEnvironment } from './scene/env.js';
import { createPost } from './render/post.js';
import { exportLoop, exportPNG } from './app/capture.js';
import { createLoader } from './app/loader.js';
import { createUI } from './app/ui.js';
import { loadRender, saveRender, applyQuality, RENDER_DEFAULTS, SHADOWS } from './app/settings.js';
import { beatsFor, warp, shotsFor, cameraAt } from './scene/choreo.js';
import { generate, upgrade, orbitOverrides, packRecipe, unpackRecipe, MATTERS } from './recipe.js';

const TAU = Math.PI * 2;
const params = new URLSearchParams(location.search);
const DEFAULT_SEED = '17';
const Y_FLOOR = -0.72;
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
  const RENDER = loadRender();

  // ── Moteur ──
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  try { await renderer.init(); } catch (e) { return loader.error(`Impossible d’initialiser le rendu : ${e.message}`); }
  renderer.setPixelRatio(RENDER.pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  $('#app').appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 40);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false; controls.enableDamping = true;
  controls.target.set(0, -0.14, 0);

  // ── Studio : sol, pied, lumières ──
  const mats = materials();
  const floorMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 96), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = Y_FLOOR; floor.receiveShadow = true;
  scene.add(floor);
  const footH = Y_PLATE - 0.035 - Y_FLOOR;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, footH, 48), mats.foot);
  foot.position.y = Y_FLOOR + footH / 2; foot.castShadow = foot.receiveShadow = true;
  scene.add(foot);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.04, 96), mats.foot);
  base.position.y = Y_FLOOR + 0.02; base.castShadow = base.receiveShadow = true;
  scene.add(base);

  const key = new THREE.SpotLight(0xffffff, 6, 0, 0.42, 0.85, 2);
  key.position.set(-2.4, 3.6, 1.7);
  key.target.position.set(0, Y_PLATE, 0);
  key.castShadow = true;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.01;
  scene.add(key, key.target);
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
  rimLight.position.set(1.8, 1.4, -2.6);
  scene.add(rimLight);

  // le plateau tourne à ω : tout ce qu'il porte est dans le repère de la courbe
  const plate = new THREE.Group();
  scene.add(plate);

  const post = createPost(renderer, scene, camera, null);

  // ── Recette ──
  let R = null;
  if (location.hash.startsWith('#r=')) {
    try { R = upgrade(await unpackRecipe(location.hash.slice(3))); } catch { R = null; }
  }
  R ??= generate(params.get('seed') || DEFAULT_SEED);

  // ── État ──
  const pool = createPool();
  const S = { orbit: null, coef: null, p: null, visual: null, machine: null, q: 1, duration: 10, L: 0, paused: false, busy: false, run: 0, envKey: '' };
  const pos = new Float64Array(2);
  let bodyXY = new Float64Array(2);
  const world = [];

  // L ∈ [0, 1) : phase de la boucle (q périodes). Le temps de l'orbite est
  // déformé (ralentis sur les passages serrés) ; la caméra, elle, vit en
  // temps réel.
  function setTime(L) {
    S.L = ((L % 1) + 1) % 1;
    if (!S.visual) return;
    const { N, omega } = S.p;
    const { tau, open } = warp(TAU * S.q * S.L, S.beats);
    const th = omega * tau, c = Math.cos(th), sn = Math.sin(th);
    plate.rotation.y = th;
    S.visual.phase.value = ((tau / TAU) % 1 + 1) % 1;
    for (let j = 0; j < N; j++) {
      curveAt(S.coef, S.p, tau + (TAU * j) / N, pos);
      bodyXY[2 * j] = pos[0]; bodyXY[2 * j + 1] = pos[1];
      S.visual.bodies[j].position.set(pos[0], 0, -pos[1]);
      // position dans le studio (plateau tourné de θ autour de +y)
      world[j] = [pos[0] * c - pos[1] * sn, 0, -pos[0] * sn - pos[1] * c];
    }
    // embrasement : un astre s'avive quand il en frôle un autre
    for (let j = 0; j < N; j++) {
      let d = Infinity;
      for (let i = 0; i < N; i++) if (i !== j) d = Math.min(d, Math.hypot(bodyXY[2 * i] - bodyXY[2 * j], bodyXY[2 * i + 1] - bodyXY[2 * j + 1]));
      S.visual.setBoost(j, 1 + R.bodies.flare * Math.exp(-((d / (1.7 * S.ratio)) ** 2)));
    }
    S.machine.update(tau, bodyXY);
    if (!R.motion.free) placeCamera(S.L, open);
  }

  // caméra : suite de plans tirée de la graine ; mise au point sur la cible
  const fitFor = () => {
    const vf = (30 * Math.PI) / 360, hf = Math.atan(Math.tan(vf) * camera.aspect);
    return 1.5 / Math.tan(Math.min(vf * 1.25, hf));
  };
  function placeCamera(L, open = 0) {
    const cam = cameraAt(L, S.shots, { fit: fitFor(), open, body: (j) => world[j] });
    camera.position.set(...cam.pos);
    camera.lookAt(...cam.target);
    if (Math.abs(camera.fov - cam.fov) > 1e-4) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    focusOn(cam.target);
  }
  function focusOn(t) {
    const d = camera.position.distanceTo(new THREE.Vector3(...t));
    post.U.focus.value = d;
    post.U.focusRange.value = RENDER.focusSpread * d;
  }

  // ── Réglages à vif : matières, astres, verre, lumières ──
  function applyLive() {
    mats.apply(R.matters, MATTERS);
    floorMat.color.set(R.light.floor);
    scene.background.set(R.light.bg);
    // fond clair : légende et indications en sombre
    const bg = new THREE.Color(R.light.bg);
    document.body.classList.toggle('light', 0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b > 0.3);
    if (R.light.env !== S.envKey) {
      S.envKey = R.light.env;
      const old = scene.environment;
      scene.environment = makeEnvironment(R.light.env, 0, 1024);
      old?.dispose();
    }
    scene.environmentIntensity = R.light.envIntensity;
    key.color.set(R.light.key.color); key.intensity = R.light.key.intensity;
    rimLight.color.set(R.light.rim.color); rimLight.intensity = R.light.rim.intensity;
    S.visual?.setStyle(R);
    post.U.warmth.value = RENDER.warmth + R.light.warmth;
  }

  function applyRender() {
    renderer.setPixelRatio(RENDER.pixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    const sh = SHADOWS[RENDER.shadows] || SHADOWS.high;
    if (key.shadow.mapSize.x !== sh.key) { key.shadow.mapSize.set(sh.key, sh.key); key.shadow.map?.dispose(); key.shadow.map = null; }
    post.update({ ...RENDER, focus: post.U.focus.value, focusRange: post.U.focusRange.value, warmth: RENDER.warmth + R.light.warmth }, null);
    saveRender(RENDER);
  }

  // ── Mise en scène (ralentis, plans), recalculée quand la recette change ──
  function applyMotion() {
    if (!S.p) return;
    S.duration = S.q * R.motion.period;
    S.beats = beatsFor(S.coef, S.p, S.q, R.seed, R.motion.slowmo);
    S.shots = shotsFor(R.seed, S.duration, S.p.N, R.motion.shotLength);
    controls.enabled = R.motion.free;
    if (R.motion.free) controls.target.set(0, -0.14, 0);
  }

  function caption() {
    const p = S.p, o = S.orbit;
    const [pw, qw] = p.omegaFrac;
    const parts = [`${p.N} corps`];
    if (p.sym) parts.push(`${p.sym.m} pétales${p.sym.mirror ? ', miroir' : ''}`);
    parts.push(pw ? `plateau : ${qw === 1 ? pw : `${pw}/${qw}`} tour par période` : 'plateau fixe');
    parts.push(`${S.arms} bras`);
    if (o.rho !== undefined) parts.push(o.rho < 1.01 ? 'stable' : 'instable');
    $('#title p').textContent = parts.join(' · ');
    $('#seed').textContent = `graine ${R.seed}`;
    ui?.setInfo(`${p.N} corps · ${o.info.crossings} croisements${o.rho !== undefined ? (o.rho < 1.01 ? ' · stable' : ' · instable') : ''}`);
  }

  // ── Construction de la scène autour de l'orbite trouvée ──
  function buildScene() {
    if (S.visual) { plate.remove(S.visual.group, S.machine.group); S.visual.dispose(); S.machine.dispose(); }
    const p = S.p, sh = SHADOWS[RENDER.shadows] || SHADOWS.high;
    const curve = sampleCurve(S.coef, p, 2400);
    const epi = epicycles(S.coef, p, 1, { tol: 0.003, max: 8 });
    S.visual = createOrbitVisual({ curve, N: p.N, radius: 0.0065 * R.trace.thick, shadows: { bodies: sh.bodies, size: sh.body } });
    S.machine = createMachine({ arms: epi.arms, N: p.N, mats });
    plate.add(S.machine.group, S.visual.group);
    S.arms = epi.arms.length;
    bodyXY = new Float64Array(2 * p.N);
    applyLive();
    applyMotion();
    caption();
    setTime(S.L);
  }

  // recherche de l'orbite (graine et contraintes de la recette), puis la scène
  async function load() {
    const run = ++S.run;
    S.busy = true;
    loader.show();
    const r = await pool.search(R.seed, { over: orbitOverrides(R), onSnap: (i, s) => loader.snap(i, s), onTry: (i) => loader.drop(i) });
    if (run !== S.run) return;
    if (!r.ok) {
      const constrained = Object.keys(orbitOverrides(R)).length > 0;
      loader.error(constrained ? 'Aucune orbite avec ces contraintes : une autre graine…' : `Aucune orbite pour la graine « ${R.seed} » : une autre graine…`);
      setTimeout(() => { if (run !== S.run) return; R.seed = randomSeed(); load(); }, 1400);
      return;
    }
    const o = r.orbit, p = o.params, k = 1 / o.info.size;
    // l'orbite, ramenée à une taille 1
    Object.assign(S, { orbit: o, coef: Float64Array.from(o.coef, (v) => v * k), p, q: p.omegaFrac[1], ratio: o.info.ratio, L: 0 });
    const url = new URL(location.href);
    url.searchParams.set('seed', R.seed); url.hash = ''; history.replaceState(null, '', url);
    buildScene();
    ui?.build();
    // quelques images pour compiler les matériaux derrière l'écran
    for (let i = 0; i < 3; i++) { await post.render(); await new Promise((res) => requestAnimationFrame(res)); }
    if (run !== S.run) return;
    loader.hide();
    S.busy = false;
    const st = await pool.stability(o);
    if (run !== S.run) return;
    o.rho = st.rho;
    caption();
  }

  // ── Panneau ──
  const newScene = (seed, opts) => { R = generate(seed, opts); ui?.build(); load(); };
  const on = {
    random: () => newScene(randomSeed()),
    regenerate: (seed) => newScene(seed || randomSeed()),
    copyLink: async () => {
      const url = new URL(location.href);
      url.hash = `r=${await packRecipe(R)}`;
      try { await navigator.clipboard.writeText(url.href); toast('Lien copié.'); } catch { toast(url.href, 6000); }
    },
    togglePause: () => { S.paused = !S.paused; },
    orbitChanged: () => load(),
    moodChanged: () => { const keep = R.orbit; R = generate(R.seed, { mood: R.mood }); R.orbit = keep; ui?.build(); applyLive(); },
    recipeChanged: () => applyLive(),
    rebuild: () => S.p && buildScene(),
    motionChanged: () => { applyMotion(); setTime(S.L); },
    renderChanged: () => { const sh = S.visual && S.visual.bodies.filter((b) => b.userData.light.castShadow).length; applyRender(); if (S.p && sh !== (SHADOWS[RENDER.shadows] || SHADOWS.high).bodies) buildScene(); },
    qualityChanged: (q) => { applyQuality(RENDER, q); ui?.refreshRender(); on.renderChanged(); },
    resetRender: () => { Object.assign(RENDER, RENDER_DEFAULTS); ui?.refreshRender(); on.renderChanged(); },
    exportVideo: (o) => exportVideo(o),
    exportPNG: () => exportPNG(canvas, () => post.render(), `choregraphie-${R.seed}.png`),
  };
  const ui = params.get('ui') === '0' ? null : createUI({ recipe: () => R, render: RENDER, on });
  ui?.build();
  applyRender();

  // ── Boucle ──
  let last = performance.now(), frames = 0, fpsT = last;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!S.paused && S.visual && !S.exporting) setTime(S.L + dt / S.duration);
    if (R.motion.free) { controls.update(); focusOn([controls.target.x, controls.target.y, controls.target.z]); }
    post.render();
    frames++;
    if (now - fpsT > 500) { ui?.setFps((frames * 1000 / (now - fpsT)).toFixed(0)); frames = 0; fpsT = now; }
  }
  requestAnimationFrame(frame);

  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);

  // ── Export ──
  async function exportVideo({ width = 1920, height = 1080, fps = 30, mbps = 24 } = {}) {
    if (S.busy || !S.visual) return;
    S.busy = true; S.exporting = true;
    const bar = $('#progress');
    bar.classList.add('on');
    try {
      await exportLoop({
        canvas, duration: S.duration,
        renderAt: (u) => { setTime(u); post.render(); },
        setSize: (w, h) => { renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
        restore: () => { canvas.style.width = ''; canvas.style.height = ''; renderer.setPixelRatio(RENDER.pixelRatio); resize(); },
      }, { width, height, fps, mbps }, (f) => { $('#progress u').style.width = `${(f * 100).toFixed(1)}%`; }, `choregraphie-${R.seed}.mp4`);
    } catch (e) { toast(`Export impossible : ${e.message}`, 5000); }
    bar.classList.remove('on');
    S.busy = false; S.exporting = false;
  }

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'n') on.random();
    else if (k === ' ') { S.paused = !S.paused; e.preventDefault(); }
    else if (k === 'arrowright' || k === 'arrowleft') { S.paused = true; setTime(S.L + (k === 'arrowright' ? 1 : -1) / 240); }
    else if (k === 'h') document.body.classList.toggle('clean');
    else if (k === 'f') (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
    else if (k === 'e') exportVideo();
    else if (k === 'p') on.exportPNG();
  });

  if (params.has('debug')) window.chor = { S, get R() { return R; }, setTime, render: () => post.render(), renderer, scene, camera, post, load, on };
  load();
}

main();
