// L'horloge du film : une seule fonction de la phase u ∈ [0, 1) donne la part
// de fil transférée, l'angle du fléau et la pose de la caméra. Module pur
// (tests Node) ; la scène, la lumière et le chargement le lisent.
//
// Boucle : repos [0, t0) → transfert [t0, t1] (S passe de 0 à 1 à droite,
// de 1 à 0 à gauche) → rangement (t1, s0) → relève [s0, s1] (le fléau tourne
// de π) → repos. À u = 1, la station pleine occupe la place de celle de gauche
// et la vide celle de droite : c'est l'état de u = 0 (les deux stations sont
// identiques, la station de droite est tournée de π dans le fléau).

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const s5 = (x) => { const t = clamp(x); return t * t * t * (t * (t * 6 - 15) + 10); };

// Programme de vitesse du transfert, en part de ruban s : un régime par
// marque (armature, fermeture, finition), vitesses relatives speeds[k],
// raccords lissés. Le temps pour parcourir ds est ds / v(s) ; la table
// inverse donne S(x) pour x ∈ [0, 1] (part du temps de transfert), puis un
// départ et un arrêt sans à-coup (vitesse nulle aux deux bouts).
export function makeProgram(marks, speeds, n = 4096) {
  const b = marks.map((m) => m.s).slice(1); // (débuts de la fermeture, de la finition)
  const v = (s) => {
    let x = speeds[0];
    b.forEach((sb, k) => { x += (speeds[k + 1] - speeds[k]) * sstep(sb - 0.015, sb + 0.015, s); });
    return x;
  };
  const T = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) { const s = (i - 0.5) / n; T[i] = T[i - 1] + 1 / n / v(s); }
  const tot = T[n];
  for (let i = 0; i <= n; i++) T[i] /= tot;
  // départ et arrêt : la vitesse du temps monte et descend en douceur sur 6 %
  const m = 2048, W = new Float64Array(m + 1);
  for (let i = 1; i <= m; i++) { const x = (i - 0.5) / m; W[i] = W[i - 1] + sstep(0, 0.06, x) * sstep(1, 0.94, x) / m; }
  const wt = W[m];
  for (let i = 0; i <= m; i++) W[i] /= wt;
  const warp = (x) => { const f = clamp(x) * m, i = Math.min(m - 1, Math.floor(f)); return W[i] + (W[i + 1] - W[i]) * (f - i); };
  // S(t) : inversion de T (croissante)
  const S = (x) => {
    const t = warp(x);
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= t) lo = mid; else hi = mid; }
    const f = (t - T[lo]) / Math.max(1e-12, T[hi] - T[lo]);
    return (lo + clamp(f)) / n;
  };
  return { S, v };
}

// Angle du fléau pendant la relève : π·s5(x) + dépassement amorti qui
// retombe exactement sur π, vitesse nulle aux deux bouts
export function beamAngle(x, overshoot = 0.05) {
  const t = clamp(x);
  const bump = 45.6 * t ** 4 * (1 - t) ** 2; // (maximum 1 vers t = 2/3)
  return Math.PI * s5(t) + overshoot * bump * (t > 0.5 ? 1 : 0.4);
}

// État du film à la phase u
export function filmState(R, prog, u) {
  const ph = u - Math.floor(u);
  const { t0, t1, s0, s1 } = R.tempo;
  const x = clamp((ph - t0) / (t1 - t0));
  const SB = ph < t0 ? 0 : ph > t1 ? 1 : prog.S(x);
  const theta = ph < s0 ? 0 : beamAngle((ph - s0) / (s1 - s0), R.tempo.overshoot);
  return { ph, SB, SA: 1 - SB, theta, transfer: ph >= t0 && ph <= t1 ? x : ph < t0 ? 0 : 1, swap: clamp((ph - s0) / (s1 - s0)) };
}

// Distance qui garde les deux lanternes et leurs ailettes dans le champ
// (image 16:9, champ vertical fov) vues sous l'azimut az et la hauteur el
export function fitDistance(az, el, fov, bias, L = 0.44, rad = 0.24, aspect = 16 / 9) {
  const t = Math.tan((fov * Math.PI) / 360), tx = t * aspect * 0.92, ty = t * 0.92;
  let lo = 0.6, hi = 6;
  const ok = (d) => {
    const c = [Math.sign(az) * bias + d * Math.sin(az) * Math.cos(el), d * Math.sin(el), d * Math.cos(az) * Math.cos(el)];
    const f = [Math.sign(az) * bias - c[0], -c[1], -c[2]], fl = Math.hypot(...f); f.forEach((v, i) => { f[i] = v / fl; });
    const r = [f[2], 0, -f[0]], rl = Math.hypot(...r); r.forEach((v, i) => { r[i] = v / rl; });
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    for (const x of [-L, L]) for (const dy of [-0.2, 0.36]) for (const dx of [-rad, rad]) {
      const p = [x + dx - c[0], dy - c[1], -c[2]];
      const z = p[0] * f[0] + p[1] * f[1] + p[2] * f[2];
      if (z < 0.2) return false;
      if (Math.abs(p[0] * r[0] + p[1] * r[1] + p[2] * r[2]) / z > tx || Math.abs(p[0] * u[0] + p[1] * u[1] + p[2] * u[2]) / z > ty) return false;
    }
    return true;
  };
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
  return hi;
}

// Caméra : orbite lente et périodique autour du centre de l'appareil, à la
// hauteur des lanternes ; un balancement (période = la boucle), une très
// légère respiration de distance ; pendant la relève, elle accompagne d'un
// rien le fléau (sans jamais dépasser ~5°/s).
export function cameraPose(R, u, lay) {
  const C = R.camera, TAU = Math.PI * 2, T = R.tempo;
  const ph = u - Math.floor(u);
  // plan large : orbite lente, balancement, respiration de distance
  const az = C.az + C.sway * Math.sin(TAU * ph) + 0.6 * C.sway * Math.sin(2 * TAU * ph + 1.3);
  const el = C.el + 0.25 * C.sway * Math.sin(TAU * ph + 0.7);
  const d = C.dist * (1 + 0.03 * Math.sin(TAU * ph + 2.1));
  const L = lay.L ?? 0.44, yc = lay.yc;
  const tw = [(C.bias ?? 0.2), yc + 0.05, 0];
  const pw = [tw[0] + d * Math.sin(az) * Math.cos(el), tw[1] + d * Math.sin(el), tw[2] + d * Math.cos(az) * Math.cos(el)];
  // gros plan : pendant le transfert, la caméra s'approche de la lanterne qui
  // s'enroule (le geste : l'œil, le ruban, la paroi qui se ferme), la lanterne
  // qui se dévide reste au fond, floue ; elle recule pour la relève
  const k = (C.close ?? 0.85) * s5((ph - T.t0) / 0.11) * (1 - s5((ph - (T.t1 - 0.03)) / 0.08));
  // (de face plutôt que dans l'axe du fléau : la colonne et l'autre lanterne
  // restent à côté, pas derrière)
  const azc = Math.max(0.22, az - 0.42), elc = el + 0.07, dc = C.closeDist ?? 0.95;
  const tc = [L + 0.02, yc + 0.01, 0];
  const pc = [tc[0] + dc * Math.sin(azc) * Math.cos(elc), tc[1] + dc * Math.sin(elc), tc[2] + dc * Math.cos(azc) * Math.cos(elc)];
  const mix3 = (a, b) => a.map((x, i) => x + (b[i] - x) * k);
  return { pos: mix3(pw, pc), target: mix3(tw, tc), fov: C.fov, close: k };
}

export { clamp, sstep, s5 };
