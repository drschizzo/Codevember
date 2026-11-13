// Matières de l'appareil (catalogue pur, sans three : la recette et les tests
// le lisent). F0 mesurés pour les métaux (sRGB), albédos plausibles ailleurs.
export const MATERIALS = {
  brass:       { color: '#e8cf8e', metal: 1, rough: 0.24 },
  nickel:      { color: '#d4cdc0', metal: 1, rough: 0.18 },
  steel:       { color: '#c6c7c9', metal: 1, rough: 0.3 },
  blueSteel:   { color: '#28303d', metal: 1, rough: 0.32, cc: 0.4 },
  blackIron:   { color: '#1d1c1b', metal: 0.4, rough: 0.55 },
  blackWire:   { color: '#161616', metal: 0.7, rough: 0.38 },
  greenEnamel: { color: '#1f4236', metal: 0, rough: 0.35, cc: 1 },
  walnut:      { color: '#5b3b25', color2: '#311c10', metal: 0, rough: 0.48, cc: 0.35, wood: 1 },
  boxwood:     { color: '#cfae74', color2: '#a7824d', metal: 0, rough: 0.5, cc: 0.25, wood: 1 },
  ebony:       { color: '#1c1613', color2: '#0b0807', metal: 0, rough: 0.35, cc: 0.6, wood: 1 },
  porcelain:   { color: '#f2eee6', metal: 0, rough: 0.25, cc: 1 },
  agate:       { color: '#b8946e', metal: 0, rough: 0.12, cc: 1 },
};
