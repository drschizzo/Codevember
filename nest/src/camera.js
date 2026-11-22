// La caméra du film (sans le rapprochement du temps fort, qui lit la
// géométrie : voir core.js). Module pur : testé dans Node (continuité, vitesse
// angulaire).
import { FILM } from './season.js';

// Échelle du cadre en fonction de la phase : l'échelle de la cloche la plus
// grande déjà commencée, à mesure qu'elle se ferme ; gardée jusqu'à la chute,
// puis revenue (lentement) au cadre serré du printemps. Lissée en u (noyau
// gaussien périodique) : la caméra ne fait jamais d'à-coup.
export function cameraScale(clock, P) {
  // croissance (jusqu'à la fermeture) : l'échelle de la cloche qui pousse,
  // lissée ; puis tenue jusqu'à la chute ; puis retour lent au cadre du
  // printemps (après que le nid a quitté l'image), tenu jusqu'à la reine
  const N = 1024, raw = new Float64Array(N), out = new Float64Array(N);
  const L0 = 0.055; // (printemps, fondation : un cadre de 2,5 cm, la reine et son pétiole)
  const uHold = FILM.peak + 0.02, uFall = FILM.fall + 0.02, uBack = FILM.spring + 0.07; // (un retour assez long pour que la caméra, qui redescend sous la poutre, tourne lentement)
  for (let i = 0; i < N; i++) {
    const u = i / N, s = clock.s(u);
    let L = L0;
    for (const b of P.bells) if (s > b.s0) { const g = Math.min(1, (s - b.s0) / (b.s1 - b.s0)); L = Math.max(L, b.lam * (0.5 + 0.5 * g)); }
    raw[i] = Math.log(u < uHold ? L : 1);
  }
  const sig = 0.012 * N, R = Math.ceil(3 * sig);
  for (let i = 0; i < N; i++) {
    let a = 0, w = 0;
    for (let k = -R; k <= R; k++) { const j = i + k; if (j < 0 || j >= N) continue; const q = Math.exp(-(k * k) / (2 * sig * sig)); a += raw[j] * q; w += q; }
    out[i] = a / w;
  }
  const ss = (x) => x * x * (3 - 2 * x);
  return (u) => {
    u -= Math.floor(u);
    if (u >= uFall) { const q = Math.min(1, (u - uFall) / (uBack - uFall)); return Math.exp(ss(q) * Math.log(L0)); }
    if (u >= uHold) return 1;
    const x = u * N, i = Math.min(N - 2, Math.floor(x)), f = x - i;
    return Math.exp(out[i] * (1 - f) + out[i + 1] * f);
  };
}


// L'orbite : l'azimut (autour de l'axe vertical du nid) et la hauteur (en
// degrés) au fil du film — un arc lent autour de la reine, une spirale qui
// monte et tourne pendant la croissance, le retour lent du déclin, la descente
// de l'hiver, le retour au printemps (docs/concept.md, révision de la caméra).
// Des repères posés sur les temps du film, reliés en douceur puis lissés par
// un noyau gaussien périodique : aucun arrêt à un repère, raccord exact.
export const ORBIT_KEYS = {
  az: [[0, -20], [0.035, -20], [0.1, 0], [0.33, 26], [0.5, 40], [0.63, 48], [0.745, 16], [0.82, 4], [0.9, -6], [1, -20]],
  el: [[0, 0], [0.1, 0], [0.35, 7], [0.63, 6], [0.745, 0], [0.82, -5], [0.9, -4], [1, 0]],
};
export function cameraOrbit() {
  const N = 1024, ss = (x) => x * x * (3 - 2 * x);
  const curve = (K) => {
    const raw = new Float64Array(N), out = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const u = i / N; let j = 0;
      while (j < K.length - 2 && u > K[j + 1][0]) j++;
      const q = (u - K[j][0]) / (K[j + 1][0] - K[j][0]);
      raw[i] = K[j][1] + (K[j + 1][1] - K[j][1]) * ss(Math.min(1, Math.max(0, q)));
    }
    const sig = 0.03 * N, R = Math.ceil(3 * sig);
    for (let i = 0; i < N; i++) {
      let a = 0, w = 0;
      for (let k = -R; k <= R; k++) { const q = Math.exp(-(k * k) / (2 * sig * sig)); a += raw[(((i + k) % N) + N) % N] * q; w += q; }
      out[i] = a / w;
    }
    return (u) => { u -= Math.floor(u); const x = u * N, i = Math.floor(x) % N, f = x - Math.floor(x); return out[i] * (1 - f) + out[(i + 1) % N] * f; };
  };
  const az = curve(ORBIT_KEYS.az), el = curve(ORBIT_KEYS.el);
  return (u) => [(az(u) * Math.PI) / 180, (el(u) * Math.PI) / 180];
}

// pose de la caméra à l'échelle L du nid : tout se resserre vers la poutre
// (au printemps, quand le cadre est serré sur le pétiole et le rayon, la caméra
// descend : on regarde le rayon par en dessous, ses cellules ouvertes) ; orb :
// [azimut, hauteur] de l'orbite, autour de la visée
export function filmCamera(C, yB, L, orb = [0, 0]) {
  const target = [C.target[0] * L, yB - (yB - C.target[1]) * L, C.target[2] * L];
  const pos = [C.pos[0] * L, yB - (yB - C.pos[1]) * L, C.pos[2] * L];
  const x = Math.min(1, Math.max(0, (L - 0.06) / 0.7)), low = 1 - x * x * (3 - 2 * x); // (la caméra remonte sur une plage large : plus basse sous le rayon, elle tournait trop vite en remontant)
  const d = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
  pos[1] -= low * d * 0.75; // (assez bas pour voir dans les cellules ouvertes, et l'œuf au fond)
  // l'orbite : la caméra tourne autour de la verticale de la visée, puis
  // monte ou descend sur sa sphère (même distance)
  let v = [pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]];
  const [az, el] = orb, ca = Math.cos(az), sa = Math.sin(az);
  v = [v[0] * ca + v[2] * sa, v[1], -v[0] * sa + v[2] * ca];
  const r = Math.hypot(...v), h = Math.hypot(v[0], v[2]);
  const e = Math.min(1.2, Math.max(-1.2, Math.atan2(v[1], h) + el));
  v = [(v[0] / h) * Math.cos(e) * r, Math.sin(e) * r, (v[2] / h) * Math.cos(e) * r];
  return { target, pos: [target[0] + v[0], target[1] + v[1], target[2] + v[2]] };
}
