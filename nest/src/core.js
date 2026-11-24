// Le cœur de Nest : la scène, sa recette et le rendu d'une phase. C'est la
// source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement, export) et par la méga-scène (day.js : le relais de
// mega/). Retoucher la caméra, l'éclairage ou la chaîne d'image se fait ici, et
// vaut pour les deux.
//
// createCore({ renderer, width, height, gen, lite, RENDER })
//   gen    : le pool de workers de génération (shared/gen/client.js)
//   RENDER : les réglages de rendu, lus à chaque image (la page passe ceux du
//            panneau, qu'elle modifie en place ; le relais, ceux par défaut)
// → { scene, camera, stage, post, R, setRecipe, syncEnv, renderAt, isReady,
//     progress, duration, warmPhases, applyRender }
// renderAt(u, { push, sub, free }) : push ∈ [0, 1) avance la caméra vers ce
// qu'elle regarde (passages du relais) ; sub : décalages d'un rendu accumulé ;
// free : caméra libre (la page la pose elle-même, OrbitControls).
//
// Règles (le relais tient plusieurs projets dans une seule page) :
// - rien ici ne lit la page (location, document, innerWidth, le canvas) :
//   tailles en pixels par renderer.domElement ;
// - G (shared/scene/globals.js) est commun aux jours : la phase précédente
//   est la nôtre (lastPh) ;
// - tout calcul lourd de la génération va dans le worker (gen/worker.js) ;
// - ce qui est créé hors de three.js (device.createBuffer…) se libère par
//   l'option extraDispose de day.js.
import * as THREE from 'three/webgpu';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from '../../shared/scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from '../../shared/scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { makeClock, plan, SLOW } from './season.js';
import { cameraScale, filmCamera, cameraOrbit } from './camera.js';
import { createHandheld } from '../../shared/scene/handheld.js';

const TAU = Math.PI * 2;

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 80);
  setNoiseVolume(await gen.request({ seed: 'nest-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite });
  stage.camera = camera; // (niveau de détail des guêpes : leur taille à l'écran)
  // (pré-passe de l'occlusion en demi-définition : l'occlusion est calculée à
  // demi-définition, une pré-passe pleine redessinait tout le papier pour rien)
  const post = createPost(renderer, scene, camera, { prePassScale: 0.5 });

  let R = null, envKey = '';
  function syncEnv() {
    const k = R.env.preset;
    if (k === envKey) return;
    envKey = k;
    const old = scene.environment;
    scene.environment = makeEnvironment(k, 0, lite ? 512 : 1024);
    old?.dispose();
  }
  let clock = null, P = null, camL = null;
  const orbit = cameraOrbit();
  function setRecipe(r) {
    R = r;
    clock = makeClock(R.loop.duration);
    P = plan(clock);
    camL = cameraScale(clock, P);
    stage.setRecipe(R, P, clock);
    syncEnv();
  }

  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _t = new THREE.Vector3(), _h = new THREE.Vector3(), _n = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3();
  let lastPh = 0;
  const hand = createHandheld('nest'), _hA = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    const S = clock.s(ph), L = camL(ph);
    // le nid visible : son centre descend à mesure qu'il grandit ; la caméra
    // recule d'autant (il garde la même part de l'image)
    const FC = filmCamera(C, R.decor.yBeam, L, orbit(ph));
    _t.set(...FC.target);
    if (!free) {
      camera.position.set(...FC.pos);
      if (push) camera.position.lerp(_t, push); // (relais : la caméra avance vers ce qu'elle regarde)
      camera.up.set(0, 1, 0);
      camera.lookAt(_t);
    }
    // la fondation : une fois la reine posée, la caméra la suit en translation
    // (sa direction ne change pas : l'image ne tourne que de l'orbite, qui
    // tourne alors autour d'elle) ; elle la quitte quand l'accéléré l'emporte
    const sq = (a, b, x) => { const q = Math.min(1, Math.max(0, (x - a) / (b - a))); return q * q * (3 - 2 * q); };
    // (elle la lâche avant que l'accéléré ne commence : dans l'accéléré, chaque
    // prise de vue la montre ailleurs, et la caméra sauterait avec elle)
    const W = SLOW.find((w) => w.name === 'queen'), qEnd = W.c + W.half;
    const uq = ph - Math.floor(ph), wq = free ? 0 : sq(0.04, 0.052, uq) * (1 - sq(qEnd - 0.002, qEnd + 0.008, uq));
    if (wq > 0) {
      const Q = stage.queenAt(uq);
      if (Q) {
        // (visée : entre son thorax et ses mandibules, à 4 cm de son centre)
        const fx = 1 - 2 * (Q.q[1] * Q.q[1] + Q.q[2] * Q.q[2]), fz = 2 * (Q.q[0] * Q.q[2] - Q.q[3] * Q.q[1]);
        const qx = Q.p[0] + fx * 0.04 * Q.s, qz = Q.p[2] + fz * 0.04 * Q.s;
        const dx = (qx - _t.x) * wq * 0.85, dy = (Q.p[1] - _t.y) * wq * 0.85, dz = (qz - _t.z) * wq * 0.85;
        _t.x += dx; _t.y += dy; _t.z += dz;
        camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
        camera.lookAt(_t);
      }
    }
    // le temps fort : la caméra s'approche de l'écaille où l'ouvrière pose sa bande
    let dHero = 0;
    const HC = free ? [] : stage.heroCams(ph);
    for (let hk = 0; hk < HC.length; hk++) {
      const H = HC[hk];
      // du film au temps fort (stage.heroAt : la visée sur l'ouvrière, la
      // pose de la caméra qui glisse le long du bord) : la visée part la
      // première (la caméra tourne la tête vers elle), la caméra suit
      const w = H.w, sm = (a, b, x) => { const q = Math.min(1, Math.max(0, (x - a) / (b - a))); return q * q * (3 - 2 * q); };
      // (depuis le plan large, la visée part la première ; dans un transfert
      // d'un gros plan à l'autre, la caméra est encore près de la première
      // ouvrière : visée et caméra bougent ensemble)
      const wP = sm(0.1, 1, w), wT = hk > 0 ? wP : sm(0, 0.6, w);
      const tgt = _h.set(...H.target), pos1 = _p1.set(...H.pos);
      pos1.y = Math.min(pos1.y, R.decor.yBeam - 0.06); // (jamais dans la poutre)
      // la direction de visée tourne d'un bout à l'autre (slerp, plus un arc
      // autour de la verticale à mi-chemin : une grue qui descend en tournant)
      // et la distance à la visée change en échelle logarithmique — la vitesse
      // de rotation de l'image est donc bornée par construction
      const d0 = camera.position.distanceTo(_t), d1 = pos1.distanceTo(tgt);
      const dir0 = _p2.copy(camera.position).sub(_t).normalize(), dir1 = _n.copy(pos1).sub(tgt).normalize();
      const ang = Math.acos(Math.min(1, Math.max(-1, dir0.dot(dir1))));
      const dir = ang > 1e-4 ? _r.copy(dir0).multiplyScalar(Math.sin((1 - wP) * ang)).addScaledVector(dir1, Math.sin(wP * ang)).divideScalar(Math.sin(ang)) : _r.copy(dir1);
      dir.applyAxisAngle(_u.set(0, 1, 0), 0.3 * Math.sin(Math.PI * wP)).normalize();
      _t.lerp(tgt, wT);
      let d = Math.exp(Math.log(d0) * (1 - wP) + Math.log(d1) * wP);
      // (dans un transfert, la caméra prend du champ à mi-chemin : on revoit
      // le nid qui grandit entre deux ouvrières, au lieu d'un papier flou)
      if (hk > 0) d *= 1 + 4 * Math.sin(Math.PI * wP) ** 2;
      // jamais dans l'enveloppe : si la caméra y tombe, elle recule le long de
      // sa propre ligne de visée jusqu'à en sortir (l'image ne tourne pas) ;
      // la contrainte s'efface au gros plan, dont la pose est vérifiée à part
      const Sh = H.shell;
      if (Sh) {
        const rM = 1 + 0.04 / Sh.b;
        const Q0 = [_t.x / Sh.a, (_t.y - Sh.cy) / Sh.b, _t.z / Sh.a], D = [dir.x / Sh.a, dir.y / Sh.b, dir.z / Sh.a];
        const A = D[0] * D[0] + D[1] * D[1] + D[2] * D[2], Bq = 2 * (Q0[0] * D[0] + Q0[1] * D[1] + Q0[2] * D[2]), Cq = Q0[0] * Q0[0] + Q0[1] * Q0[1] + Q0[2] * Q0[2] - rM * rM;
        const disc = Bq * Bq - 4 * A * Cq;
        if (disc > 0) { const dOut = (-Bq + Math.sqrt(disc)) / (2 * A); if (dOut > d) d += (dOut - d) * (1 - sm(0.85, 1, w)); }
      }
      camera.position.copy(_t).addScaledVector(dir, d);
      camera.position.y = Math.min(camera.position.y, R.decor.yBeam - 0.06);
      camera.lookAt(_t);
      dHero = Math.max(dHero, w);
    }
    // caméra tenue, sur la pose finale (fondation et gros plan compris)
    if (!free) camera.lookAt(hand.aim(camera, _t, ph, { amp: RENDER.handheld ?? 0, duration: R.loop.duration }, _hA));
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.012 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(free ? _t : _hA);
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    scene.fog.near = R.fog.near; scene.fog.far = R.fog.far;
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    stage.update(ph, S);
    const dS = camera.position.distanceTo(_t) * (1 - push);
    const dF0 = Math.max(0.05, dS - (C.focusBack ?? 1.1) * Math.max(0, L - 0.055) / 0.945);
    const dF = dHero > 0 ? dF0 * (1 - dHero) + dS * dHero : dF0; // (au printemps, le sujet est sur la cible : le pétiole, le rayon) // (mise au point sur la face du nid, pas sur son centre)
    post.update({ ...RENDER, lite, focus: RENDER.focus * dF, focusRange: RENDER.focusRange * dF }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    setRecipe, syncEnv, renderAt,
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => [0.1, 0.17, 0.24, 0.33, 0.45, 0.55, 0.75, 0.95],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
