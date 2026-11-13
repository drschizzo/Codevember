// La mousse à l'écran : feuilles et sporophytes instanciés (un gabarit, des
// milliers d'instances, un shader par organe), tiges fusionnées, perles d'eau.
//
// Pas d'InstancedMesh (three.js compile un shader par InstancedMesh) : un
// Mesh ordinaire dont la géométrie porte, par instance, des attributs fixes
// (point d'insertion, repère de la tige, rang, tirages) dans un seul tampon
// entrelacé. Ce qui bouge — l'ouverture o de chaque tige, son eau w, son eau
// de surface s, l'eau de chaque sporophyte — tient dans un tableau
// d'uniformes (un vec4 par tige ou par sporophyte) mis à jour à chaque image ;
// la pose de chaque feuille est calculée dans le vertex shader par la même
// formule que pose.js (leafPoint), ainsi que celle de l'image précédente (les
// vecteurs vitesse de l'anticrénelage temporel).
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, positionLocal, normalLocal, positionPrevious, positionGeometry, normalGeometry, vec2, vec3, vec4, float, int, dot, normalize, mix, smoothstep,
  abs, uniform, uniformArray, texture, clamp, atan, floor, hash, pow, sin, cos, max as tmax, min as tmin, select, sign, cross, normalViewGeometry, length, exp, fract,
} from 'three/tsl';
import { isLite, stableVelocity, noise, worley, perturb } from '../../../shared/scene/materials.js';
import { FAMILIES } from '../families.js';
import { STAGGER } from '../pose.js';
import { LEAF_STRIDE, SPOR_STRIDE } from '../gen/colony.js';
import { SPOR_KINDS } from '../gen/templates.js';

const sst = (a, b, x) => smoothstep(float(a), float(b), x);

// rotation d'un vecteur par un quaternion (x, y, z, w)
const qrot = (q, v) => {
  const t = cross(q.xyz, v).mul(2);
  return v.add(t.mul(q.w)).add(cross(q.xyz, t));
};
const safeK = (k) => select(k.lessThan(0), tmin(k, float(-1e-3)), tmax(k, float(1e-3)));
// arc (r, y) partant à l'angle a, de courbure k, de longueur l
const arc = (a, k, l) => {
  const ks = safeK(k);
  return vec2(cos(a).sub(cos(a.add(ks.mul(l)))).div(ks), sin(a.add(ks.mul(l))).sub(sin(a)).div(ks));
};

// ── Uniformes de la famille (forme de la feuille, poses sèche et mouillée) ──
function familyUniforms(fam) {
  const L = fam.leaf;
  return {
    sheath: uniform(L.sheath), hinge: uniform(L.hinge), a0: uniform(L.a0), base: uniform(L.base),
    apexP: uniform(Math.log(0.5) / Math.log(L.apex)), thick: uniform(L.thick), hair: uniform(L.hair), hairR: uniform(L.hairR),
    dTheta: uniform(fam.dry.theta), wTheta: uniform(fam.wet.theta), dKl: uniform(fam.dry.kl), wKl: uniform(fam.wet.kl),
    dKt: uniform(fam.dry.kt), wKt: uniform(fam.wet.kt), dTw: uniform(fam.dry.tw), wTw: uniform(fam.wet.tw),
    costa: uniform(L.costa), branch: uniform(L.branch ? 1 : 0),
  };
}

// demi-largeur relative (même formule que families.js, widthAt)
const leafWidth = (s, F) => {
  const sm = clamp(s, 0, 1);
  const body = pow(tmax(sin(pow(tmax(sm, 1e-5), F.apexP).mul(Math.PI)), 1e-5), 0.75);
  const sheath = F.base.mul(float(1).sub(smoothstep(F.sheath.mul(0.6), F.sheath.add(0.12), sm)));
  return tmax(body, sheath).mul(float(1).sub(sst(0.82, 1, sm).mul(0.9)));
};

// ouverture d'une feuille de rang ρ quand sa tige est ouverte à o (pose.js, leafOpen)
const leafOpen = (o, rho) => { const a = rho.mul(STAGGER); return smoothstep(a, a.add(1 - STAGGER), o); };

// pose d'une feuille (pose.js, poseParams + leafPoint) : position et normale
// dans le repère de la tige ; lp = (s, x, ν, lat) ; f : ouverture ; amp :
// écartement permis par les voisines
function leafPose(lp, f, amp, rho, G, F) {
  const g = f.mul(amp);
  const bud = sst(0.7, 1, rho);
  const theta = mix(F.dTheta, F.wTheta, g).mul(bud.mul(-0.55).add(1)).add(rho.oneMinus().mul(g.oneMinus()).mul(0.12));
  const kl = mix(F.dKl, F.wKl, g).mul(bud.mul(-0.6).add(1));
  const kt = mix(F.dKt, F.wKt, f), tw = mix(F.dTw, F.wTw, f);
  const isHair = lp.w.lessThan(-0.5);
  const s = select(isHair, float(1), lp.x), x = select(isHair, float(0), lp.y), nu = select(isHair, float(0), lp.z), lat = select(isHair, float(0), lp.w);
  const L = G.L, sigma = s.mul(L), Ls = F.sheath.mul(L), lh = F.hinge.mul(L);
  const kh = theta.sub(F.a0).div(lh);
  const l1 = tmin(sigma, Ls), l2 = clamp(sigma.sub(Ls), 0, lh), l3 = tmax(sigma.sub(Ls).sub(lh), 0);
  const A2 = arc(F.a0, kh, l2), A3 = arc(theta, kl, l3);
  const r = l1.mul(sin(F.a0)).add(A2.x).add(A3.x), y = l1.mul(cos(F.a0)).add(A2.y).add(A3.y);
  const al = F.a0.add(kh.mul(l2)).add(kl.mul(l3));
  const w = leafWidth(s, F).mul(G.W), c = x.mul(w), kts = safeK(kt), kc = kts.mul(c);
  const S = sin(kc).div(kts), C = float(1).sub(cos(kc)).div(kts);
  const nr = cos(al).negate(), ny = sin(al), ck = cos(kc), sk = sin(kc);
  const half = G.h.mul(0.5).mul(float(1).sub(sst(0.6, 1, s).mul(0.5)));
  const sx = select(x.lessThan(0), float(-1), float(1));
  const px = G.stemR.add(r).add(nr.mul(C)).add(nr.mul(ck).mul(nu).mul(half)).add(nr.mul(sk).mul(sx).mul(lat).mul(half));
  const py = y.add(ny.mul(C)).add(ny.mul(ck).mul(nu).mul(half)).add(ny.mul(sk).mul(sx).mul(lat).mul(half));
  const pz = S.sub(sk.mul(nu).mul(half)).add(ck.mul(sx).mul(lat).mul(half));
  // normale (dessus/dessous : ±n de la surface roulée ; tranche : en travers)
  const nx_ = nr.mul(ck).mul(nu).add(nr.mul(sk).mul(sx).mul(lat));
  const ny_ = ny.mul(ck).mul(nu).add(ny.mul(sk).mul(sx).mul(lat));
  const nz_ = sk.mul(nu).negate().add(ck.mul(sx).mul(lat));
  const psi = tw.mul(s).mul(G.twist), cp = cos(psi), sp = sin(psi);
  const rot = (v) => vec3(v.x.mul(cp).sub(v.z.mul(sp)), v.y, v.x.mul(sp).add(v.z.mul(cp)));
  let pos = rot(vec3(px, py, pz)), nrm = rot(vec3(nx_, ny_, nz_));
  // le poil hyalin : prolonge la nervure, droit, effilé (s = 1 + u, x = cos φ, ν = sin φ)
  const u = lp.x.sub(1).clamp(0, 1);
  const T = rot(vec3(sin(al), cos(al), 0)), Nad = rot(vec3(nr, ny, 0)), Et = rot(vec3(0, 0, 1));
  const ring = Nad.mul(lp.y).add(Et.mul(lp.z));
  const hr = F.hairR.mul(pow(tmax(float(1).sub(u), 1e-4), 0.8)).add(1e-4);
  // (le poil s'incurve un peu vers le bas, sous son poids d'eau quand il est perlé)
  const hpos = pos.add(T.mul(u.mul(F.hair).mul(L))).add(ring.mul(hr)).add(vec3(0, -1, 0).mul(u.mul(u).mul(F.hair).mul(L).mul(0.12)));
  pos = select(isHair, hpos, pos);
  nrm = select(isHair, ring, nrm);
  return { pos, nrm };
}

export function createMossLook() {
  return {
    dry: uniform(new THREE.Color()), wet: uniform(new THREE.Color()), young: uniform(new THREE.Color()), old: uniform(new THREE.Color()),
    hair: uniform(new THREE.Color()), trans: uniform(new THREE.Color()), seta: uniform(new THREE.Color()), capsule: uniform(new THREE.Color()),
    calyptra: uniform(new THREE.Color()), translucency: uniform(1), gloss: uniform(1), relief: uniform(0.00025),
    bleach: uniform(0), // (sphaigne : blanchit au sec)
  };
}

// lecture de l'état : ST = (o ouverture, g croissance, s eau de surface, w eau)
// par tige, (ws eau de la soie, g de sa tige, 0, 0) par sporophyte ; STP : les
// mêmes à l'image précédente
const stateOf = (ST, i) => ST.element(int(i.add(0.5)));
// une tige pousse et se rétracte autour de son pied
const grow = (p, base, g) => base.add(p.sub(base).mul(g));
// points de la moyenne de la mousse (cm) : centre et deux couronnes
export const BLUR_TAPS = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.45, 0.45], [-0.45, 0.45], [0.45, -0.45], [-0.45, -0.45]];

// ── Feuilles ─────────────────────────────────────────────────────────────────
function leafPosition(full, F, ST, STP) {
  return Fn(() => {
    const i0 = attribute('i0', 'vec4'), i1 = attribute('i1', 'vec4'), i2 = attribute('i2', 'vec4'), i3 = attribute('i3', 'vec4'), i4 = attribute('i4', 'vec4');
    const lp = attribute('lp', 'vec4');
    const st = stateOf(ST, i2.x), sp = stateOf(STP, i2.x);
    const G = { L: i0.w, W: i2.z, h: F.thick, stemR: i3.x, twist: i3.y };
    const P = leafPose(lp, leafOpen(st.x, i2.y), i3.z, i2.y, G, F);
    const base = vec3(i0.x, i4.x, i0.z);
    const world = (p, g) => grow(qrot(i1, p).add(i0.xyz), base, g);
    if (full) {
      if (!isLite()) {
        positionPrevious.assign(world(leafPose(lp, leafOpen(sp.x, i2.y), i3.z, i2.y, G, F).pos, sp.y));
      }
      normalLocal.assign(normalize(qrot(i1, P.nrm)));
    }
    return world(P.pos, st.y);
  })();
}

function leafMaterial(U, F, ST, STP) {
  const m = new THREE.MeshSSSNodeMaterial({ side: THREE.FrontSide });
  m.positionNode = leafPosition(true, F, ST, STP);
  m.castShadowPositionNode = leafPosition(false, F, ST, STP);
  const lp = attribute('lp', 'vec4'), i2 = attribute('i2', 'vec4'), i3 = attribute('i3', 'vec4');
  const st = stateOf(ST, i2.x);
  const isHair = lp.w.lessThan(-0.5).select(float(1), float(0));
  const s = lp.x.clamp(0, 1), y = lp.y; // (y : en demi-largeurs, la nervure en 0)
  const front = lp.z.mul(0.5).add(0.5);
  const rim = abs(lp.w).mul(isHair.oneMinus());
  const wet = sst(0.08, 0.6, st.w), film = sst(0.05, 0.4, st.z), young = float(1).sub(st.y);
  const rho = i2.y, rnd = i2.w, old = i3.w;
  // nervure (costa) en relief ; rangées de cellules le long du limbe ; dents
  const costa = sst(0.16, 0.0, abs(y)).mul(F.costa.min(1)).mul(sst(1.02, 0.85, s));
  const rows = sin(y.mul(26).add(s.mul(3))).mul(0.5).add(0.5);
  const g = positionGeometry;
  // couleur : sèche (olive, brune, ou blanche pour la sphaigne) → mouillée
  let col = mix(U.dry, U.wet, wet);
  col = mix(col, mix(U.young, U.wet, 0.3), sst(0.55, 1.0, rho).mul(0.55).mul(wet.mul(0.6).add(0.4)));
  col = mix(col, U.old, old.mul(0.85));
  // la jeune pousse, au front, est d'un vert plus clair et plus tendre
  col = mix(col, U.young.mul(1.15), young.mul(wet).mul(0.7));
  // (vers la base, la feuille pâlit ; la nervure est plus jaune)
  col = col.mul(mix(float(1.18), float(0.95), sst(0, 0.5, s)));
  col = mix(col, col.mul(vec3(1.25, 1.2, 0.75)), costa.mul(0.6));
  col = col.mul(rnd.sub(0.5).mul(0.16).add(1)).mul(rows.mul(0.05).add(0.975));
  // le poil : hyalin, blanc argenté, devient transparent (plus sombre) mouillé
  col = mix(col, mix(U.hair, U.hair.mul(0.55), wet), isHair);
  // mouillé : plus sombre (le film d'eau)
  col = col.mul(film.mul(-0.18).add(1));
  m.colorNode = col;
  m.roughnessNode = mix(mix(float(0.62), float(0.42), front), float(0.12), film.mul(U.gloss)).mul(isHair.mul(-0.5).add(1));
  m.metalnessNode = float(0);
  m.specularIntensityNode = mix(float(0.3), float(0.55), film);
  m.clearcoatNode = film.mul(0.35).mul(U.gloss);
  m.clearcoatRoughnessNode = float(0.12);
  // sec : la surface papilleuse a un lustre de velours
  m.sheenNode = mix(vec3(0.16, 0.15, 0.1), vec3(0.02), wet).mul(isHair.oneMinus());
  m.sheenRoughnessNode = float(0.5);
  const H = costa.mul(front.mul(2).sub(1)).mul(0.8).add(rows.mul(0.15)).mul(U.relief).mul(rim.oneMinus());
  m.normalNode = perturb(H, normalViewGeometry);
  // lumière transmise : la feuille mouillée est translucide (une assise de
  // cellules gorgées d'eau), la feuille sèche presque opaque
  m.thicknessColorNode = U.trans.mul(U.translucency).mul(mix(float(0.05), float(0.32), wet)).mul(costa.mul(-0.5).add(1)).mul(rim.oneMinus()).mul(old.mul(-0.7).add(1)).add(U.hair.mul(isHair).mul(0.15));
  m.thicknessDistortionNode = float(0.2);
  m.thicknessAmbientNode = float(0.02);
  m.thicknessAttenuationNode = float(1.0);
  m.thicknessPowerNode = float(3.0);
  m.thicknessScaleNode = float(1.6);
  m.mrtNode = stableVelocity();
  return m;
}

// ── Perles d'eau (au bout des feuilles du haut) ──────────────────────────────
function beadPosition(full, F, ST, STP) {
  return Fn(() => {
    const i0 = attribute('i0', 'vec4'), i1 = attribute('i1', 'vec4'), i2 = attribute('i2', 'vec4'), i3 = attribute('i3', 'vec4'), i4 = attribute('i4', 'vec4');
    const st = stateOf(ST, i2.x), stp = stateOf(STP, i2.x);
    const base = vec3(i0.x, i4.x, i0.z);
    const G = { L: i0.w, W: i2.z, h: F.thick, stemR: i3.x, twist: i3.y };
    // une perle sur une feuille sur trois du haut ; au bout du poil s'il y en a
    const pick = sst(0.3, 0.6, i2.y).mul(sst(0.35, 0.6, fract(i2.w.mul(7.31))));
    const radius = (sv, o) => pow(sst(0.01, 0.4, sv).mul(pick), 0.45).mul(mix(float(0.012), float(0.03), i2.w)).mul(i3.w.oneMinus()).mul(o.mul(0.4).add(0.6));
    const at = (o) => {
      const tipS = select(F.hair.greaterThan(0), float(1.0005).add(1), float(0.96));
      return leafPose(vec4(tipS, 0, 0, -1), leafOpen(o, i2.y), i3.z, i2.y, G, F).pos;
    };
    const r = radius(st.z, st.x).mul(st.y);
    const c = grow(qrot(i1, at(st.x)).add(i0.xyz), base, st.y);
    // (la perle pend sous le point d'accroche : son centre est un rayon plus bas)
    const p = c.add(positionLocal.mul(r).mul(vec3(1, 0.86, 1))).sub(vec3(0, r.mul(0.7), 0));
    if (full) {
      if (!isLite()) {
        const rp = radius(stp.z, stp.x).mul(stp.y);
        positionPrevious.assign(grow(qrot(i1, at(stp.x)).add(i0.xyz), base, stp.y).add(positionLocal.mul(rp).mul(vec3(1, 0.86, 1))).sub(vec3(0, rp.mul(0.7), 0)));
      }
      normalLocal.assign(normalLocal);
    }
    return p;
  })();
}
function beadMaterial(F, ST, STP) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.positionNode = beadPosition(true, F, ST, STP);
  m.castShadowPositionNode = beadPosition(false, F, ST, STP);
  m.color = new THREE.Color(1, 1, 1);
  m.roughness = 0.03;
  m.metalness = 0;
  m.transmission = 1;
  m.ior = 1.333;
  m.thickness = 0.04;
  m.specularIntensity = 1;
  m.mrtNode = stableVelocity();
  return m;
}

// ── Sporophytes ──────────────────────────────────────────────────────────────
function sporUniforms(kind) {
  const K = SPOR_KINDS[kind];
  return {
    len: uniform(K.len), r: uniform(K.r), mouth: uniform(K.mouth), nod: uniform(K.nod), teethLen: uniform(K.teethLen), teethW: uniform(K.teethW),
    setaR: uniform(K.setaR), arc: uniform(kind === 'funaria' ? 0.32 : kind === 'polytrichum' ? 0.05 : 0.02), twistTeeth: uniform(kind === 'tortula' ? 1 : 0),
  };
}
function sporPose(S, ws, full) {
  const s0 = attribute('s0', 'vec4'), s1 = attribute('s1', 'vec4'), s2 = attribute('s2', 'vec4');
  const sp = attribute('sp', 'vec4');
  const part = sp.x, len = s0.w;
  // soie : un arc dans le plan (X, Y) ; la capsule au bout, penchée (nod)
  const ya = sp.y.clamp(0, 1);
  const arcOff = (t) => vec3(S.arc.mul(len).mul(t.mul(t)), len.mul(t), 0);
  const topDir = normalize(vec3(S.arc.mul(2), 1, 0));
  // l'eau de la soie la tord : la capsule tourne de « turns » tours au sec
  const phi = s2.z.mul(Math.PI * 2).mul(float(1).sub(sst(0.05, 0.6, ws)));
  const openT = float(1).sub(sst(0.12, 0.5, ws)); // dents : ouvertes au sec
  const isSeta = part.lessThan(0.5);
  // seta
  const rr = S.setaR.mul(float(1).sub(ya.mul(0.3)));
  const tg = normalize(vec3(S.arc.mul(2).mul(ya), 1, 0));
  const sideA = normalize(cross(tg, vec3(0, 0, 1))), sideB = vec3(0, 0, 1);
  const setaP = arcOff(ya).add(sideA.mul(positionGeometry.x.mul(rr))).add(sideB.mul(positionGeometry.z.mul(rr)));
  const setaN = sideA.mul(positionGeometry.x).add(sideB.mul(positionGeometry.z));
  // capsule (repère : axe +Y), penchée de nod autour de Z (vers −X : le crochet)
  const nod = S.nod.add(s2.y.sub(0.5).mul(0.25));
  const cn = cos(nod), sn = sin(nod);
  const rotNod = (v) => vec3(v.x.mul(cn).sub(v.y.mul(sn)).mul(1), v.x.mul(sn).add(v.y.mul(cn)), v.z);
  // dents du péristome : pivot sur la bouche, inclinées vers l'axe (mouillées)
  // ou évasées (sèches) ; torsadées en vis chez la tortule
  const tphi = sp.y, ta = sp.z, side = sp.w;
  const radial = vec3(cos(tphi), 0, sin(tphi)), tang = vec3(sin(tphi).negate(), 0, cos(tphi));
  const beta = mix(float(-0.42), float(0.95), openT).mul(ta.mul(0.6).add(0.4));
  const twistT = S.twistTeeth.mul(float(1).sub(openT.mul(0.7))).mul(1.1);
  const tdir = radial.mul(sin(beta)).add(vec3(0, 1, 0).mul(cos(beta))).add(tang.mul(twistT.mul(ta)));
  const toothP = radial.mul(S.mouth).add(vec3(0, S.len, 0)).add(tdir.mul(S.teethLen.mul(ta))).add(tang.mul(side.mul(S.teethW).mul(ta.oneMinus().mul(0.8).add(0.2)))).add(normalize(cross(tang, tdir)).mul(positionGeometry.y.mul(0.0012)));
  const toothN = normalize(cross(tang, tdir)).mul(positionGeometry.y);
  // opercule présent (capsule jeune) : pas de dents visibles ; sinon pas d'opercule
  const lidded = s2.w.lessThan(0.5);
  const isTooth = part.greaterThan(2.5).and(part.lessThan(3.5));
  const isLid = part.greaterThan(1.5).and(part.lessThan(2.5));
  const isCal = part.greaterThan(3.5);
  const hide = select(isTooth.and(lidded), float(0), select(isLid.and(lidded.not()), float(0), select(isCal.and(lidded.not()), float(0), float(1))));
  const capLocal = select(isTooth, toothP, positionGeometry).mul(hide);
  const capN = select(isTooth, toothN, normalGeometry);
  const top = arcOff(float(1));
  // repère de la capsule au bout de la soie : suit la tangente du sommet, puis penche
  const ax = normalize(cross(vec3(0, 0, 1), topDir));
  const toTop = (v) => ax.mul(v.x).add(topDir.mul(v.y)).add(vec3(0, 0, 1).mul(v.z));
  const capP = top.add(toTop(rotNod(capLocal)));
  const capNn = toTop(rotNod(capN));
  let p = select(isSeta, setaP, capP), n = select(isSeta, setaN, capNn);
  // rotation de la soie tordue autour de son axe de base (Y)
  const cph = cos(phi), sph = sin(phi);
  const rY = (v) => vec3(v.x.mul(cph).add(v.z.mul(sph)), v.y, v.z.mul(cph).sub(v.x.mul(sph)));
  p = rY(p); n = rY(n);
  return { pos: qrot(s1, p).add(s0.xyz), nrm: qrot(s1, n) };
}
function sporPosition(full, S, ST, STP) {
  return Fn(() => {
    const s0 = attribute('s0', 'vec4'), s2 = attribute('s2', 'vec4'), s3 = attribute('s3', 'vec4');
    const st = stateOf(ST, s2.x), sp = stateOf(STP, s2.x);
    const base = vec3(s0.x, s3.y, s0.z);
    const P = sporPose(S, st.x, full);
    if (full) {
      if (!isLite()) positionPrevious.assign(grow(sporPose(S, sp.x, false).pos, base, sp.y));
      normalLocal.assign(normalize(P.nrm));
    }
    return grow(P.pos, base, st.y);
  })();
}
function sporMaterial(U, S, ST, STP) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.positionNode = sporPosition(true, S, ST, STP);
  m.castShadowPositionNode = sporPosition(false, S, ST, STP);
  const sp = attribute('sp', 'vec4'), s2 = attribute('s2', 'vec4');
  const part = sp.x;
  const isSeta = part.lessThan(0.5).select(float(1), float(0));
  const isCap = part.greaterThan(0.5).and(part.lessThan(1.5)).select(float(1), float(0));
  const isLid = part.greaterThan(1.5).and(part.lessThan(2.5)).select(float(1), float(0));
  const isTooth = part.greaterThan(2.5).and(part.lessThan(3.5)).select(float(1), float(0));
  const isCal = part.greaterThan(3.5).select(float(1), float(0));
  // soie : rouge à la base, plus claire en haut, stries torsadées ; capsule :
  // luisante, plus sombre à la bouche ; opercule à bec rouge ; dents rouge brun
  const twistStripe = sin(sp.z.mul(3).add(sp.y.mul(40)).add(s2.z.mul(6.28))).mul(0.5).add(0.5);
  const seta = mix(U.seta.mul(0.7), U.seta.mul(1.25), sp.y).mul(twistStripe.mul(0.12).add(0.94));
  const cap = mix(U.capsule.mul(1.15), U.capsule.mul(0.55), sst(0.75, 1, sp.y)).mul(noise(positionGeometry.mul(60)).mul(0.08).add(1));
  const lid = mix(U.capsule.mul(0.9), vec3(0.55, 0.12, 0.05), sp.y);
  const tooth = mix(vec3(0.45, 0.16, 0.06), vec3(0.85, 0.6, 0.35), sp.z);
  m.colorNode = seta.mul(isSeta).add(cap.mul(isCap)).add(lid.mul(isLid)).add(tooth.mul(isTooth)).add(U.calyptra.mul(isCal));
  m.roughnessNode = float(0.32).mul(isSeta).add(float(0.25).mul(isCap)).add(float(0.3).mul(isLid)).add(float(0.55).mul(isTooth)).add(float(0.6).mul(isCal));
  m.metalnessNode = float(0);
  m.clearcoatNode = isCap.mul(0.5).add(isSeta.mul(0.3));
  m.clearcoatRoughnessNode = float(0.18);
  m.sheenNode = U.calyptra.mul(isCal).mul(0.9).add(vec3(0.15, 0.1, 0.06).mul(isTooth));
  m.sheenRoughnessNode = float(0.35);
  m.mrtNode = stableVelocity();
  return m;
}

// ── Tiges ────────────────────────────────────────────────────────────────────
function stemMaterial(U, ST, STP) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const t = attribute('surf', 'vec4').x, sid = attribute('sid', 'float'), sb = attribute('sbase', 'vec3');
  const st = stateOf(ST, sid);
  const pos = (g) => grow(positionLocal, sb, g);
  m.positionNode = Fn(() => { if (!isLite()) positionPrevious.assign(grow(positionLocal, sb, stateOf(STP, sid).y)); return pos(st.y); })();
  m.castShadowPositionNode = pos(st.y);
  const wet = sst(0.08, 0.6, st.w);
  // tomentum de rhizoïdes roux à la base, tige brune, verte sous le bourgeon
  const base = mix(vec3(0.24, 0.1, 0.05), U.old.mul(1.1), sst(0.05, 0.3, t));
  m.colorNode = mix(base, mix(U.dry, U.wet, wet).mul(0.8), sst(0.6, 1, t).mul(0.6)).mul(noise(positionGeometry.mul(vec3(40, 6, 40))).mul(0.1).add(1)).mul(wet.mul(-0.15).add(1));
  m.roughnessNode = mix(float(0.75), float(0.4), wet);
  m.sheenNode = vec3(0.3, 0.2, 0.12).mul(sst(0.3, 0.0, t));
  m.sheenRoughnessNode = float(0.6);
  m.mrtNode = stableVelocity();
  return m;
}

// rosettes peintes sur la peau du coussin (deux grilles décalées) : chaque
// cellule porte une étoile de n feuilles effilées, orientée au hasard —
// la densité d'un vrai coussin entre les tiges modélisées
function starLayer(p, cell, n, seed) {
  const q = p.xz.div(cell).add(seed);
  const id = floor(q), f = q.sub(id).sub(0.5);
  const h1 = fract(sin(id.x.mul(127.1).add(id.y.mul(311.7)).add(seed)).mul(43758.55)), h2 = fract(sin(id.x.mul(269.5).add(id.y.mul(183.3)).add(seed)).mul(23421.63));
  const c = f.sub(vec2(h1, h2).sub(0.5).mul(0.35));
  const r = length(c).mul(2.2), a = atan(c.y, c.x).add(h1.mul(6.283));
  const spoke = pow(abs(cos(a.mul(n * 0.5))), float(14).mul(r.add(0.25)));
  const leaf = spoke.mul(sst(1.0, 0.25, r)).mul(sst(0.0, 0.08, r));
  return { leaf, r, h: h1 };
}

// ── Le feutre : rhizoïdes roux, débris de feuilles mortes, grains de terre ──
function turfMaterial(U, FIELD) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionGeometry;
  const fieldAt = (q) => texture(FIELD.tex, q.xz.div(FIELD.E.mul(2)).add(0.5)).level(0);
  // (le bord du coussin s'arrondit à l'échelle du coussin : la mousse moyennée
  // sur un demi-centimètre, comme pour les tiges — stage.js, blurB)
  const blurB = (tex, q) => {
    let acc = float(0);
    for (const [a, b] of BLUR_TAPS) acc = acc.add(texture(tex, q.xz.add(vec2(a, b)).div(FIELD.E.mul(2)).add(0.5)).level(0).x);
    return acc.div(BLUR_TAPS.length);
  };
  const th = attribute('th', 'float');
  const lift = (q, tex) => q.add(vec3(0, th.mul(sst(0.04, 0.9, blurB(tex, q))), 0));
  m.positionNode = Fn(() => { if (!isLite()) positionPrevious.assign(lift(positionLocal, FIELD.prev)); return lift(positionLocal, FIELD.tex); })();
  m.castShadowPositionNode = lift(positionLocal, FIELD.tex);
  const fw = fieldAt(p);
  const fib = worley(p.mul(vec3(38, 60, 38)));
  const flakes = sst(0.18, 0.05, worley(p.mul(14).add(vec3(1.7, 0, 3.1))).x);
  const strands = sst(0.04, 0.0, fib.y);
  // l'intérieur d'un coussin : des feuilles serrées dans l'ombre (étoiles
  // sombres), quelques débris bruns ; le bas (rhizoïdes) roux
  // (même mourante, c'est de la mousse : des tiges serrées, brunies, pas un carton)
  const stars = sst(0.35, 0.05, worley(p.mul(vec3(26, 26, 26))).x);
  const stars2 = sst(0.3, 0.05, worley(p.mul(vec3(55, 55, 55)).add(vec3(3.3, 1, 7))).x);
  const dead = mix(U.old.mul(0.7), U.dry.mul(0.5), sst(0.2, 0.7, fw.x));
  const live = sst(0.1, 0.6, fw.y).mul(sst(0.06, 0.4, fw.x));
  const S1 = starLayer(p, float(0.16), 8, 0.0), S2 = starLayer(p, float(0.11), 7, 17.3), S3 = starLayer(p, float(0.075), 6, 41.1);
  const leaves = tmax(tmax(S1.leaf, S2.leaf.mul(0.8)), S3.leaf.mul(0.6));
  const base = mix(dead, U.wet.mul(0.4), live).mul(stars.mul(0.3).add(stars2.mul(0.2)).add(0.3));
  const leafCol = mix(mix(U.dry.mul(0.85), U.old, 0.3), mix(U.wet, U.young, S1.h.mul(0.5)), live);
  let col = mix(base, leafCol, leaves.mul(0.9));
  col = mix(col, U.old.mul(0.5), flakes.mul(0.25));
  m.colorNode = col.mul(fw.y.mul(-0.3).add(1));
  m.roughnessNode = mix(float(0.85), float(0.4), fw.y);
  m.sheenRoughnessNode = float(0.5);
  m.normalNode = perturb(leaves.mul(0.006).add(stars.mul(0.002)), normalViewGeometry);
  // feuilles translucides à contre-jour
  m.sheenNode = U.trans.mul(leaves).mul(live).mul(0.25);
  m.mrtNode = stableVelocity();
  return m;
}

// ── Assemblage ───────────────────────────────────────────────────────────────
function instGeometry(tpl, attrs, inst, stride, count, keys) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(tpl.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(tpl.normal, 3));
  for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, new THREE.BufferAttribute(v, 4));
  g.setIndex(new THREE.BufferAttribute(tpl.index, 1));
  const ib = new THREE.InstancedInterleavedBuffer(inst, stride, 1);
  keys.forEach((k, q) => g.setAttribute(k, new THREE.InterleavedBufferAttribute(ib, 4, 4 * q)));
  g.instanceCount = count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
  return g;
}

// FIELD : { tex, prev (textures du champ B, W), E (demi-largeur) }
export function createMoss(group, FIELD) {
  const U = createMossLook();
  let meshes = [], mats = [], ST = null, STP = null, arr = null, arrP = null, n = 0, m = 0;
  function clear() {
    for (const o of meshes) { group.remove(o); o.geometry.dispose(); }
    for (const x of mats) x.dispose();
    meshes = []; mats = [];
  }
  // data : sortie du worker (gen/build.js) ; R : recette
  function set(data, R) {
    clear();
    const C = data.colony, fam = FAMILIES[R.family];
    n = C.n; m = C.sporCount;
    arr = Array.from({ length: Math.max(1, n + m) }, () => new THREE.Vector4());
    arrP = Array.from({ length: Math.max(1, n + m) }, () => new THREE.Vector4());
    ST = uniformArray(arr, 'vec4'); STP = uniformArray(arrP, 'vec4');
    const F = familyUniforms(fam);
    const add = (geo, mat, { cast = true, receive = true, own = true } = {}) => {
      const o = new THREE.Mesh(geo, mat);
      o.castShadow = cast; o.receiveShadow = receive; o.frustumCulled = false;
      group.add(o); meshes.push(o); if (own) mats.push(mat);
      return o;
    };
    const LK = ['i0', 'i1', 'i2', 'i3', 'i4'];
    // feuilles : gabarit fin près du gros plan, grossier ailleurs (même shader)
    const lmat = leafMaterial(U, F, ST, STP);
    add(instGeometry(data.leaf, { lp: data.leaf.lp }, C.leafNear, LEAF_STRIDE, C.nearCount, LK), lmat);
    if (C.farCount) add(instGeometry(data.leafFar, { lp: data.leafFar.lp }, C.leafFar, LEAF_STRIDE, C.farCount, LK), lmat, { own: false });
    // perles : une sphère par feuille proche (de rayon nul sur la plupart)
    {
      const sg = new THREE.IcosahedronGeometry(1, 2);
      const tpl = { position: sg.attributes.position.array, normal: sg.attributes.normal.array, index: sg.index ? sg.index.array : Uint16Array.from({ length: sg.attributes.position.count }, (_, i) => i) };
      add(instGeometry(tpl, {}, C.leafNear, LEAF_STRIDE, C.nearCount, LK), beadMaterial(F, ST, STP), { cast: false });
    }
    if (m) {
      const S = sporUniforms(fam.spor.kind);
      add(instGeometry(data.spor, { sp: data.spor.sp }, C.sporInst, SPOR_STRIDE, m, ['s0', 's1', 's2', 's3']), sporMaterial(U, S, ST, STP));
    }
    // tiges
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(C.stems.position, 3));
    sg.setAttribute('normal', new THREE.BufferAttribute(C.stems.normal, 3));
    sg.setAttribute('surf', new THREE.BufferAttribute(C.stems.surf, 4, true));
    sg.setAttribute('sid', new THREE.BufferAttribute(C.stems.sid, 1));
    sg.setAttribute('sbase', new THREE.BufferAttribute(C.stems.sbase, 3));
    sg.setIndex(new THREE.BufferAttribute(C.stems.index, 1));
    sg.computeBoundingSphere();
    add(sg, stemMaterial(U, ST, STP));
    // feutre
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(C.turf.position, 3));
    tg.setAttribute('normal', new THREE.BufferAttribute(C.turf.normal, 3));
    tg.setAttribute('th', new THREE.BufferAttribute(C.turf.th, 1));
    tg.setIndex(new THREE.BufferAttribute(C.turf.index, 1));
    tg.computeBoundingSphere();
    add(tg, turfMaterial(U, FIELD), { cast: false });
    syncLook(R);
  }
  function syncLook(R) {
    const L = R.look;
    for (const k of ['dry', 'wet', 'young', 'old', 'hair', 'trans', 'seta', 'capsule', 'calyptra']) U[k].value.set(L[k]);
    U.translucency.value = L.translucency; U.gloss.value = L.gloss;
  }
  // state : Float32Array ((n + m) × 4) ; jump : un saut dans la boucle (pas de mouvement)
  function update(state, jump) {
    if (!arr) return;
    for (let i = 0; i < n + m; i++) {
      if (jump) arrP[i].set(state[i * 4], state[i * 4 + 1], state[i * 4 + 2], state[i * 4 + 3]);
      else arrP[i].copy(arr[i]);
      arr[i].set(state[i * 4], state[i * 4 + 1], state[i * 4 + 2], state[i * 4 + 3]);
    }
  }
  return { set, update, syncLook, U, get meshes() { return meshes; } };
}
