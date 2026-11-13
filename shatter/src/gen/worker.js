// Worker de génération : fracture des pièces et poussière des transitions,
// hors du fil principal ; les tampons sont transférés sans copie.
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { fracture } from './fracture.js';
import { simulate } from './sim.js';

// (une transition a besoin des fractures de ses deux pièces : petit cache local)
const cache = new Map();
function fractured(spec) {
  const k = JSON.stringify(spec);
  if (!cache.has(k)) {
    // (fracture puis simulation des éclats : la seconde dépend de la première)
    const r = fracture(spec);
    r.sim = simulate(r, spec);
    cache.set(k, r);
    while (cache.size > 6) cache.delete(cache.keys().next().value);
  }
  return cache.get(k);
}

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'piece': {
      const r = fractured(spec);
      // (copies : le cache garde ses tampons, transférer les vider)
      const mesh = Object.fromEntries(Object.entries(r.mesh).map(([k, v]) => [k, v.slice()]));
      let height = 0; for (let i = 1; i < mesh.position.length; i += 3) height = Math.max(height, mesh.position[i]);
      // début de la fonte de chaque éclat : selon l'endroit où la simulation l'a arrêté
      r.frags.forEach((F, s) => { for (let i = F.range[0]; i < F.range[1]; i++) mesh.rigC[4 * i + 3] = r.sim.tm[s]; });
      return {
        mesh, track: r.sim.track.slice(),
        info: { origin: r.origin, normal: r.normal, dir: r.dir, frags: r.frags.length, tFront: r.tFront, verts: mesh.position.length / 3, height, samples: r.sim.samples, rate: r.sim.rate, stats: r.sim.stats },
      };
    }
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
