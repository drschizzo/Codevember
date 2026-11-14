// La scène : la pièce, la colonne, le fléau et ses deux stations (cage,
// lampe, ailette, chariot, œil, cocon), le ruban libre, les lumières.
//
// Principes :
// - update(u) ne dépend que de la recette et de la phase (timeline.js) ;
// - toutes les lumières sont créées une fois, dans un ordre fixe, au premier
//   niveau de la scène (un réordonnancement recompile tout) ;
// - les deux stations sont identiques ; celle de droite est tournée de π dans
//   le fléau, si bien qu'après la relève (fléau tourné de π) la station pleine
//   occupe exactement la place et l'orientation de celle de gauche.
//
// Calques : 0 = tout ; 1 = fils (la caméra et la lumière de la pièce les
// voient, pas les lampes : la transmission de la paroi s'en charge) ; 2 et 3 =
// doublures des cocons A et B (seule la lampe de l'AUTRE station les voit).
import * as THREE from 'three/webgpu';
import { uniform, vec4, float, attribute, hash, floor, step, Fn } from 'three/tsl';
import { LanternLight, LanternLightNode, createCookieTextures, stationUniforms, makeCookie, makeCookieFast, setCookieData, cellT } from './lantern.js';
import { Fn as tFn, Loop, vec3, normalize, length, dot, max, min, screenUV, screenCoordinate, getViewPosition, cameraProjectionMatrixInverse, cameraWorldMatrix, cameraPosition, fract, float as tFloat, uniform as tUniform } from 'three/tsl';
import { threadGeometry, threadUniforms, threadMaterial } from './threads.js';
import { solidMaterial, bulbMaterial, filamentMaterial } from './machine.js';
import { buildRoomGeometry, roomUniforms, roomMaterial, buildPanel, panelMaterial, ROOM } from './room.js';
import { makeProgram, filmState } from '../timeline.js';
import { windSpec, ACCORDS, kelvinToHex } from '../recipe.js';

const TAU = Math.PI * 2;
const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
// part des lampes reçue par le métal de la station (côtes, ailette, chariot) :
// à 15–20 cm d'une ampoule nue, il brûlait en arcs blancs autour du cocon
const NEAR_LAMP = 0.3;

function toGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  if (o.sp) g.setAttribute('sp', new THREE.BufferAttribute(o.sp, 2));
  g.computeBoundingSphere();
  return g;
}

export function createStage(scene, gen, { lite = false, renderer = null } = {}) {
  renderer?.library.addLight(LanternLightNode, LanternLight);
  // ── Lumières (ordre fixe) ──
  const key = new THREE.SpotLight(0xffffff, 0, 0, 0.5, 0.8, 2);
  key.castShadow = true;
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.01; key.shadow.radius = 5;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 14;
  // (la lumière de la pièce voit les doublures des cocons, pas leurs fils :
  // 4 000 triangles masqués selon la transmission de la paroi au lieu de
  // 150 000 rubans)
  key.shadow.camera.layers.enable(2); key.shadow.camera.layers.enable(3);
  const fill = new THREE.SpotLight(0xffffff, 0, 0, 0.9, 1, 2);
  const lamps = [new LanternLight(0xffcc88, 1, 0, 2), new LanternLight(0xffcc88, 1, 0, 2)];
  lamps.forEach((l, i) => {
    // (pas de carte d'ombre cubique, ~7 ms : la paroi de fils, les côtes, les
    // rosaces et l'autre cocon sont des ombres analytiques dans la lecture de
    // la paroi, voir lantern.js)
    l.castShadow = false;
    l.shadow.mapSize.set(lite ? 512 : 1024, lite ? 512 : 1024);
    l.shadow.bias = -0.002; l.shadow.normalBias = 0.003; l.shadow.radius = 3;
    l.shadow.camera.near = 0.02; l.shadow.camera.far = 9;
    l.shadow.camera.layers.set(0); l.shadow.camera.layers.enable(i === 0 ? 3 : 2); // (la doublure de l'autre cocon)
  });
  for (const l of [key, fill, ...lamps]) scene.add(l);
  scene.add(key.target, fill.target);

  // ── Textures de la paroi, uniformes ──
  const CT = createCookieTextures(lite);
  const stU = [stationUniforms(), stationUniforms()];
  const cookies = stU.map((st, i) => makeCookie(CT, st, stU[1 - i]));
  // (les fils lisent la paroi en un seul prélèvement : leur propre grain cache la pénombre)
  const cookiesFast = stU.map((st) => makeCookieFast(CT, st, { hideInside: false }));
  lamps.forEach((l, i) => { l.cookie = cookies[i]; });
  const TU = threadUniforms();
  const filament = uniform(new THREE.Color(40, 30, 20));

  // ── Brume éclairée : marche de rayon de la caméra au premier obstacle, la
  // lumière de chaque lampe filtrée par sa paroi (même table que les murs),
  // diffusion de Henyey-Greenstein vers l'avant ──
  const fast = stU.map((st) => makeCookieFast(CT, st));
  const hazeU = { density: tUniform(0), frame: tUniform(0) };
  const haze = (depthTex, liteMode) => tFn(() => {
    const N = liteMode ? 8 : 14;
    const dz = depthTex.sample(screenUV).r;
    const vp = getViewPosition(screenUV, dz, cameraProjectionMatrixInverse);
    const wp = cameraWorldMatrix.mul(vec4(vp, 1)).xyz;
    const ro = cameraPosition, seg = wp.sub(ro), tMax = min(length(seg), 5.0), rd = normalize(seg);
    // tramage entrelacé (Jimenez) renouvelé à chaque image : le TRAA le lisse
    const j = fract(fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189).add(hazeU.frame.mul(0.618034)));
    const acc = vec3(0).toVar();
    const g = 0.45;
    Loop(N, ({ i }) => {
      const t = tFloat(i).add(j).div(N).mul(tMax);
      const p = ro.add(rd.mul(t));
      for (let k = 0; k < 2; k++) {
        const v = p.sub(stU[k].lampW), r2 = dot(v, v).max(0.02);
        const c = dot(normalize(v), rd.negate());
        const ph = tFloat(1 - g * g).div(tFloat(1 + g * g).sub(c.mul(2 * g)).pow(1.5)).mul(1 / (4 * Math.PI));
        acc.addAssign(TU.lampRad.mul(fast[k](p)).mul(ph).div(r2));
      }
    });
    return acc.mul(hazeU.density).mul(tMax.div(N));
  })();

  // ── Pièce ──
  const RU = roomUniforms();
  const room = new THREE.Mesh(buildRoomGeometry(), roomMaterial(RU));
  room.receiveShadow = true;
  scene.add(room);
  const PU = { panel: uniform(new THREE.Color(1, 1, 1)), shoji: uniform(0), frameColor: uniform(new THREE.Color(0.02, 0.02, 0.02)) };
  const panel = new THREE.Mesh(buildPanel(), panelMaterial(PU));
  panel.visible = false;
  scene.add(panel);

  // ── Appareil ──
  const world = new THREE.Group(); scene.add(world);
  const beam = new THREE.Group(); world.add(beam);
  const mats = new Map(); // (une matière par rôle et par clé : construite une fois)
  // (fils de la cage et rails : plus fins qu'un pixel de loin, ils reçoivent un
  // reflet plus large, sinon ils scintillent)
  // (près des lampes : côtes, ailette, chariot, buse — ils ne reçoivent
  // qu'une part de la lampe, comme les fils : NEAR_LAMP)
  const matFor = (k, wire = false, near = false) => {
    const key = `${k}${wire ? ':fil' : ''}${near ? ':près' : ''}`;
    if (!mats.has(key)) mats.set(key, solidMaterial(k, { minRough: wire ? 0.45 : 0, lampGain: near ? NEAR_LAMP : 1 }));
    return mats.get(key);
  };
  const glassMat = bulbMaterial(), filMat = filamentMaterial({ filament });
  const meshes = [];
  const addMesh = (parent, buf, matKey, { cast = true, receive = true } = {}) => {
    if (!buf || !buf.index?.length) return null;
    const m = new THREE.Mesh(toGeometry(buf));
    m.userData.role = matKey;
    m.castShadow = cast; m.receiveShadow = receive;
    parent.add(m); meshes.push(m);
    return m;
  };
  // stations
  const ST = [0, 1].map((i) => {
    const g = new THREE.Group(); beam.add(g);
    const yoke = new THREE.Group(); g.add(yoke);
    const carriage = new THREE.Group(); yoke.add(carriage);
    const nozzle = new THREE.Group(); yoke.add(nozzle);
    const eye = new THREE.Group(); g.add(eye);
    const threads = new THREE.Mesh(threadGeometry(null, 1), null);
    threads.frustumCulled = false; threads.castShadow = true; threads.receiveShadow = false; threads.layers.set(1);
    g.add(threads);
    const free = new THREE.Mesh(threadGeometry(null, 4096), null);
    free.frustumCulled = false; free.castShadow = true; free.layers.set(1);
    g.add(free);
    const proxy = new THREE.Mesh(new THREE.BufferGeometry(), null);
    proxy.castShadow = true; proxy.receiveShadow = false; proxy.layers.set(2 + i); proxy.frustumCulled = false;
    g.add(proxy);
    return { i, g, yoke, carriage, nozzle, eye, threads, free, proxy, parts: [] };
  });
  const beamParts = [], columnParts = [];
  let D = null; // sortie du worker pour la scène courante
  let R = null, prog = null, version = 0, pending = 0, progress = 1;

  function clearParts(list) { for (const m of list) { m.parent?.remove(m); m.geometry.dispose(); } list.length = 0; }

  // matériaux des fils (un par station : uniformes propres) — reconstruits à
  // chaque nouvelle géométrie (three ne recompile pas un objet dont seule la
  // géométrie change)
  function buildThreadMaterials() {
    ST.forEach((s, i) => {
      const o = ST[1 - i];
      s.threads.material?.dispose?.(); s.free.material?.dispose?.(); s.proxy.material?.dispose?.();
      s.threads.material = threadMaterial(TU, stU[i], stU[1 - i], cookiesFast[i], cookiesFast[1 - i]);
      s.free.material = threadMaterial(TU, stU[i], stU[1 - i], cookiesFast[i], cookiesFast[1 - i], { free: true });
      // doublure : invisible à la caméra ; dans la carte d'ombre de l'autre
      // lampe, elle bouche selon la transmission de sa paroi (tramage fixe)
      const pm = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
      const sp = attribute('sp', 'vec2');
      const si = sp.x.div(CT.cs), pk = sp.y.div(CT.cp);
      const T = cellT(CT, stU[i], si, pk);
      const keep = hash(floor(si.mul(0.5)).add(floor(pk.mul(0.5)).mul(1931.7))).greaterThan(T);
      pm.maskShadowNode = keep;
      pm.colorNode = vec4(0, 0, 0, 1);
      s.proxy.material = pm;
      void o;
    });
  }

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    pending = 1; progress = 0;
    gen.request(windSpec(R, lite), 'scene', (p) => { if (v === version) progress = p; }).then((o) => {
      if (v !== version) return;
      apply(o);
      pending = 0; progress = 1;
    }).catch((e) => { console.error(e); pending = 0; });
    applyLooks();
  }

  function apply(o) {
    D = o;
    prog = makeProgram(o.marks, R.tempo.speeds);
    setCookieData(CT, o);
    CT.ribs.value = R.cage.ribs; CT.wire.value = R.cage.wire;
    // appareil
    clearParts(columnParts); clearParts(beamParts); ST.forEach((s) => clearParts(s.parts));
    const A = ACCORDS[R.accord] ?? ACCORDS.laitonNoyer;
    const G = o.geo;
    const push = (list, m) => m && list.push(m);
    push(columnParts, addMesh(world, G.column.wood, A.wood));
    push(columnParts, addMesh(world, G.column.structure, A.structure));
    push(beamParts, addMesh(beam, G.beam.structure, A.structure));
    push(beamParts, addMesh(beam, G.beam.fittings, A.fittings));
    push(beamParts, addMesh(beam, G.beam.wood, A.wood));
    for (const s of ST) {
      push(s.parts, addMesh(s.g, G.station.fittings, A.fittings));
      { const m = addMesh(s.g, G.station.cage, A.cage); if (m) m.userData.wire = m.userData.near = true; push(s.parts, m); }
      push(s.parts, addMesh(s.g, G.station.glass, 'glass', { cast: false, receive: false }));
      push(s.parts, addMesh(s.g, G.station.filament, 'filament', { cast: false, receive: false }));
      for (const m of [addMesh(s.yoke, G.yoke.fittings, A.fittings), addMesh(s.carriage, G.carriage.fittings, A.fittings)]) { if (m) m.userData.near = true; push(s.parts, m); }
      push(s.parts, addMesh(s.eye, G.eyeRing.eye, A.eye));
      // fils : même géométrie pour les deux stations (même cocon)
      s.threads.geometry.dispose();
      s.threads.geometry = threadGeometry(o.seg);
      s.proxy.geometry.dispose();
      s.proxy.geometry = toGeometry(G.proxy);
    }
    // buse : un cylindre unitaire le long de −x, mis à l'échelle
    for (const s of ST) {
      const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0024, 1, 10, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5));
      nz.castShadow = true; nz.receiveShadow = true; nz.userData.role = A.fittings; nz.userData.near = true;
      s.nozzle.add(nz); s.parts.push(nz); meshes.push(nz);
    }
    for (const m of meshes) {
      const r = m.userData.role;
      m.material = r === 'glass' ? glassMat : r === 'filament' ? filMat : matFor(r, !!m.userData.wire, !!m.userData.near);
    }
    buildThreadMaterials();
    // le ruban libre entre les poulies (dans le fléau, fixe)
    buildBeamBand(o);
    applyLooks();
  }

  // ── Ruban libre ──
  // Chaque station : les fils du ruban, du point de pose (ou de départ) à
  // l'œil ; puis un cordon de l'œil le long du rail jusqu'au palier haut ; le
  // cordon entre les deux poulies, sur le fléau, est fixe.
  const beamBand = new THREE.Mesh(threadGeometry(null, 512), null);
  beamBand.frustumCulled = false; beamBand.layers.set(1); beamBand.castShadow = true;
  beam.add(beamBand);
  function buildBeamBand(o) {
    const L = o.lay.L, yp = 0.032 + 0.02; // (dessus des poulies)
    const g = beamBand.geometry, a = g.attributes.ta.array, b = g.attributes.tb.array, c = g.attributes.tc.array;
    let n = 0;
    const pts = [];
    for (let i = 0; i <= 40; i++) { const x = -L + 0.05 + ((2 * L - 0.1) * i) / 40; pts.push([x, yp - 0.0005 * Math.sin((Math.PI * i) / 40), 0]); }
    for (let k = 0; k < 3; k++) for (let i = 1; i < pts.length; i++, n++) {
      const off = (k - 1) * 0.0012;
      a.set([pts[i - 1][0], pts[i - 1][1], pts[i - 1][2] + off, 0], n * 4); b.set([pts[i][0], pts[i][1], pts[i][2] + off, 0], n * 4); c.set([0, k, 0.3, 1], n * 4);
    }
    g.instanceCount = n;
    for (const k of ['ta', 'tb', 'tc']) g.attributes[k].needsUpdate = true;
    beamBand.material?.dispose?.();
    beamBand.material = threadMaterial(TU, stU[0], stU[1], cookiesFast[0], cookiesFast[1], { free: true });
  }

  // point j (réel) d'un tableau de vec3 aplati
  const lerp3 = (arr, j, out) => {
    const m = arr.length / 3, x = Math.min(m - 1, Math.max(0, j)), i = Math.min(m - 2, Math.floor(x)), f = x - i;
    for (let c = 0; c < 3; c++) out[c] = arr[i * 3 + c] + (arr[i * 3 + 3 + c] - arr[i * 3 + c]) * f;
    return out;
  };
  const lerp1 = (arr, j) => { const m = arr.length, x = Math.min(m - 1, Math.max(0, j)), i = Math.min(m - 2, Math.floor(x)); return arr[i] + (arr[i + 1] - arr[i]) * (x - i); };

  const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _e = [0, 0, 0], _p = [0, 0, 0], _q = [0, 0, 0];
  function poseStation(s, S) {
    const o = D, m = o.m, j = S * (m - 1);
    const psi = lerp1(o.eye.psi, j), u = lerp1(o.eye.rail, j);
    s.yoke.rotation.set(0, -psi, 0);
    // chariot sur le rail (repère de l'ailette), patin orienté selon le rail
    const RP = o.eye.railPts, nr = RP.length / 2, k = Math.min(nr - 2, Math.max(0, Math.floor(u))), t = u - k;
    const rr = RP[k * 2] + (RP[k * 2 + 2] - RP[k * 2]) * t, ry = RP[k * 2 + 1] + (RP[k * 2 + 3] - RP[k * 2 + 1]) * t;
    const tx = RP[k * 2 + 2] - RP[k * 2], ty = RP[k * 2 + 3] - RP[k * 2 + 1];
    s.carriage.position.set(rr, ry, 0);
    s.carriage.rotation.set(0, 0, Math.atan2(-tx, ty));
    // l'œil (repère de la station)
    if (o.eye.spinneret) {
      lerp3(o.eye.eye, j, _e);
      const c = Math.cos(psi), sn = Math.sin(psi);
      const ex = _e[0] * c + _e[2] * sn, ez = -_e[0] * sn + _e[2] * c; // (dans le repère de l'ailette)
      s.nozzle.position.set(rr, ry, 0);
      s.nozzle.lookAt(_v.set(ex, _e[1], ez).applyMatrix4(s.yoke.matrixWorld));
      s.nozzle.scale.set(1, 1, Math.max(0.002, Math.hypot(ex - rr, _e[1] - ry, ez)));
      s.nozzle.visible = true;
    } else {
      s.nozzle.visible = false;
      s.carriage.updateMatrixWorld(true);
      _v.set(-0.014, 0, 0).applyMatrix4(s.carriage.matrixWorld).applyMatrix4(_m.copy(s.g.matrixWorld).invert());
      _e[0] = _v.x; _e[1] = _v.y; _e[2] = _v.z;
    }
    // ruban libre : de chaque fil (à S) jusqu'à l'œil, puis le cordon jusqu'au palier haut
    const g = s.free.geometry, a = g.attributes.ta.array, b = g.attributes.tb.array, c = g.attributes.tc.array;
    let n = 0;
    const seg = (p, q, k, hide = 0) => { a.set([p[0], p[1], p[2], 0], n * 4); b.set([q[0], q[1], q[2], 0], n * 4); c.set([0, k, 0.5, 1], n * 4); n++; };
    const nb = o.nb, mm = o.m;
    if (S > 1e-4 && S < 1 - 1e-4 || true) {
      for (let k = 0; k < nb; k++) {
        // point du fil k à S : dans les segments (fil k, indice j)
        // (segments rendus : un point sur dec ; le point de pose s'interpole dans le sien)
        const per = o.seg.per, x = Math.min(per - 1e-6, Math.max(0, j / o.seg.dec));
        const jj = Math.min(per - 1, Math.floor(x)), o4 = (k * per + jj) * 4;
        const sa = o.seg.a[o4 + 3], sb = o.seg.b[o4 + 3], f = Math.min(1, Math.max(0, (S - sa) / Math.max(1e-9, sb - sa)));
        for (let cc = 0; cc < 3; cc++) _p[cc] = o.seg.a[o4 + cc] + (o.seg.b[o4 + cc] - o.seg.a[o4 + cc]) * f;
        const N = 8;
        for (let t = 1; t <= N; t++) {
          const u0 = (t - 1) / N, u1 = t / N;
          seg([_p[0] + (_e[0] - _p[0]) * u0, _p[1] + (_e[1] - _p[1]) * u0, _p[2] + (_e[2] - _p[2]) * u0], [_p[0] + (_e[0] - _p[0]) * u1, _p[1] + (_e[1] - _p[1]) * u1, _p[2] + (_e[2] - _p[2]) * u1], k);
        }
      }
    }
    // cordon : chariot → le long du rail (un peu dehors) → bras haut → axe → poulie du fléau
    const cs = Math.cos(psi), sn = Math.sin(psi);
    const toSt = (x, y) => [x * cs, y, x * sn];
    const route = [];
    for (let kk = Math.floor(u); kk < nr; kk += 3) route.push(toSt(RP[kk * 2] + 0.006, RP[kk * 2 + 1] + 0.004));
    route[0] = toSt(rr + 0.006, ry);
    const yTop = o.lay.top + 0.03;
    route.push(toSt(0.012, Math.max(yTop, RP[nr * 2 - 1] + 0.01)));
    route.push([0, o.lay.axisTop + 0.02, 0]);
    route.push([0, o.lay.axisTop + 0.06, 0]);
    route.push([0.05, o.lay.axisTop + 0.075 + 0.016, 0]);
    for (let k = 0; k < 2; k++) for (let i = 1; i < route.length; i++) {
      const off = (k - 0.5) * 0.0011;
      seg([route[i - 1][0], route[i - 1][1] + off, route[i - 1][2]], [route[i][0], route[i][1] + off, route[i][2]], k);
    }
    g.instanceCount = n;
    for (const kk of ['ta', 'tb', 'tc']) { g.attributes[kk].needsUpdate = true; g.attributes[kk].clearUpdateRanges?.(); }
  }

  // ── Aspect (uniformes : aucune recompilation) ──
  function applyLooks() {
    if (!R) return;
    const T = R.thread;
    TU.color.value.set(T.color); TU.spec.value.set(T.spec); TU.glowColor.value.set(T.glow);
    TU.tau.value = T.tau; TU.shift.value = T.shift; TU.rough.value = T.rough; TU.metal.value = T.metal; TU.d.value = R.band.thread;
    stU.forEach((s) => { s.tau.value = Math.max(0.001, T.tau); });
    const Rm = R.room;
    RU.wall.value.set(Rm.wall); RU.floor.value.set(Rm.floor); RU.wallRough.value = Rm.wallRough; RU.floorRough.value = Rm.floorRough;
    RU.tiles.value = Rm.tiles ?? 0; RU.concrete.value = Rm.concrete ?? 0;
  }

  // ── Pose à la phase u ──
  const keyPos = new THREE.Vector3();
  function update(u, camera, { live = false } = {}) {
    if (!R || !D) return;
    const F = filmState(R, prog, u);
    const lay = D.lay;
    world.position.set(0, 0, 0);
    beam.position.set(0, lay.yBeam, 0);
    // (sens : la lanterne proche de la caméra passe derrière la colonne)
    beam.rotation.set(0, F.theta, 0);
    // A à gauche (−L, orientation 0), B à droite (+L, tournée de π)
    ST[0].g.position.set(-lay.L, lay.yc - lay.yBeam, 0); ST[0].g.rotation.set(0, 0, 0);
    ST[1].g.position.set(lay.L, lay.yc - lay.yBeam, 0); ST[1].g.rotation.set(0, Math.PI, 0);
    world.updateMatrixWorld(true);
    const Ss = [F.SA, F.SB];
    ST.forEach((s, i) => {
      poseStation(s, Ss[i]);
      stU[i].S.value = Ss[i];
      stU[i].Minv.value.copy(s.g.matrixWorld).invert();
      const lw = new THREE.Vector3(0, -0.004, 0).applyMatrix4(s.g.matrixWorld);
      stU[i].lampW.value.copy(lw);
      lamps[i].position.copy(lw);
    });
    world.updateMatrixWorld(true);
    // lumières
    const L = R.light, lampI = 25 * L.lamp.power;
    lamps.forEach((l) => { l.color.set(L.lamp.color); l.intensity = lampI; });
    TU.lampRad.value.set(L.lamp.color).multiplyScalar(lampI);
    TU.glowGain.value = L.lamp.glow ?? 0.15;
    TU.lampThread.value = L.lamp.thread ?? 0.15;
    TU.total.value = D.total;
    hazeU.density.value = R.room.haze ?? 0; hazeU.frame.value = (hazeU.frame.value + 1) % 4096;
    filament.value.set(L.lamp.color).multiplyScalar(40 * L.lamp.power);
    const K = L.key;
    const kd = K.kind === 'top' || K.kind === 'skylight' ? 4.2 : 3.0;
    keyPos.set(Math.sin(K.az) * Math.cos(K.el) * kd, lay.yc + Math.sin(K.el) * kd, Math.cos(K.az) * Math.cos(K.el) * kd);
    key.position.copy(keyPos); key.target.position.set(0, lay.yc - 0.2, 0);
    key.color.set(K.color);
    const kI = K.kind === 'none' ? 0 : 150 * K.power;
    // (sans lumière de pièce, les fils ne sont pas rendus dans sa carte d'ombre)
    key.intensity = kI;
    key.angle = K.kind === 'top' ? 0.32 : 0.62; key.penumbra = K.soft;
    const kdir = keyPos.clone().sub(new THREE.Vector3(0, lay.yc, 0));
    const kdist = kdir.length();
    TU.keyDir.value.copy(kdir.normalize());
    TU.keyRad.value.set(K.color).multiplyScalar(kI / (kdist * kdist));
    // remplissage : du côté de la caméra, doux
    if (camera) {
      const cdir = camera.position.clone().sub(new THREE.Vector3(0, lay.yc, 0)).normalize();
      fill.position.set(cdir.x * 3 + cdir.z * 1.2, lay.yc + 1.2, cdir.z * 3 - cdir.x * 1.2);
      fill.target.position.set(0, lay.yc, 0);
      fill.intensity = 40 * L.fill; fill.color.set('#ffffff');
      const fd = fill.position.clone().sub(new THREE.Vector3(0, lay.yc, 0)); const fl = fd.length();
      TU.fillDir.value.copy(fd.normalize()); TU.fillRad.value.setScalar(fill.intensity / (fl * fl));
      // baie ou paravent : face à la caméra, contre le mur
      const Rm = R.room;
      panel.visible = !!Rm.window;
      // la pièce est centrée derrière l'appareil (vu de la caméra du film) : le
      // fond et le sol sont assez près pour recevoir les ombres des lanternes
      const caz = R.camera.az, back = -ROOM.off;
      room.position.set(Math.sin(caz) * back, 0, Math.cos(caz) * back);
      if (Rm.window) {
        const az = caz + Math.PI;
        panel.position.set(room.position.x + Math.sin(az) * (ROOM.Rw - 0.05), 1.95, room.position.z + Math.cos(az) * (ROOM.Rw - 0.05));
        panel.lookAt(room.position.x, 1.95, room.position.z);
        PU.panel.value.set(Rm.windowColor).multiplyScalar(Rm.windowPower);
        PU.shoji.value = Rm.window === 2 ? 1 : 0;
      }
      TU.pix.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, renderer?.domElement?.height ?? 1080);
    }
    // ambiance des fils : rebond de la pièce (sol et murs éclairés)
    const amb = (R.env.intensity * 0.6 + 0.02);
    TU.ambSky.value.set(R.room.wall).multiplyScalar(amb * (K.kind === 'none' ? 0.15 : 0.5));
    TU.ambGround.value.set(R.room.floor).multiplyScalar(amb * (K.kind === 'none' ? 0.1 : 0.35));
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setRecipe, update, setShadowQuality, applyLooks, group: world, key, fill, lamps, haze,
    retime: () => { if (D) prog = makeProgram(D.marks, R.tempo.speeds); },
    // signature de la scène indépendante de l'identité des stations : pour
    // chaque position de station (triée), sa part posée, sa matrice, celle de
    // son ailette et de son chariot (le raccord u = 0 / u = 1 échange A et B)
    signature: () => ST.map((s, i) => [stU[i].S.value, ...s.g.matrixWorld.elements, ...s.yoke.matrixWorld.elements, ...s.carriage.matrixWorld.elements])
      .sort((a, b) => a[13] - b[13]).flat(),
    syncFinishes: applyLooks,
    ready: () => pending === 0 && !!D,
    progress: () => progress,
    data: () => D, program: () => prog,
  };
}
