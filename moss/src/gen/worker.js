// Worker de génération : le coussin (tiges, feuilles, sporophytes),
// l'hydraulique d'une période entière et les gabarits instanciés sont
// construits hors du fil principal, à partir d'une spécification JSON ; les
// tampons sont transférés sans copie. Les constructeurs sont des fonctions
// pures, importables depuis Node (tests, bancs d'essai).
import { buildNoiseVolume } from './noisevol.js';
import { buildMoss, bakeRock } from './build.js';

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'moss': return buildMoss(spec);
    case 'rock': return bakeRock(spec.type, spec.seed, spec.X, spec.M);
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    const out = build(data);
    const transfer = [];
    const seen = new Set();
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) { if (!seen.has(v.buffer)) { seen.add(v.buffer); transfer.push(v.buffer); } } else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
