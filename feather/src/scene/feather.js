// Les plumes à l'écran : barbes instanciées (un ruban à arête par barbe), rachis,
// gaine et écailles de gaine. La pose de chaque point est calculée dans le
// vertex shader par la formule de gen/feather.js (barbPose), recopiée ici en
// TSL ; un test vérifie le JS, ce module le reproduit à l'identique.
//
// Pas d'InstancedMesh (un shader par objet) : un Mesh ordinaire dont la
// géométrie porte, par barbe, quatre vec4 dans un seul tampon entrelacé.
// L'état de chaque plume (repère, temps local, usure, courbure) tient dans un
// tableau d'uniformes mis à jour à chaque image ; un second tableau garde
// l'état de l'image précédente (vecteurs vitesse de l'anticrénelage temporel).
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, positionLocal, normalLocal, positionPrevious, vec2, vec3, vec4, float, int, dot, normalize, mix,
  abs, uniform, uniformArray, texture, clamp, pow, sin, cos, exp, max as tmax, min as tmin, select, cross, normalViewGeometry,
  varyingProperty, hash, fract, length, positionGeometry, frameId, step, fwidth,
} from 'three/tsl';
import { isLite, stableVelocity, perturb } from './materials.js';
import { G } from './globals.js';
import { SCHED, BARB_STRIDE } from '../gen/feather.js';

const sst = (a, b, x) => { const t = clamp(x.sub(a).div(float(b).sub(a)), 0, 1); return t.mul(t).mul(t.mul(-2).add(3)); };
const smootherT = (a, b, x) => { const t = clamp(x.sub(a).div(b - a), 0, 1); return t.mul(t).mul(t).mul(t.mul(t.mul(6).sub(15)).add(10)); };
const safeK = (k) => select(k.lessThan(0), tmin(k, float(-1e-4)), tmax(k, float(1e-4)));
const qrot = (q, v) => { const t = cross(q.xyz, v).mul(2); return v.add(t.mul(q.w)).add(cross(q.xyz, t)); };

// ── Le calendrier (gen/feather.js, SCHED) ────────────────────────────────────
const growthT = (u, L) => {
  const gp = tmin(float(0.3), float(SCHED.pushLen).div(L));
  return gp.mul(smootherT(SCHED.push[0], SCHED.push[1], u)).add(float(1).sub(gp).mul(smootherT(SCHED.grow[0], SCHED.grow[1], u)));
};
const sinkT = (u, L, cal, over) => mix(L.mul(over), cal.mul(0.85).mul(L), growthT(u, L));
const releaseAtT = (s) => float(SCHED.front[0]).add(float(1).sub(clamp(s, 0, 1)).mul(SCHED.front[1] - SCHED.front[0]));
const elasticT = (x) => { const y = tmax(x, 0); return float(1).sub(exp(y.mul(-4)).mul(cos(y.mul(5)).add(sin(y.mul(5)).mul(0.8)))); };
const unrollT = (u, s) => elasticT(u.sub(releaseAtT(s)).div(SCHED.open));
const releasedT = (u, s) => sst(0, 0.012, u.sub(releaseAtT(s)));
const zipAtT = (u, s, sn) => sst(0, 1, u.sub(releaseAtT(s)).sub(SCHED.zipLag).sub(sn.mul(SCHED.zipW)).div(SCHED.zipDur));
const bendAtT = (u) => smootherT(SCHED.bend[0], SCHED.bend[1], u);
const barbArcT = (alpha, curl, l) => {
  const c = select(abs(curl).lessThan(1e-4), float(1e-4), curl);
  return vec2(cos(alpha.sub(c.mul(l))).sub(cos(alpha)).div(c), sin(alpha).sub(sin(alpha.sub(c.mul(l)))).div(c));
};

// état d'une plume dans le tableau (4 vec4 : repère, quaternion, temps, forme)
export const FSTRIDE = 4;
const stOf = (A, f) => {
  const i = int(f.add(0.5)).mul(FSTRIDE);
  return { P: A.element(i), Q: A.element(i.add(1)), T: A.element(i.add(2)), K: A.element(i.add(3)) };
};

// La pose (gen/feather.js, barbPose). b0..b3 : la barbe ; tv : (t, v, arête) ;
// st : l'état de sa plume ; FU : uniformes de la famille.
function barbPoseT(b0, b1, b2, b3, tv, st, FU, ridgeK = 0.7) {
  const s0 = b0.x, side = b0.y, ell = b0.z, alpha0 = b0.w;
  const curl0 = b1.x, rho0 = b1.y, rho1 = b1.z, plum = b1.w;
  const rnd = b2.y, width = b2.z, zipF = b2.w;
  const droop = b3.x, spread = b3.y, wave = b3.z, wearAmt = b3.w;
  const t = tv.x, v = tv.y, ridge = tv.z;
  const u = st.T.x, wear = st.T.y, L = FU.L, radial = FU.radial;
  const ellE = ell.mul(float(1).sub(wear.mul(wearAmt).mul(0.45)));
  const l = t.mul(ellE);
  const hMid = barbArcT(alpha0, curl0, ellE.mul(0.5)).y;
  const sP = clamp(s0.add(hMid.div(L)), 0, 1);
  const lam = unrollT(u, sP);
  const rel = releasedT(u, sP);
  const split = select(rnd.lessThan(0.1), float(0.85), float(0));
  const zip = zipF.mul(zipAtT(u, sP, t)).mul(float(1).sub(wear.mul(split)));
  const alpha = mix(alpha0.add(float(1).sub(zip).mul(rel).mul(spread).mul(rnd.sub(0.35).mul(2))), alpha0.mul(lam), radial);
  const curl = mix(curl0, curl0.mul(lam), radial);
  const A = barbArcT(alpha, curl, l);
  const ph = alpha.sub(curl.mul(l));
  const half = width.mul(0.5).mul(float(1).sub(t.mul(0.3)).sub(sst(0.7, 1, t).mul(0.4)));
  const sg = A.x.add(v.mul(half).mul(cos(ph).negate()));
  const hy = A.y.add(v.mul(half).mul(sin(ph)));
  const y = s0.mul(L).add(hy);
  // tranche roulée (vexille) ou étoile (duvet)
  const rho = mix(rho0, rho1, t);
  const kap = safeK(float(1).sub(lam).div(tmax(rho, 1e-3)));
  const a = kap.mul(sg);
  const xr = side.mul(sin(a)).div(kap), zr = cos(a).sub(1).div(kap).add(rho.mul(float(1).sub(lam)));
  const cphi = cos(side), sphi = sin(side), rr = rho0.add(sg);
  const x = mix(xr, cphi.mul(rr), radial), z = mix(zr, sphi.mul(rr), radial);
  const nx = mix(side.mul(sin(a)), cphi, radial), nz = mix(cos(a), sphi, radial);
  const tx = mix(side.mul(cos(a)), cphi, radial), tz = mix(sin(a).negate(), sphi, radial);
  // arête, ondulation des barbes libres, affaissement des barbes lourdes
  const free = float(1).sub(zip).mul(rel);
  const w = wave.mul(free).mul(sin(t.mul(Math.PI))).mul(sin(t.mul(plum.mul(9).add(9)).add(rnd.mul(20))));
  const off = ridge.mul(0.012).add(w);
  const gl = qrot(vec4(st.Q.xyz.negate(), st.Q.w), vec3(0, -1, 0)); // (pesanteur dans le repère de la plume)
  const sag = droop.mul(l).mul(l).mul(free);
  const px = x.add(nx.mul(off)).add(gl.x.mul(sag));
  const py = y.add(gl.y.mul(sag));
  const pz = z.add(nz.mul(off)).add(tmax(gl.z, mix(float(-0.6), float(-0.03), smootherT(SCHED.settle[0], SCHED.settle[1], u))).mul(sag));
  // croissance, puis courbure du rachis
  const yy = py.sub(sinkT(u, L, FU.calamus, FU.over));
  const k = safeK(st.K.x.mul(bendAtT(u)));
  const yc = tmax(yy, 0);
  const Ny = sin(k.mul(yc)), Nz = cos(k.mul(yc));
  let p = vec3(px, Ny.div(k).add(Ny.mul(pz)), Nz.sub(1).div(k).add(Nz.mul(pz)));
  const tilt = v.negate().mul(ridgeK).mul(ridge.add(0.4));
  const cx = nx.add(tilt.mul(tx)), cz = nz.add(tilt.mul(tz));
  const n = normalize(vec3(cx, Ny.mul(cz), Nz.mul(cz)));
  // caché (dans le follicule, ou plume masquée) : replié au follicule
  const hide = yy.lessThan(0).or(st.T.w.lessThan(0.5));
  p = select(hide, vec3(0, -0.05, 0), p);
  const world = st.P.xyz.add(qrot(st.Q, p.mul(st.P.w)));
  const nw = qrot(st.Q, n);
  const patx = clamp(side.mul(sg).div(tmax(rho, 1e-3).mul(Math.PI)), -1, 1).mul(float(1).sub(radial));
  return { world, nw, pat: vec2(patx, clamp(y.div(L), 0, 1)), zip, free, hide };
}

// ── Les barbes ───────────────────────────────────────────────────────────────
// Gabarit d'un ruban : n segments le long, 3 sommets en travers (bord, arête,
// bord). position = (t, v, arête)
export function ribbonTemplate(n) {
  const pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pos.push(t, -1, 0, t, 0, 1, t, 1, 0);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 3;
    idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
  }
  return { position: new Float32Array(pos), index: idx };
}

export function barbGeometry(table, segs) {
  const tpl = ribbonTemplate(segs);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(tpl.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(tpl.position.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setIndex(tpl.index);
  const ib = new THREE.InstancedInterleavedBuffer(table, BARB_STRIDE, 1);
  ['b0', 'b1', 'b2', 'b3'].forEach((k, q) => g.setAttribute(k, new THREE.InterleavedBufferAttribute(ib, 4, 4 * q)));
  g.instanceCount = table.length / BARB_STRIDE;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}

// Uniformes d'aspect (l'oiseau) : partagés par toutes les plumes de la scène
export function createLook() {
  return {
    base: uniform(new THREE.Color()), mark: uniform(new THREE.Color()), down: uniform(new THREE.Color()),
    rachis: uniform(new THREE.Color()), sheath: uniform(new THREE.Color()),
    eye0: uniform(new THREE.Color()), eye1: uniform(new THREE.Color()), eye2: uniform(new THREE.Color()), eye3: uniform(new THREE.Color()), eye4: uniform(new THREE.Color()),
    irid: uniform(0), iridLo: uniform(400), iridHi: uniform(500), blue: uniform(0), sheen: uniform(0.5),
    translucency: uniform(1), bleach: uniform(0.18),
  };
}

// barbs : le maillage des barbes d'un ensemble de plumes (héroïnes ou voisines).
// FS, FSP : états courant et précédent ; FU : famille ; LK : aspect ;
// PAT : texture du motif ; moving : calcule la pose de l'image précédente
export function barbMaterial({ FS, FSP, FU, LK, PAT, moving }) {
  const lite = isLite();
  const m = new THREE.MeshSSSNodeMaterial({ side: THREE.DoubleSide });
  const vA = varyingProperty('vec4', 'vA'); // (motif x, motif z, t, v)
  const vB = varyingProperty('vec4', 'vB'); // (agrafé, duveteux, usure, tirage)
  const pose = (full) => Fn(() => {
    const b0 = attribute('b0', 'vec4'), b1 = attribute('b1', 'vec4'), b2 = attribute('b2', 'vec4'), b3 = attribute('b3', 'vec4');
    const tv = positionGeometry;
    const st = stOf(FS, b2.x);
    const P = barbPoseT(b0, b1, b2, b3, tv, st, FU, moving ? 0.45 : 0.2); // (voisines : un ruban vaut plusieurs barbes, arête adoucie)
    if (full) {
      normalLocal.assign(P.nw);
      vA.assign(vec4(P.pat, tv.x, tv.y));
      vB.assign(vec4(P.zip, b1.w, st.T.y, b2.y));
      if (!lite) {
        positionPrevious.assign(moving ? barbPoseT(b0, b1, b2, b3, tv, stOf(FSP, b2.x), FU, 0.45).world : P.world);
      }
    }
    return P.world;
  })();
  m.positionNode = pose(true);
  m.castShadowPositionNode = pose(false);

  const patx = vA.x, patz = vA.y, t = vA.z, v = vA.w;
  const zip = vB.x, plum = vB.y, wear = vB.z, rnd = vB.w;
  // le motif, lu dans le plan déroulé (texture : R motif, G ocelle / liseré, B structural, A blanc)
  const T = texture(PAT, vec2(patx.mul(0.5).add(0.5), patz)).level(0);
  let col = mix(LK.base, LK.mark, T.r);
  // ocelle : anneaux du centre vers le bord
  const e = T.g;
  const eyeCol = mix(mix(mix(mix(LK.eye4, LK.eye3, sst(0.02, 0.1, e)), LK.eye2, sst(0.22, 0.3, e)), LK.eye1, sst(0.42, 0.5, e)), LK.eye0, sst(0.62, 0.7, e));
  col = mix(col, eyeCol, sst(0.0, 0.03, e).mul(LK.eye0.r.add(LK.eye0.g).add(LK.eye0.b).greaterThan(0).select(float(1), float(0))));
  col = mix(col, vec3(0.92, 0.91, 0.88), T.a.mul(0.9));
  // la base duveteuse : plus pâle, sans motif net
  col = mix(col, LK.down, plum.mul(0.85));
  // usure : le pigment pâlit (soleil)
  col = mix(col, col.mul(vec3(1.12, 1.08, 1.0)).add(0.04), wear.mul(LK.bleach));
  // barbules : stries fines le long de la barbe, l'arête du ramus plus claire
  // (estompées avant la fréquence du pixel : sinon un moiré en chevrons)
  const fadeS = float(1).sub(sst(0.12, 0.35, fwidth(t.mul(260 / (2 * Math.PI)))));
  const striae = sin(t.mul(260).add(rnd.mul(40)).add(v.mul(3))).mul(0.5).mul(fadeS).add(0.5);
  col = col.mul(rnd.sub(0.5).mul(0.08).add(1)).mul(striae.mul(0.12).add(0.94));
  m.colorNode = col;
  // frange des barbules : le bord du ruban est un peigne (tramé : lissé par le TRAA)
  const edge = abs(v);
  const fadeC = float(1).sub(sst(0.12, 0.35, fwidth(t.mul(520 / (2 * Math.PI)))));
  const comb = sin(t.mul(520).add(edge.mul(14)).add(rnd.mul(30))).mul(0.5).mul(fadeC).add(0.5);
  const cover = mix(float(1), sst(1.0, 0.35, edge).add(comb.mul(0.35)), float(1).sub(zip).mul(0.85).add(plum.mul(0.3)).clamp(0, 1));
  const thr = lite ? float(0.5) : fract(hash(positionGeometry.xy.mul(97.1).add(rnd.mul(13)).add(float(frameId).mul(0.618))).add(0.0));
  m.maskNode = cover.greaterThan(thr.mul(0.9).add(0.05));
  m.roughnessNode = mix(float(0.42), float(0.6), plum).add(wear.mul(0.08));
  m.metalnessNode = float(0);
  m.specularIntensityNode = float(0.55);
  // lustre de velours des barbules (le « sheen » d'une plume)
  m.sheenNode = col.mul(0.6).add(0.08).mul(LK.sheen);
  m.sheenRoughnessNode = float(0.45);
  // irisation : film mince équivalent de la kératine à mélanine
  m.iridescenceNode = LK.irid.mul(T.b.mul(0.5).add(0.5)).mul(float(1).sub(plum)).mul(float(1).sub(T.a));
  m.iridescenceIORNode = float(1.56);
  m.iridescenceThicknessNode = mix(LK.iridLo, LK.iridHi, rnd.mul(0.3).add(patz.mul(0.7)));
  // bleu structural (kératine spongieuse) : une couleur qui ne vient pas du pigment
  // relief : arête du ramus et barbules
  const H = striae.mul(0.4).add(float(1).sub(edge).mul(0.6)).mul(0.004);
  m.normalNode = perturb(H, normalViewGeometry);
  // translucidité : à contre-jour, le vexille s'allume, le motif en ombre chinoise
  const dens = T.r.mul(0.75).add(0.25);
  // (une lame de kératine de quelques dizaines de µm : elle laisse passer beaucoup de lumière)
  m.thicknessColorNode = col.mul(LK.translucency).mul(float(1).sub(dens.mul(0.75))).mul(0.9);
  m.thicknessDistortionNode = float(0.15);
  m.thicknessAmbientNode = float(0.0);
  m.thicknessAttenuationNode = float(1.0);
  m.thicknessPowerNode = float(3.0);
  m.thicknessScaleNode = float(5.0);
  m.mrtNode = stableVelocity();
  return m;
}

// ── Le rachis (et le calamus) ────────────────────────────────────────────────
// Gabarit : tube de nr anneaux × ns côtés ; position = (s, cos, sin)
export function tubeTemplate(nr, ns) {
  const pos = [], idx = [];
  for (let i = 0; i <= nr; i++) for (let j = 0; j <= ns; j++) { const a = (j / ns) * Math.PI * 2; pos.push(i / nr, Math.cos(a), Math.sin(a)); }
  for (let i = 0; i < nr; i++) for (let j = 0; j < ns; j++) {
    const a = i * (ns + 1) + j, b = a + ns + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { position: new Float32Array(pos), index: idx };
}

const rachisPoint = (s, st, FU, dorsal = true) => {
  const u = st.T.x, L = FU.L;
  // (roulé, le rachis est sur la génératrice dorsale du tube, à ρ de l'axe)
  const off = dorsal && FU.rhoTex ? texture(FU.rhoTex, vec2(s, 0.5)).level(0).r.mul(float(1).sub(unrollT(u, s))).mul(float(1).sub(FU.radial)) : float(0);
  const yy = s.mul(L).sub(sinkT(u, L, FU.calamus, FU.over));
  const k = safeK(st.K.x.mul(bendAtT(u)));
  const yc = tmax(yy, 0);
  return { p: vec3(0, sin(k.mul(yc)).div(k).add(sin(k.mul(yc)).mul(off)), cos(k.mul(yc)).sub(1).div(k).add(cos(k.mul(yc)).mul(off))), T: vec3(0, cos(k.mul(yc)), sin(k.mul(yc)).negate()), N: vec3(0, sin(k.mul(yc)), cos(k.mul(yc))), hide: yy.lessThan(0) };
};

export function rachisGeometry(nFeathers, nr = 40, ns = 8) {
  const tpl = tubeTemplate(nr, ns);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(tpl.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(tpl.position.length), 3));
  g.setIndex(tpl.index);
  const ids = new Float32Array(nFeathers);
  for (let i = 0; i < nFeathers; i++) ids[i] = i;
  g.setAttribute('fid', new THREE.InstancedBufferAttribute(ids, 1));
  g.instanceCount = nFeathers;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}

export function rachisMaterial({ FS, FSP, FU, LK, moving, offset = 0 }) {
  const lite = isLite();
  const m = new THREE.MeshPhysicalNodeMaterial();
  const vS = varyingProperty('float', 'vS');
  const pose = (A, full) => Fn(() => {
    const fid = attribute('fid', 'float').add(offset);
    const st = stOf(A, fid);
    const s = positionGeometry.x, c = positionGeometry.y, sn = positionGeometry.z;
    const R = rachisPoint(s, st, FU);
    // rayon : calamus plus large, rachis effilé ; section un peu aplatie
    const sc = FU.calamus;
    const r = mix(FU.r0, FU.r0.mul(0.12), pow(clamp(s.sub(sc).div(float(1).sub(sc)), 0, 1), 0.9)).mul(mix(float(1.25), float(1), sst(0, sc, s)));
    const X = vec3(1, 0, 0);
    const off = X.mul(c.mul(r)).add(R.N.mul(sn.mul(r).mul(0.8)));
    let p = R.p.add(off);
    p = select(R.hide.or(st.T.w.lessThan(0.5)), vec3(0, -0.05, 0), p);
    if (full) {
      normalLocal.assign(qrot(st.Q, normalize(X.mul(c).add(R.N.mul(sn)))));
      vS.assign(s);
    }
    return st.P.xyz.add(qrot(st.Q, p.mul(st.P.w)));
  })();
  m.positionNode = lite ? pose(FS, true) : Fn(() => { const cur = pose(FS, true); positionPrevious.assign(moving ? pose(FSP, false) : cur); return cur; })();
  m.castShadowPositionNode = pose(FS, false);
  // calamus translucide (corne), rachis mat et lisse
  m.colorNode = mix(LK.rachis.mul(1.05), LK.rachis, sst(FU.calamus.mul(0.8), FU.calamus, vS));
  m.roughnessNode = float(0.38);
  m.metalnessNode = float(0);
  m.clearcoatNode = float(0.2);
  m.clearcoatRoughnessNode = float(0.3);
  m.mrtNode = stableVelocity();
  return m;
}

// ── La gaine (seulement la plume nouvelle) ───────────────────────────────────
// Un tube autour du vexille roulé ; il existe sous le front de déroulement et
// au-dessus de la peau ; au front, il s'effrite (bord tramé).
export function sheathMaterial({ FS, FSP, FU, LK, idx = 0 }) {
  const lite = isLite();
  const m = new THREE.MeshSSSNodeMaterial();
  const vS = varyingProperty('vec2', 'vSh');
  const rhoAt = (s) => FU.rhoTex ? texture(FU.rhoTex, vec2(s, 0.5)).level(0).r : float(0.1);
  const pose = (A, full) => Fn(() => {
    const st = stOf(A, float(idx));
    const s = positionGeometry.x, c = positionGeometry.y, sn = positionGeometry.z;
    const R = rachisPoint(s, st, FU, false);
    const rho = tmax(rhoAt(s), FU.r0.mul(1.1));
    const r = rho.add(0.02);
    // section : centrée sur l'axe du follicule (le vexille roulé autour)
    const ctr = R.p;
    const X = vec3(1, 0, 0);
    let p = ctr.add(X.mul(c.mul(r))).add(R.N.mul(sn.mul(r)));
    // bouché à la pointe (le rayon y tend vers 0) ; caché sous la peau
    p = select(R.hide.or(st.T.w.lessThan(0.5)), vec3(0, -0.05, 0), p);
    if (full) {
      normalLocal.assign(qrot(st.Q, normalize(X.mul(c).add(R.N.mul(sn)))));
      vS.assign(vec2(s, atanLike(c, sn)));
    }
    return st.P.xyz.add(qrot(st.Q, p.mul(st.P.w)));
  })();
  m.positionNode = lite ? pose(FS, true) : Fn(() => { positionPrevious.assign(pose(FSP, false)); return pose(FS, true); })();
  m.castShadowPositionNode = pose(FS, false);
  const st = stOf(FS, float(idx));
  const s = vS.x, ang = vS.y;
  // l'effritement : au-dessus du front, la gaine n'est plus là ; bord en écailles
  const u = st.T.x;
  const front = releaseAtT(s); // (instant où le front passe à cette hauteur)
  const flake = fract(sin(s.mul(173.1).add(ang.mul(7.3))).mul(4375.5));
  const gone = u.sub(front).add(flake.mul(0.012));
  m.maskNode = gone.lessThan(0.0);
  // kératine cireuse, bleu-gris, translucide ; crêtes hélicoïdales des barbes
  // vues au travers ; plus sombre vers la base (la pulpe)
  const helix = sin(ang.mul(28).add(s.mul(180))).mul(0.5).add(0.5);
  const pulp = sst(0.45, 0.05, s);
  const col = LK.sheath.mul(helix.mul(0.12).add(0.9)).mul(mix(float(1), float(0.55), pulp));
  m.colorNode = col;
  m.roughnessNode = float(0.3).add(helix.mul(0.1));
  m.metalnessNode = float(0);
  m.clearcoatNode = float(0.5);
  m.clearcoatRoughnessNode = float(0.25);
  m.thicknessColorNode = col.mul(vec3(1.1, 1.0, 0.9)).mul(0.35);
  m.thicknessDistortionNode = float(0.2);
  m.thicknessAmbientNode = float(0.0);
  m.thicknessAttenuationNode = float(1.0);
  m.thicknessPowerNode = float(3.0);
  m.thicknessScaleNode = float(1.5);
  m.mrtNode = stableVelocity();
  void FSP; void length; void step; void G;
  return m;
}
// (angle autour du tube, sans atan2 : suffisant pour un motif périodique)
const atanLike = (c, s) => select(s.greaterThanEqual(0), c.negate().add(1), c.add(3)).mul(Math.PI / 2);
