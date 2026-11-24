// Le cœur de Tesseract : la scène, sa recette et le rendu d'une phase. C'est
// la source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement, légendes, export) et par la méga-scène (day.js : le
// relais). Retoucher le pliage, le voyage intérieur, la caméra, la lumière ou
// la chaîne d'image se fait ici, et vaut pour les deux.
//
// Tesseract est d'avant le gabarit commun : ses matériaux, leurs globales G et
// son studio sont des variantes locales. Ses globales n'étant qu'à lui, il n'a
// pas à reposer la phase précédente avant de dessiner (voir melt/src/core.js).
//
// createCore({ renderer, width, height, gen, lite, RENDER })
//   gen    : le pool de workers de génération (shared/gen/client.js)
//   RENDER : les réglages de rendu, lus à chaque image (la page passe ceux du
//            panneau, qu'elle modifie en place ; le relais, ceux par défaut)
// → { scene, camera, tess, stage, post, probe, gen, R, info, setRecipe,
//     syncEnv, resetMotion, renderAt, isReady, progress, duration,
//     warmPhases, applyRender }
// setRecipe(R) → promesse : le studio est calculé (par un worker) et posé.
// renderAt(u, { push, sub, free }) : push ∈ [0, 1) avance la caméra vers ce
// qu'elle regarde (passages du relais) ; sub : décalages d'un rendu accumulé
// (render/accum.js) ; free : caméra libre (la page la pose elle-même,
// OrbitControls).
import * as THREE from 'three/webgpu';
import { createTesseract } from './scene/tesseract.js';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from './scene/env.js';
import { G, setNoiseVolume, setLite } from './scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { createHandheld } from '../../shared/scene/handheld.js';
import { createProbe, PROBE } from './scene/probe.js';
import { smoothInsidePose, entryAxis } from './scene/voyage.js';
import { timelineFor } from './math4.js';

export const TARGET = 1.9; // rayon de l'objet à l'écran (unités du monde)
// ouverture de la lentille du rendu accumulé (rayon, en part de la distance de mise au point)
const LENS = { wide: 0.005, inside: 0.004 };

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 10, 30);
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.05, 120);
  setNoiseVolume(await gen.request({ seed: 'tesseract-noise' }, 'noise'));
  const stage = createStage(scene, { lite });
  const tess = createTesseract(scene, gen, { studioLights: stage.studio });
  const post = createPost(renderer, scene, camera);
  const probe = lite ? null : createProbe(renderer, scene);

  // (les pixels de l'environnement sont calculés dans un worker de génération :
  // sur le fil principal, ils tenaient la page plusieurs secondes)
  let R = null, envKey = '', envJob = Promise.resolve(), envReady = false;
  function syncEnv() {
    if (R.env.preset === envKey) return envJob; // (déjà là, ou en cours)
    const key = envKey = R.env.preset, W = lite ? 512 : 1024;
    envReady = false;
    return (envJob = gen.request({ key, warmth: 0, W }, 'env').then(({ data }) => {
      if (envKey !== key) return;
      const old = scene.environment;
      scene.environment = makeEnvironment(data, 0, W);
      old?.dispose();
      envReady = true;
    }));
  }
  let resetMotion = true;
  function setRecipe(r) {
    R = r;
    tess.setRecipe(R);
    resetMotion = true;
    return syncEnv();
  }

  // ── Rendu d'une phase ──
  // pose extérieure (repère du monde) à la phase ph ; fold : pliage moyen
  function outsideCamera(ph, fold, target) {
    const K = R.camera, w = ph * Math.PI * 2;
    const az = K.az + w * K.orbit + K.sway * 0.35 * Math.sin(w);
    const el = K.elev + K.sway * 0.06 * Math.sin(2 * w + 0.7);
    // recul : l'objet occupe ~60 % de la demi-hauteur (ou de la demi-largeur, en portrait)
    // travelling : la caméra s'approche quand le tesseract est plié (il est
    // alors plus petit, et l'on veut voir l'intérieur des cellules)
    // (et déplié, le patron est vu d'un peu plus près)
    const close = (1 - (R.view?.dolly ?? 0) * 0.3 * fold * fold * (3 - 2 * fold)) * (1 - 0.28 * (1 - fold));
    const d = close * (K.dist * TARGET) / (0.6 * Math.tan((K.fov * Math.PI) / 360) * Math.min(1, camera.aspect));
    return target.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
  }
  // rayon d'entrée (ou de sortie) : choisi d'après la caméra extérieure au
  // début de la plongée (ou à la fin de la remontée), dans le repère local
  const _e = new THREE.Euler(), _gq = new THREE.Quaternion();
  function axisAt(ph) {
    const g = tess.group, p = outsideCamera(ph, 1, new THREE.Vector3());
    _gq.setFromEuler(_e.set(R.proj.tiltX, Math.PI * 2 * R.proj.spin * ph, R.proj.tiltZ, 'YXZ')).invert();
    return entryAxis(p.sub(g.position).divideScalar(g.scale.x).applyQuaternion(_gq));
  }
  function rigCamera(ph) {
    const K = R.camera;
    const fold = info?.state ? Math.min(1, Math.max(0, info.state.fold)) : 0;
    outsideCamera(ph, fold, camera.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, -0.15, 0);
    let fov = K.fov;
    // voyage intérieur : la caméra entre dans l'hypersphère (voir scene/voyage.js)
    const st = info?.state, kc = info?.kc ?? 0;
    G.tunnel.value = 0;
    if (st?.seg !== undefined && ['plunge', 'dwell', 'travel', 'surface'].includes(st.phase) && info.frames) {
      const g = tess.group, qi = g.quaternion.clone().invert();
      const tl = info.timeline;
      const out = {
        pos: g.worldToLocal(camera.position.clone()),
        fwd: _f.set(0, 0, -1).applyQuaternion(camera.quaternion).applyQuaternion(qi).clone(),
        up: _u.set(0, 1, 0).applyQuaternion(camera.quaternion).applyQuaternion(qi).clone(),
        upL: new THREE.Vector3(0, 1, 0).applyQuaternion(qi),
        uIn: axisAt(tl.find((p) => p.k === 'plunge').a),
        uOut: axisAt(tl.find((p) => p.k === 'surface').b),
      };
      // passage percé dans les parois : il s'ouvre devant la caméra et se
      // referme derrière elle (voir scene/project.js, revealMask)
      const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
      if (st.phase === 'plunge') { G.tunnelDir.value.copy(out.uIn); G.tunnel.value = ss(0.06, 0.22, st.f) * (1 - ss(0.66, 0.8, st.f)); }
      else if (st.phase === 'surface') { G.tunnelDir.value.copy(out.uOut); G.tunnel.value = ss(0.2, 0.34, st.f) * (1 - ss(0.78, 0.94, st.f)); }
      const P = smoothInsidePose(ph, st, R, info.frames, out, tl, R.loop.duration);
      const pos = P.pos, fwd = P.fwd.normalize(), up = P.up.normalize();
      g.localToWorld(pos);
      fwd.applyQuaternion(g.quaternion); up.applyQuaternion(g.quaternion);
      camera.position.copy(pos);
      camera.up.copy(up);
      camera.lookAt(_t.copy(pos).add(fwd));
      fov = K.fov + ((R.voyage.fov ?? 68) - K.fov) * kc;
    }
    // caméra tenue, sur la pose finale (dehors comme dedans) : visée le long de
    // l'axe de la caméra, à la distance du tesseract ; dans l'hypersphère, la
    // caméra tourne sans se déplacer (les parois et le passage sont tout près)
    if ((RENDER.handheld ?? 0) > 0) { // (à 0 : la pose calculée, au bit près)
      const kcH = info?.kc ?? 0, dH = Math.max(0.05, camera.position.distanceTo(tess.group.position));
      _hT.copy(camera.position).addScaledVector(_hF.set(0, 0, -1).applyQuaternion(camera.quaternion), dH);
      camera.lookAt(hand.aim(camera, _hT, ph, { amp: RENDER.handheld, duration: R.loop.duration, fov, move: 1 - kcH }, _hA));
    }
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  const hand = createHandheld('tesseract'), _hA = new THREE.Vector3(), _hT = new THREE.Vector3(), _hF = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3(), _j = new THREE.Vector3(), _dark = new THREE.Color();
  const _lat = new THREE.Vector3();
  let lastPhase = 0, info = null;
  // u : phase « déroulée » (seule sa partie fractionnaire compte ici)
  function renderAt(u, { push = 0, sub = null, free = false } = {}) {
    const ph = u - Math.floor(u);
    // (un saut dans la boucle n'est pas un mouvement : pas de vecteurs vitesse)
    let dph = Math.abs(ph - lastPhase); dph = Math.min(dph, 1 - dph);
    const reset = resetMotion || dph > 0.02;
    resetMotion = false;
    lastPhase = ph;
    G.phase.value = ph;
    G.microDetail.value = RENDER.microDetail;
    G.patina.value = RENDER.patina;
    G.roughFloor.value = RENDER.roughFloor;
    G.nestEnv.value = RENDER.nestEnv;
    G.crystalThick.value = RENDER.crystalThick;
    G.dither.value = RENDER.aa === 'traa' || sub ? 1 : 0; // (bord des trous tramé, moyenné par l'anticrénelage temporel ou par l'accumulation)
    const floorY = -R.floor.level * TARGET;
    // (le tesseract d'abord : la caméra du voyage se règle sur son état)
    info = tess.update(ph, { target: TARGET, floorY, reset });
    if (!free) rigCamera(ph);
    const kc0 = info?.kc ?? 0;
    let focusOut = camera.position.length(), focusIn = tess.group.position.distanceTo(camera.position);
    // (relais : la caméra avance vers ce qu'elle regarde, de la part push de la
    // distance au sujet ; la mise au point suit, × (1 − push))
    if (push && !free) {
      const dS = focusOut + (focusIn - focusOut) * kc0;
      camera.position.addScaledVector(_f.set(0, 0, -1).applyQuaternion(camera.quaternion), dS * push);
      focusOut *= 1 - push; focusIn *= 1 - push;
    }
    const focusDist = (focusOut + (focusIn - focusOut) * kc0) * RENDER.focus;
    const canvas = renderer.domElement; // (dans le relais : la taille de la cible du jour)
    if (sub) {
      // la lentille a un diamètre : la caméra se décale dans son plan et vise
      // toujours le point de netteté (ouverture : part de la distance de mise
      // au point)
      const ap = focusDist * (kc0 > 0.5 ? LENS.inside : LENS.wide) * (RENDER.lens ?? 1);
      _f.set(0, 0, -1).applyQuaternion(camera.quaternion);
      _t.copy(camera.position).addScaledVector(_f, focusDist);
      _f.set(1, 0, 0).applyQuaternion(camera.quaternion); _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.up.copy(_u);
      camera.lookAt(_t);
      // (et un décalage dans le pixel : anticrénelage)
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    } else if (camera.view?.enabled) camera.clearViewOffset();
    camera.updateMatrixWorld();
    tess.setViewer(camera.position);
    const kp = info?.kp ?? 0, kc = info?.kc ?? 0, sc = info?.scale ?? 1;
    stage.update(R, floorY, { lateral: R.voyage?.gallery ? _lat.setFromMatrixColumn(camera.matrixWorld, 0).negate() : null, kc, kp, camera, scale: sc, lamp: R.voyage?.lamp ?? 1, top: info?.top, gain: info?.top?.gain ?? 1, jitter: sub ? _j.set(sub.light[0], 0, sub.light[1]) : null });
    // sonde de pièce (voir scene/probe.js) : une face par image, dans les pièces
    PROBE.k.value = probe && info?.top ? kc * (RENDER.probe ?? 1) : 0;
    if (PROBE.k.value > 0.01) probe.update(info.top.target, 0.03 * sc, reset); else probe?.invalidate();
    // (dans l'hypersphère, le lointain est sombre : la teinte de la scène,
    // très assombrie ; un fond clair, vu par tous les ajours, noyait l'image
    // dans un voile laiteux)
    scene.background.set(R.bg);
    if (kc > 0) {
      const L = 0.2126 * scene.background.r + 0.7152 * scene.background.g + 0.0722 * scene.background.b;
      _dark.copy(scene.background).multiplyScalar(Math.min(1, 0.012 / Math.max(L, 1e-4)));
      // (galerie : un gris sourd plutôt que le noir, là où l'on voit le fond)
      if (R.voyage?.gallery && R.voyage.haze) _dark.set(R.voyage.haze);
      scene.background.lerp(_dark, Math.min(1, kc * 1.3));
    }
    scene.fog.color.copy(scene.background);
    const V = R.voyage ?? {};
    scene.fog.near = R.fog.near + ((V.fogNear ?? 1.4) * sc - R.fog.near) * kc;
    scene.fog.far = R.fog.far + ((V.fogFar ?? 6.5) * sc - R.fog.far) * kc;
    // (un univers clos : le studio ne s'y reflète presque plus)
    scene.environmentIntensity = R.env.intensity * (1 - 0.65 * kp);
    scene.environmentRotation.set(0, R.env.rotation, 0);
    // (dans les pièces, tout est proche : halo et flou de mouvement atténués,
    // sinon l'image entière se voile ; reflets en espace écran aussi : des
    // parois polies qui se reflètent l'une l'autre font une galerie des
    // glaces où l'œil ne sait plus où se poser)
    post.update({
      ...RENDER, focus: focusDist, focusRange: RENDER.focusRange * TARGET * 2,
      halation: RENDER.halation * (1 - 0.7 * kc), dirt: RENDER.dirt * (1 - 0.6 * kc), motionBlur: RENDER.motionBlur * (1 - 0.5 * kc),
      // (galerie : des murs mats, un sol poli — ses reflets à pleine force)
      ssrIntensity: RENDER.ssrIntensity * (R.voyage?.gallery ? 1 + 0.3 * kc : 1 - 0.6 * kc),
      // (rendu accumulé : ni anticrénelage temporel ni flou de mouvement calculé, la moyenne les fait)
      ...(sub ? { aa: 'none', motionBlur: 0, dof: false } : {}),
    }, R);
    post.render();
  }

  // Amorçage : chaque temps de la boucle, y compris les moments du voyage dont
  // les shaders ne servent que là (sonde de pièce et ses doublures, gorges
  // lumineuses, portes). Sans cela la première image de la plongée gelait la
  // page une demi-seconde, et l'animation repartait par un à-coup.
  function warmPhases() {
    const tl = timelineFor(R), out = [0];
    for (const p of tl) out.push(p.a + (p.b - p.a) * 0.5);
    for (const k of ['plunge', 'dwell']) { const p = tl.find((x) => x.k === k); if (p) out.push(p.a + (p.b - p.a) * 0.97); }
    return out;
  }

  return {
    scene, camera, tess, stage, post, probe, gen,
    get R() { return R; },
    get info() { return info; },
    setRecipe, syncEnv, renderAt, warmPhases,
    // (chaque scène, et la fin de l'amorçage : pas de vecteurs vitesse à l'image suivante)
    resetMotion: () => { resetMotion = true; },
    isReady: () => envReady && tess.ready(),
    progress: () => tess.progress(),
    duration: () => R.loop.duration,
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
