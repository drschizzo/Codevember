// Catalogue des sols (module pur : la recette, le panneau et les tests le lisent ;
// le matériau est dans scene/floor.js). kind : planks (lames), tiles / slabs
// (dalles), brick (panneresse), speckle (semis) ; W : largeur d'une rangée (u) ;
// Lj : longueur visée d'un élément le long de la marche (ramenée à un nombre
// entier par pas) ; c1, c2 : teintes ; c3 : joints ; rough, relief.
export const FLOORS = {
  oak: { label: 'Parquet de chêne', kind: 'planks', W: 1.15, Lj: 8.5, c1: '#b89870', c2: '#8a6a48', c3: '#3a2a1c', rough: 0.55, relief: 1 },
  slate: { label: 'Ardoise adoucie', kind: 'tiles', W: 4.2, Lj: 4.2, c1: '#26282c', c2: '#33363b', c3: '#121316', rough: 0.74, relief: 1 },
  concrete: { label: 'Béton ciré', kind: 'slabs', W: 9, Lj: 9, c1: '#a49d92', c2: '#8a847a', c3: '#5c5850', rough: 0.7, relief: 0.6 },
  lino: { label: 'Linoléum moucheté', kind: 'speckle', W: 1, Lj: 1, c1: '#7f8689', c2: '#c9ced0', c3: '#3a3f42', rough: 0.58, relief: 0.3 },
  brick: { label: 'Briques sur chant', kind: 'brick', W: 1.05, Lj: 2.25, c1: '#8a4a35', c2: '#6c3627', c3: '#6b6359', rough: 0.86, relief: 1.2 },
  stage: { label: 'Plancher de scène', kind: 'planks', W: 0.85, Lj: 12, c1: '#1d1b1a', c2: '#2a2622', c3: '#0b0a09', rough: 0.72, relief: 0.8, worn: 1 },
  wet: { label: 'Dalle mouillée', kind: 'slabs', W: 7, Lj: 7, c1: '#4a4d4f', c2: '#3a3c3e', c3: '#242628', rough: 0.55, relief: 0.6, wet: 1 },
};

// fréquences le long de s qui tombent juste sur la période P (en cellules du
// volume de bruit, période 4 cellules) : f souhaitées en cellules par unité
export function floorFreqs(P, fs = [0.35, 1.6, 7, 28]) {
  return fs.map((f) => (4 * Math.max(1, Math.round((P * f) / 4))) / P);
}
// nombre entier de joints par période
export const jointSpacing = (P, L) => P / Math.max(1, Math.round(P / L));

