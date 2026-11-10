// Worker de génération : la croissance du cristal, son maillage et sa fonte
// enregistrée sont calculés hors du fil principal, à partir d'une
// spécification JSON ; les tampons sont transférés sans copie. Les
// constructeurs sont des fonctions pures, importables depuis Node.
import { buildNoiseVolume } from './noisevol.js';
import { buildCrystal } from './crystal.js';
import { buildWool } from './wool.js';

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'crystal': return buildCrystal(spec);
    case 'wool': return buildWool(spec);
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    const out = build(data);
    const transfer = [];
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) transfer.push(v.buffer); else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, [...new Set(transfer)]);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
