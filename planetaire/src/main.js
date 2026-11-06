import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSim, M, L, NR, R_IN, R_OUT, R_GRID, M_EARTH, SOLID0, GAS0, NIMP } from './sim.js';
import { createLifecycle, PHASES } from './lifecycle.js';
import { createVisuals } from './visuals.js';
import { Sonifier, noteName } from './audio.js';
import { provenanceRGB, css } from './palette.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

async function main() {
  if (!navigator.gpu) return fail('WebGPU n’est pas disponible dans ce navigateur.');

  // ?prof : chronométrage GPU (requêtes d'horodatage) affiché dans la console
  const PROF = params.has('prof');
  // Écran HDR (EDR sur Mac, HDR sous Windows) : sortie en virgule flottante sur
  // un canevas « extended » — les hautes lumières (étoile, éclairs, supernova)
  // dépassent le blanc de l'interface. ?sdr force le rendu classique.
  const HDR = !params.has('sdr') && (params.has('hdr') || matchMedia('(dynamic-range: high)').matches);
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance', trackTimestamp: PROF,
    ...(HDR ? { outputType: THREE.HalfFloatType } : {}) });
  const MAX_PR = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(MAX_PR);
  renderer.setSize(innerWidth, innerHeight);
  // SDR : Neutral (Khronos) plutôt qu'AgX — garde la teinte des couleurs vives
  // (géante rouge, rémanent, lave), qu'AgX délave vers le blanc.
  // HDR : courbe maison dans visuals.js (épaule douce jusqu'au pic de l'écran).
  renderer.toneMapping = HDR ? THREE.NoToneMapping : params.has('agx') ? THREE.AgXToneMapping : THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1; // (l'exposition est appliquée dans visuals.js)
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
  camera.position.set(0, 13, 30); // vue large : le nuage fait ~14 UA de rayon
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 0.6;
  controls.maxDistance = 70;

  const sim = createSim(renderer, N);
  await sim.init();
  const EXPOSURE = Number(params.get('exposure')) || 1.45;
  const vis = createVisuals(renderer, scene, camera, sim, { hdr: HDR });
  const audio = new Sonifier();
  const life = createLifecycle();

  // ── État ───────────────────────────────────────────────────────────────────
  const state = {
    paused: false, speed: 2, simTime: 0, nextLayer: 0,
    planets: [], layers: null, selected: -1, autoSelect: true,
    fly: null, lastCount: 0, needle: null, fps: 60,
  };
  // Au-delà de ×1, on enchaîne plusieurs pas par image (pas plus longs = instable)
  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
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
      case ' ': state.paused = !state.paused; syncSpeedUI(); toast(state.paused ? 'Pause' : 'Lecture'); e.preventDefault(); break;
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
      case '[': seekTo(life.phase - 1); break;
      case ']': seekTo(life.phase + 1); break;
      case 'escape': overview(); break;
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
    setSpeedTo(SPEEDS[k]);
  }
  function setSpeedTo(v) {
    state.speed = v;
    if (state.paused) state.paused = false;
    syncSpeedUI();
    toast(`Vitesse ×${fmtSpeed(v)}`);
  }
  const fmtSpeed = (v) => ({ 0.25: '¼', 0.5: '½' })[v] || String(v);
  const speedEl = $('#speed');
  speedEl.innerHTML = `<button data-v="pause" title="Pause (Espace)">❚❚</button>` +
    SPEEDS.map((v) => `<button data-v="${v}">×${fmtSpeed(v)}</button>`).join('');
  speedEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.v === 'pause') { state.paused = !state.paused; syncSpeedUI(); toast(state.paused ? 'Pause' : 'Lecture'); }
    else setSpeedTo(Number(b.dataset.v));
  });
  function syncSpeedUI() {
    for (const b of speedEl.children) {
      b.classList.toggle('on', b.dataset.v === 'pause' ? state.paused : !state.paused && Number(b.dataset.v) === state.speed);
    }
  }
  syncSpeedUI();


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
  }
  function updateFlyby(dt) {
    const f = state.fly;
    if (!f) return;
    f.t += dt;
    const p = f.start.clone().addScaledVector(f.dir, f.v * f.t);
    sim.U.flyPos.value.copy(p);
    vis.flyStar.position.copy(p);
    audio.flyby(p.length(), screenPan(p.x, p.y, p.z), p.dot(f.dir) < 0);
    if (f.v * f.t > 90) {
      state.fly = null; sim.U.flyMass.value = 0; sim.U.flyPos.value.set(1e4, 0, 0); vis.flyStar.visible = false;
      audio.flyby(null);
    }
  }
  const _v = new THREE.Vector3();
  function screenPan(x, y, z) {
    _v.set(x, y, z).project(camera);
    return Math.max(-1, Math.min(1, _v.x));
  }

  // ── Lectures GPU → CPU (petites, asynchrones, jamais bloquantes) ──────────
  const busy = { e: false, l: false, n: false };
  const timers = { e: 0, l: 0, n: 0 };
  const nUsed = Math.floor(((R_OUT - R_IN) / (R_GRID - R_IN)) * NR);
  const radiusOf = (i) => R_IN + (i + 0.5) * (R_GRID - R_IN) / NR;
  // ── Positions exactes à chaque image ───────────────────────────────────────
  // On relit position + vitesse des embryons à chaque image (2 ko). La lecture
  // arrive avec 1 à 3 images de retard, mais on sait de quel instant elle date :
  // on la propage jusqu'à maintenant (problème à 2 corps, saute-mouton). Sur
  // quelques centièmes d'unité de temps l'erreur est négligeable, d'où une
  // caméra et des effets parfaitement accrochés aux planètes rendues par le GPU.
  const kin = { pos: null, vel: null, t: -1 };
  const pred = new Map(); // index → [x, y, z] à l'instant présent
  let busyK = false;
  function pollKin() {
    if (busyK) return;
    busyK = true;
    const t = state.simTime;
    sim.readKinematics().then((d) => { if (t >= kin.t) { kin.pos = d.pos; kin.vel = d.vel; kin.t = t; } })
      .finally(() => (busyK = false));
  }
  function predictAll() {
    pred.clear();
    if (!kin.pos) return;
    const span = Math.max(0, state.simTime - kin.t);
    const n = Math.min(80, Math.ceil(span / 0.004));
    const h = n ? span / n : 0;
    for (let i = 0; i < M; i++) {
      const o = i * 4;
      if (kin.pos[o + 3] <= 0) continue;
      let x = kin.pos[o], y = kin.pos[o + 1], z = kin.pos[o + 2];
      let vx = kin.vel[o], vy = kin.vel[o + 1], vz = kin.vel[o + 2];
      for (let k = 0; k < n; k++) { // même schéma que le GPU : vitesse puis position
        const r2 = x * x + y * y + z * z, ir3 = 1 / (r2 * Math.sqrt(r2));
        vx -= x * ir3 * h; vy -= y * ir3 * h; vz -= z * ir3 * h;
        x += vx * h; y += vy * h; z += vz * h;
      }
      pred.set(i, [x, y, z]);
    }
  }

  // Une planète croise la tête de lecture (axe +X) → elle joue sa note,
  // s'illumine, et un repère s'allume sur la tête à son rayon.
  const cross = new Map(); // index → { ang, last }
  function detectCrossings() {
    for (const [i, q] of pred) {
      const ang = Math.atan2(q[2], q[0]);
      const c = cross.get(i);
      if (!c) { cross.set(i, { ang, last: -1e9 }); continue; }
      const crossed = c.ang < 0 && ang >= 0 && c.ang > -1.5;
      c.ang = ang;
      if (!crossed) continue;
      const a = Math.hypot(q[0], q[2]);
      if (state.simTime - c.last < Math.PI * Math.pow(a, 1.5)) continue;
      c.last = state.simTime;
      const p = state.planets.find((pp) => pp.index === i);
      if (!p || p.mE < 0.3) continue;
      p.ping = performance.now();
      vis.pulse(i, a, p.selected ? [0.7, 0.95, 1.2] : p.color);
      audio.planetNote({ a, mE: p.mE, gas: p.gasF, selected: p.selected, pan: screenPan(q[0], q[1], q[2]) });
      const dot = listRows.get(i)?.querySelector('.dot');
      if (dot) { dot.classList.remove('ping'); void dot.offsetWidth; dot.classList.add('ping'); }
    }
    for (const i of cross.keys()) if (!pred.has(i)) cross.delete(i);
  }

  function poll(now) {
    pollKin();
    if (!busy.e && now - timers.e > 150) {
      busy.e = true; timers.e = now;
      const tReq = state.simTime; // l'état lu date de la requête : on compensera ce retard
      sim.readEmbryos().then((d) => onEmbryos(d, tReq)).finally(() => (busy.e = false));
    }
    if (!busy.l && now - timers.l > 500) {
      busy.l = true; timers.l = now;
      sim.readLayers().then((l) => { state.layers = l; drawCut(); }).finally(() => (busy.l = false));
    }
    if (!busy.n && now - timers.n > 60) {
      busy.n = true; timers.n = now;
      sim.readNeedle().then((n) => {
        state.needle = n;
        state.active = n[NR];
        state.dustFrac = state.active / N;
        if (!state.paused) audio.updateDisk(n, nUsed, radiusOf, state.dustFrac);
        drawGroove();
      }).finally(() => (busy.n = false));
    }
  }

  // ── Budgets de masse, impacts, planètes ────────────────────────────────────
  Object.assign(state, {
    dustFrac: 1, gasFrac: 1, removedGas: 0, active: N,
    lastSerial: 0, prev: new Map(), slow: 0, shake: 0,
  });

  const RATIOS = [[2, 1], [3, 2], [4, 3], [5, 3], [5, 4], [3, 1]];
  function onEmbryos({ pos, tot, info, gas, impPos, impInfo }, tReq = state.simTime) {
    // Impacts géants survenus depuis la dernière lecture
    const fresh = [];
    for (let k = 0; k < NIMP; k++) {
      const serial = impInfo[k * 4];
      if (serial > state.lastSerial) fresh.push({ serial, h: impInfo[k * 4 + 1], l: impInfo[k * 4 + 3], mlE: impPos[k * 4 + 3] / M_EARTH });
    }
    fresh.sort((a, b) => a.serial - b.serial);
    const absorbed = new Set(fresh.map((f) => f.l));

    const pl = [];
    let sumSolid = 0, sumGas = 0;
    for (let i = 0; i < M; i++) {
      const m = pos[i * 4 + 3];
      if (m <= 0) continue;
      state.reserved.delete(i);
      const x = pos[i * 4], y = pos[i * 4 + 1], z = pos[i * 4 + 2];
      const g = gas[i * 4 + 1], solid = Math.max(m - g, 1e-20);
      sumSolid += solid; sumGas += g;
      const ice = tot[i * 4] / solid, meanR = tot[i * 4 + 1] / solid;
      pl.push({
        index: i, x, y, z, a: Math.hypot(x, z), phi: Math.atan2(z, x), m, mE: m / M_EARTH,
        gasE: g / M_EARTH, gasF: g / m, ice, meanR, rate: tot[i * 4 + 2], impacts: tot[i * 4 + 3], nLayers: info[i * 4 + 3],
        color: provenanceRGB(meanR), res: [],
      });
    }
    // Planètes disparues sans impact : éjectées, tombées dans l'étoile ou
    // englouties par la géante rouge — leur gaz quitte le budget du disque
    const alive = new Set(pl.map((p) => p.index));
    for (const [i, p] of state.prev) {
      if (alive.has(i) || absorbed.has(i)) continue;
      state.removedGas += p.g;
      if (life.p.starR > 0 && p.a < life.p.starR + 0.25) toast(`${nameOf(i)} est engloutie par l’étoile`);
      else if (p.a > 15) toast(`${nameOf(i)} est éjectée du système`);
    }
    state.prev = new Map(pl.map((p) => [p.index, { m: p.m, g: p.gasE * M_EARTH, a: p.a }]));

    // Gaz : réservoir qui se dissipe (photoévaporation, cf. lifecycle) moins
    // ce que les planètes ont capté. (La poussière, elle, est désormais
    // comptée grain par grain : un grain avalé disparaît pour de bon.)
    const gasLeft = Math.max(0, GAS0 * life.gasEnv - (sumGas + state.removedGas));
    state.gasFrac = life.phase < 2 ? 1 : gasLeft / GAS0;
    sim.U.gasAvail.value = life.phase === 2 ? state.gasFrac : 0;

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

    if (state.autoSelect || !pl.some((p) => p.index === state.selected)) {
      const heavy = pl.reduce((a, b) => (b.m > (a?.m ?? 0) ? b : a), null);
      state.selected = heavy ? heavy.index : -1;
      vis.V.selected.value = state.selected;
    }
    for (const p of pl) p.selected = p.index === state.selected;
    state.planets = pl;

    for (const f of fresh) {
      state.lastSerial = f.serial;
      (state.absorbedBy ||= new Map()).set(f.l, f.h);
      const s = pl.find((p) => p.index === f.h);
      if (!s || state.paused || state.seek >= 0) continue;
      vis.impact(f.h, pred.get(f.h) || [s.x, s.y, s.z], f.mlE);
      // l'énergie du choc fond la surface : océan de magma, cratères effacés
      const e = evo.get(f.h);
      if (e) { e.heat = Math.min(1, e.heat + 0.45 + 1.5 * f.mlE / Math.max(s.mE, 0.05)); e.craters *= 0.15; }
      audio.impact(f.mlE, s.a, screenPan(s.x, s.y, s.z));
      // ralenti, secousse et éblouissement proportionnés à l'impacteur : les
      // petites collisions d'embryons (fréquentes au début) restent discrètes
      const big = Math.min(1, f.mlE / 2);
      state.slow = Math.max(state.slow, 0.9 * big);
      state.shake = Math.max(state.shake, Math.min(1, 0.15 + 0.6 * big));
      state.burst = Math.max(state.burst || 0, 0.8 * big * big);
      s.flash = performance.now();
      toast(`Impact géant : ${nameOf(f.h)} absorbe ${nameOf(f.l)} (${fmtMass(f.mlE, true)})`);
    }

    evolve(pl);
    vis.updateOrbits(pl.filter((p) => p.mE > 0.3 || p.selected));
    renderList();
  }

  // ── Évolution des planètes (sous-simulation légère, côté CPU) ──────────────
  // Chaque planète a une petite « vie » qui pilote l'aspect de sa surface :
  //  · chaleur interne : l'accrétion et les impacts géants la chauffent (océan
  //    de magma, fissures incandescentes), elle refroidit ensuite d'autant plus
  //    lentement qu'elle est massive ;
  //  · cratères : une surface solide sans atmosphère se cratérise avec l'âge,
  //    la fusion (magma, impact) efface tout ;
  //  · eau : apportée par la matière née au-delà de la ligne des glaces (la
  //    lignée !), son état dépend de la température d'équilibre à cette distance :
  //    vapeur (trop chaud), océans (tempéré), banquise (froid) ;
  //  · atmosphère : retenue seulement au-dessus de ~0,2 M⊕ ; fine et bleue si
  //    tempérée, épaisse et jaunâtre (effet de serre) si chaude ;
  //  · géantes : jeunes et chaudes (lueur rouge, bandes floues), elles se
  //    contrastent en refroidissant.
  const evo = new Map(); // index → { heat, craters, born }
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function evolve(pl) {
    const dt = Math.max(0, Math.min(5, state.simTime - (state.evoT ?? state.simTime)));
    state.evoT = state.simTime;
    for (const p of pl) {
      let e = evo.get(p.index);
      if (!e) { e = { heat: 0.85, craters: 0, born: state.simTime }; evo.set(p.index, e); }
      const mE = Math.max(p.mE, 0.02);
      const tau = 12 * Math.pow(mE, 0.35);                    // refroidissement
      const src = Math.min(0.5, 1.5 * p.rate / mE);               // chauffage par accrétion
      e.heat = Math.min(1, Math.max(0, e.heat + dt * (src - e.heat / tau)));
      const Teq = 278 * Math.pow(life.p.L, 0.25) / Math.sqrt(Math.max(p.a, 0.2)); // K (luminosité réelle de l'étoile)
      const atmo = p.gasF > 0.08 ? 1 : ss(0.15, 1.5, mE) * ss(800, 400, Teq + 150 / mE);
      e.craters = Math.min(1, e.craters + dt * 0.012 * (1 - atmo)) * Math.exp(-e.heat * e.heat * dt * 0.6);
      const water = Math.max(p.ice, ss(0.9, 3.2, p.meanR) * 0.85); // matière hydratée née au-delà des glaces
      const molten = ss(0.35, 0.6, e.heat);
      const ocean = Teq > 180 && Teq < 330 ? water * (1 - molten) : 0;
      const iceSurf = Teq <= 180 ? water * (1 - molten) : 0;
      const hot = ss(300, 420, Teq) * atmo;
      const age = (state.simTime - e.born) / (2 * Math.PI);
      Object.assign(e, { atmo, water, ocean, iceSurf, hot, Teq, age, molten });
      p.evo = e;
      // (garde-fou : une valeur non finie ici contaminerait tout l'écran via le bloom)
      const fin = (v) => (Number.isFinite(v) ? v : 0);
      if (!Number.isFinite(e.heat)) e.heat = 0;
      if (!Number.isFinite(e.craters)) e.craters = 0;
      vis.setEvo(p.index, [e.heat, ocean, iceSurf, e.craters].map(fin), [atmo, hot, Math.min(1, age / 60), Teq / 1000].map(fin));
    }
    for (const i of evo.keys()) if (!pl.some((p) => p.index === i)) evo.delete(i);
  }
  function surfaceOf(p) {
    const e = p.evo;
    if (!e) return '';
    if (p.gasF > 0.5) return e.heat > 0.3 ? 'jeune géante encore chaude' : 'atmosphère en bandes';
    if (p.gasF > 0.08) return 'enveloppe d’hydrogène épaisse';
    if (e.molten > 0.5) return 'océan de magma';
    if (e.hot > 0.5) return 'atmosphère épaisse et brûlante';
    if (e.ocean > 0.3) return 'océans d’eau liquide';
    if (e.iceSurf > 0.3) return 'surface glacée';
    if (e.craters > 0.4) return 'surface criblée de cratères';
    return 'surface rocheuse';
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  const NAMES = 'Aube Brume Cendre Dune Écume Faille Givre Houle Iris Jade Kaolin Lave Mica Nacre Onyx Perle Quartz Rouille Sel Talc Ulve Vesta Wolfram Xénon Yule Zircon Ambre Basalte Corail Diorite Éther Fusain'.split(' ');
  const nameOf = (i) => NAMES[i % NAMES.length] + (i >= NAMES.length ? ' II' : '');
  const fmtMass = (mE, plain) => (mE >= 30 ? `${(mE / 317.8).toFixed(2)} M${plain ? 'J' : '<sub>J</sub>'}` : `${mE.toFixed(mE < 1 ? 2 : 1)} M⊕`);
  const kindOf = (p) => (p.mE < 0.3 ? 'embryon' : p.gasF > 0.5 ? 'géante gazeuse' : p.gasF > 0.08 ? 'mini-Neptune' : p.ice > 0.35 ? 'glacée' : 'rocheuse');

  // Liste stable : on ne change sa composition (et son ordre) que si une
  // planète naît, disparaît ou en dépasse nettement une autre ; sinon on met
  // seulement à jour les chiffres. Les lignes ne bougent plus sous la souris.
  const MAXL = 8;
  let members = [];
  const listRows = new Map();
  const listEl = $('#list');
  function renderList() {
    const byIdx = new Map(state.planets.map((p) => [p.index, p]));
    let next = members.filter((i) => byIdx.has(i) && (byIdx.get(i).mE >= 0.3 || i === state.selected));
    const cands = state.planets.filter((p) => p.mE >= 0.3 && !next.includes(p.index)).sort((a, b) => b.m - a.m);
    for (const c of cands) {
      if (next.length < MAXL) { next.push(c.index); continue; }
      const weakest = next.filter((i) => i !== state.selected).reduce((a, b) => (byIdx.get(b).m < byIdx.get(a).m ? b : a));
      if (c.m > byIdx.get(weakest).m * 1.6) next[next.indexOf(weakest)] = c.index;
    }
    if (state.selected >= 0 && byIdx.has(state.selected) && !next.includes(state.selected)) next.push(state.selected);
    const changed = next.length !== members.length || next.some((i) => !members.includes(i));
    if (changed) {
      members = next.sort((a, b) => byIdx.get(a).a - byIdx.get(b).a);
      listEl.replaceChildren(...members.map((i) => {
        let li = listRows.get(i);
        if (!li) {
          li = document.createElement('li');
          li.dataset.i = i;
          li.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="num a"></span><span class="num m"></span><span class="chips"></span>';
          li.querySelector('.nm').textContent = nameOf(i);
          listRows.set(i, li);
        }
        return li;
      }));
      for (const i of listRows.keys()) if (!members.includes(i)) listRows.delete(i);
    }
    for (const i of members) {
      const p = byIdx.get(i), li = listRows.get(i);
      li.classList.toggle('sel', p.selected);
      li.querySelector('.dot').style.background = css(p.color);
      li.querySelector('.a').textContent = `${p.a.toFixed(2)} UA`;
      li.querySelector('.m').innerHTML = fmtMass(p.mE);
      const chips = `<i>${kindOf(p)}</i><i>♪ ${noteName(p.a)}</i>` + [...new Set(p.res)].map((r) => `<b>${r}</b>`).join('');
      const c = li.querySelector('.chips');
      if (c.innerHTML !== chips) c.innerHTML = chips;
    }
    $('#auto').classList.toggle('on', state.autoSelect);
    const nPl = state.planets.filter((p) => p.mE > 0.3).length;
    $('#stats').innerHTML = `
      <div><span>temps</span>${(state.simTime / (2 * Math.PI)).toFixed(1)} orbites à 1 UA</div>
      <div><span>planètes</span>${nPl} · ${state.planets.length - nPl} embryons</div>
      <div><span>poussière</span>${(state.active * SOLID0 / N / M_EARTH).toFixed(0)} M⊕ <em>${bar(state.active / N)}</em></div>
      <div><span>gaz du disque</span>${(state.gasFrac * 100).toFixed(0)} % <em>${bar(state.gasFrac)}</em></div>
      <div><span>grains actifs</span>${(state.active / 1e6).toFixed(2)} M / ${(N / 1e6).toFixed(2)} M · ${state.fps.toFixed(0)} i/s</div>`;
  }
  const bar = (f) => `<u style="--f:${Math.max(0, Math.min(1, f)).toFixed(3)}"></u>`;
  listEl.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li) focus(Number(li.dataset.i));
  });

  // ── Caméra : suivre une planète choisie dans la liste ──────────────────────
  // La caméra glisse jusqu'à la planète puis l'accompagne sur son orbite ;
  // on peut toujours tourner autour et zoomer. Échap : vue d'ensemble.
  const HOME = { pos: new THREE.Vector3(0, 6.5, 12.5), target: new THREE.Vector3() };
  state.follow = -1;
  let camMove = null;
  const lastFollow = new THREE.Vector3();
  const visRadius = (mE) => {
    const Rp = mE < 2 ? Math.pow(mE, 0.28) : Math.min(11.5, 1.21 * Math.pow(mE / 2, 0.59));
    return Math.max(0.005, 0.013 * Math.pow(Rp, 0.75)); // même formule que le shader
  };
  function followPos(out) {
    const q = pred.get(state.follow);
    return q ? out.set(q[0], q[1], q[2]) : null;
  }
  function focus(i) {
    const p = state.planets.find((q) => q.index === i);
    if (!p) return;
    select(i);
    state.follow = i;
    const at = followPos(new THREE.Vector3()) || new THREE.Vector3(p.x, p.y, p.z);
    // de côté, un peu vers l'étoile et au-dessus : la planète apparaît éclairée
    // aux trois quarts (vue de l'extérieur, on ne verrait que sa face de nuit)
    const d = 0.3 + 7 * visRadius(p.mE);
    const radial = at.clone().setY(0).normalize();
    const tangent = new THREE.Vector3(-radial.z, 0, radial.x);
    const offset = tangent.multiplyScalar(-0.9).addScaledVector(radial, -0.25).add(new THREE.Vector3(0, 0.4, 0)).normalize().multiplyScalar(d);
    camMove = { t: 0, dur: 1.6, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), offset };
    controls.minDistance = 0.04;
    lastFollow.copy(at);
    $('#overview').hidden = false;
    toast(`Suivi de ${nameOf(i)} · Échap : vue d’ensemble`);
  }
  function overview() {
    if (state.follow < 0 && !camMove) return;
    state.follow = -1;
    camMove = { t: 0, dur: 1.6, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), home: true };
    $('#overview').hidden = true;
  }
  $('#overview').addEventListener('click', overview);
  // vue large du nuage (début de cycle) / retour à la vue du disque (allumage)
  const CLOUD_VIEW = new THREE.Vector3(0, 13, 30);
  function flyHome(dest, dur = 3) {
    if (state.follow >= 0) return;
    camMove = { t: 0, dur, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), home: true, dest };
  }
  const _f = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  function updateCamera(real) {
    if (state.follow >= 0 && kin.pos && !pred.has(state.follow)) {
      // planète absorbée : on suit celle qui l'a avalée (l'info arrive un peu
      // après), sinon, passé un délai, retour à la vue d'ensemble
      const heir = state.absorbedBy?.get(state.follow);
      state.lostFor = (state.lostFor || 0) + real;
      if (heir !== undefined && pred.has(heir)) { state.follow = heir; select(heir); state.lostFor = 0; }
      else if (state.lostFor > 0.6) { state.lostFor = 0; overview(); }
    } else state.lostFor = 0;
    const here = state.follow >= 0 ? followPos(_f) : null;
    if (state.follow >= 0 && !here && camMove && !camMove.home) return; // attend la première prédiction
    if (camMove) {
      camMove.t += real;
      if (here && !camMove.home) camMove.offset.applyAxisAngle(_up, -(Math.atan2(here.z, here.x) - Math.atan2(lastFollow.z, lastFollow.x)));
      const k = Math.min(1, camMove.t / camMove.dur), e = k * k * (3 - 2 * k);
      const toTarget = camMove.home ? HOME.target : here;
      const toPos = camMove.home ? (camMove.dest || HOME.pos) : here.clone().add(camMove.offset);
      controls.target.lerpVectors(camMove.fromTarget, toTarget, e);
      camera.position.lerpVectors(camMove.fromPos, toPos, e);
      if (k >= 1) { if (camMove.home) controls.minDistance = 0.6; camMove = null; }
    } else if (here) {
      // accompagne la planète dans un repère qui tourne avec elle autour de
      // l'étoile : même éclairage en permanence (sinon on finit côté nuit)
      const dAng = Math.atan2(here.z, here.x) - Math.atan2(lastFollow.z, lastFollow.x);
      _v.subVectors(camera.position, controls.target).applyAxisAngle(_up, -dAng);
      controls.target.copy(here);
      camera.position.copy(here).add(_v);
    }
    if (here) lastFollow.copy(here);
  }
  $('#auto').addEventListener('click', () => {
    state.autoSelect = !state.autoSelect;
    toast(state.autoSelect ? 'Sélection automatique : la plus massive' : 'Sélection figée');
  });

  // Barre de couleur « lieu de naissance »
  {
    const stops = [];
    for (let k = 0; k <= 24; k++) {
      const r = R_IN + (R_OUT - R_IN) * k / 24;
      stops.push(`${css(provenanceRGB(r))} ${(k / 24 * 100).toFixed(1)}%`);
    }
    $('#provbar').style.background = `linear-gradient(90deg, ${stops.join(',')})`;
    $('.provlegend').style.setProperty('--snow', `${((sim.U.snow.value - R_IN) / (R_OUT - R_IN) * 100).toFixed(1)}%`);
  }

  // Coupe stratigraphique de la planète sélectionnée, annotée
  const cut = $('#cut'), cctx = cut.getContext('2d');
  let cutGeom = null, cutHover = -1;
  const GAS_RGB = [0.87, 0.78, 0.62];
  // types de strates : 0 accrétion, 2 embryon initial, 3 gaz capté,
  // ≥ 10 matière d'un impacteur (10 + n° d'impact ; ,5 = son gaz)
  const isGasL = (l) => l.type === 3 || (l.type >= 10 && l.type % 1 > 0.25);
  const groupOf = (l) => (l.type >= 10 ? Math.floor(l.type) : 0);
  function layerColor(l) {
    if (isGasL(l)) return GAS_RGB;
    const c = provenanceRGB(l.r).map((v) => v * (1 - l.ice * 0.35) + l.ice * 0.35 * 0.95);
    return l.type === 2 ? c.map((v) => v * 0.6) : c;
  }
  function drawCut() {
    const dpr = Math.min(devicePixelRatio, 2);
    const W = cut.clientWidth, H = cut.clientHeight;
    if (cut.width !== W * dpr) { cut.width = W * dpr; cut.height = H * dpr; }
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.clearRect(0, 0, W, H);
    const p = state.planets.find((q) => q.index === state.selected);
    const info = $('#cutinfo');
    if (!p || !state.layers) { info.textContent = ''; cutGeom = null; return; }
    const n = Math.max(1, Math.min(L, Math.round(p.nLayers)));
    const layers = [];
    for (let k = 0; k < n; k++) {
      const o = (p.index * L + k) * 4;
      layers.push({ m: state.layers[o], ice: state.layers[o + 1], r: state.layers[o + 2], type: state.layers[o + 3] });
    }
    const total = layers.reduce((s, l) => s + l.m, 0) || 1;
    const Rmax = Math.min(H * 0.42, W * 0.32), cx = Rmax + 10, cy = H / 2 + 6;

    // rayons de chaque strate (le volume suit la masse)
    let cum = 0;
    const rings = layers.map((l, k) => {
      const r0 = Rmax * Math.cbrt(cum / total);
      cum += l.m;
      return { k, l, r0, r1: Rmax * Math.cbrt(cum / total) };
    });
    cutGeom = { cx, cy, Rmax, rings, p };

    // moitié gauche : la planète vue de l'extérieur, éclairée
    const outer = layers[layers.length - 1];
    const oc = p.gasF > 0.3 ? GAS_RGB : layerColor(outer);
    const g = cctx.createRadialGradient(cx - Rmax * 0.55, cy - Rmax * 0.35, Rmax * 0.05, cx, cy, Rmax);
    g.addColorStop(0, css(oc, 1.25)); g.addColorStop(0.7, css(oc, 0.45)); g.addColorStop(1, 'rgb(5,5,10)');
    cctx.beginPath(); cctx.arc(cx, cy, Rmax, Math.PI / 2, Math.PI * 1.5); cctx.closePath();
    cctx.fillStyle = g; cctx.fill();

    // moitié droite : les strates, du cœur (le plus ancien) à la surface (le plus récent)
    for (let k = rings.length - 1; k >= 0; k--) {
      const { l, r1 } = rings[k];
      cctx.beginPath(); cctx.moveTo(cx, cy); cctx.arc(cx, cy, r1, -Math.PI / 2, Math.PI / 2); cctx.closePath();
      cctx.fillStyle = css(layerColor(l), isGasL(l) ? 0.8 : 0.95);
      cctx.fill();
    }
    for (const { k, l, r1 } of rings) {
      cctx.beginPath(); cctx.arc(cx, cy, r1, -Math.PI / 2, Math.PI / 2);
      cctx.strokeStyle = 'rgba(0,0,0,0.35)'; cctx.lineWidth = 0.6;
      cctx.stroke();
    }
    // chaque impact = un groupe de couches (l'histoire de l'impacteur),
    // bordé d'orange et marqué d'une accolade sur le bord droit
    const groups = new Map();
    for (const q of rings) {
      const g = groupOf(q.l);
      if (!g) continue;
      const G = groups.get(g) || { r0: q.r0, r1: q.r1, m: 0 };
      G.r0 = Math.min(G.r0, q.r0); G.r1 = Math.max(G.r1, q.r1); G.m += q.l.m;
      groups.set(g, G);
    }
    for (const G of groups.values()) {
      cctx.strokeStyle = 'rgba(255,170,90,0.95)'; cctx.lineWidth = 1.6;
      for (const r of [G.r0, G.r1]) { if (r < 1) continue; cctx.beginPath(); cctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2); cctx.stroke(); }
      cctx.lineWidth = 2.5;
      cctx.beginPath(); cctx.moveTo(cx + G.r0, cy); cctx.lineTo(cx + G.r1, cy); cctx.stroke();
    }
    if (rings[cutHover]) {
      const { r1 } = rings[cutHover];
      cctx.beginPath(); cctx.arc(cx, cy, r1, -Math.PI / 2, Math.PI / 2);
      cctx.strokeStyle = '#fff'; cctx.lineWidth = 2; cctx.stroke();
    }
    cctx.strokeStyle = 'rgba(255,255,255,0.3)'; cctx.lineWidth = 1;
    cctx.beginPath(); cctx.moveTo(cx, cy - Rmax - 3); cctx.lineTo(cx, cy + Rmax + 3); cctx.stroke();

    // annotations
    cctx.font = '500 9px Inter, sans-serif';
    cctx.fillStyle = 'rgba(200,210,230,0.55)';
    cctx.textAlign = 'center';
    cctx.fillText('VUE', cx - Rmax / 2, cy - Rmax - 6);
    cctx.fillText('COUPE', cx + Rmax / 2, cy - Rmax - 6);
    const notes = [];
    const at = (r, ang) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    notes.push({ pt: at(Rmax, -1.0), text: 'surface (récent)' });
    const seed = rings.find((q) => q.l.type === 2);
    if (seed) notes.push({ pt: at(Math.max(2, seed.r1 * 0.5), 0.15), text: 'cœur (ancien)' });
    if (groups.size) {
      const big = [...groups.values()].reduce((a, b) => (b.m > a.m ? b : a));
      notes.push({ pt: at((big.r0 + big.r1) / 2, 0.02), text: `impact${groups.size > 1 ? `s (${groups.size})` : ''}` });
    }
    const gasR = rings.filter((q) => q.l.type === 3);
    if (gasR.length) notes.push({ pt: at((gasR[0].r0 + Rmax) / 2, -0.35), text: 'gaz capté' });
    notes.sort((a, b) => a.pt[1] - b.pt[1]);
    const lx = cx + Rmax + 12;
    let lastY = -1e9;
    cctx.textAlign = 'left'; cctx.font = '400 10px Inter, sans-serif';
    for (const nt of notes) {
      const y = Math.max(nt.pt[1], lastY + 13, 10);
      lastY = y;
      cctx.strokeStyle = 'rgba(220,230,250,0.45)'; cctx.lineWidth = 0.8;
      cctx.beginPath(); cctx.moveTo(nt.pt[0], nt.pt[1]); cctx.lineTo(lx - 3, y); cctx.stroke();
      cctx.fillStyle = 'rgba(225,232,245,0.85)';
      cctx.fillText(nt.text, lx, y + 3);
    }

    const hv = rings[cutHover];
    let detail = '<span class="dim">Survolez une strate pour la décrire.</span>';
    if (hv) {
      const l = hv.l, mE = l.m / M_EARTH;
      const g = groupOf(l);
      detail = g ? `Strate ${hv.k + 1}/${n} · <b>apportée par un impact géant</b> : ${isGasL(l) ? 'gaz de l’impacteur' : `une couche de l’impacteur, née vers ${l.r.toFixed(1)} UA`} · ${fmtMass(mE)}`
        : l.type === 3 ? `Strate ${hv.k + 1}/${n} · <b>gaz capté</b> du disque · ${fmtMass(mE)}`
        : l.type === 2 ? `Strate 1/${n} · <b>embryon initial</b> (${fmtMass(mE)}), né à ${l.r.toFixed(2)} UA`
        : `Strate ${hv.k + 1}/${n} · poussière accrétée : ${fmtMass(mE)}, née vers <b>${l.r.toFixed(1)} UA</b> · ${(l.ice * 100).toFixed(0)} % de glace`;
    }
    const ev = p.evo;
    info.innerHTML = `<b>${nameOf(p.index)}</b> · ${kindOf(p)} · ${fmtMass(p.mE)} · orbite à ${p.a.toFixed(2)} UA<br>
      ${ev ? `${surfaceOf(p)} · ≈ ${ev.Teq.toFixed(0)} K · âge ${ev.age.toFixed(0)} orbites<br>` : ''}
      ${p.gasF > 0.02 ? `gaz ${(p.gasF * 100).toFixed(0)} % · ` : ''}glace ${(p.ice * 100).toFixed(0)} % des solides · ${p.impacts.toFixed(0)} impact${p.impacts >= 2 ? 's' : ''} géant${p.impacts >= 2 ? 's' : ''}${p.res.length ? ' · résonance ' + [...new Set(p.res)].join(', ') : ''}<br>
      <span class="hover">${detail}</span>`;
  }
  cut.addEventListener('pointermove', (e) => {
    if (!cutGeom) return;
    const b = cut.getBoundingClientRect();
    const dx = e.clientX - b.left - cutGeom.cx, dy = e.clientY - b.top - cutGeom.cy;
    const d = Math.hypot(dx, dy);
    let k = -1;
    if (dx >= -2 && d <= cutGeom.Rmax) k = cutGeom.rings.findIndex((q) => d >= q.r0 && d <= q.r1 + 0.5);
    if (k !== cutHover) { cutHover = k; drawCut(); }
  });
  cut.addEventListener('pointerleave', () => { cutHover = -1; drawCut(); });

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
      const v = Math.pow(d[i] / mx, 0.6);
      gctx.fillStyle = css(provenanceRGB(radiusOf(i)), 0.35 + v * 0.9);
      const h = Math.max(1, v * (H - 16));
      gctx.fillRect(i * bw, H - 14 - h, Math.max(1, bw - 0.5), h);
    }
    const now = performance.now();
    for (const p of state.planets) {
      if (p.mE < 0.3) continue;
      const x = ((p.a - R_IN) / (R_OUT - R_IN)) * W;
      const lit = Math.max(0, 1 - (now - (p.ping || 0)) / 700);
      gctx.fillStyle = p.selected ? '#bfe9ff' : `rgba(255,255,255,${0.5 + 0.5 * lit})`;
      gctx.beginPath(); gctx.arc(x, H - 6, (p.selected ? 3 : 2) + 3 * lit, 0, Math.PI * 2); gctx.fill();
    }
  }

  let toastTimer;
  function toast(msg, force) {
    if (state.seek >= 0 && !force) return; // (silence pendant l'avance rapide)
    const t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
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

  // ── Résolution adaptative ───────────────────────────────────────────────────
  // Filet de sécurité : si l'image moyenne dépasse 1/55 s pendant 2 s, on baisse
  // la densité de pixels d'un cran ; s'il reste de la marge, on la remonte.
  const PR_STEPS = [1, 1.25, 1.5, 1.75, 2].filter((p) => p <= MAX_PR);
  if (!PR_STEPS.includes(MAX_PR)) PR_STEPS.push(MAX_PR);
  let prIdx = PR_STEPS.length - 1, prAcc = 0, prN = 0, prCool = 0;
  function adaptResolution(real) {
    if (real <= 0) return;
    prAcc += real; prN++; prCool = Math.max(0, prCool - real);
    if (prAcc < 2) return;
    const mean = prAcc / prN;
    prAcc = 0; prN = 0;
    if (prCool > 0 || state.paused) return;
    let next = prIdx;
    if (mean > 1 / 55 && prIdx > 0) next--;
    else if (mean < 1 / 100 && prIdx < PR_STEPS.length - 1) next++;
    if (next !== prIdx) {
      prIdx = next; prCool = 4;
      renderer.setPixelRatio(PR_STEPS[prIdx]);
      renderer.setSize(innerWidth, innerHeight);
    }
  }

  // ── Cycle de vie : du nuage à la supernova ──────────────────────────────────
  state.lifeUI = 0;
  function applyLife() {
    const p = life.p, U = sim.U;
    U.Ms.value = p.Ms; U.gasDens.value = p.gasDens;
    U.clearOn.value = p.clearOn; U.clearR.value = p.clearR; U.clearR2.value = p.clearR2; U.beltLoss.value = p.beltLoss;
    U.starR.value = p.starR; U.outR.value = p.outR; U.snA.value = p.snA; U.snHeat.value = p.snHeat; U.snR.value = p.snR; U.snW.value = p.snW;
    U.snow.value = p.snow;
    vis.setStar(p);
  }
  function onLifeEvent(e) {
    if (e === 'ignition') {
      toast('Allumage : la fusion de l’hydrogène démarre au cœur de l’étoile');
      flyHome(null, 4);
      if (state.seek < 0) { state.burst = 0.35; audio.ignition(); }
    } else if (e === 'clearing') {
      // La ceinture de débris se loge juste au-delà de la géante la plus lointaine
      // (comme la ceinture de Kuiper au-delà de Neptune), ou vers 4,5 UA sans géante.
      const giants = state.planets.filter((p) => p.mE > 10 && p.a < 8.5);
      const aG = giants.length ? Math.max(...giants.map((p) => p.a)) : 3;
      const c = Math.min(7.8, Math.max(3.2, aG * 1.5));
      life.beltIn = c * 0.85; life.beltOut = c * 1.15;
      toast('Le gaz a disparu : la lumière de l’étoile balaie le disque');
    }
    else if (e === 'mature') toast('Le système est formé');
    else if (e === 'giant') { toast('L’étoile a épuisé son hydrogène : elle devient une supergéante rouge'); audio.giant(); }
    else if (e === 'collapse') toast('Le cœur de fer s’effondre…');
    else if (e === 'supernova') {
      toast('Supernova ! L’étoile explose');
      sim.supernova();                       // les éjecta stellaires partent
      state.burst = 1.6; state.shake = 1; audio.supernova();
      if (state.follow >= 0) overview();
      controls.maxDistance = 140;
      setTimeout(() => flyHome(new THREE.Vector3(0, 30, 70), 8), 400); // on recule pour voir l'expansion
    } else if (e === 'newcycle') startNewCycle();
  }
  // Naissance des embryons pendant la formation : là où il y a de la poussière
  // (tirage pondéré par le profil radial lu sous la tête), loin des autres.
  let spawnAcc = 0;
  function spawnEmbryos(dt) {
    spawnAcc += dt;
    if (spawnAcc < 2.2 || !state.needle) return;
    spawnAcc = 0;
    const w = [];
    let tot = 0;
    for (let i = 0; i < nUsed; i++) { const r = radiusOf(i); const c = state.needle[i] * r * (r > 0.45 ? 1 : 0); w.push(c); tot += c; }
    if (tot <= 0) return;
    for (let attempt = 0; attempt < 6; attempt++) {
      let u = Math.random() * tot, i = 0;
      while (i < nUsed - 1 && (u -= w[i]) > 0) i++;
      const a = radiusOf(i) * (0.97 + Math.random() * 0.06);
      if (state.planets.some((q) => Math.abs(q.a - a) < 0.07 * a)) continue;
      const free = freeSlot();
      if (free < 0) return;
      const ph = Math.random() * Math.PI * 2;
      sim.spawn(free, new THREE.Vector3(a * Math.cos(ph), 0, a * Math.sin(ph)), M_EARTH * (0.02 + Math.random() * 0.1));
      state.reserved.add(free);
      return;
    }
  }
  function startNewCycle(replay = false) {
    state.resetting = true;
    if (state.follow >= 0) overview();
    flyHome(CLOUD_VIEW, 4);
    setTimeout(() => (controls.maxDistance = 70), 4500);
    sim.reset(life.cycle).then(() => {
      state.planets = []; state.prev = new Map(); state.removedGas = 0; state.lastSerial = 0;
      state.absorbedBy?.clear(); state.reserved.clear(); state.layers = null;
      state.selected = -1; state.autoSelect = true; vis.V.selected.value = -1;
      evo.clear(); cross.clear(); pred.clear(); kin.pos = null; kin.t = state.simTime;
      vis.updateOrbits([]);
      renderList();
      state.resetting = false;
      if (!replay) toast(`Cycle ${life.cycle + 1} : un nouveau nuage, ensemencé par la supernova`);
    });
  }
  const phasesEl = $('#phases');
  phasesEl.innerHTML = PHASES.map((ph, i) => `<div data-i="${i}" title="${ph.name}"><span><u></u></span></div>`).join('');
  $('#phPrev').addEventListener('click', () => seekTo(life.phase - 1));
  $('#phNext').addEventListener('click', () => seekTo(life.phase + 1));
  phasesEl.addEventListener('click', (e) => {
    const d = e.target.closest('[data-i]');
    if (d) seekTo(Number(d.dataset.i));
  });

  // ── Navigation entre les phases ─────────────────────────────────────────────
  // Vers l'avant : avance rapide de la vraie simulation (le système se forme
  // pour de bon, il n'est pas « truqué »). Vers l'arrière : on recommence le
  // cycle depuis le nuage (on ne peut pas remonter le temps d'une vraie
  // simulation), puis avance rapide si besoin — seulement pour une phase
  // strictement antérieure : cliquer la phase en cours ne fait rien.
  state.seek = -1;
  function seekTo(i) {
    i = Math.max(0, Math.min(PHASES.length - 1, i));
    if (state.resetting) return;
    if (life.phase === 6) { toast('Pendant la supernova, on regarde ! Un nouveau cycle suivra.'); return; }
    if (state.seek >= 0 && i === state.seek) return;     // (déjà en route)
    if (i === life.phase && state.seek < 0) { toast(`Déjà en phase « ${PHASES[i].name} »`); return; }
    if (i < life.phase) {
      life.restart();
      startNewCycle(true);
      if (i === 0) return;
    }
    state.seek = i;
    audio.setMuted(true, true);
    document.body.classList.add('seeking');
    toast(`Avance rapide vers « ${PHASES[i].name} »…`, true);
  }
  function endSeek() {
    state.seek = -1;
    audio.setMuted(audio.muted, false);
    document.body.classList.remove('seeking');
    $('#toast').classList.remove('on');
    toast(PHASES[life.phase].name, true);
    if (state.follow < 0) flyHome(life.phase === 0 ? CLOUD_VIEW : null, 2.5);
  }
  function renderLife() {
    const ph = PHASES[life.phase];
    $('#cyc').textContent = `cycle ${life.cycle + 1}`;
    [...phasesEl.children].forEach((el, i) => {
      el.className = i < life.phase ? 'done' : i === life.phase ? 'now' : i === state.seek ? 'target' : '';
      el.title = i < life.phase ? `${PHASES[i].name} — revenir en arrière recommence le cycle depuis le nuage`
        : i === life.phase ? `${PHASES[i].name} (en cours)` : `Avancer jusqu’à : ${PHASES[i].name}`;
      el.firstChild.firstChild.style.width = i === life.phase ? `${Math.min(100, life.p.progress * 100).toFixed(1)}%` : '';
    });
    $('#phPrev').disabled = life.phase === 0 || life.phase === 6;
    $('#phNext').disabled = life.phase >= 5 || state.seek >= 0;
    const head = `<b>${ph.name}</b> <span class="dim">· en réalité ${ph.real}</span>`;
    if ($('#phaseName').innerHTML !== head) { $('#phaseName').innerHTML = head; $('#phaseDesc').textContent = ph.desc; }
  }

  // ── Boucle ─────────────────────────────────────────────────────────────────
  let last = performance.now();
  const shakeOff = new THREE.Vector3();
  // La simulation attend qu'on entre : tant que l'accueil est affiché, rien ne
  // tourne (ni calcul, ni rendu) — le cycle commence au clic.
  const introEl = $('#intro');
  renderer.setAnimationLoop((now) => {
    if (!introEl.classList.contains('gone')) { last = now; return; }
    // (l'horodatage rAF peut précéder `last` à la 1re image : jamais de pas négatif)
    const tJs0 = PROF ? performance.now() : 0;
    const real = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    state.fps = state.fps * 0.95 + (1 / Math.max(real, 1e-3)) * 0.05;
    adaptResolution(real);
    // ralenti après un impact géant : le temps s'étire puis repart
    state.slow = Math.max(0, state.slow - real / 2.6);
    const timeScale = 1 - 0.8 * Math.pow(state.slow, 0.7);
    // Temps simulé indexé sur le temps réel (0,96 unité/s à ×1, comme avant à
    // 60 i/s) : à 120 i/s chaque image fait deux fois moins de travail.
    // (plafonné : si le GPU ne suit pas en accéléré, le temps ralentit au lieu
    //  de demander toujours plus de sous-pas — pas de spirale)
    // (la supernova se joue au plus à ×1 : c'est un moment à regarder)
    const spd = life.phase === 6 ? Math.min(1, state.speed) : state.speed;
    let frameTime = Math.min(0.066 * warp, Math.min(0.05, real) * 0.96 * spd * timeScale * warp);
    // navigation : avance rapide vers une phase (grands pas, tout à fond)
    if (state.seek >= 0 && !state.resetting) {
      if (life.phase >= state.seek) endSeek();
      else frameTime = 0.4;
    }
    sim.maxDtP = state.seek >= 0 ? 0.03 : 0.011;

    // cycle de vie : paramètres de l'étoile et du disque, événements
    if (!state.paused && !state.resetting) {
      const evs = life.update(frameTime, real, state.gasFrac);
      applyLife();
      for (const e of evs) onLifeEvent(e);
      if (life.p.spawn) spawnEmbryos(frameTime);
    }
    if (++state.lifeUI % 8 === 0) renderLife();

    let dtSim = 0;
    if (!state.paused && !state.resetting && frameTime > 0) {
      dtSim = frameTime;
      state.simTime += dtSim;
      const tick = state.simTime >= state.nextLayer;
      if (tick) state.nextLayer = state.simTime + 2.5;
      updateFlyby(dtSim);
      sim.step(dtSim, tick);
    }
    // positions de l'instant présent, PUIS caméra : sinon elle aurait une image de retard
    predictAll();
    if (!state.paused) detectCrossings();
    updateCamera(real);
    controls.update();
    vis.updateFx(state.paused ? 0 : real, (i) => pred.get(i));
    if (vis.updatePulsar(state.paused ? 0 : real)) audio.pulsarTick(); // un faisceau nous balaie : « tic »

    // bouffée d'exposition : tout le système s'illumine un instant
    state.burst = Math.max(0, (state.burst || 0) - real * 1.4);
    vis.V.exposure.value = EXPOSURE * (1 + (state.follow >= 0 ? 0.3 : 0.9) * state.burst * state.burst * (state.burst > 1 ? 3 : 1));

    // secousse de caméra
    state.shake = Math.max(0, state.shake - real * 1.2);
    const k = state.shake * state.shake * 0.04 * camera.position.length() / 14;
    shakeOff.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    camera.position.add(shakeOff);
    vis.pipeline.render();
    camera.position.sub(shakeOff);
    const tR = PROF ? performance.now() : 0;
    poll(now);
    if (PROF) { profJs.loop += tR - tJs0; profJs.poll += performance.now() - tR; }
    if (PROF && ++profN % 30 === 0) {
      window.__profJs = { loop: (profJs.loop / 30).toFixed(2), poll: (profJs.poll / 30).toFixed(2) };
      profJs.loop = profJs.poll = 0;
      Promise.all([renderer.resolveTimestampsAsync('compute'), renderer.resolveTimestampsAsync('render')]).then(() => {
        window.__prof = { compute: renderer.info.compute.timestamp, render: renderer.info.render.timestamp };
      });
    }
  });
  let profN = 0;
  const profJs = { loop: 0, poll: 0 };

  if (params.has('auto')) { $('#intro').classList.add('gone'); }
  window.__planetaire = { sim, state, renderer, audio, launchFlyby, pred, kin, vis, life }; // (débogage)
}

function fail(msg) {
  $('#intro').innerHTML = `<div class="card fail"><h1>Planétaire</h1><p>${msg}</p><p class="dim">Essayez Chrome, Edge ou Safari récents.</p></div>`;
}

main().catch((e) => { console.error(e); fail('Erreur d’initialisation : ' + e.message); });
