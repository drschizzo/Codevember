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
import { texture as tTexture, equirectUV, normalize, positionWorld, cameraPosition, vec4, vec2, vec3, float, uniform, screenUV, screenSize, getViewPosition, fwidth, smoothstep, step, floor, fract, length, mx_cell_noise_float, max as tmax, select, sin, atan } from 'three/tsl';
import { NZ } from './materials.js';

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
    const E = out.emerge, et = W.dataTex(E.tex, E.nf, E.levels, THREE.HalfFloatType, THREE.RGFormat, THREE.RepeatWrapping);
    et.minFilter = et.magFilter = THREE.NearestFilter;
    { const old = emT.value; emT.value = et; old?.dispose?.(); }
    DU.y0.value = E.y0; DU.dy.value = E.dy; DU.levels.value = E.levels; DU.nf.value = E.nf; DU.fps.value = S.fps;
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

  // ── Le hublot-dôme, en post-traitement : ce que l'eau laisse sur la
  // lentille. Pour chaque pixel, le point du dôme où part son rayon (le même
  // que pour le brouillard d'eau) dit s'il est dans l'eau, à l'air, ou juste
  // au-dessus de la ligne d'eau, et depuis combien de temps il a émergé
  // (l'enveloppe de séchage de la mer, lue au point du dôme).
  //  - Ménisque : une ligne sombre où l'eau coupe le dôme, et au-dessus une
  //    nappe qui ruisselle et ondule l'image en descendant.
  //  - Gouttes : des lentilles plano-convexes. Chacune montre la scène
  //    renversée et réduite (l'image vue par une calotte d'eau de courte
  //    focale), cerclée d'un bord sombre (réfraction rasante) avec un reflet
  //    du ciel en haut et une caustique claire en bas ; les grosses glissent
  //    en laissant une traînée humide, toutes rétrécissent en séchant, à des
  //    instants différents. Deux couches de cellules (une goutte au plus par
  //    cellule, pas de voisins à parcourir) : deux tirages, une lecture de
  //    l'image déformée.
  const DU = { pos: uniform(new THREE.Vector3()), projInv: uniform(new THREE.Matrix4()), world: uniform(new THREE.Matrix4()), y0: uniform(0), dy: uniform(0.24), levels: uniform(32), nf: uniform(1920), fps: uniform(60) };
  const emT = tTexture(W.dataTex(new Uint16Array(8), 2, 2, THREE.HalfFloatType, THREE.RGFormat, THREE.RepeatWrapping));
  function domeLens(sample) {
    const uv0 = screenUV;
    const vp = getViewPosition(uv0, float(0.5), DU.projInv);
    const dW = normalize(DU.world.mul(vec4(vp, 0)).xyz);
    const O = DU.pos.add(dW.mul(W.U.dome));
    const a = O.y.sub(W.level(O.x, O.z, W.U.t)).toVar();
    const fw = fwidth(a).max(1e-5);
    const air = smoothstep(fw.mul(1.5), fw.mul(4), a);
    // depuis quand l'eau a quitté ce point du dôme (−1 : dans l'eau), et le
    // numéro de cette émergence (chaque vague dépose de nouvelles gouttes)
    const em = emT.sample(vec2(W.U.t.mul(DU.fps).add(0.5).div(DU.nf), O.y.sub(DU.y0).div(DU.dy).mul(DU.levels.sub(1)).add(0.5).div(DU.levels))).level(0);
    const tau = em.x.toVar(), wave = em.y;
    const wet = step(0, tau).mul(air).toVar();
    const asp = screenSize.x.div(screenSize.y);
    const P = vec2(uv0.x.mul(asp), uv0.y);
    // (les gouttes se groupent : une densité qui varie lentement sur le dôme)
    const patch = smoothstep(-0.25, 0.45, NZ(vec3(P.mul(2.3), wave.mul(0.37).add(3.1))).x).mul(1.3);
    // une couche de gouttes : cellules de taille 1/scale, une goutte tirée par
    // cellule et par émergence ; elle naît quand l'eau se retire, sèche en
    // rétrécissant à son heure, et les grosses glissent en accélérant
    const layer = (scale, salt, dens) => {
      const q = P.mul(scale), cell = floor(q), sd = cell.add(wave.mul(17.3)).add(salt);
      const h1 = mx_cell_noise_float(sd), h2 = mx_cell_noise_float(sd.add(7.3)), h3 = mx_cell_noise_float(sd.add(19.1)), h4 = mx_cell_noise_float(sd.add(31.7));
      const big = h3.mul(h3);
      const lifeT = h4.mul(11).add(3).mul(float(1).sub(big.mul(0.4)));
      const life = float(1).sub(tau.div(lifeT)).clamp(0, 1);
      const r = big.mul(0.26).add(0.07).mul(life.sqrt());
      // glissement : départ après un temps propre à la goutte, puis accéléré
      const t0 = h1.mul(2.5).add(0.4), run = tau.sub(t0).max(0);
      const slide = step(0.55, h3).mul(big.mul(0.08).add(0.02)).mul(run).mul(run).min(0.75);
      const sway = sin(slide.mul(11).add(h2.mul(6.3))).mul(0.03).mul(step(0.001, slide));
      const c = vec2(h1.mul(0.5).add(0.25).add(sway), h2.mul(0.3).add(0.15).add(slide));
      const d0 = q.sub(cell).sub(c);
      // forme : affaissée vers le bas (la gravité), allongée en glissant, contour irrégulier
      const e = vec2(d0.x.mul(h2.mul(0.35).add(0.85)).mul(float(1).add(slide.mul(0.6))), d0.y.mul(select(d0.y.greaterThan(0), float(0.75), float(1.12))).div(float(1).add(slide.mul(0.5))));
      const ang = atan(e.y, e.x);
      const rr = r.mul(float(1).add(sin(ang.mul(2).add(h4.mul(6.3))).mul(big.mul(0.18))).add(sin(ang.mul(3).add(h1.mul(6.3))).mul(0.08)).add(sin(ang.mul(5).add(h2.mul(6.3))).mul(0.04)));
      const k = length(e).div(rr.max(1e-4));
      const exist = step(float(1).sub(dens.mul(patch)), h1.mul(0.6).add(h2.mul(0.4))).mul(step(0.01, life)).mul(smoothstep(0.75, 0.6, slide));
      // traînée humide au-dessus d'une goutte qui glisse
      const trail = step(d0.x.abs(), r.mul(0.3)).mul(step(d0.y, 0)).mul(step(slide.negate(), d0.y)).mul(step(0.01, slide)).mul(exist).mul(life);
      return { k, inside: smoothstep(1.0, 0.9, k).mul(exist), d: e.div(rr.max(1e-4)), r: rr.div(scale), trail };
    };
    const A = layer(float(6), 0, float(0.38)), B = layer(float(15), 41, float(0.45));
    const useA = A.inside.greaterThanEqual(B.inside);
    const ins = select(useA, A.inside, B.inside).mul(wet);
    const k = select(useA, A.k, B.k), dd = select(useA, A.d, B.d), rad = select(useA, A.r, B.r);
    // réfraction : l'image renversée et réduite au centre de la goutte, qui se
    // déforme vers le bord (la calotte devient prisme)
    const prof = k.mul(k).mul(0.6).add(0.4);
    const off = dd.mul(rad).mul(-3.2).mul(prof);
    // nappe sous la ligne d'eau : juste au-dessus du ménisque, l'eau ruisselle
    // (et, l'instant où l'eau quitte le dôme, la pellicule qui s'en retire)
    const sheet = smoothstep(fw.mul(60), fw.mul(4), a).mul(air).max(smoothstep(0.5, 0.0, tau).mul(wet));
    const wob = vec2(sin(uv0.y.mul(140).add(uv0.x.mul(23)).add(W.U.t.mul(7))), sin(uv0.x.mul(90).add(W.U.t.mul(5)))).mul(0.0025).mul(sheet);
    const trailOff = vec2(select(useA, A.trail, B.trail).mul(0.0035).mul(wet), 0);
    const uvS = uv0.add(vec2(off.x.div(asp), off.y).mul(ins)).add(wob).add(trailOff);
    let col = sample(uvS).rgb;
    // bord sombre, reflet du ciel en haut, caustique en bas
    const ring = smoothstep(0.78, 0.98, k).mul(ins);
    const glint = smoothstep(0.16, 0.0, length(dd.sub(vec2(-0.3, -0.45)).mul(vec2(0.8, 1.6)))).mul(ins);
    const caus = smoothstep(0.35, 0.0, length(dd.sub(vec2(0.1, 0.55)))).mul(ins).mul(0.35);
    col = col.mul(float(1).sub(ring.mul(0.55))).add(vec3(glint.mul(0.7))).add(col.mul(caus));
    // le ménisque : une ligne sombre, un liseré clair qui accroche le ciel
    const line = smoothstep(fw.mul(2.2), float(0), a.abs());
    const rim = smoothstep(fw.mul(5), fw.mul(1.5), a.sub(fw.mul(3.5)).abs()).mul(step(0, a));
    col = col.mul(float(1).sub(line.mul(0.85))).add(vec3(rim.mul(0.18)));
    return vec4(tmax(col, vec3(0)), 1);
  }
  function setDomeCamera(cam) { DU.pos.value.copy(cam.position); DU.projInv.value.copy(cam.projectionMatrixInverse); DU.world.value.copy(cam.matrixWorld); }

  return {
    domeLens, setDomeCamera,
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
