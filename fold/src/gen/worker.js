// Worker de génération : le film d'une feuille (src/sim/fold.js). Le patron est
// maillé, plié par le solveur sur une bascule entière, puis développé en
// positions et normales par image.
import { pleatedU, bake, renderMesh } from '../sim/fold.js';

self.onmessage = ({ data }) => {
  const { id, spec, what } = data;
  try {
    if (what !== 'sheet') throw new Error(`inconnu : ${what}`);
    const S = pleatedU(spec.sheet);
    let last = 0;
    const B = bake(S, { ...spec.film, onStep: (u) => { if (u - last > 0.02) { last = u; self.postMessage({ id, progress: u }); } } });
    const M = renderMesh(S, B);
    self.postMessage({ id, out: { ...M, strain: B.strain, gap: B.gap } }, [M.pos.buffer, M.nor.buffer, M.near.buffer, M.index.buffer, M.rest.buffer, M.crease.buffer]);
  } catch (e) {
    self.postMessage({ id, error: e.message });
  }
};
