// Réglages de rendu : indépendants de la graine, mémorisés dans le navigateur.

export const QUALITY = {
  mobile: { label: 'Mobile', pixelRatio: 1.25, aa: 'fxaa', shadows: 'mobile', dof: false },
  draft: { label: 'Brouillon', pixelRatio: 1, aa: 'fxaa', shadows: 'low', dof: false },
  standard: { label: 'Standard', pixelRatio: 1.25, aa: 'smaa', shadows: 'medium', dof: true },
  high: { label: 'Haute', pixelRatio: 1.5, aa: 'smaa', shadows: 'high', dof: true },
  cinema: { label: 'Cinéma', pixelRatio: 2, aa: 'traa', shadows: 'ultra', dof: true },
};

// ombres : carte de la lampe, cartes cubiques des astres, nombre d'astres qui en projettent
export const SHADOWS = {
  mobile: { key: 1024, body: 256, bodies: 0 },
  low: { key: 1024, body: 256, bodies: 1 },
  medium: { key: 2048, body: 512, bodies: 2 },
  high: { key: 2048, body: 512, bodies: 3 },
  ultra: { key: 4096, body: 1024, bodies: 4 },
};

export const RENDER_DEFAULTS = {
  quality: 'high', pixelRatio: 1.5, aa: 'smaa', shadows: 'high',
  toneMapping: 'agx', exposure: 1.2, contrast: 1.08, saturation: 1.05, warmth: 0, vignette: 0.45,
  bloom: true, bloomStrength: 0.09, bloomRadius: 0.4, bloomThreshold: 1.4, hiCap: 6,
  godrays: false, ao: false,
  dof: true, bokeh: 1.3, focusSpread: 0.55,
  motionBlur: 0, ca: 0.1, grain: 0.035,
  streaks: 0.1, streakLen: 4, halation: 0.25, dirt: 0.3,
  dynRes: false, maxFps: 0, // (résolution dynamique, cadence plafonnée : voir app/mobile.js)
};

// Mode mobile : mêmes réglages artistiques, chaîne d'image allégée ; base
// 1,25 × CSS ajustée par la résolution dynamique (de 50 à 100 %), 60 i/s au plus
export const MOBILE_DEFAULTS = {
  ...RENDER_DEFAULTS,
  quality: 'mobile', lite: true, pixelRatio: 1.25, aa: 'fxaa', shadows: 'mobile', dof: false,
  ca: 0, streaks: 0, dirt: 0, grain: 0.03,
  dynRes: true, maxFps: 60,
};
export const defaultsFor = (lite) => (lite ? MOBILE_DEFAULTS : RENDER_DEFAULTS);

const STORE = 'choregraphies.render.v2';

// (le mode mobile a ses propres réglages mémorisés)
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
