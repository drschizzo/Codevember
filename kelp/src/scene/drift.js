// Ce qui flotte dans l'eau, autour du caisson : des grains en suspension (le
// signe le plus sûr qu'on est sous l'eau), quelques débris d'algue qui
// tournent, et des bulles qui montent là où l'eau est aérée.
//
// Quelques milliers de petits quadrilatères dans une boîte de 5 × 2,4 × 5 m
// autour de la caméra, repliée sur elle-même (un grain qui sort d'un côté
// rentre de l'autre, en fondu). Tout le nuage est emporté par l'eau au dôme :
// le déplacement intégré de la vitesse de la mer à la caméra, rendu
// périodique (la dérive moyenne de la boucle est retirée), et soulevé par la
// houle. Chaque grain a son petit tremblement, en harmoniques de la boucle.
// Éclairés par le soleil réfracté — à l'ombre d'une laminaire, ils
// s'éteignent : dans les rayons, ils scintillent.
import * as THREE from 'three/webgpu';
import { Fn, attribute, float, vec2, vec3, vec4, fract, sin, mix, smoothstep, uniform, length, max, min, positionWorld, cameraPosition, cameraWorldMatrix, select, mrt, hash, varying, exp, abs, dot, normalize } from 'three/tsl';
import { NZ } from '../../../shared/scene/materials.js';

export function createDrift(W, lite) {
  const { U } = W;
  const N = lite ? 2000 : 6000;
  const DU = { off: uniform(new THREE.Vector3()), box: uniform(new THREE.Vector3(2.5, 1.2, 2.5)), on: uniform(0) };
  const pid = attribute('pid', 'vec4'); // (numéro, coin x, coin y, —)
  const h = (k) => hash(pid.x.toUint().add(k * 7919));
  const kind = h(1); // (< 0,08 : bulle ; < 0,12 : débris d'algue ; sinon : grain)
  const isBub = kind.lessThan(0.08), isBit = kind.greaterThanEqual(0.08).and(kind.lessThan(0.12));
  const base = vec3(h(2), h(3), h(4)).mul(2).sub(1).mul(DU.box);
  // (le tremblement de chacun : harmoniques entières de la boucle, quelques centimètres)
  const ph = U.t.div(U.T).mul(2 * Math.PI);
  const wob = vec3(sin(ph.mul(3).add(h(5).mul(6.3))), sin(ph.mul(4).add(h(6).mul(6.3))), sin(ph.mul(5).add(h(7).mul(6.3)))).mul(0.03);
  // (les bulles montent : un nombre entier de traversées de la boîte par boucle)
  const rise = select(isBub, U.t.div(U.T).mul(7).mul(DU.box.y.mul(2)), float(0));
  const rel0 = base.add(DU.off).add(wob).add(vec3(0, rise, 0)).sub(cameraPosition);
  const span = DU.box.mul(2);
  const rel = fract(rel0.div(span).add(0.5)).mul(span).sub(DU.box);
  const C = cameraPosition.add(rel);
  const edge = max(max(abs(rel.x).div(DU.box.x), abs(rel.y).div(DU.box.y)), abs(rel.z).div(DU.box.z));
  // taille : grains de 1 à 3,5 mm, débris de 4 à 9 mm, bulles de 1 à 4 mm
  // (un grain sur six, plus gros, près du dôme : dans le flou de la mise au
  // point, une pastille de bokeh — c'est ce qu'on voit sur une prise sous l'eau)
  const size = select(isBit, h(8).mul(0.005).add(0.004), select(isBub, h(8).mul(0.003).add(0.0012), h(8).pow(2).mul(0.0025).add(0.001).mul(select(h(11).lessThan(0.16), float(2.2), float(1)))));
  const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz, upv = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz;
  // (un débris tourne sur lui-même)
  const ang = select(isBit, ph.mul(h(9).mul(4).add(1)).add(h(10).mul(6.3)), float(0));
  const ca = ang.cos(), sa = ang.sin();
  const cx = pid.y.mul(ca).sub(pid.z.mul(sa)).mul(select(isBit, float(1.8), float(1))), cy = pid.y.mul(sa).add(pid.z.mul(ca)).mul(select(isBit, float(0.45), float(1)));
  const P = C.add(right.mul(cx.mul(size))).add(upv.mul(cy.mul(size)));

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.fog = false;
  mat.side = THREE.DoubleSide;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  mat.positionNode = select(DU.on.greaterThan(0.5), P, vec3(0, -50, 0));
  const vC = varying(vec2(pid.y, pid.z)), vKind = varying(kind), vEdge = varying(edge), vCtr = varying(C);
  mat.outputNode = Fn(() => {
    const Pw = vCtr, d = length(vC).mul(2);
    const bub = vKind.lessThan(0.08), bit = vKind.greaterThanEqual(0.08).and(vKind.lessThan(0.12));
    // (une bulle : un anneau clair ; un grain, un débris : un point doux)
    const disc = select(bub, smoothstep(1, 0.75, d).mul(smoothstep(0.35, 0.75, d)).add(smoothstep(0.35, 0.0, length(vC.sub(vec2(-0.12, 0.15))).mul(2)).mul(0.6)), smoothstep(1, 0.2, d));
    const lvl = W.level(Pw.x, Pw.z, U.t);
    const depth = lvl.sub(Pw.y);
    const inWater = smoothstep(0.0, 0.03, depth);
    const sm = W.sea(Pw.x, Pw.z, U.t);
    // (les bulles ne se voient que dans l'eau aérée)
    const bubOK = select(bub, smoothstep(0.05, 0.35, sm.w), float(1));
    const near = smoothstep(0.06, 0.18, length(Pw.sub(cameraPosition)));
    const al = disc.mul(inWater).mul(bubOK).mul(near).mul(smoothstep(1.0, 0.8, vEdge)).mul(select(bit, float(0.9), select(bub, float(0.8), float(0.75)))).mul(DU.on);
    // éclairage : le soleil réfracté (atténué par la profondeur, éteint à l'ombre
    // d'une laminaire), vers l'avant à contre-jour, et la lueur de l'eau
    const vdir = normalize(Pw.sub(cameraPosition));
    const fwd = dot(vdir, vec3(U.sunDir)).max(0).pow(4).mul(2.5).add(0.4);
    const sunL = vec3(U.sunE).mul(max(U.sunDir.y, 0.1)).mul(exp(vec3(U.ext).mul(depth.max(0)).mul(1.4).negate())).mul(W.sunVis(Pw)).mul(fwd).mul(0.6);
    const amb = vec3(U.skyE).mul(exp(vec3(U.ext).mul(depth.max(0)).negate())).mul(0.3);
    const alb = select(bit, vec3(0.16, 0.12, 0.05), select(bub, vec3(0.9), vec3(0.75, 0.78, 0.72)));
    let rgb = alb.mul(sunL.add(amb)).add(select(bub, vec3(U.skyE).mul(0.25), vec3(0)));
    rgb = W.medium(Pw, cameraPosition, rgb);
    return vec4(rgb.mul(al), al);
  })();
  if (!lite) mat.mrtNode = mrt({ velocity: vec4(0) });

  const pidA = new Float32Array(N * 16), idx = new Uint32Array(N * 6);
  const cs = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  for (let q = 0; q < N; q++) {
    for (let k = 0; k < 4; k++) { const o = (q * 4 + k) * 4; pidA[o] = q; pidA[o + 1] = cs[k][0]; pidA[o + 2] = cs[k][1]; }
    const b = q * 4; idx.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 12), 3));
  geo.setAttribute('pid', new THREE.BufferAttribute(pidA, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  // le déplacement de l'eau au dôme, intégré sur la boucle et rendu périodique
  let path = null;
  function setData(u, eta, fps, side = 0.12) {
    const nf = u.length, dx = new Float32Array(nf), dy = new Float32Array(nf);
    let s = 0, m = 0;
    for (let f = 0; f < nf; f++) { dx[f] = s; s += u[f] / fps; m += eta[f] / nf; }
    for (let f = 0; f < nf; f++) { dx[f] -= (f / nf) * s; dy[f] = (eta[f] - m) * 0.5; } // (la dérive moyenne retirée : même place à 0 et à T)
    path = { nf, dx, dy, side };
    DU.on.value = 1;
  }
  function update(ph) {
    if (!path) return;
    const fr = ph * path.nf, f0 = Math.floor(fr) % path.nf, f1 = (f0 + 1) % path.nf, w = fr - Math.floor(fr);
    const x = path.dx[f0] * (1 - w) + path.dx[f1] * w, y = path.dy[f0] * (1 - w) + path.dy[f1] * w;
    DU.off.value.set(x, y, x * path.side);
  }
  return { mesh, setData, update, DU };
}
