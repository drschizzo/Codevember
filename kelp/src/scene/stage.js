// La scène : le ciel, le soleil (ou la lune), la roche, l'eau, les laminaires,
// la caméra au ras de l'eau. setRecipe(R) demande la scène au worker (mer,
// roche, laminaires, ciel) ; update(ph) ne dépend que de la recette, des
// données reçues et de la phase.
//
// (Toutes les lumières sont créées une fois, dans un ordre fixe, au premier
// niveau de la scène : changer leur ordre recompile tous les matériaux.)
import * as THREE from 'three/webgpu';
import { createWater, createSurface } from './water.js';
import { createTerrain } from './terrain.js';
import { createKelp } from './kelp.js';
import { sunDir } from '../gen/sky.js';
import { cameraPose } from '../camera.js';
import { G } from './globals.js';
import { texture as tTexture, equirectUV, normalize, positionWorld, cameraPosition, vec4 } from 'three/tsl';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
const lin = (h) => new THREE.Color(h);

export function createStage(scene, gen, { lite = false } = {}) {
  // ── lumière : le soleil (ou la lune) ──
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.01;
  sun.shadow.radius = 3;
  const sc = sun.shadow.camera;
  sc.left = -3.5; sc.right = 3.5; sc.top = 3.5; sc.bottom = -3.5; sc.near = 0.5; sc.far = 40;
  scene.add(sun); scene.add(sun.target);

  const W = createWater();
  scene.fogNode = W.fogNode;
  const skyHolder = { tex: makeSkyTex(new Uint16Array(4 * 8), 4, 2) };
  const terrain = createTerrain(W, lite);
  const surface = createSurface(W, skyHolder.tex, lite);
  const kelp = createKelp(W, lite);
  // le ciel : une grande sphère de la scène (le fond de three.js, dessiné à
  // part, restait noir après le préchauffage asynchrone des pipelines)
  const skyNode = tTexture(skyHolder.tex);
  const skyMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  skyMat.fog = false;
  skyMat.colorNode = skyNode.sample(equirectUV(normalize(positionWorld.sub(cameraPosition)))).level(0).rgb;
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(500, 64, 32), skyMat);
  skyMesh.frustumCulled = false; skyMesh.renderOrder = -1;
  const group = new THREE.Group();
  group.add(skyMesh, terrain.mesh, kelp.mesh, kelp.hold, surface.mesh);
  scene.add(group);

  let R = null, D = null, sky = null, pending = 0, version = 0, prog = 0;
  const onSky = { fn: null };

  function setRecipe(recipe, onProgress = null) {
    R = recipe;
    const v = ++version;
    pending = 2; prog = 0;
    const spec = { R, lite };
    gen.request(spec, 'scene', (p) => { if (v === version) { prog = p; onProgress?.(p); } }).then((out) => {
      if (v !== version) return;
      apply(out);
      pending--;
    }).catch((e) => { console.error(e); pending = -1; });
    gen.request({ R: { seed: R.seed, sky: R.sky, sun: R.sun, camera: R.camera, water: R.water }, W: lite ? 512 : 1024 }, 'sky').then((o) => {
      if (v !== version) return;
      sky = o;
      // (le fond et l'environnement sont deux textures distinctes : partagée, la
      // texture du fond était lue dans sa version préfiltrée, noire)
      const t = makeSkyTex(o.pixels, o.W, o.H), tb = makeSkyTex(o.pixels, o.W, o.H), ts = makeSkyTex(o.small, o.sw, o.sh);
      const old = [skyHolder.tex, skyHolder.bg, skyHolder.small];
      skyHolder.tex = t; skyHolder.bg = tb; skyHolder.small = ts;
      surface.setSky(ts);
      scene.environment = t; scene.background = null; skyNode.value = tb;
      for (const x of old) if (x) setTimeout(() => x.dispose(), 0);
      pending--;
    }).catch((e) => { console.error(e); pending = -1; });
  }

  function apply(out) {
    D = out;
    const S = out.sea;
    // mer
    const seaTex = W.dataTex(S.tex, S.nx, S.nf, THREE.HalfFloatType, THREE.RGBAFormat, THREE.RepeatWrapping);
    const wetTex = W.dataTex(S.wet, S.nx, S.nf, THREE.HalfFloatType, THREE.RedFormat, THREE.RepeatWrapping);
    const prof = new Uint16Array(S.nx * 4);
    for (let i = 0; i < S.nx; i++) prof[4 * i] = toHalf(S.b[i]);
    const profTex = W.dataTex(prof, S.nx, 1);
    // roche
    const Rk = out.rock;
    const relTex = W.dataTex(Rk.relief, Rk.M, Rk.M);
    const fillTex = W.dataTex(Rk.fill, Rk.M, Rk.M, THREE.HalfFloatType, THREE.RedFormat);
    const colTex = W.dataTex(Rk.color, Rk.M, Rk.M, THREE.UnsignedByteType);
    colTex.colorSpace = THREE.SRGBColorSpace;
    colTex.generateMipmaps = true; colTex.minFilter = THREE.LinearMipmapLinearFilter; colTex.anisotropy = 8;
    for (const [node, t] of [[W.seaT, seaTex], [W.wetT, wetTex], [W.profT, profTex], [W.reliefT, relTex], [W.fillT, fillTex], [terrain.colT, colTex]]) {
      const old = node.value; node.value = t; if (old && old !== t) old.dispose();
    }
    const U = W.U;
    U.seaX0.value = S.x0; U.seaW.value = S.nx * S.dx; U.fps.value = S.fps; U.nf.value = S.nf; U.T.value = out.T;
    U.box.value.set(Rk.box.x0, Rk.box.z0, Rk.box.x1 - Rk.box.x0, Rk.box.z1 - Rk.box.z0);
    kelp.setData(out.kelp, R);
  }

  function syncLook() {
    const U = W.U;
    U.obliq.value = R.sea.obliq; U.zRef.value = D?.cam?.z ?? R.camera.z;
    U.ext.value.set(...R.water.ext); U.tint.value.setRGB(...R.water.tint); U.scat.value = R.water.scat ?? 0.3;
    U.glow.value = R.water.glow ?? 0;
    U.dome.value = R.camera.dome;
    const sd = sunDir(R);
    U.sunDir.value.set(...sd);
    const sunCol = lin(R.sun.color);
    U.sunE.value.copy(sunCol).multiplyScalar(R.sun.lux * Math.max(0, Math.min(1, (sd[1] + 0.02) / 0.08)));
    const z = R.sky.zenith, h = R.sky.horizon, I = R.sky.intensity * R.env.intensity;
    U.skyE.value.setRGB((z[0] * 0.6 + h[0] * 0.4) * I, (z[1] * 0.6 + h[1] * 0.4) * I, (z[2] * 0.6 + h[2] * 0.4) * I);
    U.haze.value.setRGB(h[0] * I, h[1] * I, h[2] * I);
    // vagues au large (mêmes paramètres que le bord de la simulation)
    const wv = R.sea.waves;
    [[U.w0, U.v0], [U.w1, U.v1], [U.w2, U.v2]].forEach(([w, vv], k) => { const q = wv[k]; w.value.set(q.t, q.A, q.beta, q.d); vv.value.set(q.tc, q.tt, 0, 0); });
    terrain.RU.base.value.copy(lin(R.rock.color.base));
    // le soleil
    sun.color.copy(sunCol);
    sun.intensity = R.sun.lux * Math.max(0, Math.min(1, (sd[1] + 0.02) / 0.08));
    const c = camPose(0);
    const tgt = new THREE.Vector3(c.pos.x - 0.6, c.pos.y - 0.3, c.pos.z - 2.4);
    sun.target.position.copy(tgt);
    sun.position.set(tgt.x + sd[0] * 15, tgt.y + Math.max(0.2, sd[1]) * 15, tgt.z + sd[2] * 15);
    scene.environmentIntensity = R.env.intensity;
    scene.backgroundIntensity = 1;
  }

  // ── la caméra : un trépied au ras de l'eau, un lent travelling périodique ──
  const _p = new THREE.Vector3(), _t = new THREE.Vector3();
  function camPose(ph) {
    const P = cameraPose(R.camera, D?.cam ?? { x: -0.6, y: 0.3, z: R.camera.z }, ph);
    _p.set(...P.pos); _t.set(...P.target);
    return { pos: _p, target: _t, fov: P.fov };
  }

  function update(ph, phPrev = ph) {
    if (!R) return;
    if (D) syncLook();
    const T = D?.T ?? R.loop.duration;
    W.U.t.value = ph * T;
    W.U.tPrev.value = phPrev * T;
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (sun.shadow.mapSize.x !== s) { sun.shadow.mapSize.set(s, s); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  }

  return {
    setRecipe, update, setShadowQuality, camPose, group, sun, W, kelp, terrain, surface,
    get data() { return D; },
    ready: () => pending === 0 && !!D && !!sky,
    failed: () => pending < 0,
    progress: () => prog,
    syncFinishes: () => {},
  };
}

function makeSkyTex(pixels, w, h) {
  const t = new THREE.DataTexture(pixels, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  // (sans mipmaps : leur génération échoue en silence pour une texture
  // demi-flottante de données — le ciel restait noir)
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function toHalf(v) {
  _f[0] = v; const x = _u[0];
  const sgn = (x >> 16) & 0x8000, e = ((x >> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return sgn;
  if (e >= 31) return sgn | 0x7c00;
  return sgn | (e << 10) | (m >> 13);
}
