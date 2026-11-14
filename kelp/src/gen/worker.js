// Worker de génération : la mer, la roche, les laminaires et le ciel sont
// calculés hors du fil principal, à partir de la recette ; les tampons sont
// transférés sans copie. Les constructeurs sont des fonctions pures,
// importables depuis Node (tests, bancs d'essai).
//
// Une scène : la mer (le profil fin de la caméra et les tranches du faisceau)
// et la roche ne dépendent que de la recette ; elles sont demandées en même
// temps à plusieurs workers (« part »), puis un worker assemble la scène
// (caméra, laminaires). (Pas de workers imbriqués : tous les navigateurs ne
// les ont pas.)
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { buildScene, runJob, mergeBundles, assembleScene } from './scene.js';
import { skyPixels } from './sky.js';

const transferOf = (out) => {
  const transfer = [];
  const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) { if (!transfer.includes(v.buffer)) transfer.push(v.buffer); } else if (v && typeof v === 'object') walk(v); } };
  walk(out);
  return transfer;
};

// une scène : ses pièces (mer, roche) ont été calculées en parallèle par les
// autres workers du pool et arrivent avec la demande (scene/stage.js) ; sans
// elles, tout est calculé ici, l'une après l'autre
function sceneFrom(spec, progress) {
  const { R, lite, parts } = spec;
  if (!parts) return buildScene(R, { lite, onProgress: progress });
  return assembleScene(R, { sea: parts.sea, rock: parts.rock, bundle: mergeBundles(parts.bundles), tParts: parts.ms ?? 0 }, { lite, onProgress: progress });
}

async function build({ spec, what }, progress) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'scene': return sceneFrom(spec, progress);
    case 'part': return runJob(spec, progress);
    case 'sky': return skyPixels(spec.R, spec.W);
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = async ({ data }) => {
  try {
    let last = -1;
    const out = await build(data, (f) => { if (f - last > 0.01 || f === 1) { last = f; self.postMessage({ id: data.id, progress: f }); } });
    self.postMessage({ id: data.id, out }, transferOf(out));
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
