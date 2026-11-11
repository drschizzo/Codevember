// Worker de génération : toute la géométrie (et toute simulation lourde) est
// construite hors du fil principal, à partir d'une spécification JSON ; les
// tampons sont transférés sans copie. Les constructeurs sont des fonctions
// pures, importables depuis Node (tests, bancs d'essai).
import { buildNoiseVolume } from './noisevol.js';
import { envPixels } from './envmap.js';
import { featherTexture } from './pattern.js';
import { barbTable, tubeRadius, shapeOf, layoutPlumage } from './feather.js';
import { solveScene } from './collide.js';
import { buildDown } from './down.js';
import { createRng } from '../rng.js';
import { FAMILIES } from '../families.js';

// la plume d'une scène : motif (réaction-diffusion dans le collier), tables
// de barbes (gabarit fin de la plume héroïne, gabarit grossier des voisines),
// profil du tube (rayon de la gaine le long du rachis)
function buildFeather({ shape, pattern, seed, lite, tileShape = null, tilePattern = null }, progress = () => {}) {
  const sz = lite ? { nx: 96, nz: 144 } : {};
  const tex = featherTexture(pattern, pattern.seed ?? seed, sz);
  const T = tileShape ?? shape, F = FAMILIES[T.family];
  const hero = barbTable(shape, seed, shape.radial ? shape.count : shape.density * (lite ? 0.7 : 1));
  // (les voisines n'ont pas de base duveteuse : elle est sous la rangée du
  // dessus, et ses barbes libres la perçaient en aiguilles blanches)
  const tile0 = barbTable(T, `${seed}:tile`, F.tile.density), keep = [];
  for (let i = 0; i < tile0.length / 16; i++) if (tile0[i * 16 + 7] < 0.35 || T.radial) keep.push(i);
  const tile = new Float32Array(keep.length * 16);
  keep.forEach((i, j) => tile.set(tile0.subarray(i * 16, i * 16 + 16), j * 16));
  const radii = (P) => { const r = new Float32Array(65); for (let i = 0; i <= 64; i++) r[i] = tubeRadius(P, i / 64); return r; };
  const ttex = tileShape ? featherTexture(tilePattern, tilePattern.seed, sz) : null;
  // la scène résolue (gen/collide.js) : la pose de la plume qui se couche, le
  // soulèvement de l'ancienne qui glisse, les voisines qui s'écartent — pour
  // que rien ne traverse rien ; c'est le calcul le plus long du chargement
  const lay = layoutPlumage(shape, seed, { tile: tileShape, lite });
  const R = { shape, tile: tileShape, seed };
  const solved = solveScene(R, lay, { hero, tile: barbTable(T, `${seed}:tile`, 10) }, { N: lite ? 120 : 200, onProgress: progress });
  const idx = new Int32Array([...solved.tiles.keys()]);
  const moves = new Float32Array(idx.length * solved.beta.length * 2);
  [...solved.tiles.values()].forEach((t, k) => moves.set(t, k * solved.beta.length * 2));
  return { tex: tex.data, nx: tex.nx, nz: tex.nz, hero, tile, rho: radii(shape), ttex: ttex?.data ?? null, trho: tileShape ? radii(T) : null, beta: solved.beta, old: solved.old, idx, moves };
}

function build({ spec, what }, progress) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'feather': return buildFeather(spec, progress);
    case 'down': { // le sous-duvet : des houppes d'un centimètre, cuites dans le monde
      const T = spec.tile ?? spec.shape;
      const D = shapeOf('duvet', createRng(`${spec.seed}:down`));
      D.L = T.L * 0.09; D.calamus = 0.02; D.spread = [1.4, 1.75]; D.curl = 0.25; // (des rosettes plates, à peine 1 mm d'épaisseur)
      const lay = layoutPlumage(spec.shape, spec.seed, { tile: spec.tile, lite: spec.lite });
      return buildDown(D, lay, spec.seed, { spacing: T.L * 0.16, lite: spec.lite });
    }
    case 'env': return { data: envPixels(spec.preset, 0, spec.W) };
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    const out = build(data, (f) => self.postMessage({ id: data.id, progress: f }));
    const transfer = [];
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) transfer.push(v.buffer); else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
