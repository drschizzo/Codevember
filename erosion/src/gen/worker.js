// Worker de génération : toute la géométrie (et toute simulation lourde) est
// construite hors du fil principal, à partir d'une spécification JSON ; les
// tampons sont transférés sans copie. Les constructeurs sont des fonctions
// pures, importables depuis Node (tests, bancs d'essai).
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { Buffers, roundedBox, gem, torus, OUT, EDGE } from '../../../shared/gen/mesh.js';

// (À REMPLACER : un constructeur par nature de pièce du thème)
function buildPiece({ kind, size, round }) {
  const B = new Buffers();
  if (kind === 'hero') {
    roundedBox(B, [0, 0, 0], [size, size, size], round * size * 2, 10, EDGE, OUT);
    torus(B, [0, 0, 0], size * 1.45, size * 0.05, 96, 16, EDGE);
  } else {
    gem(B, [0, 0, 0], size, OUT);
  }
  return B.out();
}

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'piece': return buildPiece(spec);
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    const out = build(data);
    const transfer = [];
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) transfer.push(v.buffer); else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
