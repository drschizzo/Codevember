// Worker de génération : la cuisson du pavage (contours, distances), les
// instances du groupe, les langues de cire. Fonctions pures, importables
// depuis Node (tests, bancs d'essai).
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { bakeTiling, bakeInstances } from './bake.js';
import { buildLobes } from './lobes.js';

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'tiling': return bakeTiling(spec);
    case 'instances': return bakeInstances(spec.group, spec.path, spec.profiles, spec.R, spec.amp);
    case 'lobes': return buildLobes(spec);
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    const out = build(data);
    const transfer = [];
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) transfer.push(v.buffer); else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, [...new Set(transfer)]);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
