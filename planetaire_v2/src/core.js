// Le cœur d'Orrery : la scène, sa recette (orbites, machines, les trois mondes
// emboîtés) et le rendu d'un instant de la plongée. C'est la source unique du
// rendu, partagée par la page (main.js : recherche des orbites sous les yeux,
// écran de chargement et son atterrissage, panneau, URL, export) et par la
// méga-scène (day.js : le relais). Retoucher la plongée, la caméra, la mise au
// point ou la chaîne d'image se fait ici, et vaut pour les deux.
//
// Orrery est d'avant le gabarit commun : ses modules sont des variantes
// locales (pool de workers de recherche, studios, chaîne d'image), sans
// globales partagées.
//
// createCore({ renderer, width, height, gen, lite, RENDER, S, onRoot })
//   gen    : le pool de workers de recherche (orbit/client.js)
//   RENDER : les réglages de rendu, lus à chaque image (la page passe ceux du
//            panneau, qu'elle modifie en place ; le relais, ceux par défaut)
//   S      : l'objet d'état où ranger celui de la plongée (la page y ajoute le
//            sien : pause, chargement…) ; défaut : un objet neuf
//   onRoot : appelé quand le monde courant change (la page y met sa légende)
// → { scene, camera, root, post, gen, S, R, orbits, M, use, searchLayer,
//     designOf, buildWorlds, setTime, render, setRecipe, renderAt, isReady,
//     progress, duration, warmPhases, applyRender, applyLive, dispose }
// use(R) : la recette courante (la page la change elle-même, puis cherche les
//   orbites et construit les mondes pas à pas, sous son écran de chargement)
// setRecipe(R, { yieldFn }) → promesse (relais) : toute la préparation d'un
//   coup — recherche des trois orbites (sans le spectacle de la page),
//   conception des machines, construction des mondes ; true quand la scène est
//   posée, false si une autre recette l'a remplacée.
// setTime(τ, { push, free }) : l'état complet à l'instant τ (en couches) ;
// render() : un dessin (et les matrices de l'image précédente, pour les vitesses)
// renderAt(u, { push, sub, free }) : u en part de la boucle entière (déroulée) ;
// push ∈ [0, 1) avance la caméra vers ce qu'elle regarde (passages du relais) ;
// sub : sans objet ici (pas de rendu accumulé) ; free : caméra libre (la page
// l'a aussi par la recette, R.motion.free, et OrbitControls).
import * as THREE from 'three/webgpu';
import { createWorld } from './scene/world.js';
import { createPost } from './render/post.js';
import { SHADOWS } from './app/settings.js';
import { orbitOverrides } from './recipe.js';
import { withPivots } from './mech/design.js';

const TAU = Math.PI * 2;
const ss5 = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (t * 6 - 15) + 10); };
const SEARCH_TIMEOUT = 40000;
const TRIES = 6;
// trois mondes emboîtés : le monde m est la couche m de la recette
const INST = 3;

export async function createCore({ renderer, width, height, gen: pool, lite = false, RENDER, S: state = null, onRoot = null }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050403);
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.01, 60);
  const root = new THREE.Group(); // reçoit la similitude de la plongée
  scene.add(root);
  const post = createPost(renderer, scene, camera, null);

  const S = Object.assign(state ?? {}, { worlds: [], k: [], target: [], tau: 0, root: -1 });
  let R = null;
  const use = (r) => (R = r);
  const M = () => INST;
  const layerOf = (m) => m % R.layers.length;
  const layerSeed = (m) => (layerOf(m) ? `${R.seed}/${layerOf(m)}` : R.seed);
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

  // ── recherche de l'orbite d'une couche : jusqu'à six graines (la suivante
  // quand une graine ne donne aucune chorégraphie). onBegin(graine, essais),
  // onStatus(texte), onSnap(i, instantané), onTry(i, essai) : le spectacle de
  // la page ; sans onSnap, les workers n'envoient pas d'instantanés (relais).
  // → { ok: true, orbit } | { ok: false, message, error } | { ok: false, stale }
  async function searchLayer(m, { onBegin = null, onStatus = null, onSnap = null, onTry = null, alive = () => true } = {}) {
    let seed = layerSeed(m), r = null;
    for (let tries = 0; tries < TRIES; tries++) {
      onStatus?.(tries ? `la graine précédente n’a donné aucune chorégraphie : nouvelle graine (${tries + 1} / ${TRIES})` : '');
      try {
        onBegin?.(seed, 24);
        r = await pool.search(seed, { maxAttempts: 24, timeout: SEARCH_TIMEOUT, over: { ...orbitOverrides(R.layers[m]), maxArms: 14 }, onSnap, onTry });
      } catch (e) {
        if (!alive()) return { ok: false, stale: true };
        return { ok: false, error: e, message: `La recherche d’orbite a échoué (${e.message}).` };
      }
      if (!alive()) return { ok: false, stale: true };
      if (r.ok) return { ok: true, orbit: r.orbit };
      if (r.reason === 'timeout') return { ok: false, message: 'La recherche d’orbite a pris trop de temps (plus de 40 s). Ces contraintes sont peut-être trop difficiles.' };
      seed = `${seed}+`;
    }
    return { ok: false, message: `Aucune orbite trouvée avec ces contraintes (${TRIES} graines essayées).` };
  }

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
  // yieldFn : l'attente entre deux mondes (défaut : une tâche) ; donnée, elle
  // sépare aussi le calcul des passages (relais : l'image suivante de l'hôte,
  // le jour qui joue ne doit pas sauter d'image)
  async function buildWorlds(onStep = null, yieldFn = null) {
    const sh = SHADOWS[RENDER.shadows] || SHADOWS.high;
    const made = [];
    await Promise.all(R.layers.map((_, l) => designOf(orbits[l]))); // (un worker par machine)
    try {
      for (let m = 0; m < INST; m++) {
        if (onStep) { onStep(m); await (yieldFn ? yieldFn() : new Promise((res) => setTimeout(res, 0))); }
        // calque 1 + m : la lampe de chaque monde n'ombre que lui
        made.push(createWorld({ orbit: orbits[layerOf(m)], L: R.layers[layerOf(m)], lite, shadows: sh, seed: layerSeed(m), layer: 1 + m, design: designs.get(orbits[layerOf(m)]), hold: () => R.motion.hold }));
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
    if (yieldFn) {
      const ps = [];
      for (let m = 0; m < S.worlds.length; m++) { await yieldFn(); ps.push(passage(m)); }
      S.passage = ps;
    } else S.passage = S.worlds.map((W, m) => passage(m));
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
    return { yaw: best.yaw, clear: best.clear, samples: path.length, a0, sp };
  }

  // ── la plongée : état complet à l'instant τ (pure fonction de τ)
  // push : la caméra avance vers ce qu'elle regarde (relais), la mise au point
  // suit (× (1 − push)) ; free : la caméra n'est pas posée
  const tmp = new THREE.Vector3();
  function setTime(tau, { push = 0, free = false } = {}) {
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
      onRoot?.();
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
      for (const G of W.globes) G.mount.group.rotation.y = 0;
    }
    const Ps = S.passage?.[a];
    if (Ps && u > h) {
      const G = Wa.globes[S.target[a]];
      const x = Math.min(1, (u - h) / RING_STOP);
      G.mount.rings.forEach((r, i) => { r.rotation.y = Ps.a0[i] + Ps.sp[i] * RING_STOP * (x - x * x / 2); });
      G.mount.group.rotation.y = Ps.yaw * ss5(s / 0.5);
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
    if (!R.motion.free && !free) {
      const pose = basePose(a, u, b, s);
      camera.position.copy(pose.pos);
      if (push) camera.position.lerp(pose.target, push); // (relais)
      camera.lookAt(pose.target);
      if (Math.abs(camera.fov - pose.fov) > 1e-4) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
      const g = new THREE.Vector3().copy(p).sub(tr).multiplyScalar(1 / ks); // boule visée, dans l'image
      const focusPt = pose.target.clone().lerp(g, ss5(s * 3));
      post.U.focus.value = pose.pos.distanceTo(focusPt) * (1 - push);
      post.U.focusRange.value = RENDER.focusSpread * post.U.focus.value;
    }
  }

  // ── Réglages à vif
  function applyLive() {
    const Wa = S.worlds[Math.max(0, S.root)];
    if (Wa) post.U.warmth.value = RENDER.warmth + Wa.L.light.warmth;
  }
  function applyRender() {
    post.update({ ...RENDER, lite, focus: post.U.focus.value, focusRange: post.U.focusRange.value, warmth: RENDER.warmth }, null);
    applyLive();
  }

  // Un dessin. (Ombres douces : la page les pose une fois pour toutes ; dans le
  // relais, le moteur est commun et ses ombres sont « PCF » — on pose les
  // nôtres le temps du dessin, elles entrent dans la clé de nos shaders.)
  // (anticrénelage temporel, flou de mouvement : les pièces instanciées gardent
  // leurs matrices de l'image précédente, pour leurs vitesses)
  function render() {
    const type = renderer.shadowMap.type;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    try { post.render(); } finally { renderer.shadowMap.type = type; }
    if (RENDER.aa === 'traa' || RENDER.motionBlur > 0) for (const W of S.worlds) W.machine.afterRender();
  }
  // u : part de la boucle entière (trois plongées), déroulée
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    setTime(u * R.layers.length, { push, free });
    render();
  }

  // ── Préparation complète d'une recette (relais) : la recherche, sans le
  // spectacle de la page (pas d'instantanés ni d'atterrissage), puis les
  // machines et les mondes ; seul le résultat en boucle sert.
  let version = 0, found = 0, built = false;
  async function setRecipe(r, { yieldFn = null } = {}) {
    const v = ++version, alive = () => v === version;
    use(r);
    orbits.length = 0; found = 0; built = false;
    for (let m = 0; m < R.layers.length; m++) {
      const res = await searchLayer(m, { alive });
      if (!alive()) return false;
      if (!res.ok) throw res.error ?? new Error(res.message);
      orbits[m] = res.orbit;
      found++;
    }
    await Promise.all(R.layers.map((_, l) => designOf(orbits[l])));
    if (!alive()) return false;
    await buildWorlds(() => {}, yieldFn);
    if (!alive()) return false;
    S.root = -1;
    setTime(0);
    built = true;
    return true;
  }

  // (les six moments qui comptent : avant et en fin de plongée, dans chacun
  // des trois mondes ; en part de la boucle entière)
  function warmPhases() {
    const out = [];
    for (let d = 0; d < M(); d++) out.push((d + 0.97) / R.layers.length, (d + R.motion.hold * 0.5) / R.layers.length);
    return out;
  }

  return {
    scene, camera, root, post, gen: pool, S, orbits, M,
    get R() { return R; },
    use, searchLayer, designOf, buildWorlds, setTime, render, renderAt, setRecipe, applyRender, applyLive, warmPhases,
    isReady: () => built && S.worlds.length > 0,
    // (les orbites, une par couche, puis les machines et les mondes)
    progress: () => (built ? 1 : 0.85 * (found / (R?.layers.length || 3))),
    duration: () => R.motion.segment * R.layers.length,
    // (les mondes : leurs studios, leurs machines et leurs atmosphères)
    dispose() { for (const W of S.worlds) W.dispose(); },
  };
}
