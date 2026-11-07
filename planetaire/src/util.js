// Petites fonctions mathématiques partagées (côté CPU).

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const mixRGB = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
// smoothstep de GLSL : 0 avant a, 1 après b, transition en S entre les deux
export const ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// transition plus douce encore (dérivées première et seconde nulles aux bords)
export const smoother = (u) => u * u * u * (u * (u * 6 - 15) + 10);
