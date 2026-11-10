// Le cristal de glace, dans le vertex shader : il pousse et fond selon les
// instants d'attachement T et de fonte M de chaque cellule (voir
// gen/crystal.js pour la formule de l'épaisseur signée v).
//
// Matière : glace claire (n = 1,31), presque sans diffusion. Une plaque de
// 30 µm ne se voit que par sa surface : les nervures et les marches de
// croissance inclinent la normale, qui renvoie le ciel (reflets) et dévie la
// lumière transmise. Deux façons de rendre cette lumière transmise :
//  - sur un support opaque (laine, velours, feuille, ardoise), la transmission
//    physique de three.js : on voit le support à travers ;
//  - sur un support éclairé par en dessous (verre sur table lumineuse,
//    saphir de Rheinberg), on calcule la déviation δ du rayon par les deux
//    faces de la plaque et on lit la lumière du dessous dans cette direction
//    (backlight(δ), scene/backlight.js) : les pentes fortes renvoient le
//    bord du champ lumineux (traits sombres sur le verre, couleur de l'anneau
//    en Rheinberg). C'est ainsi qu'on voit les flocons sur les photographies.
// Quand la fonte commence, la surface se mouille : un film d'eau la rend plus
// lisse et plus brillante (« vernie »).
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, vec2, vec3, vec4, float, normalize, clamp, max as tmax, min as tmin, mix, smoothstep,
  varyingProperty, positionPrevious, normalLocal, positionGeometry, normalView, positionViewDirection, dot, abs, pow, refract,
  cameraViewMatrix, modelWorldMatrix, select, length, transformNormalToView,
} from 'three/tsl';
import { G, stableVelocity, isLite } from './materials.js';
import { backlight } from './backlight.js';

const S = (x) => smoothstep(0, 1, x);
const dS = (x) => { const c = clamp(x, 0, 1); return c.mul(float(1).sub(c)).mul(6); };

export function createIceUniforms() {
  return {
    tg: uniform(0), sm: uniform(0), tgP: uniform(0), smP: uniform(0),
    tau: uniform(0.02), tauM: uniform(0.02), h0: uniform(0.03),
    wet: uniform(0), irid: uniform(0.5), rough: uniform(0.035), relief: uniform(1.0),
    tint: uniform(new THREE.Color(0.94, 0.97, 1.0)),
  };
}

// épaisseur signée et son gradient (repère du cristal, mm)
function field(U, t, s) {
  const A = attribute('ca', 'vec4'), B = attribute('cb', 'vec4'), C = attribute('cc', 'vec4');
  const h = A.x, T = A.y, M = A.z;
  const xg = t.sub(T).div(U.tau), xm = s.sub(M).div(U.tauM);
  const g = S(xg), m = S(xm);
  const amp = h.add(U.h0.mul(0.5));
  const v = amp.mul(g).mul(float(1).sub(m)).sub(U.h0.mul(0.5));
  // ∇v = ∇h·g(1−m) + amp·[g'(−∇T/τ)(1−m) − g·m'(−∇M/τm)]
  const dgx = dS(xg).div(U.tau).negate(), dmx = dS(xm).div(U.tauM).negate();
  const gv = B.xy.mul(g.mul(float(1).sub(m)))
    .add(B.zw.mul(dgx).mul(float(1).sub(m)).mul(amp))
    .sub(C.xy.mul(dmx).mul(g).mul(amp));
  return { v, gv, h, edge: C.z };
}

export function buildIceMaterial(U, { backlit = null } = {}) {
  const lite = isLite();
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.FrontSide });
  const vThick = varyingProperty('float', 'vThick');
  const vRel = varyingProperty('float', 'vRel'); // (épaisseur relative : irisation des parties minces)
  m.positionNode = Fn(() => {
    const F = field(U, U.tg, U.sm);
    const z = tmax(F.v, 0).mul(U.relief);
    // pente seulement là où la glace existe (sinon la normale de la marge)
    const on = smoothstep(-0.002, 0.0005, F.v);
    const grad = F.gv.mul(U.relief).mul(on);
    normalLocal.assign(normalize(vec3(grad.x.negate(), grad.y.negate(), 1)));
    vThick.assign(F.v);
    vRel.assign(clamp(F.v.div(U.h0), 0, 1.5));
    if (!lite) {
      const P = field(U, U.tgP, U.smP);
      positionPrevious.assign(vec3(positionGeometry.x, positionGeometry.y, tmax(P.v, 0).mul(U.relief)));
    }
    return vec3(positionGeometry.x, positionGeometry.y, z);
  })();
  m.maskNode = vThick.greaterThan(0.0004);

  const wet = U.wet;
  m.colorNode = vec4(U.tint, 1);
  m.metalnessNode = float(0);
  m.roughnessNode = mix(U.rough, float(0.012), wet);
  m.iorNode = float(1.31);
  m.specularIntensityNode = float(1);
  // irisation : les zones minces (quelques µm) des plaques
  m.iridescenceNode = U.irid.mul(smoothstep(0.75, 0.25, vRel)).mul(float(1).sub(wet.mul(0.7)));
  m.iridescenceIORNode = float(1.31);
  m.iridescenceThicknessNode = mix(float(300), float(900), vRel);
  // film d'eau : un vernis
  m.clearcoatNode = wet.mul(0.9);
  m.clearcoatRoughnessNode = float(0.01);

  if (backlit) {
    // lumière transmise calculée : déviation par la face du dessus (normale N)
    // puis par la face du dessous (plane, contre le support)
    const N = normalView, V = positionViewDirection.negate(); // (V : de l'œil vers le point)
    const d1 = refract(V, N, 1 / 1.31);
    const up = normalize(cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz);
    const d2 = refract(d1, up, 1.31); // (sortie par le dessous, vers la table lumineuse)
    const bad = dot(d2, d2).lessThan(0.5); // (réflexion totale : aucun rayon ne sort)
    const cosd = clamp(dot(normalize(d2), V), -1, 1);
    const Lb = select(bad, vec3(0), backlight(backlit, cosd));
    const fres = pow(float(1).sub(abs(dot(N, positionViewDirection))), 5).mul(0.97).add(0.02);
    m.colorNode = vec4(0, 0, 0, 1);
    m.emissiveNode = Lb.mul(float(1).sub(fres));
  } else if (!lite) {
    // un cristal de neige paraît argenté : la lumière qui y entre ressort en
    // partie après des réflexions totales sur ses nervures et ses marches ; une
    // part diffuse, plus forte là où la surface s'incline (nervures, bords)
    const slope = float(1).sub(abs(normalLocal.z)).mul(8).clamp(0, 1);
    const scatter = mix(float(0.05), float(0.28), slope).mul(float(1).sub(wet.mul(0.6)));
    m.transmissionNode = float(1).sub(scatter);
    m.colorNode = vec4(U.tint, 1);
    m.thicknessNode = vThick.max(0).mul(6);
    m.attenuationColorNode = vec3(0.92, 0.97, 1);
    m.attenuationDistanceNode = float(2);
  } else {
    m.transparent = true;
    const fres = pow(float(1).sub(abs(dot(normalView, positionViewDirection))), 4);
    m.opacityNode = clamp(float(0.12).add(fres.mul(0.7)), 0, 1);
  }
  m.mrtNode = stableVelocity();
  return m;
}

// maillage du cristal (repère du cristal : plan xy, z vers le haut ; le
// groupe parent le couche sur le support)
export function iceGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  const n = o.position.length / 3;
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) nor[i * 3 + 2] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('ca', new THREE.BufferAttribute(o.A, 4));
  g.setAttribute('cb', new THREE.BufferAttribute(o.B, 4));
  g.setAttribute('cc', new THREE.BufferAttribute(o.C, 4));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), o.radius + 0.1);
  return g;
}
