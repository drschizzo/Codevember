// La caméra du film et le creuset (fonctions pures) : le cadrage tiré par la
// recette, un balancement lent autour de la grappe (périodique : même pose à
// u = 0 et u = 1), qui suit la grappe quand elle descend dans le bain.
import { FRAMINGS, CLUSTERS, HABITS } from './recipe.js';
import { buildCluster, tideFor, lift, level, cycleT, meltEnd } from './cycle.js';
import { reachOf } from './melt/model.js';

const TAU = Math.PI * 2;
const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

// (la grappe et sa marée, par graine)
let cache = { key: '', cl: null, C: null };
function clusterOf(R) {
  const key = `${R.seed}|${R.cluster}`;
  if (cache.key !== key) { const cl = buildCluster(R.seed, CLUSTERS[R.cluster] ?? CLUSTERS.grappe); cache = { key, cl, C0: tideFor(cl) }; }
  // (le temps de la fonte, calé sur la simulation une fois qu'elle a tourné)
  return { cl: cache.cl, C: { ...cache.C0, UM: meltEnd(key) } };
}

// le cadre suit la grappe : le gros plan se règle sur le grand cristal, les
// autres cadrages sur l'étendue de la grappe
function frameScale(R) {
  const C = CLUSTERS[R.cluster] ?? CLUSTERS.grappe;
  const ext = C.scale * (1 + 2.9 * C.spread);
  return R.framing === 'macro' ? Math.min(1.6, Math.max(0.75, C.scale * 1.2)) : Math.min(1.35, Math.max(0.65, ext / 3.9));
}

// Le creuset : une marmite de fonte, assez grande pour la grappe, et, pour
// les cadrages pris au-dessus du bain, pour que la caméra soit au-dessus de
// son fond (sa paroi proche reste hors champ, sous l'objectif ; sa paroi du
// fond et son bord ferment l'image : plus de miroir infini). Le plan
// « atelier » la montre entière, du dehors, sur son brûleur et l'établi.
export function potFor(R) {
  const { cl, C } = clusterOf(R);
  const habit = HABITS[R.habit]?.id ?? 0;
  const ext = Math.max(...cl.map((c) => Math.hypot(c.x, c.z) + reachOf(c.s, habit)));
  let Ri = ext + 1.6;
  if (R.framing !== 'atelier') {
    const F = FRAMINGS[R.framing], f = frameScale(R);
    const camH = Math.hypot(F.pos[0] - F.tgt[0], F.pos[2] - F.tgt[2]) * f * (R.camera.dolly ?? 1);
    Ri = Math.max(Ri, camH + 1.4);
  }
  // la grille (un treillis d'acier dans un cerceau, sur lequel la grappe a
  // poussé), à peine plus large que les pieds ; un panier : une fourche part de
  // son cerceau et rejoint un long manche qui monte vers l'arrière, hors champ
  // (le coin d'un cube tourné va à √2 demi-côté du centre, 1,9 pour la trémie allongée :
  // aucun pied ne doit passer sur le cerceau)
  const Rg = Math.max(...cl.map((c) => Math.hypot(c.x, c.z) + c.s * (habit === 2 ? 1.95 : 1.45))) + 0.12;
  // (assez de place derrière la grille pour que le manche du panier, à 68°, passe
  // par-dessus la paroi même quand la grille est au fond)
  // (le montant du manche, 0,6 cm derrière le cerceau, ne doit pas toucher la paroi)
  Ri = Math.max(Ri, Rg + 1.8);
  // (le bain est fixe, à LB ; la grille au repos est à LB − LH, le fond juste dessous ;
  // la paroi monte bien au-dessus du bain : elle fait le fond de l'image)
  const th = 0.45, rim = C.LB + 0.8 * C.LH + 0.4, bottom = C.LB - C.LH - 1.2;
  return {
    Ri, th, rim, bottom, bench: bottom - 1.6,
    // (le montant du manche : assez haut pour que son coude passe au-dessus du bord,
    // même grille au fond)
    galette: { r: Rg, crust: 0, bar: rim + 0.5 - (C.LB - C.LH + 0.35) },
  };
}

// la part de la descente que la caméra suit : 0 grappe suspendue, 1 au fond
// (périodique : elle suit la levée comme la fonte)
const follow = (t, C) => (C.LB - C.LOW - lift(t, C)) / (C.LH - C.LOW);

// u : la phase affichée (0–1)
export function cameraAt(R, u) {
  const F = FRAMINGS[R.framing], K = R.camera;
  const { C } = clusterOf(R);
  const t = cycleT(u);
  const az = K.sway * Math.sin(TAU * u), lift = K.lift * Math.sin(TAU * u + 1.3);
  const c = Math.cos(az), s = Math.sin(az);
  if (R.framing === 'atelier') {
    const pot = potFor(R), Ro = pot.Ri + pot.th, d = Ro * 2.9;
    const tgt = [0, F.tgt[1], 0];
    const off = [F.pos[0] * d, F.pos[1] * d, F.pos[2] * d];
    const pos = [tgt[0] + (off[0] * c + off[2] * s) * K.dolly, tgt[1] + off[1] * K.dolly + lift * 2, tgt[2] + (-off[0] * s + off[2] * c) * K.dolly];
    return { pos, tgt, fov: F.fov, aperture: F.aperture, focus: Math.hypot(pos[0] - tgt[0], pos[1] - tgt[1], pos[2] - tgt[2]) };
  }
  const f = frameScale(R);
  const D = C.LH - C.LOW, fw = follow(t, C);
  const tgt = [F.tgt[0] * f, F.tgt[1] * f - 0.45 * D * fw, F.tgt[2] * f];
  const off = [(F.pos[0] - F.tgt[0]) * f, (F.pos[1] - F.tgt[1]) * f, (F.pos[2] - F.tgt[2]) * f];
  // la hauteur de base reste au-dessus de la marée haute de la grappe (au ras
  // du bain : juste au-dessus) ; elle suit la grappe quand elle descend, sans
  // jamais passer sous le bain ; le balancement vertical s'y ajoute
  const m = Math.abs(K.lift);
  let y0 = F.tgt[1] * f + off[1] * K.dolly;
  // (au ras du bain : un peu au-dessus de lui, la grappe suspendue vue de biais)
  y0 = R.framing === 'rasant' ? C.LB + 0.55 * C.LH + 0.6 + m : Math.max(y0, C.LH + 0.5 + m);
  y0 = Math.max(y0 - 0.45 * D * fw, level(t, C) + 0.3 + m);
  const pos = [tgt[0] + (off[0] * c + off[2] * s) * K.dolly, y0 + lift, tgt[2] + (-off[0] * s + off[2] * c) * K.dolly];
  const ap = F.aperture * Math.max(0.7, f);
  return { pos, tgt, fov: F.fov, aperture: ap, focus: Math.hypot(pos[0] - tgt[0], pos[1] - tgt[1], pos[2] - tgt[2]) };
}
