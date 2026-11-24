// Silhouettes des figures, dessinées à la main en polygones (repère 100 × 100,
// x vers la droite, y vers le bas, sol de la figure à y = 100). Un point suivi
// de '!' est un angle vif (pointe d'oreille, museau) : le lissage le garde.
// Module pur (pas de three) : la recette, le worker et les tests le lisent.
//
// Repère de figure utilisé par le reste : a = (100 − y) / 100 le long de l'axe
// de l'ombre (0 au pied, 1 au bout), b = (x − 50) / 100 en travers.

const P = (s) => s.trim().split(/\s+/).map((t) => {
  const sharp = t.endsWith('!');
  const [x, y] = t.replace('!', '').split(',').map(Number);
  return { x, y, sharp };
});

// Renard roux assis, de profil, tourné vers la droite, la queue enroulée sur
// les pattes avant (tout reste près du pied : voir docs/concept.md, révision 1).
const renard = P(`
  34,100 78,100! 80,96 79,92! 75,93 70,94 67,91 66,84 65,76 66,68 69,61
  72,56 75,52 80,50 84,48 88,46! 85,43 81,41 78,38 77,33 77,26 75,17!
  71,25 69,26 66,17! 63,27 62,33 59,39 53,45 46,52 40,59 36,67 33,76 32,85 33,92 34,96
`);

// Lièvre variable dressé sur ses pattes arrière, de profil vers la gauche, longues oreilles
// (assez larges, ~7 % de la figure : une pièce haute doit y loger sans toucher ses voisines).
const lievre = P(`
  42,100 47,100! 49,96 52,93 56,94 60,97 64,100! 70,100 69,95 66,88 66,80
  67,72 67,64 64,56 60,49 57,44 56,40 58,32 60,22 62,12 61,4! 57,8
  54,18 52,28 51,35 49,30 48,20 46,10 44,3! 40,9 39,20 40,30 42,37
  41,40 37,41 32,42 29,44! 31,47 35,49 39,52 40,56 39,62 38,68
  39,74 37,80 35,86 36,92
`);

// Macareux de profil, tourné vers la droite : corps dressé, gros bec triangulaire.
const macareux = P(`
  40,100! 48,100 50,96 54,100 62,100! 61,95 64,88 68,78 70,68 70,58 68,50 66,45
  72,45 78,43 84,41! 79,36 73,32 67,31 64,27 60,24 54,23 49,26 46,31
  46,37 44,44 40,54 36,64 31,73! 35,76 37,82 37,90 39,96
`);

// Phoque couché, de profil, la tête relevée. Dessiné à l'horizontale (axis 'x') :
// x suit l'axe de l'ombre (du pied vers le bout), y est en travers.
const phoque = P(`
  8,52! 14,55 22,52 32,46 44,41 56,39 66,40 74,38 80,32 85,28 90,27 95,29 97,32!
  94,35 88,37 84,42 82,50 80,56 83,62! 74,63 60,64 44,64 30,63 20,61 12,63 5,65! 9,58
`);

export const SILHOUETTES = {
  renard: { label: 'renard', pts: renard, pose: 'debout' },
  lievre: { label: 'lièvre', pts: lievre, pose: 'debout' },
  macareux: { label: 'macareux', pts: macareux, pose: 'debout' },
  phoque: { label: 'phoque', pts: phoque, pose: 'couché', axis: 'x' },
};

// Lissage de Chaikin qui garde les angles vifs.
export function smooth(pts, iters = 3) {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if (a.sharp) q.push(a); // un angle vif reste, les autres sommets sont coupés
      q.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y, sharp: false });
      q.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y, sharp: false });
    }
    p = q;
  }
  return p;
}

// Polygone lissé en repère de figure (a, b).
export function figurePolygon(name, iters = 3) {
  const S = SILHOUETTES[name];
  return smooth(S.pts, iters).map((p) => (S.axis === 'x' ? [p.x / 100, (p.y - 50) / 100] : [(100 - p.y) / 100, (p.x - 50) / 100]));
}

// Point dans le polygone (règle pair-impair).
export function inPolygon(poly, a, b) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ai, bi] = poly[i], [aj, bj] = poly[j];
    if ((bi > b) !== (bj > b) && a < ((aj - ai) * (b - bi)) / (bj - bi) + ai) inside = !inside;
  }
  return inside;
}

// Masque binaire rapide : grille de la figure (pour les recherches).
export function figureMask(name, res = 512) {
  const poly = figurePolygon(name);
  const m = new Uint8Array(res * res);
  // balayage ligne par ligne (intersections triées)
  for (let j = 0; j < res; j++) {
    const a = 1 - (j + 0.5) / res;
    const xs = [];
    for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
      const [ai, bi] = poly[i], [ak, bk] = poly[k];
      if ((ai > a) !== (ak > a)) xs.push(bi + ((a - ai) * (bk - bi)) / (ak - ai));
    }
    xs.sort((u, v) => u - v);
    for (let t = 0; t + 1 < xs.length; t += 2) {
      const q0 = Math.max(0, Math.ceil((xs[t] + 0.5) * res - 0.5)), q1 = Math.min(res - 1, Math.floor((xs[t + 1] + 0.5) * res - 0.5));
      for (let q = q0; q <= q1; q++) m[j * res + q] = 1;
    }
  }
  return { res, m, at: (a, b) => { const j = Math.floor((1 - a) * res), q = Math.floor((b + 0.5) * res); return j >= 0 && q >= 0 && j < res && q < res ? m[j * res + q] : 0; } };
}
