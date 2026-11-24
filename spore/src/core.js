// Le cœur de Spore : la scène, sa recette et le rendu d'une phase. C'est la
// source unique du rendu, partagée par la page (main.js : interface, URL,
// écran de chargement, export) et par la méga-scène (day.js : le relais).
// Retoucher la caméra, l'éclairage ou la chaîne d'image se fait ici, et vaut
// pour les deux.
//
// createCore({ renderer, width, height, gen, lite, RENDER })
//   gen    : le pool de workers de génération (shared/gen/client.js)
//   RENDER : les réglages de rendu, lus à chaque image (la page passe ceux du
//            panneau, qu'elle modifie en place ; le relais, ceux par défaut)
// → { scene, camera, stage, post, R, path, smokePass, setRecipe, syncEnv,
//     resetPath, renderAt, isReady, progress, duration, warmPhases,
//     applyRender }
// renderAt(u, { push, sub, free, target }) : push ∈ [0, 1) avance la caméra
// vers ce qu'elle vise (passages du relais) ; sub : décalages d'un rendu
// accumulé ; free : caméra libre (la page la pose elle-même, OrbitControls,
// dont target est le point visé).
// Le raccord de la boucle (post.cut quand la partie entière de u change)
// reste à l'appelant : la boucle de la page, le relais (day.js) ; l'export et
// les outils de mise au point ne le signalent pas.
import * as THREE from 'three/webgpu';
import { pass, vec4, float } from 'three/tsl';
import { sceneDepth } from './scene/smoke.js';
import { createCameraPath, cloudTrack } from './camera.js';
import { FAMILIES } from './families.js';
import { heightOf } from './fruit.js';
import { logBase } from './gen/wood.js';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from './scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume, setLite } from '../../shared/scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { createHandheld } from '../../shared/scene/handheld.js';

export async function createCore({ renderer, width, height, gen, lite = false, RENDER }) {
  setLite(lite); // (lu à la construction des matériaux)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(28, width / height, 0.05, 200); // (centimètres)
  setNoiseVolume(await gen.request({ seed: 'spore-noise' }, 'noise')); // (les matériaux en dépendent)
  const stage = createStage(scene, gen, { lite });
  // Le volume de fumée : sa propre passe, à demi-résolution, posée sur l'image
  // avant l'anticrénelage temporel (qui lisse aussi son départ tramé). Il lit
  // la profondeur de la passe de scène pour s'arrêter sur le bois. (sceneDepth
  // est un nœud du module smoke.js : un seul cœur Spore à la fois.)
  let smokePass = null;
  const post = createPost(renderer, scene, camera, {
    prePassScale: 0.5, // (l'occlusion est à demi-résolution : sa pré-passe aussi)
    overlay: (color, { scenePass }) => {
      smokePass?.dispose();
      sceneDepth.value = scenePass.getTexture('depth');
      smokePass = pass(stage.smokeScene, camera);
      smokePass.setResolutionScale(0.5);
      // (effacée à alpha nul quel que soit l'état du moteur : la passe est
      // déclenchée depuis le quad du TRAA, qui efface en noir opaque — une
      // fumée absente devenait un voile noir sur toute l'image)
      const ub = smokePass.updateBefore.bind(smokePass), cc = new THREE.Color();
      smokePass.updateBefore = (frame) => {
        const r = frame.renderer, a = r.getClearAlpha();
        r.getClearColor(cc); r.setClearColor(0x000000, 0);
        ub(frame);
        r.setClearColor(cc, a);
      };
      const s = smokePass.getTextureNode(); // (prémultiplié)
      return vec4(color.rgb.mul(float(1).sub(s.a)).add(s.rgb), color.a);
    },
  });

  let R = null, envKey = '';
  function syncEnv() {
    const k = R.env.preset;
    if (k === envKey) return;
    envKey = k;
    const old = scene.environment;
    scene.environment = makeEnvironment(k, 0, lite ? 512 : 1024);
    old?.dispose();
  }

  // ── La caméra du film : construite quand le site est calculé (elle vise le
  // centre du réseau, puis la forêt) ──
  let path = null;
  function makePath() {
    const S = stage.site(), P = R.plasmodium, sp = FAMILIES[R.family].species[R.species];
    let fx = P.territory[0], fz = P.territory[1];
    if (S && S.nBeads) {
      let ax = 0, az = 0, w = 0;
      for (let i = 0; i < S.nBeads; i++) { ax += S.beads[i * 8]; az += S.beads[i * 8 + 1]; w++; }
      fx = ax / w; fz = az / w;
    }
    const H = sp.head ? heightOf(sp) : 0.06;
    path = createCameraPath(R.camera, {
      L: R.site.L, target: [P.territory[0] + 0.1, P.territory[1]], forest: [fx, fz], H, y0: logBase(fz, R.site.logR),
      // (la forêt remplit le cadre : distance à l'échelle des sporanges)
      distForest: Math.min(R.camera.dist, Math.max(1.6, H * (H > 0.5 ? 4.4 : 6.5) + 0.6)),
      groundAt: (x, z) => logBase(z, R.site.logR) + 0.05,
      cloud: cloudTrack(S?.smoke, R.site.L), // (la caméra suit le nuage pendant le voyage)
    }, 40);
  }
  function setRecipe(r) {
    R = r;
    path = null;
    stage.setRecipe(R);
    syncEnv();
  }

  // u : phase « déroulée » (partie entière = nombre de boucles accomplies)
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _t = new THREE.Vector3();
  let lastPh = 0;
  const hand = createHandheld('spore'), _hA = new THREE.Vector3(), _hT = new THREE.Vector3(); // (caméra tenue : RENDER.handheld, 0 = la caméra calculée seule)
  function renderAt(u, { push = 0, sub = null, free = false, target = null } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours du relais : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    if (!path && stage.ready()) makePath();
    const pose = path ? path.pose(ph) : { pos: [0, 2, 6], target: [0, 0, 0], fov: C.fov, focus: 6 };
    if (!free) {
      camera.position.set(...pose.pos);
      // (relais : la caméra avance vers ce qu'elle vise)
      if (push) camera.position.lerp(_t.set(...pose.target), push);
      camera.up.set(0, 1, 0);
      camera.lookAt(hand.aim(camera, _hT.set(...pose.target), ph, { amp: RENDER.handheld ?? 0, duration: R.loop.duration }, _hA));
    }
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    camera.clearViewOffset();
    if (sub) {
      const canvas = renderer.domElement;
      camera.updateMatrixWorld();
      _f.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
      const ap = 0.006 * (RENDER.dof ? RENDER.bokeh : 0.3);
      camera.position.addScaledVector(_f, sub.lens[0] * ap).addScaledVector(_u, sub.lens[1] * ap);
      camera.lookAt(!free ? _hA : _r.set(...pose.target));
      camera.setViewOffset(canvas.width, canvas.height, sub.pixel[0], sub.pixel[1], canvas.width, canvas.height);
    }
    camera.updateMatrixWorld();
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    scene.fog.near = R.fog.near; scene.fog.far = R.fog.far;
    scene.environmentIntensity = R.env.intensity;
    scene.environmentRotation.set(0, R.env.rotation, 0);
    stage.update(ph, pose, camera);
    const focus = free ? camera.position.distanceTo(target) : pose.focus * (1 - push);
    post.update({ ...RENDER, lite, focus: RENDER.focus * focus, focusRange: RENDER.focusRange * focus }, R);
    post.render();
  }

  return {
    scene, camera, stage, post, gen,
    get R() { return R; },
    get path() { return path; },
    get smokePass() { return smokePass; },
    setRecipe, syncEnv, renderAt,
    resetPath: () => { path = null; }, // (refaite à l'image suivante)
    isReady: () => stage.ready(),
    progress: () => stage.progress(),
    duration: () => R.loop.duration,
    warmPhases: () => [0, 0.25, 0.5, 0.75],
    applyRender: () => stage.setShadowQuality(RENDER.shadows),
  };
}
