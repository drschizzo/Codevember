// Réglages de rendu : indépendants de la graine, mémorisés dans le navigateur.

export const QUALITY = {
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
};

const STORE = 'hollow.render.v4';

export function loadRender() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s && typeof s === 'object') return { ...RENDER_DEFAULTS, ...s };
  } catch { /* stockage indisponible */ }
  return { ...RENDER_DEFAULTS };
}
export function saveRender(r) {
  try { localStorage.setItem(STORE, JSON.stringify(r)); } catch { /* stockage indisponible */ }
}
export function applyQuality(r, key) {
  const q = QUALITY[key];
  if (!q) return;
  r.quality = key;
  for (const [k, v] of Object.entries(q)) if (k !== 'label') r[k] = v;
}
