// Recette d'une scène : tout ce qui découle de la graine (JSON partageable).
// Une graine construit UNE usine : son circuit, sa source de chaleur, ses
// proportions, sa cire, sa peinture, son lieu, et les objets qu'elle refond.
//
// - chaque tirage a son propre flux (rng.fork('…')) ;
// - une humeur est un lieu (murs, sol, lumière), pas une teinte ;
// - la cire a deux pigments : une masse et des veines, qui dessinent l'écoulement.
import { createRng } from '../../shared/rng.js';
import { OBJECTS } from './objects.js';
import { TL } from './cycle.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0;

// ── Les cires : [masse, veines] (linéaire) ──
export const WAXES = {
  rose: { label: 'Rose et ivoire', a: [0.78, 0.2, 0.24], b: [0.9, 0.8, 0.66] },
  canard: { label: 'Bleu canard et crème', a: [0.07, 0.34, 0.4], b: [0.88, 0.82, 0.68] },
  miel: { label: 'Miel et lait', a: [0.82, 0.48, 0.08], b: [0.93, 0.88, 0.76] },
  sauge: { label: 'Sauge et craie', a: [0.3, 0.46, 0.26], b: [0.9, 0.86, 0.74] },
  prune: { label: 'Prune et abricot', a: [0.34, 0.1, 0.3], b: [0.92, 0.6, 0.36] },
  noir: { label: 'Réglisse et menthe', a: [0.045, 0.045, 0.05], b: [0.56, 0.86, 0.72] },
};
// ── Les sources de chaleur : d'où vient la chaleur décide de la façon de fondre ──
// dir : direction vers la source ; flat : part reçue quelle que soit l'orientation ;
// band : [1 si la source est une ceinture qui descend le long de l'objet (cycle.js · beltAt), sa demi-épaisseur relative]
export const HEATS = {
  lampe: { label: 'Lampe infrarouge (par le haut)', dir: [-0.25, 1, 0.3], flat: 0.25, band: [0, 0], power: 8 },
  bruleur: { label: 'Rampe de brûleurs (de biais)', dir: [0.6, 0.6, -0.45], flat: 0.16, band: [0, 0], power: 9 },
  ceinture: { label: 'Ceinture chauffante (qui descend)', dir: [0, 1, 0], flat: 0.1, band: [1, 0.15], power: 8 },
};
export const CIRCUITS = { ascenseurs: { label: 'Deux ascenseurs' }, rampe: { label: 'Un ascenseur et une rampe' } };
// ── Les lieux ──
// wall / floor : teintes ; key : lampe principale [az, el], K ; env : studio HDR ; paints : peintures de la machine
export const MOODS = {
  atelier: { label: 'Atelier', wall: '#6f6a62', floor: '#4b4743', key: { az: -0.55, el: 0.92, K: 5200, I: 3.4 }, rim: { az: 2.5, el: 0.5, color: '#ffd0a0', I: 2.2 }, env: 'softbox', envI: 0.55,
    paints: ['#c9a227', '#2f6f7a', '#a8402a', '#d8d2c4'], grade: { exposure: 1, contrast: 1.05, saturation: 1 } },
  laboratoire: { label: 'Laboratoire', wall: '#b9bfbf', floor: '#8b9090', key: { az: 0.5, el: 1.05, K: 6200, I: 3 }, rim: { az: -2.4, el: 0.6, color: '#dfe8ff', I: 1.6 }, env: 'softbox', envI: 0.8,
    paints: ['#e8e4da', '#3b6ea5', '#5d6b3a', '#d0453a'], grade: { exposure: 0.86, contrast: 1.02, saturation: 0.95 } },
  nuit: { label: 'Équipe de nuit', wall: '#2b2f3a', floor: '#24262b', key: { az: -0.9, el: 0.7, K: 4800, I: 2.9 }, rim: { az: 2.2, el: 0.35, color: '#9fb8ff', I: 2.6 }, env: 'night', envI: 0.75,
    paints: ['#c9a227', '#a8402a', '#2f6f7a', '#8d9096'], grade: { exposure: 1.25, contrast: 1.08, saturation: 1 } },
};

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const pick = (k, o) => overrides[k] ?? rng.fork(k).pick(Object.keys(o));
  const mood = pick('mood', MOODS), wax = pick('wax', WAXES), heat = pick('heat', HEATS), circ = pick('circuit', CIRCUITS);
  const M = MOODS[mood];
  // les objets : deux ou trois figurines différentes
  const ro = rng.fork('objects');
  const keys = Object.keys(OBJECTS), n = overrides.count ?? 2, objects = []; // (deux objets : une boucle de cinquante secondes)
  while (objects.length < n) { const k = ro.pick(keys); if (!objects.includes(k)) objects.push(k); }
  const rf = rng.fork('factory'), rc = rng.fork('camera');
  const bellH = 1.36;
  const y0 = r2(rf.range(0.3, 0.55) + (circ === 'rampe' ? 0.5 : 0)); // (le chariot de la rampe passe sous la ligne basse)
  return {
    v: 3, seed: String(seed), mood, wax, heat,
    objects: overrides.objects ?? objects,
    factory: {
      circuit: circ, dir: rf.pick([1, -1]), half: r2(rf.range(1.75, 2.5)), y0, bellH,
      y1: r2(y0 + 0.56 + bellH * 2 + rf.range(0.6, 0.95)), ramp: r2(rf.range(0.95, 1.2)),
      paint: rf.pick(M.paints), metal: rf.pick(['steel', 'alu', 'brass']), pallet: rf.pick(['copper', 'steel', 'brass']),
    },
    camera: { side: rc.pick([1, -1]), sway: r2(rc.range(0.04, 0.09)), lift: r2(rc.range(-0.15, 0.2)) },
    loop: { half: TL.half, duration: TL.half * (overrides.objects ?? objects).length },
    grade: { ...M.grade },
  };
}
export function upgrade(R) { return R?.v === 3 ? R : generate(R?.seed ?? 'm1'); }
