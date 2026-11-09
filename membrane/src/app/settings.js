// Réglages de rendu : indépendants de la graine, mémorisés dans le navigateur.

export const QUALITY = {
  // (mode allégé : membranes, simulation, ombres, chaîne d'image ; voir app/mobile.js)
  mobile: { label: 'Mobile', pixelRatio: 1.25, aa: 'fxaa', shadows: 'mobile', ao: false, ssr: false, motionBlur: 0, backdrop: true, depthBlur: false, detail: false },
  draft: { label: 'Brouillon', pixelRatio: 1, aa: 'fxaa', shadows: 'low', ao: false, ssr: false, motionBlur: 0, backdrop: true, depthBlur: false, detail: false },
  standard: { label: 'Standard', pixelRatio: 1.25, aa: 'smaa', shadows: 'medium', ao: true, ssr: false, motionBlur: 0.5, backdrop: true, detail: true },
  high: { label: 'Haute', pixelRatio: 1.5, aa: 'traa', shadows: 'high', ao: true, ssr: true, ssrRes: 0.5, ssrQuality: 0.5, motionBlur: 0.6, backdrop: true, detail: true },
  cinema: { label: 'Cinéma', pixelRatio: 2, aa: 'traa', shadows: 'ultra', ao: true, ssr: true, ssrRes: 1, ssrQuality: 0.8, motionBlur: 0.8, backdrop: true, detail: true },
};

export const RENDER_DEFAULTS = {
  quality: 'high',
  pixelRatio: 1.5, aa: 'traa', shadows: 'high', microDetail: 1,
  detail: true, backdrop: true, backdropBlur: 1, depthBlur: true, grazing: 1, sssBoost: 1, armEnv: 0.6,
  toneMapping: 'agx', exposure: 1.1, contrast: 1.08, saturation: 1.05, warmth: 0, vignette: 0.5,
  bloom: true, bloomStrength: 0.09, bloomRadius: 0.5, bloomThreshold: 1.2, hiCap: 5, roughFloor: 0.05,
  ao: true, aoStrength: 0.8, aoRadius: 0.3,
  ssr: true, ssrIntensity: 0.8, ssrQuality: 0.5, ssrDistance: 1.5, ssrThickness: 0.03, ssrRes: 0.5, ssrBlur: 2,
  dof: false, focus: 1, focusRange: 0.5, bokeh: 2,
  motionBlur: 0.6, ca: 0.12, grain: 0.03,
  streaks: 0.1, streakLen: 4, halation: 0.3, dirt: 0.3,
  dynRes: false, maxFps: 0, // (résolution dynamique, cadence plafonnée : voir app/mobile.js)
};

// Réglages du mode mobile : mêmes réglages artistiques, chaîne d'image allégée.
// Résolution de base 1,25 × CSS (et non le ×3 d'un téléphone), ajustée ensuite
// par la résolution dynamique (dynRes : de 50 à 100 % de cette base) ; cadence
// plafonnée à maxFps. Pas de reflets en espace écran (les membranes humides
// gardent le reflet du studio), pas de flou selon la profondeur au travers des
// membranes (une copie de la profondeur par membrane), maillage grossier.
export const MOBILE_DEFAULTS = {
  ...RENDER_DEFAULTS,
  quality: 'mobile', lite: true, pixelRatio: 1.25, aa: 'fxaa', shadows: 'mobile', ao: false, ssr: false, motionBlur: 0,
  backdrop: true, depthBlur: false, detail: false,
  ca: 0, streaks: 0, dirt: 0, grain: 0.025, dof: false,
  dynRes: true, maxFps: 60,
};

const STORE = 'membrane.render.v1';

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
