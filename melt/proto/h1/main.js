// Melt · essai h1 : la mini-usine.
//
// Un circuit vertical : deux lignes (haute et basse) et deux ascenseurs font
// tourner deux plateaux. En haut, sous la lampe, l'objet fond ; la cire coule
// du plateau dans sa cuvette, puis par la buse dans la cloche du moule posée
// sur le plateau d'en dessous. La cloche se lève : l'objet suivant est né. Les
// plateaux avancent d'un demi-tour, le bras du moule pivote et pose l'autre
// cloche. La simulation de fonte est celle de l'essai h0 (MLS-MPM sur GPU),
// attachée au plateau qui porte la cire.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, Break, Discard, instancedArray, instanceIndex, uniform, float, int, ivec3, vec2, vec3, vec4, mat3, array, struct,
  atomicStore, atomicAdd, atomicLoad, max, min, pow, clamp, mix, smoothstep, length, normalize, dot, cross, abs, exp, reflect, select,
  textureStore, texture3D, cameraPosition, positionWorld, cameraViewMatrix, cameraNear, cameraFar, viewZToPerspectiveDepth,
} from 'three/tsl';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const Q = new URLSearchParams(location.search);
const GX = 64, GY = 128, GZ = 64, NCELL = GX * GY * GZ;
const O = [32, 54, 32]; // dessus du plateau, au centre (repère de la grille)
const PBASE = 26; // dessous de la cuvette (grille) : l'origine du plateau dans le monde
const CELL = 0.02; // une cellule, en unités du monde
const RHO0 = 8, FM = 1e5, FV = 1e4, WG = 64;
const SUB = +(Q.get('sub') || 4), DT = 1 / (60 * SUB);
const W = +(Q.get('w') || 1280), H = +(Q.get('h') || 720);

// ── Les objets : ellipsoïdes fondus (repère objet, y vers le haut, en cellules) ──
const rotZX = (az, ax) => {
  const cz = Math.cos(az), sz = Math.sin(az), cx = Math.cos(ax), sx = Math.sin(ax);
  const R = [[cz, -sz, 0], [cx * sz, cx * cz, -sx], [sx * sz, sx * cz, cx]];
  return [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];
};
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const OBJECTS = {
  lapin: [
    { c: [0, 10.5, -2.5], r: [11.5, 10, 11.5], R: I3 }, { c: [0, 17, 0], r: [9.5, 12.5, 9], R: I3 },
    { c: [0, 33.5, 3], r: [7.6, 7.2, 8.2], R: I3 }, { c: [0, 31.5, 10], r: [4, 3.3, 3.6], R: I3 },
    { c: [-3.6, 47.5, 0.5], r: [2.6, 10.5, 2.1], R: rotZX(0.14, -0.1) }, { c: [3.6, 47.5, 0.5], r: [2.6, 10.5, 2.1], R: rotZX(-0.14, -0.1) },
    { c: [-4.6, 6, 8.6], r: [3.1, 5.5, 3.6], R: I3 }, { c: [4.6, 6, 8.6], r: [3.1, 5.5, 3.6], R: I3 },
    { c: [-8.5, 3.6, 3], r: [4, 3.4, 7], R: I3 }, { c: [8.5, 3.6, 3], r: [4, 3.4, 7], R: I3 },
    { c: [0, 8.5, -13.2], r: [4.2, 4.2, 4.2], R: I3 },
  ],
  canard: [
    { c: [0, 13.5, -1], r: [11.5, 10.5, 15], R: I3 }, { c: [0, 15, 6], r: [9.5, 9.5, 9], R: I3 },
    { c: [0, 32, 7.5], r: [8.2, 7.8, 8.4], R: I3 }, { c: [0, 24, 6.5], r: [5.5, 6, 5.5], R: I3 },
    { c: [0, 30.2, 16], r: [4.6, 1.9, 4.2], R: rotZX(0, 0.12) },
    { c: [0, 19, -15], r: [5, 4.2, 6.5], R: rotZX(0, 0.6) },
    { c: [-10.6, 14.5, -2.5], r: [2.6, 6.5, 10], R: rotZX(0.12, 0.15) }, { c: [10.6, 14.5, -2.5], r: [2.6, 6.5, 10], R: rotZX(-0.12, 0.15) },
  ],
};
const OSC = 0.86; // (objets un peu plus petits : la fonte tient dans le cycle)
for (const k of Object.keys(OBJECTS)) OBJECTS[k] = OBJECTS[k].map((P) => ({ c: P.c.map((v) => v * OSC), r: P.r.map((v) => v * OSC), R: P.R }));
const KS = 2.6;
function sdObjJS(PR, x, y, z) {
  let d = 1e9;
  for (const P of PR) {
    const px = x - P.c[0], py = y - P.c[1], pz = z - P.c[2], R = P.R;
    const lx = (R[0][0] * px + R[0][1] * py + R[0][2] * pz), ly = (R[1][0] * px + R[1][1] * py + R[1][2] * pz), lz = (R[2][0] * px + R[2][1] * py + R[2][2] * pz);
    const k0 = Math.hypot(lx / P.r[0], ly / P.r[1], lz / P.r[2]), k1 = Math.hypot(lx / P.r[0] ** 2, ly / P.r[1] ** 2, lz / P.r[2] ** 2);
    const e = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...P.r);
    const h = Math.max(KS - Math.abs(d - e), 0) / KS;
    d = Math.min(d, e) - h * h * KS * 0.25;
  }
  const q0 = Math.hypot(x, z) - 12 + 0.8, q1 = Math.abs(y - 1.4) - 1.4 + 0.8;
  const e = Math.min(Math.max(q0, q1), 0) + Math.hypot(Math.max(q0, 0), Math.max(q1, 0)) - 0.8;
  const h = Math.max(1.6 - Math.abs(d - e), 0) / 1.6;
  return Math.min(d, e) - h * h * 1.6 * 0.25;
}
// la distance de chaque objet, cuite dans une texture 3D (demi-cellule), lue en trilinéaire
const SB = { min: [-19, -1, -21], size: [38, 64, 42], res: 2 };
const SN = SB.size.map((v) => v * SB.res);
function bake(PR) {
  const data = new Uint16Array(SN[0] * SN[1] * SN[2]);
  for (let z = 0; z < SN[2]; z++) for (let y = 0; y < SN[1]; y++) for (let x = 0; x < SN[0]; x++) {
    data[x + SN[0] * (y + SN[1] * z)] = THREE.DataUtils.toHalfFloat(sdObjJS(PR, SB.min[0] + (x + 0.5) / SB.res, SB.min[1] + (y + 0.5) / SB.res, SB.min[2] + (z + 0.5) / SB.res));
  }
  const t = new THREE.Data3DTexture(data, SN[0], SN[1], SN[2]);
  t.format = THREE.RedFormat; t.type = THREE.HalfFloatType; t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}
const PS = 40;
function seed(PR, salt) {
  const pts = [];
  for (let z = 0.25; z < GZ; z += 0.5) for (let y = 0.25; y < GY; y += 0.5) for (let x = 0.25; x < GX; x += 0.5) {
    const ox = x - O[0], oy = y - O[1], oz = z - O[2];
    if (oy < 0.1 || oy > 62 || Math.abs(ox) > 18 || Math.abs(oz) > 20) continue;
    if (sdObjJS(PR, ox, oy, oz) < 0) pts.push(x, y, z);
  }
  return { pts, salt };
}
const SEQ = (Q.get('objets') || 'lapin,canard').split(',');
const SHAPES = SEQ.map((k, i) => ({ key: k, tex: bake(OBJECTS[k]), ...seed(OBJECTS[k], i * 3.1) }));
const N = Math.max(...SHAPES.map((s) => s.pts.length / 3));
function fill(shape) {
  const a = new Float32Array(N * PS), n = shape.pts.length / 3, k = shape.salt;
  for (let i = 0; i < n; i++) {
    const x = shape.pts[i * 3], y = shape.pts[i * 3 + 1], z = shape.pts[i * 3 + 2], o = i * PS;
    a[o] = x; a[o + 1] = y; a[o + 2] = z;
    a[o + 20] = 1; a[o + 25] = 1; a[o + 30] = 1;
    a[o + 32] = x; a[o + 33] = y; a[o + 34] = z;
    const v = Math.sin(0.33 * y + 2.2 * Math.sin(0.17 * x + 1 + k) + 1.7 * Math.sin(0.21 * z + 0.4 - k) + 0.8 * Math.sin(0.5 * x + 0.3 * z + k));
    a[o + 37] = Math.min(1, Math.max(0, (v - 0.55) * 4)); a[o + 38] = 1;
  }
  for (let i = n; i < N; i++) { a[i * PS] = 3; a[i * PS + 1] = 3; a[i * PS + 2] = 3; }
  return a;
}
const tS = texture3D(SHAPES[0].tex, null, 0);
const sdObj = (p) => {
  const q = p.sub(vec3(...SB.min)).div(vec3(...SB.size));
  const out = length(max(abs(q.sub(0.5)).sub(0.5), 0).mul(vec3(...SB.size)));
  return tS.sample(clamp(q, 0, 1)).r.add(out);
};

// ── Le plateau (repère de la grille) : une assiette sur trois colonnettes, au-dessus
// d'une cuvette en entonnoir percée d'une buse. (Les colonnettes, trop fines pour la
// grille, ne sont que dessinées.)
const col = (p) => {
  const r = length(p.xz.sub(vec2(O[0], O[2])));
  const q = vec2(r.sub(14.5 - 0.6), abs(p.y.sub(O[1] - 1.5).add(r.mul(r).mul(0.003))).sub(1.5 - 0.6));
  const plate = min(max(q.x, q.y), 0).add(length(max(q, 0))).sub(0.6);
  const bowl = max(max(p.y.sub(r.mul(0.2).add(PBASE + 3)), float(9).sub(r)), max(r.sub(29.5), float(PBASE - 2).sub(p.y))).mul(0.9);
  const rim = max(max(abs(r.sub(28.5)).sub(1), p.y.sub(PBASE + 11)), float(PBASE - 2).sub(p.y));
  const nozzle = max(abs(r.sub(9.6)).sub(0.6), abs(p.y.sub(PBASE - 3)).sub(3));
  return min(min(plate, nozzle), min(bowl, rim));
};
const pdata = fill(SHAPES[0]);

const particleStruct = struct({ position: { type: 'vec3' }, velocity: { type: 'vec3' }, C: { type: 'mat3' }, b: { type: 'mat3' }, rest: { type: 'vec3' }, misc: { type: 'vec4' } });
const PB = instancedArray(pdata, particleStruct);
const cellStruct = struct({ x: { type: 'int', atomic: true }, y: { type: 'int', atomic: true }, z: { type: 'int', atomic: true }, mass: { type: 'int', atomic: true }, heat: { type: 'int', atomic: true } });
const CB = instancedArray(NCELL, cellStruct);
const CV = instancedArray(NCELL, 'vec4'), CT = instancedArray(NCELL, 'float');
const SUP = [instancedArray(NCELL, 'float'), instancedArray(NCELL, 'float')]; // appui : la matière froide tient au support, de proche en proche
const rcellStruct = struct({ m: { type: 'int', atomic: true }, dx: { type: 'int', atomic: true }, dy: { type: 'int', atomic: true }, dz: { type: 'int', atomic: true }, s: { type: 'int', atomic: true }, t: { type: 'int', atomic: true }, c: { type: 'int', atomic: true } });
const RB = instancedArray(NCELL, rcellStruct);
const DRAIN = instancedArray(4, struct({ n: { type: 'int', atomic: true } })); // particules passées par la buse

// ── Réglages ──
const U = {
  dt: uniform(DT), g: uniform(+(Q.get('g') || 42)), K: uniform(8e3), mu: uniform(3e4), armed: uniform(0),
  etaL: uniform(150), etaS: uniform(150), relax: uniform(3), kc: uniform(+(Q.get('kc') || 0.02)), dbg: uniform(0), noCol: uniform(0),
  heat: uniform(0), plate: uniform(4), tPlate: uniform(1.7),
};
const enc = (f, m) => int(f.mul(m)), dec = (i, m) => float(i).div(m);
const I = () => mat3(1, 0, 0, 0, 1, 0, 0, 0, 1);
const solidOf = (T) => smoothstep(1.0, 0.72, T);
const stencil = (pos) => {
  const cellIndex = ivec3(pos).sub(1).toConst();
  const cd = pos.fract().sub(0.5).toConst();
  const w0 = float(0.5).mul(float(0.5).sub(cd)).mul(float(0.5).sub(cd));
  const w1 = float(0.75).sub(cd.mul(cd));
  const w2 = float(0.5).mul(float(0.5).add(cd)).mul(float(0.5).add(cd));
  return { cellIndex, weights: array([w0, w1, w2]).toConst() };
};
const each = (S, pos, fn) => {
  Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({ gx }) => {
    Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({ gy }) => {
      Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({ gz }) => {
        const w = S.weights.element(gx).x.mul(S.weights.element(gy).y).mul(S.weights.element(gz).z).toConst();
        const cx = S.cellIndex.add(ivec3(gx, gy, gz)).toConst();
        const dist = vec3(cx).add(0.5).sub(pos).toConst();
        const ptr = cx.x.add(cx.y.mul(GX)).add(cx.z.mul(GX * GY)).toConst();
        fn(w, dist, ptr);
      });
    });
  });
};

// Par image : la matière figée (froide, soutenue) est déposée une fois sur sa
// propre grille (kPinSplat) et mise à jour une fois (kPinUpdate : chaleur,
// libération). Par sous-pas, seule la matière libre travaille : un dépôt
// (kP2G : masse, quantité de mouvement, chaleur, contraintes — la densité est
// celle du sous-pas précédent), la grille (qui se remet à zéro en sortant), le
// retour aux particules.
const pinStruct = struct({ mass: { type: 'int', atomic: true }, heat: { type: 'int', atomic: true } });
const PG = instancedArray(NCELL, pinStruct);
const kPinClear = Fn(() => {
  const c = PG.element(instanceIndex);
  atomicStore(c.get('mass'), 0); atomicStore(c.get('heat'), 0);
})().compute(NCELL).setName('pinClear');
const kPinSplat = Fn(() => {
  const P = PB.element(instanceIndex);
  const misc = P.get('misc').toConst();
  If(misc.z.lessThan(0.5).or(misc.w.greaterThan(0.5)), () => { Return(); });
  const pos = P.get('position').toConst();
  const S = stencil(pos);
  each(S, pos, (w, dist, ptr) => {
    const c = PG.element(ptr);
    atomicAdd(c.get('mass'), enc(w, FM)); atomicAdd(c.get('heat'), enc(w.mul(misc.x), FM));
  });
})().compute(N, [WG, 1, 1]).setName('pinSplat');

const LHEAT = new THREE.Vector3(-0.25, 1, 0.3).normalize();
// chaleur d'une particule pendant la durée h : conduction (kcond), lampe sur la peau, plaque
const heatUp = (T, pos, rho, grad, tm, h, kcond) => {
  T.addAssign(tm.div(rho.max(1e-3)).sub(T).mul(kcond));
  const skin = smoothstep(RHO0 * 0.86, RHO0 * 0.5, rho).mul(smoothstep(0.02, 0.2, rho)); // (pas de peau sans grille : première image)
  const gl = length(grad);
  const nrm = select(gl.greaterThan(1e-3), grad.div(gl.max(1e-3)).negate(), vec3(0, 1, 0));
  const lamp = max(dot(nrm, vec3(LHEAT.x, LHEAT.y, LHEAT.z)), 0).mul(0.75).add(0.25);
  T.addAssign(h.mul(U.heat).mul(skin).mul(lamp));
  T.addAssign(h.mul(U.plate).mul(smoothstep(3.5, 0.5, col(pos))).mul(smoothstep(PBASE + 14, PBASE + 11, pos.y)).mul(max(U.tPlate.sub(T), 0)));
  T.assign(min(T, 2));
};
// (après un nombre pair de sous-pas, l'appui à jour est dans SUP[0])
const kPinUpdate = Fn(() => {
  const P = PB.element(instanceIndex);
  const misc = P.get('misc').toVar();
  If(misc.z.lessThan(0.5).or(misc.w.greaterThan(0.5)), () => { Return(); });
  const pos = P.get('position').toConst();
  const S = stencil(pos);
  const rho = float(0).toVar(), grad = vec3(0).toVar(), tm = float(0).toVar();
  each(S, pos, (w, dist, ptr) => {
    const m = CV.element(ptr).w.mul(w).toConst();
    rho.addAssign(m); grad.addAssign(dist.mul(m)); tm.addAssign(CT.element(ptr).mul(m));
  });
  const T = misc.x.toVar();
  heatUp(T, pos, rho, grad, tm, U.dt.mul(SUB), U.kc.mul(SUB));
  misc.x.assign(T);
  const ci = ivec3(pos).toConst();
  const held = SUP[0].element(ci.x.add(ci.y.mul(GX)).add(ci.z.mul(GX * GY)));
  If(T.greaterThan(0.86).or(U.armed.greaterThan(0.5).and(held.lessThan(0.5))), () => { misc.w.assign(1); });
  P.get('misc').assign(misc);
})().compute(N, [WG, 1, 1]).setName('pinUpdate');

const kP2G = Fn(() => {
  const P = PB.element(instanceIndex);
  const misc = P.get('misc').toConst();
  If(misc.z.lessThan(0.5).or(misc.w.lessThan(0.5)), () => { Return(); });
  const pos = P.get('position').toConst(), vel = P.get('velocity').toConst(), C = P.get('C').toConst();
  const S = stencil(pos);
  const density = float(0).toVar();
  each(S, pos, (w, dist, ptr) => { density.addAssign(CV.element(ptr).w.mul(w)); });
  const vol = float(1).div(density.max(3));
  const T = misc.x, sol = solidOf(T);
  const pressure = max(0, pow(density.div(RHO0), 3).sub(1).mul(U.K));
  const stress = mat3(pressure.negate(), 0, 0, 0, pressure.negate(), 0, 0, 0, pressure.negate()).toVar();
  // élasticité : μ · dev(b̄), au volume de repos (la peau n'est pas plus raide que le cœur)
  const b = P.get('b').toConst();
  const c0 = b.mul(vec3(1, 0, 0)), c1 = b.mul(vec3(0, 1, 0)), c2 = b.mul(vec3(0, 0, 1));
  const J2 = dot(c0, cross(c1, c2)).max(1e-4);
  const sc = pow(J2, -1 / 3);
  const tr = c0.x.add(c1.y).add(c2.z).mul(sc).div(3);
  stress.addAssign(b.mul(sc).sub(I().mul(tr)).mul(U.mu.mul(sol)).mul(density.max(3).div(RHO0)));
  // viscosité : le liquide file d'autant mieux qu'il est chaud ; le solide est amorti
  const eta = U.etaL.mul(mix(1, 0.12, smoothstep(1, 1.6, T))).mul(sol.oneMinus()).add(U.etaS.mul(sol));
  stress.addAssign(C.add(C.transpose()).mul(eta));
  const term = stress.mul(vol.mul(-4).mul(U.dt)).toConst();
  each(S, pos, (w, dist, ptr) => {
    const mv = w.mul(vel.add(C.mul(dist))).add(term.mul(dist).mul(w)).toConst();
    const c = CB.element(ptr);
    atomicAdd(c.get('x'), enc(mv.x, FV)); atomicAdd(c.get('y'), enc(mv.y, FV)); atomicAdd(c.get('z'), enc(mv.z, FV));
    atomicAdd(c.get('mass'), enc(w, FM)); atomicAdd(c.get('heat'), enc(w.mul(misc.x), FM));
  });
})().compute(N, [WG, 1, 1]).setName('p2g');

const cellXYZ = () => {
  const id = int(instanceIndex);
  return ivec3(id.mod(GX), id.div(GX).mod(GY), id.div(GX * GY));
};
const mkGrid = (Sprev, Snext) => Fn(() => {
  const c = CB.element(instanceIndex), pc = PG.element(instanceIndex);
  const pinM = dec(atomicLoad(pc.get('mass')), FM).toConst();
  const mass = dec(atomicLoad(c.get('mass')), FM).add(pinM).toConst();
  const mom = vec3(dec(atomicLoad(c.get('x')), FV), dec(atomicLoad(c.get('y')), FV), dec(atomicLoad(c.get('z')), FV)).toConst();
  const heat = dec(atomicLoad(c.get('heat')), FM).add(dec(atomicLoad(pc.get('heat')), FM)).toConst();
  atomicStore(c.get('x'), 0); atomicStore(c.get('y'), 0); atomicStore(c.get('z'), 0); atomicStore(c.get('mass'), 0); atomicStore(c.get('heat'), 0);
  If(mass.lessThanEqual(1e-4), () => { CV.element(instanceIndex).assign(vec4(0)); CT.element(instanceIndex).assign(0); Snext.element(instanceIndex).assign(0); Return(); });
  const v = mom.div(mass).toVar();
  const xyz = cellXYZ().toConst();
  // appui : une cellule de matière figée tient si elle touche le support ou une voisine qui tient
  const id = int(instanceIndex);
  const nb = max(max(max(Sprev.element(id.sub(1)), Sprev.element(id.add(1))), max(Sprev.element(id.sub(GX)), Sprev.element(id.add(GX)))), max(Sprev.element(id.sub(GX * GY)), Sprev.element(id.add(GX * GY))));
  const dcol = col(vec3(xyz).add(0.5)).toConst();
  Snext.element(instanceIndex).assign(select(pinM.greaterThan(0.6).and(dcol.lessThan(1.8).or(nb.greaterThan(0.5))), float(1), float(0)));
  If(xyz.x.lessThan(2).or(xyz.x.greaterThan(GX - 3)).or(xyz.y.lessThan(2)).or(xyz.y.greaterThan(GY - 3)).or(xyz.z.lessThan(2)).or(xyz.z.greaterThan(GZ - 3)), () => { v.assign(vec3(0)); });
  // le métal : la matière y adhère (vitesse nulle dans le support)
  If(dcol.lessThan(0), () => {
    const q = vec3(xyz).add(0.5).toConst();
    const n = normalize(vec3(col(q.add(vec3(0.5, 0, 0))).sub(col(q.sub(vec3(0.5, 0, 0)))), col(q.add(vec3(0, 0.5, 0))).sub(col(q.sub(vec3(0, 0.5, 0)))), col(q.add(vec3(0, 0, 0.5))).sub(col(q.sub(vec3(0, 0, 0.5))))).add(vec3(0, 1e-4, 0)));
    v.assign(v.sub(n.mul(min(dot(v, n), 0))).mul(0.97).mul(smoothstep(-2.5, -1.2, dcol)));
  });
  CV.element(instanceIndex).assign(vec4(v, mass));
  CT.element(instanceIndex).assign(heat.div(mass));
})().compute(NCELL).setName('grid');
const kGridV = [mkGrid(SUP[0], SUP[1]), mkGrid(SUP[1], SUP[0])];

const kG2P = Fn(() => {
  const P = PB.element(instanceIndex);
  const misc = P.get('misc').toVar();
  If(misc.z.lessThan(0.5).or(misc.w.lessThan(0.5)), () => { Return(); });
  const pos = P.get('position').toVar();
  const S = stencil(pos);
  const v = vec3(0).toVar(), B = mat3(0).toVar(), rho = float(0).toVar(), grad = vec3(0).toVar(), tm = float(0).toVar();
  each(S, pos, (w, dist, ptr) => {
    const cv = CV.element(ptr).toConst();
    const wv = cv.xyz.mul(w).toConst();
    B.addAssign(mat3(wv.mul(dist.x), wv.mul(dist.y), wv.mul(dist.z)));
    v.addAssign(wv);
    rho.addAssign(cv.w.mul(w));
    grad.addAssign(dist.mul(cv.w.mul(w)));
    tm.addAssign(CT.element(ptr).mul(cv.w).mul(w));
  });
  const C = B.mul(4).toConst();
  v.y.subAssign(U.g.mul(U.dt));
  const T = misc.x.toVar();
  heatUp(T, pos, rho, grad, tm, U.dt, U.kc);
  misc.x.assign(T);
  If(T.greaterThan(1.02), () => { misc.w.assign(2); }); // (fondue une fois : une goutte figée reste une goutte)
  P.get('C').assign(C);
  // b ← (I + dt·C) b (I + dt·C)ᵀ, puis relâchement vers l'isotrope
  const A = I().add(C.mul(U.dt)).toConst();
  const b = A.mul(P.get('b')).mul(A.transpose()).toVar();
  const c0 = b.mul(vec3(1, 0, 0)), c1 = b.mul(vec3(0, 1, 0)), c2 = b.mul(vec3(0, 0, 1));
  const J2 = dot(c0, cross(c1, c2));
  const soft = smoothstep(0.55, 1.05, T);
  const r = clamp(U.relax.mul(soft).mul(soft).mul(U.dt).add(smoothstep(1.05, 1.2, T)), 0, 1);
  const iso = pow(clamp(J2, 0.2, 5), 1 / 3);
  b.assign(b.mul(r.oneMinus()).add(I().mul(iso.mul(r))));
  If(J2.lessThan(0.05).or(J2.greaterThan(20)).or(J2.notEqual(J2)), () => { b.assign(I()); });
  P.get('b').assign(b);
  v.assign(v.mul(min(float(1), float(70).div(length(v).max(1e-3)))));
  pos.addAssign(v.mul(U.dt));
  pos.assign(clamp(pos, vec3(2.01), vec3(GX - 2.01, GY - 2.01, GZ - 2.01)));
  // l'écoulement : la cuvette se vide au pied
  const rr = length(pos.xz.sub(vec2(O[0], O[2])));
  If(pos.y.lessThan(PBASE - 5.5).and(rr.lessThan(11.5)), () => { misc.z.assign(0); pos.assign(vec3(3, 3, 3)); atomicAdd(DRAIN.element(0).get('n'), 1); });
  P.get('position').assign(pos);
  P.get('velocity').assign(v);
  P.get('misc').assign(misc);
})().compute(N, [WG, 1, 1]).setName('g2p');

// ── Champs de rendu ──
const FR = 1e3, FS = 1e4;
const kRClear = Fn(() => {
  const c = RB.element(instanceIndex);
  for (const k of ['m', 'dx', 'dy', 'dz', 's', 't', 'c']) atomicStore(c.get(k), 0);
})().compute(NCELL).setName('rclear');
// la matière figée ne bouge pas : son dépôt est gardé d'une image à l'autre (refait toutes les 4 images)
const rpinStruct = struct({ ms: { type: 'int', atomic: true }, ml: { type: 'int', atomic: true }, t: { type: 'int', atomic: true }, c: { type: 'int', atomic: true } });
const RP = instancedArray(NCELL, rpinStruct);
const kRPinClear = Fn(() => {
  const c = RP.element(instanceIndex);
  for (const k of ['ms', 'ml', 't', 'c']) atomicStore(c.get(k), 0);
})().compute(NCELL).setName('rpinClear');
const kRPinSplat = Fn(() => {
  const P = PB.element(instanceIndex);
  const misc = P.get('misc').toConst();
  If(misc.z.lessThan(0.5).or(misc.w.greaterThan(0.5)), () => { Return(); });
  const pos = P.get('position').toConst();
  const sol = solidOf(misc.x);
  const S = stencil(pos);
  each(S, pos, (w, dist, ptr) => {
    const c = RP.element(ptr);
    atomicAdd(c.get('ms'), enc(w.mul(sol), FS)); atomicAdd(c.get('ml'), enc(w.mul(sol.oneMinus()), FS));
    atomicAdd(c.get('t'), enc(w.mul(misc.x), FS)); atomicAdd(c.get('c'), enc(w.mul(misc.y), FS));
  });
})().compute(N, [WG, 1, 1]).setName('rpinSplat');
const kRSplat = Fn(() => {
  const P = PB.element(instanceIndex);
  const misc = P.get('misc').toConst();
  If(misc.z.lessThan(0.5).or(misc.w.lessThan(0.5)), () => { Return(); });
  const pos = P.get('position').toConst();
  const d = pos.sub(P.get('rest')).toConst();
  const sol = solidOf(misc.x).mul(smoothstep(1.9, 1.1, misc.w));
  const S = stencil(pos);
  each(S, pos, (w, dist, ptr) => {
    const c = RB.element(ptr);
    const ws = w.mul(sol).toConst();
    atomicAdd(c.get('m'), enc(ws, FS));
    atomicAdd(c.get('dx'), enc(ws.mul(d.x), FR)); atomicAdd(c.get('dy'), enc(ws.mul(d.y), FR)); atomicAdd(c.get('dz'), enc(ws.mul(d.z), FR));
    atomicAdd(c.get('s'), enc(w.sub(ws), FS)); atomicAdd(c.get('t'), enc(w.mul(misc.x), FS)); atomicAdd(c.get('c'), enc(w.mul(misc.y), FS));
  });
})().compute(N, [WG, 1, 1]).setName('rsplat');

const mk3D = () => { const t = new THREE.Storage3DTexture(GX, GY, GZ); t.type = THREE.HalfFloatType; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; };
const texA = mk3D(), texB = mk3D();
// (lissage léger : la cellule et ses six voisines, pour effacer le grain des particules dans le liquide)
const kResolve = Fn(() => {
  const xyz = cellXYZ().toConst();
  const A = vec4(0).toVar(), Bv = vec4(0).toVar();
  const id = int(instanceIndex);
  const tap = (off, w) => {
    const k = clamp(id.add(off), 0, NCELL - 1);
    const c = RB.element(k), q = RP.element(k);
    A.addAssign(vec4(dec(atomicLoad(c.get('dx')), FR), dec(atomicLoad(c.get('dy')), FR), dec(atomicLoad(c.get('dz')), FR), dec(atomicLoad(c.get('m')).add(atomicLoad(q.get('ms'))), FS)).mul(w));
    Bv.addAssign(vec4(dec(atomicLoad(c.get('s')).add(atomicLoad(q.get('ml'))), FS), dec(atomicLoad(c.get('t')).add(atomicLoad(q.get('t'))), FS), dec(atomicLoad(c.get('c')).add(atomicLoad(q.get('c'))), FS), 0).mul(w));
  };
  tap(0, 0.28);
  for (const o of [1, -1, GX, -GX, GX * GY, -GX * GY]) tap(o, 0.12);
  textureStore(texA, vec3(xyz), A);
  textureStore(texB, vec3(xyz), Bv);
})().compute(NCELL).setName('resolve');

// ── La cire : une boîte dont le fragment marche dans les champs de la grille ──
const tA = texture3D(texA, null, 0), tB = texture3D(texB, null, 0);
const Gv = vec3(GX, GY, GZ), Ov = vec3(...O);
const originW = uniform(new THREE.Vector3()); // coin de la grille dans le monde
const ISO_L = 0.9, KF = 0.3, KU = 0.9;
const parts2 = (p) => {
  const uvw = p.div(Gv);
  const A = tA.sample(uvw), Bq = tB.sample(uvw);
  const ms = A.w, d = A.xyz.div(ms.max(1e-3));
  const frac = ms.div(ms.add(Bq.x).max(1e-3));
  const ps = max(sdObj(p.sub(Ov).sub(d)), float(0.3).sub(frac).mul(1.5));
  const pl = float(ISO_L).sub(Bq.x).mul(KF);
  return { ps: mix(float(1.2), ps, smoothstep(0.004, 0.03, ms)), pl, A, Bq };
};
const inBox = (p) => p.x.greaterThan(1).and(p.x.lessThan(GX - 1)).and(p.y.greaterThan(1)).and(p.y.lessThan(GY - 1)).and(p.z.greaterThan(1)).and(p.z.lessThan(GZ - 1));
const waxPhi = Fn(([p]) => {
  const { ps, pl } = parts2(p);
  const h = max(float(KU).sub(abs(ps.sub(pl))), 0).div(KU);
  return select(inBox(p), min(ps, pl).sub(h.mul(h).mul(KU * 0.25)), float(1.5));
});
const LK = new THREE.Vector3(-0.45, 0.8, 0.42).normalize(), LR = new THREE.Vector3(0.62, 0.42, -0.66).normalize();
const lampGlow = uniform(0); // la lampe chauffante, au-dessus : elle éclaire la cire quand elle chauffe
const env = (d) => {
  const bg = mix(vec3(0.02, 0.02, 0.024), vec3(0.11, 0.1, 0.095), smoothstep(-0.3, 0.9, d.y));
  const k = smoothstep(0.83, 0.93, dot(d, vec3(LK.x, LK.y, LK.z))).mul(7);
  const r = smoothstep(0.9, 0.955, dot(d, vec3(LR.x, LR.y, LR.z))).mul(5);
  const s = smoothstep(0.93, 0.97, dot(d, normalize(vec3(0.85, 0.25, 0.45)))).mul(2);
  const top = smoothstep(0.9, 0.98, d.y).mul(lampGlow).mul(9);
  return bg.add(vec3(1, 0.93, 0.84).mul(k)).add(vec3(1, 0.8, 0.6).mul(r)).add(vec3(0.75, 0.85, 1).mul(s)).add(vec3(1, 0.5, 0.25).mul(top));
};
const thick = Fn(([p, L]) => {
  const t = float(0).toVar();
  Loop(9, ({ i }) => {
    const q = p.add(L.mul(float(i).add(0.5).mul(2.4)));
    const uvw = q.div(Gv);
    const m = tA.sample(uvw).w.add(tB.sample(uvw).x);
    t.addAssign(smoothstep(1.2, 5.5, m).mul(2.4).mul(select(inBox(q), float(1), float(0))));
  });
  return t;
});
// rend (couleur, distance le long du rayon, en cellules)
const wax = Fn(() => {
  const ro = cameraPosition.sub(originW).div(CELL).toConst();
  const rd = normalize(positionWorld.sub(cameraPosition)).toConst();
  const inv = vec3(1).div(rd);
  const t0 = vec3(1).sub(ro).mul(inv), t1 = Gv.sub(1).sub(ro).mul(inv);
  const tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z)).max(0), tf = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  const tw = tn.toVar(), hit = float(0).toVar();
  If(tf.greaterThan(tn), () => {
    Loop(200, () => {
      If(tw.greaterThan(tf), () => { Break(); });
      const d = waxPhi(ro.add(rd.mul(tw)));
      If(d.lessThan(0.02), () => { hit.assign(1); Break(); });
      tw.addAssign(clamp(d.mul(0.75), 0.1, 1.4));
    });
  });
  If(hit.lessThan(0.5), () => { Discard(); });
  Loop(3, () => { tw.addAssign(waxPhi(ro.add(rd.mul(tw))).mul(0.9)); });
  const p = ro.add(rd.mul(tw)).toConst();
  const e = 0.55;
  const n = normalize(vec3(
    waxPhi(p.add(vec3(e, 0, 0))).sub(waxPhi(p.sub(vec3(e, 0, 0)))),
    waxPhi(p.add(vec3(0, e, 0))).sub(waxPhi(p.sub(vec3(0, e, 0)))),
    waxPhi(p.add(vec3(0, 0, e))).sub(waxPhi(p.sub(vec3(0, 0, e)))),
  )).toConst();
  const F = parts2(p.sub(n.mul(0.5)));
  const im = float(1).div(F.A.w.add(F.Bq.x).max(1e-3));
  const T = F.Bq.y.mul(im), pig = clamp(F.Bq.z.mul(im), 0, 1);
  const Fs = parts2(p);
  const liq = smoothstep(-0.25, 0.25, Fs.ps.sub(Fs.pl));
  const wet = smoothstep(0.55, 0.95, T);
  const albedo = mix(WAX.a, WAX.b, smoothstep(0.25, 0.75, pig)).mul(mix(1, 0.72, liq)).toConst();
  const sig = vec3(0.05, 0.16, 0.2);
  const v = rd.negate();
  const lit = (L, Ii) => {
    const th = thick(p.add(n.mul(1.3)), L);
    const ndl = dot(n, L);
    const wrap = clamp(ndl.add(0.35).div(1.35), 0, 1);
    const direct = albedo.mul(wrap).mul(exp(th.mul(-0.55)));
    const trans = pow(albedo, vec3(0.6)).mul(exp(sig.mul(th).negate())).mul(0.3);
    const hv = normalize(L.add(v));
    const rough = mix(0.42, 0.1, max(wet, liq));
    const sp = pow(max(dot(n, hv), 0), float(2).div(rough.mul(rough))).mul(float(0.35).div(rough.mul(rough))).mul(max(ndl, 0)).mul(exp(th.mul(-1.2))).mul(0.06);
    return direct.add(trans).add(sp).mul(Ii);
  };
  const Lk = vec3(LK.x, LK.y, LK.z), Lr = vec3(LR.x, LR.y, LR.z), Lt = vec3(0, 1, 0);
  const IK = vec3(1, 0.93, 0.84).mul(0.95), IR = vec3(1, 0.78, 0.58).mul(1.25), IT = vec3(1, 0.6, 0.36).mul(lampGlow.mul(0.55));
  const fres = pow(float(1).sub(max(dot(n, v), 0)), 5).mul(0.96).add(0.04);
  const gloss = mix(0.25, 1, max(wet, liq));
  const c = lit(Lk, IK).add(lit(Lr, IR)).add(lit(Lt, IT)).add(albedo.mul(0.06).mul(n.y.mul(0.5).add(0.6))).add(env(reflect(rd, n)).mul(fres).mul(gloss));
  return vec4(c, tw);
});

// ── Moteur ──
const hud = document.getElementById('hud');
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
await renderer.init();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x17171a);
scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x3a332c, 0.9));
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.9;
const camera = new THREE.PerspectiveCamera(30, W / H, 0.5, 60);

// ── Le plan de l'usine : tout ce qui change d'une graine à l'autre ──
// (hauteurs, largeur, côté de la sortie, teintes ; la suite branchera ici la recette)
const rnd = (() => { let s = [...(Q.get('seed') || 'm1')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); })();
const pick = (a) => a[Math.floor(rnd() * a.length)];
const PLAN = {
  half: 1.9 + rnd() * 0.7, // demi-longueur des lignes
  y0: 0.3, // ligne basse (dessous des plateaux)
  bellH: 1.42, // hauteur de la cloche du moule
  dir: Q.has('dir') ? +Q.get('dir') : pick([1, -1]), // sens du circuit
  wax: pick([[[0.78, 0.2, 0.24], [0.9, 0.8, 0.66]], [[0.16, 0.42, 0.5], [0.9, 0.84, 0.7]], [[0.85, 0.55, 0.12], [0.93, 0.88, 0.76]], [[0.3, 0.5, 0.24], [0.92, 0.86, 0.7]]]),
  paint: pick(['#c9a227', '#2f6f7a', '#a8402a', '#5d6b3a', '#d8d2c4']),
};
PLAN.y1 = PLAN.y0 + 0.56 + PLAN.bellH * 2 + 0.42; // ligne haute : la cloche levée passe dessous
const WAX = { a: vec3(...PLAN.wax[0]), b: vec3(...PLAN.wax[1]) };

// matières
const M = {
  steel: new THREE.MeshStandardNodeMaterial({ color: 0x8d9096, metalness: 1, roughness: 0.38 }),
  dark: new THREE.MeshStandardNodeMaterial({ color: 0x1b1c1f, metalness: 0.6, roughness: 0.55 }),
  paint: new THREE.MeshStandardNodeMaterial({ color: PLAN.paint, metalness: 0.1, roughness: 0.45 }),
  copper: new THREE.MeshStandardNodeMaterial({ color: 0xb87352, metalness: 1, roughness: 0.3 }),
  alu: new THREE.MeshStandardNodeMaterial({ color: 0xc9ccd0, metalness: 1, roughness: 0.28 }),
  rubber: new THREE.MeshStandardNodeMaterial({ color: 0x101012, metalness: 0, roughness: 0.85 }),
  floor: new THREE.MeshStandardNodeMaterial({ color: 0x5a5651, metalness: 0, roughness: 0.8 }),
  glow: new THREE.MeshBasicNodeMaterial({ color: 0xff7a3a }),
};
const box = (w, h, d, m, x, y, z, parent = scene) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };
const cyl = (r, h, m, x, y, z, parent = scene, seg = 32) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };
const lathe = (pts, m, parent, seg = 64) => { const o = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), m); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };

// sol
{ const f = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), M.floor); f.receiveShadow = true; scene.add(f); }
// lumières : les mêmes directions que celles que la cire calcule elle-même
const key = new THREE.DirectionalLight(0xfff0dc, 3.6); key.position.copy(LK).multiplyScalar(14).add(new THREE.Vector3(0, 3, 0)); key.target.position.set(0, 3, 0);
key.castShadow = true; key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -5, near: 2, far: 30 }); key.shadow.bias = -0.0005;
const rim = new THREE.DirectionalLight(0xffc896, 2.2); rim.position.copy(LR).multiplyScalar(14).add(new THREE.Vector3(0, 3, 0)); rim.target.position.set(0, 3, 0);
scene.add(key, key.target, rim, rim.target);

// le circuit : deux lignes, deux ascenseurs
const { half: HX, y0: Y0, y1: Y1 } = PLAN;
const RAILZ = 0.5;
for (const y of [Y0, Y1]) for (const z of [-RAILZ, RAILZ]) {
  box(HX * 2 + 0.5, 0.07, 0.09, M.steel, 0, y - 0.075, z);
  box(HX * 2 + 0.5, 0.012, 0.07, M.rubber, 0, y - 0.034, z); // la bande
  for (let i = -2; i <= 2; i++) if (!(y === Y1 && Math.abs(i) < 1) && !(y === Y0 && i === 0)) box(0.07, y - 0.11, 0.07, M.dark, (i / 2) * (HX - 0.3), (y - 0.11) / 2, z * 1.22);
}
for (const sx of [-1, 1]) {
  const x = sx * (HX + 0.02);
  void x;
}
box(HX * 2 + 2.2, 0.16, 2.3, M.dark, 0, 0.08, -0.25);
for (const sx of [-1, 1]) {
  const x = sx * (HX + 0.72);
  box(0.5, Y1 + 0.2, 1.7, M.paint, x + sx * 0.3, (Y1 + 0.2) / 2, 0);
  box(0.06, Y1 - 0.2, 1.3, M.dark, x + sx * 0.04, (Y1 + 0.2) / 2, 0);
}
// la lampe : un capot au bout d'une potence, une résistance qui rougit
const lampY = Y1 + 0.56 + 1.14 + 0.5;
const lamp = new THREE.Group(); lamp.position.set(0, lampY, 0); scene.add(lamp);
lathe([[0.02, 0.32], [0.16, 0.3], [0.5, 0.06], [0.54, 0], [0.5, 0], [0.15, 0.24], [0.02, 0.26]], M.paint, lamp);
const coil = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.022, 10, 48).rotateX(Math.PI / 2), M.glow.clone()); coil.position.y = 0.07; lamp.add(coil);
const coil2 = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 10, 40).rotateX(Math.PI / 2), coil.material); coil2.position.y = 0.11; lamp.add(coil2);
box(0.08, 0.08, 1.5, M.dark, 0, lampY + 0.36, -0.72);
box(0.1, lampY + 0.4, 0.1, M.dark, 0, (lampY + 0.4) / 2, -1.45);
const spot = new THREE.SpotLight(0xff8a4a, 0, 4, 0.7, 0.8, 1.5); spot.position.set(0, lampY, 0); spot.target.position.set(0, Y1, 0); scene.add(spot, spot.target);

// les plateaux
const DZ = (y) => (y - PBASE) * CELL;
function makePallet() {
  const g = new THREE.Group();
  lathe([[0.205, -0.12], [0.205, DZ(24)], [0.59, DZ(24)], [0.59, DZ(37)], [0.55, DZ(37)], [0.55, DZ(34.5)], [0.18, DZ(30.8)], [0.18, -0.12], [0.205, -0.12]], M.copper, g);
  const pl = cyl(0.29, 0.06, M.copper, 0, DZ(O[1]) - 0.03, 0, g, 48);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.5; cyl(0.018, DZ(O[1]) - 0.06 - DZ(32), M.steel, Math.cos(a) * 0.22, (DZ(O[1]) - 0.06 + DZ(32)) / 2, Math.sin(a) * 0.22, g, 10); }
  void pl;
  scene.add(g);
  return g;
}
const pallets = [makePallet(), makePallet()];
// chemin d'un plateau : s ∈ [0, 1) le long du rectangle (ligne haute, descente, ligne basse, montée)
const PER = 4 * HX + 2 * (Y1 - Y0);
function pathAt(s) {
  let d = (((s % 1) + 1) % 1) * PER;
  const D = PLAN.dir;
  if (d < 2 * HX) return [D * (-HX + d), Y1];
  d -= 2 * HX; if (d < Y1 - Y0) return [D * HX, Y1 - d];
  d -= Y1 - Y0; if (d < 2 * HX) return [D * (HX - d), Y0];
  d -= 2 * HX; return [-D * HX, Y0 + d];
}
const S_LAMP = HX / PER, S_MOULD = (3 * HX + (Y1 - Y0)) / PER;

// le moule : deux cloches au bout d'un bras qui monte, pivote et redescend
const COLZ = -1.35;
const turret = new THREE.Group(); turret.position.set(0, 0, COLZ); scene.add(turret);
cyl(0.11, Y0 + 0.56 + PLAN.bellH * 2 + 0.3, M.dark, 0, (Y0 + 0.56 + PLAN.bellH * 2 + 0.3) / 2, COLZ);
cyl(0.2, 0.12, M.paint, 0, 0.06, COLZ);
const arm = new THREE.Group(); turret.add(arm);
box(0.12, 0.1, -COLZ * 2 + 0.2, M.paint, 0, PLAN.bellH + 0.2, 0, arm);
cyl(0.16, 0.22, M.steel, 0, PLAN.bellH + 0.2, 0, arm);
const bells = [1, -1].map((sg, i) => {
  const g = new THREE.Group(); g.position.set(0, 0, -COLZ * sg); arm.add(g);
  const R = 0.4, Hh = PLAN.bellH, m = i ? M.alu : M.steel;
  lathe([[R + 0.06, 0], [R + 0.06, 0.05], [R, 0.05], [R, Hh * 0.72], [R * 0.72, Hh * 0.95], [0.2, Hh], [0.3, Hh + 0.12], [0.25, Hh + 0.12], [0.12, Hh - 0.02], [R * 0.7 - 0.03, Hh * 0.93], [R - 0.03, Hh * 0.7], [R - 0.03, 0], [R + 0.06, 0]], m, g);
  cyl(0.03, 0.14, M.dark, 0.22, Hh + 0.13, 0, g, 12); cyl(0.03, 0.14, M.dark, -0.22, Hh + 0.13, 0, g, 12);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.09, 48, 1, true), M.paint); band.position.y = Hh * 0.36; g.add(band);
  return g;
});
// le filet de cire, de la buse à la cloche
const streamMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(...PLAN.wax[0]), roughness: 0.15, metalness: 0 });
const stream = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.8, 1, 16), streamMat); scene.add(stream);

// la boîte de la cire
const waxMat = new THREE.MeshBasicNodeMaterial();
{
  const res = wax().toVar();
  waxMat.colorNode = res.xyz;
  const pw = originW.add(cameraPosition.sub(originW).div(CELL).add(normalize(positionWorld.sub(cameraPosition)).mul(res.w)).mul(CELL));
  waxMat.depthNode = viewZToPerspectiveDepth(cameraViewMatrix.mul(vec4(pw, 1)).z, cameraNear, cameraFar);
}
waxMat.side = THREE.BackSide;
const waxBox = new THREE.Mesh(new THREE.BoxGeometry(GX * CELL, GY * CELL, GZ * CELL), waxMat);
waxBox.frustumCulled = false;
scene.add(waxBox);

// ── Le cycle ──
// un demi-cycle (durée HC) : fonte, égouttage, la cloche se lève, les plateaux
// avancent d'un demi-tour pendant que le bras pivote, la cloche redescend.
const HEATMAX = +(Q.get('heat') || 4.2);
const TL = { melt: 19, drip: 22, lift: 24, move: 29.5, lower: 31, HC: 32 };
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let frame = 0, step = 0, clock = 0, shapeI = 0, lastK = 0, revealed = false, drained = 0, rate = 0, lastDrain = 0;
const PRE = [kPinUpdate, kPinClear, kPinSplat], SIMS = [[kP2G, kGridV[0], kG2P], [kP2G, kGridV[1], kG2P]], REN = [kRClear, kRSplat, kResolve];
const errors = [];
const oe = console.error; console.error = (...a) => { oe(...a); errors.push(String(a[0]).slice(0, 500)); };
function reseed(i) {
  shapeI = i;
  PB.value.array.set(fill(SHAPES[i]));
  PB.value.needsUpdate = true;
  tS.value = SHAPES[i].tex;
  step = 0; U.armed.value = 0; pinDrawn = -99;
}
function pose() {
  const k = Math.floor(clock / TL.HC), t = clock - k * TL.HC;
  if (k !== lastK) { lastK = k; revealed = false; }
  // la cloche levée : la cire qu'on voit est désormais l'objet neuf, sur le plateau du bas
  if (t >= TL.drip + 0.3 && !revealed) { revealed = true; reseed((k + 1) % SHAPES.length); }
  const mv = sm(TL.lift, TL.move, t);
  const sA = S_LAMP + 0.5 * (k + mv), sB = S_MOULD + 0.5 * (k + mv); // (les deux plateaux, à un demi-tour l'un de l'autre)
  const pA = pathAt(sA), pB = pathAt(sB);
  pallets[0].position.set(pA[0], pA[1], 0); pallets[1].position.set(pB[0], pB[1], 0);
  // plateau qui porte la cire : celui de la lampe pendant la fonte, celui du moule ensuite
  const w = revealed ? (k % 2 ? pallets[0] : pallets[1]) : (k % 2 ? pallets[1] : pallets[0]);
  originW.value.set(w.position.x - (GX / 2) * CELL, w.position.y - PBASE * CELL, -(GZ / 2) * CELL);
  waxBox.position.set(w.position.x, w.position.y - PBASE * CELL + (GY / 2) * CELL, 0);
  // moule : levée, pivot, descente
  const up = sm(TL.drip + 0.3, TL.lift, t) * (1 - sm(TL.move, TL.lower, t));
  arm.position.y = Y0 + 0.56 + up * (PLAN.bellH + 0.12);
  arm.rotation.y = Math.PI * (k + sm(TL.lift + 0.4, TL.move - 0.4, t));
  // lampe
  const on = sm(0.3, 1.5, t) * (1 - sm(TL.melt, TL.melt + 1.2, t));
  U.heat.value = HEATMAX * on;
  lampGlow.value = on;
  coil.material.color.setRGB(0.05 + 6 * on, 0.03 + 1.4 * on * on, 0.02 + 0.25 * on * on * on);
  spot.intensity = 60 * on;
  // filet de cire
  rate += (Math.min(1, (drained - lastDrain) / 220) - rate) * 0.15; lastDrain = drained;
  const top = Y1 - 0.12, bot = Y0 + 0.56 + PLAN.bellH + 0.04, r = 0.006 + 0.03 * Math.sqrt(rate);
  stream.visible = rate > 0.01 && !revealed;
  stream.position.set(0, (top + bot) / 2, 0); stream.scale.set(r, top - bot, r);
  if (autoCam) {
    if (t < TL.drip + 0.3) setCam([2.4 * PLAN.dir, Y1 + 1.35, 4.9], [0, Y1 + 0.62, 0], 30);
    else if (t < TL.lift + 1.2) setCam([2.6 * PLAN.dir, Y0 + 1.9, 5.4], [0, Y0 + 1.25, 0], 30);
    else setCam();
  }
  return { k, t };
}
let pinDrawn = -99, busyRead = false;
const autoCam = !Q.has('wide');
async function advance(n = 1) {
  for (let i = 0; i < n; i++) {
    clock += 1 / 60;
    pose();
    renderer.compute(PRE);
    for (let s = 0; s < SUB; s++) renderer.compute(SIMS[(step++) & 1]);
    frame++;
    if (step > 160) U.armed.value = 1;
    if (frame % 6 === 0 && !busyRead) { busyRead = true; renderer.getArrayBufferAsync(DRAIN.value).then((b) => { drained = new Int32Array(b)[0]; busyRead = false; }); }
    if (i % 8 === 7) await renderer.backend.device.queue.onSubmittedWorkDone();
  }
}
function setCam(pos = [PLAN.dir * 5.2, Y1 * 0.82, 11.5], tgt = [0, (Y1 + 1.9) / 2 + 0.25, 0], fov = 32) {
  camera.position.set(...pos); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(...tgt);
}
setCam();
function draw() {
  if (frame - pinDrawn >= 4) { renderer.compute([kRPinClear, kRPinSplat]); pinDrawn = frame; }
  renderer.compute(REN);
  renderer.render(scene, camera);
  hud.textContent = `image ${frame} · t ${(clock % TL.HC).toFixed(1)} s · ${N} particules`;
}
async function send(name, url = `http://127.0.0.1:${Q.get('sink') || 8098}/`) {
  draw();
  const rt = new THREE.RenderTarget(W, H, { type: THREE.UnsignedByteType, samples: 4 });
  renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null);
  const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H);
  rt.dispose();
  const cv = new OffscreenCanvas(W, H), img = cv.getContext('2d').createImageData(W, H), stride = Math.ceil((W * 4) / 256) * 256;
  for (let y = 0; y < H; y++) img.data.set(px.subarray(y * stride, y * stride + W * 4), y * W * 4);
  cv.getContext('2d').putImageData(img, 0, 0);
  const b = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  await fetch(url + name, { method: 'POST', body: b });
  return b.size;
}
window.h1 = {
  DRAIN, renderer, scene, camera, U, PLAN, TL, advance, draw, send, setCam, errors, N,
  get frame() { return frame; }, get clock() { return clock; }, get drained() { return drained; },
  seq: async (n, k, prefix = 'q') => { window.h1.done = 0; for (let i = 0; i <= n; i += k) { await send(`${prefix}-${String(frame).padStart(4, '0')}.jpg`); if (i < n) await advance(k); window.h1.done = i; } window.h1.done = 'ok'; },
};
pose(); draw();
if (Q.has('play')) renderer.setAnimationLoop(async () => { await advance(1); draw(); });
window.h1.ready = true;
