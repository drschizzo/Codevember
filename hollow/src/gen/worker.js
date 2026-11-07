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

// Format compact des sommets (28 octets au lieu de 44) : normale (et normale de tranche) en snorm16,
// tangente en snorm8, indices sur 16 bits quand le maillage le permet.
function pack(o) {
  const n = o.normal.length / 3;
  const nor = new Int16Array(n * 3), tan = new Int8Array(n * 4);
  for (let i = 0; i < n * 3; i++) nor[i] = Math.round(Math.max(-1, Math.min(1, o.normal[i])) * 32767);
  for (let i = 0; i < n * 4; i++) tan[i] = Math.round(Math.max(-1, Math.min(1, o.tangent[i])) * 127);
  const index = n < 65536 ? Uint16Array.from(o.index) : o.index;
  const out = { ...o, normal: nor, tangent: tan, index };
  if (o.bev) { // (normale de tranche et angle du profil : snorm16)
    out.bev = new Int16Array(n * 4);
    for (let i = 0; i < n * 4; i++) out.bev[i] = Math.round(Math.max(-1, Math.min(1, o.bev[i])) * 32767);
  }
  return out;
}

function build({ spec, lod, what }) {
  if (what === 'noise') return buildNoiseVolume(spec.seed);
  if (what === 'crystals') return placeCrystals(prepare(spec), spec, createRng(`${spec.seed}:crystals`));
  if (spec.type === 'tpms') return pack(buildTPMS(spec, lod));
  return pack(buildShell(prepare(spec), spec, lod));
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
