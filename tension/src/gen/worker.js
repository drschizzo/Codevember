// Worker de génération : la simulation (forme, allure, cycle limite,
// enregistrement) et toute la géométrie sont construites hors du fil
// principal ; les tampons sont transférés sans copie. L'avancement d'un long
// calcul est posté au fil de l'eau ({ id, progress, label }).
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { prepare } from './gait.js';
import { strut, nodeBall, winch, hub, cableTube } from './build.js';

function build({ id, spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'sim': {
      const P = prepare(spec, (p, label) => self.postMessage({ id, progress: p, label }));
      // images enregistrées : un seul tableau (nf × N × 3), longueurs au repos (nf × NC)
      const N = P.T.nodes.length, NC = P.rests[0].length, nf = P.frames.length;
      const frames = new Float32Array(nf * N * 3), rests = new Float32Array(nf * NC);
      P.frames.forEach((f, k) => frames.set(f, k * N * 3));
      P.rests.forEach((r, k) => rests.set(r, k * NC));
      return { ...P, frames, rests, nf, N, NC };
    }
    case 'strut': return strut(spec);
    case 'ball': return nodeBall(spec);
    case 'winch': return winch(spec);
    case 'hub': return hub(spec);
    case 'cable': return cableTube(spec);
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
