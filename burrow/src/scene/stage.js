// La scène : une longue table contre un mur, des fenêtres hors champ, et
// l'étagère des tranches de sable. Trois tranches différentes se répètent
// (pas SHELF.L) ; quatre emplacements suffisent à remplir le champ : chacun
// prend, à chaque image, la tranche et l'âge de la place qu'il occupe.
import * as THREE from 'three/webgpu';
import { uniform, vec3, vec4, mix, smoothstep, positionWorld, cameraPosition, normalize, dot, max, pow, float, Fn, normalWorld, texture, equirectUV, reflect } from 'three/tsl';
import { envPixels } from '../gen/envmap.js';
import { createSlab } from './slab.js';
import { createAnts, antPaths } from './ants.js';
import { roomMaterial } from './room.js';
import { createDust } from './dust.js';
import { SLAB } from '../gen/slab.js';
import { WINDOW, STAND, SLAB_H, SHELF, ageAt, sunDirAt } from '../layout.js';
import { buildPieceMaterial, finishUniforms } from '../../../shared/scene/materials.js';
import { FINISHES } from '../../../shared/finishes.js';
import { FRAMES } from '../recipe.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 4096, ultra: 4096 };
const SLOTS = 4;

function prep(g) {
  const n = g.attributes.position.count, surf = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { surf[i * 4] = 255; surf[i * 4 + 3] = 128; }
  g.setAttribute('surf', new THREE.BufferAttribute(surf, 4, true));
  g.computeTangents();
  return g;
}

export function createStage(scene, gen, { lite = false } = {}) {
  // ── lumières (ordre fixe) ──
  const sun = new THREE.DirectionalLight(0xffffff, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.004; sun.shadow.radius = 1.5;
  const SH = 3.4, sc = sun.shadow.camera;
  sc.left = -SH; sc.right = SH; sc.top = SH; sc.bottom = -SH; sc.near = 0.5; sc.far = 40; sc.updateProjectionMatrix();
  sc.layers.enable(2);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
  scene.add(sun, sun.target, hemi);

  // ── la table et le mur (invariants en x : ils suivent la caméra) ──
  const U = { table: uniform(new THREE.Color()), wall: uniform(new THREE.Color()), tableR: uniform(0.6), wallR: uniform(0.9) };
  const prof = [], zWall = -1.4, rc = 0.4;
  prof.push([9, 0], [zWall + rc, 0]);
  for (let i = 1; i < 12; i++) { const a = (i / 12) * Math.PI / 2; prof.push([zWall + rc - Math.sin(a) * rc, rc - Math.cos(a) * rc]); }
  prof.push([zWall, rc], [zWall, 9]);
  const W = 30, pos = [], idx = [];
  for (let i = 0; i < prof.length; i++) for (const x of [-W, W]) pos.push(x, prof[i][1], prof[i][0]);
  for (let i = 0; i + 1 < prof.length; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const roomGeo = new THREE.BufferGeometry();
  roomGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roomGeo.setIndex(idx); roomGeo.computeVertexNormals();
  const room = new THREE.Mesh(roomGeo);
  let roomKey = '';
  room.receiveShadow = true;
  scene.add(room);

  // ── les fenêtres (un mur percé devant l'étagère, vu seulement par l'ombre) ──
  // périodique de pas L : on le recale d'un pas entier quand la caméra avance
  const occ = new THREE.Group();
  const occMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const piece = (x0, x1, y0, y1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.1), occMat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, WINDOW.Z); m.castShadow = true; m.layers.set(2); occ.add(m); };
  for (let k = -4; k <= 4; k++) {
    const o = k * SHELF.L;
    piece(o + WINDOW.x1, o + SHELF.L + WINDOW.x0, WINDOW.y0, WINDOW.y1); // (trumeau entre deux fenêtres)
    piece(o + WINDOW.x0, o + WINDOW.x1, WINDOW.y1, WINDOW.y1 + 1);
    for (let i = 1; i < WINDOW.bars[0]; i++) { const x = o + WINDOW.x0 + (WINDOW.x1 - WINDOW.x0) * i / WINDOW.bars[0]; piece(x - WINDOW.barW / 2, x + WINDOW.barW / 2, WINDOW.y0, WINDOW.y1); }
    for (let i = 1; i < WINDOW.bars[1]; i++) { const y = WINDOW.y0 + (WINDOW.y1 - WINDOW.y0) * i / WINDOW.bars[1]; piece(o + WINDOW.x0, o + WINDOW.x1, y - WINDOW.barW / 2, y + WINDOW.barW / 2); }
  }
  piece(-40, 40, 40, 41);
  scene.add(occ);

  // ── les poussières dans les rayons ──
  const dust = createDust();
  scene.add(dust.mesh);

  // ── les emplacements ──
  // le verre : il reflète les portes-fenêtres derrière la caméra (une image qui
  // ne sert qu'à lui), selon la vraie direction de réflexion et le Fresnel ;
  // ailleurs la pièce est sombre et le verre ne rend rien. (Le reflet uniforme
  // de toute la pièce faisait un voile gris : noirs remontés de 27 à 89.)
  const GW = lite ? 256 : 1024;
  const winTex = new THREE.DataTexture(envPixels('glassWindows', 0, GW), GW, GW / 2, THREE.RGBAFormat, THREE.HalfFloatType);
  winTex.magFilter = winTex.minFilter = THREE.LinearFilter; winTex.needsUpdate = true;
  const glassU = { col: uniform(new THREE.Color(1, 1, 1)), k: uniform(0.06) };
  const glass = new THREE.MeshBasicNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  glass.colorNode = Fn(() => {
    const v = normalize(positionWorld.sub(cameraPosition)), n = normalize(normalWorld);
    const c = max(dot(v.negate(), n), 0);
    const F = float(0.04).add(float(0.96).mul(pow(float(1).sub(c), 5))).div(0.04).min(4);
    const e = max(texture(winTex, equirectUV(reflect(v, n))).rgb, vec3(0));
    return vec4(e.mul(vec3(glassU.col)).mul(F).mul(glassU.k), 1);
  })();
  glass.fog = false;
  const gW = SLAB.W + 0.02, gH = SLAB_H + 0.01;
  const frames = [];
  const slots = [];
  for (let i = 0; i < SLOTS; i++) {
    const g = new THREE.Group();
    scene.add(g);
    const slab = createSlab({ lite });
    g.add(slab.mesh);
    slab.mesh.position.y = STAND.baseH;
    const front = new THREE.Mesh(new THREE.BoxGeometry(gW, gH, STAND.glass), glass);
    front.position.set(0, STAND.baseH + gH / 2, STAND.glass / 2 + 0.0005);
    g.add(front);
    const fz = -SLAB.DEPTH / 2, fd = SLAB.DEPTH + 2 * STAND.glass + 0.03, fw = STAND.frameW;
    const own = [];
    const part = (geo, x, y, z) => { const m = new THREE.Mesh(prep(geo)); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); frames.push(m); own.push(m); };
    part(new THREE.BoxGeometry(fw, gH + 0.02, fd), -(gW / 2 + fw / 2 - 0.012), STAND.baseH + gH / 2, fz);
    part(new THREE.BoxGeometry(fw, gH + 0.02, fd), gW / 2 + fw / 2 - 0.012, STAND.baseH + gH / 2, fz);
    part(new THREE.BoxGeometry(gW + 2 * fw, 0.03, fd), 0, STAND.baseH + gH + 0.01, fz);
    part(new THREE.BoxGeometry(gW + 2 * fw + 0.16, STAND.baseH, fd + 0.4), 0, STAND.baseH / 2, fz);
    // l'ombre de la tranche : un bloc du corps de sable, vu seulement par le soleil
    // (en retrait derrière les galeries, pour ne pas ombrer la face de la tranche)
    const body = new THREE.Mesh(new THREE.BoxGeometry(SLAB.W, SLAB.HS, SLAB.DEPTH - 0.045), occMat);
    body.position.set(0, STAND.baseH + SLAB.HS / 2, -(SLAB.DEPTH + 0.045) / 2);
    body.castShadow = true; body.layers.set(2);
    g.add(body);
    const ants = createAnts();
    g.add(ants.mesh);
    slots.push({ g, slab, ants, frames: own });
  }

  let R = null, pending = 0, version = 0, tex = [], data = [], paths = [], frameMats = [];
  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    pending = SHELF.M;
    tex = []; data = []; paths = [];
    R.slabs.forEach((S, k) => {
      gen.request({ seed: S.seed, params: S.params }, 'slab').then((o) => {
        if (v !== version) return;
        data[k] = o;
        tex[k] = slots[0].slab.texturesOf(o);
        paths[k] = antPaths(o);
        if (k === 0 || !slots[0].slab.mesh.geometry.attributes.position.count || slots[0].slab.mesh.geometry.attributes.position.count < 10) for (const s of slots) s.slab.setSlab(o, tex[k]);
        pending--;
      }).catch((e) => { console.error(e); pending--; });
    });
    for (const s of slots) s.slab.setPalette(R.sands, R.mix, R.grain, R.mica, R.kind);
    const rk = JSON.stringify([R.floor, R.room.wall]);
    if (rk !== roomKey) {
      roomKey = rk;
      room.material?.dispose?.();
      room.material = roomMaterial(R.floor.type, { c1: R.floor.c1, c2: R.floor.c2, wall: R.room.wall[0], wallRough: R.room.wall[1] }).material;
    }
    // un cadre par tranche (les trois matériaux sont prêts : on les échange sans recompiler)
    for (const m of frameMats) m.dispose?.();
    frameMats = R.slabs.map((S, k) => {
      const [o, i, e] = FRAMES[S.frame].set;
      const F = { outer: { ...FINISHES[o], preset: o }, inner: { ...FINISHES[i], preset: i }, edge: { ...FINISHES[e], preset: e }, wear: 0 };
      const Ut = { outer: finishUniforms(F.outer), inner: finishUniforms(F.inner), edge: finishUniforms(F.edge), wear: uniform(0) };
      return buildPieceMaterial(F, Ut, { seedOff: uniform(new THREE.Vector3(1.3 + k, 2.1, 0.7)) });
    });
    for (const m of frames) m.material = frameMats[0];
  }
  function syncFinishes() {}

  // la caméra avance de M·L par boucle : xCam = ph·M·L
  const camX = (ph) => ph * SHELF.M * SHELF.L;
  const _d = new THREE.Vector3();
  function update(ph) {
    if (!R) return;
    const xc = camX(ph);
    room.position.x = xc;
    // (chaque fenêtre éclaire sa tranche : le mur est décalé de la projection du soleil)
    const ds = sunDirAt(R.sun.az, R.sun.el), shift = (WINDOW.Z * ds[0]) / ds[2]; // (un point de la tranche voit le soleil à travers x + Z·dx/dz)
    const off = ((shift % SHELF.L) + SHELF.L) % SHELF.L;
    occ.position.x = Math.floor(xc / SHELF.L) * SHELF.L + off;
    dust.U.u.value = ph; dust.U.xc.value = xc; dust.U.shift.value = off;
    // les emplacements : les places k autour de la caméra
    const k0 = Math.floor(xc / SHELF.L) - 1;
    slots.forEach((s, i) => {
      const k = k0 + i, j = ((k % SHELF.M) + SHELF.M) % SHELF.M;
      s.g.position.x = k * SHELF.L;
      if (tex[j]) s.slab.useTextures(tex[j]);
      s.slab.U.age.value = ageAt((k * SHELF.L - xc) / SHELF.L);
      s.ants.update(paths[j], s.slab.U.age.value, data[j]?.digger);
      if (frameMats[j]) for (const m of s.frames) m.material = frameMats[j];
    });
    // le soleil : direction fixe ; son ombre suit la caméra, recalée au texel
    const d = sunDirAt(R.sun.az, R.sun.el);
    _d.set(...d);
    // (texel choisi pour que la boucle, M·L, en compte un nombre entier : l'ombre
    //  recalée est la même à 0 et à 1)
    const period = SHELF.M * SHELF.L, nT = Math.round(period / ((2 * SH) / sun.shadow.mapSize.x)), texel = period / nT;
    const half = (texel * sun.shadow.mapSize.x) / 2;
    if (sc.right !== half) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.updateProjectionMatrix(); }
    const tx = Math.round(xc / texel) * texel;
    sun.target.position.set(tx, 1.4, 0);
    sun.position.copy(sun.target.position).addScaledVector(_d, 18);
    sun.color.set(R.sun.color); sun.intensity = R.sun.intensity;
    for (const sl of slots) sl.slab.U.sun.value.copy(_d);
    dust.U.sun.value.copy(_d); dust.U.sunCol.value.set(R.sun.color).multiplyScalar(R.sun.intensity * (R.dust ?? 0.35));
    hemi.color.set(R.room.sky[0]); hemi.groundColor.set(R.room.sky[1]); hemi.intensity = R.room.hemi;
    scene.environmentIntensity = R.env.intensity;
    glassU.col.value.set(R.sun.color);
  }
  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (sun.shadow.mapSize.x !== s) { sun.shadow.mapSize.set(s, s); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  }
  return {
    setRecipe, update, syncFinishes, setShadowQuality, group: slots[1].g, room, slots, sun, camX,
    get data() { return data; },
    ready: () => pending === 0,
    progress: () => 1 - pending / SHELF.M,
  };
}
