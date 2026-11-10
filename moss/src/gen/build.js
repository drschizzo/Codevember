// Construction d'une scène de mousse (module pur, importable depuis Node).
import { buildColony } from './colony.js';
import { makeRock, bakeRock } from './rock.js';
export { bakeRock };
import { leafTemplate, sporTemplate } from './templates.js';
import { FAMILIES } from '../families.js';
import { makeHabitat, showers, simulateField, bilerp } from '../field.js';

// spec : { colony: {…}, loop: { duration }, water: { kind, dir, intensity, evap } }
// spec : { colony: {…}, loop: { duration }, water: { kind, … } }
export function buildMoss(spec) {
  const fam = FAMILIES[spec.colony.family];
  const E = spec.colony.radius * 1.12;
  const rock = spec.colony.support.rock ? makeRock(spec.colony.support.rock, spec.colony.support.seed) : null;
  const H = makeHabitat(spec.colony.seed, E, spec.colony.sunDir ?? [0.4, 0.8, 0.3], rock);
  const SH = showers(spec.colony.seed);
  const rec = simulateField(spec.loop.duration, H, SH, spec.field ?? {});
  // lieu du gros plan : le bord d'un refuge près du centre (le front y passe)
  let hero = [0, 0], best = -1; // (let : déplacé plus bas)
  for (let j = 0; j < H.N; j++) for (let i = 0; i < H.N; i++) {
    const x = -E + (2 * E * (i + 0.5)) / H.N, z = -E + (2 * E * (j + 0.5)) / H.N, r = Math.hypot(x, z) / E;
    const v = H.R[j * H.N + i] * (1 - r * 1.4);
    if (v > best) { best = v; hero = [x, z]; }
  }
  // sens du front au gros plan : là où la rétention décroît (vers la roche nue)
  const g = (x, z) => bilerp(H.R, H.N, E, x, z), e = 0.3;
  let hd = [g(hero[0] - e, hero[1]) - g(hero[0] + e, hero[1]), g(hero[0], hero[1] - e) - g(hero[0], hero[1] + e)];
  const hl = Math.hypot(...hd) || 1; hd = [hd[0] / hl, hd[1] / hl];
  // (le gros plan regarde le bord de l'îlot, un peu vers la roche nue)
  hero = [hero[0] + hd[0] * 0.5, hero[1] + hd[1] * 0.5];
  // dômes : épaisseur des coussins pleinement poussés, d'après la mousse au
  // plus fort de l'année (le maximum du champ, adouci), bords arrondis
  const NN = H.N * H.N, Bmax = new Float32Array(NN);
  for (let f = 0; f < rec.F; f++) for (let k = 0; k < NN; k++) Bmax[k] = Math.max(Bmax[k], rec.B[f * NN + k] / 255);
  const Tm = new Float32Array(NN);
  for (let j = 0; j < H.N; j++) for (let i = 0; i < H.N; i++) {
    let s = 0, w = 0;
    for (let b = -6; b <= 6; b++) for (let a = -6; a <= 6; a++) { const ii = Math.min(H.N - 1, Math.max(0, i + a)), jj = Math.min(H.N - 1, Math.max(0, j + b)), ww = Math.exp(-(a * a + b * b) / 12); s += Bmax[jj * H.N + ii] * ww; w += ww; }
    const v = s / w;
    // (profil en S : le coussin s'arrondit jusqu'à la roche, sans falaise)
    const t = Math.max(0, Math.min(1, (v - 0.1) / 0.75));
    Tm[j * H.N + i] = fam.shoot.dome * Math.sqrt(t * t * (3 - 2 * t));
  }
  const C = buildColony({ ...spec.colony, hero, heroR: 2.6, dome: { T: Tm, N: H.N, E } }, H);
  return {
    colony: C, rec, habitat: { R: H.R, M: H.M, E, N: H.N }, showers: SH, hero, heroDir: hd,
    leaf: leafTemplate(spec.colony.family, spec.colony.lite ? 1 : 0),
    leafFar: leafTemplate(spec.colony.family, 1),
    spor: sporTemplate(fam.spor.kind),
  };
}
