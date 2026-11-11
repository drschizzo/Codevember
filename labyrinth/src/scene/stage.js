// La scène : lumières, fond, support, et l'appareil — plateau, parois, bille,
// mécanisme — posé à chaque image par la cinématique de kin.js à partir du
// film simulé (gen/plan.js), relu au temps t = phase × durée.
//
// Principes (skill codevember-scene) :
//  - update(ph) ne dépend que de la recette, du film et de la phase ;
//  - un maillage reçoit un matériau neuf à chaque nouvelle géométrie (three.js
//    ne recompile pas un objet dont on change seulement la géométrie) ;
//  - les lumières sont créées une fois, dans un ordre fixe, au premier niveau.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { buildPieceMaterial, finishUniforms, applyFinish, signature } from './materials.js';
import { sceneSpec } from '../recipe.js';
import { S, mat, plateauPose, discMatrix, pulleyCenter, discFrame, toWorld, sampleFilm, vec, cameraPath } from '../kin.js';
import { DIM } from '../gen/maze.js';

const TAU = Math.PI * 2;
const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };

function toGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}
const finishU = (f) => ({ outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(f.wear ?? 0) });

// pièces : [clé du maillage, jeu de finitions, mobile]
const PLATEAU_PARTS = [['body', 'board'], ['walls', 'walls'], ['ball', 'ball'], ['base', 'base'], ['frame', 'metal'], ['cross', 'metal'], ['fork', 'metal'], ['crankA', 'metal', 'crank'], ['crankB', 'metal', 'crank'], ['rodA', 'metal', 'rod'], ['rodB', 'metal', 'rod']];
const DISC_PARTS = [['body', 'board'], ['walls', 'walls'], ['ball', 'ball'], ['hub', 'metal'], ['base', 'base'], ['frame', 'metal'], ['pulley', 'metal'], ['belt', 'support']];

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const key = new THREE.SpotLight(0xffffff, 600, 0, 0.5, 0.7, 2);
  key.castShadow = true;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 4;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 3; key.shadow.camera.far = 20;
  const rims = [new THREE.SpotLight(0xffffff, 200, 0, 0.6, 0.9, 2), new THREE.SpotLight(0xffffff, 80, 0, 0.6, 0.9, 2)];
  if (lite) rims[1].visible = false;
  for (const l of [key, ...rims]) { scene.add(l); scene.add(l.target); }

  // ── Fond : une nappe mate qui se fond dans la brume ──
  const floorGeo = new THREE.CircleGeometry(40, 96).rotateX(-Math.PI / 2);
  {
    const n = floorGeo.attributes.position.count, surf = new Uint8Array(n * 4), tan = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { surf[i * 4] = 255; surf[i * 4 + 3] = 128; tan[i * 4] = 1; tan[i * 4 + 3] = 1; }
    floorGeo.setAttribute('surf', new THREE.BufferAttribute(surf, 4, true));
    floorGeo.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
  }
  const floor = new THREE.Mesh(floorGeo);
  floor.receiveShadow = true;
  scene.add(floor);
  // support (table, bloc, socle de pierre)
  const support = new THREE.Mesh(new THREE.BufferGeometry());
  support.receiveShadow = true; support.castShadow = true;
  scene.add(support);

  const group = new THREE.Group();
  scene.add(group);
  let R = null, D = null, version = 0, pending = 0, prog = 0;
  const parts = new Map(); // nom → { mesh, set, U }
  let floorMat = null, supportFin = null;
  const camPath = { pts: null };
  let failed = null;

  function material(fin, seed) {
    const U = finishU(fin);
    return { U, m: buildPieceMaterial(fin, U, { seedOff: uniform(new THREE.Vector3(seed * 1.37, 2.11, 0.5)) }) };
  }
  function clear() {
    for (const p of parts.values()) { group.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material?.dispose?.(); }
    parts.clear();
  }

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    pending = 1; prog = 0; failed = null;
    const spec = { ...sceneSpec(R), lite };
    gen.request(spec, 'scene', (f) => { if (v === version) prog = f; }).then((out) => {
      if (v !== version) return;
      clear();
      D = out;
      const list = R.family === 'plateau' ? PLATEAU_PARTS : DISC_PARTS;
      list.forEach(([name, set, geo], i) => {
        const o = out.meshes[geo ?? name];
        if (!o) return;
        const mesh = new THREE.Mesh(toGeometry(o));
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = true; mesh.receiveShadow = name !== 'ball';
        const { U, m } = material(R.finishes[set], i);
        mesh.material = m;
        group.add(mesh);
        parts.set(name, { mesh, set, U, key: signature(R.finishes[set]) });
      });
      // support : un bloc sous l'appareil (dessus à Y = 0)
      buildSupport();
      buildCamera();
      pending = 0;
    }).catch((e) => { console.error(e); if (v === version) { pending = 0; D = null; failed = e; } });
    // fond : matériau mat, teinte de l'humeur
    floorMat?.dispose();
    const fb = { ...R.finishes.support.outer, pattern: 'plain', color: R.fog.color, rough: 0.97, clearcoat: 0, sheen: 0, bump: 0, smudge: 0 };
    const fm = material({ outer: fb, inner: fb, edge: fb, wear: 0 }, 99);
    floorMat = fm.m; floor.material = floorMat;
  }

  function buildSupport() {
    const L = D.layout;
    const w = (L.family === 'plateau' ? L.Rout * 1.9 : L.Rout * 1.7) * S, d = (L.family === 'plateau' ? L.Rout * 1.6 : L.Rout * 1.3) * S, h = 0.32;
    const g = new THREE.BoxGeometry(2 * w, h, 2 * d, 1, 1, 1);
    // (bords adoucis : biseau par mise à l'échelle des normales — un bloc de table)
    g.translate(0, -h / 2, 0);
    const n = g.attributes.position.count, surf = new Uint8Array(n * 4), tan = new Float32Array(n * 4);
    const nor = g.attributes.normal.array;
    for (let i = 0; i < n; i++) { const top = nor[i * 3 + 1] > 0.5; surf[i * 4] = top ? 255 : 0; surf[i * 4 + 2] = top ? 0 : 255; surf[i * 4 + 3] = 128; tan[i * 4] = 1; tan[i * 4 + 3] = 1; }
    g.setAttribute('surf', new THREE.BufferAttribute(surf, 4, true));
    g.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
    support.geometry.dispose();
    support.geometry = g;
    const k = signature(R.finishes.support);
    if (!supportFin || supportFin.key !== k) {
      support.material?.dispose?.();
      const { U, m } = material(R.finishes.support, 77);
      support.material = m; supportFin = { key: k, U };
    } else applyFinish(supportFin.U.outer, R.finishes.support.outer);
    floor.position.y = -h;
  }

  // ── Caméra : kin.js (module pur, testé) ──
  function center() {
    const L = D.layout;
    return L.family === 'plateau' ? [0, L.floorY, 0] : [0, L.Yc - 25, 0];
  }
  function buildCamera() { camPath.path = cameraPath(D, R); }
  function cameraPose(ph, aspect) { return D && camPath.path ? camPath.path.pose(ph, aspect) : null; }

  // retouche d'une matière depuis le panneau
  function syncFinishes() {
    for (const p of parts.values()) {
      const f = R.finishes[p.set];
      if (signature(f) !== p.key) {
        p.mesh.material.dispose();
        const { U, m } = material(f, 3);
        p.mesh.material = m; p.U = U; p.key = signature(f);
      } else { applyFinish(p.U.outer, f.outer); applyFinish(p.U.inner, f.inner); applyFinish(p.U.edge, f.edge); }
    }
    if (supportFin) applyFinish(supportFin.U.outer, R.finishes.support.outer);
  }

  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Qb = new THREE.Quaternion(), V3 = new THREE.Vector3(), SC = new THREE.Vector3(1, 1, 1);
  const setM = (name, m) => { const p = parts.get(name); if (!p) return; p.mesh.matrix.fromArray(m); p.mesh.matrixWorldNeedsUpdate = true; };
  const place = (l, az, el, r, c) => { l.position.set(c[0] + Math.cos(el) * Math.sin(az) * r, c[1] + Math.sin(el) * r, c[2] + Math.cos(el) * Math.cos(az) * r); l.target.position.set(...c); };

  function update(ph) {
    if (!R || !D) return;
    const L = D.layout, F = D.film;
    const s = sampleFilm(F, ph * F.duration);
    // lumières (autour du centre de l'appareil)
    const c = center().map((x) => x * S);
    const Lt = R.light;
    place(key, Lt.key.az, Lt.key.el, 9, c);
    key.color.set(Lt.key.color); key.intensity = 620 * Lt.key.intensity; key.angle = Lt.key.angle; key.penumbra = Lt.key.penumbra;
    key.shadow.focus = 0.9;
    rims.forEach((l, i) => { const r = Lt.rim[i]; place(l, r.az, r.el, 8, c); l.color.set(r.color); l.intensity = 520 * r.intensity * (lite && i === 0 ? 1.4 : 1); });

    let Bm;
    if (L.family === 'plateau') {
      const P = plateauPose(L, s.a, s.b);
      Bm = P.B;
      setM('cross', toWorld(P.cross));
      L.motors.forEach((m, k) => {
        const { g, C, P: Pt } = P.motors[k];
        const nm = k ? 'B' : 'A';
        // manivelle : x = direction du maneton, z = arbre
        const X = vec.add(vec.mul(m.inward, Math.cos(g)), vec.mul([0, 1, 0], Math.sin(g))), Z = m.axis, Y = vec.cross(Z, X);
        setM(`crank${nm}`, toWorld(mat.basis(X, Y, Z, m.M)));
        // bielle : y du maneton vers l'attache
        const Yr = vec.norm(vec.sub(Pt, C));
        let Xr = vec.norm(vec.cross(Yr, m.axis));
        const Zr = vec.cross(Xr, Yr);
        setM(`rod${nm}`, toWorld(mat.basis(Xr, Yr, Zr, C)));
      });
      setM('fork', toWorld(Bm));
    } else {
      Bm = discMatrix(L, s.a);
      setM('hub', toWorld(Bm));
      // poulie : tourne N fois plus vite que le disque, même sens (courroie ouverte)
      const Fr = discFrame(L), pc = pulleyCenter(L);
      const pr = mat.mul(mat.basis(Fr.X, vec.cross(Fr.n, Fr.X), Fr.n, pc), mat.rz(s.a * L.N));
      setM('pulley', toWorld(pr));
    }
    setM('body', toWorld(Bm)); setM('walls', toWorld(Bm));
    // la bille : centre à DIM.ball au-dessus du fond, orientation du plateau ∘ roulement
    const bp = mat.apply(Bm, [s.x, DIM.ball, -s.y]).map((x) => x * S);
    M4.fromArray(toWorld(Bm));
    Q.setFromRotationMatrix(M4);
    Qb.set(s.q[0], s.q[2], -s.q[1], s.q[3]); // (axe de la physique → repère local three)
    Q.multiply(Qb);
    const bm = new THREE.Matrix4().compose(V3.set(...bp), Q, SC);
    setM('ball', bm.toArray());
    for (const name of ['base', 'frame', 'belt']) setM(name, toWorld(mat.id()));
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setRecipe, update, syncFinishes, setShadowQuality, cameraPose, group, floor, key, rims,
    get data() { return D; }, get failed() { return failed; },
    ready: () => pending === 0 && !!D,
    progress: () => (pending ? prog * 0.95 : 1),
    duration: () => (D ? D.film.duration / (R.loop.speed || 1) : 20),
  };
}
