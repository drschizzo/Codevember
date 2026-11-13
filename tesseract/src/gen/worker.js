// Worker de génération : construit l'ossature, les panneaux ou l'objet d'une
// cellule hors du fil principal ; les tampons sont transférés sans copie.
import { buildFrame, buildPanels, buildContent } from './cell.js';
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { envPixels } from './envmap.js';

// Format compact des sommets : normale en snorm16, tangente en snorm8,
// indices sur 16 bits quand le maillage le permet.
function pack(o) {
  if (!o) return null;
  const n = o.normal.length / 3;
  const nor = new Int16Array(n * 3), tan = new Int8Array(n * 4);
  for (let i = 0; i < n * 3; i++) nor[i] = Math.round(Math.max(-1, Math.min(1, o.normal[i])) * 32767);
  for (let i = 0; i < n * 4; i++) tan[i] = Math.round(Math.max(-1, Math.min(1, o.tangent[i])) * 127);
  return { ...o, normal: nor, tangent: tan, index: n < 65536 ? Uint16Array.from(o.index) : o.index };
}

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'env': return { data: envPixels(spec.key, spec.warmth, spec.W) };
    case 'frame': return pack(buildFrame(spec));
    case 'panels': { const { panel, glass } = buildPanels(spec.cell, spec.frame); return { panel: pack(panel), glass: pack(glass) }; }
    case 'content': return pack(buildContent(spec));
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
