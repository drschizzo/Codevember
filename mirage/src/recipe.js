// Recette d'une scène : tout ce qui découle de la graine. Un objet JSON
// (partageable par « Copier le lien ») ; le panneau le modifie en place. Le
// rendu ne lit QUE la recette et la phase.
//
// Le mirascope : une graine tire l'objet posé au fond (la famille : ce qui
// bouge dans l'image — une toupie qui tourne, une montre qui marche, une
// bougie qui brûle), l'argent des coupes, le décor, et la chorégraphie
// (hauteur du couvercle levé, regard de la caméra).
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

// ── Familles : l'objet au fond, et ce qui bouge dans son image ─────────────
export const FAMILIES = {
  toupie: { label: 'Toupie — l’image tourne en l’air', kind: 0, colors: [['#b3322a', '#efe2c0'], ['#2a4f8a', '#e9d8a8'], ['#1f6b4f', '#f0e6cc'], ['#e0a21b', '#3b2416']] },
  montre: { label: 'Montre — l’heure flotte, tournée d’un demi-tour', kind: 1, colors: [['#c9a35a', '#efe9dc']] },
  bougie: { label: 'Chauffe-plat — la flamme brûle dans le vide', kind: 2, colors: [['#8e1f1a', '#ffffff'], ['#c9b48a', '#ffffff'], ['#2f4a35', '#ffffff'], ['#b8862e', '#ffffff']] },
  boussole: { label: 'Boussole — l’aiguille de l’image montre le sud', kind: 3, colors: [['#b3261e', '#efe6d2'], ['#9c1c1c', '#e8dcc0'], ['#c23b22', '#f3eee2']] },
  pieces: { label: 'Pièces d’or — un trésor qu’on ne peut pas prendre', kind: 4, colors: [['#f0c060', '#ffffff'], ['#e8b04a', '#ffffff'], ['#d9d6cf', '#ffffff']] },
};

// ── Machinerie : ce qui lève le couvercle (voir scene/machine.js) ──────────
export const MECHANISMS = { cremaillere: 'Crémaillère et pignon', vis: 'Trois vis et leur chaîne', poulies: 'Poulies et treuil' };

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
  nuit: { tableKind: 3, label: 'Nuit', env: 'nuitM', envI: 1, table: '#16241c', tableRough: 0.8, lamp: 4200, key: 0.9, ambient: 0.05, finishes: ['argent', 'etain'],
    grade: { contrast: 1.12, saturation: 1.05, shadows: [0.92, 0.96, 1.1], highlights: [1.02, 1.0, 0.97], exposure: 1.9 } },
};

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const family = FAMILIES[overrides.family] ? overrides.family : rng.fork('family').pick(Object.keys(FAMILIES));
  const mood = MOODS[overrides.mood] ? overrides.mood : rng.fork('mood').pick(Object.keys(MOODS));
  const F = FAMILIES[family], M = MOODS[mood];
  const ro = rng.fork('object'), rc = rng.fork('camera'), rf = rng.fork('finish'), rm = rng.fork('mechanism');
  const mechanism = MECHANISMS[overrides.mechanism] ? overrides.mechanism : rm.pick(Object.keys(MECHANISMS));
  const camAz = r2(rc.range(0, 360));
  // la machinerie derrière la coupe, de côté (vue de la caméra) ; les trois vis :
  // une tige juste derrière, les deux autres de part et d'autre
  const yaw = r2(camAz + 90 + (mechanism === 'vis' ? 0 : (rm.chance(0.5) ? -1 : 1) * rm.range(30, 60)));
  const [c1, c2] = ro.pick(F.colors);
  return {
    v: 4, seed, family, mood,
    loop: { duration: 20 },
    mirascope: { f: 0.05, finish: rf.pick(M.finishes), liftMax: r4(rf.range(0.028, 0.036)) },
    mechanism: { kind: mechanism, yaw },
    object: { c1, c2, spinTurns: ro.pick([24, 30, 36]), tilt: r2(ro.range(0.03, 0.08)), secondTurns: 2, hour: r2(ro.range(0, 12)), north: r2(ro.range(-Math.PI, Math.PI)), cardRot: r2(ro.range(-0.6, 0.6)) },
    camera: { dist: r2(rc.range(0.36, 0.42)), elevHigh: r2(rc.range(40, 47)), elevLow: r2(rc.range(14, 19)), az: camAz, sway: r2(rc.range(10, 16)), fov: r2(rc.range(24, 28)) },
    grade: { ...M.grade },
  };
}

export function upgrade(R) {
  if (R.v !== 4) return generate(R.seed);
  const D = generate(R.seed, { mood: R.mood, family: R.family, mechanism: R.mechanism?.kind });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
