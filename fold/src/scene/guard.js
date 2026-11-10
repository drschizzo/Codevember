// Où la caméra n'a pas le droit d'aller : dans la cloche, la caisse, le pot,
// sous la table, hors de la pièce. Module pur (scène et tests).
export function cameraGuard(S) {
  const R = S.bell ? S.bell.R + 0.12 : S.case ? Math.hypot(S.case.W, S.case.D) + 0.1 : S.rimR + 0.1;
  const top = S.bell ? S.bell.top + 0.2 : S.case ? S.case.eave + S.case.W * 0.7 : S.rimY + 0.05;
  return (p) => p[1] > S.tableY + 0.12 && !(S.inside && S.inside(p[0], p[1], p[2])) && Math.hypot(p[0], p[2]) < 10.5 && !(Math.hypot(p[0], p[2]) < R && p[1] < top);
}
