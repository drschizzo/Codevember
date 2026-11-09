// Réglages de rendu : indépendants de la graine, mémorisés dans le navigateur.

export const QUALITY = {
  // (mode allégé : matériaux, ombres, poussière, chaîne d'image ; voir app/mobile.js)
  mobile: { label: 'Mobile', pixelRatio: 1.25, aa: 'fxaa', shadows: 'mobile', ao: false, godrays: true, motionBlur: 0, detail: 0.6 },
  draft: { label: 'Brouillon', pixelRatio: 1, aa: 'fxaa', shadows: 'low', ao: false, godrays: false, motionBlur: 0, detail: 0.7 },
  standard: { label: 'Standard', pixelRatio: 1.25, aa: 'smaa', shadows: 'medium', ao: true, godrays: true, motionBlur: 0.5, detail: 1 },
  high: { label: 'Haute', pixelRatio: 1.5, aa: 'traa', shadows: 'high', ao: true, godrays: true, motionBlur: 0.6, detail: 1.15 },
  cinema: { label: 'Cinéma', pixelRatio: 2, aa: 'traa', shadows: 'ultra', ao: true, godrays: true, motionBlur: 0.8, detail: 1.5 },
};

export const RENDER_DEFAULTS = {
  quality: 'high',
  pixelRatio: 1.5, aa: 'traa', shadows: 'high', detail: 1.15, microDetail: 1,
  toneMapping: 'agx', exposure: 1.15, contrast: 1.06, saturation: 1.05, warmth: 0, vignette: 0.4,
  bloom: true, bloomStrength: 0.08, bloomRadius: 0.4, bloomThreshold: 1.4, hiCap: 3, roughFloor: 0.12,
  godrays: true, godraysIntensity: 0.55, godraysDensity: 0.35, godraysMax: 0.45,
  ao: true, aoStrength: 0.85, aoRadius: 0.35,
  dof: false, focus: 0.85, focusRange: 0.5, bokeh: 2.5,
  motionBlur: 0.6, ca: 0.12, grain: 0.035, envFalloff: 0.3,
  streaks: 0.12, streakLen: 4, halation: 0.35, dirt: 0.5,
  dynRes: false, maxFps: 0, // (résolution dynamique, cadence plafonnée : voir app/mobile.js)
};

// Réglages du mode mobile : mêmes réglages artistiques, chaîne d'image allégée.
// Résolution de base 1,25 × CSS (et non le ×3 d'un téléphone), ajustée ensuite
// par la résolution dynamique (dynRes : de 50 à 100 % de cette base) ; cadence
// plafonnée à maxFps.
export const MOBILE_DEFAULTS = {
  ...RENDER_DEFAULTS,
  quality: 'mobile', lite: true, pixelRatio: 1.25, aa: 'fxaa', shadows: 'mobile', ao: false, godrays: true, motionBlur: 0, detail: 0.6,
  godraysIntensity: 0.65, // (rayons en quart de résolution : un peu plus présents)
  ca: 0, streaks: 0, dirt: 0, grain: 0.03, dof: false,
  dynRes: true, maxFps: 60,
};

const STORE = 'hollow.render.v4';
// réglages dont la valeur par défaut a changé : une valeur mémorisée avant
// cette révision est oubliée (rev : révision des réglages mémorisés)
const REV = 2, RESET = { 2: ['streaks', 'streakLen'] };

// (le mode mobile a ses propres réglages mémorisés)
export const defaultsFor = (lite) => (lite ? MOBILE_DEFAULTS : RENDER_DEFAULTS);
export function loadRender(lite = false) {
  const D = defaultsFor(lite);
  try {
    const s = JSON.parse(localStorage.getItem(lite ? `${STORE}.mobile` : STORE) || 'null');
    if (s && typeof s === 'object') {
      for (let r = (s.rev || 1) + 1; r <= REV; r++) for (const k of RESET[r] || []) delete s[k];
      return { ...D, ...s, lite, rev: REV };
    }
  } catch { /* stockage indisponible */ }
  return { ...D, lite, rev: REV };
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
