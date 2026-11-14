// La scène : la simulation demandée au worker, l'horloge (timeline.js), et le
// lancer de rayons (tracer.js) dont l'image HDR remplit un quad plein écran ;
// la chaîne d'image commune (shared/render/post.js) passe ensuite dessus.
//
// update(ph, …) ne dépend que de la recette, de la simulation et de la phase.
import * as THREE from 'three/webgpu';
import { texture, screenUV, vec4, positionGeometry } from 'three/tsl';
import { createTracer } from './tracer.js';
import { MOODS, ICES, SECTIONS } from '../recipe.js';
import { stateAt, columnRows } from '../timeline.js';

const TAU = Math.PI * 2;

// la caméra du film : le cadrage de l'humeur, un balancement lent et périodique
export function cameraAt(R, u) {
  const C = MOODS[R.mood].cam, K = R.camera;
  const tgt = [...C.tgt];
  const off = [C.pos[0] - tgt[0], C.pos[1] - tgt[1], C.pos[2] - tgt[2]];
  const az = K.sway * Math.sin(TAU * u), lift = K.lift * Math.sin(TAU * u + 1.3);
  const c = Math.cos(az), s = Math.sin(az);
  const pos = [tgt[0] + (off[0] * c + off[2] * s) * K.dolly, tgt[1] + off[1] * K.dolly + lift, tgt[2] + (-off[0] * s + off[2] * c) * K.dolly];
  return { pos, tgt, fov: C.fov };
}

export function createStage(scene, gen, { lite = false, renderer, onArt = null } = {}) {
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

  let R = null, data = null, prog = 0, recipeKey = '';
  const rowsBuf = new Float32Array(256);
  let state = null;

  function setRecipe(r) {
    R = r;
    const key = JSON.stringify([R.sim, R.body.tilt0]);
    if (key === recipeKey && data) return;
    recipeKey = key; data = null; prog = 0;
    const want = key;
    gen.request({ sim: R.sim, body: { tilt0: R.body.tilt0 } }, 'lake', (f, label) => {
      if (want !== recipeKey) return;
      prog = f;
      if (label && label !== 'cache') { try { onArt?.(JSON.parse(label)); } catch { /* */ } }
    }).then((out) => { if (want === recipeKey) { data = out; prog = 1; } }, (e) => console.error(e));
  }

  // jitter : décalage du pixel (rendu accumulé) ; size : [w, h] en pixels
  function update(ph, camera, size, jitter = [0, 0]) {
    if (!R || !data) return;
    const { S, B } = data;
    state = stateAt(R, S, B, ph);
    columnRows(S, state.s, rowsBuf);
    const M = { ...MOODS[R.mood], key: R.mood };
    const I = ICES[R.ice];
    const feedP = S.feedPeriod / 10; // cm par période
    const nPer = Math.max(1, Math.round(feedP / 0.17));
    // la saison : le soleil et le ciel s'ouvrent l'été
    const sunI = M.sunI * (0.35 + 0.65 * state.summer);
    const skyI = 0.55 + 0.45 * state.summer;
    const amb = M.amb.map((a) => a * (0.7 + 0.3 * state.summer));
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    const frag = state.frag ? { ...state.frag, rows: data.S.detach.prof } : null;
    const tex = tracer.run({
      w: size[0], h: size[1], jitter,
      cam: { pos: [camera.position.x, camera.position.y, camera.position.z], tanHalf, r: [e[0], e[1], e[2]], u: [e[4], e[5], e[6]], f: [-e[8], -e[9], -e[10]] },
      mood: M, sunI, skyI, amb,
      col: { a: R.sim.a * 100, Z: S.Z * 100, dz: S.dx * 100, n: S.nz, rows: rowsBuf },
      ice: { sigma: I.sigma, bubbles: I.bubbles, blue: I.blue, feedOffset: state.feed, cellH: feedP / nPer, nPer, section: SECTIONS[R.section] },
      frag, ripple: state.ripple,
      glint: amb.map((a) => 0.44 * (2 * a + 0.03 * M.lbI + 0.004 * sunI)),
    });
    if (texNode.value !== tex) texNode.value = tex;
  }

  return {
    group, setRecipe, update,
    ready: () => !!data,
    progress: () => prog,
    state: () => state,
    data: () => data,
    setShadowQuality() {}, syncFinishes() {},
  };
}
