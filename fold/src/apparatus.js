// Le marteau de laboratoire : géométrie d'un appareil où chaque pièce porte la
// suivante. Module pur : le plan vérifie que rien ne touche le pot, le worker
// en construit les maillages.
//
//   socle de fonte ─ colonne ─ potence ─ chape ─ axe (ressort de torsion)
//                                           └─ moyeu ─ bras ─ tête de laiton
//   colonne ─ équerre ─ électroaimant (joues, bobine, noyau) ─ face à l'armature du bras
//
// Principe : au repos, l'électroaimant retient le bras écarté par son armature ;
// on coupe le courant, le ressort de torsion lance le bras contre le pot (tête
// au contact, voir physio.hammerAngle), puis l'aimant le rappelle.
//
// Tout est exprimé dans le plan méridien (ρ, y) du coup (direction d depuis
// l'axe du pot) ; s (perpendiculaire) pour l'épaisseur.
// (proportions d'un vrai appareil d'atelier : une colonne de 6 mm, un socle
// lourd ; plus mince, il se lisait comme un jouet en fil de laiton)
export const HAMMER = { la: 0.26, armR: 0.014, coilL: 0.1, coilR: 0.042, coreR: 0.016, gap: 0.006, plate: [0.17, 0.04, 0.12], colR: 0.03 };

export function hammerLayout(H) {
  const { pivot, arm, rest } = H, K = HAMMER;
  const sr = Math.sin(rest), cr = Math.cos(rest);
  // armature (au repos) et sa normale, côté extérieur du bras
  const A = [pivot[0] + K.la * sr, pivot[1] - K.la * cr];
  const n = [cr, sr];
  const arTh = 0.016; // (demi-épaisseur armature + entrefer)
  const pole = [A[0] + n[0] * (arTh + K.gap), A[1] + n[1] * (arTh + K.gap)];
  const back = [pole[0] + n[0] * (K.coilL + 0.01), pole[1] + n[1] * (K.coilL + 0.01)];
  const colRho = Math.max(back[0] + K.coilR + 0.04, pivot[0] + 0.16);
  const top = pivot[1] + 0.05;
  return {
    A, n, pole, back, colRho, top,
    // potence : de la colonne à la chape, juste au-dessus de l'axe
    boom: [[colRho, pivot[1] + 0.035], [pivot[0], pivot[1] + 0.035]],
    // équerre de l'aimant : de l'arrière de la bobine à la colonne
    bracket: [[back[0], back[1]], [colRho, back[1]]],
    plateRho: colRho, // (socle centré sous la colonne)
  };
}

// points témoins de l'appareil fixe (ρ, y, rayon) : pour vérifier qu'il ne
// touche pas le pot
export function hammerProbes(H, tableY) {
  const L = hammerLayout(H), K = HAMMER, out = [];
  for (let y = tableY + 0.06; y <= L.top; y += 0.02) out.push([L.colRho, y, K.colR]);
  const seg = (a, b, r, n = 10) => { for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, r]); };
  seg(L.boom[0], L.boom[1], 0.018);
  seg(L.bracket[0], L.bracket[1], 0.014);
  seg(L.pole, L.back, K.coilR + 0.025);
  return out;
}
