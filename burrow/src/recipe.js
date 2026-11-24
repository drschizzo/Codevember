// Recette d'une scène (objet JSON partageable). Le rendu ne lit QUE la recette
// et la phase. (Look-dev de la coupe vivante : une humeur, une palette.)
import { createRng } from '../../shared/rng.js';
import { FINISHES } from '../../shared/finishes.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0;
export const kelvinToHex = (K) => {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};
const fin = (o, i = o, e = o) => ({ outer: { ...FINISHES[o], preset: o }, inner: { ...FINISHES[i], preset: i }, edge: { ...FINISHES[e], preset: e }, wear: 0 });

// sables (de bas en haut) : des teintes de vrais sables
export const PALETTES = {
  roussillon: { label: 'Ocres', cols: ['#221f1d', '#b86a2c', '#e8dfcc', '#8a2f1a', '#d6a447', '#5e5a54', '#efdcab', '#a8471f'] },
  littoral: { label: 'Littoral', cols: ['#1d1e21', '#ece6da', '#a7a59f', '#f2efe6', '#d9b5a6', '#6e7158', '#e0d6c0', '#4b4a48'] },
  volcan: { label: 'Volcan', cols: ['#18181a', '#7a2b1c', '#8b8985', '#d6c15a', '#d8d3c8', '#9b4a26', '#3a3735', '#c9c2b4'] },
  desert: { label: 'Désert', cols: ['#8c5a3a', '#e8c98f', '#c9773a', '#f1e3c4', '#b3502a', '#e2b66a', '#f3dcae', '#a0412a'] },
  // des sables de bijoutier : grenat, olivine, obsidienne, corail, quartz, magnétite, améthyste, citrine
  joaillier: { label: 'Joaillier', cols: ['#6d1420', '#6b7a2a', '#141417', '#e0a4a0', '#efe9df', '#2a2a2e', '#5e3a6e', '#d8a93a'], kinds: { 2: 'verre', 3: 'nacre', 6: 'verre', 7: 'billes' } },
  // verre de mer roulé : bleus, verts, blancs givrés, ambre, avec des billes
  verre: { label: 'Verre de mer', cols: ['#9fc8c0', '#6fa0b8', '#c8d8b0', '#e8e4dc', '#7a4a2a', '#2e5a4a', '#b9c8d8', '#d9b8c8'], kinds: { 0: 'verre', 1: 'verre', 2: 'verre', 3: 'billes', 4: 'verre', 5: 'verre', 6: 'billes', 7: 'nacre' } },
};
// les tranches : un motif de sable, un creuseur, un cadre — trois tranches
// différentes par étagère
export const STYLES = { lits: 'Lits', sablier: 'Sablier', dunes: 'Dunes', eventail: 'Éventail' };
export const DIGGERS = { fourmis: 'Fourmis', vers: 'Vers' };
export const FRAMES = {
  fer: { label: 'Fer noirci', set: ['blackenedSteel', 'blackenedSteel', 'brushedSteel'] },
  laiton: { label: 'Laiton', set: ['polishedBrass', 'polishedBrass', 'brushedBrass'] },
  vermillon: { label: 'Laque vermillon', set: ['urushiRed', 'urushiRed', 'polishedBrass'] },
  acier: { label: 'Acier brossé', set: ['brushedSteel', 'brushedSteel', 'chrome'] },
  ebene: { label: 'Laque noire', set: ['urushi', 'urushi', 'polishedBrass'] },
};
// humeurs : un décor (table, mur), une lumière (soleil : azimut, hauteur, force ;
// ciel), un cadrage. Les sables possibles par humeur.
export const MOODS = {
  rebord: {
    label: 'Rebord', floor: { type: 'parquet', c1: '#b48a5c', c2: '#d8b88a' }, table: ['#d4d0c7', 0.6], wall: ['#b3b0a9', 0.92], env: 'roomPale', sunK: 5600, sun: 11.9, sunAz: 0.42, sunEl: 0.42,
    sky: ['#c9d3e0', '#8a857c'], hemi: 0.21, palettes: ['roussillon', 'desert', 'joaillier'], cam: { h: [1.9, 2.1], dist: [6.4, 6.8] },
    grade: { contrast: 1.1, saturation: 1.24, shadows: [0.97, 1.0, 1.04], highlights: [1.02, 1.0, 0.97] },
  },
  nord: {
    label: 'Nord', floor: { type: 'dalles', c1: '#4f5761', c2: '#6c747c' }, table: ['#5d6166', 0.7], wall: ['#8e98a3', 0.94], env: 'roomSlate', sunK: 7400, sun: 4.1, sunAz: 0.42, sunEl: 0.6,
    sky: ['#c3d0e2', '#4a4d52'], hemi: 0.51, palettes: ['littoral', 'volcan', 'verre'], cam: { h: [1.6, 1.8], dist: [6.0, 6.4] },
    grade: { contrast: 1.04, saturation: 1.07, shadows: [0.96, 1.0, 1.06], highlights: [1.0, 1.0, 1.02] },
  },
  hiver: {
    label: 'Hiver', floor: { type: 'parquet', c1: '#6e6a64', c2: '#8f8a82' }, table: ['#3b3e43', 0.75], wall: ['#6f7c8e', 0.92], env: 'roomWinter', sunK: 6500, sun: 13.6, sunAz: 0.42, sunEl: 0.2,
    sky: ['#a9c1e6', '#2e3238'], hemi: 0.24, palettes: ['volcan', 'littoral', 'roussillon'], cam: { h: [1.2, 1.4], dist: [6.2, 6.6] },
    grade: { contrast: 1.12, saturation: 1.12, shadows: [0.93, 0.99, 1.09], highlights: [1.02, 1.0, 0.98] },
  },
  cabinet: {
    label: 'Cabinet', floor: { type: 'parquet', c1: '#2a1c14', c2: '#4a3020' }, table: ['#131212', 0.35], wall: ['#1d1b1a', 0.95], env: 'roomDark', sunK: 5200, sun: 15.3, sunAz: 0.42, sunEl: 0.38,
    sky: ['#3c3c46', '#121111'], hemi: 0.07, palettes: ['desert', 'joaillier', 'littoral'], cam: { h: [1.9, 2.1], dist: [5.8, 6.2] },
    grade: { contrast: 1.14, saturation: 1.17, shadows: [0.95, 0.98, 1.06], highlights: [1.03, 1.0, 0.96] },
  },
  midi: {
    label: 'Midi', floor: { type: 'granito', c1: '#e6e2da', c2: '#b4573a' }, table: ['#e9e7e2', 0.55], wall: ['#eeedea', 0.95], env: 'roomWhite', sunK: 6000, sun: 11.0, sunAz: 0.42, sunEl: 0.75,
    sky: ['#e8eef6', '#b8b4ac'], hemi: 0.27, palettes: ['littoral', 'verre', 'volcan'], cam: { h: [2.4, 2.7], dist: [6.6, 7.0] },
    grade: { contrast: 1.16, saturation: 1.17, shadows: [1.0, 1.0, 1.02], highlights: [1.0, 1.0, 1.0] },
  },
  vertdegris: {
    label: 'Vert-de-gris', floor: { type: 'zinc', c1: '#a7afb0', c2: '#7f9c8f' }, table: ['#7d8580', 0.45], wall: ['#9aa89f', 0.92], env: 'roomGreen', sunK: 5800, sun: 7.6, sunAz: 0.42, sunEl: 0.5,
    sky: ['#d8e6dc', '#5f665f'], hemi: 0.33, palettes: ['roussillon', 'joaillier', 'verre'], cam: { h: [2.1, 2.4], dist: [6.4, 6.8] },
    grade: { contrast: 1.06, saturation: 1.12, shadows: [0.97, 1.0, 1.0], highlights: [1.0, 1.01, 0.99] },
  },
};
export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood && MOODS[overrides.mood] ? overrides.mood : rng.fork('mood').pick(Object.keys(MOODS));
  const M = MOODS[mood], rc = rng.fork('camera'), rp = rng.fork('palette'), rl = rng.fork('light');
  const palette = overrides.palette ?? rp.pick(M.palettes);
  return {
    v: 2, seed, mood, palette,
    slabs: (() => {
      const rs = rng.fork('slabs');
      const st = Object.keys(STYLES).sort(() => rs.next() - 0.5).slice(0, 3);
      const fr = Object.keys(FRAMES).sort(() => rs.next() - 0.5);
      return [0, 1, 2].map((k) => ({ seed: `${seed}-${k}`, params: { style: st[k], digger: rs.chance(0.3) ? 'vers' : 'fourmis' }, frame: fr[k] }));
    })(),
    loop: { duration: 45 },
    sands: PALETTES[palette].cols.slice(), mix: [0.84, 0.06, 0.06],
    // chaque sable : la taille de son grain (fin, moyen, gros ; au plus un gravier) et sa part de mica
    ...(() => {
      const rg = rng.fork('grain');
      let gravel = false;
      const sizes = PALETTES[palette].cols.map(() => {
        const g = rg.weighted([['fin', 25], ['moyen', 45], ['gros', 22], ['gravier', gravel ? 0 : 8]]);
        if (g === 'gravier') gravel = true;
        return { fin: 0.0024, moyen: 0.0035, gros: 0.0055, gravier: 0.013 }[g];
      });
      const mica = PALETTES[palette].cols.map(() => (rg.chance(0.2) ? r2(rg.range(0.05, 0.12)) : 0));
      // la nature de chaque sable : sable, verre pilé, billes de verre, nacre
      // (les jeux de bijoutier et de verre de mer l'imposent ; ailleurs, une
      //  fantaisie de temps en temps)
      const P = PALETTES[palette];
      const kind = P.cols.map((_, i) => P.kinds?.[i] ?? (rg.chance(0.12) ? rg.pick(['verre', 'billes', 'nacre']) : 'sable'));
      kind.forEach((k, i) => { if (k === 'billes') sizes[i] = 0.0045; if (k === 'verre') sizes[i] = Math.max(sizes[i], 0.0045); if (k === 'nacre') sizes[i] = 0.005; });
      return { grain: sizes, mica, kind };
    })(),
    camera: { fov: 26, dist: r2(rc.range(...M.cam.dist)), height: r2(rc.range(...M.cam.h)), az: r2(rc.range(0.06, 0.14)), sway: 0.01, target: 1.55 },
    sun: { az: r2(M.sunAz + rl.range(-0.04, 0.04)), el: r2(M.sunEl + rl.range(-0.03, 0.03)), color: kelvinToHex(M.sunK + rl.range(-200, 200)), intensity: r2(M.sun * rl.range(0.94, 1.06)) },
    env: { preset: M.env, intensity: 0.55, rotation: 0 },
    room: { table: M.table, wall: M.wall, sky: M.sky, hemi: M.hemi },
    floor: { ...M.floor },
    fog: { color: M.wall[0], near: 30, far: 60 },
    grade: { ...M.grade },
  };
}
export function upgrade(R) { const D = generate(R.seed, { mood: R.mood }); for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k]; return R; }
