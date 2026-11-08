// Projection d'une cellule, de ses coordonnées locales à l'écran, dans le
// vertex shader.
//
//   l ∈ [-1, 1]³ (coordonnées locales, attribut position)
//   y = A·(l, 1)                     point 4D : plongement de la cellule dans
//                                    son hyperplan, dépliage, rotation 4D
//                                    (matrice propre au maillage, calculée en JS)
//   y' = y·(1 + g·(2/|y| − 1))       gonflement vers la 3-sphère de rayon 2
//                                    (g = 0 : arêtes droites ; g = 1 : arcs)
//   p = y'.xyz · d / (d − y'.w)      perspective depuis l'œil 4D (0, 0, 0, d)
//
// La normale est transportée par la jacobienne J = ∂p/∂l (différences finies) :
// n' = cof(J)·n. Sans le signe du déterminant : quand une cellule est vue « de
// l'autre côté » en 4D, sa projection est en miroir, ses triangles changent de
// sens, et la normale est retournée une seconde fois par le sens de la face
// (matériaux double face) — elle sort toujours de la matière.
//
// Les panneaux tournés vers l'œil 4D (la coque extérieure du tesseract plié,
// qui cacherait tout) s'ajourent : le point d'ancrage de la face (attribut
// `anchor`) donne sa coordonnée w, et la plaque se perce de trous qui
// grandissent jusqu'à l'effacer (voir revealMask) ; ils se referment quand la
// cellule revient se coucher dans le patron.
//
// Le même calcul, avec les paramètres de l'image précédente, donne la
// position précédente (vecteurs vitesse : flou de mouvement, anticrénelage
// temporel) ; la carte d'ombre reçoit la même déformation.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, vec3, vec4, float, length, cross, normalize, positionGeometry, normalLocal, tangentLocal, positionPrevious,
  varyingProperty, abs, dot, pow, attribute, smoothstep, fract, vec2, mat2, modelWorldMatrix, max, mix,
} from 'three/tsl';
import { G } from './globals.js';

export const mapPoint = (l, A, d, infl) => {
  const y = A.mul(vec4(l, 1));
  const k = infl.mul(float(2).div(length(y).max(1e-4)).sub(1)).add(1);
  const ys = y.mul(k);
  return ys.xyz.mul(d.div(d.sub(ys.w).max(0.05)));
};

// échelle locale → objet (racine cubique du |déterminant| de J), pour le relief
export const localScale = varyingProperty('float', 'vLocalScale');

// uniformes propres à un maillage
export function meshUniforms() {
  return { A: uniform(new THREE.Matrix4()), Aprev: uniform(new THREE.Matrix4()), seedOff: uniform(new THREE.Vector3()) };
}
// matrice ligne-major (math4.cellMatrix) → uniforme
export function setMatrix(u, m) {
  u.value.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[12], m[13], m[14], m[15]);
}

// ouverture du panneau (0 : plein ; 1 : effacé)
export const revealOpen = varyingProperty('float', 'vReveal');
// coordonnée w (profondeur 4D) du sommet, avant projection
export const depthW = varyingProperty('float', 'vDepthW');
// couleur de la profondeur 4D (froid → chaud quand w va de −1 à 1)
export const depthColor = (w) => mix(G.depthCold, G.depthWarm, smoothstep(-1, 1, w));

// masque d'ajourage : trous ronds sur une trame à 45° dans le plan de la
// pièce, de rayon croissant avec l'ouverture
export function revealMask(pat) {
  const q = mat2(0.7071, -0.7071, 0.7071, 0.7071).mul(pat.xy).mul(G.revealDensity);
  const d = fract(q).sub(0.5).length();
  return d.greaterThan(revealOpen.mul(0.78));
}

export function projectPosition(U, full, reveal = false) {
  return Fn(() => {
    const l = positionGeometry;
    if (reveal) {
      const anc = attribute('anchor', 'vec3');
      const w = U.A.mul(vec4(anc, 1)).w;
      // coupe côté caméra : la face (de la cellule vers le centre de la face,
      // une fois projetée) regarde-t-elle la caméra ?
      const pa = modelWorldMatrix.mul(vec4(mapPoint(anc, U.A, G.d, G.inflate), 1)).xyz;
      const pc = modelWorldMatrix.mul(vec4(mapPoint(vec3(0), U.A, G.d, G.inflate), 1)).xyz;
      const facing = dot(normalize(pa.sub(pc)), normalize(G.viewPos.sub(pa)));
      revealOpen.assign(max(smoothstep(G.revealLo, G.revealHi, w).mul(G.reveal), smoothstep(0.2, 0.85, facing).mul(G.cutaway)));
    }
    depthW.assign(U.A.mul(vec4(l, 1)).w);
    const p = mapPoint(l, U.A, G.d, G.inflate).toVar('p4');
    if (full) {
      const e = 0.003;
      const jx = mapPoint(l.add(vec3(e, 0, 0)), U.A, G.d, G.inflate).sub(p).div(e);
      const jy = mapPoint(l.add(vec3(0, e, 0)), U.A, G.d, G.inflate).sub(p).div(e);
      const jz = mapPoint(l.add(vec3(0, 0, e)), U.A, G.d, G.inflate).sub(p).div(e);
      const n = normalLocal;
      const cn = cross(jy, jz).mul(n.x).add(cross(jz, jx).mul(n.y)).add(cross(jx, jy).mul(n.z));
      normalLocal.assign(cn.div(length(cn).max(1e-9)));
      const t = tangentLocal;
      const ct = jx.mul(t.x).add(jy.mul(t.y)).add(jz.mul(t.z));
      tangentLocal.assign(ct.div(length(ct).max(1e-9)));
      localScale.assign(pow(abs(dot(jx, cross(jy, jz))).max(1e-9), 1 / 3));
      positionPrevious.assign(mapPoint(l, U.Aprev, G.dPrev, G.inflatePrev));
    }
    return p;
  })();
}
