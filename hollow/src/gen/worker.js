// Worker de génération : construit la géométrie d'une couche (un niveau de
// détail) ou ses cristaux, hors du fil principal ; les tampons sont
// transférés sans copie.
import { createRng, createNoise3 } from '../rng.js';
import { goldbergCells, slotCells, voronoiCells } from './cells.js';
import { prepareCells, buildShell } from './shell.js';
import { buildTPMS } from './tpms.js';
import { placeCrystals } from './crystals.js';
import { buildNoiseVolume } from './noisevol.js';

function prepare(spec) {
  const rng = createRng(spec.seed), noise = createNoise3(spec.seed);
  const cells = spec.type === 'slots' ? slotCells(spec) : spec.type === 'voronoi' ? voronoiCells(spec, rng) : goldbergCells(spec, rng);
  return prepareCells(cells, spec, noise, rng);
}

function build({ spec, lod, what }) {
  if (what === 'noise') return buildNoiseVolume(spec.seed);
  if (what === 'crystals') return placeCrystals(prepare(spec), spec, createRng(`${spec.seed}:crystals`));
  if (spec.type === 'tpms') return buildTPMS(spec, lod);
  return buildShell(prepare(spec), spec, lod);
}

self.onmessage = ({ data }) => {
  const t0 = performance.now();
  try {
    const out = build(data);
    const transfer = Object.values(out).filter((v) => ArrayBuffer.isView(v)).map((v) => v.buffer);
    self.postMessage({ id: data.id, out, ms: performance.now() - t0 }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
