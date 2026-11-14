// La mousse à l'écran : feuilles et sporophytes instanciés (un gabarit, des
// milliers d'instances, un shader par organe), tiges fusionnées, perles d'eau.
//
// Pas d'InstancedMesh (three.js compile un shader par InstancedMesh) : un
// Mesh ordinaire dont la géométrie porte, par instance, des attributs fixes
// (point d'insertion, repère de la tige, rang, tirages, pied de la tige et
// son seuil de naissance) dans un seul tampon entrelacé. Ce qui bouge —
// l'ouverture o de chaque tige, sa croissance g, son eau w, son eau de
// surface s — ne dépend que du champ au pied de la tige : chaque sommet le
// lit dans la texture du champ (B flouté, W, eau de surface), sans tableau
// d'uniformes, donc sans limite au nombre de tiges. La pose de chaque
// feuille est calculée dans le vertex shader par la même formule que pose.js
// (leafPoint), ainsi que celle de l'image précédente (texture du champ
// précédent : les vecteurs vitesse de l'anticrénelage temporel).
//
// Trois niveaux de détail (gen/build.js, d'après la trajectoire de la
// caméra) partagent le même matériau : seul le gabarit change.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, positionLocal, normalLocal, positionPrevious, positionGeometry, normalGeometry, vec2, vec3, vec4, float, int, dot, normalize, mix, smoothstep,
  abs, uniform, texture, clamp, atan, floor, hash, pow, sin, cos, max as tmax, min as tmin, select, sign, cross, normalViewGeometry, length, exp, fract,
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

// état d'une tige dont le pied est en (x, z), de seuil de naissance b :
// (o ouverture, g croissance, s eau de surface, w eau), lu dans la texture du
// champ (x B, y W, z B flouté, w eau de surface ; stage.js) — tex : FIELD.tex
// pour l'image courante, FIELD.prev pour la précédente. La tige sort quand
// la mousse locale passe son seuil (le front avance tige par tige).
const stateAt = (FIELD, tex, x, z, b) => {
  const f = texture(tex, vec2(x, z).div(FIELD.E.mul(2)).add(0.5)).level(0);
  // (B brut ou moyenné : une fissure étroite garde ses tiges entières au sec)
  return vec4(sst(0.2, 0.65, f.y), smoothstep(b, b.add(0.22), tmax(f.z, f.x)), f.w, f.y);
};
// pénombre de la canopée : au fond d'un coussin serré, une feuille du bas
// d'une tige (rang ρ faible), surtout près de sa base, ne voit plus le ciel
const canopy = (rho, s, crowd) => mix(float(1), mix(float(0.14), float(1), pow(rho.clamp(0, 1), 0.85)).mul(mix(float(0.55), float(1), s)), crowd);
// une tige pousse et se rétracte autour de son pied
const grow = (p, base, g) => base.add(p.sub(base).mul(g));
// points de la moyenne de la mousse (cm) : centre et deux couronnes
export const BLUR_TAPS = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.45, 0.45], [-0.45, 0.45], [0.45, -0.45], [-0.45, -0.45]];

// ── Feuilles ─────────────────────────────────────────────────────────────────
function leafPosition(full, F, FIELD) {
  return Fn(() => {
    const i0 = attribute('i0', 'vec4'), i1 = attribute('i1', 'vec4'), i2 = attribute('i2', 'vec4'), i3 = attribute('i3', 'vec4'), i4 = attribute('i4', 'vec4');
    const lp = attribute('lp', 'vec4');
    const st = stateAt(FIELD, FIELD.tex, i4.y, i4.z, i2.x);
    const G = { L: i0.w, W: i2.z, h: F.thick, stemR: i3.x, twist: i3.y };
    const P = leafPose(lp, leafOpen(st.x, i2.y), i3.z, i2.y, G, F);
    const base = vec3(i0.x, i4.x, i0.z);
    const world = (p, g) => grow(qrot(i1, p).add(i0.xyz), base, g);
    if (full) {
      if (!isLite()) {
        const sp = stateAt(FIELD, FIELD.prev, i4.y, i4.z, i2.x);
        positionPrevious.assign(world(leafPose(lp, leafOpen(sp.x, i2.y), i3.z, i2.y, G, F).pos, sp.y));
      }
      normalLocal.assign(normalize(qrot(i1, P.nrm)));
    }
    return world(P.pos, st.y);
  })();
}

function leafMaterial(U, F, FIELD) {
  const m = new THREE.MeshSSSNodeMaterial({ side: THREE.FrontSide });
  m.positionNode = leafPosition(true, F, FIELD);
  m.castShadowPositionNode = leafPosition(false, F, FIELD);
  const lp = attribute('lp', 'vec4'), i2 = attribute('i2', 'vec4'), i3 = attribute('i3', 'vec4'), i4 = attribute('i4', 'vec4');
  const st = stateAt(FIELD, FIELD.tex, i4.y, i4.z, i2.x);
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
  // la jeune pousse, au front, est d'un vert plus clair et plus tendre (une
  // tige qui se retire à la sécheresse, moins mouillée, ne l'est pas)
  col = mix(col, U.young.mul(1.15), young.mul(sst(0.45, 0.85, st.w)).mul(0.7));
  // (vers la base, la feuille pâlit ; la nervure est plus jaune)
  col = col.mul(mix(float(1.18), float(0.95), sst(0, 0.5, s)));
  col = mix(col, col.mul(vec3(1.25, 1.2, 0.75)), costa.mul(0.6));
  col = col.mul(rnd.sub(0.5).mul(0.16).add(1)).mul(rows.mul(0.05).add(0.975));
  // le poil : hyalin, blanc argenté, devient transparent (plus sombre) mouillé
  col = mix(col, mix(U.hair, U.hair.mul(0.55), wet), isHair);
  // mouillé : plus sombre (le film d'eau)
  col = col.mul(film.mul(-0.18).add(1));
  // (le fond du coussin : pénombre ; le poil, au sommet, y échappe)
  const deep = mix(canopy(rho, s, i4.w), float(1), isHair);
  m.colorNode = col.mul(deep);
  m.aoNode = deep;
  m.roughnessNode = mix(mix(float(0.62), float(0.42), front), float(0.12), film.mul(U.gloss)).mul(isHair.mul(-0.5).add(1));
  m.metalnessNode = float(0);
  m.specularIntensityNode = mix(float(0.3), float(0.55), film).mul(deep);
  // (le reflet du ciel sur le film d'eau : seulement pour les feuilles qui le voient)
  m.clearcoatNode = film.mul(0.22).mul(U.gloss).mul(deep.mul(deep));
  m.clearcoatRoughnessNode = float(0.2);
  // sec : la surface papilleuse a un lustre de velours
  m.sheenNode = mix(vec3(0.16, 0.15, 0.1), vec3(0.02), wet).mul(isHair.oneMinus()).mul(deep);
  m.sheenRoughnessNode = float(0.5);
  const H = costa.mul(front.mul(2).sub(1)).mul(0.8).add(rows.mul(0.15)).mul(U.relief).mul(rim.oneMinus());
  m.normalNode = perturb(H, normalViewGeometry);
  // lumière transmise : la feuille mouillée est translucide (une assise de
  // cellules gorgées d'eau), la feuille sèche presque opaque
  m.thicknessColorNode = U.trans.mul(U.translucency).mul(mix(float(0.05), float(0.32), wet)).mul(deep).mul(costa.mul(-0.5).add(1)).mul(rim.oneMinus()).mul(old.mul(-0.7).add(1)).add(U.hair.mul(isHair).mul(0.15));
  m.thicknessDistortionNode = float(0.2);
  m.thicknessAmbientNode = float(0.02);
  m.thicknessAttenuationNode = float(1.0);
  m.thicknessPowerNode = float(3.0);
  m.thicknessScaleNode = float(1.6);
  m.mrtNode = stableVelocity();
  return m;
}

// ── Perles d'eau (au bout des feuilles du haut) ──────────────────────────────
function beadPosition(full, F, FIELD) {
  return Fn(() => {
    const i0 = attribute('i0', 'vec4'), i1 = attribute('i1', 'vec4'), i2 = attribute('i2', 'vec4'), i3 = attribute('i3', 'vec4'), i4 = attribute('i4', 'vec4');
    const st = stateAt(FIELD, FIELD.tex, i4.y, i4.z, i2.x), stp = stateAt(FIELD, FIELD.prev, i4.y, i4.z, i2.x);
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
function beadMaterial(F, FIELD) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.positionNode = beadPosition(true, F, FIELD);
  m.castShadowPositionNode = beadPosition(false, F, FIELD);
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
// (sporophyte : s2.x le seuil de naissance de sa tige, s3 = (tige, pied y, x, z) ;
// la soie suit l'eau w de la tige)
function sporPosition(full, S, FIELD) {
  return Fn(() => {
    const s0 = attribute('s0', 'vec4'), s2 = attribute('s2', 'vec4'), s3 = attribute('s3', 'vec4');
    const st = stateAt(FIELD, FIELD.tex, s3.z, s3.w, s2.x);
    const base = vec3(s0.x, s3.y, s0.z);
    const P = sporPose(S, st.w, full);
    if (full) {
      if (!isLite()) { const sp = stateAt(FIELD, FIELD.prev, s3.z, s3.w, s2.x); positionPrevious.assign(grow(sporPose(S, sp.w, false).pos, base, sp.y)); }
      normalLocal.assign(normalize(P.nrm));
    }
    return grow(P.pos, base, st.y);
  })();
}
function sporMaterial(U, S, FIELD) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.positionNode = sporPosition(true, S, FIELD);
  m.castShadowPositionNode = sporPosition(false, S, FIELD);
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
function stemMaterial(U, FIELD) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const t = attribute('surf', 'vec4').x, sbc = attribute('sb', 'vec2'), sb = attribute('sbase', 'vec3');
  const st = stateAt(FIELD, FIELD.tex, sb.x, sb.z, sbc.x);
  const pos = (g) => grow(positionLocal, sb, g);
  m.positionNode = Fn(() => { if (!isLite()) positionPrevious.assign(grow(positionLocal, sb, stateAt(FIELD, FIELD.prev, sb.x, sb.z, sbc.x).y)); return pos(st.y); })();
  m.castShadowPositionNode = pos(st.y);
  const wet = sst(0.08, 0.6, st.w);
  // tomentum de rhizoïdes roux à la base, tige brune, verte sous le bourgeon
  const base = mix(vec3(0.24, 0.1, 0.05), U.old.mul(1.1), sst(0.05, 0.3, t));
  // (une tige est surtout au fond du coussin : dans la pénombre des rosettes)
  const deep = mix(float(1), mix(float(0.12), float(0.85), t.mul(t)), sbc.y);
  m.colorNode = mix(base, mix(U.dry, U.wet, wet).mul(0.8), sst(0.6, 1, t).mul(0.6)).mul(noise(positionGeometry.mul(vec3(40, 6, 40))).mul(0.1).add(1)).mul(wet.mul(-0.15).add(1)).mul(deep);
  m.aoNode = deep;
  m.roughnessNode = mix(float(0.75), float(0.4), wet);
  m.sheenNode = vec3(0.3, 0.2, 0.12).mul(sst(0.3, 0.0, t));
  m.sheenRoughnessNode = float(0.6);
  m.mrtNode = stableVelocity();
  return m;
}

// ── La natte du coussin : rhizoïdes, feuilles mortes, terre ──
// Une fine natte sombre posée sur la roche, sous les tiges (gen/colony.js,
// th) : elle ne se voit qu'entre les rosettes, au fond, dans leur ombre. Le
// volume du coussin est porté par les tiges seules.
function turfMaterial(U, FIELD) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionGeometry;
  const fieldAt = (q, tex) => texture(tex, q.xz.div(FIELD.E.mul(2)).add(0.5)).level(0);
  // (le fond monte avec la mousse — B brut ou moyenné, comme les tiges ; il
  // reste sous la roche tant qu'il n'y a pas de quoi le couvrir)
  const th = attribute('th', 'float');
  // (même loi que la naissance des tiges ; il reste sous la roche tant que
  // presque aucune n'est sortie, et n'existe que sous des tiges — th)
  const lift = (q, tex) => { const f = fieldAt(q, tex); return q.add(vec3(0, th.mul(sst(0.1, 0.8, tmax(f.z, f.x))), 0)); };
  m.positionNode = Fn(() => { if (!isLite()) positionPrevious.assign(lift(positionLocal, FIELD.prev)); return lift(positionLocal, FIELD.tex); })();
  m.castShadowPositionNode = lift(positionLocal, FIELD.tex);
  const fw = fieldAt(p, FIELD.tex);
  const grain = worley(p.mul(vec3(30, 30, 30)));
  const bits = sst(0.3, 0.05, grain.x);
  const flakes = sst(0.18, 0.05, worley(p.mul(14).add(vec3(1.7, 0, 3.1))).x);
  const live = sst(0.1, 0.6, fw.y).mul(sst(0.06, 0.4, fw.x));
  // brun roux des rhizoïdes et des feuilles mortes ; un vert éteint là où la
  // mousse est vivante — trois fois plus sombre que les rosettes
  const dead = mix(vec3(0.045, 0.03, 0.018), U.old.mul(0.22), bits);
  let col = mix(dead, mix(U.wet, U.old, 0.5).mul(0.16), live.mul(0.6));
  col = mix(col, U.old.mul(0.25), flakes.mul(0.4));
  m.colorNode = col.mul(fw.y.mul(-0.3).add(1));
  m.roughnessNode = mix(float(0.9), float(0.55), fw.y);
  m.normalNode = perturb(bits.mul(0.002).add(flakes.mul(0.0015)), normalViewGeometry);
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

// FIELD : { tex, prev (textures du champ : B, W, B flouté, eau de surface), E (demi-largeur) }
export function createMoss(group, FIELD) {
  const U = createMossLook();
  let meshes = [], mats = [];
  function clear() {
    for (const o of meshes) { group.remove(o); o.geometry.dispose(); }
    for (const x of mats) x.dispose();
    meshes = []; mats = [];
  }
  // data : sortie du worker (gen/build.js) ; R : recette
  function set(data, R) {
    clear();
    const C = data.colony, fam = FAMILIES[R.family], m = C.sporCount;
    const F = familyUniforms(fam);
    const add = (geo, mat, { cast = true, receive = true, own = true } = {}) => {
      const o = new THREE.Mesh(geo, mat);
      o.castShadow = cast; o.receiveShadow = receive; o.frustumCulled = false;
      group.add(o); meshes.push(o); if (own) mats.push(mat);
      return o;
    };
    const LK = ['i0', 'i1', 'i2', 'i3', 'i4'];
    // feuilles : trois gabarits (gros plan, moyen, lointain), un seul shader
    const lmat = leafMaterial(U, F, FIELD);
    // (les feuilles lointaines ne portent pas d'ombre : trop petites pour la carte)
    C.lods.forEach((L, lv) => { if (L.count) add(instGeometry(data.leaf[lv], { lp: data.leaf[lv].lp }, L.inst, LEAF_STRIDE, L.count, LK), lmat, { own: lv === 0, cast: lv < 2 }); });
    if (!C.lods[0].count) mats.push(lmat);
    // perles : une sphère par feuille qui peut en porter une (de rayon nul hors de la pluie)
    if (C.beads.count) {
      const sg = new THREE.IcosahedronGeometry(1, 1);
      const tpl = { position: sg.attributes.position.array, normal: sg.attributes.normal.array, index: sg.index ? sg.index.array : Uint16Array.from({ length: sg.attributes.position.count }, (_, i) => i) };
      add(instGeometry(tpl, {}, C.beads.inst, LEAF_STRIDE, C.beads.count, LK), beadMaterial(F, FIELD), { cast: false });
    }
    if (m) {
      const S = sporUniforms(fam.spor.kind);
      add(instGeometry(data.spor, { sp: data.spor.sp }, C.sporInst, SPOR_STRIDE, m, ['s0', 's1', 's2', 's3']), sporMaterial(U, S, FIELD));
    }
    // tiges
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(C.stems.position, 3));
    sg.setAttribute('normal', new THREE.BufferAttribute(C.stems.normal, 3));
    sg.setAttribute('surf', new THREE.BufferAttribute(C.stems.surf, 4, true));
    sg.setAttribute('sb', new THREE.BufferAttribute(C.stems.sb, 2));
    sg.setAttribute('sbase', new THREE.BufferAttribute(C.stems.sbase, 3));
    sg.setIndex(new THREE.BufferAttribute(C.stems.index, 1));
    sg.computeBoundingSphere();
    add(sg, stemMaterial(U, FIELD));
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
  return { set, syncLook, U, get meshes() { return meshes; } };
}
