// Worker de génération : le récipient (géométrie tournée), l'éclair (modèle de
// claquage diélectrique) et le volume de bruit sont calculés hors du fil
// principal, à partir d'une spécification JSON ; les tampons sont transférés
// sans copie. Les constructeurs sont des fonctions pures, importables depuis
// Node (tests, bancs d'essai).
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { buildVessel } from './vessels.js';
import { buildBolt, tessellate } from './dbm.js';
import { simulatePlume } from './plume.js';

// l'éclair prêt à dessiner : segments, et ce que la scène doit savoir de chaque canal
export function boltFor(spec, rough = 0.13) {
  const b = buildBolt(spec);
  const seg = tessellate(b, { sub: 3, rough, seed: 1 + (b.n % 97) });
  const at = (S, f) => { const i = S.path[Math.min(S.path.length - 1, Math.floor(f * (S.path.length - 1)))]; return [b.pos[i * 3], b.pos[i * 3 + 1], b.pos[i * 3 + 2]]; };
  const up = spec.family === 'upward';
  const strokes = b.strokes.map((S) => ({
    target: up ? at(S, 0) : S.target, length: S.length,
    low: at(S, up ? 0.3 : 0.3), high: at(S, up ? 0.9 : 0.92), // (où placer la lumière de l'arc, et sa lueur dans le nuage)
  }));
  // les nœuds de l'arbre, pour l'écran de chargement et les tests
  return { seg, strokes, nodes: b.n, sites: b.sites, family: spec.family, tree: { pos: b.pos, parent: b.parent, tb: b.tb, mask: b.mask } };
}

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'vessel': { const v = buildVessel(spec); return { parts: v.parts, meta: v.meta }; }
    case 'bolt': return boltFor(spec.spec, spec.rough);
    case 'plume': return simulatePlume(spec);
    default: throw new Error(`inconnu : ${what}`);
  }
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
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
}
