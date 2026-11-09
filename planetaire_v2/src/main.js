// Point d'entrée : recherche de l'orbite, scène, boucle de rendu.
//
// La scène : un plateau de laiton qui tourne à ω = p/q sur un pied, dans un
// studio sombre. Sur le plateau, la courbe de la chorégraphie est fixe ; les
// bras de la machine de Fourier tournent à des vitesses entières et portent
// les astres. Dans le studio, les astres suivent donc exactement la solution
// newtonienne. Après q périodes, le plateau a fait p tours : la boucle est
// parfaite.
//
// Paramètres d'URL : ?seed=… (l'orbite), ?period=10 (durée d'une période, en
// secondes), ?debug (outils dans window.chor).
import * as THREE from 'three/webgpu';
import { createPool } from './orbit/client.js';
import { curveAt } from './orbit/action.js';
import { epicycles, sampleCurve } from './scene/epicycles.js';
import { createOrbitVisual } from './scene/orbit3d.js';
import { createMachine, materials, Y_PLATE } from './scene/machine.js';
import { makeEnvironment } from './scene/env.js';
import { createPost } from './render/post.js';
import { exportLoop, exportPNG } from './app/capture.js';
import { createLoader } from './app/loader.js';
import { beatsFor, warp, shotsFor, cameraAt } from './scene/choreo.js';

const TAU = Math.PI * 2;
const params = new URLSearchParams(location.search);
const PERIOD = Number(params.get('period')) || 10;
const DEFAULT_SEED = '17';
const Y_FLOOR = -0.72;
const $ = (s) => document.querySelector(s);
const randomSeed = () => Math.random().toString(36).slice(2, 8);

const RENDER = {
  aa: 'smaa', bloom: true, bloomStrength: 0.09, bloomRadius: 0.4, bloomThreshold: 1.4, hiCap: 6,
  godrays: false, ao: false, dof: true, motionBlur: 0, focus: 3, focusRange: 1.5, bokeh: 1.3,
  toneMapping: 'agx', exposure: 1.0, contrast: 1.12, saturation: 1.05, warmth: 0.1, vignette: 0.45,
  ca: 0.1, grain: 0.035, streaks: 0.1, streakLen: 4, halation: 0.25, dirt: 0.3,
};

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

  // ── Moteur ──
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  try { await renderer.init(); } catch (e) { return loader.error(`Impossible d’initialiser le rendu : ${e.message}`); }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  $('#app').appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050403);
  scene.environment = makeEnvironment('atelier', 0.1, 1024);
  scene.environmentIntensity = 0.45;
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 40);

  // ── Studio : sol de velours, pied, lumières ──
  const mats = materials();
  const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 96), new THREE.MeshStandardNodeMaterial({ color: 0x0d0b09, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = Y_FLOOR; floor.receiveShadow = true;
  scene.add(floor);
  const footH = Y_PLATE - 0.035 - Y_FLOOR;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, footH, 48), mats.brass);
  foot.position.y = Y_FLOOR + footH / 2; foot.castShadow = foot.receiveShadow = true;
  scene.add(foot);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.04, 96), mats.plate);
  base.position.y = Y_FLOOR + 0.02; base.castShadow = base.receiveShadow = true;
  scene.add(base);

  const key = new THREE.SpotLight(0xffe2c0, 6, 0, 0.42, 0.85, 2);
  key.position.set(-2.4, 3.6, 1.7);
  key.target.position.set(0, Y_PLATE, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.01;
  scene.add(key, key.target);
  const rimLight = new THREE.DirectionalLight(0xbcd2ff, 0.5);
  rimLight.position.set(1.8, 1.4, -2.6);
  scene.add(rimLight);

  // le plateau tourne à ω : tout ce qu'il porte est dans le repère de la courbe
  const plate = new THREE.Group();
  scene.add(plate);

  const post = createPost(renderer, scene, camera, null);
  post.update(RENDER, null);

  // ── État ──
  const pool = createPool();
  const S = { seed: '', orbit: null, coef: null, p: null, visual: null, machine: null, q: 1, duration: PERIOD, L: 0, paused: false, busy: false, run: 0 };
  const pos = new Float64Array(2);
  let bodyXY = new Float64Array(2);

  // L ∈ [0, 1) : phase de la boucle (q périodes). Le temps de l'orbite est
  // déformé (ralentis sur les passages serrés) ; la caméra, elle, vit en
  // temps réel.
  const world = [];
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
      S.visual.setBoost(j, 1 + 1.8 * Math.exp(-((d / (1.7 * S.ratio)) ** 2)));
    }
    S.machine.update(tau, bodyXY);
    placeCamera(S.L, open);
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
    const d = Math.hypot(cam.pos[0] - cam.target[0], cam.pos[1] - cam.target[1], cam.pos[2] - cam.target[2]);
    post.U.focus.value = d;
    post.U.focusRange.value = 0.55 * d;
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
    $('#seed').textContent = `graine ${S.seed}`;
  }

  async function load(seed) {
    const run = ++S.run;
    S.busy = true;
    loader.show();
    const T = { t0: performance.now() };
    S.timing = T;
    const r = await pool.search(seed, { onSnap: (i, s) => loader.snap(i, s), onTry: (i) => loader.drop(i) });
    if (run !== S.run) return;
    if (!r.ok) {
      loader.error(`Aucune orbite pour la graine « ${seed} » : une autre graine…`);
      setTimeout(() => run === S.run && load(randomSeed()), 1400);
      return;
    }
    T.search = performance.now() - T.t0;
    const o = r.orbit, p = o.params, k = 1 / o.info.size;
    // l'orbite, ramenée à une taille 1
    const coef = Float64Array.from(o.coef, (v) => v * k);
    if (S.visual) { plate.remove(S.visual.group, S.machine.group); S.visual.dispose(); S.machine.dispose(); }
    const curve = sampleCurve(coef, p, 2400);
    const epi = epicycles(coef, p, 1, { tol: 0.003, max: 8 });
    S.visual = createOrbitVisual({ curve, N: p.N });
    S.machine = createMachine({ arms: epi.arms, N: p.N, mats });
    plate.add(S.machine.group, S.visual.group);
    Object.assign(S, { seed, orbit: o, coef, p, q: p.omegaFrac[1], arms: epi.arms.length, ratio: o.info.ratio });
    S.duration = S.q * PERIOD;
    S.beats = beatsFor(coef, p, S.q, seed);
    S.shots = shotsFor(seed, S.duration, p.N);
    bodyXY = new Float64Array(2 * p.N);
    const url = new URL(location.href);
    url.searchParams.set('seed', seed); history.replaceState(null, '', url);
    caption();
    setTime(0);
    T.build = performance.now() - T.t0 - T.search;
    // quelques images pour compiler les matériaux derrière l'écran
    for (let i = 0; i < 3; i++) { await post.render(); await new Promise((res) => requestAnimationFrame(res)); if (!i) T.first = performance.now() - T.t0; }
    T.total = performance.now() - T.t0;
    if (run !== S.run) return;
    loader.hide();
    S.busy = false;
    const st = await pool.stability(o);
    if (run !== S.run) return;
    o.rho = st.rho;
    caption();
  }

  // ── Boucle ──
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!S.paused && S.visual) setTime(S.L + dt / S.duration);
    post.render();
  }
  requestAnimationFrame(frame);

  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);

  // ── Commandes ──
  async function exportVideo() {
    if (S.busy || !S.visual) return;
    S.busy = true; const was = S.paused; S.paused = true;
    const bar = $('#progress');
    bar.classList.add('on');
    try {
      await exportLoop({
        canvas, duration: S.duration,
        renderAt: (u) => { setTime(u); post.render(); },
        setSize: (w, h) => { renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
        restore: () => { canvas.style.width = ''; canvas.style.height = ''; renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); resize(); },
      }, { width: 1920, height: 1080, fps: 30, mbps: 24 }, (f) => { $('#progress u').style.width = `${(f * 100).toFixed(1)}%`; }, `choregraphie-${S.seed}.mp4`);
    } catch (e) { toast(`Export impossible : ${e.message}`, 5000); }
    bar.classList.remove('on');
    S.paused = was; S.busy = false;
  }

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'n') load(randomSeed());
    else if (k === ' ') { S.paused = !S.paused; e.preventDefault(); }
    else if (k === 'arrowright' || k === 'arrowleft') { S.paused = true; setTime(S.L + (k === 'arrowright' ? 1 : -1) / 240); }
    else if (k === 'h') document.body.classList.toggle('clean');
    else if (k === 'f') (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
    else if (k === 'e') exportVideo();
    else if (k === 'p') exportPNG(canvas, () => post.render(), `choregraphie-${S.seed}.png`);
  });

  if (params.has('debug')) window.chor = { S, setTime, render: () => post.render(), renderer, scene, camera, post, load };
  load(params.get('seed') || DEFAULT_SEED);
}

main();
