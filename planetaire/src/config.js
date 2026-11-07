// Paramètres d'URL, lus une seule fois pour toute l'application.
// (La liste complète est documentée dans le README.)

export const params = new URLSearchParams(location.search);
const num = (key, fallback) => Number(params.get(key)) || fallback;

const FILM = params.has('film');
const HDR = !params.has('sdr') && (params.has('hdr') || matchMedia('(dynamic-range: high)').matches);

export const CONFIG = {
  film: FILM,                               // mode tournage (film.js)
  auto: params.has('auto') || FILM,         // sans écran d'accueil
  prof: params.has('prof'),                 // chronométrage GPU / JS
  n: Math.max(4096, Math.round(num('n', 1 << 20) / 256) * 256), // nombre de grains
  warp: Math.max(1, Math.min(16, num('warp', 1))),
  meca: !params.has('nomeca'),              // machine en laiton au démarrage
  // rendu
  hdr: HDR,
  peak: num('peak', 4),                     // pic HDR, en multiples du blanc de l'interface
  starHdr: HDR ? num('starhdr', 3.5) : 1,   // éclat du disque stellaire en HDR
  exposure: num('exposure', 1.45),
  agx: params.has('agx'),
  bloom: !params.has('nobloom'),
  cine: !params.has('nocine'),
  streak: params.has('streak'),
  lens: !params.has('nolens') && !FILM,     // flou de mouvement (au tournage : sous-images)
  dof: params.has('dof'),
  aa: params.get('aa') ?? 'smaa',           // 'smaa' | 'msaa' | '0'
};
