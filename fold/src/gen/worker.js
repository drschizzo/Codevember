// Worker de génération. Deux pièces :
// - 'sheet' : le film d'une feuille (src/sim/fold.js). Le patron est maillé,
//   plié par le solveur sur une bascule entière, puis développé en positions
//   et normales par image ;
// - 'tour' : le film d'une tour d'unités bistables (src/sim/tower.js), l'état
//   (h, θ) de chaque unité image par image ; la pose en découle à l'affichage.
import { pleatedU, bake, renderMesh } from '../sim/fold.js';
import { towerFilm } from '../sim/tower.js';

self.onmessage = ({ data }) => {
  const { id, spec, what } = data;
  try {
    let last = 0;
    const onStep = (u) => { if (u - last > 0.02) { last = u; self.postMessage({ id, progress: u }); } };
    if (what === 'tour') {
      const F = towerFilm(spec.tower, onStep);
      self.postMessage({ id, out: F }, [F.th.buffer, F.h.buffer]);
      return;
    }
    if (what !== 'sheet') throw new Error(`inconnu : ${what}`);
    const S = pleatedU(spec.sheet);
    const B = bake(S, { ...spec.film, onStep });
    const M = renderMesh(S, B);
    self.postMessage({ id, out: { ...M, strain: B.strain, gap: B.gap } }, [M.pos.buffer, M.nor.buffer, M.near.buffer, M.index.buffer, M.rest.buffer, M.crease.buffer]);
  } catch (e) {
    self.postMessage({ id, error: e.message });
  }
};
