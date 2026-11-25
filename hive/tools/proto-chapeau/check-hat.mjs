import { posesOk, tileDisc, coefficients, hatOutline, HAT_EDGES } from './hat.js';
console.log('poses à 8 cerfs-volants :', posesOk(), 'arêtes', HAT_EDGES.length, 'a:', HAT_EDGES.filter((e) => !e[1]).length);
for (const R of [12, 20, 30, 40]) {
  for (const salt of [0, 3, 7]) {
    const t = performance.now(); const T = tileDisc(R, { salt });
    console.log('R', R, 'sel', salt, T ? T.length + ' tuiles, reflets ' + T.filter((x) => x.o >= 6).length : 'ÉCHEC', (performance.now() - t).toFixed(0) + ' ms');
    if (T && salt === 0) { const c = coefficients(T); console.log('   fermeture', c.err.toExponential(1), 'connexe', c.connected); }
  }
}
// fermeture de la tuile pour a, b complexes
const P = hatOutline(0, [0.8, 0.1], [1.4, -0.3]); console.log('retour', P[13].map((v) => v.toExponential(1)));
