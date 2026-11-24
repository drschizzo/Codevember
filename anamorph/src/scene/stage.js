// La scène : un sol, l'objet (famille « bloc taillé » pour l'instant), le
// soleil de minuit et le ciel. Le soleil est la seule horloge : sa position
// vient de l'angle horaire H(phase), et l'ombre suit (Anamorph, docs/concept.md).
//
// Principes du gabarit gardés :
//  - update(ph) ne dépend que de la recette et de la phase ;
//  - un maillage reçoit son matériau quand SA géométrie est arrivée ;
//  - toutes les lumières sont créées une fois, dans un ordre fixe.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { buildPieceMaterial, finishUniforms, signature } from '../../../shared/scene/materials.js';
import { sunAt } from '../gen/shadowart.js';
import { hourAngle } from '../gen/clock.js';
import { objectMaterial } from './objectMaterials.js';
import { createMotion } from './motion.js';
import { unpackPlan, flightAt } from '../gen/assembly.js';
import { assemblyTiming } from '../gen/clock.js';
import { G } from '../../../shared/scene/globals.js';
import { groundMaterial } from './ground.js';
import './sky.js';

const SHADOW = { mobile: 2048, low: 2048, medium: 4096, high: 4096, ultra: 4096 };

function toGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  if (o.pc) g.setAttribute('pc', new THREE.BufferAttribute(o.pc, 4));
  g.computeBoundingSphere();
  g.boundingSphere.radius += 4; // (les pièces volent et s'éparpillent autour du tas : pas de découpage hors champ)
  return g;
}

const finishU = (f) => ({ outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(f.wear) });


export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) : le soleil, le ciel ──
  const sunL = new THREE.DirectionalLight(0xffffff, 3);
  sunL.castShadow = true;
  sunL.shadow.mapSize.set(4096, 4096);
  sunL.shadow.bias = -0.0002;
  sunL.shadow.normalBias = 0.01;
  sunL.shadow.radius = 2;
  scene.add(sunL); scene.add(sunL.target);
  const sky = new THREE.HemisphereLight(0x9cb8e6, 0xe8e6e0, 0.9);
  scene.add(sky);

  // ── Sol ──
  // Le sol en deux morceaux (src/scene/ground.js) : près du tas, un carré
  // finement maillé dont le relief est réellement déplacé (et qui porte la
  // congère dans la neige) ; autour, un grand plan troué, en relief d'ombrage
  // seulement. Au bord du carré, le déplacement est nul : raccord exact.
  let groundKind = 'snow', patchBox = null, driftData = null;
  const floor = new THREE.Mesh(new THREE.BufferGeometry(), groundMaterial(groundKind));
  const patch = new THREE.Mesh(new THREE.BufferGeometry(), groundMaterial(groundKind, { patch: true }));
  floor.receiveShadow = true;
  patch.receiveShadow = patch.castShadow = true;
  scene.add(floor, patch);
  const PATCH_N = lite ? 200 : 400, PATCH_MARGIN = 2.6, FAR = 60; // (mobile : un sommet tous les 3,4 cm)
  function buildGround(bounds, D) {
    const x0 = bounds[0] - PATCH_MARGIN, z0 = bounds[2] - PATCH_MARGIN;
    const size = Math.max(bounds[3] - bounds[0], bounds[5] - bounds[2]) + 2 * PATCH_MARGIN;
    patchBox = [x0, z0, size];
    // le plan troué : un grand carré moins le carré du tas (forme dans le plan x, −z)
    const shape = new THREE.Shape([new THREE.Vector2(-FAR, -FAR), new THREE.Vector2(FAR, -FAR), new THREE.Vector2(FAR, FAR), new THREE.Vector2(-FAR, FAR)]);
    shape.holes.push(new THREE.Path([new THREE.Vector2(x0, -z0), new THREE.Vector2(x0, -(z0 + size)), new THREE.Vector2(x0 + size, -(z0 + size)), new THREE.Vector2(x0 + size, -z0)]));
    floor.geometry.dispose();
    floor.geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    // le carré : la congère (neige) en hauteur et en normales ; la macro est ajoutée dans le shader
    const g = new THREE.PlaneGeometry(size, size, PATCH_N - 1, PATCH_N - 1).rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const sample = (x, z) => {
      if (!D || groundKind !== 'snow') return 0;
      const fx = (x - D.x0) / D.size * (D.N - 1), fz = (z - D.z0) / D.size * (D.N - 1);
      if (fx < 0 || fz < 0 || fx >= D.N - 1 || fz >= D.N - 1) return 0;
      const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, H = D.heights, N = D.N;
      return (H[j * N + i] * (1 - tx) + H[j * N + i + 1] * tx) * (1 - tz) + (H[(j + 1) * N + i] * (1 - tx) + H[(j + 1) * N + i + 1] * tx) * tz;
    };
    const dr = new Float32Array(PATCH_N * PATCH_N * 3), e = size / (PATCH_N - 1);
    for (let j = 0; j < PATCH_N; j++) for (let i = 0; i < PATCH_N; i++) {
      const x = x0 + (i / (PATCH_N - 1)) * size, z = z0 + (j / (PATCH_N - 1)) * size, v = j * PATCH_N + i;
      pos.setXYZ(v, x, 0, z);
      // la congère en attribut (hauteur et pentes) : le shader la dose selon le tas
      dr[v * 3] = sample(x, z);
      dr[v * 3 + 1] = (sample(x + e, z) - sample(x - e, z)) / (2 * e);
      dr[v * 3 + 2] = (sample(x, z + e) - sample(x, z - e)) / (2 * e);
    }
    g.setAttribute('drift', new THREE.BufferAttribute(dr, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    patch.geometry.dispose();
    patch.geometry = g;
    syncGroundUniforms(bounds);
  }
  function syncGroundUniforms(bounds) {
    if (!patchBox) return;
    const heap = [(bounds[0] + bounds[3]) / 2, (bounds[2] + bounds[5]) / 2, (bounds[3] - bounds[0]) / 2, (bounds[5] - bounds[2]) / 2];
    for (const M of [floor.material, patch.material]) {
      M.userData.U.patch.value.set(patchBox[0], patchBox[1], patchBox[2], 0.9);
      M.userData.U.heap.value.set(...heap);
    }
  }

  // ── Objet ──
  const obj = new THREE.Mesh(new THREE.BufferGeometry());
  obj.castShadow = obj.receiveShadow = true;
  obj.visible = false;
  scene.add(obj);
  let R = null, pending = 0, version = 0, data = null, objKey = '', genP = 0, plan = null, motion = null;

  function setRecipe(recipe) {
    R = recipe;
    const O = R.object;
    // le sol de l'humeur (un nouveau matériau seulement s'il change)
    if (R.floor.ground !== groundKind) {
      groundKind = R.floor.ground;
      for (const [mesh, opt] of [[floor, {}], [patch, { patch: true }]]) { const old = mesh.material; mesh.material = groundMaterial(groundKind, opt); old.dispose(); }
      if (data) buildGround(data.bounds, data.drift); // (la congère n'existe que dans la neige)
    }
    if (obj.material?.userData?.U?.frost) { const MU = obj.material.userData.U; MU.frost.value = O.frost ?? 0.5; MU.rust.value = O.rust; if (MU.paint && O.paint) MU.paint.value.set(O.paint); }
    const spec = { seed: R.seed, family: O.family, accord: O.accord ?? 'rouille', lat: R.sun.lat, dec: R.sun.dec, height: O.height, figs: O.figs };
    const key = JSON.stringify(spec);
    if (key !== objKey) {
      objKey = key;
      const v = ++version;
      pending = 1;
      genP = 0;
      // (l'avancement et les traits du calcul vont à l'écran de chargement : api.onArt)
      gen.request(spec, 'object', (p, label) => { genP = p; if (label) { try { api.onArt?.(JSON.parse(label)); } catch { /* */ } } }).then((o) => {
        if (v !== version) return;
        data = o;
        obj.geometry.dispose();
        obj.geometry = toGeometry(o.mesh);
        const old = obj.material;
        plan = o.assembly ? unpackPlan(o.assembly.data, o.assembly.n) : null;
        motion = plan ? createMotion(plan.length) : null;
        obj.material = O.family === 'fer' ? objectMaterial(O.accord ?? 'rouille', { rust: O.rust ?? 0.45, frost: O.frost ?? 0.5, paint: O.paint }) : buildPieceMaterial(O.finish, finishU(O.finish), { seedOff: uniform(new THREE.Vector3(1.3, 2.1, 0.5)) });
        motion?.attach(obj.material);
        if (old && old !== obj.material) old.dispose?.();
        obj.visible = true;
        buildGround(o.bounds, o.drift);
        pending = 0;
        console.log('anamorph : couverture des figures', o.coverage.map((c) => `${(100 * c).toFixed(1)} %`).join(', '));
      }).catch((e) => { console.error(e); pending = 0; });
    }
  }

  // la caméra d'ombre suit le soleil et cadre l'objet et toute son ombre
  const _c = new THREE.Vector3(), _m = new THREE.Matrix4(), _pts = [];
  function fitShadow(d, spread = false) {
    let b = data?.bounds ?? [-1, 0, -1, 1, 1, 1];
    // (pièces en vol ou au sol : la carte d'ombre couvre l'anneau d'éparpillement et l'altitude de passage)
    if (spread) b = [b[0] - 2.8, 0, b[2] - 2.8, b[3] + 2.8, 1.7, b[5] + 2.8];
    const t = b[4] / Math.max(0.02, d.y); // longueur du trajet d'un sommet de l'objet jusqu'au sol
    _pts.length = 0;
    for (const x of [b[0], b[3]]) for (const z of [b[2], b[5]]) {
      _pts.push([x, 0, z], [x, b[4], z], [x - t * d.x, 0, z - t * d.z]);
    }
    const ctr = _pts.reduce((a, p) => [a[0] + p[0] / _pts.length, a[1] + p[1] / _pts.length, a[2] + p[2] / _pts.length], [0, 0, 0]);
    sunL.target.position.set(...ctr);
    sunL.position.set(ctr[0] + d.x * 20, ctr[1] + d.y * 20, ctr[2] + d.z * 20);
    sunL.updateMatrixWorld(); sunL.target.updateMatrixWorld();
    _m.lookAt(sunL.position, sunL.target.position, _c.set(0, 1, 0)).invert();
    _m.setPosition(0, 0, 0);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of _pts) {
      _c.set(p[0] - ctr[0], p[1] - ctr[1], p[2] - ctr[2]).applyMatrix4(_m);
      x0 = Math.min(x0, _c.x); x1 = Math.max(x1, _c.x); y0 = Math.min(y0, _c.y); y1 = Math.max(y1, _c.y);
    }
    const S = sunL.shadow.camera, pad = 0.1;
    S.left = x0 - pad; S.right = x1 + pad; S.bottom = y0 - pad; S.top = y1 + pad;
    S.near = 1; S.far = 40;
    S.updateProjectionMatrix();
  }

  const _d = new THREE.Vector3();
  function update(ph) {
    if (!R) return;
    const s = sunAt(R.sun.lat, R.sun.dec, hourAngle(R, ph));
    _d.set(...s.d);
    let spread = false;
    if (plan && motion) {
      const timing = assemblyTiming(R);
      motion.update(plan, ph, G.phasePrev.value, timing);
      let placed = 0;
      for (const p of plan) if (flightAt(ph, p.k, plan.length, timing) >= 1) placed++;
      spread = placed < plan.length;
      // la congère suit le tas (en retard sur l'assemblage, en avance sur le démontage)
      const f = placed / plan.length;
      patch.material.userData.U.drift.value = f * f * (3 - 2 * f);
    }
    fitShadow(_d, spread);
    // couleur et intensité du soleil : rougissement léger près de l'horizon
    const air = 1 / Math.max(0.05, Math.sin(s.h) + 0.15 * (s.h * 57.3 + 3.885) ** -1.253);
    sunL.color.setRGB(1, Math.exp(-0.012 * air), Math.exp(-0.03 * air));
    sunL.intensity = R.light.sun * Math.exp(-0.02 * air);
    sky.intensity = R.light.sky;
    floor.material.userData.U.sun.value.copy(_d);
    patch.material.userData.U.sun.value.copy(_d);
    // l'auréole du studio HDR (dessinée à l'azimut 0) passe derrière le soleil
    api.envYaw = Math.atan2(_d.z, _d.x);
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 4096;
    if (sunL.shadow.mapSize.x !== s) { sunL.shadow.mapSize.set(s, s); sunL.shadow.map?.dispose(); sunL.shadow.map = null; }
  }

  const api = {
    envYaw: 0, onArt: null,
    setRecipe, update, syncFinishes() {}, setShadowQuality, floor, patch, obj, sun: sunL, sky,
    data: () => data,
    ready: () => pending === 0,
    progress: () => (pending ? genP : 1),
  };
  return api;
}
