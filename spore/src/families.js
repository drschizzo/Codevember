// Le catalogue (module pur) : quatre familles de myxomycètes, chacune avec son
// geste de dissémination, et leurs espèces. Unités : centimètres.
//
// Mesures d'après les flores (Stephenson & Stempen, *Myxomycetes*, 1994 ;
// Poulain, Meyer & Bozonnet, *Les Myxomycètes*, 2011) et les photographies de
// référence de docs/concept.md :
// - Arcyria denudata : sporanges de 2 à 4 mm, en grappes serrées, rouge
//   brique ; capillitium élastique qui se détend 2 à 3 fois ;
// - Stemonitis fusca : colonnes de 6 à 15 mm, 0,4 mm de large, en touffes,
//   pied noir brillant du tiers de la hauteur ;
// - Hemitrichia serpula : plasmodiocarpe en réseau de tubes de 0,4 mm, doré ;
// - Lamproderma : sphères de 0,6 à 1 mm sur des pieds de 1 mm, iridescentes.
//
// Chaque espèce : forme (tête, pied), couleurs (jeune, mi-maturité, mûre,
// filet), plasmodium, mode de fructification (« cluster » : grappes autour
// des nœuds du réseau ; « tuft » : touffes ; « vein » : perles le long des
// veines ; « net » : le réseau lui-même), espacement des perles.

export const FAMILIES = {
  arcyria: {
    label: 'Arcyria', gesture: 'le filet se détend',
    motion: 'à l’ouverture, le haut du péridium tombe et le filet comprimé se détend vers le haut, avec un rebond, puis ondule au vent',
    species: {
      denudata: {
        spore: 8, label: 'Arcyria denudata', mode: 'cluster', count: [120, 220], spacing: 0.085,
        head: { r: 0.038, h: 0.15 }, stalk: { h: 0.07, r: 0.011 }, cup: 0.42, expand: 2.6, droop: 0.06,
        colors: { young: '#f4ece6', mid: '#e05a6a', ripe: '#8e2a25', net: '#c96b5f', stalk: '#5a1d17', hypo: '#6b3a2c' },
        plasmodium: '#f3b8a0', vein: 0.02,
      },
      obvelata: {
        spore: 8, label: 'Arcyria obvelata', mode: 'cluster', count: [90, 170], spacing: 0.09,
        head: { r: 0.035, h: 0.17 }, stalk: { h: 0.05, r: 0.01 }, cup: 0.3, expand: 3.0, droop: 0.18,
        colors: { young: '#fbf6dc', mid: '#f6dc6a', ripe: '#c9a23a', net: '#e7c766', stalk: '#8a6a2a', hypo: '#7a6236' },
        plasmodium: '#f4d05a', vein: 0.02,
      },
      cinerea: {
        spore: 7, label: 'Arcyria cinerea', mode: 'cluster', count: [80, 150], spacing: 0.08,
        head: { r: 0.03, h: 0.11 }, stalk: { h: 0.09, r: 0.009 }, cup: 0.4, expand: 2.2, droop: 0.1,
        colors: { young: '#f5f3ef', mid: '#d9d2c8', ripe: '#9c958c', net: '#b9b2a8', stalk: '#4a4540', hypo: '#5a544c' },
        plasmodium: '#f1d58e', vein: 0.019,
      },
    },
  },
  stemonitis: {
    label: 'Stemonitis', gesture: 'les colonnes fument',
    motion: 'les hautes colonnes plient sous le souffle comme des joncs et fument : la masse de spores part par le haut et laisse une cage claire autour de la columelle',
    species: {
      fusca: {
        spore: 8, label: 'Stemonitis fusca', mode: 'tuft', count: [60, 120], spacing: 0.055,
        head: { r: 0.022, h: 0.62 }, stalk: { h: 0.3, r: 0.008 }, expand: 1.15,
        colors: { young: '#f3eee8', mid: '#9a5a63', ripe: '#4a2a1c', net: '#8c6a52', stalk: '#141010', hypo: '#2a201a' },
        plasmodium: '#f3dc84', vein: 0.024,
      },
      axifera: {
        spore: 7, label: 'Stemonitis axifera', mode: 'tuft', count: [50, 100], spacing: 0.06,
        head: { r: 0.024, h: 0.5 }, stalk: { h: 0.22, r: 0.008 }, expand: 1.2,
        colors: { young: '#f6efe6', mid: '#c46a3a', ripe: '#7a3d1d', net: '#b47648', stalk: '#1a120e', hypo: '#3a2618' },
        plasmodium: '#f5d36a', vein: 0.024,
      },
      comatricha: {
        spore: 9, label: 'Comatricha nigra', mode: 'vein', count: [50, 90], spacing: 0.16,
        head: { r: 0.03, h: 0.075 }, stalk: { h: 0.34, r: 0.006 }, expand: 1.1,
        colors: { young: '#f2efe9', mid: '#6a4a52', ripe: '#1d1614', net: '#4a3a30', stalk: '#0d0a09', hypo: '#1e1814' },
        plasmodium: '#f2d47a', vein: 0.02,
      },
    },
  },
  hemitrichia: {
    label: 'Hemitrichia', gesture: 'le réseau devient fruit',
    motion: 'pas de pieds : les veines maîtresses gonflent en tubes dorés, les petites se vident en elles ; mûrs, les tubes se fendent en long et moussent d’élatères',
    species: {
      serpula: {
        spore: 11, label: 'Hemitrichia serpula', mode: 'net', count: [0, 0], spacing: 0,
        tube: 0.022, expand: 2.2,
        colors: { young: '#fff3c4', mid: '#f3c437', ripe: '#c98d1c', net: '#f0b83a', stalk: '#7a5a1a', hypo: '#6a5020' },
        plasmodium: '#f7d43a', vein: 0.024, // (tubes de 0,5 mm ; plus épais, le filet se fermait en sangles)
      },
      vesparia: {
        spore: 11, label: 'Hemitrichia serpula (rouille)', mode: 'net', count: [0, 0], spacing: 0,
        tube: 0.019, expand: 1.9,
        colors: { young: '#ffe9c9', mid: '#e09a3a', ripe: '#a8551c', net: '#d4782e', stalk: '#6a3a1a', hypo: '#5a3a20' },
        plasmodium: '#f4c13a', vein: 0.022,
      },
    },
  },
  lamproderma: {
    label: 'Lamproderma', gesture: 'le péridium s’écaille',
    motion: 'de petites sphères sur des pieds fins : mûres, elles s’irisent, puis le péridium se fend en plaquettes qui tombent, et la sphère sombre s’effrite au vent',
    species: {
      columbinum: {
        spore: 13, label: 'Lamproderma columbinum', mode: 'vein', count: [60, 110], spacing: 0.15,
        head: { r: 0.048, h: 0.096 }, stalk: { h: 0.12, r: 0.0045 }, film: [380, 520],
        colors: { young: '#f1f1ee', mid: '#7a7fa0', ripe: '#26232e', net: '#2a2630', stalk: '#0f0d0f', hypo: '#1a181c' },
        plasmodium: '#efd585', vein: 0.02,
      },
      diachea: {
        spore: 9, label: 'Diachea leucopodia', mode: 'vein', count: [70, 130], spacing: 0.12,
        head: { r: 0.036, h: 0.09 }, stalk: { h: 0.09, r: 0.009 }, film: [300, 420], whiteStalk: true,
        colors: { young: '#f3f2ee', mid: '#8a8aa6', ripe: '#2a2836', net: '#302c38', stalk: '#e9e6dc', hypo: '#cfc8b8' },
        plasmodium: '#f2d77c', vein: 0.02,
      },
      arcyrioides: {
        spore: 12, label: 'Lamproderma arcyrioides', mode: 'cluster', count: [70, 120], spacing: 0.12,
        head: { r: 0.04, h: 0.08 }, stalk: { h: 0.1, r: 0.0045 }, film: [480, 640],
        colors: { young: '#f0f0ee', mid: '#8a8f90', ripe: '#2c3030', net: '#2a2c2c', stalk: '#121212', hypo: '#1c1c1c' },
        plasmodium: '#f0d683', vein: 0.02,
      },
    },
  },
  trichia: {
    label: 'Trichia', gesture: 'la tête éclate en houppe dorée',
    motion: 'des toupies dorées et luisantes ; mûres, le péridium se fend en plaques qui tombent et les élatères comprimés jaillissent en une houppe ronde, deux fois plus large, que le vent peigne',
    species: {
      decipiens: {
        spore: 9, label: 'Trichia decipiens', mode: 'cluster', count: [60, 110], spacing: 0.11,
        head: { r: 0.042, h: 0.1 }, stalk: { h: 0.07, r: 0.01 }, expand: 1.9,
        colors: { young: '#f6efe0', mid: '#cf9d3e', ripe: '#8d7428', net: '#e7b43a', stalk: '#5e4220', hypo: '#4a3420' },
        plasmodium: '#f2cf62', vein: 0.022,
      },
      varia: {
        spore: 10, label: 'Trichia varia', mode: 'vein', count: [60, 110], spacing: 0.13,
        head: { r: 0.038, h: 0.076 }, stalk: { h: 0.014, r: 0.012 }, expand: 1.7,
        colors: { young: '#fbf3dc', mid: '#efc246', ripe: '#c99a24', net: '#f2c13c', stalk: '#8a6a22', hypo: '#6a5020' },
        plasmodium: '#f4d873', vein: 0.02,
      },
    },
  },
  lycogala: {
    label: 'Lycogala', gesture: 'le coussin se perce et souffle',
    motion: 'des coussins sans pied, corail puis gris rosé, verruqueux ; mûrs, leur sommet se perce et chaque rafale aspire par l’ouverture une bouffée de spores (effet Venturi) ; le coussin se dégonfle',
    species: {
      epidendrum: {
        spore: 6, label: 'Lycogala epidendrum', mode: 'cluster', count: [12, 26], spacing: 0.42,
        head: { r: 0.17, h: 0.24 }, stalk: { h: 0, r: 0 },
        colors: { young: '#f6b3a6', mid: '#e07b6a', ripe: '#a6857a', net: '#d6a898', stalk: '#a6857a', hypo: '#6a5048' },
        plasmodium: '#f08a7c', vein: 0.024,
      },
      flavofuscum: {
        spore: 6, label: 'Lycogala flavofuscum', mode: 'cluster', count: [6, 12], spacing: 0.62,
        head: { r: 0.27, h: 0.36 }, stalk: { h: 0, r: 0 },
        colors: { young: '#f3e2c4', mid: '#dab27a', ripe: '#9a7650', net: '#c9a070', stalk: '#9a7650', hypo: '#5c4430' },
        plasmodium: '#f2dca4', vein: 0.024,
      },
    },
  },
};

export const FAMILY_KEYS = Object.keys(FAMILIES);

export function speciesOf(R) {
  return FAMILIES[R.family].species[R.species];
}
