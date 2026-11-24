// Worker de génération : toute la géométrie (et toute simulation lourde) est
// construite hors du fil principal, à partir d'une spécification JSON ; les
// tampons sont transférés sans copie. Les constructeurs sont des fonctions
// pures, importables depuis Node (tests, bancs d'essai).
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';

import { slabTextures } from './slabtex.js';

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'slab': return slabTextures(spec);
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
