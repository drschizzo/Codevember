// Machine de référence des chaînes triples (bibliothèque de départs,
// tools/library.mjs) : trois barres d'aluminium de 30, 28 et 26 cm.
const bar = (l) => ({ l, w: 0.03, t: 0.008, metal: 'alu', fill: 0.65, style: 'bar', bob: null });
export const REF3 = { family: 'cart', links: [bar(0.3), bar(0.28), bar(0.26)], rail: { half: 0.85 } };
