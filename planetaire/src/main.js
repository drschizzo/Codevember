import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSim, M, L, NR, R_IN, R_OUT, R_GRID, M_EARTH } from './sim.js';
import { createVisuals } from './visuals.js';
import { Sonifier } from './audio.js';
import { provenanceRGB, css } from './palette.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

async function main() {
  if (!navigator.gpu) return fail('WebGPU n’est pas disponible dans ce navigateur.');

  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.1;
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) return fail('Cette expérience nécessite WebGPU (pas de repli WebGL).');
  $('#app').appendChild(renderer.domElement);
  renderer.backend.device.lost.then((info) => {
    console.error('GPU perdu :', info.message);
    if (info.reason !== 'destroyed') fail('Le GPU a été réinitialisé (' + info.message + '). Rechargez la page, éventuellement avec moins de grains : ?n=262144');
    else fail('Le GPU a été perdu. Rechargez la page, éventuellement avec moins de grains : ?n=262144');
    $('#intro').classList.remove('gone');
  });


  const N = Math.max(4096, Math.round((Number(params.get('n')) || (1 << 20)) / 256) * 256);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010103);
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 2000);
  camera.position.set(0, 6.5, 12.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 0.6;
  controls.maxDistance = 70;

  const sim = createSim(renderer, N);
  await sim.init();
  const vis = createVisuals(renderer, scene, camera, sim);
  const audio = new Sonifier();

  // ── État ───────────────────────────────────────────────────────────────────
  const state = {
    paused: false, speed: 1, simTime: 0, nextLayer: 0,
    planets: [], layers: null, selected: -1, autoSelect: true,
    fly: null, lastCount: 0, needle: null, fps: 60,
  };
  const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
  const warp = Math.max(1, Math.min(16, Number(params.get('warp')) || 1)); // avance rapide (debug)

  // ── Interaction ────────────────────────────────────────────────────────────
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const onPlane = (e) => {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, hit) ? hit : null;
  };

  const wellMarker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.21, 64), new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide }));
  wellMarker.material.color.setRGB(0.6, 0.9, 1.6);
  wellMarker.rotation.x = -Math.PI / 2;
  wellMarker.visible = false;
  scene.add(wellMarker);

  let well = false, downAt = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => {
    downAt = [e.clientX, e.clientY];
    if (e.shiftKey) {
      well = true; controls.enabled = false;
      const p = onPlane(e);
      if (p) { sim.U.wellPos.value.copy(p); wellMarker.position.copy(p); }
      sim.U.wellMass.value = 0.015;
      wellMarker.visible = true;
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (!well) return;
    const p = onPlane(e);
    if (p) { sim.U.wellPos.value.copy(p); wellMarker.position.copy(p); }
  });
  addEventListener('pointerup', (e) => {
    if (well) { well = false; controls.enabled = true; sim.U.wellMass.value = 0; wellMarker.visible = false; return; }
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4 && e.target === el) pick(e);
    downAt = null;
  });
  el.addEventListener('dblclick', (e) => {
    const p = onPlane(e);
    if (!p) return;
    const r = Math.hypot(p.x, p.z);
    if (r < R_IN * 1.3 || r > R_OUT * 1.1) return;
    const free = freeSlot();
    if (free < 0) return toast('Plus de place pour de nouveaux embryons.');
    sim.spawn(free, p, 0.15 * M_EARTH);
    state.reserved.add(free);
    toast(`Embryon semé à ${r.toFixed(2)} UA`);
  });
  state.reserved = new Set();
  function freeSlot() {
    for (let i = 0; i < M; i++) {
      if (state.reserved.has(i)) continue;
      if (!state.planets.some((p) => p.index === i)) return i;
    }
    return -1;
  }

  function pick(e) {
    let best = -1, bd = 22;
    const v = new THREE.Vector3();
    for (const p of state.planets) {
      v.set(p.x, p.y, p.z).project(camera);
      const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
      const d = Math.hypot(sx - e.clientX, sy - e.clientY);
      if (d < bd) { bd = d; best = p.index; }
    }
    if (best >= 0) select(best);
  }
  function select(i) {
    state.selected = i; state.autoSelect = false;
    vis.V.selected.value = i;
  }

  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    switch (e.key.toLowerCase()) {
      case ' ': state.paused = !state.paused; toast(state.paused ? 'Pause' : 'Lecture'); e.preventDefault(); break;
      case 'e': launchFlyby(); break;
      case 'c': {
        const m = (vis.V.colorMode.value + 1) % 3;
        vis.V.colorMode.value = m;
        toast(['Couleur : provenance', 'Couleur : roche / glace', 'Couleur : température'][m]);
        break;
      }
      case 'm': audio.setMuted(!audio.muted); toast(audio.muted ? 'Son coupé' : 'Son actif'); break;
      case 'h': $('#help').classList.toggle('hidden'); break;
      case 'a': state.autoSelect = true; toast('Sélection automatique'); break;
      case '+': case '=': setSpeed(1); break;
      case '-': setSpeed(-1); break;
      case 'p': {
        const i = sim.U.migK.value > 0 ? 0 : 2.0e-3;
        sim.U.migK.value = i;
        toast(i ? 'Migration planétaire : active' : 'Migration planétaire : inactive');
        break;
      }
    }
  });
  function setSpeed(d) {
    const k = Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(state.speed) + d));
    state.speed = SPEEDS[k];
    sim.U.dt.value = 0.004 * state.speed;
    toast(`Vitesse ×${state.speed}`);
  }

  function launchFlyby() {
    if (state.fly) return;
    const th = Math.random() * Math.PI * 2, incl = (Math.random() - 0.5) * 0.6;
    const dir = new THREE.Vector3(Math.cos(th), Math.sin(incl), Math.sin(th)).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const q = 6.5 + Math.random() * 4;
    state.fly = { dir, start: side.multiplyScalar(q).addScaledVector(dir, -45), v: 1.1, t: 0 };
    sim.U.flyMass.value = 0.25;
    vis.flyStar.visible = true;
    toast('Une étoile vagabonde traverse le système…');
    audio.gong(0.5);
  }
  function updateFlyby(dt) {
    const f = state.fly;
    if (!f) return;
    f.t += dt;
    const p = f.start.clone().addScaledVector(f.dir, f.v * f.t);
    sim.U.flyPos.value.copy(p);
    vis.flyStar.position.copy(p);
    if (f.v * f.t > 90) {
      state.fly = null; sim.U.flyMass.value = 0; sim.U.flyPos.value.set(1e4, 0, 0); vis.flyStar.visible = false;
    }
  }

  // ── Lectures GPU → CPU (petites, asynchrones, jamais bloquantes) ──────────
  const busy = { e: false, l: false, n: false };
  const timers = { e: 0, l: 0, n: 0 };
  function poll(now) {
    if (!busy.e && now - timers.e > 150) {
      busy.e = true; timers.e = now;
      sim.readEmbryos().then(onEmbryos).finally(() => (busy.e = false));
    }
    if (!busy.l && now - timers.l > 500) {
      busy.l = true; timers.l = now;
      sim.readLayers().then((l) => { state.layers = l; drawCut(); }).finally(() => (busy.l = false));
    }
    if (!busy.n && now - timers.n > 60) {
      busy.n = true; timers.n = now;
      sim.readNeedle().then((n) => {
        state.needle = n;
        if (!state.paused) audio.updateDisk(n, nUsed);
        drawGroove();
      }).finally(() => (busy.n = false));
    }
  }
  const nUsed = Math.floor(((R_OUT - R_IN) / (R_GRID - R_IN)) * NR);

  const RATIOS = [[2, 1], [3, 2], [4, 3], [5, 3], [5, 4], [3, 1]];
  function onEmbryos({ pos, tot, info }) {
    const pl = [];
    for (let i = 0; i < M; i++) {
      const m = pos[i * 4 + 3];
      if (m <= 0) continue;
      state.reserved.delete(i);
      const x = pos[i * 4], y = pos[i * 4 + 1], z = pos[i * 4 + 2];
      const ice = tot[i * 4] / m, meanR = tot[i * 4 + 1] / m;
      pl.push({
        index: i, x, y, z, a: Math.hypot(x, z), m, mE: m / M_EARTH,
        ice, meanR, rate: tot[i * 4 + 2], impacts: tot[i * 4 + 3], nLayers: info[i * 4 + 3],
        color: provenanceRGB(meanR), res: [],
      });
    }
    // Résonances de moyen mouvement entre voisines (rapport des périodes)
    const big = pl.filter((p) => p.mE > 0.3).sort((a, b) => a.a - b.a);
    for (let k = 0; k + 1 < big.length; k++) {
      const P = Math.pow(big[k + 1].a / big[k].a, 1.5);
      for (const [p, q] of RATIOS) {
        if (Math.abs(P / (p / q) - 1) < 0.006) {
          big[k].res.push(`${p}:${q}`); big[k + 1].res.push(`${p}:${q}`);
          big[k].resonant = big[k + 1].resonant = true;
        }
      }
    }
    if (state.lastCount && pl.length < state.lastCount && !state.paused) audio.gong(1);
    state.lastCount = pl.length;

    if (state.autoSelect || !pl.some((p) => p.index === state.selected)) {
      const heavy = pl.reduce((a, b) => (b.m > (a?.m ?? 0) ? b : a), null);
      state.selected = heavy ? heavy.index : -1;
      vis.V.selected.value = state.selected;
    }
    for (const p of pl) p.selected = p.index === state.selected;
    state.planets = pl;
    vis.updateOrbits(pl.filter((p) => p.mE > 0.3 || p.selected));
    if (!state.paused) audio.updatePlanets(pl);
    renderList();
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  const NAMES = 'Aube Brume Cendre Dune Écume Faille Givre Houle Iris Jade Kaolin Lave Mica Nacre Onyx Perle Quartz Rouille Sel Talc Ulve Vesta Wolfram Xénon Yule Zircon Ambre Basalte Corail Diorite Éther Fusain'.split(' ');
  const nameOf = (i) => NAMES[i % NAMES.length] + (i >= NAMES.length ? ' II' : '');

  function renderList() {
    const tops = [...state.planets].sort((a, b) => b.m - a.m).slice(0, 8).sort((a, b) => a.a - b.a);
    $('#list').innerHTML = tops.map((p) => `
      <li class="${p.selected ? 'sel' : ''}" data-i="${p.index}">
        <span class="dot" style="background:${css(p.color)}"></span>
        <span class="nm">${nameOf(p.index)}</span>
        <span class="num">${p.a.toFixed(2)} UA</span>
        <span class="num">${fmtMass(p.mE)}</span>
        <span class="chips">${[...new Set(p.res)].map((r) => `<b>${r}</b>`).join('')}</span>
      </li>`).join('');
    const total = state.planets.reduce((s, p) => s + p.mE, 0);
    $('#stats').innerHTML = `
      <div><span>temps</span>${(state.simTime / (2 * Math.PI)).toFixed(1)} orbites à 1 UA</div>
      <div><span>planètes</span>${state.planets.filter((p) => p.mE > 0.3).length} / ${state.planets.length} embryons</div>
      <div><span>masse accrétée</span>${fmtMass(total)}</div>
      <div><span>poussière</span>${(N / 1e6).toFixed(2)} M grains · ${state.fps.toFixed(0)} i/s</div>`;
  }
  $('#list').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li) select(Number(li.dataset.i));
  });
  const fmtMass = (mE) => (mE >= 30 ? `${(mE / 317.8).toFixed(2)} M<sub>J</sub>` : `${mE.toFixed(mE < 1 ? 2 : 1)} M⊕`);

  // Coupe stratigraphique de la planète sélectionnée
  const cut = $('#cut'), cctx = cut.getContext('2d');
  function drawCut() {
    const dpr = Math.min(devicePixelRatio, 2);
    const W = cut.clientWidth, H = cut.clientHeight;
    if (cut.width !== W * dpr) { cut.width = W * dpr; cut.height = H * dpr; }
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.clearRect(0, 0, W, H);
    const p = state.planets.find((q) => q.index === state.selected);
    const info = $('#cutinfo');
    if (!p || !state.layers) { info.textContent = ''; return; }
    const n = Math.max(1, Math.min(L, Math.round(p.nLayers)));
    const layers = [];
    for (let k = 0; k < n; k++) {
      const o = (p.index * L + k) * 4;
      layers.push({ m: state.layers[o], ice: state.layers[o + 1], r: state.layers[o + 2], type: state.layers[o + 3] });
    }
    const total = layers.reduce((s, l) => s + l.m, 0) || 1;
    const cx = W / 2, cy = H / 2 + 6, Rmax = Math.min(W, H) * 0.4;
    const colorOf = (l, k = 1) => {
      const c = provenanceRGB(l.r).map((v) => v * (1 - l.ice * 0.35) + l.ice * 0.35 * 0.95);
      if (l.type === 2) return css(c.map((v) => v * 0.55), k);
      return css(c, k);
    };

    // moitié gauche : surface éclairée
    const outer = layers[layers.length - 1];
    const g = cctx.createRadialGradient(cx - Rmax * 0.55, cy - Rmax * 0.35, Rmax * 0.05, cx, cy, Rmax);
    g.addColorStop(0, colorOf(outer, 1.25));
    g.addColorStop(0.7, colorOf(outer, 0.45));
    g.addColorStop(1, 'rgb(5,5,10)');
    cctx.beginPath(); cctx.arc(cx, cy, Rmax, Math.PI / 2, Math.PI * 1.5); cctx.closePath();
    cctx.fillStyle = g; cctx.fill();

    // moitié droite : strates, du centre (premières accrétions) vers la surface
    let cum = total;
    for (let k = n - 1; k >= 0; k--) {
      const l = layers[k];
      const R = Rmax * Math.cbrt(cum / total);
      cctx.beginPath(); cctx.moveTo(cx, cy); cctx.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2); cctx.closePath();
      cctx.fillStyle = colorOf(l, 0.95);
      cctx.fill();
      cctx.strokeStyle = l.type === 1 ? 'rgba(255,170,90,0.95)' : 'rgba(0,0,0,0.35)';
      cctx.lineWidth = l.type === 1 ? 1.6 : 0.6;
      cctx.beginPath(); cctx.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2); cctx.stroke();
      cum -= l.m;
    }
    cctx.strokeStyle = 'rgba(255,255,255,0.25)';
    cctx.beginPath(); cctx.moveTo(cx, cy - Rmax - 4); cctx.lineTo(cx, cy + Rmax + 4); cctx.stroke();

    info.innerHTML = `<b>${nameOf(p.index)}</b> · ${fmtMass(p.mE)} · ${p.a.toFixed(2)} UA<br>
      glace ${(p.ice * 100).toFixed(0)} % · matière née en moyenne à ${p.meanR.toFixed(2)} UA<br>
      ${n} strates · ${p.impacts.toFixed(0)} impact${p.impacts >= 2 ? 's' : ''} géant${p.impacts >= 2 ? 's' : ''}${p.res.length ? ' · résonance ' + [...new Set(p.res)].join(', ') : ''}`;
  }

  // Sillon : densité sous la tête de lecture, en fonction du rayon
  const gr = $('#groove'), gctx = gr.getContext('2d');
  function drawGroove() {
    const dpr = Math.min(devicePixelRatio, 2);
    const W = gr.clientWidth, H = gr.clientHeight;
    if (gr.width !== W * dpr) { gr.width = W * dpr; gr.height = H * dpr; }
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gctx.clearRect(0, 0, W, H);
    const d = state.needle;
    if (!d) return;
    let mx = 1e-6;
    for (let i = 0; i < nUsed; i++) mx = Math.max(mx, d[i]);
    const bw = W / nUsed;
    for (let i = 0; i < nUsed; i++) {
      const r = R_IN + (i + 0.5) * (R_GRID - R_IN) / NR;
      const v = Math.pow(d[i] / mx, 0.6);
      gctx.fillStyle = css(provenanceRGB(r), 0.35 + v * 0.9);
      const h = Math.max(1, v * (H - 14));
      gctx.fillRect(i * bw, H - 12 - h, Math.max(1, bw - 0.5), h);
    }
    for (const p of state.planets) {
      if (p.mE < 0.3) continue;
      const x = ((p.a - R_IN) / (R_OUT - R_IN)) * W;
      gctx.fillStyle = p.selected ? '#bfe9ff' : 'rgba(255,255,255,0.55)';
      gctx.beginPath(); gctx.arc(x, H - 5, p.selected ? 3 : 2, 0, Math.PI * 2); gctx.fill();
    }
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
  }

  $('#enter').addEventListener('click', () => {
    audio.start();
    $('#intro').classList.add('gone');
  });
  $('#enter-silent').addEventListener('click', () => $('#intro').classList.add('gone'));

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ── Boucle ─────────────────────────────────────────────────────────────────
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    state.fps = state.fps * 0.95 + (1 / Math.max(real, 1e-3)) * 0.05;
    controls.update();
    if (!state.paused) {
      const dtSim = sim.U.dt.value * sim.substeps * warp;
      state.simTime += dtSim;
      sim.U.frameDt.value = dtSim / warp;
      const tick = state.simTime >= state.nextLayer;
      if (tick) state.nextLayer = state.simTime + 2.5;
      updateFlyby(dtSim);
      for (let w = 0; w < warp; w++) sim.step(tick && w === 0);
    }
    vis.pipeline.render();
    poll(now);
  });

  if (params.has('auto')) { $('#intro').classList.add('gone'); }
  window.__planetaire = { sim, state, renderer, launchFlyby };
}

function fail(msg) {
  $('#intro').innerHTML = `<div class="card"><h1>Planétaire</h1><p>${msg}</p><p class="dim">Essayez Chrome, Edge ou Safari récents.</p></div>`;
}

main().catch((e) => { console.error(e); fail('Erreur d’initialisation : ' + e.message); });
