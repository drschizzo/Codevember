// Montures : pots, cloche, caisse de Ward. Module pur : les profils servent à
// la géométrie (worker), au contact du marteau, aux éclaboussures et aux tests.
//
// Repère de la plante : terre du pot en y = 0, axe du pot en x = z = 0.
// Profils de révolution : listes [ρ, y] de bas en haut (paroi extérieure),
// la lèvre comprise.

export const CONTAINERS = {
  terracotta: { label: 'Pot de terre et soucoupe', drop: ['burette'], tapOn: 'pot' },
  cachepot: { label: 'Cache-pot de porcelaine', drop: ['burette'], tapOn: 'pot' },
  bonsai: { label: 'Coupe à bonsaï en céladon', drop: ['burette'], tapOn: 'pot' },
  cloche: { label: 'Cloche de verre sur socle', drop: ['roof'], tapOn: 'base' },
  ward: { label: 'Caisse de Ward', drop: ['roof'], tapOn: 'base' },
};

// géométrie d'une monture pour une plante de hauteur H (au-dessus de la terre)
// et d'étalement E (rayon de la touffe)
// coins adoucis (découpe de Chaikin) : chaque arête du profil devient un
// petit congé ; les extrémités sont gardées
export function chaikin(P, n = 2) {
  let pts = P;
  for (let k = 0; k < n; k++) {
    const out = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

export function containerShape(kind, H = 2.4, E = 1.4) {
  const S = { kind };
  if (kind === 'bonsai') {
    // coupe basse et large, pieds
    S.rimY = 0.07; S.rimR = 1.05; S.soilR = 0.98;
    // (coupe ronde à lèvre retournée, filet sous la lèvre)
    S.outer = chaikin([[0.86, -0.3], [0.92, -0.3], [0.99, -0.25], [1.02, -0.12], [1.03, -0.03], [1.045, -0.025], [1.045, -0.005], [1.035, 0.0], [1.07, 0.035], [1.075, 0.06], [1.06, 0.07]]);
    S.feet = { n: 4, r: 0.85, h: 0.07 };
    S.tableY = -0.37; S.potBottom = -0.3;
  } else if (kind === 'cachepot') {
    // cache-pot droit à pied et lèvre ourlée
    S.rimY = 0.12; S.rimR = 0.7; S.soilR = 0.6;
    // (pied annulaire, panse, moulure d'épaule à deux filets, lèvre ourlée)
    S.outer = chaikin([[0.5, -0.95], [0.57, -0.95], [0.59, -0.92], [0.59, -0.87], [0.55, -0.84], [0.56, -0.8], [0.64, -0.62], [0.69, -0.4], [0.705, -0.2], [0.7, -0.12], [0.715, -0.11], [0.715, -0.085], [0.705, -0.075], [0.715, -0.06], [0.715, -0.04], [0.7, -0.03], [0.705, 0.04], [0.73, 0.09], [0.745, 0.11], [0.73, 0.125], [0.715, 0.12]]);
    S.tableY = -0.95; S.potBottom = -0.95;
  } else {
    // pot de terre à lèvre roulée (aussi sous la cloche et dans la caisse)
    S.rimY = 0.1; S.rimR = 0.64; S.soilR = 0.56;
    // pot de terre « à rebord » : pied chanfreiné, corps conique, bague
    // moulurée, gradin, bandeau légèrement bombé, lèvre roulée
    S.outer = chaikin([[0.44, -0.9], [0.465, -0.9], [0.475, -0.885], [0.47, -0.87], [0.5, -0.66], [0.515, -0.555], [0.525, -0.545], [0.525, -0.525], [0.515, -0.515], [0.59, -0.12], [0.595, -0.095], [0.645, -0.088], [0.655, -0.07], [0.664, 0.0], [0.668, 0.05], [0.662, 0.085], [0.648, 0.1]]);
    S.saucer = kind === 'terracotta' ? { r: 0.7, h: 0.08 } : null;
    S.potBottom = -0.9;
    S.tableY = -0.9 - (S.saucer ? S.saucer.h : 0);
  }
  if (kind === 'cloche') {
    // socle tourné, puis cloche : cylindre, épaule, dôme, bouton
    S.plinth = { r: 1.3, h: 0.22 };
    S.tableY = S.potBottom - S.plinth.h;
    // profil du socle tourné : talon, doucine, filet, baguette, plateau (coins adoucis)
    { const R0 = S.plinth.r, h = S.plinth.h, y0 = S.tableY;
      S.plinth.profile = chaikin([[R0 - 0.05, y0], [R0 - 0.01, y0], [R0, y0 + 0.012], [R0, y0 + h * 0.22], [R0 - 0.012, y0 + h * 0.28],
        [R0 - 0.03, y0 + h * 0.36], [R0 - 0.022, y0 + h * 0.5], [R0 - 0.008, y0 + h * 0.58], [R0 - 0.008, y0 + h * 0.66], [R0 - 0.022, y0 + h * 0.7],
        [R0 - 0.024, y0 + h * 0.78], [R0 - 0.012, y0 + h * 0.84], [R0 - 0.012, y0 + h * 0.93], [R0 - 0.03, y0 + h], [R0 - 0.06, y0 + h]], 2); }
    const R = Math.max(1.12, E + 0.12), top = H + 0.4;
    S.bell = { R, y0: S.potBottom, top, dome: R * 0.95 };
    // dessous du dôme : y(ρ) (sphère tronquée)
    const yc = top - S.bell.dome;
    S.roofY = (x, z) => { const r2 = x * x + z * z; return r2 < S.bell.dome ** 2 ? yc + Math.sqrt(S.bell.dome ** 2 - r2) - 0.012 : -Infinity; };
    S.inside = (x, y, z) => Math.hypot(x, z) < R - 0.05 && y < yc + Math.sqrt(Math.max(0, S.bell.dome ** 2 - x * x - z * z));
  }
  if (kind === 'ward') {
    // caisse : socle, vitres à petits bois, toit à deux pans (faîte selon z)
    const W = Math.max(1.3, E + 0.25), Dp = Math.max(1.0, E * 0.8 + 0.2), eave = H + 0.75;
    S.case = { W, D: Dp, base: 0.3, y0: S.potBottom, eave, pitch: 32 * Math.PI / 180 };
    S.tableY = S.potBottom - 0.3;
    S.roofY = (x, z) => (Math.abs(x) < W && Math.abs(z) < Dp ? eave + (W - Math.abs(x)) * Math.tan(S.case.pitch) - 0.015 : -Infinity);
    S.inside = (x, y, z) => Math.abs(x) < W && Math.abs(z) < Dp && y < eave + (W - Math.abs(x)) * Math.tan(S.case.pitch);
  }
  return S;
}

// rayon extérieur du pot à la hauteur y (interpolation du profil)
export function outerRadius(S, y) {
  const P = S.outer;
  if (y <= P[0][1]) return P[0][0];
  for (let i = 0; i + 1 < P.length; i++) {
    const [r0, y0] = P[i], [r1, y1] = P[i + 1];
    if (y >= y0 && y <= y1) return y1 > y0 ? r0 + ((r1 - r0) * (y - y0)) / (y1 - y0) : Math.max(r0, r1);
  }
  return P[P.length - 1][0];
}

// distance d'un point (ρ, y) du plan méridien au profil extérieur (polyligne)
export function profileDistance(P, rho, y) {
  let best = Infinity;
  for (let i = 0; i + 1 < P.length; i++) {
    const [ax, ay] = P[i], [bx, by] = P[i + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((rho - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(rho - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

// profil frappé par le marteau : la paroi du pot, ou le socle (cloche, caisse)
export function tapProfile(S) {
  if (S.plinth) return S.plinth.profile;
  if (S.case) { const y0 = S.tableY, y1 = y0 + S.case.base; return [[S.case.D, y0], [S.case.D, y1]]; }
  return S.outer;
}

// barreaux de la caisse de Ward : segments [a, b, rayon] (montants, traverses,
// petits bois, chevrons, faîtage) — la géométrie (gen/build.js) et le plan
// (obstacles pour la vue, la goutte, les éclaboussures) les lisent ici
export function caseBars(S) {
  if (!S.case) return [];
  const { W, D: Dp, eave, pitch } = S.case, y0 = S.tableY + S.case.base + 0.03, r = 0.022;
  const ridgeY = eave + W * Math.tan(pitch), out = [];
  const bar = (a, b, rr = r) => out.push([a, b, rr]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar([sx * W, y0, sz * Dp], [sx * W, eave, sz * Dp], r * 1.3);
  for (const sz of [-1, 1]) {
    bar([-W, eave, sz * Dp], [W, eave, sz * Dp]);
    bar([-W, y0 + 0.02, sz * Dp], [W, y0 + 0.02, sz * Dp]);
    bar([-W, eave, sz * Dp], [0, ridgeY, sz * Dp]); bar([W, eave, sz * Dp], [0, ridgeY, sz * Dp]);
    bar([0, y0, sz * Dp], [0, eave, sz * Dp], r * 0.6); // (un meneau au milieu des grands côtés)
  }
  for (const sx of [-1, 1]) {
    bar([sx * W, eave, -Dp], [sx * W, eave, Dp]);
    bar([sx * W, y0 + 0.02, -Dp], [sx * W, y0 + 0.02, Dp]);
    bar([sx * W, eave, 0], [0, ridgeY, 0], r * 0.6); // (un chevron au milieu de chaque pan)
  }
  bar([0, ridgeY, -Dp - 0.04], [0, ridgeY, Dp + 0.04], r * 1.2);
  return out;
}

// ── Décor en relief du pot de terre ─────────────────────────────────────────
// déplacement radial (u) au point (azimut φ, hauteur y) de la paroi externe :
// godrons (côtes verticales arrondies) sur le bas du corps, un filet sous le
// bandeau, irrégularité du tournage (le pot n'est pas un tour
// parfait), cartouche du potier. Le contact du marteau est calculé sur ce
// relief, à son azimut (voir outerAt).
const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function potRelief(S) {
  if (S.kind === 'cachepot') {
    // porcelaine : panse en côtes de melon (douze lobes), filets de l'épaule
    return (phi, y) => 0.016 * sst(-0.82, -0.7, y) * (1 - sst(-0.24, -0.14, y)) * (Math.pow(Math.abs(Math.cos(6 * phi)), 0.5) - 0.6) + 0.0012 * Math.sin(2 * phi + 1.1);
  }
  if (S.kind === 'bonsai') {
    // céladon : une cordelette torse sous la lèvre, deux filets sur la panse
    return (phi, y) => 0.006 * Math.exp(-(((y + 0.025) / 0.012) ** 2)) * (0.5 + 0.5 * Math.sin(40 * phi + y * 300)) + 0.004 * Math.exp(-(((y + 0.16) / 0.006) ** 2)) + 0.004 * Math.exp(-(((y + 0.2) / 0.006) ** 2));
  }
  if (S.kind !== 'terracotta' && S.kind !== 'cloche' && S.kind !== 'ward') return null;
  return (phi, y) => {
    let d = 0;
    // godrons : 22 côtes, entre la bague et le pied
    const g = sst(-0.86, -0.8, y) * (1 - sst(-0.6, -0.54, y));
    d += 0.011 * g * Math.pow(Math.abs(Math.cos(11 * phi)), 0.6);
    // (pas de guirlande de festons : à cette taille, elle se lisait comme un
    // glaçage de pâtissier ; un simple filet en relief sous le bandeau)
    d += 0.004 * Math.exp(-(((y + 0.15) / 0.007) ** 2));
    // tournage à la main : ovalisation et ondes lentes (quelques dixièmes de mm)
    d += 0.0035 * Math.sin(2 * phi + 0.7) + 0.0018 * Math.sin(5 * phi + 3 * y);
    return d;
  };
}
// profil extérieur réel à l'azimut φ (avec le relief)
export function outerAt(S, phi) {
  const f = potRelief(S);
  if (!f) return S.outer;
  return S.outer.map(([r, y]) => [r + f(phi, y), y]);
}

// rayon occupé au ras de la table (soucoupe, socle, caisse, pied du pot) : les
// socles des appareils restent au-delà
export function floorRadius(S) {
  if (S.case) return Math.hypot(S.case.W, S.case.D) + 0.08;
  if (S.plinth) return S.plinth.r;
  if (S.saucer) return S.saucer.r;
  let r = 0;
  for (const [rr, y] of S.outer) if (y < S.potBottom + 0.12) r = Math.max(r, rr);
  if (S.feet) r = Math.max(r, S.feet.r + 0.07);
  return r;
}
