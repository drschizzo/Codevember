// Réglages de rendu : indépendants de la graine, mémorisés dans le navigateur.

export const QUALITY = {
  draft: { label: 'Brouillon', pixelRatio: 1, aa: 'fxaa', shadows: 'low', ao: false, ssr: false, motionBlur: 0, backdrop: true },
  standard: { label: 'Standard', pixelRatio: 1.25, aa: 'smaa', shadows: 'medium', ao: true, ssr: false, motionBlur: 0.5, backdrop: true },
  high: { label: 'Haute', pixelRatio: 1.5, aa: 'traa', shadows: 'high', ao: true, ssr: true, ssrRes: 0.5, ssrQuality: 0.5, motionBlur: 0.6, backdrop: true },
  cinema: { label: 'Cinéma', pixelRatio: 2, aa: 'traa', shadows: 'ultra', ao: true, ssr: true, ssrRes: 1, ssrQuality: 0.8, motionBlur: 0.8, backdrop: true },
};

export const RENDER_DEFAULTS = {
  quality: 'high',
  pixelRatio: 1.5, aa: 'traa', shadows: 'high', microDetail: 1,
  backdrop: true, backdropBlur: 1, depthBlur: true, grazing: 1, sssBoost: 1, armEnv: 0.6,
  toneMapping: 'agx', exposure: 1.1, contrast: 1.08, saturation: 1.05, warmth: 0, vignette: 0.5,
  bloom: true, bloomStrength: 0.09, bloomRadius: 0.5, bloomThreshold: 1.2, hiCap: 5, roughFloor: 0.05,
  ao: true, aoStrength: 0.8, aoRadius: 0.3,
  ssr: true, ssrIntensity: 0.8, ssrQuality: 0.5, ssrDistance: 1.5, ssrThickness: 0.03, ssrRes: 0.5, ssrBlur: 2,
  dof: false, focus: 1, focusRange: 0.5, bokeh: 2,
  motionBlur: 0.6, ca: 0.12, grain: 0.03,
  streaks: 0.1, streakLen: 4, halation: 0.3, dirt: 0.3,
};

const STORE = 'membrane.render.v1';

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
