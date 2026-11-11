// Worker de génération : la pièce (géométrie), son champ de corrosion et ses
// cartes d'accès, construits hors du fil principal ; tampons transférés sans
// copie. Les constructeurs sont des fonctions pures (importables depuis Node).
import { buildNoiseVolume } from './noisevol.js';
import { buildPiece } from './pieces.js';
import { corrosionField } from './corrosion.js';
import { buildMachine } from './machinery.js';

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'piece': {
      const P = buildPiece(spec);
      const C = corrosionField(P.body, { seed: spec.seed, lite: spec.lite });
      return { ...P, corrosion: C };
    }
    case 'machine': return buildMachine(spec);
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
