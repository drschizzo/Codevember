// Le film d'une feuille, calculé hors du fil principal.
import { pleatedU, bake, renderMesh } from './sim.mjs';
self.onmessage = ({ data }) => {
  const S = pleatedU(data.sheet);
  let last = 0;
  const B = bake(S, { ...data.film, onStep: (u) => { if (u - last > 0.02) { last = u; self.postMessage({ progress: u }); } } });
  const M = renderMesh(S, B);
  self.postMessage({ done: true, w: S.w, strain: B.strain, ...M }, [M.pos.buffer, M.nor.buffer, M.near.buffer, M.index.buffer, M.rest.buffer, M.crease.buffer]);
};
