// Recette d'une scène : tout ce qui découle de la graine. Un objet JSON
// (partageable par « Copier le lien ») ; le panneau le modifie en place. Le
// rendu ne lit QUE la recette et la phase.
//
// La mise en abyme : une graine tire le décor du dôme (la famille : argent
// guilloché, cloisonné, laque et or, cuivre martelé, nacre — ce qui se répète
// d'un niveau à l'autre — et sa couronne), la finition
// des coupes, le décor, le projecteur, et le sens et l'ampleur de la spirale
// que décrit la caméra. Au fond, toujours le même petit mirascope, vingt fois
// plus petit, et ainsi de suite.
import { createRng } from './rng.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0;
const r4 = (x) => Math.round(x * 10000) / 10000 || 0;

export const kelvin = (K) => {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; } else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

// ── Familles : le décor du dôme — ce qui emplit le cadre, et se répète d'un
// niveau à l'autre — et la couronne qui va avec (jewel : 0 perles, 1 cabochons,
// 2 clous d'or, 3 rivets, 4 perles noires)
export const FAMILIES = {
  guilloche: { label: 'Argent guilloché, couronne de perles', style: 0, jewel: 0, stones: [['#efe9de', '#efe9de']] },
  cloisonne: { label: 'Cloisonné, cabochons', style: 1, jewel: 1, trim: '#f0c46c', stones: [['#2aa7a0', '#d0573e'], ['#1f5fa8', '#e2b23c'], ['#2f8a4a', '#b8324a']] },
  laque: { label: 'Laque noire et or, clous d’or', style: 2, jewel: 2, trim: '#f0c46c', stones: [['#ffc66b', '#ffc66b']] },
  martele: { label: 'Cuivre martelé, rivets', style: 3, jewel: 3, trim: '#eaa287', stones: [['#f0a070', '#f0a070']] },
  nacre: { label: 'Nacre, perles noires', style: 4, jewel: 4, trim: '#f2f0ea', stones: [['#3a3843', '#4a3f52']] },
};
// (les gravures de l'argent guilloché)
export const PATTERNS = ['vagues', 'soleil', 'spirale'];

// ── Finitions des coupes (dehors ; dedans, toujours l'argent poli) ─────────
export const FINISHES = {
  argent: { label: 'Argent guilloché', color: '#ece9e2', rough: 0.16, engrave: 1 },
  vermeil: { label: 'Vermeil', color: '#f1d7a0', rough: 0.2, engrave: 1 },
  etain: { label: 'Étain satiné', color: '#c9c9c4', rough: 0.34, engrave: 0.4 },
  cuivre: { label: 'Cuivre poli', color: '#f2c3a6', rough: 0.14, engrave: 0.6 },
};

// ── Décors ──────────────────────────────────────────────────────────────────
export const MOODS = {
  cabinet: { tableKind: 0, label: 'Cabinet', env: 'cabinetM', envI: 1, table: '#2a1712', tableRough: 0.85, lamp: 3400, key: 2.2, ambient: 0.16, finishes: ['argent', 'vermeil'],
    grade: { contrast: 1.06, saturation: 1.02, shadows: [0.98, 0.97, 1.04], highlights: [1.04, 1.0, 0.94], exposure: 1.1 } },
  atelier: { tableKind: 1, label: 'Atelier d’horloger', env: 'atelierM', envI: 1, table: '#5a4632', tableRough: 0.6, lamp: 5200, key: 2.6, ambient: 0.22, finishes: ['argent', 'etain', 'cuivre'],
    grade: { contrast: 1.03, saturation: 0.98, shadows: [0.96, 0.99, 1.05], highlights: [1.03, 1.0, 0.96], exposure: 1.0 } },
  salon: { tableKind: 2, label: 'Salon de marbre', env: 'salonM', envI: 1, table: '#d9d4cc', tableRough: 0.35, lamp: 5600, key: 2.0, ambient: 0.3, finishes: ['argent', 'vermeil', 'cuivre'],
    grade: { contrast: 1.0, saturation: 0.95, shadows: [0.97, 1.0, 1.04], highlights: [1, 1, 1], exposure: 0.85 } },
  nuit: { tableKind: 3, label: 'Nuit', env: 'nuitM', envI: 1, table: '#16241c', tableRough: 0.8, lamp: 4200, key: 1.3, ambient: 0.08, finishes: ['argent', 'etain'],
    grade: { contrast: 1.12, saturation: 1.05, shadows: [0.92, 0.96, 1.1], highlights: [1.02, 1.0, 0.97], exposure: 1.9 } },
};

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = MOODS[overrides.mood] ? overrides.mood : rng.fork('mood').pick(Object.keys(MOODS));
  const family = FAMILIES[overrides.family] ? overrides.family : rng.fork('family').pick(Object.keys(FAMILIES));
  const M = MOODS[mood];
  const rc = rng.fork('camera'), rf = rng.fork('finish'), rl = rng.fork('light');
  return {
    v: 9, seed, mood, family, pattern: rng.fork('pattern').pick(PATTERNS), stones: rng.fork('stones').pick(FAMILIES[family].stones),
    loop: { duration: 24 },
    // l'émail de la bande gravée : bleu nuit, vert anglais, grenat, noir
    mirascope: { f: 0.05, finish: rf.pick(M.finishes), enamel: rf.fork('enamel').pick(['#1c2b5e', '#163d31', '#5a1622', '#1a1817']) },
    light: { spot: r2(rl.range(26, 34)), spotK: Math.round(rl.range(3000, 3600)), sheen: r4(rl.range(0.03, 0.05)) },
    // la caméra : son azimut (l'entaille du couvercle lui fait face), et un
    // balancement léger, d'un côté puis de l'autre, une fois par niveau
    camera: { az: r2(rc.range(0, 360)), sway: r2((rc.chance(0.5) ? -1 : 1) * rc.range(6, 12)) },
    grade: { ...M.grade },
  };
}

export function upgrade(R) {
  if (R.v !== 9) return generate(R.seed);
  const D = generate(R.seed, { mood: R.mood, family: R.family });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
