// Worker de génération : le bobinage complet d'une scène (chemin, dépôt, table
// de transmission, cinématique de l'œil) et la géométrie de l'appareil, hors
// du fil principal ; les tampons sont transférés sans copie. Fonctions pures,
// importables depuis Node (tests, bancs d'essai).
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { buildScene } from './build.js';

function build({ spec, what, id }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'scene': return buildScene(spec, (p) => self.postMessage({ id, progress: p }));
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    const out = build(data);
    const transfer = [];
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) { if (!transfer.includes(v.buffer)) transfer.push(v.buffer); } else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
