// Point d'entrée : crée le moteur, la simulation, le rendu, la machine, le son
// et l'interface, puis les relie dans la boucle d'animation.
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from './config.js';
import { createSim, M, NR, R_IN, R_OUT, R_GRID, M_EARTH, GAS0, NIMP, planetRadius } from './sim.js';
import { createLifecycle, PHASES } from './lifecycle.js';
import { createVisuals } from './render/index.js';
import { createOrrery, HOPPER, BELL_R } from './orrery/index.js';
import { Sonifier } from './audio.js';
import { createKinematics } from './app/kinematics.js';
import { readPlanets, createEvolution, nameOf, fmtMass, MIN_PLANET } from './app/planets.js';
import { createCameraRig, CLOUD_VIEW } from './app/camera.js';
import { createUI, fmtSpeed } from './app/ui.js';

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const PLANET_K = 1.7;            // DA mécanique : planètes grossies, billes sur leurs tiges
const SPAWN_EVERY = 2.2;         // naissance d'embryons pendant la formation (unités de temps)
const COLOR_MODES = ['Couleur : provenance', 'Couleur : roche / glace', 'Couleur : température'];

function fail(msg) {
  const intro = document.querySelector('#intro');
  intro.classList.remove('gone');
  intro.innerHTML = `<div class="card fail"><h1>Planétaire</h1><p>${msg}</p><p class="dim">Essayez Chrome, Edge ou Safari récents.</p></div>`;
}

async function main() {
  if (!navigator.gpu) return fail('WebGPU n’est pas disponible dans ce navigateur.');
  const { film: FILM, hdr: HDR, n: N } = CONFIG;

  // ── Moteur ─────────────────────────────────────────────────────────────────
  // Écran HDR (EDR sur Mac, HDR sous Windows) : sortie en virgule flottante,
  // les hautes lumières dépassent le blanc de l'interface ; courbe maison dans
  // render/post.js. En SDR : tone mapping Neutral (garde la teinte des couleurs
  // vives, qu'AgX délave vers le blanc).
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance', trackTimestamp: CONFIG.prof,
    ...(HDR ? { outputType: THREE.HalfFloatType } : {}) });
  const MAX_PR = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(MAX_PR);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = HDR ? THREE.NoToneMapping : CONFIG.agx ? THREE.AgXToneMapping : THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) return fail('Cette expérience nécessite WebGPU (pas de repli WebGL).');
  document.querySelector('#app').appendChild(renderer.domElement);
  renderer.backend.device.lost.then((info) => {
    console.error('GPU perdu :', info.message);
    fail(`Le GPU a été ${info.reason !== 'destroyed' ? `réinitialisé (${info.message})` : 'perdu'}. Rechargez la page, éventuellement avec moins de grains : ?n=262144`);
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010103);
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 2000);
  camera.position.copy(CLOUD_VIEW);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 0.6;
  controls.maxDistance = 70;

  // ── Modules ────────────────────────────────────────────────────────────────
  const sim = createSim(renderer, N);
  sim.U.hopper.value.copy(HOPPER);
  // DA mécanique : le nuage initial doit tenir sous la cloche. On le resserre
  // (14 → 9,6 UA) en accélérant sa rotation pour que le bord du disque retombe
  // au même rayon (r_atterrissage = Ω² R⁴ : Ω = 3 / R²) ; il est versé par la
  // trémie, et la cloche retient tout (nuage, débris, planètes).
  const setCloud = (meca) => {
    const R = meca ? 9.6 : 14;
    sim.U.cloudR.value = R; sim.U.cloudOmega.value = meca ? 3 / (R * R) : 0.0153;
    sim.U.pourOn.value = meca ? 1 : 0;
    sim.U.bellR.value = meca ? BELL_R : 0;
  };
  setCloud(CONFIG.meca);
  await sim.init();
  const vis = createVisuals(renderer, scene, camera, sim, CONFIG);
  const V = vis.V;
  const orrery = createOrrery(scene, renderer, { film: FILM });
  const audio = new Sonifier();
  audio.muted = true; // (le son est en option : bouton « son » ou touche M)
  orrery.onClick = () => audio.click();
  orrery.onClack = () => audio.clack();
  const life = createLifecycle();
  const kin = createKinematics(sim);
  const pred = kin.pred;
  const evo = createEvolution(vis.setEvo);
  const rig = createCameraRig(camera, controls);

  // ── État ───────────────────────────────────────────────────────────────────
  const state = {
    paused: false, speed: 2, simTime: 0, resetting: false, seek: -1,
    planets: [], selected: -1, autoSelect: true,
    needle: null, dustFrac: 1, gasFrac: 1, removedGas: 0,
    lastSerial: 0, prev: new Map(), absorbedBy: new Map(), reserved: new Set(),
    slow: 0, shake: 0, burst: 0, fly: null, lostFor: 0,
  };

  const ui = createUI({
    speeds: SPEEDS, phases: PHASES,
    onPause: () => togglePause(),
    onSpeed: (v) => setSpeedTo(v),
    onSeek: (i, relative) => seekTo(relative ? life.phase + i : i),
    onFocus: (i) => focus(i),
    onAuto: () => { state.autoSelect = !state.autoSelect; toast(state.autoSelect ? 'Sélection automatique : la plus massive' : 'Sélection figée'); },
    onOverview: () => overview(),
    onSound: () => toggleSound(),
  });
  // (silence pendant l'avance rapide, sauf messages forcés)
  const toast = (msg, force) => { if (state.seek < 0 || force) ui.toast(msg); };

  let meca = CONFIG.meca;
  function setMeca(v) {
    meca = v;
    orrery.setVisible(v);
    document.body.classList.toggle('meca', v);
    setCloud(v); // (s'applique au prochain nuage)
    // objectif « macro » et éclairages propres à chaque DA
    V.planetK.value = v ? PLANET_K : 1;
    V.bokeh.value = v ? 3.0 : 0.8;
    V.blurK.value = v ? 1.0 : 0.4;
    V.aperture.value = CONFIG.lens && CONFIG.dof ? (v ? 0.045 : 0.015) : 0;
    V.planetFlux.value = v ? 2.2 : 4.0;
    V.starK.value = v ? 0.35 : 1.0;
    V.innerSoft.value = v ? 1.0 : 0.0;
    if (!v) V.collect.value = 0;
  }
  setMeca(meca);

  function toggleSound() {
    audio.start(); // (premier geste de l'utilisateur : le contexte audio peut naître)
    audio.setMuted(!audio.muted);
    ui.setSound(!audio.muted);
    orrery.setComb(!audio.muted); // (le peigne — la tête de lecture du son — sort ou rentre)
    toast(audio.muted ? 'Son coupé' : 'Son actif');
  }
  function togglePause() {
    state.paused = !state.paused;
    ui.syncSpeed(state.speed, state.paused);
    toast(state.paused ? 'Pause' : 'Lecture');
  }
  function setSpeedTo(v) {
    state.speed = v; state.paused = false;
    ui.syncSpeed(state.speed, state.paused);
    toast(`Vitesse ×${fmtSpeed(v)}`);
  }
  const setSpeed = (d) => setSpeedTo(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(state.speed) + d))]);
  ui.syncSpeed(state.speed, state.paused);

  // ── Interaction ────────────────────────────────────────────────────────────
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const onPlane = (e) => {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  };
  // puits gravitationnel (Maj + glisser) et son repère
  const wellMarker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.21, 64), new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide }));
  wellMarker.material.color.setRGB(0.6, 0.9, 1.6);
  wellMarker.rotation.x = -Math.PI / 2;
  wellMarker.visible = false;
  scene.add(wellMarker);
  const moveWell = (e) => { const p = onPlane(e); if (p) { sim.U.wellPos.value.copy(p); wellMarker.position.copy(p); } };

  let well = false, downAt = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => {
    downAt = [e.clientX, e.clientY];
    if (!e.shiftKey) return;
    well = true; controls.enabled = false;
    moveWell(e);
    sim.U.wellMass.value = 0.015;
    wellMarker.visible = true;
  });
  el.addEventListener('pointermove', (e) => { if (well) moveWell(e); });
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
    if (!spawn(p, 0.15 * M_EARTH)) return toast('Plus de place pour de nouveaux embryons.');
    toast(`Embryon semé à ${r.toFixed(2)} UA`);
  });

  // sème un embryon dans un emplacement libre ; false s'il n'y en a plus
  function spawn(pos, mass) {
    const used = new Set(state.planets.map((p) => p.index));
    for (let i = 0; i < M; i++) {
      if (state.reserved.has(i) || used.has(i)) continue;
      sim.spawn(i, pos, mass);
      state.reserved.add(i); // (réservé jusqu'à ce que la lecture GPU le confirme)
      return true;
    }
    return false;
  }

  const _v = new THREE.Vector3();
  const toScreen = (x, y, z) => _v.set(x, y, z).project(camera);
  const screenPan = (x, y, z) => Math.max(-1, Math.min(1, toScreen(x, y, z).x));
  function pick(e) {
    let best = -1, bd = 22;
    for (const p of state.planets) {
      const v = toScreen(p.x, p.y, p.z);
      const d = Math.hypot((v.x * 0.5 + 0.5) * innerWidth - e.clientX, (-v.y * 0.5 + 0.5) * innerHeight - e.clientY);
      if (d < bd) { bd = d; best = p.index; }
    }
    if (best >= 0) select(best);
  }
  function select(i) {
    state.selected = i; state.autoSelect = false;
    V.selected.value = i;
  }
  const followPos = (out) => { const q = pred.get(rig.follow); return q ? out.set(q[0], q[1], q[2]) : null; };
  function focus(i) {
    const p = state.planets.find((q) => q.index === i);
    if (!p) return;
    select(i);
    const q = pred.get(i) || [p.x, p.y, p.z];
    rig.focus(i, new THREE.Vector3(...q), planetRadius(p.mE, V.planetK.value));
    ui.setOverview(true);
    toast(`Suivi de ${nameOf(i)} · Échap : vue d’ensemble`);
  }
  function overview() {
    if (rig.overview()) ui.setOverview(false);
  }

  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    switch (e.key.toLowerCase()) {
      case ' ': togglePause(); e.preventDefault(); break;
      case 'e': launchFlyby(); break;
      case 'c': V.colorMode.value = (V.colorMode.value + 1) % 3; toast(COLOR_MODES[V.colorMode.value]); break;
      case 'm': toggleSound(); break;
      case 'h': ui.toggleHelp(); break;
      case 'o': setMeca(!meca); toast(meca ? 'Machine : visible' : 'Machine : ôtée'); break;
      case 'a': state.autoSelect = true; toast('Sélection automatique'); break;
      case '[': seekTo(life.phase - 1); break;
      case ']': seekTo(life.phase + 1); break;
      case 'escape': overview(); break;
      case '+': case '=': setSpeed(1); break;
      case '-': setSpeed(-1); break;
      case 'p': {
        sim.U.migK.value = sim.U.migK.value > 0 ? 0 : 2.0e-3;
        toast(sim.U.migK.value ? 'Migration planétaire : active' : 'Migration planétaire : inactive');
        break;
      }
    }
  });

  addEventListener('resize', () => {
    if (FILM) return; // (résolution fixée par film.js)
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ── Étoile vagabonde ───────────────────────────────────────────────────────
  function launchFlyby() {
    if (state.fly) return;
    const th = Math.random() * Math.PI * 2, incl = (Math.random() - 0.5) * 0.6;
    const dir = new THREE.Vector3(Math.cos(th), Math.sin(incl), Math.sin(th)).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    state.fly = { dir, start: side.multiplyScalar(6.5 + Math.random() * 4).addScaledVector(dir, -45), v: 1.1, t: 0 };
    sim.U.flyMass.value = 0.25;
    vis.flyStar.visible = true;
    toast('Une étoile vagabonde traverse le système…');
  }
  function updateFlyby(dt) {
    const f = state.fly;
    if (!f) return;
    f.t += dt;
    const p = sim.U.flyPos.value.copy(f.start).addScaledVector(f.dir, f.v * f.t);
    vis.flyStar.position.copy(p);
    audio.flyby(p.length(), screenPan(p.x, p.y, p.z), p.dot(f.dir) < 0);
    if (f.v * f.t > 90) {
      state.fly = null; sim.U.flyMass.value = 0; sim.U.flyPos.value.set(1e4, 0, 0); vis.flyStar.visible = false;
      audio.flyby(null);
    }
  }

  // ── Notes : une planète croise la tête de lecture (axe +X) ────────────────
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
      if (state.simTime - c.last < Math.PI * Math.pow(a, 1.5)) continue; // (au plus une note par demi-orbite)
      c.last = state.simTime;
      const p = state.planets.find((pp) => pp.index === i);
      if (!p || p.mE < MIN_PLANET) continue;
      vis.pulse(i);
      orrery.pluck(a, Math.min(1, Math.cbrt(p.mE / 10)));
      audio.planetNote({ a, mE: p.mE, gas: p.gasF, selected: i === state.selected, pan: screenPan(q[0], q[1], q[2]) });
      ui.ping(i);
    }
    for (const i of cross.keys()) if (!pred.has(i)) cross.delete(i);
  }

  // ── Lectures GPU → CPU (petites, asynchrones, jamais bloquantes) ──────────
  const nUsed = Math.floor(((R_OUT - R_IN) / (R_GRID - R_IN)) * NR);
  const radiusOf = (i) => R_IN + (i + 0.5) * (R_GRID - R_IN) / NR;
  const reads = { embryos: { busy: false, at: 0, every: 150 }, needle: { busy: false, at: 0, every: 60 } };
  const throttle = (r, now, fn) => {
    if (r.busy || now - r.at < r.every) return;
    r.busy = true; r.at = now;
    fn().finally(() => (r.busy = false));
  };
  function poll(now) {
    if (state.simTime === 0) return; // (les buffers des embryons n'existent sur le GPU qu'après le premier pas)
    kin.poll(state.simTime);
    throttle(reads.embryos, now, () => sim.readEmbryos().then(onEmbryos));
    throttle(reads.needle, now, () => sim.readNeedle().then((n) => {
      state.needle = n;
      state.dustFrac = n[NR] / N;
      if (!state.paused) audio.updateDisk(n, nUsed, radiusOf, state.dustFrac);
    }));
  }

  // ── État des planètes : impacts, disparitions, gaz, sélection ─────────────
  function onEmbryos(data) {
    // impacts géants survenus depuis la dernière lecture
    const { impPos, impInfo } = data;
    const fresh = [];
    for (let k = 0; k < NIMP; k++) {
      const serial = impInfo[k * 4];
      if (serial > state.lastSerial) fresh.push({ serial, h: impInfo[k * 4 + 1], l: impInfo[k * 4 + 3], mlE: impPos[k * 4 + 3] / M_EARTH });
    }
    fresh.sort((a, b) => a.serial - b.serial);
    const absorbed = new Set(fresh.map((f) => f.l));

    const pl = readPlanets(data);
    for (const p of pl) state.reserved.delete(p.index);
    // planètes disparues sans impact : éjectées, tombées dans l'étoile ou
    // englouties par la géante rouge — leur gaz quitte le budget du disque
    const alive = new Set(pl.map((p) => p.index));
    for (const [i, p] of state.prev) {
      if (alive.has(i) || absorbed.has(i)) continue;
      state.removedGas += p.gas;
      if (life.p.starR > 0 && p.a < life.p.starR + 0.25) toast(`${nameOf(i)} est engloutie par l’étoile`);
      else if (p.a > 15) toast(`${nameOf(i)} est éjectée du système`);
    }
    state.prev = new Map(pl.map((p) => [p.index, { gas: p.gas, a: p.a }]));

    // gaz : réservoir qui se dissipe (cf. lifecycle), moins ce que les planètes ont capté
    const sumGas = pl.reduce((s, p) => s + p.gas, 0);
    const gasLeft = Math.max(0, GAS0 * life.gasEnv - (sumGas + state.removedGas));
    state.gasFrac = life.phase < 2 ? 1 : gasLeft / GAS0;
    sim.U.gasAvail.value = life.phase === 2 ? state.gasFrac : 0;

    if (state.autoSelect || !alive.has(state.selected)) {
      const heavy = pl.reduce((a, b) => (b.m > (a?.m ?? 0) ? b : a), null);
      state.selected = heavy ? heavy.index : -1;
      V.selected.value = state.selected;
    }
    state.planets = pl;

    for (const f of fresh) {
      state.lastSerial = f.serial;
      state.absorbedBy.set(f.l, f.h);
      const s = pl.find((p) => p.index === f.h);
      if (!s || state.paused || state.seek >= 0) continue;
      vis.impact(f.h, pred.get(f.h) || [s.x, s.y, s.z], f.mlE);
      evo.impact(f.h, f.mlE, s.mE);
      audio.impact(f.mlE, s.a, screenPan(s.x, s.y, s.z));
      if (meca) orrery.strike(Math.min(1, f.mlE / 2));
      // ralenti, secousse et éblouissement proportionnés à l'impacteur : les
      // petites collisions d'embryons (fréquentes au début) restent discrètes
      const big = Math.min(1, f.mlE / 2);
      state.slow = Math.max(state.slow, 0.9 * big);
      state.shake = Math.max(state.shake, Math.min(1, 0.15 + 0.6 * big));
      state.burst = Math.max(state.burst, 0.8 * big * big);
      toast(`Impact géant : ${nameOf(f.h)} absorbe ${nameOf(f.l)} (${fmtMass(f.mlE, true)})`);
    }

    evo.update(pl, state.simTime, life.p.L);
    ui.renderPlanets(pl, state.selected, state.autoSelect);
  }

  // ── Cycle de vie : du nuage à la supernova ──────────────────────────────────
  function applyLife() {
    const p = life.p, U = sim.U;
    for (const k of ['Ms', 'gasDens', 'clearOn', 'clearR', 'clearR2', 'beltLoss', 'starR', 'outR', 'snA', 'snHeat', 'snR', 'snW', 'snow']) U[k].value = p[k];
    // la nébuleuse de la supernova reste prisonnière de la cloche (sa coquille est bosselée : marge)
    vis.setStar(meca && p.shellR > BELL_R * 0.7 ? { ...p, shellR: BELL_R * 0.7 } : p);
    // versement du nuage : horloge de la phase « nuage » (au-delà, tout est lâché)
    U.pourT.value = life.phase === 0 ? life.t : 1e9;
    orrery.setStar(p.color, Math.pow(Math.max(p.L, 1e-3), 0.35), p.shell, p.starI * 0.35 * CONFIG.starHdr, p.starVisR);
  }
  function onLifeEvent(e) {
    if (e === 'ignition') {
      toast('Allumage : la fusion de l’hydrogène démarre au cœur de l’étoile');
      rig.flyHome(null, 4);
      if (state.seek < 0) { state.burst = 0.35; audio.ignition(); }
    } else if (e === 'clearing') {
      // la ceinture de débris se loge juste au-delà de la géante la plus lointaine
      // (comme la ceinture de Kuiper au-delà de Neptune), ou vers 4,5 UA sans géante
      const giants = state.planets.filter((p) => p.mE > 10 && p.a < 8.5);
      const c = Math.min(7.8, Math.max(3.2, (giants.length ? Math.max(...giants.map((p) => p.a)) : 3) * 1.5));
      life.beltIn = c * 0.85; life.beltOut = c * 1.15;
      toast('Le gaz a disparu : la lumière de l’étoile balaie le disque');
    } else if (e === 'mature') toast('Le système est formé');
    else if (e === 'giant') { toast('L’étoile a épuisé son hydrogène : elle devient une supergéante rouge'); audio.giant(); }
    else if (e === 'collapse') toast('Le cœur de fer s’effondre…');
    else if (e === 'supernova') {
      toast('Supernova ! L’étoile explose');
      sim.supernova(); // les éjecta stellaires partent
      state.burst = 1.6; state.shake = 1; audio.supernova();
      if (rig.follow >= 0) overview();
      controls.maxDistance = 140;
      setTimeout(() => rig.flyHome(new THREE.Vector3(0, 30, 70), 8), 400); // on recule pour voir l'expansion
    } else if (e === 'newcycle') startNewCycle();
  }
  // naissance des embryons pendant la formation : là où il y a de la poussière
  // (tirage pondéré par le profil radial lu sous la tête), loin des autres
  let spawnAcc = 0;
  function spawnEmbryos(dt) {
    spawnAcc += dt;
    if (spawnAcc < SPAWN_EVERY || !state.needle) return;
    spawnAcc = 0;
    const w = [];
    let tot = 0;
    for (let i = 0; i < nUsed; i++) { const r = radiusOf(i), c = r > 0.45 ? state.needle[i] * r : 0; w.push(c); tot += c; }
    if (tot <= 0) return;
    for (let attempt = 0; attempt < 6; attempt++) {
      let u = Math.random() * tot, i = 0;
      while (i < nUsed - 1 && (u -= w[i]) > 0) i++;
      const a = radiusOf(i) * (0.97 + Math.random() * 0.06);
      if (state.planets.some((q) => Math.abs(q.a - a) < 0.07 * a)) continue;
      const ph = Math.random() * Math.PI * 2;
      spawn(new THREE.Vector3(a * Math.cos(ph), 0, a * Math.sin(ph)), M_EARTH * (0.02 + Math.random() * 0.1));
      return;
    }
  }
  function startNewCycle(replay = false) {
    state.resetting = true;
    if (rig.follow >= 0) overview();
    rig.flyHome(CLOUD_VIEW, 4);
    setTimeout(() => (controls.maxDistance = 70), 4500);
    sim.reset(life.cycle).then(() => {
      Object.assign(state, { planets: [], prev: new Map(), removedGas: 0, lastSerial: 0, selected: -1, autoSelect: true });
      state.absorbedBy.clear(); state.reserved.clear();
      V.selected.value = -1;
      evo.clear(); cross.clear(); kin.reset(state.simTime);
      ui.renderPlanets([], -1, true);
      state.resetting = false;
      if (!replay) toast(`Cycle ${life.cycle + 1} : un nouveau nuage, ensemencé par la supernova`);
    });
  }

  // ── Navigation entre les phases ─────────────────────────────────────────────
  // Vers l'avant : avance rapide de la vraie simulation (le système se forme
  // pour de bon). Vers l'arrière : on recommence le cycle depuis le nuage (on
  // ne remonte pas le temps d'une vraie simulation), puis avance rapide.
  function seekTo(i) {
    i = Math.max(0, Math.min(PHASES.length - 1, i));
    if (state.resetting) return;
    if (life.phase === 6) return toast('Pendant la supernova, on regarde ! Un nouveau cycle suivra.');
    if (state.seek >= 0 && i === state.seek) return; // (déjà en route)
    if (i === life.phase && state.seek < 0) return toast(`Déjà en phase « ${PHASES[i].name} »`);
    if (i < life.phase) {
      life.restart();
      startNewCycle(true);
      if (i === 0) return;
    }
    state.seek = i;
    audio.setMuted(true, true);
    ui.setSeeking(true);
    toast(`Avance rapide vers « ${PHASES[i].name} »…`, true);
  }
  function endSeek() {
    state.seek = -1;
    audio.setMuted(audio.muted, false);
    ui.setSeeking(false);
    ui.hideToast();
    toast(PHASES[life.phase].name, true);
    rig.flyHome(life.phase === 0 ? CLOUD_VIEW : null, 2.5);
  }

  // ── Résolution adaptative ───────────────────────────────────────────────────
  // Si l'image moyenne dépasse 1/55 s pendant 2 s, la densité de pixels baisse
  // d'un cran ; s'il reste de la marge, elle remonte.
  const PR_STEPS = [...new Set([1, 1.25, 1.5, 1.75, 2].filter((p) => p < MAX_PR).concat(MAX_PR))];
  let prIdx = PR_STEPS.length - 1, prAcc = 0, prN = 0, prCool = 0;
  function adaptResolution(real) {
    if (real <= 0) return;
    prAcc += real; prN++; prCool = Math.max(0, prCool - real);
    if (prAcc < 2) return;
    const mean = prAcc / prN;
    prAcc = 0; prN = 0;
    if (prCool > 0 || state.paused) return;
    const next = mean > 1 / 55 ? Math.max(0, prIdx - 1) : mean < 1 / 100 ? Math.min(PR_STEPS.length - 1, prIdx + 1) : prIdx;
    if (next === prIdx) return;
    prIdx = next; prCool = 4;
    renderer.setPixelRatio(PR_STEPS[prIdx]);
    renderer.setSize(innerWidth, innerHeight);
  }

  // ── Profilage (?prof) ─────────────────────────────────────────────────────
  const prof = { n: 0, loop: 0, poll: 0 };
  function profile(t0, t1) {
    prof.loop += t1 - t0; prof.poll += performance.now() - t1;
    if (++prof.n % 30) return;
    window.__profJs = { loop: (prof.loop / 30).toFixed(2), poll: (prof.poll / 30).toFixed(2), drawCalls: renderer.info.render.drawCalls };
    prof.loop = prof.poll = 0;
    Promise.all([renderer.resolveTimestampsAsync('compute'), renderer.resolveTimestampsAsync('render')])
      .then(() => { window.__prof = { compute: renderer.info.compute.timestamp, render: renderer.info.render.timestamp }; });
  }

  // ── Boucle ─────────────────────────────────────────────────────────────────
  // La simulation attend qu'on entre : tant que l'accueil est affiché, rien ne
  // tourne (ni calcul, ni rendu).
  let last = performance.now(), frameCount = 0;
  const _fp = new THREE.Vector3(), _camV = new THREE.Vector3(), _camPrev = new THREE.Vector3();
  const hooks = (window.__filmHooks = {}); // (pilotage par film.js)
  const frame = (now) => {
    if (!ui.introGone) { last = now; return; }
    const t0 = CONFIG.prof ? performance.now() : 0;
    const real = Math.min(0.1, Math.max(0, (now - last) / 1000)); // (l'horodatage rAF peut précéder `last`)
    last = now;
    if (!FILM) adaptResolution(real);
    const running = !state.paused && !state.resetting;

    // Temps simulé indexé sur le temps réel (0,96 unité/s à ×1), ralenti après
    // un impact géant. Plafonné : si le GPU ne suit pas en accéléré, le temps
    // ralentit au lieu de demander toujours plus de sous-pas. La supernova se
    // joue au plus à ×1.
    state.slow = Math.max(0, state.slow - real / 2.6);
    const timeScale = 1 - 0.8 * Math.pow(state.slow, 0.7);
    const spd = life.phase === 6 ? Math.min(1, state.speed) : state.speed;
    let frameTime = Math.min(0.066 * CONFIG.warp, Math.min(0.05, real) * 0.96 * spd * timeScale * CONFIG.warp);
    if (FILM) frameTime = (hooks.dtSim || 0) * timeScale;
    if (state.seek >= 0 && !state.resetting) { // avance rapide vers une phase : grands pas
      if (life.phase >= state.seek) endSeek();
      else frameTime = 0.4;
    }
    sim.maxDtP = (FILM && hooks.maxDtP) || (state.seek >= 0 ? 0.03 : 0.011);

    // cycle de vie : paramètres de l'étoile et du disque, événements
    if (running) {
      const evs = life.update(frameTime, real, state.gasFrac);
      applyLife();
      for (const e of evs) onLifeEvent(e);
      if (life.p.spawn) spawnEmbryos(frameTime);
    }
    if (++frameCount % 8 === 0) ui.renderLife(life, state.seek);

    let dtSim = 0;
    if (running && frameTime > 0) {
      dtSim = frameTime;
      state.simTime += dtSim;
      updateFlyby(dtSim);
      sim.step(dtSim);
    }
    // positions de l'instant présent, PUIS caméra : sinon elle aurait une image de retard
    kin.predict(state.simTime);
    if (!state.paused) detectCrossings();
    if (FILM) hooks.camera?.(real);
    else {
      // planète suivie absorbée : on suit celle qui l'a avalée (l'info arrive un
      // peu après), sinon, passé un délai, retour à la vue d'ensemble
      if (rig.follow >= 0 && kin.ready && !pred.has(rig.follow)) {
        const heir = state.absorbedBy.get(rig.follow);
        state.lostFor += real;
        if (heir !== undefined && pred.has(heir)) { rig.follow = heir; select(heir); state.lostFor = 0; }
        else if (state.lostFor > 0.6) { state.lostFor = 0; overview(); }
      } else state.lostFor = 0;
      rig.update(real, rig.follow >= 0 ? followPos(_fp) : null);
      controls.update();
    }
    vis.updateFx(state.paused && !FILM ? 0 : real, (i) => pred.get(i)); // (au tournage, les effets s'éteignent même à l'arrêt)
    if (meca) {
      orrery.update(state.planets, pred, dtSim, real, running, life, V.planetK.value, { t: life.phase === 0 ? life.t : 1e9, dur: sim.U.pourDur.value });
      if (!state.resetting) V.collect.value = orrery.collect;
    }

    // objectif : mise au point sur la planète suivie, sinon sur le centre visé
    const fd = camera.position.distanceTo((rig.follow >= 0 && followPos(_fp)) || controls.target);
    V.focus.value += (fd - V.focus.value) * Math.min(1, real * 4);
    V.focusRange.value = Math.max(0.2, V.focus.value * 0.28);
    // obturation : un peu plus d'une image de temps simulé ; traînées relatives à la caméra
    V.shutter.value = CONFIG.lens ? dtSim * 1.6 : 0;
    if (dtSim > 0) V.camVel.value.lerp(_camV.subVectors(camera.position, _camPrev).divideScalar(dtSim), 0.5);
    _camPrev.copy(camera.position);
    // (bloom plafonné à l'éclat de l'étoile avant le surplus HDR ; suit starI : la supernova garde son éclair)
    V.bloomCap.value = HDR ? Math.max(2, V.starI.value * V.starK.value * 1.6) : 1e4;
    if (vis.updatePulsar(state.paused ? 0 : real)) audio.pulsarTick(); // un faisceau nous balaie : « tic »

    // bouffée d'exposition : tout le système s'illumine un instant
    state.burst = Math.max(0, state.burst - real * 1.4);
    const b2 = state.burst * state.burst;
    V.exposure.value = CONFIG.exposure * (meca ? 1.25 : 1) * (1 + (rig.follow >= 0 ? 0.3 : 0.9) * b2 * (state.burst > 1 ? 3 : 1));

    state.shake = Math.max(0, state.shake - real * 1.2);
    rig.shake(state.shake);
    hooks.before?.();
    if (!hooks.skipRender) hooks.render ? hooks.render() : vis.pipeline.render();
    hooks.after?.();
    rig.unshake();
    const t1 = CONFIG.prof ? performance.now() : 0;
    poll(now);
    if (CONFIG.prof) profile(t0, t1);
  };

  if (CONFIG.auto) ui.closeIntro();
  if (FILM) {
    window.__frame = frame; // (film.js appelle frame(t) lui-même, image par image)
    document.body.classList.add('film');
    audio.setMuted(true);
    import('./film.js').then((m) => m.startFilm({ THREE, renderer, camera, controls, state, life, sim, vis, orrery, pred, frame, PHASES }))
      .catch((e) => { console.error(e); window.__filmError = String(e?.stack || e); });
  } else renderer.setAnimationLoop(frame);
  window.__planetaire = { sim, state, renderer, audio, launchFlyby, pred, vis, life, orrery, camera, controls, rig }; // (débogage)
}

main().catch((e) => { console.error(e); fail('Erreur d’initialisation : ' + e.message); });
