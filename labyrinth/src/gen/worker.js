// Worker de génération : le labyrinthe, son film (simulation de la bille,
// recherche des rotations) et tous les maillages de l'appareil sont calculés
// hors du fil principal, à partir d'une spécification JSON ; les tampons sont
// transférés sans copie. Les constructeurs sont des fonctions pures,
// importables depuis Node (tests, bancs d'essai).
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { buildMaze } from './maze.js';
import { planScene } from './plan.js';
import { buildApparatus } from './build.js';
import { envPixels } from '../../../shared/gen/envmap.js';

function buildScene(spec, progress) {
  progress(0.02);
  const { maze, film, attempt } = planScene(spec, (f) => progress(0.05 + f * 0.8), buildMaze);
  progress(0.88);
  const A = buildApparatus(maze, spec.family, spec.style);
  progress(1);
  // (le labyrinthe sans ses tableaux de liens : les parois, les cellules, le chemin)
  const { links, ...lite } = maze;
  return { maze: lite, film, attempt, layout: A.layout, meshes: A.meshes };
}

function build({ spec, what }, progress) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'scene': return buildScene(spec, progress);
    case 'env': return { data: envPixels(spec.preset, 0, spec.W) };
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    const out = build(data, (f) => self.postMessage({ id: data.id, progress: f }));
    const transfer = [];
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) { if (!transfer.includes(v.buffer)) transfer.push(v.buffer); } else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
