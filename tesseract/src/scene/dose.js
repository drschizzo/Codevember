// Dosage de la lumière des pièces (voir practicals.js). Module sans
// dépendance : il se teste hors navigateur.

// luminance linéaire d'une finition (un métal ne diffuse rien : ce qu'il
// renvoie d'une lampe proche, de l'ordre de la moitié)
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lumaCache = new Map();
function lumaOf(f) {
  const key = `${f.color}|${f.metal}|${f.glass}`;
  if (!lumaCache.has(key)) {
    const c = [1, 3, 5].map((i) => lin(parseInt(f.color.slice(i, i + 2), 16) / 255));
    const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    lumaCache.set(key, f.glass ? 0.25 : f.metal ? 0.5 * L : L);
  }
  return lumaCache.get(key);
}
// puissance d'une pièce selon sa doublure : 0,25 pour un blanc, 1 vers un
// gris moyen sombre, 2,5 au plus pour un noir
export const roomGain = (cell) => Math.min(2.5, Math.max(0.22, 0.22 * lumaOf(cell.panel.inner) ** -0.7));
// lumière de vedette selon la clarté de l'objet (métaux et cristaux : telle quelle)
export const heroGain = (con) => {
  const f = con.finish.outer;
  if (con.type === 'gem' || f.glass || f.metal) return 1;
  return Math.min(1.5, Math.max(0.3, 0.45 * lumaOf(f) ** -0.55));
};
