// Worker de génération de Melt : les figurines (gen/shape.js), en données
// pures ; le reste se calcule à chaque image (cycle.js, sim/mpm.js). Les
// tampons sont transférés sans copie.
import { shapeData } from './shape.js';

function build({ spec, what }) {
  switch (what) {
    case 'shape': return shapeData(spec.key, spec.salt, spec.C);
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
