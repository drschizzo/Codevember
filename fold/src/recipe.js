// La recette : tout ce qu'une graine décide. Un accord de couleurs, deux ou
// trois feuilles (patron de plis, taille, place, couleurs des deux faces),
// leurs socles, le fond, la caméra.
import { createRng } from '../../shared/rng.js';

const r2 = (v) => Math.round(v * 100) / 100 + 0; // (+ 0 : jamais de −0, qui ne survit pas au JSON)

// ── Les patrons ──
// Des plis concentriques, montagne et vallée alternées, qui tordent la feuille
// en selle ; ou des plis rayonnants, qui la ferment en ombrelle.
// n : côtés (64 : des cercles) ; twist : tour pris du centre au bord ; star :
// creux des côtés ; lobes : bosses de la selle ; eps : force du coup de pouce
export const PATTERNS = {
  carre: { label: 'Carré', n: 4 },
  hexagone: { label: 'Hexagone', n: 6 },
  octogone: { label: 'Octogone', n: 8 },
  spirale: { label: 'Spirale', n: 4, twist: 0.5, eps: 0.05 },
  rosace: { label: 'Rosace', n: 8, twist: 0.5, eps: 0.05 },
  etoile: { label: 'Étoile', n: 4, star: 0.35 },
  soleil: { label: 'Ombrelle', n: 20, kind: 'soleil' },
  // (pas une feuille : une tour de prismes bistables, qui claquent à plat un à un puis se redressent ; src/sim/fpori.js)
  tour: { label: 'Tour', kind: 'tour' },
};
// les feuilles, dans l'ordre du tirage (la tour est tirée à part : une graine sans tour garde sa scène d'avant)
const SHEET_KEYS = ['carre', 'hexagone', 'octogone', 'spirale', 'rosace', 'etoile', 'soleil'];
// La tour : quatre unités hexagonales à α = 60° (= β/2, bistables), de chiralités alternées.
export const TOWER = { n: 6, alpha: Math.PI / 3, units: 4, chance: 0.35 };
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
// (les plis en cercles, selle ronde ou trèfle à trois bosses, sont dans le solveur — n ≥ 32, lobes — mais leur
//  bascule ne retombe pas à coup sûr sur son point de départ : ils ne sont pas proposés)


// ── Les accords ──
// papers : dégradés (centre → bord) des faces, chauds et froids alternés (une
// feuille prend deux voisins : ses deux faces s'opposent) ; blocks : le fond (disque, arche, paravent) ; wall / floor : cyclorama, dont les socles prennent la teinte
export const MOODS = {
  bonbon: { label: 'Bonbon', wall: '#f7b7cf', floor: '#f4aac6', papers: [['#ff2f6d', '#ff8a1f'], ['#12c4d6', '#2f6bff'], ['#ffe14a', '#ff5a7a'], ['#2f6bff', '#12c4d6']], blocks: ['#ff6f61', '#ffd166', '#3ec1d3'],
    key: '#fff4ea', keyI: 3.4, envI: 0.22, grade: { exposure: 1, contrast: 1.04, saturation: 1.06 } },
  citron: { label: 'Citron', wall: '#b9a8f2', floor: '#ae9cee', papers: [['#ffe600', '#a6f000'], ['#6a2cff', '#ff3fb0'], ['#ff8a00', '#ffe600'], ['#19e3c0', '#6a2cff']], blocks: ['#ffe600', '#ff6fb5', '#5b3fd6'],
    key: '#fffbe8', keyI: 3.3, envI: 0.22, grade: { exposure: 1, contrast: 1.04, saturation: 1.05 } },
  menthe: { label: 'Menthe', wall: '#ffd9a8', floor: '#ffcf96', papers: [['#10e0a0', '#0fa8ff'], ['#ff3f98', '#ff9a2f'], ['#7a3cff', '#10e0a0'], ['#ff9a2f', '#ff3f98']], blocks: ['#12b886', '#ff5d8f', '#fff3d6'],
    key: '#fff1e0', keyI: 3.3, envI: 0.22, grade: { exposure: 1, contrast: 1.04, saturation: 1.05 } },
  lagune: { label: 'Lagune', wall: '#bfe8e2', floor: '#b0dfd9', papers: [['#ff5a4f', '#ff2f8a'], ['#2536ff', '#7a3cff'], ['#ffd400', '#ff9a1f'], ['#12b8c8', '#2536ff']], blocks: ['#ff5a4f', '#2536ff', '#ffe9a8'],
    key: '#fff6ee', keyI: 3.4, envI: 0.22, grade: { exposure: 1, contrast: 1.04, saturation: 1.05 } },
  sorbet: { label: 'Sorbet', wall: '#f6ecd6', floor: '#f1e4c8', papers: [['#ff7a59', '#ffb23f'], ['#3aa8ff', '#7bdcb5'], ['#ff8ad1', '#ff7a59'], ['#3aa8ff', '#b06bff']], blocks: ['#ff7a59', '#3aa8ff', '#ffd9e6'],
    key: '#fff6ea', keyI: 3.2, envI: 0.2, grade: { exposure: 0.96, contrast: 1.05, saturation: 1.08 } },
  reglisse: { label: 'Réglisse', wall: '#33264a', floor: '#2c2040', papers: [['#ff3fa4', '#ff8a3d'], ['#2ff3c0', '#19a8ff'], ['#f6ff4a', '#ff8a3d'], ['#19a8ff', '#7a5cff']], blocks: ['#4a2f78', '#ff3fa4', '#1f8fa8'],
    key: '#fff0e6', keyI: 4.2, envI: 0.14, grade: { exposure: 1.12, contrast: 1.06, saturation: 1.05 } },
};
export const BACKDROPS = { nu: { label: 'Nu' }, disque: { label: 'Un disque' }, arche: { label: 'Une arche' }, paravent: { label: 'Un paravent' } };
export const HALF = 7; // durée d'une bascule (s) ; la boucle en compte deux

// places : la grande feuille au centre, les autres devant, à gauche et à droite.
// az : direction (0 = vers la caméra), y : hauteur du centre, size : rayon
const SLOTS = [
  { size: [0.9, 1.02], az: [0, 0], y: [1.14, 1.26], rings: [15, 19], m: 17 },
  { size: [0.56, 0.66], az: [0.85, 1.05], y: [0.76, 0.9], rings: [10, 13], m: 13 },
  { size: [0.44, 0.52], az: [-1.0, -0.8], y: [0.54, 0.64], rings: [9, 11], m: 12 },
];
export const GAP = 0.08; // jeu entre deux feuilles à plat (elles ne peuvent pas se toucher)

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const pick = (k, o) => overrides[k] ?? rng.fork(k).pick(Object.keys(o));
  const mood = pick('mood', MOODS), backdrop = pick('backdrop', BACKDROPS), M = MOODS[mood];
  const rs = rng.fork('sheets'), rc = rng.fork('camera');
  const drawn = rs.chance(0.8) ? 3 : 2, count = overrides.patterns?.length ?? overrides.count ?? drawn;
  // (tirage complet, quel que soit le nombre de feuilles : changer un patron au panneau ne déplace rien d'autre)
  const keys = SHEET_KEYS.slice();
  for (let i = keys.length - 1; i > 0; i--) { const j = rs.int(0, i); [keys[i], keys[j]] = [keys[j], keys[i]]; }
  const patterns = keys.slice(0, count);
  // une fois sur trois, une tour : c'est alors elle le sujet. Elle prend la place du centre, en grand, et
  // les feuilles se rangent autour (la grande devient la moyenne, la moyenne la petite)
  const rt = rng.fork('tour');
  if (count >= 2 && rt.chance(TOWER.chance)) patterns.splice(0, count, 'tour', ...patterns.slice(0, count - 1));
  const side = rs.sign(), shift = rs.int(0, 3), plinth = rs.pick(['cylindre', 'bloc']);
  const sheets = [];
  (overrides.patterns ?? patterns).forEach((pattern, i) => {
    const S = SLOTS[i], P = PATTERNS[pattern], size = r2(rs.range(...S.size)), y = r2(rs.range(...S.y));
    if (P.kind === 'tour') { sheets.push(tower(i, size, y, sheets, side, rt, rs, shift, plinth)); return; }
    // (une feuille tient dans le cylindre de rayon size autour de sa tige : deux cylindres ne se coupent pas)
    const az = side * rs.range(...S.az), d = i ? sheets[0].size + size + GAP + rs.range(0, 0.12) : 0;
    // (le socle s'arrête sous le point le plus bas de la feuille)
    const reach = P.kind === 'soleil' ? 0.95 : 0.62, ph = Math.max(0, Math.min(rs.range(0.1, 0.42), y - reach * size - 0.06));
    sheets.push({
      pattern, size, y: r2(P.kind === 'soleil' ? Math.max(y, 0.95 * size + 0.12) : y), at: [r2(d * Math.sin(az)), r2(d * Math.cos(az))], rot: r2(rs.range(0, Math.PI / 2)),
      rings: P.kind === 'soleil' ? 8 : rs.int(...S.rings), m: S.m, n: P.kind === 'soleil' ? rs.pick([16, 20, 24]) : P.n,
      hole: r2(P.kind === 'soleil' ? rs.range(0.1, 0.2) : 0.08),
      rhythm: 0, // (plis larges et étroits alternés : la selle ne bascule pas franchement à cette finesse, laissé de côté)
      amp: r2(P.amp ?? rs.range(1.8, 2.05)), open: r2(rs.range(0.26, 0.36)), phase: r2(i === 0 ? 0 : rs.range(0.2, 0.8)),
      top: (i + shift) % 4, bot: (i + shift + 1) % 4,
      plinth: ph > 0.07 ? { kind: plinth, h: r2(ph), r: r2(rs.range(0.14, 0.19)), color: (i + shift) % 2 } : null,
    });
  });
  return {
    v: 6, seed: String(seed), mood, backdrop,
    patterns: sheets.map((s) => s.pattern), sheets,
    decor: { side: -side, color: rs.int(0, 2), size: r2(rs.range(1.25, 1.55)) },
    camera: { side: rc.sign(), sway: r2(rc.range(0.16, 0.26)), lift: r2(rc.range(-0.1, 0.15)), dist: r2(rc.range(5.5, 5.9)) },
    loop: { half: HALF, duration: 2 * HALF },
    grade: { ...M.grade },
  };
}
// Une tour à la place d'une feuille. Au centre, elle est le sujet : son
// sommet monte à la hauteur du haut de la grande feuille (1,6 à 1,8 m), sur
// un socle bas. Ailleurs (choix du panneau), un peu au-dessus du centre
// qu'aurait eu la feuille. Sa largeur (le côté l d'une unité) en découle. Son emprise (plateau de laiton, socle) remplace la taille de la
// feuille pour l'écart avec les voisines.
function tower(i, size, y, sheets, side, rt, rs, shift, plinth) {
  const S = SLOTS[i], az = side * rs.range(...S.az), jit = i ? rs.range(0, 0.12) : 0;
  // (le socle cède la hauteur à la tour : jamais d'unités de moins de 8,5 cm de côté)
  const hero = i === 0, topY = y + (hero ? 0.5 : 0.3) * size, ph = r2(Math.min(hero ? rs.range(0.06, 0.2) : rs.range(0.1, 0.42), topY - 0.012 - TOWER.units * 0.085 * Math.tan(TOWER.alpha))), hasPlinth = ph > 0.12;
  const base = (hasPlinth ? ph : 0) + 0.012; // (plateau de laiton : 12 mm)
  const l = r3((topY - base) / (TOWER.units * Math.tan(TOWER.alpha)));
  const pr = r2(Math.max(rs.range(0.14, 0.19), 1.42 * l)), kind = plinth;
  const reach = Math.max(1.3 * l, hasPlinth ? (kind === 'bloc' ? 0.85 * pr * Math.SQRT2 : pr) : 0);
  const foot = r2(reach + 0.01), d = i ? sheets[0].size + foot + GAP + jit : 0;
  // (l'ordre des claquements : de petites différences de raideur entre unités)
  const rk = rt.fork(`spread${i}`), spread = [1.0, 0.9, 1.08, 0.95];
  for (let k = spread.length - 1; k > 0; k--) { const j = rk.int(0, k); [spread[k], spread[j]] = [spread[j], spread[k]]; }
  return {
    pattern: 'tour', size: foot, y: r2(base + TOWER.units * l * Math.tan(TOWER.alpha)), at: [r2(d * Math.sin(az)), r2(d * Math.cos(az))], rot: r2(rs.range(0, Math.PI / 3)),
    n: TOWER.n, units: TOWER.units, l, base: r3(base), spread, phase: r2(i === 0 ? 0 : rs.range(0.2, 0.8)),
    top: (i + shift) % 4, bot: (i + shift + 1) % 4,
    plinth: hasPlinth ? { kind, h: r2(ph), r: pr, color: (i + shift) % 2 } : null,
  };
}
export function upgrade(R) { return R?.v === 6 ? R : generate(R?.seed ?? 'f1'); }
