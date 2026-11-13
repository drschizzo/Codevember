// Les fils : chaque segment de fil est un ruban tourné vers la caméra, à
// normale cylindrique (la technique des cheveux) : deux triangles par segment,
// quelques centaines de milliers de segments par cocon, un seul shader.
//
// Lumière d'une fibre (éclairée à la main : outputNode) — Kajiya-Kay pour la
// diffusion, deux lobes de Marschner décalés le long de la fibre (R blanc et
// étroit, TRT teinté et plus large : le satin de la soie), et la lueur : la
// lumière de la lampe intérieure, filtrée par les n couches posées dessous
// (τ^n), diffusée vers l'avant à travers le fil (τ).
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, vec3, vec4, float, positionLocal, positionWorld, positionGeometry, cameraPosition, modelWorldMatrix,
  modelWorldMatrixInverse, normalize, cross, dot, length, max, min, mix, sqrt, pow, exp, log, smoothstep, clamp, abs, varyingProperty,
  positionPrevious, fract, sin, select, positionView, vec2, step, viewZToPerspectiveDepth, cameraNear, cameraFar,
} from 'three/tsl';
import { stableVelocity, noise } from './materials.js';

// Géométrie : un quadrilatère de base (t ∈ {0, 1} le long, v ∈ {−1, 1} en
// travers) et trois attributs par instance (a = p0, s0 ; b = p1, s1 ;
// c = couches dessous, indice du fil, tirage, libre)
export function threadGeometry(seg, capacity = seg?.count ?? 0) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const mk = (arr) => { const a = new THREE.InstancedBufferAttribute(arr, 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
  g.setAttribute('ta', mk(seg ? seg.a : new Float32Array(capacity * 4)));
  g.setAttribute('tb', mk(seg ? seg.b : new Float32Array(capacity * 4)));
  g.setAttribute('tc', mk(seg ? seg.c : new Float32Array(capacity * 4)));
  g.setAttribute('t0', mk(seg?.ta ?? new Float32Array(capacity * 4)));
  g.setAttribute('t1', mk(seg?.tb ?? new Float32Array(capacity * 4)));
  g.instanceCount = seg ? seg.count : 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.5);
  return g;
}

// Uniformes d'un fil (partagés par les deux stations) : la matière
export function threadUniforms() {
  return {
    color: uniform(new THREE.Color('#ece2cc')), spec: uniform(new THREE.Color('#ffffff')), glowColor: uniform(new THREE.Color('#ffe2b0')),
    tau: uniform(0.4), shift: uniform(0.08), rough: uniform(0.25), metal: uniform(0), d: uniform(0.0016),
    pix: uniform(0.001), // (angle d'un pixel : le ruban ne descend pas sous ~0,8 px)
    // lumières (monde) : la lumière de la pièce comme une direction, les lampes
    keyDir: uniform(new THREE.Vector3(0, 1, 0)), keyRad: uniform(new THREE.Color(0, 0, 0)),
    fillDir: uniform(new THREE.Vector3(0, 1, 0)), fillRad: uniform(new THREE.Color(0, 0, 0)),
    ambSky: uniform(new THREE.Color(0.05, 0.05, 0.05)), ambGround: uniform(new THREE.Color(0.03, 0.03, 0.03)),
    lampRad: uniform(new THREE.Color(1, 0.8, 0.6)), // (intensité de chaque lampe, cd)
    glowGain: uniform(0.15),
    total: uniform(30), // (longueur du ruban, m : pour la soie fraîche) // (part de la lampe qui traverse la paroi : dosée au posemètre, par humeur)
  };
}

// Matériau d'une station : own = la station (sa lampe, son S), other = l'autre
// station ; cookies : fonctions de transmission (lantern.js) ; free : ruban
// libre (entre le cocon, l'œil et le fléau), toujours entier, éclairé par les
// deux lampes à travers les parois.
export function threadMaterial(U, own, other, cookieOwn, cookieOther, { free = false } = {}) {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const A = attribute('ta', 'vec4'), Bv = attribute('tb', 'vec4'), C = attribute('tc', 'vec4');
  const T0 = attribute('t0', 'vec4'), T1 = attribute('t1', 'vec4');
  const vT = varyingProperty('vec3', 'vFiberT');
  const vV = varyingProperty('vec2', 'vFiberV'); // (travers du ruban, taille du fil en pixels)
  const vD = varyingProperty('vec4', 'vFiberD');
  // calculés par sommet (un segment fait 3 mm : rien ne varie plus vite) et
  // interpolés : transmission de l'autre paroi (et de la sienne pour le ruban
  // libre), grain du fil, soie fraîche — l'image coûte moins par fragment
  const vX = varyingProperty('vec4', 'vFiberX');
  const vN = varyingProperty('vec3', 'vFiberNs');
  m.positionNode = Fn(() => {
    const p0 = A.xyz, p1 = Bv.xyz, s0 = A.w, s1 = Bv.w;
    const S = free ? float(9) : own.S;
    // part visible du segment : rien si s0 ≥ S, coupé en S s'il le chevauche
    const f = clamp(S.sub(s0).div(s1.sub(s0).max(1e-7)), 0, 1);
    const end = mix(p0, p1, f);
    const t = positionGeometry.x, v = positionGeometry.y;
    const P = mix(p0, end, t).toVar();
    const camL = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
    // tangente continue d'un segment à l'autre (et la direction du segment si
    // elle n'est pas fournie : ruban libre)
    const tg = mix(T0.xyz, T1.xyz, t.mul(f));
    const dir = normalize(select(dot(tg, tg).greaterThan(0.25), tg, p1.sub(p0)));
    const toCam = camL.sub(P);
    const dist = length(toCam);
    const side = normalize(cross(dir, toCam.div(dist)));
    // demi-largeur : le rayon du fil, jamais moins de ~0,4 px ; nulle si caché
    // (×1,12 : les fils d'un ruban sont jointifs ; sans recouvrement, les jours
    // de 0,1 mm entre eux laissaient passer la lampe en points brillants)
    // (rien non plus si le segment est enfoui sous une couche posée après lui :
    // il ne se voit plus, et l'éclairer coûtait l'essentiel de l'image)
    const buried = free ? float(0) : step(T0.w.max(1e-4), S).mul(step(T0.w, 1.5));
    const w = max(U.d.mul(0.56), U.pix.mul(dist).mul(0.5)).mul(step0(s0, S)).mul(float(1).sub(buried));
    P.addAssign(side.mul(v).mul(w));
    vT.assign(normalize(modelWorldMatrix.mul(vec4(dir, 0)).xyz));
    vV.assign(vec2(v, U.d.div(U.pix.mul(dist).max(1e-6))));
    vD.assign(vec4(free ? C.x : mix(C.x, C.w, t), C.y.add(C.z), w, s0));
    const Pw = modelWorldMatrix.mul(vec4(P, 1)).xyz;
    const sv = mix(s0, s1, t.mul(f));
    const slub = noise(vec3(sv.mul(900), C.y.mul(3.1), 0.5)).mul(0.12);
    const fresh = free ? float(0) : exp(S.sub(sv).mul(U.total).max(0).div(-0.06));
    vX.assign(vec4(cookieOther(Pw), slub, fresh, free ? cookieOwn(Pw) : float(1)));
    vN.assign(normalize(modelWorldMatrix.mul(vec4(normalize(P), 0)).xyz));
    positionPrevious.assign(P);
    return P;
  })();

  m.outputNode = Fn(() => {
    const Pw = positionWorld;
    const V = normalize(cameraPosition.sub(Pw));
    const T = normalize(vT);
    const side = normalize(cross(T, V)), face = normalize(cross(side, T));
    // détail du fil selon sa taille à l'écran : sous ~2 px, la normale
    // cylindrique, les nuances fil à fil et l'étroitesse du reflet s'effacent
    // (sinon chaque fil scintille d'une image à l'autre)
    const fade = clamp(vV.y.sub(0.8).div(1.6), 0, 1);
    const v = clamp(vV.x, -1, 1).mul(fade.mul(0.85).add(0.15));
    const N = normalize(side.mul(v).add(face.mul(sqrt(max(float(0), float(1).sub(v.mul(v)))))));
    // normale de la paroi du cocon (le cocon est à peu près convexe autour du centre de la cage)
    const ns = normalize(vN);
    const nb = vD.x, k = vD.y, s = vD.w;
    // couleur : chaque fil sa nuance, et un grain le long du fil (fil irrégulier)
    const slub = vX.y.mul(fade).add(0.95);
    const alb = U.color.mul(fract(k.mul(0.618)).sub(0.5).mul(0.14).mul(fade).add(0.97)).mul(slub).mul(float(1).sub(U.metal));
    const rough = U.rough.mul(U.rough).add(float(1).sub(fade).mul(0.12)).sqrt();
    const e1 = float(2).div(rough.mul(rough)).min(400), e2 = float(2).div(rough.mul(rough).mul(4)).min(200);
    const fiber = (L, E, wrap = 0.25) => {
      const nl = dot(N, L);
      const diff = alb.mul(nl.mul(1 - wrap).add(wrap).max(0)).mul(1 / Math.PI);
      const H = normalize(L.add(V));
      const T1 = normalize(T.add(N.mul(U.shift))), T2 = normalize(T.sub(N.mul(U.shift.mul(2))));
      const sh1 = sqrt(max(float(0), float(1).sub(dot(T1, H).pow(2))));
      const sh2 = sqrt(max(float(0), float(1).sub(dot(T2, H).pow(2))));
      const lobeR = U.spec.mul(pow(sh1, e1)).mul(e1.add(2).mul(1 / (2 * Math.PI)).mul(0.12));
      const lobeTRT = mix(alb, U.color, U.metal).mul(pow(sh2, e2)).mul(e2.add(2).mul(1 / (2 * Math.PI)).mul(0.1));
      const spec = lobeR.add(lobeTRT).mul(smoothstep(-0.1, 0.25, nl));
      return E.mul(diff.add(spec));
    };
    // lumière de la pièce : la paroi tournée vers elle seulement (le cocon se
    // fait de l'ombre à lui-même)
    let col = fiber(U.keyDir, U.keyRad.mul(smoothstep(-0.25, 0.35, dot(ns, U.keyDir))));
    col = col.add(fiber(U.fillDir, U.fillRad.mul(smoothstep(-0.4, 0.3, dot(ns, U.fillDir)))));
    // l'autre lampe, à travers sa propre paroi
    const lampO = other.lampW, dO = lampO.sub(Pw), rO = length(dO), LO = dO.div(rO);
    const EO = U.lampRad.mul(vX.x).div(rO.mul(rO)).mul(free ? float(1) : smoothstep(-0.3, 0.3, dot(ns, LO)));
    col = col.add(fiber(LO, EO));
    // sa propre lampe : directe (vue par les jours, ou ruban libre), et la lueur
    // à travers les couches posées dessous
    const lampW = own.lampW, dW = lampW.sub(Pw), rW = length(dW), LW = dW.div(rW);
    const inv2 = float(1).div(rW.mul(rW));
    if (free) {
      col = col.add(fiber(LW, U.lampRad.mul(vX.w).mul(inv2)));
    } else {
      const under = exp(nb.mul(log(U.tau.max(1e-4))));
      col = col.add(fiber(LW, U.lampRad.mul(under).mul(inv2).mul(U.glowGain.mul(2).min(1)), 0));
      // diffusion vers l'avant dans la fibre : plus forte au bord du ruban (le
      // fil y est vu en épaisseur rasante)
      const rim = float(0.75).add(abs(v).mul(0.5).mul(fade));
      col = col.add(U.glowColor.mul(U.lampRad).mul(under).mul(U.tau).mul(inv2).mul(rim).mul(U.glowGain).mul(1 / Math.PI).mul(float(1).sub(U.metal)));
    }
    // soie fraîche : les derniers centimètres posés sont encore humides de
    // séricine et brillent davantage ; le point de pose se lit en mouvement
    if (!free) {
      const fresh = vX.z;
      col = col.mul(fresh.mul(0.6).add(1)).add(U.spec.mul(fresh).mul(0.08));
    }
    // ambiance : le rebond de la pièce
    col = col.add(alb.mul(mix(U.ambGround, U.ambSky, N.y.mul(0.5).add(0.5))));
    return vec4(col, 1);
  })();
  // profondeur d'un cylindre : chaque pixel du ruban est à la surface du fil
  // (deux fils voisins vus en biais se recouvrent sans scintiller)
  m.depthNode = viewZToPerspectiveDepth(positionView.z.add(vD.z.mul(sqrt(max(float(0), float(1).sub(vV.x.mul(vV.x)))))), cameraNear, cameraFar);
  m.mrtNode = stableVelocity();
  return m;
}

// 1 si le segment commence avant S (il est au moins en partie posé), sinon 0
const step0 = (s0, S) => select(s0.lessThan(S), float(1), float(0));
