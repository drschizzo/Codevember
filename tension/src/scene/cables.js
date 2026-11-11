// Câbles : un seul maillage instancié (un tube générique, gen/build.js ·
// cableTube), posé dans le vertex shader d'après deux tableaux d'uniformes :
// A[k] = (extrémité a, flèche f), B[k] = (extrémité b, rayon). Un câble tendu
// est droit ; un câble mou (plus long que la distance de ses extrémités) pend
// en arc de parabole dans le plan qui contient la corde et la verticale, de
// flèche f telle que la longueur de l'arc vaille sa longueur au repos
// (gen/cable.js · sagOf, même formule pour les tests).
// Tresse : un relief hélicoïdal le long du câble (normale perturbée), qui
// accroche un filet de lumière en spirale.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, uniformArray, instanceIndex, vec3, vec4, float, sin, cos, normalize, cross, dot, mix, abs, length,
  normalLocal, positionPrevious, varyingProperty, smoothstep, fract, select, max as tmax, cameraPosition, modelWorldMatrix,
} from 'three/tsl';
import { stableVelocity, isLite } from './materials.js';
import { G } from './globals.js';

export const MAX_CABLES = 64;

export function createCableUniforms() {
  const arr = () => Array.from({ length: MAX_CABLES }, () => new THREE.Vector4());
  const A = arr(), B = arr(), AP = arr(), BP = arr();
  return {
    A, B, AP, BP, UA: uniformArray(A, 'vec4'), UB: uniformArray(B, 'vec4'), UAP: uniformArray(AP, 'vec4'), UBP: uniformArray(BP, 'vec4'),
    color: uniform(new THREE.Color('#202022')), metal: uniform(0), rough: uniform(0.5), braid: uniform(1), sheen: uniform(0.3),
    pxScale: uniform(0.001), // (taille d'un pixel à une unité de distance : le câble ne descend pas sous ~0,7 px)
  };
}

// point et repère du câble k à l'abscisse s : p, tangente t, normale principale n, binormale b
function frameAt(a, b, s) {
  const ax = a.xyz, bx = b.xyz, f = a.w;
  const ch = bx.sub(ax), L = length(ch).max(1e-5), t0 = ch.div(L);
  // direction de la flèche : la verticale descendante, projetée hors de la corde
  const g = vec3(0, -1, 0), gp = g.sub(t0.mul(dot(g, t0)));
  const gl = length(gp);
  const d = select(gl.greaterThan(1e-3), gp.div(gl.max(1e-3)), normalize(cross(t0, vec3(1, 0, 0.3))));
  const fs = f.mul(select(gl.greaterThan(1e-3), float(1), float(0))).mul(smoothstep(0, 0.15, gl));
  const p = ax.add(ch.mul(s)).add(d.mul(fs.mul(4).mul(s).mul(float(1).sub(s))));
  const tang = normalize(ch.add(d.mul(fs.mul(4).mul(float(1).sub(s.mul(2))))));
  const bn = normalize(cross(tang, d));
  const nn = cross(bn, tang);
  return { p, tang, nn, bn };
}

export function buildCableMaterial(U) {
  const lite = isLite();
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.FrontSide });
  const cab = attribute('cab', 'vec2');
  const vS = varyingProperty('vec2', 'vCab'); // (abscisse en unités, angle)
  const place = (UA, UB, full) => Fn(() => {
    const k = instanceIndex;
    const a = UA.element(k), b = UB.element(k);
    const s = cab.x, ph = cab.y;
    const F = frameAt(a, b, s);
    // rayon apparent plancher (~0,7 px) : un câble de 1 mm reste un trait à 2 m
    const dCam = length(F.p.sub(cameraPosition)).max(0.1);
    const r = tmax(b.w, dCam.mul(U.pxScale).mul(0.7));
    const nrm = F.nn.mul(cos(ph)).add(F.bn.mul(sin(ph)));
    if (full) { normalLocal.assign(nrm); vS.assign(vec3(s.mul(length(b.xyz.sub(a.xyz))), ph, 0).xy); }
    return F.p.add(nrm.mul(r));
  })();
  m.positionNode = Fn(() => {
    if (!lite) positionPrevious.assign(place(U.UAP, U.UBP, false));
    return place(U.UA, U.UB, true);
  })();
  m.castShadowPositionNode = place(U.UA, U.UB, false);
  // tresse : 8 fils en hélice (pas ≈ 6 diamètres), relief dans la rugosité et la teinte
  const along = vS.x, ph = vS.y;
  const helix = fract(along.mul(42).add(ph.mul(8 / (2 * Math.PI))));
  const tri = abs(helix.mul(2).sub(1));
  const ridge = smoothstep(0.15, 0.85, tri).mul(U.braid);
  m.colorNode = vec4(U.color.mul(mix(float(1), float(0.72), ridge)), 1);
  m.metalnessNode = U.metal;
  m.roughnessNode = U.rough.add(ridge.mul(0.12)).clamp(0.05, 1);
  if (!lite) { m.sheenNode = U.color.mul(U.sheen).add(vec3(0.04)); m.sheenRoughnessNode = float(0.45); }
  m.mrtNode = stableVelocity();
  void G; void modelWorldMatrix;
  return m;
}

export function cableGeometry(o, count) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('cab', new THREE.BufferAttribute(o.cab, 2));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.instanceCount = count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}
