// L'eau : des perles en calottes sphériques (angle de contact mesuré), une
// instance par emplacement (gen/crystal.js enregistre la fonte dans des
// emplacements stables), interpolées entre les images enregistrées.
//
// L'emplacement 0 est la goutte du centre : la perle gelée du début (laiteuse,
// dressée en pointe), qui fond au soleil et s'étale sur la glace, reçoit les
// perles qui remontent les bras, s'évapore, puis regèle en pointe.
//
// Une calotte de rayon de base a et d'angle de contact θ appartient à une
// sphère de rayon a / sin θ ; ses points sont paramétrés par (ρ, φ), ρ ∈ [0, 1]
// allant du sommet (ψ = 0) à la ligne de contact (ψ = θ). Sa normale est
// exacte. θ > 90° (une goutte sur la laine, qui perle) est permis.
//
// La goutte gelée : la glace, moins dense que l'eau, pousse le haut de la
// goutte en une pointe (angle d'ouverture ≈ 139°, Marín et al. 2014), et le
// front de gel, de bas en haut, chasse les bulles vers le centre : la perle
// devient laiteuse.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, uniformArray, instanceIndex, vec3, vec4, float, sin, cos, normalize, select, mix, max as tmax,
  smoothstep, positionPrevious, normalLocal, pow, abs, dot, normalView, positionViewDirection, refract, cameraViewMatrix,
  clamp, int, varyingProperty, positionLocal,
} from 'three/tsl';
import { MAX_BLOBS } from '../gen/crystal.js';
import { stableVelocity, isLite } from './materials.js';
import { backlight } from './backlight.js';

export function createWaterUniforms() {
  const arr = () => Array.from({ length: MAX_BLOBS }, () => new THREE.Vector4());
  const cur = arr(), prev = arr();
  return {
    cur, prev, BL: uniformArray(cur, 'vec4'), BLP: uniformArray(prev, 'vec4'),
    theta: uniform(0.5), theta0: uniform(1.6), thetaP: uniform(0.5), theta0P: uniform(1.6),
    tip: uniform(1), freezeFront: uniform(1.2),
  };
}

// point et normale d'une calotte
function cap(b, th, cp, tip) {
  const a = b.z;
  const s = sin(th).max(1e-3);
  const Rs = a.div(s);
  const zc = Rs.mul(cos(th)).negate();
  const psi = cp.x.mul(th);
  const dir = vec3(sin(psi).mul(cos(cp.y)), sin(psi).mul(sin(cp.y)), cos(psi));
  // pointe de la goutte gelée (près du sommet)
  const near = smoothstep(0.45, 0, cp.x);
  const lift = tip.mul(Rs).mul(0.32).mul(near.mul(near));
  const p = vec3(b.x, b.y, zc).add(dir.mul(Rs)).add(vec3(0, 0, lift));
  const nrm = normalize(vec3(dir.xy.mul(float(1).add(tip.mul(near).mul(2.2))), dir.z));
  return { p, nrm };
}

export function buildWaterMaterial(U, { backlit = null } = {}) {
  const lite = isLite();
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.FrontSide });
  const cp = attribute('cp', 'vec2');
  const vFrozen = varyingProperty('float', 'vFrozen');
  const vH = varyingProperty('float', 'vH');
  m.positionNode = Fn(() => {
    const k = instanceIndex;
    const isC = k.equal(int(0));
    const b = U.BL.element(k), bp = U.BLP.element(k);
    const th = select(isC, U.theta0, U.theta), thp = select(isC, U.theta0P, U.thetaP);
    const tip = select(isC, U.tip, float(0));
    const C = cap(b, th, cp, tip);
    normalLocal.assign(C.nrm);
    // (le front de gel monte de la ligne de contact, ρ = 1, vers le sommet)
    const ff = U.freezeFront;
    vFrozen.assign(select(isC, smoothstep(ff.add(0.15), ff.sub(0.15), float(1).sub(cp.x)), float(0)));
    vH.assign(b.z);
    if (!lite) positionPrevious.assign(cap(bp, thp, cp, tip).p);
    return C.p;
  })();
  // (une perle vide est réduite à un point : rien à dessiner)
  m.maskNode = vH.greaterThan(0.0015);

  const fz = vFrozen;
  m.metalnessNode = float(0);
  m.roughnessNode = mix(float(0.008), float(0.22), fz);
  m.iorNode = mix(float(1.333), float(1.31), fz);
  m.specularIntensityNode = float(1);
  if (backlit) {
    const N = normalView, V = positionViewDirection.negate();
    const d1 = refract(V, N, 1 / 1.333);
    const up = normalize(cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz);
    const d2 = refract(d1, up, 1.333);
    const bad = dot(d2, d2).lessThan(0.5);
    const Lb = select(bad, vec3(0), backlight(backlit, clamp(dot(normalize(d2), V), -1, 1)));
    const fres = pow(float(1).sub(abs(dot(N, positionViewDirection))), 5).mul(0.97).add(0.02);
    m.colorNode = vec4(mix(vec3(0), vec3(0.75, 0.78, 0.82), fz), 1);
    m.emissiveNode = mix(Lb, backlit.field.mul(0.35), fz.mul(0.8)).mul(float(1).sub(fres));
  } else if (!lite) {
    m.colorNode = vec4(mix(vec3(1), vec3(0.93, 0.95, 0.98), fz), 1);
    m.transmissionNode = mix(float(1), float(0.25), fz);
    m.thicknessNode = float(0.25);
  } else {
    m.transparent = true;
    m.colorNode = vec4(mix(vec3(0.5, 0.55, 0.6), vec3(0.9, 0.93, 0.97), fz), 1);
    const fres = pow(float(1).sub(abs(dot(normalView, positionViewDirection))), 3);
    m.opacityNode = clamp(float(0.25).add(fres.mul(0.6)).add(fz.mul(0.6)), 0, 1);
  }
  m.mrtNode = stableVelocity();
  return m;
}

// ombre des perles : un double opaque (une matière à transmission ne porte
// pas d'ombre dans three.js), moins dense au centre de la lentille
export const SHADOW_LAYER = 2;
export function buildWaterShadow(U, waterMat) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.positionNode = waterMat.positionNode;
  m.castShadowNode = vec4(0.45, 0.48, 0.52, 1);
  return m;
}

// gabarit d'une calotte : anneaux resserrés au sommet et à la ligne de contact
export function capGeometry(rings = 22, segs = 56) {
  const cp = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, rho = 0.85 * (0.5 - 0.5 * Math.cos(Math.PI * t)) + 0.15 * t;
    for (let j = 0; j <= segs; j++) cp.push(rho, (j / segs) * Math.PI * 2);
  }
  const row = segs + 1;
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.InstancedBufferGeometry();
  const n = cp.length / 2;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) nor[i * 3 + 2] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('cp', new THREE.BufferAttribute(new Float32Array(cp), 2));
  g.setIndex(idx);
  g.instanceCount = MAX_BLOBS;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  return g;
}
