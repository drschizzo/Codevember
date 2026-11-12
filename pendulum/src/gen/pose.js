// Disposition et cinématique des machines (module pur) : la même fonction
// pose la scène, nourrit les tests (contacts, traversées) et l'écran de
// chargement. Repère : x à droite, y vers le haut, z vers l'avant (vers la
// caméra du profil). Le plan du balancement est vu de face.
const { sin, cos, max } = Math;

// épaisseur d'un maillon dans son plan (barre plate : t ; tube, tige : w)
export const thickOf = (L) => (L.style === 'bar' ? L.t : L.w);
export const bobThick = (L) => max(thickOf(L) * 1.8, 0.016);

// plans des maillons : chacun devant le précédent (montage en chapes
// alternées, comme sur les vrais pendules multiples), écartés de leurs
// demi-épaisseurs (lentilles comprises) et d'un jeu de 6 mm. z : position du
// plan de chaque maillon ; dz : décalage vers le suivant ; z0 : longueur de
// l'axe entre le support (sa face à 5 cm) et le premier plan.
export function layoutOf(M) {
  const n = M.links.length, z = [], dz = [];
  const half = (L) => max(thickOf(L) / 2 + 0.0025, L.bob ? bobThick(L) / 2 : 0);
  let zc = 0.05 + 0.02 + half(M.links[0]); // (2 cm d'axe entre la face du support et le maillon)
  for (let i = 0; i < n; i++) {
    z.push(zc);
    if (i + 1 < n) { const d = half(M.links[i]) + half(M.links[i + 1]) + 0.006; dz.push(d); zc += d; } else dz.push(0);
  }
  // roue d'inertie : devant le dernier maillon
  const wheelZ = M.family === 'wheel' ? z[n - 1] + half(M.links[n - 1]) + 0.012 + 0.009 : null;
  // acrobate : la chaîne est centrée entre les montants du portique
  const shift = M.family === 'acrobat' ? -(z[0] + z[n - 1]) / 2 : 0;
  return { z: z.map((v) => v + shift), dz, z0: z[0] - 0.05, wheelZ, shift };
}

// Pose : pour chaque maillon, son pivot (monde) et son repère (rotation :
// angle de lacet φ autour de y — le bras du tourniquet — puis angle θ autour
// de l'axe du pivot) ; articulations (n + 1 points, monde).
export function poseOf(M, theta, s, Lay = layoutOf(M)) {
  const n = M.links.length, links = [], P = [];
  if (M.family === 'rotary') {
    const r = M.arm.r + 0.038, H = M.height; // (ARM_HEAD : devant le palier de tête)
    const er = [sin(s), 0, cos(s)], et = [cos(s), 0, -sin(s)];
    let w = 0, v = H;
    for (let i = 0; i < n; i++) {
      const rho = r + (Lay.z[i] - Lay.z[0]);
      const p = [er[0] * rho + et[0] * w, v, er[2] * rho + et[2] * w];
      links.push({ pos: p, yaw: s, angle: theta[i] });
      P.push([er[0] * r + et[0] * w, v, er[2] * r + et[2] * w]);
      w += M.links[i].l * sin(theta[i]); v -= M.links[i].l * cos(theta[i]);
    }
    P.push([er[0] * r + et[0] * w, v, er[2] * r + et[2] * w]);
    return { links, joints: P, arm: s };
  }
  let x = M.family === 'cart' ? s : 0, y = M.height;
  for (let i = 0; i < n; i++) {
    links.push({ pos: [x, y, Lay.z[i]], yaw: 0, angle: theta[i] });
    P.push([x, y, Lay.z[i]]);
    x += M.links[i].l * sin(theta[i]); y -= M.links[i].l * cos(theta[i]);
  }
  P.push([x, y, Lay.z[n - 1]]);
  return { links, joints: P };
}

// articulations seules (compatibilité)
export const joints = (M, theta, s, Lay) => poseOf(M, theta, s, Lay).joints;

// points 2D de la chaîne (écran de chargement) depuis un état du solveur,
// dans le plan du balancement : [x0, y0, x1, y1, …, s]
export function chainPoints(M, sys, x) {
  const th = new Float64Array(sys.n), td = new Float64Array(sys.n);
  sys.angles(x, th, td);
  const s = x[2 * sys.np];
  const out = [];
  let px = M.family === 'cart' ? s : M.family === 'rotary' ? M.arm.r * 0 : 0, py = M.height;
  out.push(px, py);
  for (let i = 0; i < sys.n; i++) { px += M.links[i].l * sin(th[i]); py -= M.links[i].l * cos(th[i]); out.push(px, py); }
  out.push(s);
  return out;
}
