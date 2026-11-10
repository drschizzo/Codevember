// Familles du cristal et jeux de paramètres du modèle de croissance.
// Module pur (sans three) : chargé par la recette, les workers et les tests.
//
// Une famille accomplit le geste (pousser, puis fondre) à sa façon :
//   étoile  : les pointes se ramifient ; à la fonte, des perles naissent aux
//             pointes et remontent les bras en les avalant ;
//   plaque  : des faces planes avancent ensemble ; à la fonte, un bourrelet
//             d'eau fait le tour de la plaque et se resserre comme un collier ;
//   colonne : un prisme qui s'allonge par ses deux bouts creux ; à la fonte, un
//             cylindre d'eau qui se rompt en chapelet (Plateau-Rayleigh).
//
// Les jeux de paramètres (ρ densité de vapeur, β seuil d'attachement des
// pointes, α et θ attachement des faces, κ part gelée directement, μ et γ
// fonte) viennent de Gravner et Griffeath (2008) ou ont été trouvés par
// balayage (tools/sweep.mjs). `then` : un second jeu, pris quand le cristal
// atteint la part `at` de son rayon (les conditions changent pendant la chute :
// c'est ce qui donne les étoiles à centre en plaque, ou les bouts en plaques).

const STELLAR = { rho: 0.635, beta: 1.6, alpha: 0.4, theta: 0.025, kappa: 0.0025, mu: 0.015, gamma: 0.0005 };
const FERN = { rho: 0.65, beta: 1.75, alpha: 0.2, theta: 0.026, kappa: 0.15, mu: 0.015, gamma: 0.0001 };
const COMB = { rho: 0.4, beta: 1.3, alpha: 0.08, theta: 0.025, kappa: 0.003, mu: 0.07, gamma: 0.00005 };
const LADDER = { rho: 0.42, beta: 1.2, alpha: 0.3, theta: 0.06, kappa: 0.001, mu: 0.1, gamma: 0.0005 };
const TIPPED = { rho: 0.38, beta: 1.06, alpha: 0.35, theta: 0.112, kappa: 0.001, mu: 0.14, gamma: 0.0006 };
const HEX = { rho: 0.35, beta: 1.4, alpha: 0.001, theta: 0.0745, kappa: 0.005, mu: 0.12, gamma: 0.0001 };
const SECTOR = { rho: 0.45, beta: 1.6, alpha: 0.05, theta: 0.1, kappa: 0.002, mu: 0.05, gamma: 0.0001 };
const BROAD = { rho: 0.8, beta: 2.6, alpha: 0.004, theta: 0.001, kappa: 0.05, mu: 0.015, gamma: 0.0001 };

export const FAMILIES = {
  star: {
    label: 'Étoile',
    forms: {
      dendrite: { label: 'dendrite stellaire', growth: STELLAR },
      fern: { label: 'fougère', growth: FERN },
      comb: { label: 'en peigne', growth: COMB },
      ladder: { label: 'en échelle', growth: LADDER },
      platecenter: { label: 'à centre en plaque', growth: HEX, then: { at: 0.3, growth: STELLAR } },
      tipped: { label: 'à bouts en plaques', growth: TIPPED },
    },
    thick: 0.032, // épaisseur des bras (mm)
    size: [2.4, 3.6], // diamètre (mm)
  },
  plate: {
    label: 'Plaque',
    forms: {
      hex: { label: 'plaque hexagonale', growth: HEX },
      sector: { label: 'plaque à secteurs', growth: SECTOR },
      broad: { label: 'à larges branches', growth: BROAD },
      ringed: { label: 'plaque à anneau', growth: SECTOR, then: { at: 0.55, growth: HEX } },
      starplate: { label: 'plaque étoilée', growth: HEX, then: { at: 0.5, growth: BROAD } },
    },
    thick: 0.026,
    size: [1.6, 2.6],
  },
  column: {
    label: 'Colonne',
    forms: {
      hollow: { label: 'colonne creuse', column: { aspect: 7, hollow: 0.45 } },
      needle: { label: 'aiguille', column: { aspect: 15, hollow: 0.3 } },
      sheath: { label: 'gaine', column: { aspect: 10, hollow: 0.6 } },
    },
    thick: 0.2,
    size: [1.6, 2.6], // longueur (mm)
  },
};

export const FAMILY_KEYS = Object.keys(FAMILIES);
