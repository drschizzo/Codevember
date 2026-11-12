// Worker de génération : la mer, la roche, les laminaires et le ciel sont
// calculés hors du fil principal, à partir de la recette ; les tampons sont
// transférés sans copie. Les constructeurs sont des fonctions pures,
// importables depuis Node (tests, bancs d'essai).
import { buildNoiseVolume } from './noisevol.js';
import { buildScene } from './scene.js';
import { skyPixels } from './sky.js';

function build({ spec, what }, progress) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'scene': return buildScene(spec.R, { lite: spec.lite, onProgress: progress });
    case 'sky': return skyPixels(spec.R, spec.W);
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    let last = -1;
    const out = build(data, (f) => { if (f - last > 0.01 || f === 1) { last = f; self.postMessage({ id: data.id, progress: f }); } });
    const transfer = [];
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) { if (!transfer.includes(v.buffer)) transfer.push(v.buffer); } else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
