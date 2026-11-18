// La fonte : MLS-MPM sur GPU (d'après l'exemple three.js
// webgpu_compute_particles_fluid, lui-même d'après WebGPU-Ocean), étendu.
//
// - Chaque particule porte une température T (1 = point de fusion), chauffée à
//   sa surface par la source, par la cuvette tenue chaude, et conduite par la
//   grille.
// - Solide viscoélastique de Maxwell : contrainte élastique μ·dev(b̄) sur le
//   tenseur de Cauchy-Green gauche b, relâché vers l'isotrope d'autant plus
//   vite que la matière est chaude (froid : solide ; tiède : fluage ; chaud :
//   liquide visqueux). Pression par équation d'état sur la densité de grille.
// - La matière froide et soutenue est FIGÉE : elle ne coûte qu'un dépôt par
//   image. Une cellule de matière figée « tient » si elle touche le plateau ou
//   une voisine qui tient ; ce qui ne tient plus, ou ramollit, devient libre.
// - Les sommes sur la grille sont des entiers atomiques en virgule fixe :
//   l'ordre des particules ne change pas le résultat, la simulation est donc
//   reproductible image pour image (la boucle et l'export en dépendent).
// - Rendu : dépôt du déplacement d = x − X0 de la part solide, de la part
//   liquide, de la température et du pigment dans deux textures 3D.
//
// La grille est attachée au plateau qui porte la cire (repère : cellules).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, instancedArray, instanceIndex, uniform, float, int, ivec3, vec2, vec3, vec4, mat3, array, struct,
  atomicStore, atomicAdd, atomicLoad, max, min, pow, clamp, mix, smoothstep, length, normalize, dot, cross, abs, exp, select, textureStore,
} from 'three/tsl';

export const GX = 64, GY = 128, GZ = 64, NCELL = GX * GY * GZ;
export const O = [32, 54, 32]; // dessus de l'assiette, au centre
export const PBASE = 26; // dessous de la cuvette : l'origine du plateau
export const CELL = 0.02; // une cellule, en unités du monde
export const PS = 40; // flottants par particule (position, vitesse, C, b, repos, divers)
export const SUB = 4; // sous-pas par image de simulation (1/60 s)
export const SEED_H = 0.6; // pas du semis des particules (cellules)
export const RH = 1 / (8 * SEED_H ** 3); // densité de particules, rapportée à huit par cellule
const DT = 1 / (60 * SUB), RHO0 = 8 * RH, FM = 1e5, FV = 1e4, WG = 64;

// Le plateau (repère de la grille) : une assiette sur trois colonnettes, au-dessus
// d'une cuvette en entonnoir percée d'une buse. (Les colonnettes, trop fines pour
// la grille, ne sont que dessinées.) Les pièces dessinées suivent ces cotes.
export const PALLET = { plateR: 14.5, bowlR: 29.5, rimH: 15, holeR: 9, floor0: 3, slope: 0.2, nozzle: 6 };
export const col = (p) => {
  const r = length(p.xz.sub(vec2(O[0], O[2])));
  const q = vec2(r.sub(PALLET.plateR - 0.6), abs(p.y.sub(O[1] - 1.5).add(r.mul(r).mul(0.003))).sub(1.5 - 0.6));
  const plate = min(max(q.x, q.y), 0).add(length(max(q, 0))).sub(0.6);
  const bowl = max(max(p.y.sub(r.mul(PALLET.slope).add(PBASE + PALLET.floor0)), float(PALLET.holeR).sub(r)), max(r.sub(PALLET.bowlR), float(PBASE - 2).sub(p.y))).mul(0.9);
  const rim = max(max(abs(r.sub(PALLET.bowlR - 1)).sub(1), p.y.sub(PBASE + PALLET.rimH)), float(PBASE - 2).sub(p.y));
  const nozzle = max(abs(r.sub(PALLET.holeR + 0.6)).sub(0.6), abs(p.y.sub(PBASE - 3)).sub(3));
  return min(min(plate, nozzle), min(bowl, rim));
};

// N : nombre de particules (fixe : tous les objets d'une usine ont le même volume)
export function createSim(renderer, N) {
  const particleStruct = struct({ position: { type: 'vec3' }, velocity: { type: 'vec3' }, C: { type: 'mat3' }, b: { type: 'mat3' }, rest: { type: 'vec3' }, misc: { type: 'vec4' } });
  const PB = instancedArray(new Float32Array(N * PS), particleStruct);
  const cellStruct = struct({ x: { type: 'int', atomic: true }, y: { type: 'int', atomic: true }, z: { type: 'int', atomic: true }, mass: { type: 'int', atomic: true }, heat: { type: 'int', atomic: true } });
  const CB = instancedArray(NCELL, cellStruct);
  const CV = instancedArray(NCELL, 'vec4'), CT = instancedArray(NCELL, 'float');
  const SUP = [instancedArray(NCELL, 'float'), instancedArray(NCELL, 'float')]; // appui : la matière froide tient au support, de proche en proche
  const rcellStruct = struct({ m: { type: 'int', atomic: true }, dx: { type: 'int', atomic: true }, dy: { type: 'int', atomic: true }, dz: { type: 'int', atomic: true }, s: { type: 'int', atomic: true }, t: { type: 'int', atomic: true }, c: { type: 'int', atomic: true } });
  const RB = instancedArray(NCELL, rcellStruct);
  const DRAIN = instancedArray(4, struct({ n: { type: 'int', atomic: true } }));
  const kDrainClear = Fn(() => { atomicStore(DRAIN.element(instanceIndex).get('n'), 0); })().compute(4).setName('drainClear'); // particules passées par la buse

  // ── Réglages (uniformes : rien ne recompile) ──
    const U = {
      dt: uniform(DT), g: uniform(56), K: uniform(8e3 * RH), mu: uniform(3e4 * RH), armed: uniform(0),
      etaL: uniform(150 * RH), etaS: uniform(150 * RH), relax: uniform(3), kc: uniform(0.032),
      heat: uniform(0), heatDir: uniform(new THREE.Vector3(0, 1, 0)), heatFlat: uniform(0.25), band: uniform(new THREE.Vector2(0, 0)),
      plate: uniform(4), tPlate: uniform(1.9), plateHot: uniform(0), sweep: uniform(0),
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

  // chaleur d'une particule pendant la durée h : conduction (kcond), lampe sur la peau, plaque
  const heatUp = (T, pos, rho, grad, tm, h, kcond) => {
    T.addAssign(tm.div(rho.max(1e-3)).sub(T).mul(kcond));
    const skin = smoothstep(RHO0 * 0.86, RHO0 * 0.5, rho).mul(smoothstep(0.02, 0.2, rho)); // (pas de peau sans grille : première image)
    const gl = length(grad);
    const nrm = select(gl.greaterThan(1e-3), grad.div(gl.max(1e-3)).negate(), vec3(0, 1, 0));
    // (la source : une direction, une part reçue de partout, et parfois une ceinture à une hauteur donnée)
    const by = pos.y.sub(O[1]).sub(U.band.x).div(U.band.y.max(0.5));
    const lamp = max(dot(nrm, U.heatDir), 0).mul(U.heatFlat.oneMinus()).add(U.heatFlat).mul(mix(float(1), max(exp(by.mul(by).negate()), smoothstep(0, 1, by).mul(0.8)).mul(2.2).add(0.1), smoothstep(0, 0.5, U.band.y))); // (au-dessus de la ceinture, l'air chaud monte : ce qu'elle a dépassé reste chaud)
    T.addAssign(h.mul(U.heat).mul(skin).mul(lamp));
    // (la cuvette est tenue chaude ; l'assiette ne chauffe qu'à la fin, pour rendre les derniers restes)
    const lowM = smoothstep(PBASE + 14, PBASE + 11, pos.y);
    T.addAssign(h.mul(U.plate).mul(mix(smoothstep(3.5, 0.5, col(pos)).mul(U.plateHot), float(1), lowM)).mul(max(U.tPlate.sub(T), 0))); // (tout ce qui est dans la cuvette chauffe : un morceau tombé froid y fond)
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
    If(T.greaterThan(0.86).or(U.armed.greaterThan(0.5).and(held.lessThan(0.002))), () => { misc.w.assign(1); });
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
    const vol = float(1).div(density.max(3 * RH));
    const T = misc.x, sol = solidOf(T);
    const pressure = max(0, pow(density.div(RHO0), 3).sub(1).mul(U.K));
    const stress = mat3(pressure.negate(), 0, 0, 0, pressure.negate(), 0, 0, 0, pressure.negate()).toVar();
    // élasticité : μ · dev(b̄), au volume de repos (la peau n'est pas plus raide que le cœur)
    const b = P.get('b').toConst();
    const c0 = b.mul(vec3(1, 0, 0)), c1 = b.mul(vec3(0, 1, 0)), c2 = b.mul(vec3(0, 0, 1));
    const J2 = dot(c0, cross(c1, c2)).max(1e-4);
    const sc = pow(J2, -1 / 3);
    const tr = c0.x.add(c1.y).add(c2.z).mul(sc).div(3);
    stress.addAssign(b.mul(sc).sub(I().mul(tr)).mul(U.mu.mul(sol)).mul(density.max(3 * RH).div(RHO0)));
    // viscosité : le liquide file d'autant mieux qu'il est chaud ; le solide est amorti
    const eta = U.etaL.mul(mix(1, 0.07, smoothstep(1, 1.6, T))).mul(sol.oneMinus()).add(U.etaS.mul(sol));
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
    // (l'appui vaut 1 au contact du plateau et perd 1/80 par cellule en s'en éloignant : un morceau froid
    //  coupé du plateau ne se soutient pas lui-même, son appui tombe à zéro en moins d'un tiers de seconde)
    Snext.element(instanceIndex).assign(select(pinM.greaterThan(0.6 * RH), select(dcol.lessThan(1.8), float(1), max(nb.sub(1 / 80), 0)), float(0)));
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
    // (les dernières gouttes : la cuvette s'égoutte vers sa buse, chaleur coupée)
    const toHole = pos.xz.sub(vec2(O[0], O[2]));
    const lowB = smoothstep(PBASE + 13, PBASE + 10, pos.y);
    v.xz.subAssign(toHole.div(length(toHole).max(0.5)).mul(U.sweep.mul(U.dt)).mul(lowB));
    v.assign(v.mul(min(float(1), float(70).div(length(v).max(1e-3)))));
    pos.addAssign(v.mul(U.dt));
    pos.assign(clamp(pos, vec3(2.01), vec3(GX - 2.01, GY - 2.01, GZ - 2.01)));
    // (garde-fou : une goutte projetée ne sort pas de la cuvette)
    const rOut = length(pos.xz.sub(vec2(O[0], O[2])));
    If(rOut.greaterThan(PALLET.bowlR - 2.2).and(pos.y.lessThan(PBASE + PALLET.rimH + 10)), () => {
      const dirR = pos.xz.sub(vec2(O[0], O[2])).div(rOut);
      pos.xz.assign(vec2(O[0], O[2]).add(dirR.mul(PALLET.bowlR - 2.2)));
      v.xz.subAssign(dirR.mul(max(dot(v.xz, dirR), 0)));
    });
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


  const PRE = [kPinUpdate, kPinClear, kPinSplat], SIMS = [[kP2G, kGridV[0], kG2P], [kP2G, kGridV[1], kG2P]];
  let step = 0, frames = 0, pinDrawn = -99, drained = 0, reading = false;

  // un objet neuf : `data` est le tableau des particules (N × PS flottants)
  function load(data) {
    PB.value.array.set(data);
    PB.value.needsUpdate = true;
    step = 0; frames = 0; pinDrawn = -99; drained = 0;
    U.armed.value = 0;
    renderer.compute(kDrainClear);
  }
  // une image de simulation (1/60 s)
  function advance() {
    renderer.compute(PRE);
    for (let s = 0; s < SUB; s++) renderer.compute(SIMS[(step++) & 1]);
    frames++;
    if (step > 160) U.armed.value = 1;
    if (frames % 6 === 0 && !reading) {
      reading = true; const f = frames;
      renderer.getArrayBufferAsync(DRAIN.value).then((b) => { if (frames >= f) drained = new Int32Array(b)[0]; reading = false; }, () => { reading = false; });
    }
  }
  // (tant que tout est froid et figé, rien ne change : on saute des images, les appuis une fois posés)
  function skipTo(f) { if (f > frames) frames = f; }
  // champs de rendu à jour (une fois par image dessinée)
  function resolve() {
    if (frames - pinDrawn >= 4 || frames < pinDrawn) { renderer.compute([kRPinClear, kRPinSplat]); pinDrawn = frames; }
    renderer.compute([kRClear, kRSplat, kResolve]);
  }
  return {
    N, U, texA, texB, load, advance, resolve, skipTo,
    frames: () => frames, drained: () => drained, particles: PB,
    kernels: [...PRE, ...SIMS[0], SIMS[1][1], kRPinClear, kRPinSplat, kRClear, kRSplat, kResolve],
  };
}
