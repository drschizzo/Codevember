// L'état d'un sporange à la phase s du site (module pur : scène, worker des
// spores, tests). Une seule formule, lue par le CPU (tableaux d'uniformes
// envoyés au vertex shader) et par le calcul des spores (point de départ).
//
//   grow   0 perle → 1 sporange dressé (le pied s'allonge, la tête prend forme)
//   mature 0 blanc translucide → 1 couleur finale, sèche
//   open   0 fermé → 1 ouvert (le geste de la famille)
//   wear   0 frais → 1 effrité (sporanges vides du site précédent)
//   bend   flexion (cm au sommet) sous le vent + penchant vers la lumière
import { T, sstep, stage, windSpeed, clamp } from './timeline.js';

// hauteur d'un sporange (cm) à la taille 1, par espèce
export function heightOf(sp) {
  if (!sp.head) return 0;
  return sp.stalk.h + sp.head.h;
}

// bead : { delay, size, rnd, az } ; R : recette
export function fruitState(bead, s, R, sp) {
  const spread = R.fruit.spread;
  const d = bead.delay;
  // la perle se forme pendant la condensation (avant le pied)
  const bead0 = sstep(T.condense[0] + d * spread * 0.5, T.condense[1] + d * spread * 0.5, s);
  const grow = stage('rise', s, d, spread);
  const mature = stage('mature', s, d, spread);
  const open = stage('open', s, d, spread * 0.8);
  const wear = sstep(T.wear[0], T.wear[1], s);
  // flexion : poutre encastrée sous la traînée du vent (∝ U²), plus raide
  // jeune (gorgée d'eau) ; penchant vers la lumière pendant la levée
  const H = heightOf(sp) * bead.size;
  const U = windSpeed(s, R.wind.gust, R.wind.strength);
  const flutter = 1 + 0.25 * Math.sin(s * 40 * 6.2832 * 0.35 + bead.rnd * 30) * Math.min(1, U);
  const stiff = sp.mode === 'tuft' ? 1.6 : sp.mode === 'vein' ? 0.9 : 0.6;
  const wind = (0.06 * U * U * flutter * stiff * H * grow) * (1 + 0.6 * wear);
  const lean = R.fruit.lean * H * grow;
  // le penchant vers la lumière : le soleil vient de l'azimut de la lampe
  const la = R.light.key.kind === 'lamp' ? R.camera.az + Math.PI / 2 : R.light.key.az;
  const bx = wind + lean * Math.cos(la), bz = lean * Math.sin(la);
  // les sporanges vides s'affaissent sous leur poids, d'un côté tiré une fois
  const sag = wear * H * 0.35;
  return {
    bead: bead0, grow, mature, open, wear,
    bx: bx + sag * Math.cos(bead.az), bz: bz + sag * Math.sin(bead.az),
  };
}

// flexion d'une poutre encastrée chargée en bout : déplacement relatif à la
// hauteur y (fraction t = y/H) — même formule dans le vertex shader
export const beamShape = (t) => { const q = clamp(t, 0, 1); return (q * q * (3 - q)) / 2; };
export const beamSlope = (t) => { const q = clamp(t, 0, 1); return (3 * q * (2 - q)) / 2; }; // (d/dt)
