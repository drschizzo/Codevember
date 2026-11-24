// Réglages de rendu : indépendants de la graine, mémorisés dans le navigateur.
// Propres au projet (valeurs par défaut, clé de stockage) : la chaîne d'image
// qui les lit est commune (shared/render/post.js).

export const QUALITY = {
  // (mode allégé : matériaux, lumières, ombres, chaîne d'image ; voir shared/app/mobile.js)
  mobile: { label: 'Mobile', pixelRatio: 1, aa: 'fxaa', shadows: 'mobile', ao: false, ssr: false, motionBlur: 0 },
  draft: { label: 'Brouillon', pixelRatio: 1, aa: 'fxaa', shadows: 'low', ao: false, ssr: false, motionBlur: 0 },
  standard: { label: 'Standard', pixelRatio: 1, aa: 'smaa', shadows: 'medium', ao: true, ssr: false, motionBlur: 0 },
  high: { label: 'Haute', pixelRatio: 1.25, aa: 'traa', shadows: 'high', ao: true, ssr: true, ssrRes: 0.5, ssrQuality: 0.5, motionBlur: 0 },
  cinema: { label: 'Cinéma', pixelRatio: 2, aa: 'traa', shadows: 'ultra', ao: true, ssr: true, ssrRes: 1, ssrQuality: 0.8, motionBlur: 0 },
};

// (courbe ACES : la cire chaude et la résistance de la lampe gardent leur teinte ;
//  flou de mouvement coupé : la cire n'écrit pas ses vitesses)
export const RENDER_DEFAULTS = {
  handheld: 1, // (caméra tenue : imperfections d'opérateur, shared/scene/handheld.js ; 0 = la caméra calculée seule)
  quality: 'high',
  pixelRatio: 1.25, aa: 'traa', shadows: 'high', microDetail: 1, patina: 1, msaa: 0,
  toneMapping: 'aces', exposure: 1, contrast: 1.05, saturation: 1, warmth: 0, vignette: 0.4,
  bloom: true, bloomStrength: 0.12, bloomRadius: 0.5, bloomThreshold: 1.3, hiCap: 6, roughFloor: 0.08,
  ao: true, aoStrength: 0.9, aoRadius: 0.4,
  ssr: true, ssrIntensity: 0.6, ssrQuality: 0.5, ssrDistance: 2.5, ssrThickness: 0.05, ssrRes: 0.5, ssrBlur: 2, nestEnv: 0.45, crystalThick: 1,
  dof: true, focus: 1, focusRange: 0.3, bokeh: 3,
  motionBlur: 0, ca: 0.08, grain: 0.03,
  streaks: 0.06, streakLen: 4, halation: 0.25, dirt: 0.2,
  dynRes: true, maxFps: 0,
};

export const MOBILE_DEFAULTS = {
  ...RENDER_DEFAULTS,
  quality: 'mobile', lite: true, pixelRatio: 1, aa: 'fxaa', shadows: 'mobile', ao: false, ssr: false, motionBlur: 0,
  ca: 0, streaks: 0, dirt: 0, grain: 0.025, dof: false,
  dynRes: true, maxFps: 60,
};

const STORE = 'melt.render.v5'; // (changer de version quand un défaut change : les réglages mémorisés sont alors oubliés)

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
