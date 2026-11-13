// Worker de génération : volume de bruit, carte des vaisseaux, et couches
// (armature + simulation de la membrane). Les tampons sont transférés sans copie.
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { buildLevel } from './level.js';
import { buildVessels } from './vessels.js';

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'level': return buildLevel(spec);
    case 'vessels': return buildVessels(spec);
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
