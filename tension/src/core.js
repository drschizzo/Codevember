// Le cœur de Tension : la scène, sa recette et le rendu d'une phase. C'est la
// source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement, export) et par la méga-scène (day.js : le relais).
// Retoucher la troupe, le film, le montage, la caméra, l'éclairage ou la
// chaîne d'image se fait ici, et vaut pour les deux.
//
// createCore({ renderer, width, height, gen, lite, RENDER, relay })
//   gen    : le pool de workers de génération (shared/gen/client.js)
//   RENDER : les réglages de rendu, lus à chaque image (la page passe ceux du
//            panneau, qu'elle modifie en place ; le relais, ceux par défaut)
//   relay  : d'autres jours posent leurs propres réglages des matériaux
//            communs (mode léger, volume de bruit) pendant nos simulations :
//            on reprend les nôtres juste avant de construire la scène
// → { scene, camera, stage, post, R, film, shot, setRecipe, syncEnv,
//     renderAt, isReady, progress, duration, warmPhases, applyRender }
// setRecipe(R, { onSim(p, label), onFilm(lead, T) }) → promesse : true quand
//   la scène est posée, false si une autre recette l'a remplacée ; onSim :
//   avancement de la simulation de tête, onFilm : son film est prêt (les pièces
//   tournées commencent)
// renderAt(u, { push, sub, free }) : push ∈ [0, 1) avance la caméra vers ce
// que regarde le plan (passages du relais) ; sub : décalages d'un rendu
// accumulé ; free : caméra libre (la page la pose elle-même, OrbitControls).
import * as THREE from 'three/webgpu';
import { createStage, partSpecs } from './scene/stage.js';
import { makeFilm } from './gen/film.js';
import { makeTroupe } from './gen/troupe.js';
import { makeShot, cameraAt, makeMontage } from './scene/shot.js';
import { makeEnvironment } from '../../shared/scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from '../../shared/scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { createHandheld } from '../../shared/scene/handheld.js';

// le résultat du worker (tableaux à plat) → la forme attendue par makeFilm
function unpackSim(o) {
  const frames = [], rests = [];
  for (let k = 0; k < o.nf; k++) { frames.push(o.frames.subarray(k * o.N * 3, (k + 1) * o.N * 3)); rests.push(o.rests.subarray(k * o.NC, (k + 1) * o.NC)); }
  return { ...o, frames, rests };
}

export async function createCore({ renderer, width, height, gen, lite = false, RENDER, relay = false }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 80);
  const noise = await gen.request({ seed: 'tension-noise' }, 'noise');
  setLite(lite); // (lu à la construction des matériaux ; après l'attente : un autre jour a pu poser le sien)
  setNoiseVolume(noise); // (les matériaux en dépendent)
  const stage = createStage(scene, { lite });
  let film = null, shot = null, montage = null, lastShot = 0;
  const post = createPost(renderer, scene, camera);

  let R = null, envKey = '';
  function syncEnv() {
    const k = R.env.preset;
    if (k === envKey) return;
    envKey = k;
    const old = scene.environment;
    scene.environment = makeEnvironment(k, 0, lite ? 512 : 1024);
    old?.dispose();
  }

  // ── Préparation d'une recette ──
  let version = 0, simProgress = 0, applied = false;
  function setRecipe(recipe, { onSim, onFilm } = {}) {
    const v = ++version;
    R = recipe;
    simProgress = 0; applied = false;
    // 1. les simulations (workers) : forme, allure, cycle limite, enregistrement.
    // Une troupe en demande une par espèce, menées de front ; deux membres de
    // la même espèce partagent la leur.
    for (const m of recipe.troupe ?? []) if (m.lead) { m.sim = recipe.sim; m.family = recipe.family; } // (le panneau retouche l'allure de la sculpture de tête)
    const troupe = recipe.troupe?.length > 1 ? recipe.troupe : null;
    const specs = new Map();
    // (clés prises maintenant : le panneau complète ensuite la recette de ses réglages par défaut)
    const keys = (troupe ?? [{ sim: recipe.sim }]).map((m) => JSON.stringify(m.sim));
    (troupe ?? [{ sim: recipe.sim }]).forEach((m, i) => specs.set(keys[i], JSON.parse(keys[i])));
    const leadKey = JSON.stringify(recipe.sim);
    return Promise.all([...specs].map(([k, spec]) => gen.request(spec, 'sim', (p, label) => {
      if (v !== version || k !== leadKey) return;
      simProgress = p;
      onSim?.(p, label);
    }).then((o) => [k, unpackSim(o)]))).then(async (all) => {
      if (v !== version) return false;
      const sims = new Map(all), P = sims.get(leadKey);
      const lead = makeFilm(P, troupe ? { slow: 0 } : {});
      lead.T = P.T;
      let F = lead;
      if (troupe) {
        const films = new Map([[leadKey, lead]]);
        for (const [k, Q] of sims) if (!films.has(k)) { const f = makeFilm(Q, { slow: 0 }); f.T = Q.T; films.set(k, f); }
        F = makeTroupe(troupe.map((m, i) => ({ film: films.get(keys[i]), size: m.size, phase: m.phase, ahead: m.ahead })), { side: Math.sign(recipe.camera.az) || 1 });
      }
      onFilm?.(lead, P.T);
      // 2. les pièces tournées
      const spec = partSpecs(F.T);
      const parts = { struts: {}, balls: {} };
      const jobs = Object.entries(spec.struts).map(([k, sp]) => gen.request(sp, 'strut').then((g) => { parts.struts[k] = g; }));
      for (const [k, sp] of Object.entries(spec.balls)) jobs.push(gen.request(sp, 'ball').then((g) => { parts.balls[k] = g; }));
      if (spec.winch) jobs.push(gen.request(spec.winch, 'winch').then((g) => { parts.winch = g; }));
      if (spec.hub) jobs.push(gen.request(spec.hub, 'hub').then((g) => { parts.hub = g; }));
      jobs.push(gen.request(spec.cable, 'cable').then((g) => { parts.cable = g; }));
      await Promise.all(jobs);
      if (v !== version) return false;
      film = F;
      shot = makeShot(F);
      montage = R.camera.montage === false ? null : makeMontage(F, R.camera);
      R.loop.duration = +F.dur.toFixed(2);
      // (relais : les matériaux sont construits ici, après les simulations ; le
      // volume de bruit et le mode des matériaux communs sont reposés juste
      // avant — un autre jour a pu poser les siens entre-temps)
      if (relay) { setLite(lite); setNoiseVolume(noise); }
      stage.setScene(R, F, parts);
      syncEnv();
      applied = true;
      return true;
    });
  }

  // ── Rendu d'une phase ──
  // un saut dans la boucle (fin de boucle, ← →, image fixe) ne compte pas comme un mouvement
  let lastU = null;
  const jumped = (u) => { const j = lastU === null || Math.abs(u - lastU) > 0.02 || Math.floor(u) !== Math.floor(lastU); lastU = u; return j; };
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _t = new THREE.Vector3();
  const hand = createHandheld('tension'); const _a = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  let lastPh = 0;
  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    // travelling latéral : le repère de la marche, plus l'écart lissé du centre (scene/shot.js)
    const cam = cameraAt(shot, film, C, u, camera.aspect);
    // (les lumières restent sur la formation ; le montage ne déplace que la caméra)
    const { tw, ext } = cam, lit = cam.tgt;
    const plan = free ? null : montage?.at(u, camera.aspect) ?? null, tgt = plan ? plan.tgt : cam.tgt;
    const cutNow = (plan?.shot ?? 0) !== lastShot;
    lastShot = plan?.shot ?? 0;
    if (cutNow) post.cut(); // (raccord de plan : pas de flou de mouvement ni d'historique d'une image à l'autre)
    let aim = _r.set(tgt[0], tgt[1], tgt[2]);
    if (!free) {
      camera.position.set(...(plan ? plan.pos : cam.pos));
      // (relais : la caméra avance vers ce que regarde le plan)
      if (push) camera.position.lerp(_t.set(tgt[0], tgt[1], tgt[2]), push);
      camera.up.set(0, 1, 0);
      aim = hand.aim(camera, _r, ph, { amp: RENDER.handheld ?? 0, duration: R.loop.duration, fov: C.fov }, _a);
      camera.lookAt(aim);
    }
    // lumières : dans le repère de la marche, autour du centre suivi
    {
      const L = R.light, K = L.key;
      const kd = tw(Math.cos(K.az) * Math.cos(K.el), Math.sin(K.el), Math.sin(K.az) * Math.cos(K.el));
      // (une troupe : la lampe recule jusqu'à ce que sa nappe couvre toute la formation, à éclairement égal)
      const reach = film?.T?.troupe ? Math.hypot(ext[0], ext[2]) / 2 : 0, Kd = Math.max(K.dist, (reach * 1.25) / Math.tan(K.angle));
      stage.key.position.set(lit[0] + kd[0] * Kd, lit[1] + kd[1] * Kd, lit[2] + kd[2] * Kd);
      stage.key.target.position.set(lit[0], 0, lit[2]);
      stage.key.color.set(K.color); stage.key.intensity = 7 * K.scale * Kd * Kd; stage.key.angle = K.angle; stage.key.penumbra = K.penumbra;
      const span = Math.max(ext[0], ext[1], ext[2], reach * 1.6) * 0.75 + 1;
      stage.key.shadow.focus = Math.min(1, Math.max(0.05, Math.atan(span / Kd) / K.angle));
      stage.key.shadow.camera.near = Math.max(0.5, Kd - 9 - reach); stage.key.shadow.camera.far = Kd + 9 + reach;
      stage.rims.forEach((l, i) => {
        const r = L.rim[i], d = tw(Math.cos(r.az) * Math.cos(r.el), Math.sin(r.el), Math.sin(r.az) * Math.cos(r.el));
        l.position.set(lit[0] + d[0] * 9, lit[1] + d[1] * 9, lit[2] + d[2] * 9);
        l.target.position.set(lit[0], lit[1], lit[2]);
        l.color.set(r.color); l.intensity = 7 * r.scale * 81 * (lite && i === 0 ? 1.4 : 1);
      });
      stage.floor.position.set(lit[0], 0, lit[2]);
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    const canvas = renderer.domElement;
    if (sub) {
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(aim);
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    // (brume comptée depuis le sujet : elle ne noie jamais la structure, quel que soit le recul)
    { const dS = Math.hypot(camera.position.x - tgt[0], camera.position.y - tgt[1], camera.position.z - tgt[2]); scene.fog.near = dS + R.fog.near; scene.fog.far = dS + R.fog.far; }
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    stage.update(u, jumped(u) || cutNow);
    stage.CU.pxScale.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, canvas.height);
    // (distance réelle au sujet : elle suit l'avancée du relais, soit × (1 − push))
    const fd = Math.hypot(camera.position.x - tgt[0], camera.position.y - tgt[1], camera.position.z - tgt[2]);
    post.update({ ...RENDER, lite, focus: RENDER.focus * fd, focusRange: RENDER.focusRange * fd }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    get film() { return film; },
    get shot() { return shot; },
    setRecipe, syncEnv, renderAt,
    isReady: () => applied && stage.ready(),
    // (la simulation de tête, puis les pièces tournées)
    progress: () => (applied ? 1 : 0.9 * Math.min(1, simProgress)),
    duration: () => R.loop.duration,
    warmPhases: () => [0, 0.2, 0.4, 0.6, 0.8],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
