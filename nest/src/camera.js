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
  const uHold = FILM.peak + 0.02, uFall = FILM.fall + 0.02, uBack = FILM.spring + 0.04;
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


// pose de la caméra à l'échelle L du nid : tout se resserre vers la poutre
// (au printemps, quand le cadre est serré sur le pétiole et le rayon, la caméra
// descend : on regarde le rayon par en dessous, ses cellules ouvertes)
export function filmCamera(C, yB, L) {
  const target = [C.target[0] * L, yB - (yB - C.target[1]) * L, C.target[2] * L];
  const pos = [C.pos[0] * L, yB - (yB - C.pos[1]) * L, C.pos[2] * L];
  const x = Math.min(1, Math.max(0, (L - 0.06) / 0.4)), low = 1 - x * x * (3 - 2 * x);
  const d = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
  pos[1] -= low * d * 0.45;
  return { target, pos };
}
