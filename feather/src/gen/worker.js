// Worker de génération : toute la géométrie (et toute simulation lourde) est
// construite hors du fil principal, à partir d'une spécification JSON ; les
// tampons sont transférés sans copie. Les constructeurs sont des fonctions
// pures, importables depuis Node (tests, bancs d'essai).
import { buildNoiseVolume } from './noisevol.js';
import { envPixels } from './envmap.js';
import { featherTexture } from './pattern.js';
import { barbTable, tubeRadius } from './feather.js';
import { FAMILIES } from '../families.js';

// la plume d'une scène : motif (réaction-diffusion dans le collier), tables
// de barbes (gabarit fin de la plume héroïne, gabarit grossier des voisines),
// profil du tube (rayon de la gaine le long du rachis)
function buildFeather({ shape, pattern, seed, lite, tileShape = null, tilePattern = null }) {
  const sz = lite ? { nx: 96, nz: 144 } : {};
  const tex = featherTexture(pattern, pattern.seed ?? seed, sz);
  const T = tileShape ?? shape, F = FAMILIES[T.family];
  const hero = barbTable(shape, seed, shape.radial ? shape.count : shape.density * (lite ? 0.7 : 1));
  const tile = barbTable(T, `${seed}:tile`, F.tile.density);
  const radii = (P) => { const r = new Float32Array(65); for (let i = 0; i <= 64; i++) r[i] = tubeRadius(P, i / 64); return r; };
  const ttex = tileShape ? featherTexture(tilePattern, tilePattern.seed, sz) : null;
  return { tex: tex.data, nx: tex.nx, nz: tex.nz, hero, tile, rho: radii(shape), ttex: ttex?.data ?? null, trho: tileShape ? radii(T) : null };
}

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'feather': return buildFeather(spec);
    case 'env': return { data: envPixels(spec.preset, 0, spec.W) };
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    const out = build(data);
    const transfer = [];
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) transfer.push(v.buffer); else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
