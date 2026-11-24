// La scène : la pièce (table, mur, fenêtre hors champ, soleil), le sablier et
// son bloc de gel. update(ph) pose tout à la phase ph, d'après story.js (une
// seule horloge) et layout.js (les cotes).
//
// Les lumières sont créées une fois, dans un ordre fixe, au premier niveau de
// la scène (changer leur ordre recompilerait tous les matériaux).
import * as THREE from 'three/webgpu';
import { uniform, vec3, mix, smoothstep, positionWorld, float, Fn } from 'three/tsl';
import { createGel } from './gel.js';
import { createHourglass } from './hourglass.js';
import { state } from '../story.js';
import { HG, WINDOW, sunDir } from '../layout.js';
import { BLOCK } from '../gen/burrows.js';
import { envPixels } from '../../../src/gen/envmap.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 4096, ultra: 4096 };

// volume d'une calotte sphérique de hauteur h dans une sphère de rayon r
const capVol = (r, h) => (Math.PI * h * h * (3 * r - h)) / 3;
function capHeight(r, V) { // inverse (dichotomie)
  let a = 0, b = 2 * r;
  for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (capVol(r, m) < V) a = m; else b = m; }
  return (a + b) / 2;
}

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 2;
  const sc = sun.shadow.camera;
  sc.left = -4.2; sc.right = 4.2; sc.top = 4.2; sc.bottom = -4.2; sc.near = 0.5; sc.far = 24;
  sc.layers.enable(2); // (la fenêtre et le double d'ombre du métal ne sont vus que par elle)
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
  scene.add(sun, sun.target, hemi);

  // ── La pièce : table et mur raccordés par une gorge (cyclorama) ──
  const U = {
    table: uniform(new THREE.Color()), wall: uniform(new THREE.Color()), tableR: uniform(0.6), wallR: uniform(0.9),
  };
  const prof = [];
  const zWall = -2.6, rc = 0.5;
  prof.push([9, 0], [zWall + rc, 0]);
  for (let i = 1; i < 12; i++) { const a = (i / 12) * Math.PI / 2; prof.push([zWall + rc - Math.sin(a) * rc, rc - Math.cos(a) * rc]); }
  prof.push([zWall, rc], [zWall, 9]);
  const W = 14, pos = [], idx = [];
  for (let i = 0; i < prof.length; i++) for (const x of [-W, W]) pos.push(x, prof[i][1], prof[i][0]);
  for (let i = 0; i + 1 < prof.length; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const roomGeo = new THREE.BufferGeometry();
  roomGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roomGeo.setIndex(idx);
  roomGeo.computeVertexNormals();
  const roomMat = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  const wallness = smoothstep(0.05, 0.6, positionWorld.y);
  roomMat.colorNode = mix(vec3(U.table), vec3(U.wall), wallness);
  roomMat.roughnessNode = mix(U.tableR, U.wallR, wallness);
  const room = new THREE.Mesh(roomGeo, roomMat);
  room.receiveShadow = true;
  scene.add(room);

  // ── La fenêtre (hors champ) : un mur percé, vu seulement par l'ombre ──
  const occ = new THREE.Group();
  const occMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const wallPiece = (y0, y1, z0, z1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, y1 - y0, z1 - z0), occMat); m.position.set(WINDOW.X, (y0 + y1) / 2, (z0 + z1) / 2); m.castShadow = true; m.layers.set(2); occ.add(m); };
  wallPiece(-2, WINDOW.y0, -14, 14); wallPiece(WINDOW.y1, 14, -14, 14);
  wallPiece(WINDOW.y0, WINDOW.y1, -14, WINDOW.z0); wallPiece(WINDOW.y0, WINDOW.y1, WINDOW.z1, 14);
  // croisillons
  for (let i = 1; i < WINDOW.bars[0]; i++) { const z = WINDOW.z0 + (WINDOW.z1 - WINDOW.z0) * i / WINDOW.bars[0]; wallPiece(WINDOW.y0, WINDOW.y1, z - WINDOW.barW / 2, z + WINDOW.barW / 2); }
  for (let i = 1; i < WINDOW.bars[1]; i++) { const y = WINDOW.y0 + (WINDOW.y1 - WINDOW.y0) * i / WINDOW.bars[1]; wallPiece(y - WINDOW.barW / 2, y + WINDOW.barW / 2, WINDOW.z0, WINDOW.z1); }
  scene.add(occ);

  // ── Le sablier ──
  const pivot = new THREE.Group();
  pivot.position.set(0, HG.pivotY, 0);
  scene.add(pivot);
  const hg = createHourglass({ lite });
  pivot.add(hg.frame);
  scene.add(hg.stand);
  const gel = createGel({ lite });
  gel.mesh.position.set(0, HG.blockY, 0);
  hg.frame.add(gel.mesh);

  let R = null, nest = null, pending = 0, version = 0, envKey = '';
  const envTex = { t: null };
  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    pending = 1;
    gen.request({ family: R.family, params: R.params, seed: R.seed, voxel: lite ? 0.016 : 0.012 }, 'nest').then((o) => {
      if (v !== version) return;
      nest = o;
      gel.setNest(o);
      pending = 0;
    }).catch((e) => { console.error(e); pending = 0; });
    hg.setFinishes(R.finishes);
    U.table.value.set(R.room.table[0]); U.tableR.value = R.room.table[1];
    U.wall.value.set(R.room.wall[0]); U.wallR.value = R.room.wall[1];
    gel.U.sigma.value.set(...R.gelSigma);
    if (envKey !== R.env.preset) {
      envKey = R.env.preset;
      const W = lite ? 256 : 512;
      const t = new THREE.DataTexture(envPixels(R.env.preset, 0, W), W, W / 2, THREE.RGBAFormat, THREE.HalfFloatType);
      t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.LinearSRGBColorSpace;
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
      envTex.t?.dispose(); envTex.t = t;
      gel.setEnv(t);
    }
  }
  function syncFinishes() { if (R) hg.setFinishes(R.finishes); }

  const _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _n = new THREE.Vector3();
  function update(ph) {
    if (!R) return;
    const S = state(ph);
    // le soleil : direction, couleur, intensité (nul la nuit)
    const d = sunDir(ph, R.sun);
    _d.set(d[0], d[1], d[2]);
    sun.position.set(0, 1.6, 0).addScaledVector(_d, 12);
    sun.target.position.set(0, 1.6, 0);
    sun.color.set(R.sun.color);
    sun.intensity = R.sun.intensity * S.sunUp;
    // le ciel : le jour, la pièce ; la nuit, une heure bleue
    const day = 0.12 + 0.88 * S.sunUp;
    hemi.color.set(R.room.sky[0]).lerp(new THREE.Color(R.room.night[0]), 1 - S.sunUp);
    hemi.groundColor.set(R.room.sky[1]).multiplyScalar(day);
    hemi.intensity = R.room.hemi * (S.sunUp + (1 - S.sunUp) * R.room.night[1] * 4);
    scene.environmentIntensity = day;
    // le cadre
    pivot.rotation.set(S.theta, 0, 0);
    pivot.updateMatrixWorld(true);
    // le gel
    const G = gel.U;
    G.F.value = S.F; G.D.value = S.D; G.G.value = S.G; G.M.value = S.M;
    G.mode.value = S.filling ? 0 : 1;
    G.stream.value = S.filling && S.F > 0 && S.F < 1 ? 1 : 0;
    G.envI.value = day;
    G.sunDir.value.copy(_d);
    { const sc = new THREE.Color(R.sun.color); G.sunCol.value.set(sc.r, sc.g, sc.b).multiplyScalar(R.sun.intensity * S.sunUp); }
    G.winX.value = WINDOW.X; G.win.value.set(WINDOW.y0, WINDOW.y1, WINDOW.z0, WINDOW.z1); G.winBars.value.set(WINDOW.bars[0], WINDOW.bars[1]); G.barW.value = WINDOW.barW;
    // la fonte du moulage part du côté du soleil (repère du bloc)
    _m.copy(gel.mesh.matrixWorld).invert();
    _n.copy(_d).transformDirection(_m).negate();
    G.meltDir.value.copy(_n);
    const ext = Math.abs(_n.x) * BLOCK.hx + Math.abs(_n.y) * BLOCK.hy + Math.abs(_n.z) * BLOCK.hz;
    G.meltLo.value = -ext; G.meltHi.value = ext;
    // le métal du bulbe
    const V = nest ? nest.volume : 0.05, rIn = HG.bulbR - HG.bulbT;
    const c = new THREE.Vector3(0, HG.bulbC, 0).applyMatrix4(hg.frame.matrixWorld);
    // flaque liquide : au fond (monde). Jour 1 : le liquide fondu en transit ;
    // jour 2 : tout le métal vidé, tant que la flaque n'a pas fini de prendre
    // (la partie prise est une calotte de la même hauteur ou moindre, dedans)
    const liqV = ph < 0.5 ? Math.max(0, S.bulbLiquid) : (S.bulbFrozen < 1 ? S.bulb : 0);
    const hp = capHeight(rIn, liqV * V);
    hg.U.poolN.value.set(0, 1, 0); hg.U.poolK.value = liqV > 1e-4 ? c.y - rIn + hp : -1e3;
    // le solide : une calotte du côté du plafond du bulbe (repère du sablier : +y),
    // là où la flaque a pris le jour 2, sablier retourné
    const solidV = (ph < 0.5 ? S.ingot : S.bulb * S.bulbFrozen) * V;
    const hs = capHeight(rIn, solidV);
    const e = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), S.theta);
    // métal où n·x < k ⇔ e·x > e·c + rIn − hs
    hg.U.ingotN.value.copy(e).negate(); hg.U.ingotK.value = solidV > 1e-5 ? -(e.dot(c) + rIn - hs) : -1e3;
    // filet du col (repère du sablier) : du bas du bulbe à l'entrée du terrier
    const flowing = S.neck > 0;
    hg.thread.visible = flowing;
    hg.thread.position.set(0, HG.neckY0 + HG.neckL / 2 + 0.01, 0);
    hg.thread.scale.set(1, HG.neckL + 0.04, 1);
    // goutte du lingot vers le col (jour 1, pendant la fonte)
    hg.drip.visible = ph < 0.5 && S.ingot > 0.01 && S.ingot < 0.99;
    hg.drip.scale.set(1, Math.max(0.01, 2 * rIn - hs - hp), 1);
    hg.drip.position.set(0, HG.bulbC + (-rIn + hp + (rIn - hs)) / 2, 0);
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (sun.shadow.mapSize.x !== s) { sun.shadow.mapSize.set(s, s); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  }

  return {
    setRecipe, update, syncFinishes, setShadowQuality, group: pivot, room, gel, hg, sun,
    get nest() { return nest; },
    ready: () => pending === 0,
    progress: () => (pending ? 0.3 : 1),
  };
}
