// Photoélasticité : la membrane tendue devient biréfringente, et la lumière
// polarisée qui la traverse en ressort colorée (teintes de Michel-Lévy).
//
// La pose fournit, par sommet, le déviateur logarithmique de la déformation E
// (voir STRAIN dans gpusim.js). Au pixel :
//   - E est ramené dans le repère de la vue et projeté sur le plan de l'image :
//     écart des étirements principaux Δ, et angle θ de l'axe principal ;
//   - retard Γ = C·Δ·h (nm), h : épaisseur optique traversée (amincie en 1/J,
//     épaissie en incidence rasante), C : sensibilité de la matière ;
//   - calcul de Jones, pour chaque longueur d'onde : polariseur (angle φ),
//     membrane (lame de retard Γ, axe θ), lame teinte sensible facultative
//     (λ = 550 nm, à 45°), analyseur croisé ou parallèle ;
//   - intensités intégrées sur le spectre (fonctions colorimétriques CIE 1931,
//     approximation de Wyman, Sloan et Shirley 2013), en sRGB linéaire,
//     normalisées sur le blanc.
// En lumière polarisée circulaire, les bandes sombres de l'axe (isoclines)
// disparaissent : il ne reste que les franges de même retard (isochromes).
import { Fn, vec3, float, sin, cos, atan, sqrt, dot, mix, modelViewMatrix, modelScale } from 'three/tsl';
import { G } from './globals.js';

// ── Pondérations spectrales ──────────────────────────────────────────────────
const LAMBDAS = [];
const NL = 16;
for (let i = 0; i < NL; i++) LAMBDAS.push(400 + (300 * (i + 0.5)) / NL);
const g = (l, mu, s1, s2) => { const t = (l - mu) / (l < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
const cie = (l) => [
  1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
  0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
  1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8),
];
const toRGB = ([X, Y, Z]) => [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
const W = LAMBDAS.map((l) => toRGB(cie(l)));
{
  const sum = [0, 1, 2].map((c) => W.reduce((s, w) => s + w[c], 0));
  for (const w of W) for (let c = 0; c < 3; c++) w[c] /= sum[c];
}
// lame teinte sensible (onde entière à 550 nm) : sin et cos de son demi-retard
const PLATE = 550;
const PL = LAMBDAS.map((l) => [Math.sin((Math.PI * PLATE) / l), Math.cos((Math.PI * PLATE) / l)]);

// teinte de Michel-Lévy (JS, pour vérifier la table : Γ en nm, polariseurs croisés)
export function michelLevy(G0) {
  const c = [0, 0, 0];
  LAMBDAS.forEach((l, i) => { const s = Math.sin((Math.PI * G0) / l) ** 2; for (let k = 0; k < 3; k++) c[k] += W[i][k] * s; });
  return c;
}

// facteur de transmission (vec3, 1 = inchangé) d'une membrane photoélastique.
// A = (Exx, Eyy, Ezz), B = (Exy, Eyz, Ezx) dans le repère de la couche ;
// C : sensibilité (nm par unité de déformation), h : épaisseur optique relative
export const photoelastic = Fn(([A, B, C, h]) => {
  // lignes de la rotation modèle → vue (l'échelle de la couche est uniforme)
  const mv = modelViewMatrix, sc = modelScale.x;
  const r0 = vec3(mv.element(0).x, mv.element(1).x, mv.element(2).x).div(sc);
  const r1 = vec3(mv.element(0).y, mv.element(1).y, mv.element(2).y).div(sc);
  const Ev = (v) => vec3(
    A.x.mul(v.x).add(B.x.mul(v.y)).add(B.z.mul(v.z)),
    B.x.mul(v.x).add(A.y.mul(v.y)).add(B.y.mul(v.z)),
    B.z.mul(v.x).add(B.y.mul(v.y)).add(A.z.mul(v.z)));
  const a = dot(r0, Ev(r0)), b = dot(r1, Ev(r1)), c = dot(r0, Ev(r1));
  const amb = a.sub(b);
  // écart des étirements principaux (projetés) et axe principal
  const delta = sqrt(amb.mul(amb).add(c.mul(c).mul(4)).add(1e-12));
  const th = atan(c.mul(2), amb).mul(0.5);
  const gamma = C.mul(delta).mul(h); // retard (nm)
  const phi = G.polAngle.add(G.polTurns.mul(G.phase).mul(Math.PI));
  const t2 = th.sub(phi).mul(2);
  const C1 = cos(t2), S1 = sin(t2);
  const plate = G.polPlate, circ = G.polCirc, cross = G.polCross;
  let rgb = vec3(0);
  LAMBDAS.forEach((l, i) => {
    const d = gamma.mul(Math.PI / l);
    const s1 = sin(d), c1 = cos(d);
    const s2 = plate.mul(PL[i][0]), c2 = mix(float(1), float(PL[i][1]), plate);
    // polariseurs croisés : composante transmise par l'analyseur (Jones)
    const re = s1.mul(s2).mul(C1);
    const im = s2.mul(c1).add(c2.mul(s1).mul(S1));
    const lin = re.mul(re).add(im.mul(im));
    const ic = mix(lin, s1.mul(s1), circ);
    // analyseur parallèle : le complément (lames sans pertes)
    const I = mix(ic.oneMinus(), ic, cross);
    rgb = rgb.add(vec3(...W[i]).mul(I));
  });
  return rgb.max(vec3(0));
});
