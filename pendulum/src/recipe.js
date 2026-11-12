// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette, les tables des transitions
// (calculées d'après elle) et la phase.
//
// Règles (voir la skill codevember-scene, references/art-direction.md) :
// - chaque tirage a son propre flux (rng.fork('…')) ;
// - les matières ne sont jamais tirées pièce par pièce : chaque humeur a des
//   accords composés à la main (rôles : socle, bâti, guidage, maillons,
//   chapes, accent, courroie) ;
// - les lampes sont presque blanches (sauf le soleil, qui est le soleil) ;
// - la boucle est une suite d'équilibres qui revient au premier : le
//   tout-debout est toujours au sommet du crescendo.
import { createRng } from './rng.js';
import { FINISHES } from './finishes.js';
import { FAMILIES } from './gen/machines.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0; // (|| 0 : jamais de −0, que JSON ne garde pas)
const r3 = (x) => Math.round(x * 1000) / 1000 || 0;
const wpick = (rng, vals, ws) => rng.weighted(vals.map((v, i) => [v, ws[i]]));

export const kelvinToHex = (K) => {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

// ── Humeurs : des décors, pas des teintes ────────────────────────────────────
// env : studio HDR ; bg : fond (cyclorama) et brume ; wall, floor : finitions
// du cyclorama et du sol ; light : lampe principale (az, el en radians ; size :
// douceur ; K : température) et contre-jours ; cam : cadrage (az 0 = profil
// exact, vu de face) ; grade : étalonnage ; accords : rôles → finitions.
export const MOODS = {
  cabinet: {
    label: 'Cabinet', room: true, env: 'atelier', bg: '#0f0d0a', wall: 'wallGreen', floor: 'parquet', fog: 0.0,
    light: { K: 5200, az: -0.95, el: 0.62, dist: 6.5, angle: 0.62, penumbra: 0.95, power: 3.2, rims: [{ az: 2.45, el: 0.5, power: 0.55, K: 6500 }, { az: -2.6, el: 0.25, power: 0.25, K: 4800 }] },
    cam: { az: [-0.18, 0.12], el: [0.05, 0.14], fov: [26, 32], dist: 1.0 },
    grade: { contrast: 1.05, saturation: 0.98, shadows: [0.95, 1.0, 1.04], highlights: [1.05, 1.0, 0.93], exposure: 1 },
    accords: [
      { base: 'mahogany', frame: 'blackenedSteel', guide: 'chrome', link: 'polishedBrass', hub: 'bluedSteel', accent: 'polishedBrass', belt: 'leather' },
      { base: 'walnut', frame: 'blackenedSteel', guide: 'chrome', link: 'bluedSteel', hub: 'polishedBrass', accent: 'polishedBrass', belt: 'leather' },
      { base: 'ebonized', frame: 'polishedBrass', guide: 'chrome', link: 'brushedSteel', hub: 'polishedBrass', accent: 'polishedBrass', belt: 'leather' },
      { base: 'mahogany', frame: 'blackenedSteel', guide: 'chrome', link: 'brushedBrass', hub: 'brushedSteel', accent: 'polishedCopper', belt: 'rubber' },
    ],
  },
  laboratoire: {
    label: 'Laboratoire', env: 'cyclo', bg: '#d8d7d3', wall: 'cycloWhite', floor: 'epoxyWhite', fog: 0.0, keyScale: 0.6, envIntensity: [0.32, 0.42],
    light: { K: 6200, az: -0.4, el: 1.15, dist: 6, angle: 0.75, penumbra: 1, power: 0.8, rims: [{ az: 2.2, el: 0.45, power: 0.45, K: 6500 }, { az: -2.4, el: 0.4, power: 0.3, K: 6500 }] },
    cam: { az: [0.35, 0.6], el: [0.12, 0.24], fov: [30, 36], dist: 1.05 },
    grade: { contrast: 1.0, saturation: 0.9, shadows: [0.98, 1.0, 1.03], highlights: [1, 1, 1], exposure: 1 },
    accords: [
      { base: 'whitePowder', frame: 'blackAnodized', guide: 'chrome', link: 'clearAnodized', hub: 'blackAnodized', accent: 'redAnodized', belt: 'rubber' },
      { base: 'whitePowder', frame: 'clearAnodized', guide: 'chrome', link: 'blackAnodized', hub: 'clearAnodized', accent: 'blueAnodized', belt: 'rubber' },
      { base: 'greyPowder', frame: 'blackAnodized', guide: 'chrome', link: 'clearAnodized', hub: 'brushedSteel', accent: 'orangeAnodized', belt: 'rubber' },
    ],
  },
  chrono: {
    label: 'Chronophotographie', env: 'night', bg: '#030303', wall: 'velvetBlack', floor: 'velvetBlack', fog: 0.0, envIntensity: [0.25, 0.35], ghosts: true,
    light: { K: 5600, az: -1.45, el: 0.32, dist: 6.5, angle: 0.5, penumbra: 0.45, power: 2, rims: [{ az: 2.0, el: 0.35, power: 0.25, K: 6500 }, { az: 1.2, el: 1.2, power: 0.1, K: 6500 }] },
    cam: { az: [-0.04, 0.04], el: [0.02, 0.06], fov: [20, 24], dist: 1.15 },
    grade: { contrast: 1.12, saturation: 0.6, shadows: [1, 1, 1.02], highlights: [1.02, 1.0, 0.97], exposure: 1 },
    accords: [
      { base: 'blackPaint', frame: 'blackPaint', guide: 'blackenedSteel', link: 'whiteEnamel', hub: 'blackenedSteel', accent: 'whiteEnamel', belt: 'rubber' },
      { base: 'blackPaint', frame: 'blackenedSteel', guide: 'blackenedSteel', link: 'whiteEnamel', hub: 'brushedSteel', accent: 'brushedSteel', belt: 'rubber' },
    ],
  },
  soleil: {
    label: 'Plein soleil', room: true, env: 'clearsky', bg: '#d9cfbd', wall: 'limewash', floor: 'earth', fog: 0.0, sun: true, envIntensity: [0.12, 0.18], keyScale: 1,
    light: { K: 5000, az: -0.65, el: 0.52, dist: 14, angle: 0.55, penumbra: 0.1, power: 1.3, rims: [{ az: 2.8, el: 0.6, power: 0.12, K: 9000 }, { az: 0.8, el: 1.3, power: 0.1, K: 11000 }] },
    cam: { az: [-0.32, -0.12], el: [0.06, 0.16], fov: [28, 34], dist: 1.1 },
    grade: { contrast: 1.06, saturation: 1.02, shadows: [0.96, 1.0, 1.06], highlights: [1.04, 1.0, 0.95], exposure: 1 },
    accords: [
      { base: 'oak', frame: 'greenEnamel', guide: 'brushedSteel', link: 'ochreEnamel', hub: 'brushedSteel', accent: 'polishedBrass', belt: 'leather' },
      { base: 'oak', frame: 'ochreEnamel', guide: 'brushedSteel', link: 'brushedSteel', hub: 'greenEnamel', accent: 'polishedCopper', belt: 'rubber' },
      { base: 'greenEnamel', frame: 'castIron', guide: 'brushedSteel', link: 'polishedBrass', hub: 'castIron', accent: 'polishedBrass', belt: 'leather' },
    ],
  },
  atelier: {
    label: 'Atelier', room: true, env: 'studio', bg: '#0a0908', wall: 'concreteDark', floor: 'concrete', fog: 0.05, beam: true, envIntensity: [0.35, 0.5],
    light: { K: 5400, az: -0.35, el: 1.18, dist: 7, angle: 0.3, penumbra: 0.55, power: 5, rims: [{ az: 2.3, el: 0.35, power: 0.35, K: 4700 }, { az: -2.5, el: 0.3, power: 0.18, K: 6000 }] },
    cam: { az: [0.15, 0.4], el: [0.2, 0.32], fov: [30, 36], dist: 1.0 },
    grade: { contrast: 1.08, saturation: 0.92, shadows: [0.93, 0.98, 1.08], highlights: [1.06, 1.0, 0.92], exposure: 1 },
    accords: [
      { base: 'castIron', frame: 'castIron', guide: 'brushedSteel', link: 'brushedSteel', hub: 'polishedBrass', accent: 'polishedBrass', belt: 'leather' },
      { base: 'oakDark', frame: 'castIron', guide: 'chrome', link: 'blackenedSteel', hub: 'polishedBrass', accent: 'polishedCopper', belt: 'leather' },
      { base: 'castIron', frame: 'blackenedSteel', guide: 'brushedSteel', link: 'polishedBrass', hub: 'brushedSteel', accent: 'polishedBrass', belt: 'rubber' },
    ],
  },
  bleue: {
    label: 'Heure bleue', env: 'fogwhite', bg: '#56606b', wall: 'cycloGrey', floor: 'concreteCold', fog: 0.12, envIntensity: [0.28, 0.4],
    light: { K: 7200, az: 2.6, el: 0.45, dist: 6.5, angle: 0.55, penumbra: 0.9, power: 2.4, rims: [{ az: -2.2, el: 0.5, power: 0.55, K: 9000 }, { az: -0.5, el: 1.0, power: 0.2, K: 8000 }] },
    cam: { az: [-0.55, -0.35], el: [0.08, 0.16], fov: [28, 34], dist: 1.05 },
    grade: { contrast: 1.04, saturation: 0.82, shadows: [0.92, 0.98, 1.1], highlights: [0.98, 1.0, 1.04], exposure: 1 },
    accords: [
      { base: 'greyPowder', frame: 'brushedSteel', guide: 'chrome', link: 'chrome', hub: 'blackAnodized', accent: 'polishedCopper', belt: 'rubber' },
      { base: 'slate', frame: 'chrome', guide: 'chrome', link: 'brushedSteel', hub: 'chrome', accent: 'polishedCopper', belt: 'rubber' },
    ],
  },
  laque: {
    label: 'Laque', env: 'softbox', bg: '#46423e', wall: 'cycloMid', floor: 'felt', fog: 0.0, envIntensity: [0.4, 0.55],
    light: { K: 5600, az: -1.2, el: 1.0, dist: 6, angle: 0.7, penumbra: 1, power: 1.2, rims: [{ az: 2.5, el: 0.4, power: 0.5, K: 6000 }, { az: -2.6, el: 0.35, power: 0.25, K: 5600 }] },
    cam: { az: [0.0, 0.25], el: [0.1, 0.2], fov: [24, 30], dist: 0.95 },
    grade: { contrast: 1.05, saturation: 1.0, shadows: [0.97, 0.99, 1.03], highlights: [1.02, 1.0, 0.97], exposure: 1 },
    accords: [
      { base: 'blackLacquer', frame: 'blackLacquer', guide: 'chrome', link: 'redLacquer', hub: 'polishedBrass', accent: 'polishedBrass', belt: 'rubber' },
      { base: 'redLacquer', frame: 'blackLacquer', guide: 'chrome', link: 'chrome', hub: 'blackLacquer', accent: 'polishedGold', belt: 'rubber' },
      { base: 'ivoryLacquer', frame: 'blackLacquer', guide: 'chrome', link: 'redLacquer', hub: 'polishedBrass', accent: 'polishedBrass', belt: 'rubber' },
    ],
  },
};

// Suites d'équilibres (crescendo : le tout-debout est l'avant-dernier sommet
// ou le dernier ; on revient toujours à la chaîne pendante)
export const SEQUENCES = {
  // (un maillon seul : se dresser, puis le « grand tour » — tomber par-dessus
  // et se rattraper debout de l'autre côté, un tour entier —, puis redescendre)
  1: [['D', 'U'], ['D', 'U', 'U'], ['D', 'U', 'U']],
  2: [['DD', 'DU', 'UU', 'UD'], ['DD', 'UD', 'UU', 'DU'], ['DD', 'UU'], ['DD', 'DU', 'UU'], ['DD', 'UD', 'UU']],
  3: [['DDD', 'UUU']], // (la chaîne triple part de la bibliothèque de départs : redressement et descente)
};
// (l'acrobate n'a que l'élan et le grand tour : ses figures repliées ne se lisent pas)
const ACRO_SEQ = [['DD', 'UU'], ['DD', 'UU', 'UD']];

export const FAMILY_KEYS = Object.keys(FAMILIES);

// ── Machine ──────────────────────────────────────────────────────────────────
function machineOf(rng, family, A) {
  const F = FAMILIES[family];
  const n = family === 'cart' ? wpick(rng, [2, 3], [0.6, 0.4]) : family === 'acrobat' ? 2 : family === 'wheel' ? 1 : wpick(rng, [1, 2], [0.65, 0.35]);
  const metal = /Brass|Gold|Copper/.test(A.link) ? 'brass' : /Anodized/.test(A.link) ? 'alu' : 'steel';
  const style = wpick(rng, ['bar', 'tube', 'rod'], [0.45, 0.3, 0.25]);
  const base = family === 'cart' ? (n === 3 ? rng.range(0.27, 0.33) : rng.range(0.32, 0.4)) : family === 'rotary' ? rng.range(0.3, 0.38) : family === 'acrobat' ? rng.range(0.32, 0.38) : rng.range(0.34, 0.42);
  const ratio = rng.pick([1, 0.86, 1.12]);
  const links = Array.from({ length: n }, (_, i) => {
    const l = r3(base * ratio ** i * (family === 'acrobat' && i === 1 ? 1.2 : 1));
    // (barre pleine ou ajourée : fill ; tube : paroi ; tige : pleine, fine)
    const w = r3(style === 'bar' ? rng.range(0.026, 0.034) : style === 'tube' ? rng.range(0.018, 0.022) : rng.range(0.011, 0.014));
    const t = r3(style === 'bar' ? rng.range(0.006, 0.009) : w);
    const fill = style === 'bar' ? r2(rng.range(0.55, 0.75)) : style === 'tube' ? 0.36 : 0.785;
    const bob = (style === 'rod' || (i === n - 1 && rng.chance(0.4))) && family !== 'wheel'
      ? { r: r3(rng.range(0.028, 0.04)), m: r3(rng.range(0.08, 0.16) * (metal === 'alu' ? 0.6 : 1)), at: r2(i === n - 1 ? rng.range(0.82, 0.9) : 0.55) }
      : null;
    return { l, w, t, metal, fill, style, bob };
  });
  const M = { family, links, slots: rng.pick([2, 3, 4]) };
  const sumL = links.reduce((s, L) => s + L.l, 0);
  if (family === 'cart') {
    M.rail = { half: r2(n === 3 ? 0.85 : Math.max(0.62, sumL * 0.6)) };
    M.height = r2(sumL + rng.range(0.12, 0.2));
    M.motorSide = rng.pick([-1, 1]);
    M.chain = rng.chance(0.75);
  } else if (family === 'rotary') {
    M.arm = { r: r3(rng.range(0.22, 0.3)) };
    M.height = r2(sumL + rng.range(0.14, 0.22));
  } else if (family === 'acrobat') {
    M.motor = { m: r3(rng.range(0.4, 0.55)), at: 0.26 }; // (moteur loin de l'axe de l'épaule)
    M.height = r2(sumL + rng.range(0.14, 0.2));
  } else if (family === 'wheel') {
    M.wheel = { m: r3(rng.range(0.45, 0.7)), r: r3(rng.range(0.085, 0.11)), rim: 0.8, motor: 0.22, spokes: rng.pick([5, 6, 8]) };
    M.height = r2(sumL + M.wheel.r + rng.range(0.14, 0.2));
  }
  return M;
}

function filmOf(rng, family, n) {
  const F = FAMILIES[family];
  // (le tourniquet à deux maillons ne se redresse pas d'un seul élan)
  const seqs = family === 'acrobat' ? ACRO_SEQ : family === 'rotary' && n === 2 ? SEQUENCES[2].filter((q) => q[1] !== 'UU') : SEQUENCES[n];
  const seq = rng.pick(seqs);
  const k = seq.length;
  const top = seq.lastIndexOf('U'.repeat(n));
  const moves = seq.map((a, i) => {
    const b = seq[(i + 1) % k];
    const turn = a === b; // (le grand tour : un tour entier, de debout à debout)
    const changes = turn ? n : [...a].filter((ch, j) => ch !== b[j]).length;
    const dir = rng.pick([1, -1]);
    // (sens de bascule : le même pour toute la chaîne, sauf tirage contraire)
    const signs = [...a].map(() => (rng.chance(0.8) ? dir : -dir));
    const T = r2(F.T[Math.min(changes, F.T.length) - 1] * rng.range(1, 1.15) * (turn ? 1.25 : 1));
    // le temps fort : la transition qui arrive au dernier tout-debout
    const slow = (i + 1) % k === top ? { k: r2(rng.range(0.4, 0.6)), span: 0.35 } : null;
    return turn ? { T, signs, slow, turn } : { T, signs, slow };
  });
  const holds = seq.map((code, i) => r2(i === top ? rng.range(2.6, 3.6) : i === 0 ? rng.range(1.6, 2.4) : rng.range(1.4, 2.2)));
  return { seq, moves, holds };
}

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const MO = MOODS[mood];
  const family = overrides.family ?? wpick(rng.fork('family'), FAMILY_KEYS, [0.36, 0.22, 0.2, 0.22]);
  const ra = rng.fork('accord');
  const A = { ...ra.pick(MO.accords) };
  const machine = machineOf(rng.fork('machine'), family, A);
  const film = filmOf(rng.fork('film'), family, machine.links.length);
  const rc = rng.fork('camera'), rl = rng.fork('light');
  const L = MO.light, ks = MO.keyScale ?? 1;
  return {
    v: 1, seed, mood, family,
    machine, film, accord: A,
    camera: {
      // (le tourniquet se lit de trois quarts : de profil, son bras pointe vers l'objectif)
      az: r2(rc.range(...MO.cam.az) * (rc.chance(0.5) ? 1 : -1) + (family === 'rotary' ? rc.pick([-1, 1]) * rc.range(0.5, 0.7) : 0)), el: r2(rc.range(...MO.cam.el)), fov: r2(rc.range(...MO.cam.fov)),
      dist: r2(MO.cam.dist * rc.range(0.9, 1.0)), sway: r2(rc.range(0.04, 0.08)), push: r2(rc.range(0.18, 0.3)),
    },
    light: {
      key: { color: kelvinToHex(L.K + rl.range(-150, 150)), power: r2(L.power * ks * rl.range(0.92, 1.08)), az: r2(L.az + rl.range(-0.1, 0.1)), el: r2(L.el + rl.range(-0.05, 0.05)), dist: L.dist, angle: L.angle, penumbra: L.penumbra },
      rim: L.rims.map((r) => ({ color: kelvinToHex(r.K), power: r2(r.power * ks * rl.range(0.85, 1.1)), az: r2(r.az), el: r2(r.el) })),
    },
    env: { preset: MO.env, intensity: r2(rl.range(...(MO.envIntensity ?? [0.45, 0.65]))), rotation: r2(rl.range(-0.3, 0.3)) },
    stage: { bg: MO.bg, wall: MO.wall, floor: MO.floor, fog: MO.fog, ghosts: !!MO.ghosts, beam: !!MO.beam, sun: !!MO.sun },
    grade: { ...MO.grade },
  };
}

// Recette ancienne (lien partagé) → recette courante
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}

// toutes les finitions citées par les humeurs existent (vérifié par les tests)
export const finishesUsed = () => {
  const s = new Set();
  for (const M of Object.values(MOODS)) { s.add(M.wall); s.add(M.floor); for (const A of M.accords) for (const v of Object.values(A)) s.add(v); }
  return [...s].filter((k) => !FINISHES[k]);
};
