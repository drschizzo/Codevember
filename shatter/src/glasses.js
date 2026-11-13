// Catalogue des verres (module pur : aussi chargé par les tests et la recette).
// teinte (absorption), distance d'absorption (× épaisseur de la
// paroi), indice, dispersion, irisation, chants (teinte), fluorescence
export const GLASSES = {
  cristal: { label: 'Cristal', tint: '#f4f8fb', att: 30, ior: 1.6, disp: 0.9, edge: '#9fd8bf' },
  cobalt: { label: 'Cobalt', tint: '#2f5fe0', att: 2.2, ior: 1.52, disp: 0.3, edge: '#3a80d8' },
  ambre: { label: 'Ambre', tint: '#e09a2a', att: 2.6, ior: 1.52, disp: 0.3, edge: '#c88a2a' },
  emeraude: { label: 'Émeraude', tint: '#2fbf6a', att: 2.4, ior: 1.53, disp: 0.35, edge: '#2c9f5a' },
  fume: { label: 'Fumé', tint: '#9a8a7a', att: 2.2, ior: 1.52, disp: 0.25, edge: '#7f8a6a' },
  rubis: { label: 'Rubis à l’or', tint: '#c8102e', att: 1.5, ior: 1.53, disp: 0.3, edge: '#a8102a' },
  uranium: { label: 'Uranium', tint: '#c9e84a', att: 3, ior: 1.52, disp: 0.3, edge: '#9fe060', glow: '#7dff5a' },
  dichroique: { label: 'Dichroïque', tint: '#eef0ff', att: 12, ior: 1.55, disp: 0.5, edge: '#a0c8e8', irid: 1 },
  aigue: { label: 'Aigue-marine', tint: '#8fe0e0', att: 4, ior: 1.52, disp: 0.35, edge: '#6fc8b8' },
  obsidienne: { label: 'Obsidienne', tint: '#08080a', att: 0.2, ior: 1.5, disp: 0, edge: '#2a2a30', opaque: true },
};

