// La scène : l'état du cycle (cycle.js) et le lancer de rayons (tracer.js),
// dont l'image HDR remplit un quad plein écran ; la chaîne d'image commune
// (shared/render/post.js) passe ensuite dessus. Rien n'est précalculé : la
// scène est prête dès qu'elle a sa recette.
import * as THREE from 'three/webgpu';
import { texture, screenUV, vec4, positionGeometry } from 'three/tsl';
import { createTracer } from './tracer.js';
import { MOODS, HABITS, CLUSTERS } from '../recipe.js';
import { CYCLE, level, rising, buildCluster, crystalsAt } from '../cycle.js';
export { cameraAt } from '../camera.js';

export function createStage(scene, gen, { renderer } = {}) {
  const tracer = createTracer(renderer);
  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1); blank.needsUpdate = true;
  const texNode = texture(blank, screenUV);
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = texNode;
  mat.vertexNode = vec4(positionGeometry.xy, 0, 1);
  mat.depthTest = false; mat.depthWrite = false;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const group = new THREE.Group();
  let R = null, cluster = null;

  function setRecipe(r) { R = r; cluster = buildCluster(R.seed, CLUSTERS[R.cluster]); }

  function update(ph, camera, size, jitter = [0, 0]) {
    if (!R) return;
    const t = ph - Math.floor(ph);
    const M = MOODS[R.mood];
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const tex = tracer.run({
      w: size[0], h: size[1], jitter, t, oxRate: R.oxRate, habit: HABITS[R.habit].id,
      cam: { pos: [camera.position.x, camera.position.y, camera.position.z], tanHalf: Math.tan((camera.fov * Math.PI) / 360), r: [e[0], e[1], e[2]], u: [e[4], e[5], e[6]], f: [-e[8], -e[9], -e[10]] },
      tide: { L: level(t), rising: rising(t), ...CYCLE },
      env: { lo: M.lo, hi: M.hi, forge: M.forge, boxes: M.boxes },
      crystals: crystalsAt(cluster, t),
    });
    if (texNode.value !== tex) texNode.value = tex;
  }

  return {
    group, setRecipe, update,
    ready: () => !!R, progress: () => 1,
    cluster: () => cluster,
    setShadowQuality() {}, syncFinishes() {},
  };
}
