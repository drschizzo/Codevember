// Point d'entrée : recette, recherche des orbites, mondes emboîtés, plongée,
// panneau, boucle de rendu.
//
// La plongée. Chaque astre est une boule de verre qui contient le même monde
// (sa machine, son sol, son studio), réduit d'un facteur k : la plongée est
// auto-similaire, infinie. Trois exemplaires du monde sont emboîtés (le
// courant, celui de la boule visée, celui de sa boule) ; τ avance d'une couche
// par segment, et la boucle dure un segment.
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
import { createWorld } from './scene/world.js';
import { createPost } from './render/post.js';
import { exportLoop, exportPNG } from './app/capture.js';
import { createLoader } from './app/loader.js';
import { createUI } from './app/ui.js';
import { loadRender, saveRender, applyQuality, defaultsFor, SHADOWS } from './app/settings.js';
import { wantsMobile, switchMobile, createGovernor, createPacer, bindTouch } from './app/mobile.js';
import { generate, generateLayer, upgrade, orbitOverrides, packRecipe, unpackRecipe, MOODS } from './recipe.js';
import { createRng } from './rng.js';

const TAU = Math.PI * 2;
const params = new URLSearchParams(location.search);
const DEFAULT_SEED = '17';
const $ = (s) => document.querySelector(s);
const randomSeed = () => Math.random().toString(36).slice(2, 8);
const ss5 = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (t * 6 - 15) + 10); };
const MAX_BODIES = 9;

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
  // ── Version mobile (fixée au chargement) ──
  const LITE = wantsMobile(params);
  if (LITE) document.body.classList.add('lite');
  const RENDER = loadRender(LITE);
  const S = { worlds: [], k: [], target: [], tau: 0, paused: false, busy: true, run: 0, exporting: false, root: -1 };
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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  $('#app').appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050403);
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.01, 60);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false; controls.enableDamping = true;
  controls.target.set(0, -0.16, 0);
  const root = new THREE.Group(); // reçoit la similitude de la plongée
  scene.add(root);

  // lumières des astres : un jeu fixe (pas de recompilation des matériaux quand
  // le nombre d'astres change), placé sur les boules du monde courant, puis
  // passé à celles du monde suivant à la fin de la plongée
  const bodyLights = Array.from({ length: MAX_BODIES }, () => { const l = new THREE.PointLight(0xffc489, 0, 0, 2); root.add(l); return l; });

  const post = createPost(renderer, scene, camera, null);

  // ── Recette ──
  let R = null;
  if (location.hash.startsWith('#r=')) {
    try { R = upgrade(await unpackRecipe(location.hash.slice(3))); } catch { R = null; }
  }
  R ??= generate(params.get('seed') || DEFAULT_SEED);
  // trois exemplaires du même monde (la couche m de la recette, ici une seule)
  const INST = 3;
  const M = () => INST;
  const layerOf = (m) => m % R.layers.length;
  const layerSeed = (m) => (layerOf(m) ? `${R.seed}/${layerOf(m)}` : R.seed);

  // (mobile : moins de workers, la recherche ne doit pas étouffer le rendu)
  const pool = createPool(LITE ? Math.max(2, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)) : undefined);
  const orbits = [];

  // ── caméra de base d'une couche : périodique en u (même pose à u = 0 et 1)
  // distance qui cadre le plateau (rayon pr) en largeur comme en hauteur
  const fitFor = (pr = 1.6) => {
    const vf = (30 * Math.PI) / 360, hf = Math.atan(Math.tan(vf) * camera.aspect);
    return (pr + 0.05) / Math.tan(Math.min(vf * 1.25, hf));
  };
  function poseParams(m, u) {
    const c = R.layers[layerOf(m)].camera;
    return { az: c.az + c.sweep * Math.sin(TAU * u), el: c.el + 0.06 * Math.cos(TAU * u) };
  }
  // pose de la caméra ; pendant la plongée, elle glisse de l'angle de la couche
  // courante (a) vers celui de la suivante (b), pour arriver exactement sur la
  // pose de départ de b
  function basePose(m, u, next = null, s = 0) {
    const A = poseParams(m, u);
    let { az, el } = A;
    if (next !== null && s > 0) {
      const B = poseParams(next, u - 1);
      const dAz = Math.atan2(Math.sin(B.az - A.az), Math.cos(B.az - A.az));
      az = A.az + dAz * s; el = A.el + (B.el - A.el) * s;
    }
    // la caméra reste dans la coque du monde (rayon RG) : au-delà, on élargit le champ
    // (cadrage serré : la machine et le début de la couronne)
    const pr = S.worlds[m] ? S.worlds[m].machine.bezelR * 0.82 : 1.6;
    const prN = next !== null && S.worlds[next] ? S.worlds[next].machine.bezelR * 0.82 : pr;
    const want = fitFor(pr + (prN - pr) * s), r = Math.min(want, 4.3);
    const pos = new THREE.Vector3(Math.cos(az) * Math.cos(el) * r, -0.16 + Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r);
    return { pos, target: new THREE.Vector3(0, -0.16, 0), fov: want > 4.3 ? 30 * (want / 4.3) : 30 };
  }

  // ── construction des mondes (après la recherche des orbites)
  function buildWorlds() {
    for (const W of S.worlds) { W.group.removeFromParent(); W.dispose(); }
    const sh = SHADOWS[RENDER.shadows] || SHADOWS.high;
    S.worlds = Array.from({ length: INST }, (_, m) => createWorld({ orbit: orbits[layerOf(m)], L: R.layers[layerOf(m)], lite: LITE, shadows: sh, seed: layerSeed(m) }));
    S.k = S.worlds.map((W, m) => W.setNext(S.worlds[(m + 1) % M()]));
    // boule visée : la plus proche de la caméra au début de la plongée
    S.target = S.worlds.map((W, m) => {
      const h = R.motion.hold;
      W.update(h);
      const cam = basePose(m, h).pos;
      let best = 0, bd = Infinity;
      W.local.forEach((p, j) => { const d = p.distanceTo(cam); if (d < bd) { bd = d; best = j; } });
      return best;
    });
    S.root = -1;
    applyLive();
  }

  // ── la plongée : état complet à l'instant τ (pure fonction de τ)
  const tmp = new THREE.Vector3(), col = new THREE.Color();
  function setTime(tau) {
    const Mn = M();
    S.tau = ((tau % Mn) + Mn) % Mn;
    if (!S.worlds.length) return;
    const d = Math.floor(S.tau), u = S.tau - d;
    const a = d % Mn, b = (d + 1) % Mn, c = (d + 2) % Mn;
    const Wa = S.worlds[a], Wb = S.worlds[b], Wc = S.worlds[c];
    // emboîtement : b dans la boule visée de a, c dans celle de b
    if (S.root !== a) {
      S.root = a;
      for (const W of S.worlds) W.group.removeFromParent();
      for (const W of S.worlds) for (const G of W.globes) if (G.mini) G.mini.visible = true;
      root.add(Wa.group); Wa.group.scale.setScalar(1);
      const Ga = Wa.globes[S.target[a]], Gb = Wb.globes[S.target[b]];
      Ga.inner.add(Wb.group); Wb.group.scale.setScalar(S.k[a]); Ga.mini.visible = false;
      if (Mn > 2) { Gb.inner.add(Wc.group); Wc.group.scale.setScalar(S.k[b]); Gb.mini.visible = false; }
      scene.background.copy(Wa.bg);
      caption();
      applyLive();
    }
    Wa.update(u);
    Wb.update(u - 1);
    if (Mn > 2) Wc.update(u - 2);
    // similitude : zoom de point fixe la boule visée
    const h = R.motion.hold, s = ss5((u - h) / (1 - h)), k = S.k[a];
    const p = Wa.local[S.target[a]];
    const ks = Math.pow(k, s), tr = tmp.copy(p).multiplyScalar((1 - ks) / (1 - k));
    root.scale.setScalar(1 / ks);
    root.position.copy(tr).multiplyScalar(-1 / ks);
    // échelle de chaque monde dans l'image : lumières à l'échelle
    const sa = 1 / ks, sb = k / ks;
    Wa.setScale(sa); Wb.setScale(sb); if (Mn > 2) Wc.setScale(sb * S.k[b]);
    // lumières des astres : celles du monde courant s'éteignent quand on entre
    // dans la boule, celles du monde suivant s'allument (positions dans le repère de la racine)
    const handoff = s > 0.85;
    const W = handoff ? Wb : Wa, fade = handoff ? ss5((s - 0.85) / 0.15) : 1 - ss5((s - 0.7) / 0.15);
    const base = W.L.bodies.light * (handoff ? sb * sb : sa * sa) * fade;
    col.set(W.L.bodies.color);
    for (let j = 0; j < MAX_BODIES; j++) {
      const l = bodyLights[j];
      if (j >= W.N) { l.intensity = 0; continue; }
      if (handoff) l.position.copy(W.local[j]).multiplyScalar(k).add(p); else l.position.copy(W.local[j]);
      l.intensity = base * W.flare[j];
      l.color.copy(col);
    }
    // caméra (fixe dans l'image, pose de base de la couche) ; mise au point
    // sur la machine, puis sur la boule visée
    if (!R.motion.free) {
      const pose = basePose(a, u, b, s);
      camera.position.copy(pose.pos); camera.lookAt(pose.target);
      if (Math.abs(camera.fov - pose.fov) > 1e-4) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
      const g = new THREE.Vector3().copy(p).sub(tr).multiplyScalar(1 / ks); // boule visée, dans l'image
      const focusPt = pose.target.clone().lerp(g, ss5(s * 3));
      post.U.focus.value = camera.position.distanceTo(focusPt);
      post.U.focusRange.value = RENDER.focusSpread * post.U.focus.value;
    }
  }

  // ── Réglages à vif
  function applyLive() {
    const Wa = S.worlds[Math.max(0, S.root)];
    if (Wa) post.U.warmth.value = RENDER.warmth + Wa.L.light.warmth;
  }
  function applyRender() {
    if (!RENDER.dynRes) governor.reset();
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(innerWidth, innerHeight);
    post.update({ ...RENDER, lite: LITE, focus: post.U.focus.value, focusRange: post.U.focusRange.value, warmth: RENDER.warmth }, null);
    applyLive();
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

  // ── recherche des orbites de toutes les couches (sous les yeux), puis les mondes
  async function load(only = null) {
    const run = ++S.run;
    S.busy = true;
    loader.show();
    for (let m = 0; m < R.layers.length; m++) {
      if (only !== null && m !== only && orbits[m]) continue;
      loader.text(R.layers.length > 1 ? `couche ${m + 1} / ${R.layers.length} : recherche d’une orbite…` : 'recherche d’une orbite…');
      let seed = layerSeed(m), r = null;
      for (let tries = 0; tries < 6; tries++) {
        r = await pool.search(seed, { over: { ...orbitOverrides(R.layers[m]), maxArms: 14 }, onSnap: (i, sn) => loader.snap(i, sn), onTry: (i) => loader.drop(i) });
        if (run !== S.run) return;
        if (r.ok) break;
        seed = `${seed}+`;
      }
      if (!r.ok) { loader.error('Aucune orbite avec ces contraintes.'); return; }
      orbits[m] = r.orbit;
    }
    const url = new URL(location.href);
    url.searchParams.set('seed', R.seed); url.hash = ''; history.replaceState(null, '', url);
    loader.text('construction des machines…');
    await new Promise((res) => setTimeout(res, 0));
    buildWorlds();
    ui?.build();
    setTime(S.tau);
    for (let i = 0; i < 3; i++) { await post.render(); await new Promise((res) => requestAnimationFrame(res)); }
    if (run !== S.run) return;
    loader.hide();
    S.busy = false;
  }

  // ── Panneau ──
  const on = {
    random: () => { R = generate(randomSeed()); orbits.length = 0; S.tau = 0; ui?.build(); load(); },
    regenerate: (seed) => { R = generate(seed || randomSeed()); orbits.length = 0; S.tau = 0; ui?.build(); load(); },
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
    exportPNG: () => exportPNG(canvas, () => post.render(), `choregraphie-${R.seed}.png`),
  };
  let rebuildTimer = 0;
  function rebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => { if (orbits.length >= R.layers.length && orbits.slice(0, R.layers.length).every(Boolean)) { buildWorlds(); setTime(S.tau); } }, 80);
  }
  const ui = params.get('ui') === '0' ? null : createUI({ recipe: () => R, render: RENDER, on });
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

  // ── Boucle ──
  let last = performance.now(), frames = 0, fpsT = last;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!pace(now)) return; // (écrans 90 / 120 Hz : cadence plafonnée)
    const dt0 = (now - last) / 1000, dt = Math.min(0.1, dt0); last = now;
    if (RENDER.dynRes && !S.busy) governor.frame(dt0);
    if (!S.paused && S.worlds.length && !S.exporting) setTime(S.tau + dt / R.motion.segment);
    if (R.motion.free) controls.update();
    post.render();
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
        renderAt: (v) => { setTime(v * R.layers.length); post.render(); },
        setSize: (w, h) => { renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
        restore: () => { canvas.style.width = ''; canvas.style.height = ''; resize(); },
      }, { width, height, fps, mbps }, (f) => { $('#progress u').style.width = `${(f * 100).toFixed(1)}%`; }, `choregraphie-${R.seed}.mp4`);
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

  if (params.has('debug')) window.chor = { S, get R() { return R; }, setTime, render: () => post.render(), renderer, scene, camera, controls, post, load, on, root };
  load();
}

main();
