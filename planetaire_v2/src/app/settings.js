// Réglages de rendu : indépendants de la graine, mémorisés dans le navigateur.

export const QUALITY = {
  draft: { label: 'Brouillon', pixelRatio: 1, aa: 'fxaa', shadows: 'low', dof: false },
  standard: { label: 'Standard', pixelRatio: 1.25, aa: 'smaa', shadows: 'medium', dof: true },
  high: { label: 'Haute', pixelRatio: 1.5, aa: 'smaa', shadows: 'high', dof: true },
  cinema: { label: 'Cinéma', pixelRatio: 2, aa: 'traa', shadows: 'ultra', dof: true },
};

// ombres : carte de la lampe, cartes cubiques des astres, nombre d'astres qui en projettent
export const SHADOWS = {
  low: { key: 1024, body: 256, bodies: 1 },
  medium: { key: 2048, body: 512, bodies: 2 },
  high: { key: 2048, body: 512, bodies: 3 },
  ultra: { key: 4096, body: 1024, bodies: 4 },
};

export const RENDER_DEFAULTS = {
  quality: 'high', pixelRatio: 1.5, aa: 'smaa', shadows: 'high',
  toneMapping: 'agx', exposure: 1.0, contrast: 1.12, saturation: 1.05, warmth: 0, vignette: 0.45,
  bloom: true, bloomStrength: 0.09, bloomRadius: 0.4, bloomThreshold: 1.4, hiCap: 6,
  godrays: false, ao: false,
  dof: true, bokeh: 1.3, focusSpread: 0.55,
  motionBlur: 0, ca: 0.1, grain: 0.035,
  streaks: 0.1, streakLen: 4, halation: 0.25, dirt: 0.3,
};

const STORE = 'choregraphies.render.v1';

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
