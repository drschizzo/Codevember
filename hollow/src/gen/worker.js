// Worker de génération : construit la géométrie d'une couche (un niveau de
// détail) ou ses cristaux, hors du fil principal ; les tampons sont
// transférés sans copie.
import { createRng, createNoise3 } from '../rng.js';
import { goldbergCells, slotCells, voronoiCells } from './cells.js';
import { girihCells } from './girih.js';
import { prepareCells, buildShell, crest } from './shell.js';
import { buildTPMS } from './tpms.js';
import { placeCrystals } from './crystals.js';
import { junctions, placeGems, placeSpines } from './jewels.js';
import { buildNoiseVolume } from './noisevol.js';

// Pavages percés (gen/shell.js) : la forme des cellules
const TILINGS = {
  cells: (spec, rng) => goldbergCells(spec, rng),
  voronoi: (spec, rng) => voronoiCells(spec, rng),
  slots: (spec) => slotCells(spec),
  girih: (spec, rng) => girihCells(goldbergCells(spec, rng), spec),
};
// Constructeurs à maillage propre : (spec, lod) → maillage
const MESHES = {
  tpms: buildTPMS,
};

function prepare(spec) {
  const rng = createRng(spec.seed), noise = createNoise3(spec.seed);
  return prepareCells(TILINGS[spec.type](spec, rng), spec, noise, rng);
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

// Ornements d'un pavage percé : { crystals, gems, spines } (matrices d'instance)
function ornaments(spec) {
  const prepared = prepare(spec), out = {};
  if (spec.crystals > 0) out.crystals = placeCrystals(prepared, spec, createRng(`${spec.seed}:crystals`));
  const J = (spec.rivets || 0) > 0 || spec.spines > 0 ? junctions(prepared, spec) : null;
  if (spec.setting === 'gem' && spec.rivets > 0) out.gems = placeGems(J, spec, crest(spec), createRng(`${spec.seed}:gems`));
  if (spec.spines > 0) out.spines = placeSpines(J, spec, crest(spec), createRng(`${spec.seed}:spines`));
  return out;
}

function build({ spec, lod, what }) {
  if (what === 'noise') return buildNoiseVolume(spec.seed);
  if (what === 'ornaments') return ornaments(spec);
  if (MESHES[spec.type]) return pack(MESHES[spec.type](spec, lod));
  return pack(buildShell(prepare(spec), spec, lod));
}

self.onmessage = ({ data }) => {
  const t0 = performance.now();
  try {
    const out = build(data);
    // (tampons transférés sans copie, y compris un niveau plus bas : ornements)
    const transfer = [];
    const walk = (o) => { for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) transfer.push(v.buffer); else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out, ms: performance.now() - t0 }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
