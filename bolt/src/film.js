// Le film : une seule horloge. Tout ce que montre la boucle — vapeur, nuage,
// charge, traceur, arcs, lumière, pluie, niveau du thé, caméra — se lit ici,
// en fonction de la seule phase u ∈ [0, 1). Module pur (tests, écran de
// chargement, scène).
//
//   0,96 – 0,335 la vapeur monte et remplit le nuage (accéléré ; simulation relue)
//   0,24 – 0,34  la charge : le nuage fonce, lueurs (accéléré)
//   0,34 – 0,60  le traceur descend par bonds       (caméra rapide)
//   0,60         la jonction : l'arc en retour
//   0,60 – 0,70  réamorçages, rémanence en perles   (ralenti léger)
//   0,72 – 0,95  l'averse rend l'eau à la tasse     (temps réel)
//
// L'eau se conserve : nuage + pluie en vol + thé = constante, à chaque instant.
// C'est ce qui referme la boucle (le niveau revient exactement à sa marque).

// cycle : l'instant où la vapeur repart de la tasse (le film d'une graine
// commence à u = 0, mais le cycle de l'eau commence ici, juste après l'averse) ;
// fill : durée du remplissage du nuage, en part de boucle
export const TIMES = { cycle: 0.96, fill: 0.375, dark: [0.2, 0.34], leader: [0.34, 0.6], strike: 0.6, rain: [0.715, 0.94], flicker: [0.25, 0.335] };
// vitesses (unités de scène par seconde de film) et durées (secondes de film)
export const PHYS = { wave: 11, dart: 0.07, fall: 0.42, tauFast: 0.075, tauSlow: 0.4, tauBranch: 0.09, ripple: 0.55 };

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// « smootherstep » : dérivées première et seconde nulles aux deux bouts
export const sstep5 = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };

// Horloge des mouvements lents (vapeur qui monte, bourgeons du nuage) : pendant
// que la caméra rapide filme le traceur, tout ce qui bouge à l'échelle de la
// seconde est presque arrêté. Vitesse 1 − SLOW·B(u), où B vaut 1 pendant le
// traceur ; l'intégrale est en forme fermée et ramenée à 1 sur la boucle : la
// vapeur fait toujours un nombre entier de périodes.
export const SLOW = 0.94;
const SL = [TIMES.leader[0] - 0.025, TIMES.leader[0] + 0.015, TIMES.strike - 0.01, TIMES.strike + 0.015];
const iss = (a, b, u) => { const t = clamp((u - a) / (b - a)); return (b - a) * (t * t * t - (t * t * t * t) / 2) + Math.max(0, u - b); }; // ∫ smoothstep
const rawClock = (u) => u - SLOW * (iss(SL[0], SL[1], u) - iss(SL[2], SL[3], u));
export const clockAt = (u) => { u -= Math.floor(u); return rawClock(u) / rawClock(1); };
export const clockRate = (u) => (1 - SLOW * (sstep(SL[0], SL[1], u) - sstep(SL[2], SL[3], u))) / rawClock(1);

// impulsion d'un arc : montée en quelques millisecondes, chute rapide puis
// traîne (le courant persistant)
export function pulse(x) {
  if (x <= 0) return 0;
  return Math.min(1, x / 0.012) * (0.72 * Math.exp(-x / PHYS.tauFast) + 0.28 * Math.exp(-x / PHYS.tauSlow));
}

// État du film à la phase u. F = R.film : { duration, strokes: [{ t, amp, path }], flickers: [{ u, amp, p }] }
export function stateAt(F, u) {
  u -= Math.floor(u);
  const D = F.duration, T = TIMES;
  // v : phase dans le cycle de l'eau (0 quand la vapeur repart de la tasse)
  const v = (u - T.cycle + 1) % 1, r0 = (T.rain[0] - T.cycle + 1) % 1, r1 = (T.rain[1] - T.cycle + 1) % 1;
  const up = sstep5(0, T.fill, v);                        // eau montée (vapeur et nuage : un seul fluide, simulé)
  const out = sstep5(r0, r1, v);                          // eau partie en pluie (cumul)
  const dl = PHYS.fall / D;
  const landed = sstep5(r0 + dl, r1 + dl, v);             // eau arrivée dans la tasse (cumul)
  const cloud = up - out, air = out - landed;
  // la chaleur que la foudre a laissée (la cuillère rougie, le thé qui frémit) :
  // c'est elle qui fait repartir la vapeur après l'averse
  const heat = Math.exp(-((u - T.strike + 1) % 1) / 0.22);
  // avancement du traceur : il part lentement et accélère
  const tl = clamp((u - T.leader[0]) / (T.leader[1] - T.leader[0]));
  const a = u < T.leader[0] ? -1 : u >= T.strike ? 1 : tl * (0.55 + 0.45 * tl);
  const tau = (u - T.strike) * D; // secondes après la jonction (négatif avant)
  // lumière des arcs (somme des impulsions) et arc dominant
  let light = 0, lead = 0, best = 0;
  if (tau > 0) F.strokes.forEach((s, j) => { const l = s.amp * pulse(tau - s.t); light += l; if (l > best) { best = l; lead = j; } });
  // lueurs intra-nuage pendant la charge
  const glow = F.flickers.map((f) => { const x = (u - f.u) * D; return x <= 0 ? 0 : f.amp * Math.min(1, x / 0.03) * Math.exp(-x / 0.16); });
  return {
    u, clock: clockAt(u), cloud, air, level: -(cloud + air),                    // (niveau : écart à la marque, en parts de F.drop)
    grow: up,                                                 // forme du nuage (cumulus → tour → enclume)
    shred: out,                                               // effilochement pendant l'averse
    dark: sstep(T.dark[0], T.dark[1], u) * (1 - sstep(T.rain[0], T.rain[0] + 0.14, u)),
    sim: clamp(v / T.fill),                                   // instant de la simulation du panache (0 → 1), puis elle reste sur sa dernière image
    heat,
    a, tau, light, lead, glow,
    rain: out > 0 && out < 1 ? (sstep5(r0, r1, v + 0.004) - sstep5(r0, r1, v - 0.004)) / 0.008 / 1.875 / (1 / (r1 - r0)) : 0, // débit, 0 → 1
  };
}

// Caméra : sur pied. Elle s'approche pendant la charge et le traceur, recule
// pendant l'averse ; un balancement d'une période par boucle. C : R.camera.
export function cameraAt(C, u) {
  u -= Math.floor(u);
  const push = sstep5(0.22, 0.52, u) * (1 - sstep5(0.68, 0.94, u));
  const az = C.az + C.sway * Math.sin(2 * Math.PI * u) + C.arc * push;
  const el = C.el + C.tilt * push;
  const d = C.dist * (1 - C.push * push);
  const ty = C.target[1] + C.rise * push;
  const p = [C.target[0] + Math.sin(az) * Math.cos(el) * d, ty + Math.sin(el) * d, C.target[2] + Math.cos(az) * Math.cos(el) * d];
  return { pos: p, target: [C.target[0], ty, C.target[2]], fov: C.fov };
}
