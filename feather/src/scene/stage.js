// La scène : le fond neutre, le corps de l'oiseau sous son plumage, les plumes
// voisines couchées en rangées, la plume héroïne (la nouvelle, et l'ancienne
// qu'elle chasse), sa gaine, les lumières de l'humeur.
//
// update(ph) ne dépend que de la recette et de la phase. Toutes les lumières
// sont créées une fois, dans un ordre fixe, au premier niveau de la scène.
import * as THREE from 'three/webgpu';
import {
  uniform, uniformArray, vec3, vec4, float, mix, normalize, positionWorld, cameraPosition, dot, pow, max as tmax, smoothstep, normalWorld,
} from 'three/tsl';
import { barbGeometry, barbMaterial, rachisGeometry, rachisMaterial, sheathMaterial, createLook, FSTRIDE, tubeTemplate } from './feather.js';
import { isLite, stableVelocity, noise } from './materials.js';
import { BIRDS } from '../families.js';
import { growth, bendOf, layoutPlumage, featherFrame, betaAt, LIE_BETA, settleAt, wearAt, ejection, LIE, SCHED, qrot } from '../gen/feather.js';
import { cameraPath } from '../camera.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
const MAXF = 256;

// quaternion (x, y, z, w) : produit et rotation autour d'un axe
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qaxis = (ax, a) => { const s = Math.sin(a / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(a / 2)]; };

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const key = new THREE.SpotLight(0xffffff, 3, 0, 0.5, 0.6, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 4;
  const rim = new THREE.SpotLight(0xffffff, 1, 0, 0.6, 0.8, 0);
  const fill = new THREE.SpotLight(0xffffff, 0.3, 0, 0.9, 1, 0);
  if (lite) fill.visible = false;
  for (const l of [key, rim, fill]) { scene.add(l); scene.add(l.target); }

  // ── Fond : un dégradé neutre et une lueur à l'opposé de la caméra ──
  const BG = { top: uniform(new THREE.Color()), bottom: uniform(new THREE.Color()), glow: uniform(new THREE.Color()), glowK: uniform(0), glowDir: uniform(new THREE.Vector3(0, 0, -1)) };
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), (() => {
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
    const d = normalize(positionWorld.sub(cameraPosition));
    const g = pow(tmax(dot(d, BG.glowDir), 0), 6).mul(BG.glowK);
    m.colorNode = mix(BG.bottom, BG.top, smoothstep(-0.35, 0.65, d.y)).add(BG.glow.mul(g));
    m.mrtNode = stableVelocity();
    return m;
  })());
  backdrop.renderOrder = -10;
  backdrop.frustumCulled = false;
  scene.add(backdrop);

  // ── Le corps : sous le plumage, un duvet sombre ──
  const bodyU = { color: uniform(new THREE.Color()) };
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 128), (() => {
    const m = new THREE.MeshPhysicalNodeMaterial();
    const nz = noise(positionWorld.mul(1.7)).mul(0.5).add(0.5);
    m.colorNode = bodyU.color.mul(nz.mul(0.4).add(0.8));
    m.roughnessNode = float(0.95);
    m.metalnessNode = float(0);
    m.sheenNode = bodyU.color.mul(1.2);
    m.sheenRoughnessNode = float(0.6);
    m.mrtNode = stableVelocity();
    void normalWorld; void vec4;
    return m;
  })());
  body.receiveShadow = true;
  body.castShadow = false;
  scene.add(body);

  // ── Les plumes ──
  const group = new THREE.Group();
  scene.add(group);
  const arr = Array.from({ length: MAXF * FSTRIDE }, () => new THREE.Vector4());
  const arrP = Array.from({ length: MAXF * FSTRIDE }, () => new THREE.Vector4());
  const FS = uniformArray(arr, 'vec4'), FSP = uniformArray(arrP, 'vec4');
  const LK = createLook(), LKT = createLook(); // (LKT : les voisines, quand elles ne sont pas de la famille héroïne)
  const mkFU = () => ({ L: uniform(6), radial: uniform(0), calamus: uniform(0.1), over: uniform(1.08), r0: uniform(0.05), rhoTex: null });
  const FU = mkFU(), FUT = mkFU();
  let meshes = [], R = null, lay = null, cam = null, pending = 0, version = 0, nTiles = 0;
  let texs = [], lastPh = 0;
  const tileState = [];

  function clear() {
    for (const m of meshes) { group.remove(m); m.geometry.dispose(); m.material.dispose(); }
    meshes = [];
  }
  const add = (mesh, cast = true) => { mesh.castShadow = cast; mesh.receiveShadow = true; mesh.frustumCulled = false; group.add(mesh); meshes.push(mesh); };

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    pending = 1;
    const P = R.shape, T = R.tile ?? P;
    lay = layoutPlumage(P, R.seed, { lite, tile: R.tile });
    cam = cameraPath(R, lay);
    nTiles = Math.min(lay.tiles.length, MAXF - 2);
    body.scale.setScalar(lay.Rd - 0.15);
    body.position.set(0, -lay.Rd, 0);
    gen.request({ shape: P, pattern: R.pattern, seed: R.seed, lite, tileShape: R.tile, tilePattern: R.tilePattern }, 'feather').then((o) => {
      if (v !== version) return;
      clear();
      for (const t of texs) t.dispose();
      const patOf = (data) => {
        const t = new THREE.DataTexture(data, o.nx, o.nz, THREE.RGBAFormat, THREE.UnsignedByteType);
        t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
        t.magFilter = t.minFilter = THREE.LinearFilter;
        t.colorSpace = THREE.NoColorSpace;
        t.needsUpdate = true;
        return t;
      };
      const rhoOf = (rho) => {
        const rh = new Uint16Array(65 * 4);
        for (let i = 0; i < 65; i++) rh[i * 4] = THREE.DataUtils.toHalfFloat(rho[i]);
        const t = new THREE.DataTexture(rh, 65, 1, THREE.RGBAFormat, THREE.HalfFloatType);
        t.magFilter = t.minFilter = THREE.LinearFilter;
        t.needsUpdate = true;
        return t;
      };
      const setFU = (F, S, rho) => {
        F.rhoTex = rhoOf(rho);
        F.L.value = S.L; F.radial.value = S.radial ? 1 : 0; F.calamus.value = S.calamus; F.over.value = S.over;
        F.r0.value = S.radial ? 0.035 : Math.max(0.03, S.L * 0.0085);
        return F.rhoTex;
      };
      const patTex = patOf(o.tex), patT = o.ttex ? patOf(o.ttex) : patTex;
      texs = [patTex, setFU(FU, P, o.rho)];
      if (o.ttex) texs.push(patT, setFU(FUT, T, o.trho));
      const FT = o.ttex ? FUT : FU, LT = o.ttex ? LKT : LK;
      // la plume héroïne : la nouvelle (0) et l'ancienne (1) partagent le gabarit fin
      const heroT = new Float32Array(o.hero.length * 2);
      heroT.set(o.hero, 0); heroT.set(o.hero, o.hero.length);
      for (let i = o.hero.length / 16; i < heroT.length / 16; i++) heroT[i * 16 + 8] = 1;
      const segs = lite ? 12 : 22;
      add(new THREE.Mesh(barbGeometry(heroT, segs), barbMaterial({ FS, FSP, FU, LK, PAT: patTex, moving: true })));
      // les voisines : gabarit grossier, une copie par tuile
      const nt = o.tile.length / 16;
      const tileT = new Float32Array(o.tile.length * nTiles);
      for (let j = 0; j < nTiles; j++) {
        tileT.set(o.tile, j * o.tile.length);
        for (let i = 0; i < nt; i++) { const q = (j * nt + i) * 16; tileT[q + 8] = j + 2; tileT[q + 9] = (tileT[q + 9] + j * 0.618) % 1; }
      }
      if (nTiles) add(new THREE.Mesh(barbGeometry(tileT, lite ? 7 : 11), barbMaterial({ FS, FSP, FU: FT, LK: LT, PAT: patT, moving: false })));
      // (duvet : un court calamus)
      add(new THREE.Mesh(P.radial ? rachisGeometry(2, 8, 8) : rachisGeometry(2), rachisMaterial({ FS, FSP, FU, LK, moving: true, offset: 0 })));
      if (nTiles) add(new THREE.Mesh(rachisGeometry(nTiles, 16, 5), rachisMaterial({ FS, FSP, FU: FT, LK: LT, moving: false, offset: 2 })));
      // la gaine de la plume nouvelle
      const tpl = tubeTemplate(64, 20);
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(tpl.position, 3));
      sg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(tpl.position.length), 3));
      sg.setIndex(tpl.index);
      sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
      add(new THREE.Mesh(sg, sheathMaterial({ FS, FSP, FU, LK, idx: 0 })));
      // les tuiles : repères fixes
      tileState.length = 0;
      for (let j = 0; j < nTiles; j++) {
        const t = lay.tiles[j];
        const fr = featherFrame(lay.Rd, t.th, t.ph, LIE_BETA(T.radial), LIE.omega, t.yaw);
        tileState.push({ p: fr.p, q: fr.q, scale: t.scale, wear: t.wear, rnd: t.rnd });
      }
      pending = 0;
      lastPh = -1;
    }).catch((e) => { console.error(e); pending = 0; });
    syncLook();
  }

  function syncLook() {
    const K = R.look;
    LK.base.value.set(K.base); LK.mark.value.set(K.mark); LK.down.value.set(K.down); LK.rachis.value.set(K.rachis); LK.sheath.value.set(K.sheath);
    const eye = K.eye ?? ['#000000', '#000000', '#000000', '#000000', '#000000'];
    [LK.eye0, LK.eye1, LK.eye2, LK.eye3, LK.eye4].forEach((u, i) => u.value.set(eye[i]));
    LK.irid.value = K.irid; LK.iridLo.value = K.iridLo; LK.iridHi.value = K.iridHi; LK.blue.value = K.blue;
    LK.sheen.value = K.sheen; LK.translucency.value = K.translucency;
    bodyU.color.value.set(K.down).lerp(new THREE.Color(K.base), 0.4).multiplyScalar(0.6); // (le duvet sous les plumes)
    // les voisines d'une autre famille (le duvet parmi les plumes de couverture)
    for (const k of Object.keys(LK)) if (LKT[k]) { const a = LK[k].value; if (a?.isColor) LKT[k].value.copy(a); else LKT[k].value = a; }
    const Bd = BIRDS[R.bird];
    if (R.tile && Bd.tileBase) { LKT.base.value.set(Bd.tileBase); LKT.mark.value.set(Bd.tileMark); LKT.sheen.value = 0.5; LKT.down.value.set(Bd.tileBase).lerp(new THREE.Color(K.down), 0.5); }
  }

  // écrit l'état d'une plume i : position, quaternion, (temps, usure, tirage, visible), (courbure)
  function put(i, p, q, scale, t, wear, rnd, vis, k) {
    arr[i * 4].set(p[0], p[1], p[2], scale);
    arr[i * 4 + 1].set(q[0], q[1], q[2], q[3]);
    arr[i * 4 + 2].set(t, wear, rnd, vis);
    arr[i * 4 + 3].set(k, 0, 0, 0);
  }

  const _v = new THREE.Vector3();
  function update(ph) {
    if (!R || !lay || pending) return;
    const P = R.shape;
    const k = bendOf(P, lay.Rd);
    const jump = lastPh < 0 || Math.abs(ph - lastPh) > 0.02;
    for (let i = 0; i < (2 + nTiles) * 4; i++) arrP[i].copy(arr[i]);
    // la nouvelle plume (0)
    const st = settleAt(ph);
    const fr = featherFrame(lay.Rd, lay.thH, 0, betaAt(ph, P.radial), (P.radial ? 0 : LIE.omega) * st);
    put(0, fr.p, fr.q, 1, ph, wearAt(ph), 0.5, 1, k);
    // l'ancienne (1) : la pose de la nouvelle à u = 1, poussée puis chassée
    const ej = ejection(ph, P, lay);
    const fo = featherFrame(lay.Rd, ej.th, 0, betaAt(1, P.radial), P.radial ? 0 : LIE.omega);
    const X = fo.X, Y = fo.Y;
    let q = qmul(qaxis(X, -ej.tilt), fo.q);
    q = qmul(qaxis(qrot(q, [0, 1, 0]), ej.roll), q);
    void Y;
    const vis = ph < SCHED.fall[1] + 0.05 && !ej.gone ? 1 : 0;
    put(1, [fo.p[0] + fo.n[0] * ej.lift, fo.p[1] + fo.n[1] * ej.lift, fo.p[2] + fo.n[2] * ej.lift], q, 1, 1, 1, 0.5, vis, k);
    // les voisines
    const kt = bendOf(R.tile ?? P, lay.Rd);
    for (let j = 0; j < nTiles; j++) { const t = tileState[j]; put(j + 2, t.p, t.q, t.scale, 1, t.wear, t.rnd, 1, kt * t.scale); }
    if (jump) for (let i = 0; i < (2 + nTiles) * 4; i++) arrP[i].copy(arr[i]);
    lastPh = ph;

    // fond, brume, lumières (fixes dans le monde : les ombres ne bougent pas)
    const B = R.bg;
    BG.top.value.set(B.top); BG.bottom.value.set(B.bottom); BG.glow.value.set(B.glowColor); BG.glowK.value = B.glow;
    const c0 = cam.at(0), c = cam.at(ph);
    _v.set(c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]).normalize();
    BG.glowDir.value.copy(_v);
    backdrop.position.set(...c.pos);
    backdrop.scale.setScalar(P.L * 60);
    const L = R.light, tgt = [0, lay.Rd * (Math.cos(lay.thH) - 1) + P.L * 0.25, lay.Rd * Math.sin(lay.thH)];
    const base = Math.atan2(c0.pos[0] - c0.target[0], c0.pos[2] - c0.target[2]);
    const place = (l, o, dist) => {
      const az = base + o.az;
      l.position.set(tgt[0] + Math.sin(az) * Math.cos(o.el) * dist, tgt[1] + Math.sin(o.el) * dist, tgt[2] + Math.cos(az) * Math.cos(o.el) * dist);
      l.target.position.set(...tgt);
      l.color.set(o.color);
      l.intensity = o.intensity;
    };
    const D = P.L * 7;
    place(key, L.key, D); place(rim, L.rim, D); place(fill, L.fill, D);
    if (lite) key.intensity += L.fill.intensity * 0.5;
    key.angle = Math.atan((P.L * 2.4) / D); key.penumbra = 0.5;
    rim.angle = Math.atan((P.L * 3) / D); fill.angle = Math.atan((P.L * 4) / D);
    key.shadow.camera.near = D * 0.5; key.shadow.camera.far = D * 1.6;
    key.shadow.bias = -0.0002; key.shadow.normalBias = 0.01 * P.L;
    key.shadow.radius = 2 + 6 * (L.key.soft ?? 0.5);
  }

  function setShadowQuality(qk) {
    const s = SHADOW[qk] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setRecipe, update, setShadowQuality, syncLook, group, key, rim, fill, body,
    syncFinishes: syncLook,
    refreshCamera: () => { if (R && lay) cam = cameraPath(R, lay); },
    cameraAt: (ph) => cam?.at(ph) ?? { pos: [0, 10, 30], target: [0, 0, 0], dist: 30 },
    // état des plumes visibles, la plume couchée d'abord : à u = 0 c'est
    // l'ancienne, à u → 1 la nouvelle (les deux instances échangent leur rôle
    // au raccord ; l'image, elle, est la même)
    state: () => {
      const vis = (i) => arr[i * 4 + 2].w > 0.5 && arr[i * 4 + 2].x > 1e-6 && (i > 1 || growth(arr[i * 4 + 2].x, R.shape.L) > 0);
      const heroes = [0, 1].filter(vis).sort((a, b) => arr[b * 4 + 2].x - arr[a * 4 + 2].x);
      const ids = [...heroes, ...Array.from({ length: nTiles }, (_, j) => j + 2)];
      return ids.flatMap((i) => [arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2]]);
    },
    layout: () => lay,
    ready: () => pending === 0,
    progress: () => (pending ? 0.3 : 1),
  };
}
