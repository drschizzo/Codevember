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
import { createWorld } from './scene/world.js';
import { createPost } from './render/post.js';
import { exportLoop, exportPNG } from './app/capture.js';
import { createLoader } from './app/loader.js';
import { createUI } from './app/ui.js';
import { loadRender, saveRender, applyQuality, defaultsFor, SHADOWS } from './app/settings.js';
import { wantsMobile, switchMobile, createGovernor, createPacer, bindTouch } from './app/mobile.js';
import { generate, generateLayer, upgrade, orbitOverrides, packRecipe, unpackRecipe, MOODS } from './recipe.js';
import { createRng } from './rng.js';
import { withPivots } from './mech/design.js';

const TAU = Math.PI * 2;
const params = new URLSearchParams(location.search);
const DEFAULT_SEED = '17';
const $ = (s) => document.querySelector(s);
const randomSeed = () => Math.random().toString(36).slice(2, 8);
const ss5 = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (t * 6 - 15) + 10); };

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

  const post = createPost(renderer, scene, camera, null);

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
  // trois mondes emboîtés : le monde m est la couche m de la recette
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
      // le plus court chemin d'un azimut à l'autre, choisi une fois pour toute la
      // plongée sur les angles de base des deux couches : choisi à chaque instant
      // (les deux azimuts balancent avec u), il changeait de sens quand l'écart
      // passait par un demi-tour, et la caméra sautait de l'autre côté de la boule
      const a0 = R.layers[layerOf(m)].camera.az, b0 = R.layers[layerOf(next)].camera.az;
      const dAz = Math.atan2(Math.sin(b0 - a0), Math.cos(b0 - a0)) + (B.az - b0) - (A.az - a0);
      az = A.az + dAz * s; el = A.el + (B.el - A.el) * s;
    }
    // la caméra reste dans la coque du monde (rayon RG) : au-delà, on élargit le champ
    // (cadrage serré : la machine et le début de la couronne)
    const frame = (W) => Math.max(W.machine.bezelR * 0.82, W.machine.bodyReach + 0.1);
    const pr = S.worlds[m] ? frame(S.worlds[m]) : 1.6;
    const prN = next !== null && S.worlds[next] ? frame(S.worlds[next]) : pr;
    const want = fitFor(pr + (prN - pr) * s), r = Math.min(want, 4.3);
    const pos = new THREE.Vector3(Math.cos(az) * Math.cos(el) * r, -0.16 + Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r);
    return { pos, target: new THREE.Vector3(0, -0.16, 0), fov: want > 4.3 ? 30 * (want / 4.3) : 30 };
  }

  // ── la boule visée dans l'image pendant la plongée. Le monde subit la
  // similitude x → (x − tr) / kˢ ; avec tr = p·(1 − kˢ·a(s)), la boule (en p,
  // qui bouge : elle suit son orbite) est dessinée en p·a(s). a vaut 1 au début
  // (rien ne bouge quand la plongée commence) et 0 bien avant la fin : la boule
  // glisse vers le centre de l'image tant qu'elle est petite, puis y reste
  // fixée pendant qu'elle grandit. (Avec un zoom de point fixe p, a(s) =
  // (kˢ − k) / (kˢ·(1 − k)) : la boule ne se centrait qu'à la toute fin, et
  // remplissait déjà l'image en se promenant encore au gré de son orbite ; la
  // caméra semblait la chercher.) À s = 1, tr = p : le raccord est inchangé.
  const glide = (s) => 1 - ss5(s / 0.5);

  // ── construction des mondes (après la recherche des orbites)
  // (onStep(i) : un monde de plus est construit ; la construction peut échouer :
  // l'ancienne scène reste alors en place)
  // conceptions des machines, par orbite (calculées dans un worker, une seule
  // fois pour les trois mondes et pour les réglages qui suivent)
  const designs = new WeakMap();
  async function designOf(orbit) {
    if (!designs.has(orbit)) designs.set(orbit, withPivots(await pool.design(orbit)));
    return designs.get(orbit);
  }
  async function buildWorlds(onStep = null) {
    const sh = SHADOWS[RENDER.shadows] || SHADOWS.high;
    const made = [];
    await Promise.all(R.layers.map((_, l) => designOf(orbits[l]))); // (un worker par machine)
    try {
      for (let m = 0; m < INST; m++) {
        if (onStep) { onStep(m); await new Promise((res) => setTimeout(res, 0)); }
        // calque 1 + m : la lampe de chaque monde n'ombre que lui
        made.push(createWorld({ orbit: orbits[layerOf(m)], L: R.layers[layerOf(m)], lite: LITE, shadows: sh, seed: layerSeed(m), layer: 1 + m, design: designs.get(orbits[layerOf(m)]), hold: () => R.motion.hold }));
      }
    } catch (e) {
      for (const W of made) W.dispose();
      throw e;
    }
    for (const W of S.worlds) { W.group.removeFromParent(); W.dispose(); }
    S.worlds = made;
    // les lumières de chaque monde, dans un ordre fixe (voir world.js)
    for (const W of S.worlds) scene.add(W.rig);
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
    S.worlds.forEach((W, m) => W.setTarget(S.target[m]));
    S.passage = S.worlds.map((W, m) => passage(m));
    S.root = -1;
    applyLive();
  }

  // ── la monture de la boule visée livre passage à la caméra. Au début de la
  // plongée, ses anneaux ralentissent et s'arrêtent, et la cage pivote (autour
  // de la verticale) jusqu'à présenter un vide sur la trajectoire de la caméra :
  // celle-ci passe entre les montants, et la monture sort du cadre d'elle-même.
  // La trajectoire est connue d'avance (tout ne dépend que de τ) : on
  // l'échantillonne là où elle traverse la monture et l'on cherche l'angle qui
  // l'en écarte le plus, en tournant le moins possible.
  const RING_STOP = 0.15; // (durée, en couche, du ralentissement des anneaux)
  function passage(m) {
    const W = S.worlds[m], j = S.target[m], G = W.globes[j], h = R.motion.hold, k = S.k[m];
    const next = (m + 1) % M();
    // anneaux : angle et vitesse au début de la plongée, angle d'arrêt
    W.update(h);
    const a0 = G.mount.rings.map((r) => r.rotation.y);
    W.update(h + 1e-3);
    const sp = G.mount.rings.map((r, i) => (r.rotation.y - a0[i]) / 1e-3);
    const stop = a0.map((a, i) => a + sp[i] * RING_STOP * 0.5);
    // sommets de la monture (dans son repère, anneaux arrêtés)
    G.mount.rings.forEach((r, i) => { r.rotation.y = stop[i]; });
    if (G.mount.lid) G.mount.lid.position.y = G.mount.lift; // (couvercle soulevé)
    G.mount.group.rotation.y = 0;
    G.mount.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(G.mount.group.matrixWorld).invert(), mm = new THREE.Matrix4(), v = new THREE.Vector3();
    const verts = [];
    let total = 0;
    G.mount.group.traverse((o) => { if (o.isMesh) total += o.geometry.attributes.position.count; });
    const step = Math.max(1, Math.ceil(total / 1500));
    G.mount.group.traverse((o) => {
      if (!o.isMesh) return;
      mm.multiplyMatrices(inv, o.matrixWorld);
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += step) verts.push(v.fromBufferAttribute(pos, i).applyMatrix4(mm).clone());
    });
    // trajectoire de la caméra dans le repère du monde, relative à la boule
    const path = [];
    for (let q = 0; q <= 200; q++) {
      const u = h + (1 - h) * (q / 200), s = ss5((u - h) / (1 - h)), ks = Math.pow(k, s);
      W.update(u);
      const p = W.local[j];
      const cam = basePose(m, u, next, s).pos.multiplyScalar(ks).add(p.clone().multiplyScalar(1 - ks * glide(s)));
      const rel = cam.sub(p);
      const d = rel.length();
      if (d > W.rg * 0.85 && d < W.rg * 1.8) path.push(rel);
    }
    let best = { yaw: 0, score: -Infinity };
    const cand = [];
    if (path.length && verts.length) {
      for (let q = 0; q < 144; q++) {
        const yaw = ((q / 144) * 2 - 1) * Math.PI, c = Math.cos(yaw), sn = Math.sin(yaw);
        let dmin = Infinity;
        for (const p of path) for (const w of verts) {
          // (rotation de la monture d'angle yaw autour de y)
          const x = w.x * c + w.z * sn, z = -w.x * sn + w.z * c;
          const d = Math.hypot(x - p.x, w.y - p.y, z - p.z);
          if (d < dmin) dmin = d;
        }
        cand.push({ yaw, score: Math.min(dmin, W.rg * 0.4), clear: dmin / W.rg });
      }
      // parmi les angles presque aussi dégagés que le meilleur, le plus petit
      // (les montures ont des symétries : beaucoup d'angles se valent)
      const top = Math.max(...cand.map((c) => c.score));
      best = cand.filter((c) => c.score >= top - 0.03 * W.rg).sort((x, y) => Math.abs(x.yaw) - Math.abs(y.yaw))[0];
    }
    if (G.mount.lid) G.mount.lid.position.y = 0;
    return { yaw: best.yaw, clear: best.clear, samples: path.length, a0, sp };
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
      for (const W of S.worlds) { W.group.removeFromParent(); W.group.visible = true; }
      for (const W of S.worlds) for (const G of W.globes) if (G.mini) G.mini.visible = true;
      root.add(Wa.group); Wa.group.scale.setScalar(1);
      const Ga = Wa.globes[S.target[a]], Gb = Wb.globes[S.target[b]];
      Ga.inner.add(Wb.group); Wb.group.scale.setScalar(S.k[a]); Ga.mini.visible = false;
      if (Mn > 2) { Gb.inner.add(Wc.group); Wc.group.scale.setScalar(S.k[b]); }
      scene.background.copy(Wa.bg);
      caption();
      applyLive();
    }
    Wa.update(u);
    Wb.update(u - 1);
    if (Mn > 2) Wc.update(u - 2);
    // similitude : zoom sur la boule visée, qui glisse vers le centre de l'image (voir glide)
    const h = R.motion.hold, s = ss5((u - h) / (1 - h)), k = S.k[a];
    const p = Wa.local[S.target[a]];
    const ks = Math.pow(k, s), tr = tmp.copy(p).multiplyScalar(1 - ks * glide(s));
    root.scale.setScalar(1 / ks);
    root.position.copy(tr).multiplyScalar(-1 / ks);
    // la monture de la boule visée s'efface quand on s'en approche, puis son
    // verre quand il remplit l'image ; tout revient à l'identique d'une couche à
    // l'autre (ce sont les réglages du monde courant ; les autres sont pleins)
    for (const W of [Wa, Wb, Wc]) {
      W.glassFade.value = 1;
      for (const G of W.globes) { G.mount.group.rotation.y = 0; if (G.mount.lid) G.mount.lid.position.y = 0; }
    }
    const Ps = S.passage?.[a];
    if (Ps && u > h) {
      const G = Wa.globes[S.target[a]];
      const x = Math.min(1, (u - h) / RING_STOP);
      G.mount.rings.forEach((r, i) => { r.rotation.y = Ps.a0[i] + Ps.sp[i] * RING_STOP * (x - x * x / 2); });
      G.mount.group.rotation.y = Ps.yaw * ss5(s / 0.5);
      if (G.mount.lid) G.mount.lid.position.y = G.mount.lift * ss5(s / 0.5);
    }
    Wa.glassFade.value = 1 - ss5((s - 0.45) / 0.4);
    // échelle de chaque monde dans l'image : chaque monde n'est éclairé que par
    // ses propres lumières, à son échelle (intensité × échelle²) : rien ne
    // s'allume ni ne s'éteint, la plongée est auto-similaire
    const sa = 1 / ks, sb = k / ks, sc = sb * S.k[b];
    Wa.setScale(sa); Wb.setScale(sb);
    if (Mn > 2) {
      // le troisième monde n'occupe que quelques pixels tant qu'on n'a pas
      // plongé : sa miniature suffit (des milliers d'appels de dessin en moins)
      const show = sc > 0.3 * S.k[b];
      Wc.group.visible = show;
      Wb.globes[S.target[b]].mini.visible = !show;
      Wc.setScale(sc, show);
    }
    for (let m = 0; m < Mn; m++) S.worlds[m].syncRig();
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

  // ── recherche des orbites de toutes les couches (sous les yeux), puis les mondes.
  // Chaque échec (aucune orbite, essai planté, machine impossible à construire,
  // recherche trop longue) est dit à l'écran, avec de quoi repartir : une autre
  // graine, réessayer, ou revenir à la dernière scène qui marchait.
  const SEARCH_TIMEOUT = 40000;
  function fail(msg, err) {
    if (err) console.error(err);
    S.busy = !S.worlds.length;
    S.loading = false; pipes.on = false;
    const actions = [{ label: 'Autre graine', run: () => on.random() }, { label: 'Réessayer', run: () => { orbits.length = 0; load(); } }];
    if (S.good) actions.push({ label: 'Revenir à la scène précédente', run: () => restoreGood() });
    loader.error(msg, actions);
  }
  function restoreGood() {
    R = JSON.parse(JSON.stringify(S.good.R));
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
      let seed = layerSeed(m), r = null;
      const TRIES = 6;
      for (let tries = 0; tries < TRIES; tries++) {
        loader.status(tries ? `la graine précédente n’a donné aucune chorégraphie : nouvelle graine (${tries + 1} / ${TRIES})` : '');
        try {
          loader.begin(seed, 24);
          r = await pool.search(seed, { maxAttempts: 24, timeout: SEARCH_TIMEOUT, over: { ...orbitOverrides(R.layers[m]), maxArms: 14 }, onSnap: (i, sn) => loader.snap(i, sn), onTry: (i, res) => loader.result(i, res) });
        } catch (e) {
          if (run !== S.run) return;
          return fail(`La recherche d’orbite a échoué (${e.message}).`, e);
        }
        if (run !== S.run) return;
        if (r.ok) break;
        if (r.reason === 'timeout') return fail('La recherche d’orbite a pris trop de temps (plus de 40 s). Ces contraintes sont peut-être trop difficiles.');
        seed = `${seed}+`;
      }
      if (!r.ok) return fail(`Aucune orbite trouvée avec ces contraintes (${TRIES} graines essayées).`);
      orbits[m] = r.orbit;
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

  // (anticrénelage temporel, flou de mouvement : les pièces instanciées gardent
  // leurs matrices de l'image précédente, pour leurs vitesses)
  const endFrame = () => { if (RENDER.aa === 'traa' || RENDER.motionBlur > 0) for (const W of S.worlds) W.machine.afterRender(); };

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
    if (!S.loading) { post.render(); endFrame(); }
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
        renderAt: (v) => { setTime(v * R.layers.length); post.render(); endFrame(); },
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

  if (params.has('debug')) window.chor = { marks, pipes, warm, loader, S, get R() { return R; }, setTime, render: () => post.render(), renderer, scene, camera, controls, post, load, on, root };
  load();
}

main();
