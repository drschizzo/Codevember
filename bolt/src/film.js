// Le film : une seule horloge. Tout ce que montre la boucle — vapeur, nuage,
// charge, traceur, arcs, lumière, chaleur, pluie, niveau du thé, caméra — se
// lit ici, en fonction de la seule phase u ∈ [0, 1). Module pur (tests, écran
// de chargement, scène).
//
//   0,52 – 0,95  la foudre a chauffé le thé : la vapeur monte et remplit le
//                nuage (accéléré ; simulation relue)
//   0,03 – 0,36  il pleut : le nuage rend l'essentiel de son eau à la tasse
//                et fonce en se chargeant (dans un orage, ce sont les
//                précipitations qui séparent les charges)
//   0,27 – 0,385 la charge : lueurs dans le nuage (accéléré)
//   0,385 – 0,50 le traceur descend par bonds, hésite, puis saute (caméra rapide)
//   0,50         la jonction : l'arc en retour
//   0,51 – 0,60  la bourrasque de pluie qui suit l'éclair (« rain gush ») rend
//                le reste de l'eau ; le nuage vidé se défait, et le thé
//                saisi par la machine rougie lance déjà la colonne suivante
//                (les deux lus dans le même champ simulé : une seule matière)
//
// L'eau se conserve : nuage + pluie en vol + thé = constante, à chaque instant.
// C'est ce qui referme la boucle (le niveau revient exactement à sa marque).

// cycle : l'instant où la vapeur repart de la tasse (le film d'une graine
// commence à u = 0, mais le cycle de l'eau commence ici : quand la chaleur de
// l'arc a atteint la résistance) ; fill : durée du remplissage du nuage, en
// part de boucle ; rain : la pluie avant la foudre (elle rend la part RAIN de
// l'eau) ; gush : la bourrasque après l'arc (le reste) ; fade : le nuage vidé
// se défait
export const TIMES = { cycle: 0.52, fill: 0.43, dark: [0.0, 0.385], leader: [0.385, 0.5], strike: 0.5, rain: [0.03, 0.36], gush: [0.51, 0.6], fade: [0.505, 0.65], flicker: [0.27, 0.38] };
export const RAIN = 0.7;
// vitesses (unités de scène par seconde de film) et durées (secondes de film)
// cond : durée de la descente de la chaleur le long du métal, de la pointe à la
// résistance ; rod : refroidissement de la tige (mince), en secondes
export const PHYS = { wave: 11, dart: 0.07, fall: 0.42, tauFast: 0.075, tauSlow: 0.4, tauBranch: 0.09, ripple: 0.55, cond: 0.85, rod: 0.6 };

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

// La chaleur que la foudre laisse dans la machine (x : part de boucle écoulée
// depuis la jonction). Elle retombe lentement, tient pendant la bourrasque et
// toute la montée de la vapeur, et s'annule exactement avant la foudre suivante.
export const heatAt = (x) => Math.exp(-x / 0.34) * (1 - sstep5(0.7, 0.98, x));
// Le traceur avance par bonds : un saut bref, une pause, de plus en plus vite ;
// à 0,86 il hésite (l'aigrette monte à sa rencontre), puis saute. t, a ∈ [0, 1].
const BOUNDS = 9, HOLD = [0.8, 0.94];
export function leaderAt(t) {
  if (t >= 1) return 1;
  if (t >= HOLD[1]) return 0.86 + 0.14 * sstep(HOLD[1], 1, t);
  const q = Math.min(1, t / HOLD[0]), e = q * (0.6 + 0.4 * q) * BOUNDS; // (il part lentement et accélère)
  const k = Math.min(BOUNDS - 1, Math.floor(e)), f = e - k;
  return (0.86 * (k + sstep(0, 0.4, f))) / BOUNDS;
}
// Le bouillon du choc : le thé saisi par la résistance (secondes après la jonction)
export const burstAt = (tau) => (tau <= 0 ? 0 : sstep(0.12, 0.7, tau) * (1 - sstep(1.3, 3.2, tau)));

// Le cycle de l'eau, en phase de cycle w ∈ [0, 2) (w = 0 : la vapeur repart ;
// un cycle déborde sur le suivant : sa bourrasque et la fin de son nuage
// tombent pendant que la colonne suivante monte). Tout est nul ou constant
// au-delà de w ≈ 1,1 : un état se lit comme la somme du cycle en cours (w = v)
// et du précédent (w = v + 1).
const cyc = (u) => (u - TIMES.cycle + 1) % 1;
const W = { r0: cyc(TIMES.rain[0]), r1: cyc(TIMES.rain[1]), g0: cyc(TIMES.gush[0]) || 1, g1: cyc(TIMES.gush[1]) + 1, f0: cyc(TIMES.fade[0]) || 1, f1: cyc(TIMES.fade[1]) + 1 };
const upW = (w) => sstep5(0, TIMES.fill, w);                                            // eau montée (vapeur et nuage : un seul fluide, simulé)
const outW = (w) => RAIN * sstep5(W.r0, W.r1, w) + (1 - RAIN) * sstep5(W.g0, W.g1, w);  // eau partie en pluie (cumul)
const visW = (w) => 1 - sstep(W.f0, W.f1, w);                                          // ce qui reste visible du nuage de ce cycle
const ragW = (w) => 0.35 * sstep(W.r0, W.r1, w) + 0.65 * sstep(W.f0, W.f1, w);          // effilochement (base en lambeaux sous la pluie, puis dislocation)
const RATE = RAIN * 1.875 / (W.r1 - W.r0);                                              // débit de pointe de la pluie (dérivée de outW)

// État du film à la phase u. F = R.film : { duration, strokes: [{ t, amp, path }], flickers: [{ u, amp, p }] }
export function stateAt(F, u) {
  u -= Math.floor(u);
  const D = F.duration, T = TIMES;
  // v : phase dans le cycle de l'eau (0 quand la vapeur repart de la tasse) ;
  // le cycle précédent se lit en v + 1
  const v = cyc(u), dl = PHYS.fall / D;
  let cloud = 0, air = 0, rain = 0;
  for (const w of [v, v + 1]) {
    const out = outW(w), landed = outW(w - dl);
    cloud += upW(w) - out; air += out - landed;
    rain += (outW(w + 0.004) - outW(w - 0.004)) / 0.008 / RATE;              // débit, 0 → 1 (la bourrasque sature)
  }
  // la chaleur que la foudre a laissée (la cuillère rougie, le thé qui bout) :
  // c'est elle qui fait repartir la vapeur, aussitôt après l'arc
  const heat = heatAt((u - T.strike + 1) % 1);
  // avancement du traceur : il part lentement et accélère
  const tl = clamp((u - T.leader[0]) / (T.leader[1] - T.leader[0]));
  const a = u < T.leader[0] ? -1 : u >= T.strike ? 1 : leaderAt(tl);
  const tau = (u - T.strike) * D; // secondes après la jonction (négatif avant)
  // lumière des arcs (somme des impulsions) et arc dominant
  let light = 0, lead = 0, best = 0;
  if (tau > 0) F.strokes.forEach((s, j) => { const l = s.amp * pulse(tau - s.t); light += l; if (l > best) { best = l; lead = j; } });
  // l'exposition : l'arc brûle l'image le temps d'une impulsion, puis l'iris
  // se referme (l'œil ébloui) et se rouvre en une seconde
  let burn = 0;
  if (tau > 0) for (const s of F.strokes) { const x = tau - s.t; if (x > 0) burn += s.amp * Math.min(1, x / 0.012) * Math.exp(-x / 0.06); }
  const iris = tau > 0 ? sstep(0.03, 0.16, tau) * Math.exp(-tau / 0.75) : 0;
  // lueurs intra-nuage pendant la charge
  const glow = F.flickers.map((f) => { const x = (u - f.u) * D; return x <= 0 ? 0 : f.amp * Math.min(1, x / 0.03) * Math.exp(-x / 0.16); });
  return {
    u, clock: clockAt(u), cloud, air, level: -(cloud + air),                    // (niveau : écart à la marque, en parts de F.drop)
    grow: upW(v),                                             // forme du nuage (cumulus → tour → enclume)
    // le champ simulé, lu deux fois : le cycle en cours à l'instant sim, et la
    // dernière image du cycle précédent (son nuage, qui se défait) ; vis : ce
    // qui en reste ; rag : effilochement de chacun
    sim: clamp(v / T.fill), vis: visW(v), visOld: visW(v + 1), rag: ragW(v), ragOld: ragW(v + 1),
    // il fonce en se chargeant (sous la pluie, puis pendant la charge), s'éclaircit en se défaisant
    dark: (0.55 * sstep(T.dark[0], T.rain[1], u) + 0.45 * sstep(0.22, T.dark[1], u)) * (1 - sstep(T.strike, T.fade[1], u)),
    heat,
    since: ((u - T.strike + 1) % 1) * D,                      // secondes de film depuis la jonction (toujours ≥ 0 : la chaleur dure toute la boucle)
    burst: burstAt(tau),                                      // le bouillon du choc (0 → 1 → 0)
    expo: (1 + 0.85 * Math.min(1.3, burn)) * (1 - 0.3 * iris), burn,
    a, tau, light, lead, glow,
    rain: clamp(rain),                                        // débit, 0 → 1
  };
}

// Caméra : sur pied. Elle s'approche pendant la charge et le traceur ; après la
// jonction elle descend vers le récipient (c'est là que la suite se passe : le
// métal qui rougit, le thé qui bout, la vapeur qui repart), puis recule pour
// suivre la colonne jusqu'au nuage ; un
// balancement d'une période par boucle. C : R.camera.
export function cameraAt(C, u) {
  u -= Math.floor(u);
  const push = sstep5(0.2, 0.47, u) * (1 - sstep5(0.66, 0.92, u));
  const dip = sstep5(0.47, 0.6, u) * (1 - sstep5(0.7, 0.93, u));
  const az = C.az + C.sway * Math.sin(2 * Math.PI * u) + C.arc * push;
  const el = C.el + C.tilt * push + (C.dipEl ?? 0) * dip;
  const d = C.dist * (1 - C.push * push - (C.dipIn ?? 0) * dip);
  const ty = C.target[1] + C.rise * push - (C.dip ?? 0) * dip;
  const p = [C.target[0] + Math.sin(az) * Math.cos(el) * d, ty + Math.sin(el) * d, C.target[2] + Math.cos(az) * Math.cos(el) * d];
  return { pos: p, target: [C.target[0], ty, C.target[2]], fov: C.fov };
}
