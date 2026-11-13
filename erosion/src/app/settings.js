// Réglages de rendu : indépendants de la graine, mémorisés dans le navigateur.

export const QUALITY = {
  // (mode allégé : matériaux, lumières, ombres, chaîne d'image ; voir app/mobile.js)
  mobile: { label: 'Mobile', pixelRatio: 1.25, aa: 'fxaa', shadows: 'mobile', ao: false, ssr: false, motionBlur: 0 },
  draft: { label: 'Brouillon', pixelRatio: 1, aa: 'fxaa', shadows: 'low', ao: false, ssr: false, motionBlur: 0 },
  standard: { label: 'Standard', pixelRatio: 1.25, aa: 'smaa', shadows: 'medium', ao: false, ssr: true, ssrRes: 0.5, ssrQuality: 0.35, motionBlur: 0.5 },
  high: { label: 'Haute', pixelRatio: 1.5, aa: 'traa', shadows: 'high', ao: false, ssr: true, ssrRes: 0.5, ssrQuality: 0.5, motionBlur: 0.6 },
  cinema: { label: 'Cinéma', pixelRatio: 2, aa: 'traa', shadows: 'ultra', ao: false, ssr: true, ssrRes: 1, ssrQuality: 0.8, motionBlur: 0.8 },
};

export const RENDER_DEFAULTS = {
  quality: 'high',
  pixelRatio: 1.5, aa: 'traa', shadows: 'high', microDetail: 1, patina: 1,
  toneMapping: 'agx', exposure: 1.0, contrast: 1.08, saturation: 1.05, warmth: 0, vignette: 0.45,
  bloom: true, bloomStrength: 0.06, bloomRadius: 0.4, bloomThreshold: 1.6, hiCap: 4, roughFloor: 0.08,
  ao: false, aoStrength: 0.9, aoRadius: 0.4, // (l'occlusion du relief est calculée sur la carte de hauteur : voir scene/gpusim.js)
  ssr: true, ssrIntensity: 0.7, ssrQuality: 0.5, ssrDistance: 1.2, ssrThickness: 0.006, ssrRes: 0.5, ssrBlur: 2, nestEnv: 0.45, crystalThick: 1,
  dof: true, focus: 1, focusRange: 0.8, bokeh: 1.6,
  motionBlur: 0.6, ca: 0.06, grain: 0.03,
  streaks: 0.02, streakLen: 4, halation: 0.2, dirt: 0.12,
  dynRes: true, maxFps: 0, // (résolution dynamique — la fluidité d'abord —, cadence plafonnée : voir app/mobile.js)
};

// Réglages du mode mobile : mêmes réglages artistiques, chaîne d'image allégée.
// Résolution de base 1,25 × CSS (et non le ×3 d'un téléphone), ajustée ensuite
// par la résolution dynamique (dynRes : de 50 à 100 % de cette base) ; cadence
// plafonnée à maxFps. Sans réflexions en espace écran, l'objet exposé voit un
// peu plus du studio (nestEnv) : ses reflets ne s'éteignent pas dans une
// cellule fermée.
export const MOBILE_DEFAULTS = {
  ...RENDER_DEFAULTS,
  quality: 'mobile', lite: true, pixelRatio: 1.25, aa: 'fxaa', shadows: 'mobile', ao: false, ssr: false, motionBlur: 0,
  nestEnv: 0.6, ca: 0, streaks: 0, dirt: 0, grain: 0.025, dof: false,
  dynRes: true, maxFps: 60,
};

const STORE = 'erosion.render.v6'; // (v6 : résolution dynamique par défaut)

// (le mode mobile a ses propres réglages mémorisés)
export const defaultsFor = (lite) => (lite ? MOBILE_DEFAULTS : RENDER_DEFAULTS);
export function loadRender(lite = false) {
  const D = defaultsFor(lite);
  try {
    const s = JSON.parse(localStorage.getItem(lite ? `${STORE}.mobile` : STORE) || 'null');
    if (s && typeof s === 'object') return { ...D, ...s, lite };
  } catch { /* stockage indisponible */ }
  return { ...D, lite };
}
export function saveRender(r) {
  try { localStorage.setItem(r.lite ? `${STORE}.mobile` : STORE, JSON.stringify(r)); } catch { /* stockage indisponible */ }
}
export function applyQuality(r, key) {
  const q = QUALITY[key];
  if (!q) return;
  r.quality = key;
  for (const [k, v] of Object.entries(q)) if (k !== 'label') r[k] = v;
}
