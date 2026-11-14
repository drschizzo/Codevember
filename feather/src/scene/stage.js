// La scène : le fond neutre, la pelote de duvet, la gerbe de plumes (chaque
// follicule : la plume courante et l'ancienne qu'elle chasse), leurs gaines,
// les lumières de l'humeur.
//
// update(ph) ne dépend que de la recette et de la phase. Toutes les lumières
// sont créées une fois, dans un ordre fixe, au premier niveau de la scène.
import * as THREE from 'three/webgpu';
import {
  uniform, uniformArray, vec3, vec4, float, mix, normalize, positionWorld, cameraPosition, dot, pow, max as tmax, smoothstep, normalWorld,
  attribute, sin, hash, positionGeometry,
} from 'three/tsl';
import { barbGeometry, barbMaterial, rachisGeometry, rachisMaterial, sheathGeometry, sheathMaterial, createLook, FSTRIDE } from './feather.js';
import { isLite, stableVelocity, noise } from '../../../shared/scene/materials.js';
import { growth } from '../gen/feather.js';
import { layoutBouquet, bouquetState } from '../gen/bouquet.js';
import { cameraPath } from '../camera.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
const MAXF = 32; // (3 vec4 par plume ; deux instances par follicule)

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

  // ── Le sous-duvet : des houppes frisées entre les plumes (gen/down.js) ──
  const downU = { color: uniform(new THREE.Color()), tip: uniform(new THREE.Color()) };
  function downMaterial() {
    const m = new THREE.MeshSSSNodeMaterial({ side: THREE.DoubleSide });
    const tv = attribute('tv', 'vec2');
    const t = tv.x, edge = tv.y.abs();
    // plus sombre au pied (l'ombre de la houppe), plus clair aux pointes
    m.colorNode = mix(downU.color, downU.tip, smoothstep(0.1, 1.0, t));
    m.roughnessNode = float(0.75);
    m.metalnessNode = float(0);
    m.sheenNode = downU.tip.mul(0.6);
    m.sheenRoughnessNode = float(0.5);
    // frange des barbules : tramée (lissée par le TRAA)
    const comb = sin(t.mul(90).add(edge.mul(9))).mul(0.5).add(0.5);
    m.maskNode = smoothstep(1.0, 0.3, edge).add(comb.mul(0.3)).greaterThan(hash(positionGeometry.xy.mul(311.7)).mul(0.8).add(0.1));
    m.thicknessColorNode = downU.tip.mul(0.5);
    m.thicknessPowerNode = float(3);
    m.thicknessScaleNode = float(3);
    m.mrtNode = stableVelocity();
    return m;
  }
  const downMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicNodeMaterial());
  downMesh.receiveShadow = true; downMesh.castShadow = false; downMesh.visible = false; downMesh.frustumCulled = false;
  scene.add(downMesh);

  // ── Les plumes : la gerbe (gen/bouquet.js), deux instances par follicule ──
  const group = new THREE.Group();
  scene.add(group);
  const arr = Array.from({ length: MAXF * FSTRIDE }, () => new THREE.Vector4());
  const arrP = Array.from({ length: MAXF * FSTRIDE }, () => new THREE.Vector4());
  const FS = uniformArray(arr, 'vec4'), FSP = uniformArray(arrP, 'vec4');
  const LK = createLook();
  const FU = { L: uniform(6), radial: uniform(0), calamus: uniform(0.1), over: uniform(1.08), r0: uniform(0.05), kb: uniform(0.05), rhoTex: null };
  let meshes = [], R = null, lay = null, cam = null, pending = 0, version = 0, nF = 0;
  let texs = [], lastPh = 0;

  function clear() {
    for (const m of meshes) { group.remove(m); m.geometry.dispose(); m.material.dispose(); }
    meshes = [];
  }
  const add = (mesh, cast = true) => { mesh.castShadow = cast; mesh.receiveShadow = true; mesh.frustumCulled = false; group.add(mesh); meshes.push(mesh); };

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    pending = 1;
    downMesh.visible = false;
    const P = R.shape;
    lay = layoutBouquet(P, R.seed, { lite });
    nF = Math.min(lay.N * 2, MAXF);
    cam = cameraPath(R, lay);
    // le socle : une calotte et son cylindre, sous le duvet (le sommet à l'origine)
    body.geometry.dispose();
    const H = P.L * 6;
    body.geometry = new THREE.CapsuleGeometry(lay.Rd * 0.97, H, 48, 96);
    body.position.set(0, -lay.Rd * 0.97 - H / 2 + (lay.Rd * 0.03), 0);
    gen.request({ shape: P, pattern: R.pattern, seed: R.seed, lite }, 'feather').then((o) => {
      if (v !== version) return;
      clear();
      for (const t of texs) t.dispose();
      const t = new THREE.DataTexture(o.tex, o.nx, o.nz, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.magFilter = t.minFilter = THREE.LinearFilter;
      t.colorSpace = THREE.NoColorSpace;
      t.needsUpdate = true;
      const rh = new Uint16Array(65 * 4);
      for (let i = 0; i < 65; i++) rh[i * 4] = THREE.DataUtils.toHalfFloat(o.rho[i]);
      const rt = new THREE.DataTexture(rh, 65, 1, THREE.RGBAFormat, THREE.HalfFloatType);
      rt.magFilter = rt.minFilter = THREE.LinearFilter;
      rt.needsUpdate = true;
      FU.rhoTex = rt;
      FU.L.value = P.L; FU.radial.value = P.radial ? 1 : 0; FU.calamus.value = P.calamus; FU.over.value = P.over;
      FU.r0.value = P.radial ? 0.035 : Math.max(0.03, P.L * 0.0085);
      FU.kb.value = lay.kb; // (courbure du rachis ; × l'échelle de chaque plume)
      texs = [t, rt];
      // toutes les plumes partagent la table fine : une copie par instance
      const nb = o.hero.length / 16;
      const T = new Float32Array(o.hero.length * nF);
      for (let j = 0; j < nF; j++) {
        T.set(o.hero, j * o.hero.length);
        for (let i = 0; i < nb; i++) T[(j * nb + i) * 16 + 8] = j;
      }
      add(new THREE.Mesh(barbGeometry(T, lite ? 12 : 22), barbMaterial({ FS, FSP, FU, LK, PAT: t, moving: true })));
      add(new THREE.Mesh(P.radial ? rachisGeometry(nF, 8, 8) : rachisGeometry(nF), rachisMaterial({ FS, FSP, FU, LK, moving: true, offset: 0 })));
      // les gaines : une par follicule (la plume courante, id pair)
      add(new THREE.Mesh(sheathGeometry(Array.from({ length: lay.N }, (_, i) => 2 * i), lite ? 40 : 64, lite ? 12 : 20), sheathMaterial({ FS, FSP, FU, LK })));
      pending--;
      lastPh = -1;
    }).catch((e) => { console.error(e); pending = Math.max(0, pending - 1); });
    // le duvet de la pelote (statique, cuit dans le monde) : il arrive avec la plume
    pending++;
    gen.request({ shape: P, seed: R.seed, lite }, 'down').then((o) => {
      if (v !== version) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
      g.setAttribute('tv', new THREE.BufferAttribute(o.tv, 2));
      g.setIndex(new THREE.BufferAttribute(o.index, 1));
      g.computeBoundingSphere();
      downMesh.geometry.dispose();
      downMesh.geometry = g;
      downMesh.material.dispose();
      downMesh.material = downMaterial();
      downMesh.visible = true;
      pending--;
    }).catch((e) => { console.error(e); pending = Math.max(0, pending - 1); });
    syncLook();
  }

  function syncLook() {
    const K = R.look;
    LK.base.value.set(K.base); LK.mark.value.set(K.mark); LK.down.value.set(K.down); LK.rachis.value.set(K.rachis); LK.sheath.value.set(K.sheath);
    const eye = K.eye ?? ['#000000', '#000000', '#000000', '#000000', '#000000'];
    [LK.eye0, LK.eye1, LK.eye2, LK.eye3, LK.eye4].forEach((u, i) => u.value.set(eye[i]));
    LK.irid.value = K.irid; LK.iridLo.value = K.iridLo; LK.iridHi.value = K.iridHi; LK.bragg.value = K.bragg ?? 0; LK.iridMark.value = K.iridMark ?? 0; LK.blue.value = K.blue;
    LK.sheen.value = K.sheen; LK.translucency.value = K.translucency;
    bodyU.color.value.set(K.down).lerp(new THREE.Color(K.base), 0.3).multiplyScalar(0.28); // (la peau sous le duvet : sombre)
    downU.color.value.set(K.down).lerp(new THREE.Color(K.base), 0.3).multiplyScalar(0.32);
    downU.tip.value.set(K.down).lerp(new THREE.Color(K.base), 0.2).multiplyScalar(0.62);
  }

  // écrit l'état d'une plume i : position et échelle, quaternion, (temps, usure, tirage, visible)
  const F = FSTRIDE;
  function put(i, p, q, scale, t, wear, rnd, vis) {
    arr[i * F].set(p[0], p[1], p[2], scale);
    arr[i * F + 1].set(q[0], q[1], q[2], q[3]);
    arr[i * F + 2].set(t, wear, rnd, vis);
  }

  const _v = new THREE.Vector3();
  function update(ph) {
    if (!R || !lay || pending) return;
    const P = R.shape;
    const jump = lastPh < 0 || Math.abs(ph - lastPh) > 0.02;
    for (let i = 0; i < nF * FSTRIDE; i++) arrP[i].copy(arr[i]);
    // toutes les plumes, exactement comme le banc des traversées les voit
    for (const o of bouquetState(R, lay, ph)) if (o.id < nF) put(o.id, o.p, o.q, o.scale, o.u, o.wear, o.rnd, o.vis);
    if (jump) for (let i = 0; i < nF * FSTRIDE; i++) arrP[i].copy(arr[i]);
    lastPh = ph;

    // fond, brume, lumières (fixes dans le monde : les ombres ne bougent pas)
    const B = R.bg;
    BG.top.value.set(B.top); BG.bottom.value.set(B.bottom); BG.glow.value.set(B.glowColor); BG.glowK.value = B.glow;
    const c0 = cam.at(0), c = cam.at(ph);
    _v.set(c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]).normalize();
    BG.glowDir.value.copy(_v);
    backdrop.position.set(...c.pos);
    backdrop.scale.setScalar(P.L * 60);
    const L = R.light, tgt = lay.center;
    const base = Math.atan2(c0.pos[0] - c0.target[0], c0.pos[2] - c0.target[2]);
    const place = (l, o, dist) => {
      const az = base + o.az;
      l.position.set(tgt[0] + Math.sin(az) * Math.cos(o.el) * dist, tgt[1] + Math.sin(o.el) * dist, tgt[2] + Math.cos(az) * Math.cos(o.el) * dist);
      l.target.position.set(...tgt);
      l.color.set(o.color);
      l.intensity = o.intensity;
    };
    const D = P.L * 8;
    place(key, L.key, D); place(rim, L.rim, D); place(fill, L.fill, D);
    if (lite) key.intensity += L.fill.intensity * 0.5;
    key.angle = Math.atan((P.L * 1.9) / D); key.penumbra = 0.5;
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
    // état des plumes, follicule par follicule (la courante, puis l'ancienne) ;
    // au raccord, l'ancienne prend la pose de la courante : on les range par
    // âge décroissant pour que la signature soit la même des deux côtés
    state: () => {
      const out = [];
      for (let f = 0; f < nF / 2; f++) {
        const ids = [2 * f, 2 * f + 1].filter((i) => arr[i * F + 2].w > 0.5 && (i % 2 || growth(arr[i * F + 2].x, R.shape.L) > 0)).sort((a, b) => arr[b * F + 2].x - arr[a * F + 2].x);
        for (const i of ids) out.push(arr[i * F], arr[i * F + 1], arr[i * F + 2]);
      }
      return out;
    },
    layout: () => lay,
    ready: () => pending === 0,
    progress: () => (pending ? 0.5 : 1),
  };
}
