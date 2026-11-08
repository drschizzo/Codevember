// Réglages de rendu : indépendants de la graine, mémorisés dans le navigateur.

export const QUALITY = {
  draft: { label: 'Brouillon', pixelRatio: 1, aa: 'fxaa', shadows: 'low', ao: false, ssr: false, motionBlur: 0 },
  standard: { label: 'Standard', pixelRatio: 1.25, aa: 'smaa', shadows: 'medium', ao: true, ssr: true, ssrRes: 0.5, ssrQuality: 0.35, motionBlur: 0.5 },
  high: { label: 'Haute', pixelRatio: 1.5, aa: 'traa', shadows: 'high', ao: true, ssr: true, ssrRes: 0.5, ssrQuality: 0.5, motionBlur: 0.6 },
  cinema: { label: 'Cinéma', pixelRatio: 2, aa: 'traa', shadows: 'ultra', ao: true, ssr: true, ssrRes: 1, ssrQuality: 0.8, motionBlur: 0.8 },
};

export const RENDER_DEFAULTS = {
  quality: 'high',
  captions: false, analogy: false, // aides affichées à la demande (touches L et A)
  pixelRatio: 1.5, aa: 'traa', shadows: 'high', microDetail: 1,
  toneMapping: 'agx', exposure: 1.1, contrast: 1.08, saturation: 1.05, warmth: 0, vignette: 0.45,
  bloom: true, bloomStrength: 0.06, bloomRadius: 0.4, bloomThreshold: 1.6, hiCap: 4, roughFloor: 0.08,
  ao: true, aoStrength: 0.9, aoRadius: 0.4,
  ssr: true, ssrIntensity: 1, ssrQuality: 0.5, ssrDistance: 2.5, ssrThickness: 0.05, ssrRes: 0.5, ssrBlur: 2, nestEnv: 0.45, crystalThick: 1,
  dof: false, focus: 1, focusRange: 0.35, bokeh: 2,
  motionBlur: 0.6, ca: 0.1, grain: 0.03,
  streaks: 0.08, streakLen: 4, halation: 0.25, dirt: 0.3,
};

const STORE = 'tesseract.render.v1';

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
