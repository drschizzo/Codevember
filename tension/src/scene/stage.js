// La scène : lumières (ordre fixe, au premier niveau), sol, et la structure —
// barres tournées, rotules, treuils, moyeu, câbles — posée à chaque image
// d'après le film (gen/film.js) : rien n'est intégré d'une image à l'autre,
// update(u) ne dépend que de la recette, du film et de la phase.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { buildPieceMaterial, finishUniforms, applyFinish, signature } from './materials.js';
import { createCableUniforms, buildCableMaterial, cableGeometry, MAX_CABLES } from './cables.js';
import { createFloorUniforms, buildFloorMaterial, floorGeometry, FLOORS, floorFreqs, jointSpacing } from './floor.js';
import { sagOf } from '../gen/cable.js';
import { CABLES } from '../recipe.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
const DRUM_R = 0.018; // rayon des tambours des treuils (u) : l'angle de rotation = longueur enroulée / rayon

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
const finishU = (f) => ({ outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(f.wear) });

// les pièces à construire pour une topologie (requêtes au worker)
export function partSpecs(T) {
  const fam = T.family, out = { struts: {}, ball: null, winch: null, hub: null, cable: { S: 40, R: 6 } };
  const key = (L) => (Math.round(L * 1000) / 1000).toFixed(3);
  for (const b of T.bars) {
    if (b.hub) continue;
    const style = fam === 'culbute' ? 'cap' : 'fork';
    const capR = fam === 'culbute' ? T.nodes[b.i].r : T.nodes[b.i].r * 0.62;
    const k = `${key(b.L)}|${b.r}|${style}`;
    out.struts[k] ??= { L: +key(b.L), r: b.r, capR, style };
  }
  if (fam !== 'culbute') out.ball = { R: T.nodes.find((n) => !n.hub).r };
  if (fam !== 'cerceau') out.winch = { len: 0.24, R: 0.036 };
  if (fam === 'cerceau') out.hub = { W: Math.hypot(...[0, 1, 2].map((a) => T.nodes[T.hub[1]].p[a] - T.nodes[T.hub[0]].p[a])), flR: 0.34 };
  out.strutKey = (b) => `${key(b.L)}|${b.r}|${fam === 'culbute' ? 'cap' : 'fork'}`;
  return out;
}

export function createStage(scene, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const key = new THREE.SpotLight(0xffffff, 600, 0, 0.5, 0.7, 2);
  key.castShadow = true;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 4;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 80;
  const rims = [new THREE.SpotLight(0xffffff, 100, 0, 0.7, 0.9, 2), new THREE.SpotLight(0xffffff, 50, 0, 0.7, 0.9, 2)];
  if (lite) rims[1].visible = false;
  for (const l of [key, ...rims]) { scene.add(l); scene.add(l.target); }

  // ── Sol ──
  const FU = createFloorUniforms();
  const floor = new THREE.Mesh(floorGeometry());
  floor.receiveShadow = true;
  scene.add(floor);
  let floorType = null;

  // ── Structure ──
  const group = new THREE.Group();
  scene.add(group);
  const CU = createCableUniforms();
  let cableMesh = null;
  let R = null, film = null, T = null, mats = null;
  let struts = [], balls = [], winches = [], hubMesh = null;
  let ready = false;

  function clear() {
    for (const o of [...struts, ...balls, ...winches, hubMesh, cableMesh]) if (o) group.remove(o);
    for (const o of [...new Set([...struts, ...balls, ...winches, hubMesh].filter(Boolean).map((o) => o.geometry))]) o.dispose();
    struts = []; balls = []; winches = []; hubMesh = null;
    if (cableMesh) { cableMesh.geometry.dispose(); cableMesh = null; }
    if (mats) { for (const m of Object.values(mats)) m.mat?.dispose(); mats = null; }
    ready = false;
  }

  function makeMat(f, salt) {
    const U = finishU(f);
    return { U, key: signature(f), mat: buildPieceMaterial(f, U, { seedOff: uniform(new THREE.Vector3(salt, salt * 0.37, 0.5)) }), f };
  }

  // parts : géométries reçues du worker ({ struts: {clé: o}, ball, winch, hub, cable })
  function setScene(recipe, theFilm, parts) {
    clear();
    R = recipe; film = theFilm; T = film.T;
    // matériaux construits après les géométries (three ne recompile pas un objet dont on change la géométrie)
    mats = {
      strut: makeMat(R.mats.strut, 1.3), ball: makeMat(R.mats.ball, 2.7), winch: makeMat(R.mats.winch, 4.1),
      cable: { mat: buildCableMaterial(CU) },
    };
    mats.hub = mats.ball;
    const geo = Object.fromEntries(Object.entries(parts.struts).map(([k, o]) => [k, toGeometry(o)]));
    const sk = partSpecs(T).strutKey;
    for (const b of T.bars) {
      let m;
      if (b.hub) { m = hubMesh = new THREE.Mesh(toGeometry(parts.hub), mats.hub.mat); }
      else { m = new THREE.Mesh(geo[sk(b)], mats.strut.mat); struts.push(m); }
      m.castShadow = m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      group.add(m);
    }
    if (parts.ball) {
      const g = toGeometry(parts.ball);
      T.nodes.forEach((nd, i) => {
        if (nd.hub !== undefined) return;
        const m = new THREE.Mesh(g, mats.ball.mat);
        m.castShadow = m.receiveShadow = true; m.matrixAutoUpdate = false; m.userData.node = i;
        balls.push(m); group.add(m);
      });
    }
    if (parts.winch) {
      const g = toGeometry(parts.winch);
      T.cables.forEach((c, i) => {
        const active = T.family === 'culbute' || c.kind === 'axial';
        if (!active) return;
        const m = new THREE.Mesh(g, mats.winch.mat);
        m.castShadow = m.receiveShadow = true; m.matrixAutoUpdate = false; m.userData.cable = i;
        winches.push(m); group.add(m);
      });
    }
    const NC = Math.min(MAX_CABLES, T.cables.length);
    cableMesh = new THREE.Mesh(cableGeometry(parts.cable, NC), mats.cable.mat);
    cableMesh.castShadow = true; cableMesh.receiveShadow = true; cableMesh.frustumCulled = false;
    group.add(cableMesh);
    syncFinishes();
    // sol : matière propre au type, motifs calés sur la période du pas
    if (floorType !== R.floor.type) {
      floor.material?.dispose?.();
      floor.material = buildFloorMaterial(R.floor.type, FU);
      floorType = R.floor.type;
    }
    const F = FLOORS[R.floor.type];
    FU.arc.value = film.arc ? 1 : 0;
    FU.P.value = film.period;
    const k = floorFreqs(film.period);
    FU.kS.value.set(k[0], k[1], k[2], k[3]);
    FU.W.value = F.W;
    FU.Lj.value = jointSpacing(film.period, F.Lj);
    if (film.arc) {
      FU.C.value.set(film.C[0], film.C[1]);
      FU.Rref.value = Math.hypot(film.C[0], film.C[1]);
      FU.sgn.value = Math.sign(film.C[1]) || 1;
      FU.a0.value = Math.atan2(-film.C[1], -film.C[0]);
    }
    FU.c1.value.set(F.c1); FU.c2.value.set(F.c2); FU.c3.value.set(F.c3); FU.rough.value = F.rough; FU.relief.value = F.relief;
    ready = true;
  }

  function syncFinishes() {
    if (!mats || !R) return;
    for (const k of ['strut', 'ball', 'winch']) {
      const M = mats[k], f = R.mats[k];
      if (signature(f) !== M.key) {
        const nm = makeMat(f, k === 'strut' ? 1.3 : k === 'ball' ? 2.7 : 4.1);
        for (const o of [...struts, ...balls, ...winches, hubMesh]) if (o && o.material === M.mat) o.material = nm.mat;
        M.mat.dispose(); mats[k] = nm;
        if (k === 'ball') mats.hub = nm;
      } else { applyFinish(M.U.outer, f.outer); applyFinish(M.U.inner, f.inner); applyFinish(M.U.edge, f.edge); M.U.wear.value = f.wear; M.f = f; }
    }
    const C = CABLES[R.mats.cable];
    CU.color.value.set(C.color); CU.metal.value = C.metal; CU.rough.value = C.rough; CU.braid.value = C.braid; CU.sheen.value = C.sheen;
    for (let i = 0; i < MAX_CABLES; i++) { CU.B[i].w = C.r; CU.BP[i].w = C.r; }
  }

  // ── Pose d'une phase ──
  const P = new Float32Array(256 * 3);
  let RS = new Float32Array(256);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const Z = new THREE.Vector3(0, 0, 1), _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3();
  const node = (i, v) => v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  // orientation : +z vers dir, roulis fixé par la verticale (stable), puis rotation propre `spin` autour de l'axe
  function orient(dir, spin, q) {
    _up.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.95) _up.set(1, 0, 0);
    const x = new THREE.Vector3().crossVectors(_up, dir).normalize(), y = new THREE.Vector3().crossVectors(dir, x);
    _m.makeBasis(x, y, dir);
    q.setFromRotationMatrix(_m);
    if (spin) q.multiply(_q2.setFromAxisAngle(Z, spin));
    return q;
  }
  // extrémités d'un câble (le rayon part du bord du flasque du moyeu)
  // rend le mou du câble : longueur au repos − distance des nœuds simulés (≥ 0)
  function cableEnds(c, a, b) {
    node(c.i, a); node(c.j, b);
    const dTrue = a.distanceTo(b);
    if (c.kind === 'spoke') {
      const h0 = node(T.hub[0], new THREE.Vector3()), h1 = node(T.hub[1], new THREE.Vector3());
      const ax = h1.sub(h0).normalize();
      _d.subVectors(b, a); _d.addScaledVector(ax, -_d.dot(ax)).normalize();
      a.addScaledVector(_d, 0.3);
    }
    return dTrue;
  }

  function update(u, firstOfJump = false) {
    if (!ready) return;
    film.pose(u, P);
    if (RS.length < film.NC) RS = new Float32Array(film.NC);
    film.rests(u, RS);
    // barres
    let si = 0;
    T.bars.forEach((b) => {
      const m = b.hub ? hubMesh : struts[si++];
      node(b.i, _a); node(b.j, _b);
      _d.subVectors(_b, _a).normalize();
      orient(_d, 0, _q);
      if (b.hub) _a.add(_b).multiplyScalar(0.5);
      m.matrix.compose(_a, _q, _s);
      m.matrixWorldNeedsUpdate = true;
    });
    for (const m of balls) { node(m.userData.node, _a); m.matrix.makeTranslation(_a.x, _a.y, _a.z); m.matrixWorldNeedsUpdate = true; }
    // câbles : extrémités et flèche (parabole d'arc égal à la longueur au repos)
    const NC = Math.min(MAX_CABLES, T.cables.length);
    for (let i = 0; i < NC; i++) {
      const c = T.cables[i];
      const dT = cableEnds(c, _a, _b);
      const d = _a.distanceTo(_b), f = sagOf(d, d + Math.max(0, RS[i] - dT));
      CU.AP[i].copy(CU.A[i]); CU.BP[i].copy(CU.B[i]);
      CU.A[i].set(_a.x, _a.y, _a.z, f); CU.B[i].set(_b.x, _b.y, _b.z, CU.B[i].w);
      if (firstOfJump) { CU.AP[i].copy(CU.A[i]); CU.BP[i].copy(CU.B[i]); }
    }
    CU.UA.array = CU.A; CU.UB.array = CU.B; CU.UAP.array = CU.AP; CU.UBP.array = CU.BP;
    // treuils : au milieu du câble (le point le plus bas s'il pend), le barillet tourne
    // d'autant que la corde enroulée (longueur au repos perdue) / rayon du tambour
    for (const m of winches) {
      const i = m.userData.cable, c = T.cables[i];
      const dT = cableEnds(c, _a, _b);
      const d = _a.distanceTo(_b), f = sagOf(d, d + Math.max(0, RS[i] - dT));
      _d.subVectors(_b, _a).normalize();
      const g = new THREE.Vector3(0, -1, 0).addScaledVector(_d, _d.y); // (verticale hors de la corde)
      const gl = g.length();
      const mid = _a.clone().add(_b).multiplyScalar(0.5);
      if (gl > 1e-3) mid.addScaledVector(g.multiplyScalar(1 / gl), f * Math.min(1, gl / 0.15));
      const wound = Math.max(0, c.L0 - RS[i]);
      orient(_d, (wound / 2) / DRUM_R, _q);
      m.matrix.compose(mid, _q, _s);
      m.matrixWorldNeedsUpdate = true;
    }
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setScene, update, syncFinishes, setShadowQuality, group, floor, key, rims, CU, FU,
    ready: () => ready, nodes: () => P, film: () => film,
  };
}
