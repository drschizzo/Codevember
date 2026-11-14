// Worker de génération : toute la géométrie (et toute simulation lourde) est
// construite hors du fil principal, à partir d'une spécification JSON ; les
// tampons sont transférés sans copie. Les constructeurs sont des fonctions
// pures, importables depuis Node (tests, bancs d'essai).
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { envPixels } from '../../../shared/gen/envmap.js';
import { featherTexture } from './pattern.js';
import { barbTable, tubeRadius, shapeOf } from './feather.js';
import { layoutBouquet, surfaceAt } from './bouquet.js';
import { buildDown } from './down.js';
import { createRng } from '../../../shared/rng.js';

// la plume d'une scène : motif (réaction-diffusion dans le collier), table
// de barbes (toutes les plumes de la gerbe la partagent), profil du tube
// (rayon de la gaine le long du rachis)
function buildFeather({ shape, pattern, seed, lite }, progress = () => {}) {
  const sz = lite ? { nx: 96, nz: 144 } : {};
  const tex = featherTexture(pattern, pattern.seed ?? seed, sz);
  progress(0.8);
  const hero = barbTable(shape, seed, shape.radial ? shape.count : shape.density * (lite ? 0.7 : 1));
  const rho = new Float32Array(65);
  for (let i = 0; i <= 64; i++) rho[i] = tubeRadius(shape, i / 64);
  progress(1);
  return { tex: tex.data, nx: tex.nx, nz: tex.nz, hero, rho };
}

function build({ spec, what }, progress) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'feather': return buildFeather(spec, progress);
    case 'down': { // le sous-duvet : des houppes d'un centimètre, cuites dans le monde
      // (le socle de la gerbe : des rosettes couchées, serrées, jusque hors du cadre)
      const T = spec.shape;
      const lay = layoutBouquet(T, spec.seed, { lite: spec.lite });
      const D = shapeOf('duvet', createRng(`${spec.seed}:down`));
      D.L = T.L * (T.radial ? 0.22 : 0.15); D.calamus = 0.02; D.spread = [0.7, 1.55]; D.curl = 0.55; // (des houppes gonflées : on doit lire du duvet, pas une peau lisse)
      return buildDown(D, lay, spec.seed, { spacing: D.L * 0.6, lite: spec.lite, th0: 0.004, th1: Math.PI / 2 + (T.L * 0.6) / lay.Rd, phSpan: Math.PI * 2, surface: surfaceAt });
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
