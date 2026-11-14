// Réglages de rendu : indépendants de la graine, mémorisés dans le navigateur.
// Propres au projet (valeurs par défaut, clé de stockage) : la chaîne d'image
// qui les lit est commune (shared/render/post.js).

// La scène est un lancer de rayons (scene/tracer.js) : ni ombres portées, ni
// occlusion ambiante, ni réflexions en espace écran, ni anticrénelage temporel
// (pas de vitesses) ; la qualité est la résolution (pixelRatio).
export const QUALITY = {
  mobile: { label: 'Mobile', pixelRatio: 0.75, aa: 'fxaa' },
  draft: { label: 'Brouillon', pixelRatio: 0.75, aa: 'fxaa' },
  standard: { label: 'Standard', pixelRatio: 1, aa: 'fxaa' },
  high: { label: 'Haute', pixelRatio: 1.25, aa: 'smaa' },
  cinema: { label: 'Cinéma', pixelRatio: 2, aa: 'smaa' },
};

export const RENDER_DEFAULTS = {
  quality: 'high',
  pixelRatio: 1.25, aa: 'smaa', shadows: 'high', microDetail: 1, patina: 1, msaa: 0,
  toneMapping: 'aces', exposure: 1, contrast: 1.04, saturation: 1, warmth: 0, vignette: 0.35,
  bloom: true, bloomStrength: 0.08, bloomRadius: 0.5, bloomThreshold: 1.2, hiCap: 6, roughFloor: 0,
  ao: false, aoStrength: 0, aoRadius: 0.4,
  ssr: false, ssrIntensity: 0, ssrQuality: 0.5, ssrDistance: 2.5, ssrThickness: 0.05, ssrRes: 0.5, ssrBlur: 2,
  dof: false, focus: 1, focusRange: 0.35, bokeh: 2,
  motionBlur: 0, ca: 0.06, grain: 0.03,
  streaks: 0, streakLen: 4, halation: 0.2, dirt: 0,
  dynRes: false, maxFps: 0,
};

// Mobile : demi-résolution, résolution dynamique, cadence plafonnée.
export const MOBILE_DEFAULTS = {
  ...RENDER_DEFAULTS,
  quality: 'mobile', lite: true, pixelRatio: 0.75, aa: 'fxaa', ca: 0, grain: 0.025,
  dynRes: true, maxFps: 60,
};

const STORE = 'melt.render.v3';
const RAYTRACE_OFF = { dof: false, ao: false, ssr: false, motionBlur: 0, streaks: 0, dirt: 0 }; // (changer de version quand un défaut change : les réglages mémorisés sont alors oubliés)

// (le mode mobile a ses propres réglages mémorisés)
export const defaultsFor = (lite) => (lite ? MOBILE_DEFAULTS : RENDER_DEFAULTS);
export function loadRender(lite = false) {
  const D = defaultsFor(lite);
  try {
    const s = JSON.parse(localStorage.getItem(lite ? `${STORE}.mobile` : STORE) || 'null');
    // (le lancer de rayons n'a ni profondeur, ni vitesses, ni normales : ces effets restent coupés)
    if (s && typeof s === 'object') return { ...D, ...s, lite, ...RAYTRACE_OFF, aa: s.aa === 'traa' ? D.aa : s.aa };
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
