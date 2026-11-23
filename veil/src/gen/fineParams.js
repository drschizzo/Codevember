// Réglages de l'étage fin (scene/fine.js, gen/fineRef.js) : un seul endroit,
// lu par la scène et par les tests. Itérations de Jacobi, adhérence du linge
// humide (m par itération) et sa portée, attache tangentielle, hauteur
// maximale d'un pli hors de la surface grossière, flexion, biais.
// (sans aspiration depuis que la simulation est à 81 × 81 : collée à la statue
// par l'étage fin, l'étoffe montrait la peau lisse de la forme, découpée de
// bords nets, et basculait d'une image à l'autre entre collée et libre)
export const FINE = { iters: 24, adh: 0, RA: 0.02, anchor: 0.05, maxN: 0.012, bend: 0.8, shear: 0.5 };
