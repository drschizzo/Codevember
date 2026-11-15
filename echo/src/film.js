// L'horloge du film. Une seule fonction de la phase u ∈ [0, 1) donne tout ce
// qui change à l'écran : le temps physique τ, le rayon du front de l'éclair,
// la charge du stroboscope (son voyant), la rotation de la boule, la dérive de
// la poussière, la caméra. Module pur (aucun import de three).
//
// La convention de temps est celle d'une caméra rapide : la vitesse du film
// v(u) vaut 1 en temps réel et 1/K au ralenti (K ≈ 10⁹), raccordée en log v par
// des rampes douces. τ(u) = T ∫₀ᵘ v. La boucle n'a qu'un ralenti : le
// stroboscope se charge en temps réel (son voyant rougit), l'éclair part, le
// film ralentit et l'on suit la lumière, ses échos, jusqu'à ce qu'elle ait
// quitté la pièce ; puis le temps réel revient, dans le noir, et la charge
// recommence. Pendant le ralenti, rien de matériel ne bouge (ils lisent τ) ;
// la caméra lit u et continue de glisser.
//
// Le rayon du front est une longueur de chemin (m) mesurée depuis l'instant où
// l'éclair quitte le tube ; il est calculé ici en double précision et borné à
// [−1, 60] m pour les flottants du GPU.

export const C_LIGHT = 299792458;
export const RHO_MIN = -1, RHO_MAX = 60;
const TAU = Math.PI * 2;

// découpage de la boucle (en part de boucle) : début de la rampe, ralenti
// atteint (l'éclair), fin du ralenti, temps réel retrouvé
export const TIMELINE = { down: 0.1, slow: 0.14, end: 0.86, up: 0.9 };
// vitesse visée du front (m par seconde de film) : la durée de la boucle en
// découle (recipe.js), bornée à [10, 16] s
export const FRONT_SPEED = 0.55;
export const durationFor = (span) => Math.min(16, Math.max(10, Math.round(span / (FRONT_SPEED * (TIMELINE.end - TIMELINE.slow)))));

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const smoother = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * t * (t * (6 * t - 15) + 10); };

// Le film d'une recette : F.duration (s), F.rhoStart (m : ce que la lumière a
// déjà parcouru quand le ralenti est atteint, juste avant qu'elle n'atteigne
// l'objectif), F.rhoEnd (m : au-delà, toute la lumière visible est passée)
export function createFilm(F) {
  const T = F.duration;
  const tl = TIMELINE;
  const frontSpeed = (F.rhoEnd - F.rhoStart) / ((tl.end - tl.slow) * T);
  const K = C_LIGHT / frontSpeed;
  const lnK = Math.log(K);
  const lam = (u) => -lnK * smoother(tl.down, tl.slow, u) * (1 - smoother(tl.end, tl.up, u));
  // τ(u) tabulé (double précision, trapèzes) ; au ralenti la vitesse est
  // exactement 1/K, le front avance à vitesse constante
  const N = 1 << 15;
  const tab = new Float64Array(N + 1);
  let prev = Math.exp(lam(0));
  for (let i = 1; i <= N; i++) {
    const cur = Math.exp(lam(i / N));
    tab[i] = tab[i - 1] + ((prev + cur) / 2) * (T / N);
    prev = cur;
  }
  const P = tab[N]; // (secondes réelles par boucle)
  const tauAt = (u) => {
    const x = Math.min(1, Math.max(0, u)) * N, i = Math.min(N - 1, Math.floor(x)), f = x - i;
    return tab[i] + (tab[i + 1] - tab[i]) * f;
  };
  // instant (physique) où l'éclair quitte le tube
  const tFlash = tauAt(tl.slow) - F.rhoStart / C_LIGHT;
  const clampRho = (r) => Math.min(RHO_MAX, Math.max(RHO_MIN, r));

  function rho(u) {
    const ph = u - Math.floor(u);
    // avant l'éclair de cette boucle : celui de la boucle précédente est loin
    if (ph < tl.slow) return RHO_MAX;
    return clampRho(C_LIGHT * (tauAt(ph) - tFlash));
  }

  // phase réelle ∈ [0, 1) : ce qui vit en temps réel (boule, poussière,
  // charge) la lit ; elle est figée pendant le ralenti
  const realPhase = (u) => { const ph = u - Math.floor(u); return tauAt(ph) / P; };
  const rpFlash = tauAt(tl.slow) / P;
  // charge du stroboscope ∈ [0, 1] : vide juste après l'éclair, pleine à
  // l'éclair suivant ; le voyant s'allume quand la charge est prête (> 0,8)
  function charge(u) {
    const rp = realPhase(u);
    let c = rp - rpFlash;
    if (c < 0) c += 1;
    // (à l'instant de l'éclair la charge tombe : 1 juste avant, 0 juste après)
    const ph = u - Math.floor(u);
    return ph >= tl.slow ? Math.min(1, c) * (ph >= tl.up ? 1 : 0) : Math.min(1, c);
  }

  return {
    T, K, P, frontSpeed, tFlash, tauAt, lam, rho, realPhase, charge,
    speed: (u) => Math.exp(lam(u - Math.floor(u))),
  };
}

// ── Caméra ──────────────────────────────────────────────────────────────────
// Un plan fixe qui respire : la caméra glisse lentement sur un arc et avance
// un peu pendant le ralenti (un travelling qui lit u, pas τ). Périodique en u.
export function cameraAt(C, u) {
  const ph = u - Math.floor(u);
  const tl = TIMELINE;
  const push = sstep(tl.down, tl.end, ph) * (1 - sstep(tl.end, 1, ph));
  const az = C.az + C.sway * Math.sin(TAU * ph + C.swayPhase);
  const el = C.el + C.sway * 0.35 * Math.sin(2 * TAU * ph + 1.3);
  const d = C.dist * (1 - C.push * push);
  const tg = C.target;
  const pos = [
    tg[0] + d * Math.cos(el) * Math.sin(az),
    tg[1] + d * Math.sin(el),
    tg[2] + d * Math.cos(el) * Math.cos(az),
  ];
  return { pos, target: tg, fov: C.fov };
}
