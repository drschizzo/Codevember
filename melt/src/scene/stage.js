// La scène : l'état du cycle (cycle.js), la fonte calculée au chargement
// (melt.js) et le lancer de rayons (tracer.js), dont l'image HDR remplit un
// quad plein écran ; la chaîne d'image commune (shared/render/post.js) passe
// ensuite dessus. La scène est prête quand la fonte de toute la grappe est
// calculée (environ une seconde sur un ordinateur de bureau).
import * as THREE from 'three/webgpu';
import { texture, screenUV, vec4, positionGeometry } from 'three/tsl';
import { createTracer } from './tracer.js';
import { createMelt } from './melt.js';
import { MOODS, HABITS, CLUSTERS } from '../recipe.js';
import { level, rising, meltU, buildCluster, crystalsAt, tideFor, cycleT, apparatusAt } from '../cycle.js';
import { cameraAt, potFor } from '../camera.js';
export { cameraAt };

export function createStage(scene, gen, { renderer, lite = false } = {}) {
  const tracer = createTracer(renderer);
  const melter = createMelt(renderer);
  const blankTex = new THREE.DataTexture(new Uint8Array(4), 1, 1); blankTex.needsUpdate = true;
  const texNode = texture(blankTex, screenUV);
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = texNode;
  mat.vertexNode = vec4(positionGeometry.xy, 0, 1);
  mat.depthTest = false; mat.depthWrite = false;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const group = new THREE.Group();
  let R = null, cluster = null, C = null, pot = null, melt = null, prog = 0, token = 0;

  function setRecipe(r) {
    R = r; cluster = buildCluster(R.seed, CLUSTERS[R.cluster]); C = tideFor(cluster); pot = potFor(R);
    melt = null; prog = 0;
    const my = ++token;
    melter.simulate(cluster, {
      habit: HABITS[R.habit].id, LL: C.LL, D: C.LH - C.LL, quality: lite ? 1.6 : 1, budget: lite ? 3e9 : 2.5e10,
      onProgress: (f) => { if (my === token) prog = f; },
      cancelled: () => my !== token,
    }).then((m) => { if (my === token && m) { melt = m; prog = 1; } },
      (e) => console.error(`fonte : ${e.message}`));
  }

  // ph : la phase affichée ; sub : décalages d'un rendu accumulé (pixel, lentille)
  function update(ph, camera, size, sub = null) {
    if (!R) return;
    const t = cycleT(ph - Math.floor(ph));
    const K = cameraAt(R, ph - Math.floor(ph));
    const A = apparatusAt(t, C, R.loop.duration);
    const M = MOODS[R.mood];
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const tex = tracer.run({
      w: size[0], h: size[1], jitter: sub ? sub.pixel : [0, 0], lens: sub?.lens, t,
      // (le flou de mise au point à l'export seulement : en lecture, un tirage de la lentille par image tremble)
      aperture: sub?.lens ? K.aperture : 0, focus: K.focus,
      world: { pot: { Ri: pot.Ri, th: pot.th, rim: pot.rim, bottom: pot.bottom, bench: pot.bench },
        rod: { ...pot.rod, lift: A.lift }, drain: A.drain, stream: { ...pot.stream, ...A.stream }, flame: A.flame }, u: meltU(t, C), oxRate: R.oxRate, habit: HABITS[R.habit].id,
      cam: { pos: [camera.position.x, camera.position.y, camera.position.z], tanHalf: Math.tan((camera.fov * Math.PI) / 360), r: [e[0], e[1], e[2]], u: [e[4], e[5], e[6]], f: [-e[8], -e[9], -e[10]] },
      tide: { L: level(t, C), rising: rising(t, C), ...C },
      env: { lo: M.lo, hi: M.hi, forge: M.forge, boxes: M.boxes },
      crystals: crystalsAt(cluster, t, C, melt?.crystals),
      melt, blank: melter.blank,
    });
    if (texNode.value !== tex) texNode.value = tex;
  }

  return {
    group, setRecipe, update,
    ready: () => !!R && !!melt, progress: () => prog,
    cluster: () => cluster, melt: () => melt,
    setShadowQuality() {}, syncFinishes() {},
  };
}
