// Magma comme jour de la méga-scène (mega/) : la même scène que main.js, sans
// la page (interface, URL, écran de chargement, export). Le rendu d'une phase
// reprend renderAt de main.js ; look.push avance la caméra vers le front.
import * as THREE from 'three/webgpu';
import { generate } from './recipe.js';
import { createStage } from './scene/stage.js';
import { makeEnvironment } from '../../shared/scene/env.js';
import { G } from '../../shared/scene/globals.js';
import { setNoiseVolume } from '../../shared/scene/materials.js';
import { createPost } from '../../shared/render/post.js';
import { defaultsFor } from './app/settings.js';
import { generatorFor, makeDay } from '../../mega/src/kit.js';

export const meta = { id: 'magma', name: 'Magma', subtitle: 'le front de pāhoehoe', seed: 'm2', enter: 'heat' };
const DEG = Math.PI / 180, TAU = Math.PI * 2;

export async function createDay({ renderer, pipes, width, height, seed = meta.seed }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.03, 60);
  const gen = generatorFor('magma');
  setNoiseVolume(await gen.request({ seed: 'magma-noise' }, 'noise')); // (avant la construction des matériaux)
  const stage = createStage(scene, renderer, gen, { lite: false });
  const post = createPost(renderer, scene, camera, { overlay: stage.fumes.overlay, aoSamples: 8 });
  const RENDER = defaultsFor(false);
  stage.setShadowQuality(RENDER.shadows);
  const R = generate(seed);
  stage.setRecipe(R);
  let envReady = false;
  gen.request({ sky: R.sky, W: 1024 }, 'sky').then(({ pixels }) => {
    scene.environment = makeEnvironment(pixels, 0, 1024);
    envReady = true;
  });

  let lastPh = 0;
  function renderAt(u, { push = 0 } = {}) {
    const ph = u - Math.floor(u);
    G.phase.value = lastPh; // (G est commun aux jours : la phase précédente est la nôtre)
    G.phasePrev.value = G.phase.value;
    G.phase.value = ph;
    lastPh = ph;
    G.frame.value = (G.frame.value + 1) % 65536;
    const C = R.camera;
    const p = C.pitch * DEG, yw = C.yaw + C.sway * Math.sin(TAU * ph);
    const tx = C.target[0] + C.sway * 0.6 * Math.sin(TAU * ph + 1.3), tz = C.target[1];
    const d = C.dist * (1 + C.sway * 0.5 * Math.cos(TAU * ph)) * (1 - push);
    camera.position.set(tx + Math.sin(yw) * Math.cos(p) * d, Math.sin(p) * d, tz + Math.cos(yw) * Math.cos(p) * d);
    camera.up.set(0, 1, 0);
    camera.lookAt(tx, 0, tz);
    if (camera.fov !== C.fov) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
    G.microDetail.value = RENDER.microDetail;
    G.roughFloor.value = RENDER.roughFloor;
    scene.background.set(R.fog.color);
    scene.fog.color.set(R.fog.color);
    scene.fog.near = R.fog.near ?? 6; scene.fog.far = R.fog.far ?? 20;
    scene.environmentIntensity = 1;
    camera.updateMatrixWorld();
    stage.update(u, camera);
    const dS = C.dist * (1 - push);
    post.update({ ...RENDER, lite: false, focus: RENDER.focus * dS, focusRange: RENDER.focusRange * dS }, R);
    post.render();
  }

  return makeDay({
    meta, renderer, pipes, width, height, scene, camera, post, gen,
    duration: () => R.loop.duration,
    isReady: () => stage.ready() && envReady,
    progress: () => stage.progress(),
    renderAt,
    warmPhases: () => [0, 0.3, 0.5, 0.8],
  });
}
