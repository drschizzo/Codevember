// Réglages de rendu : indépendants de la graine, mémorisés dans le navigateur.
// Propres au projet (valeurs par défaut, clé de stockage) : la chaîne d'image
// qui les lit est commune (shared/render/post.js).

export const QUALITY = {
  // (mode allégé : matériaux, lumières, ombres, chaîne d'image ; voir shared/app/mobile.js)
  mobile: { label: 'Mobile', pixelRatio: 1, aa: 'fxaa', shadows: 'mobile', ao: false, ssr: false, motionBlur: 0 },
  draft: { label: 'Brouillon', pixelRatio: 1, aa: 'fxaa', shadows: 'low', ao: false, gi: false, ssr: false, motionBlur: 0 },
  standard: { label: 'Standard', pixelRatio: 1, aa: 'smaa', shadows: 'medium', ao: true, gi: false, ssr: false, motionBlur: 0 },
  high: { label: 'Haute', pixelRatio: 1.25, aa: 'traa', shadows: 'high', ao: true, gi: true, ssr: false, motionBlur: 0 },
  cinema: { label: 'Cinéma', pixelRatio: 2, aa: 'traa', shadows: 'ultra', ao: true, gi: true, ssr: false, motionBlur: 0 },
};

// (courbe ACES : les couleurs vives du papier gardent leur teinte ; pas de
//  réflexions en espace écran ni de flou de mouvement : tout est mat et lent)
export const RENDER_DEFAULTS = {
  handheld: 1, // (caméra tenue : imperfections d'opérateur, shared/scene/handheld.js ; 0 = la caméra calculée seule)
  quality: 'high',
  pixelRatio: 1.25, aa: 'traa', shadows: 'high', microDetail: 1, patina: 1, msaa: 0,
  toneMapping: 'aces', exposure: 1, contrast: 1, saturation: 1, warmth: 0, vignette: 0.25,
  bloom: true, bloomStrength: 0.08, bloomRadius: 0.5, bloomThreshold: 1.4, hiCap: 6, roughFloor: 0.08,
  ao: true, aoStrength: 1, aoRadius: 0.25,
  gi: true, giIntensity: 1, giRadius: 8, // (lumière indirecte : le papier teinte le sol et les socles)
  ssr: false, ssrIntensity: 0.6, ssrQuality: 0.5, ssrDistance: 2.5, ssrThickness: 0.05, ssrRes: 0.5, ssrBlur: 2, nestEnv: 0.45, crystalThick: 1,
  dof: true, focus: 1, focusRange: 0.6, bokeh: 2,
  motionBlur: 0, ca: 0.05, grain: 0.02,
  streaks: 0, streakLen: 4, halation: 0, dirt: 0,
  dynRes: true, maxFps: 0,
};

export const MOBILE_DEFAULTS = {
  ...RENDER_DEFAULTS,
  quality: 'mobile', lite: true, pixelRatio: 1, aa: 'fxaa', shadows: 'mobile', ao: false, ssr: false, motionBlur: 0,
  ca: 0, streaks: 0, dirt: 0, grain: 0.025, dof: false,
  dynRes: true, maxFps: 60,
};

const STORE = 'fold.render.v10'; // (changer de version quand un défaut change : les réglages mémorisés sont alors oubliés)

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
