// Projection d'une cellule, de ses coordonnées locales à l'écran, dans le
// vertex shader.
//
//   l ∈ [-1, 1]³ (coordonnées locales, attribut position)
//   y = A·(l, 1)                     point 4D : plongement de la cellule dans
//                                    son hyperplan, dépliage, rotation 4D
//                                    (matrice propre au maillage, calculée en JS)
//   y' = k·y, k = 1 + g·(2/|y| − 1)  gonflement vers la 3-sphère de rayon 2
//                                    (g = 0 : arêtes droites ; g = 1 : arcs)
//   p = s·y'.xyz, s = d / (d − y'.w) perspective depuis l'œil 4D (0, 0, 0, d)
//
// La normale est transportée par la jacobienne J = ∂p/∂l, calculée en forme
// fermée (voir projectWithJacobian) : n' = cof(J)·n. Sans le signe du
// déterminant : quand une cellule est vue « de l'autre côté » en 4D, sa
// projection est en miroir, ses triangles changent de sens, et la normale est
// retournée une seconde fois par le sens de la face (matériaux double face) —
// elle sort toujours de la matière.
//
// Les panneaux s'ajourent face par face (coque tournée vers l'œil 4D, coupe
// côté caméra, parois traversées pendant le voyage, portes) : l'ouverture de
// chaque face est calculée en JS une fois par image (voir reveal.js) ; le
// shader la lit selon la face de la pièce (attribut `anchor`) et perce la
// plaque de trous qui grandissent jusqu'à l'effacer (voir revealMask).
//
// Le même calcul, avec les paramètres de l'image précédente, donne la
// position précédente (vecteurs vitesse : flou de mouvement, anticrénelage
// temporel) ; la carte d'ombre reçoit la même déformation.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uniformArray, vec3, vec4, float, length, cross, positionGeometry, normalLocal, tangentLocal, positionPrevious,
  varyingProperty, abs, dot, pow, attribute, smoothstep, fract, mat2, mix, step,
} from 'three/tsl';
import { G } from './globals.js';

// point local → espace projeté
export const mapPoint = (l, A, d, infl) => {
  const y = A.mul(vec4(l, 1));
  const k = infl.mul(float(2).div(length(y).max(1e-4)).sub(1)).add(1);
  const ys = y.mul(k);
  return ys.xyz.mul(d.div(d.sub(ys.w).max(0.05)));
};

// Point projeté et jacobienne J = ∂p/∂l (ses trois colonnes), en forme fermée.
// Pour une colonne a de A (l'image d'un axe local) :
//   dy' = k·a − (2g / |y|³)·(y·a)·y          (dérivée du gonflement)
//   dp  = s·dy'.xyz + (s² / d)·dy'.w·y'.xyz  (dérivée de la perspective ;
//                                             nulle en w là où s est borné)
// Plus juste que des différences finies (en float32, elles se dégradaient
// près de l'œil 4D, où d − w devient petit), et trois projections de moins.
function projectWithJacobian(l, A, d, g) {
  const y = A.mul(vec4(l, 1));
  const r = length(y).max(1e-4);
  const k = g.mul(float(2).div(r).sub(1)).add(1);
  const ys = y.mul(k);
  const den = d.sub(ys.w);
  const s = d.div(den.max(0.05));
  const c = g.mul(2).div(r.mul(r).mul(r));
  const sw = s.mul(s).div(d).mul(step(0.05, den));
  const column = (a) => {
    const dy = a.mul(k).sub(y.mul(c.mul(dot(y, a))));
    return dy.xyz.mul(s).add(ys.xyz.mul(sw.mul(dy.w)));
  };
  return {
    y, p: ys.xyz.mul(s),
    jx: column(A.mul(vec4(1, 0, 0, 0))), jy: column(A.mul(vec4(0, 1, 0, 0))), jz: column(A.mul(vec4(0, 0, 1, 0))),
  };
}

// échelle locale → objet (racine cubique du |déterminant| de J), pour le relief
export const localScale = varyingProperty('float', 'vLocalScale');

// uniformes propres à un maillage
export function meshUniforms() {
  return { A: uniform(new THREE.Matrix4()), Aprev: uniform(new THREE.Matrix4()) };
}
// ouverture des six faces d'une cellule (0 : pleine ; 1 : effacée), partagée
// par ses panneaux et son verre (voir reveal.js)
export const faceOpenings = () => uniformArray(new Array(6).fill(0), 'float');
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

// face d'une pièce de panneau (2k + (σ > 0)) d'après son ancrage, le centre
// de la face : une seule de ses coordonnées est non nulle
const faceOfAnchor = (anc) => dot(step(1e-3, abs(anc)), vec3(0, 2, 4)).add(step(0, anc.x.add(anc.y).add(anc.z)));

// Ossature, une fois le tesseract plié (voir scene/tesseract.js) : les barres
// et les nœuds se rétractent dans leurs axes (U.keep : 1 en place, 0 rentrés).
// L'attribut anchor donne l'axe de la pièce (voir gen/cell.js, buildFrame) :
// la coordonnée libre d'une barre vaut 10 + son numéro, les autres sont
// celles de son axe ; un nœud a pour ancrage son centre.
export function frameMerge(U) {
  return (l) => {
    const anc = attribute('anchor', 'vec3');
    const free = step(5, abs(anc)); // (axe d'une barre)
    const ctr = anc.mul(vec3(1).sub(free)).add(l.mul(free));
    return ctr.add(l.sub(ctr).mul(U.keep));
  };
}

// U : uniformes du maillage ; full : passe principale (normale, tangente,
// relief, position précédente) ou carte d'ombre (position seule) ; open :
// ouvertures des faces (panneaux) ; pre : déformation locale avant projection
export function projectPosition(U, full, open = null, pre = null) {
  return Fn(() => {
    const l = pre ? pre(positionGeometry).toVar('lMerged') : positionGeometry;
    if (open) revealOpen.assign(open.element(faceOfAnchor(attribute('anchor', 'vec3')).toInt()));
    if (!full) return mapPoint(l, U.A, G.d, G.inflate);
    const { y, p, jx, jy, jz } = projectWithJacobian(l, U.A, G.d, G.inflate);
    depthW.assign(y.w);
    const n = normalLocal;
    const cn = cross(jy, jz).mul(n.x).add(cross(jz, jx).mul(n.y)).add(cross(jx, jy).mul(n.z));
    normalLocal.assign(cn.div(length(cn).max(1e-9)));
    const t = tangentLocal;
    const ct = jx.mul(t.x).add(jy.mul(t.y)).add(jz.mul(t.z));
    tangentLocal.assign(ct.div(length(ct).max(1e-9)));
    localScale.assign(pow(abs(dot(jx, cross(jy, jz))).max(1e-9), 1 / 3));
    positionPrevious.assign(mapPoint(l, U.Aprev, G.dPrev, G.inflatePrev));
    return p;
  })();
}
