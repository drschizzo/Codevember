// Construction d'une scène de mousse (module pur, importable depuis Node).
import { buildColony } from './colony.js';
import { makeRock, bakeRock } from './rock.js';
export { bakeRock };
import { leafTemplate, sporTemplate } from './templates.js';
import { FAMILIES } from '../families.js';
import { makeHabitat, showers, simulateField, bilerp } from '../field.js';
import { createCameraPath } from '../camera.js';

// niveaux de détail d'après la trajectoire de la caméra (connue d'avance :
// elle ne dépend que de la recette) : la plus grande taille à l'écran, sur
// toute la boucle, d'un objet de taille l au point p — en pixels d'une image
// de 1080 lignes. Gros plan au-delà de PX[0], moyen au-delà de PX[1].
export const LOD_PX = [150, 35];
function makeLod(camera, T, S) {
  const cam = createCameraPath(camera, S, T);
  const P = Array.from({ length: 240 }, (_, i) => cam.pose(i / 240));
  const t = Math.tan((camera.fov * Math.PI) / 360), f = 540 / t, cosCone = Math.cos(Math.atan(t * 1.9) + 0.1);
  const V = P.map((q) => { const d = q.target.map((v, k) => v - q.pos[k]), l = Math.hypot(...d); return d.map((v) => v / l); });
  return (p, l) => {
    let px = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i].pos, dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2], D = Math.hypot(dx, dy, dz);
      if ((dx * V[i][0] + dy * V[i][1] + dz * V[i][2]) / D < cosCone) continue; // (hors champ)
      px = Math.max(px, (l * f) / D);
    }
    return px > LOD_PX[0] ? 0 : px > LOD_PX[1] ? 1 : 2;
  };
}

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
  // (niveaux de détail : la caméra vise le 60e centile du dessus des tiges, comme stage.js)
  const lod = spec.camera ? (shoots) => {
    const tops = shoots.map((s) => s.top[1]).sort((a, b) => a - b);
    return makeLod(spec.camera, spec.loop.duration, { top: tops[Math.floor(tops.length * 0.6)], E, hero, heroDir: hd });
  } : null;
  const C = buildColony({ ...spec.colony, lod, dome: { T: Tm, N: H.N, E, Bmax } }, H);
  return {
    colony: C, rec, habitat: { R: H.R, M: H.M, E, N: H.N }, showers: SH, hero, heroDir: hd,
    leaf: [0, 1, 2].map((lv) => leafTemplate(spec.colony.family, spec.colony.lite ? Math.max(1, lv) : lv)),
    spor: sporTemplate(fam.spor.kind),
  };
}
