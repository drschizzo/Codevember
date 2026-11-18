// Melt · essai h0 : la fonte d'un objet de cire.
//
// Question posée : voit-on la matière FONDRE (une peau qui luit, des coulées
// le long du corps, des oreilles qui ploient, une tête qui penche et tombe),
// ou seulement un objet qui s'aplatit ?
//
// Simulation : MLS-MPM sur GPU (d'après l'exemple three.js
// webgpu_compute_particles_fluid, lui-même d'après WebGPU-Ocean), étendu :
// - chaque particule porte une température T (1 = point de fusion), chauffée
//   à sa surface par la lampe, par la plaque, et conduite par la grille ;
// - solide viscoélastique de Maxwell : contrainte élastique μ·dev(b̄) sur le
//   tenseur de Cauchy-Green gauche b, qui se relâche vers l'identité d'autant
//   plus vite que la matière est chaude (froid : solide ; tiède : fluage ;
//   chaud : liquide visqueux) ;
// - pression par équation d'état sur la densité de la grille.
// Rendu : les particules déposent sur une grille leur déplacement d = x − X0,
// leur solidité, leur température et leur pigment. La surface est un mélange
// de l'objet d'origine évalué en p − d (net tant que rien n'a bougé) et de
// l'iso-densité (lisse là où c'est liquide).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, Break, instancedArray, instanceIndex, uniform, float, int, ivec3, vec2, vec3, vec4, mat3, array, struct,
  atomicStore, atomicAdd, atomicLoad, max, min, pow, clamp, mix, smoothstep, length, normalize, dot, cross, abs, exp, reflect, select,
  textureStore, texture3D, screenUV, sqrt,
} from 'three/tsl';

const Q = new URLSearchParams(location.search);
const GX = 64, GY = 128, GZ = 64, NCELL = GX * GY * GZ;
const O = [32, 34, 32]; // dessus du plateau, au centre (repère de l'objet)
const RHO0 = 8, FM = 1e5, FV = 1e4, WG = 64;
const SUB = +(Q.get('sub') || 4), DT = 1 / (60 * SUB);
const W = +(Q.get('w') || 1280), H = +(Q.get('h') || 720);

// ── L'objet : un lapin assis, en ellipsoïdes fondus (repère objet, y vers le haut) ──
const rotZX = (az, ax) => {
  const cz = Math.cos(az), sz = Math.sin(az), cx = Math.cos(ax), sx = Math.sin(ax);
  // R = Rx · Rz ; on stocke Rᵀ (monde → local)
  const R = [[cz, -sz, 0], [cx * sz, cx * cz, -sx], [sx * sz, sx * cz, cx]];
  return [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];
};
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const PRIMS = [
  { c: [0, 10.5, -2.5], r: [11.5, 10, 11.5], R: I3 }, // croupe
  { c: [0, 17, 0], r: [9.5, 12.5, 9], R: I3 }, // buste
  { c: [0, 33.5, 3], r: [7.6, 7.2, 8.2], R: I3 }, // tête
  { c: [0, 31.5, 10], r: [4, 3.3, 3.6], R: I3 }, // museau
  { c: [-3.6, 47.5, 0.5], r: [2.6, 10.5, 2.1], R: rotZX(0.14, -0.1) }, // oreilles
  { c: [3.6, 47.5, 0.5], r: [2.6, 10.5, 2.1], R: rotZX(-0.14, -0.1) },
  { c: [-4.6, 6, 8.6], r: [3.1, 5.5, 3.6], R: I3 }, // pattes avant
  { c: [4.6, 6, 8.6], r: [3.1, 5.5, 3.6], R: I3 },
  { c: [-8.5, 3.6, 3], r: [4, 3.4, 7], R: I3 }, // pattes arrière
  { c: [8.5, 3.6, 3], r: [4, 3.4, 7], R: I3 },
  { c: [0, 8.5, -13.2], r: [4.2, 4.2, 4.2], R: I3 }, // queue
];
const KS = 2.6;
// version JS (semis des particules)
function sdObjJS(x, y, z) {
  let d = 1e9;
  for (const P of PRIMS) {
    const px = x - P.c[0], py = y - P.c[1], pz = z - P.c[2], R = P.R;
    const lx = (R[0][0] * px + R[0][1] * py + R[0][2] * pz), ly = (R[1][0] * px + R[1][1] * py + R[1][2] * pz), lz = (R[2][0] * px + R[2][1] * py + R[2][2] * pz);
    const k0 = Math.hypot(lx / P.r[0], ly / P.r[1], lz / P.r[2]), k1 = Math.hypot(lx / P.r[0] ** 2, ly / P.r[1] ** 2, lz / P.r[2] ** 2);
    const e = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...P.r);
    const h = Math.max(KS - Math.abs(d - e), 0) / KS;
    d = Math.min(d, e) - h * h * KS * 0.25;
  }
  // socle : cylindre arrondi
  const q0 = Math.hypot(x, z) - 12 + 0.8, q1 = Math.abs(y - 1.4) - 1.4 + 0.8;
  const e = Math.min(Math.max(q0, q1), 0) + Math.hypot(Math.max(q0, 0), Math.max(q1, 0)) - 0.8;
  const h = Math.max(1.6 - Math.abs(d - e), 0) / 1.6;
  return Math.min(d, e) - h * h * 1.6 * 0.25;
}
// version rendu : la distance cuite dans une texture 3D (demi-cellule), lue en trilinéaire
const SB = { min: [-19, -1, -21], size: [38, 64, 42], res: 2 };
const SN = SB.size.map((v) => v * SB.res);
const sdfData = new Uint16Array(SN[0] * SN[1] * SN[2]);
for (let z = 0; z < SN[2]; z++) for (let y = 0; y < SN[1]; y++) for (let x = 0; x < SN[0]; x++) {
  sdfData[x + SN[0] * (y + SN[1] * z)] = THREE.DataUtils.toHalfFloat(sdObjJS(SB.min[0] + (x + 0.5) / SB.res, SB.min[1] + (y + 0.5) / SB.res, SB.min[2] + (z + 0.5) / SB.res));
}
const sdfTex = new THREE.Data3DTexture(sdfData, SN[0], SN[1], SN[2]);
sdfTex.format = THREE.RedFormat; sdfTex.type = THREE.HalfFloatType; sdfTex.minFilter = sdfTex.magFilter = THREE.LinearFilter;
sdfTex.wrapS = sdfTex.wrapT = sdfTex.wrapR = THREE.ClampToEdgeWrapping; sdfTex.needsUpdate = true;
const tS = texture3D(sdfTex, null, 0);
const sdObj = (p) => {
  const q = p.sub(vec3(...SB.min)).div(vec3(...SB.size));
  // (hors de la boîte : la distance au bord s'ajoute à la valeur du bord)
  const out = length(max(abs(q.sub(0.5)).sub(0.5), 0).mul(vec3(...SB.size)));
  return tS.sample(clamp(q, 0, 1)).r.add(out);
};

// ── Le support : un plateau sur pied, au-dessus d'une cuvette (repère de la grille) ──
const col = (p) => {
  const r = length(p.xz.sub(vec2(O[0], O[2])));
  // plateau légèrement bombé
  const q = vec2(r.sub(14.5 - 0.6), abs(p.y.sub(O[1] - 1.5).add(r.mul(r).mul(0.003))).sub(1.5 - 0.6));
  const plate = min(max(q.x, q.y), 0).add(length(max(q, 0))).sub(0.6);
  const stem = max(r.sub(2.6), p.y.sub(O[1] - 1));
  const bowl = max(p.y.sub(r.mul(0.13).add(9)), r.sub(29.5)).mul(0.9);
  const rim = max(abs(r.sub(28.5)).sub(1), p.y.sub(16));
  return min(min(min(plate, stem), min(bowl, rim)), p.y.sub(0.5));
};

// ── Semis ──
const parts = [];
for (let z = 0.25; z < GZ; z += 0.5) for (let y = 0.25; y < GY; y += 0.5) for (let x = 0.25; x < GX; x += 0.5) {
  const ox = x - O[0], oy = y - O[1], oz = z - O[2];
  if (oy < 0.1 || oy > 62 || Math.abs(ox) > 16 || Math.abs(oz) > 20) continue;
  if (sdObjJS(ox, oy, oz) < 0) parts.push(x, y, z);
}
const N = parts.length / 3;
const PS = 40, pdata = new Float32Array(N * PS);
for (let i = 0; i < N; i++) {
  const x = parts[i * 3], y = parts[i * 3 + 1], z = parts[i * 3 + 2], o = i * PS;
  pdata[o] = x; pdata[o + 1] = y; pdata[o + 2] = z;
  pdata[o + 20] = 1; pdata[o + 25] = 1; pdata[o + 30] = 1; // b = I
  pdata[o + 32] = x; pdata[o + 33] = y; pdata[o + 34] = z;
  // pigment : veines dans la masse (repère de repos), emportées par l'écoulement
  const v = Math.sin(0.33 * y + 2.2 * Math.sin(0.17 * x + 1) + 1.7 * Math.sin(0.21 * z + 0.4) + 0.8 * Math.sin(0.5 * x + 0.3 * z));
  pdata[o + 36] = 0; pdata[o + 37] = Math.min(1, Math.max(0, (v - 0.55) * 4)); pdata[o + 38] = 1;
}

const particleStruct = struct({ position: { type: 'vec3' }, velocity: { type: 'vec3' }, C: { type: 'mat3' }, b: { type: 'mat3' }, rest: { type: 'vec3' }, misc: { type: 'vec4' } });
const PB = instancedArray(pdata, particleStruct);
const cellStruct = struct({ x: { type: 'int', atomic: true }, y: { type: 'int', atomic: true }, z: { type: 'int', atomic: true }, mass: { type: 'int', atomic: true }, heat: { type: 'int', atomic: true } });
const CB = instancedArray(NCELL, cellStruct);
const CV = instancedArray(NCELL, 'vec4'), CT = instancedArray(NCELL, 'float');
const SUP = [instancedArray(NCELL, 'float'), instancedArray(NCELL, 'float')]; // appui : la matière froide tient au support, de proche en proche
const rcellStruct = struct({ m: { type: 'int', atomic: true }, dx: { type: 'int', atomic: true }, dy: { type: 'int', atomic: true }, dz: { type: 'int', atomic: true }, s: { type: 'int', atomic: true }, t: { type: 'int', atomic: true }, c: { type: 'int', atomic: true } });
const RB = instancedArray(NCELL, rcellStruct);

// ── Réglages ──
const U = {
  dt: uniform(DT), g: uniform(+(Q.get('g') || 30)), K: uniform(8e3), mu: uniform(3e4), armed: uniform(0),
  etaL: uniform(150), etaS: uniform(150), relax: uniform(3), kc: uniform(+(Q.get('kc') || 0.02)), dbg: uniform(0), noCol: uniform(0),
  heat: uniform(+(Q.get('heat') || 2.2)), plate: uniform(+(Q.get('plate') || 0)), tPlate: uniform(1.25),
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
  T.addAssign(h.mul(U.plate).mul(smoothstep(2.2, 0.4, col(pos))).mul(max(U.tPlate.sub(T), 0)));
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
  const eta = U.etaL.mul(mix(1, 0.22, smoothstep(1, 1.6, T))).mul(sol.oneMinus()).add(U.etaS.mul(sol));
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
  If(dcol.lessThan(0), () => { v.assign(vec3(0)); });
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
  If(pos.y.lessThan(11.4).and(rr.lessThan(9)), () => { misc.z.assign(0); pos.assign(vec3(3, 3, 3)); });
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

// ── Image : un seul lancer de rayons (cire, support, sol) ──
const cam = { pos: uniform(new THREE.Vector3()), r: uniform(new THREE.Vector3()), u: uniform(new THREE.Vector3()), f: uniform(new THREE.Vector3()), th: uniform(0.27), asp: uniform(W / H) };
const tA = texture3D(texA, null, 0), tB = texture3D(texB, null, 0);
const Gv = vec3(GX, GY, GZ), Ov = vec3(...O);
// A = (Σ ms·d, ms) : la part solide et son déplacement ; B = (ml, Σ m·T, Σ m·c) : la part liquide
// surface = objet d'origine déplacé, rogné là où le solide a disparu, réuni (en douceur) au liquide
const ISO_S = 0.8, ISO_L = 0.9, KF = 0.3, KU = 0.9;
const parts2 = (p) => {
  const uvw = p.div(Gv);
  const A = tA.sample(uvw), Bq = tB.sample(uvw);
  const ms = A.w, d = A.xyz.div(ms.max(1e-3));
  // (rogné là où le liquide a pris la place du solide ; vide là où il n'y a plus de solide du tout)
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
const env = (d) => {
  const bg = mix(vec3(0.012, 0.012, 0.014), vec3(0.075, 0.068, 0.062), smoothstep(-0.3, 0.9, d.y));
  const k = smoothstep(0.83, 0.93, dot(d, vec3(LK.x, LK.y, LK.z))).mul(7);
  const r = smoothstep(0.9, 0.955, dot(d, vec3(LR.x, LR.y, LR.z))).mul(5);
  const s = smoothstep(0.93, 0.97, dot(d, normalize(vec3(0.85, 0.25, 0.45)))).mul(2);
  return bg.add(vec3(1, 0.93, 0.84).mul(k)).add(vec3(1, 0.8, 0.6).mul(r)).add(vec3(0.75, 0.85, 1).mul(s));
};
// épaisseur de matière traversée vers une lampe (ombre propre et translucidité)
const thick = Fn(([p, L]) => {
  const t = float(0).toVar();
  Loop(9, ({ i }) => {
    const q = p.add(L.mul(float(i).add(0.5).mul(2.4)));
    const uvw = q.div(Gv);
    const m = tA.sample(uvw).w.add(tB.sample(uvw).x);
    t.addAssign(smoothstep(1.2, 5.5, m).mul(2.4).mul(select(inBox(q), float(1), float(0))));
    t.addAssign(smoothstep(0.3, -0.3, col(q)).mul(30));
  });
  return t;
});
const image = Fn(() => {
  const ndc = screenUV.mul(2).sub(1);
  const rd = normalize(cam.f.add(cam.r.mul(ndc.x.mul(cam.th).mul(cam.asp))).add(cam.u.mul(ndc.y.negate().mul(cam.th))));
  const ro = cam.pos;
  // support et sol : tracé de sphères analytique
  const tc = float(0).toVar(), hitC = float(0).toVar();
  If(U.noCol.lessThan(0.5), () => { Loop(110, () => {
    const d = col(ro.add(rd.mul(tc)));
    If(d.lessThan(0.02), () => { hitC.assign(1); Break(); });
    tc.addAssign(d.max(0.05));
    If(tc.greaterThan(600), () => { Break(); });
  }); });
  // cire : marche dans la boîte de la grille
  const inv = vec3(1).div(rd);
  const t0 = vec3(1).sub(ro).mul(inv), t1 = Gv.sub(1).sub(ro).mul(inv);
  const tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z)).max(0), tf = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  const tw = tn.toVar(), hitW = float(0).toVar();
  const tEnd = select(hitC.greaterThan(0.5), min(tf, tc), tf);
  If(tf.greaterThan(tn), () => {
    Loop(220, () => {
      If(tw.greaterThan(tEnd), () => { Break(); });
      const d = waxPhi(ro.add(rd.mul(tw)));
      If(d.lessThan(0.02), () => { hitW.assign(1); Break(); });
      tw.addAssign(clamp(d.mul(0.75), 0.1, 1.4));
    });
  });
  // (point d'impact affiné : l'ombre propre et la normale ne dépendent plus du pas de la marche)
  If(hitW.greaterThan(0.5), () => { Loop(3, () => { tw.addAssign(waxPhi(ro.add(rd.mul(tw))).mul(0.9)); }); });
  const colr = env(rd).mul(0.35).toVar();
  const Lk = vec3(LK.x, LK.y, LK.z), Lr = vec3(LR.x, LR.y, LR.z);
  const IK = vec3(1, 0.93, 0.84).mul(0.95), IR = vec3(1, 0.78, 0.58).mul(1.25);
  If(hitW.greaterThan(0.5), () => {
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
    const wet = smoothstep(0.55, 0.95, T); // la peau luit avant de couler
    const albedo = mix(vec3(0.78, 0.2, 0.24), vec3(0.9, 0.8, 0.66), smoothstep(0.25, 0.75, pig)).mul(mix(1, 0.72, liq)).toConst();
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
    const fres = pow(float(1).sub(max(dot(n, v), 0)), 5).mul(0.96).add(0.04);
    const gloss = mix(0.25, 1, max(wet, liq));
    const c = lit(Lk, IK).add(lit(Lr, IR)).add(albedo.mul(0.05).mul(n.y.mul(0.5).add(0.6))).add(env(reflect(rd, n)).mul(fres).mul(gloss));
    colr.assign(c);
    If(U.dbg.greaterThan(1.5), () => { colr.assign(n.mul(0.5).add(0.5)); });
    If(U.dbg.greaterThan(2.5), () => { colr.assign(vec3(thick(p.add(n.mul(0.5)), Lk).mul(0.05), thick(p.add(n.mul(0.5)), Lr).mul(0.05), Fs.A.w.mul(0.1))); });
  }).ElseIf(hitC.greaterThan(0.5), () => {
    const p = ro.add(rd.mul(tc)).toConst();
    const e = 0.05;
    const n = normalize(vec3(col(p.add(vec3(e, 0, 0))).sub(col(p.sub(vec3(e, 0, 0)))), col(p.add(vec3(0, e, 0))).sub(col(p.sub(vec3(0, e, 0)))), col(p.add(vec3(0, 0, e))).sub(col(p.sub(vec3(0, 0, e))))));
    const th = thick(p.add(n.mul(0.6)), Lk), thr = thick(p.add(n.mul(0.6)), Lr);
    const F0 = vec3(0.93, 0.6, 0.47);
    const sh = exp(th.mul(-0.5)), shr = exp(thr.mul(-0.5));
    const refl = env(reflect(rd, n));
    const c = F0.mul(refl).mul(0.55).mul(sh.mul(0.6).add(0.4))
      .add(F0.mul(0.16).mul(IK.mul(max(dot(n, Lk), 0)).mul(sh).add(IR.mul(max(dot(n, Lr), 0)).mul(shr))));
    // le sol : mat et sombre, il ne garde que les ombres et une flaque de lumière
    const rg = length(p.xz.sub(vec2(O[0], O[2])));
    const g = vec3(0.055, 0.05, 0.048).mul(IK.mul(max(dot(n, Lk), 0)).mul(sh).add(IR.mul(max(dot(n, Lr), 0)).mul(shr)).mul(0.5).add(0.06)).mul(smoothstep(260, 60, rg));
    colr.assign(select(p.y.lessThan(0.7), g, c));
  });
  If(U.dbg.greaterThan(0.5).and(U.dbg.lessThan(1.5)), () => { colr.assign(vec3(hitW, hitC, tn.div(400))); });
  // ACES (Narkowicz) puis sRGB, dans le shader : l'image part telle quelle au collecteur
  const x = colr.mul(0.85);
  const tm = clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0, 1);
  return vec4(pow(tm, vec3(1 / 2.2)), 1);
});

// ── Moteur ──
const hud = document.getElementById('hud');
const renderer = new THREE.WebGPURenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
document.body.appendChild(renderer.domElement);
await renderer.init();
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const mat = new THREE.MeshBasicNodeMaterial();
mat.colorNode = image();
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
quad.frustumCulled = false;
scene.add(quad);

function setCam(az = 0.4, el = 0.13, dist = 132, tgt = [32, 55, 32], fov = 30) {
  const p = new THREE.Vector3(tgt[0] + Math.sin(az) * Math.cos(el) * dist, tgt[1] + Math.sin(el) * dist, tgt[2] + Math.cos(az) * Math.cos(el) * dist);
  const f = new THREE.Vector3(...tgt).sub(p).normalize(), r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize(), u = new THREE.Vector3().crossVectors(r, f);
  cam.pos.value.copy(p); cam.f.value.copy(f); cam.r.value.copy(r); cam.u.value.copy(u); cam.th.value = Math.tan((fov * Math.PI) / 360);
}
setCam();

const PRE = [kPinUpdate, kPinClear, kPinSplat], SIMS = [[kP2G, kGridV[0], kG2P], [kP2G, kGridV[1], kG2P]], SIM = SIMS[0], REN = [kRClear, kRSplat, kResolve];
let frame = 0, step = 0;
const errors = [];
const oe = console.error; console.error = (...a) => { oe(...a); errors.push(String(a[0]).slice(0, 500)); };
async function advance(n = 1) {
  for (let i = 0; i < n; i++) {
    renderer.compute(PRE);
    for (let s = 0; s < SUB; s++) renderer.compute(SIMS[(step++) & 1]);
    frame++;
    if (step > 160) U.armed.value = 1;
    if (i % 8 === 7) await renderer.backend.device.queue.onSubmittedWorkDone();
  }
}
let pinDrawn = -99;
function draw() {
  if (frame - pinDrawn >= 4) { renderer.compute([kRPinClear, kRPinSplat]); pinDrawn = frame; }
  renderer.compute(REN);
  renderer.render(scene, camera);
  hud.textContent = `image ${frame} · ${N} particules · ${SUB} sous-pas`;
}
async function send(name, url = `http://127.0.0.1:${Q.get('sink') || 8098}/`) {
  draw();
  const rt = new THREE.RenderTarget(W, H, { type: THREE.UnsignedByteType, colorSpace: THREE.LinearSRGBColorSpace });
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
// lit quelques particules (mise au point)
async function probe() {
  const a = new Float32Array(await renderer.getArrayBufferAsync(PB.value));
  let dyn = 0, alive = 0, tmax = 0, tsum = 0, ymax = 0, bad = 0, vmax = 0, ymin = 1e9, ysum = 0, bmax = 0, rmax = 0;
  for (let i = 0; i < N; i++) {
    const o = i * PS;
    if (a[o + 38] < 0.5) continue;
    alive++; dyn += a[o + 39]; tmax = Math.max(tmax, a[o + 36]); tsum += a[o + 36]; ymax = Math.max(ymax, a[o + 1]);
    vmax = Math.max(vmax, Math.hypot(a[o + 4], a[o + 5], a[o + 6]));
    if (!(a[o] === a[o])) bad++;
    ymin = Math.min(ymin, a[o + 1]); ysum += a[o + 1]; bmax = Math.max(bmax, Math.abs(a[o + 20] - 1), Math.abs(a[o + 25] - 1), Math.abs(a[o + 21]));
    rmax = Math.max(rmax, Math.hypot(a[o] - O[0], a[o + 2] - O[2]));
  }
  return { dyn, ymin: +ymin.toFixed(2), ymean: +(ysum / Math.max(1, alive)).toFixed(2), bmax: +bmax.toFixed(4), rmax: +rmax.toFixed(1), N, alive, tmax: +tmax.toFixed(3), tmean: +(tsum / Math.max(1, alive)).toFixed(3), ymax: +ymax.toFixed(2), vmax: +vmax.toFixed(2), bad, frame };
}
window.h0 = { PRE, SIMS, SIM, REN, scene, camera, renderer, U, advance, draw, send, setCam, probe, errors, N, get frame() { return frame; } };
draw();
if (Q.has('play')) renderer.setAnimationLoop(async () => { await advance(1); draw(); });
window.h0.seq = async (n, k, prefix = 'q') => { window.h0.done = 0; for (let i = 0; i <= n; i += k) { await send(`${prefix}-${String(frame).padStart(4, '0')}.jpg`); if (i < n) await advance(k); window.h0.done = i; } window.h0.done = 'ok'; };
window.h0.ready = true;
