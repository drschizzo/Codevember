// Worker de génération : l'arbre des orteils, les listes de candidats par
// texel, les tables de refroidissement et de corps noir, le ciel. Tout part
// d'une spécification JSON ; les tampons sont transférés sans copie. Les
// constructeurs sont des fonctions pures, importables depuis Node.
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { growTree, bakeLists, bakeBlur } from './toes.js';
import { solveCooling } from './cooling.js';
import { emissionLUT } from './planck.js';
import { skyPixels } from './sky.js';

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'tree': { // l'arbre seul (les listes se cuisent ensuite par bandes, en parallèle)
      const t = growTree(spec);
      return { T: t.T, n: t.n, F: t.F };
    }
    case 'lists': { // une bande de lignes des listes de candidats
      const L = bakeLists({ T: spec.T, n: spec.n, F: spec.F }, spec.res, spec.h, spec.F, spec.rows);
      return { lists: L.lists, rows: L.rows, overflow: L.overflow };
    }
    case 'blur': { const b = bakeBlur({ T: spec.T, n: spec.n, F: spec.F }, spec.res); return { B: b.B, res: b.res }; }
    case 'thermal': { // refroidissement (Keszthelyi) et corps noir (Planck)
      const c = solveCooling(spec.cooling);
      const n = c.n, cool = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) cool.set([c.surf[i], c.crust[i], c.deep[0][i], c.deep[1][i]], i * 4);
      return { cool, n, ageMax: c.ageMax, emit: emissionLUT(256, 700, 1500, 0.95) };
    }
    case 'sky': return { pixels: skyPixels(spec.sky, spec.W) };
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
