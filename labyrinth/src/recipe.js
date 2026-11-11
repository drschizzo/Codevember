// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette, le film simulé (qui ne dépend que
// de la recette) et la phase.
//
// Règles (skill codevember-scene, references/art-direction.md) :
// - chaque tirage a son flux (rng.fork('…')) ;
// - les matières viennent d'accords composés à la main, par humeur ;
// - les lampes sont presque blanches ; la chaleur vient des matières, du fond,
//   des contre-jours et de l'étalonnage.
import { createRng } from './rng.js';
import { FINISHES } from './finishes.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0; // (|| 0 : jamais de −0, que JSON ne garde pas)

export const kelvinToHex = (K) => {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

// ── Familles ─────────────────────────────────────────────────────────────────
// Plateau : la bille roule (deux axes, continu) ; Cadran : elle chute (quarts
// de tour) ; Roue : elle reste en bas pendant que le disque tourne.
export const FAMILIES = {
  plateau: { label: 'Plateau (la bille roule)' },
  cadran: { label: 'Cadran (la bille chute)' },
  roue: { label: 'Roue (la bille reste en bas)' },
};

// ── Humeurs ──────────────────────────────────────────────────────────────────
// Un décor chacune : support, fond, lumière, valeur, cadrage. Accords :
// board [fond, rigole, chant], walls [paroi, —, poteau], ball, metal [corps,
// —, pièces polies], base [socle, —, chant], support.
const A = (board, walls, ball, metal, base, support) => ({ board, walls, ball, metal, base, support });
export const MOODS = {
  cabinet: {
    label: 'Cabinet', env: 'atelier', bg: '#100c09', keyK: 4900, rim: ['#ffd9b0', '#b8c8ff'], keyScale: 1.25, envIntensity: [0.6, 0.8],
    key: { az: [-2.6, -2.1], el: [0.45, 0.62], angle: 0.42, penumbra: 0.55 }, style: 'strip',
    cam: { el: [0.42, 0.62], az: [-0.5, 0.35], fill: 0.86 },
    accords: [
      A(['walnut', 'feltGreen', 'walnutEnd'], ['polishedBrass', 'polishedBrass', 'polishedBrass'], 'steelBall', ['blackenedSteel', 'blackenedSteel', 'nickel'], ['walnut', 'walnut', 'walnutEnd'], 'leather'),
      A(['walnut', 'feltBlack', 'walnutEnd'], ['nickel', 'nickel', 'polishedBrass'], 'steelBall', ['polishedBrass', 'polishedBrass', 'nickel'], ['ebony', 'ebony', 'ebony'], 'leather'),
    ],
    grade: { contrast: 1.06, saturation: 1.0, shadows: [0.95, 0.98, 1.06], highlights: [1.05, 1.0, 0.93], exposure: 1.35 },
  },
  carrare: {
    label: 'Carrare', env: 'cyclo', bg: '#cfccc6', keyK: 6000, rim: ['#ffffff', '#e2e9ff'], keyScale: 0.75, envIntensity: [0.22, 0.3],
    key: { az: [-1.9, -1.2], el: [0.62, 0.8], angle: 0.6, penumbra: 0.8 }, style: 'carved',
    cam: { el: [0.62, 0.86], az: [-0.35, 0.35], fill: 0.84 },
    accords: [
      A(['marble', 'marble', 'marble'], ['marble', 'marble', 'marble'], 'obsidian', ['nickel', 'nickel', 'chrome'], ['marble', 'marble', 'marble'], 'plaster'),
      A(['marble', 'bone', 'marble'], ['marble', 'marble', 'marble'], 'blackCeramic', ['rawTitanium', 'rawTitanium', 'chrome'], ['bone', 'bone', 'bone'], 'plaster'),
    ],
    grade: { contrast: 0.98, saturation: 0.88, shadows: [0.98, 1.0, 1.03], highlights: [1, 1, 1], exposure: 1 },
  },
  laque: {
    label: 'Laque', env: 'studio', bg: '#050405', keyK: 5200, rim: ['#ffe6d0', '#9fb6ff'], keyScale: 1.6, envIntensity: [0.5, 0.65],
    key: { az: [-3.0, -2.75], el: [0.22, 0.34], angle: 0.36, penumbra: 0.35 }, style: 'strip',
    cam: { el: [0.24, 0.4], az: [-0.25, 0.4], fill: 0.9 },
    accords: [
      A(['lacquerBlack', 'lacquerRed', 'lacquerBlack'], ['lacquerRed', 'lacquerRed', 'polishedGold'], 'porcelain', ['blackenedSteel', 'blackenedSteel', 'polishedGold'], ['lacquerBlack', 'lacquerBlack', 'lacquerBlack'], 'ebony'),
      A(['lacquerRed', 'lacquerBlack', 'lacquerRed'], ['lacquerBlack', 'lacquerBlack', 'polishedGold'], 'porcelain', ['blackenedSteel', 'blackenedSteel', 'polishedGold'], ['ebony', 'ebony', 'ebony'], 'ebony'),
    ],
    grade: { contrast: 1.1, saturation: 1.02, shadows: [0.97, 0.95, 1.04], highlights: [1.03, 1.0, 0.97], exposure: 1.7 },
  },
  ardoise: {
    label: 'Ardoise', env: 'softbox', bg: '#3b4247', keyK: 7000, rim: ['#e8efff', '#ffffff'], keyScale: 0.8, envIntensity: [0.45, 0.6],
    key: { az: [-1.2, -0.6], el: [0.8, 1.0], angle: 0.6, penumbra: 0.9 }, style: 'strip',
    cam: { el: [0.7, 0.95], az: [-0.3, 0.3], fill: 0.82 },
    accords: [
      A(['slateHoned', 'slate', 'slate'], ['bone', 'bone', 'bone'], 'polishedBrass', ['brushedSteel', 'brushedSteel', 'chrome'], ['oak', 'oak', 'oak'], 'oakTable'),
      A(['slate', 'feltBlack', 'slate'], ['bone', 'bone', 'nickel'], 'steelBall', ['brushedSteel', 'brushedSteel', 'chrome'], ['ash', 'ash', 'ash'], 'oakTable'),
    ],
    grade: { contrast: 1.02, saturation: 0.9, shadows: [0.94, 0.99, 1.08], highlights: [1.0, 1.0, 1.02], exposure: 1 },
  },
  beton: {
    label: 'Béton', env: 'overcast', bg: '#6d6e6f', keyK: 6500, rim: ['#ffffff', '#dfe6f0'], keyScale: 0.7, envIntensity: [0.6, 0.8],
    key: { az: [0.6, 1.3], el: [0.9, 1.2], angle: 0.7, penumbra: 0.95 }, style: 'carved',
    cam: { el: [0.48, 0.7], az: [-0.6, 0.6], fill: 0.72 },
    accords: [
      A(['concrete', 'concrete', 'concrete'], ['concrete', 'concrete', 'concrete'], 'polishedCopper', ['rawSteel', 'rawSteel', 'brushedSteel'], ['oak', 'oak', 'oak'], 'concrete'),
      A(['concrete', 'slate', 'concrete'], ['concrete', 'concrete', 'concrete'], 'obsidian', ['blackenedSteel', 'blackenedSteel', 'brushedSteel'], ['concrete', 'concrete', 'concrete'], 'concrete'),
    ],
    grade: { contrast: 1.0, saturation: 0.8, shadows: [0.97, 1.0, 1.04], highlights: [1, 1, 1], exposure: 1 },
  },
  celadon: {
    label: 'Céladon', env: 'clearsky', bg: '#d9cfbd', keyK: 5600, rim: ['#fff1dc', '#ffffff'], keyScale: 1.25, envIntensity: [0.35, 0.5],
    key: { az: [1.9, 2.5], el: [0.55, 0.75], angle: 0.32, penumbra: 0.15 }, style: 'carved',
    cam: { el: [0.4, 0.62], az: [-0.45, 0.45], fill: 0.86 },
    accords: [
      A(['celadon', 'bone', 'celadon'], ['celadon', 'celadon', 'celadon'], 'polishedCopper', ['bronzeDark', 'bronzeDark', 'polishedBrass'], ['ash', 'ash', 'ash'], 'linen'),
      A(['celadon', 'celadon', 'bone'], ['celadon', 'celadon', 'celadon'], 'obsidian', ['nickel', 'nickel', 'chrome'], ['oak', 'oak', 'oak'], 'linen'),
    ],
    grade: { contrast: 1.04, saturation: 0.95, shadows: [0.96, 0.98, 1.04], highlights: [1.04, 1.01, 0.95], exposure: 1 },
  },
};

const fin = (k) => ({ ...FINISHES[k], preset: k });
export const setOf = ([a, b, c], wear = 0) => ({ outer: fin(a), inner: fin(b), edge: fin(c), wear });

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const family = overrides.family ?? rng.fork('family').weighted([['plateau', 4], ['cadran', 3], ['roue', 3]]);
  const M = MOODS[mood];
  const ra = rng.fork('accord'), rf = rng.fork('form'), rc = rng.fork('camera'), rl = rng.fork('light');
  const acc = ra.pick(M.accords);

  // le labyrinthe
  let maze;
  if (family === 'plateau') {
    const polar = rf.chance(0.4);
    maze = polar
      ? { topo: 'polar', K: rf.int(5, 7) }
      : { topo: 'grid', nx: rf.int(9, 13), ny: rf.int(7, 10), gateAxis: 'x' };
    maze.detours = rf.int(1, 3);
    maze.lap = rf.pick(['short', 'long']);
  } else if (family === 'cadran') maze = { topo: 'grid', nx: rf.int(7, 9), gateAxis: 'x' };
  else maze = { topo: 'polar', K: rf.int(5, 7) };
  if (family === 'cadran') maze.ny = maze.nx;
  maze.c = 22; maze.r0 = 22;
  maze.turn = rf.sign();
  maze.style = M.style;

  // disques dressés : vus de trois quarts, plus bas (la colonne, la courroie et
  // la poulie se lisent), éclairés de côté en lumière rasante sur la face
  const disc = family !== 'plateau';
  const side = rc.sign();
  const camAz = disc ? side * rc.range(0.5, 0.78) : rc.range(...M.cam.az);
  const camEl = disc ? rc.range(0.1, 0.28) + (M.cam.el[0] > 0.6 ? 0.08 : 0) : rc.range(...M.cam.el);
  const keyAz = disc ? -side * rl.range(0.95, 1.3) : rl.range(...M.key.az);
  const keyEl = disc ? rl.range(0.32, 0.55) : rl.range(...M.key.el);
  return {
    v: 1, seed, mood, family,
    maze,
    // la durée de la boucle est celle du trajet simulé (temps réel) ; on peut la ralentir
    loop: { speed: 1 },
    camera: {
      fov: r2(rc.range(26, 32)), el: r2(camEl), az: r2(camAz), fill: r2(M.cam.fill * 1.3),
      follow: r2(rc.range(0.45, 0.6)), sway: r2(rc.range(0.03, 0.07)),
    },
    light: {
      key: { color: kelvinToHex(M.keyK + rl.range(-150, 150)), intensity: r2(rl.range(0.9, 1.1) * M.keyScale), az: r2(keyAz), el: r2(keyEl), angle: M.key.angle, penumbra: M.key.penumbra },
      rim: M.rim.map((c, i) => ({ color: c, intensity: r2((i ? rl.range(0.15, 0.3) : rl.range(0.4, 0.6)) * M.keyScale), az: r2(i ? rl.range(0.5, 1.1) : rl.range(2.0, 2.6)), el: r2(rl.range(0.3, 0.55)) })),
    },
    env: { preset: M.env, intensity: r2(rl.range(...M.envIntensity)), rotation: r2(rl.range(0, Math.PI * 2)) },
    fog: { color: M.bg },
    finishes: {
      board: setOf(acc.board), walls: setOf(acc.walls), ball: setOf([acc.ball, acc.ball, acc.ball]),
      metal: setOf(acc.metal), base: setOf(acc.base), support: setOf([acc.support, acc.support, acc.support]),
    },
    grade: { ...M.grade },
  };
}

// spécification du labyrinthe et du film (ce que le worker calcule)
export const sceneSpec = (R) => ({ ...R.maze, family: R.family, seed: R.seed });

// Recette ancienne (lien partagé) → recette courante
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
