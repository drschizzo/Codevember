// Worker de génération : toute la géométrie est construite hors du fil
// principal, à partir de la recette ; les tampons sont transférés sans copie.
// Les constructeurs (gen/build.js) sont des fonctions pures, importables
// depuis Node (tests, bancs d'essai).
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { envPixels } from './envmap.js';
import { buildScene } from './build.js';

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'env': return { data: envPixels(spec.key, 0, spec.size) };
    case 'scene': return buildScene(spec.R, spec.opts);
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
