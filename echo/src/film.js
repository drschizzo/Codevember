// L'horloge du film. Une seule fonction de la phase u ∈ [0, 1) donne tout ce
// qui change à l'écran : le temps physique τ, les rayons des deux fronts
// (allumage, extinction), le cordon de la douille, la rotation de la boule,
// la dérive de la poussière, la caméra. Module pur (aucun import de three).
//
// La convention de temps est celle d'une caméra rapide : la vitesse du film
// v(u) vaut 1 en temps réel et 1/K au ralenti (K ≈ 5·10⁸), raccordée en
// log v par des rampes douces. τ(u) = T ∫₀ᵘ v. Pendant un ralenti, rien de ce
// qui est matériel ne bouge (cordon, boule, poussière : ils lisent τ) ; seule
// la lumière avance, de quelques mètres. La caméra, elle, lit u : elle continue
// de glisser pendant que le temps est suspendu.
//
// Les rayons des fronts sont des longueurs de chemin (m) mesurées depuis
// l'instant où la lumière part de l'ampoule ; ils sont calculés ici en double
// précision et bornés à [−1, 60] m pour les flottants du GPU.

export const C_LIGHT = 299792458;
export const RHO_MIN = -1, RHO_MAX = 60;
const TAU = Math.PI * 2;

// découpage de la boucle (en part de boucle) ; chaque événement : début de la
// rampe de descente, ralenti atteint, fin du ralenti, temps réel retrouvé
export const TIMELINE = {
  on: { down: 0.036, slow: 0.072, end: 0.40, up: 0.43 },
  off: { down: 0.53, slow: 0.566, end: 0.895, up: 0.925 },
};

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const smoother = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * t * (t * (6 * t - 15) + 10); };

// Le film d'une recette : F.duration (s), F.rhoStart (m : ce que la lumière a
// déjà parcouru quand le ralenti est atteint, juste avant qu'elle n'atteigne
// l'objectif), F.rhoEnd (m : au-delà, tout est allumé), cordon, boule.
export function createFilm(F) {
  const T = F.duration;
  const tl = TIMELINE;
  // vitesse du ralenti : la lumière parcourt rhoEnd − rhoStart pendant le
  // ralenti (de « slow » à « end »)
  const span = (e) => (e.end - e.slow) * T;
  const frontSpeed = (F.rhoEnd - F.rhoStart) / span(tl.on); // (m par seconde de film)
  const K = C_LIGHT / frontSpeed;
  const lnK = Math.log(K);
  // log de la vitesse du film : 0 en temps réel, −ln K au ralenti
  const lam = (u) => {
    let s = 0;
    for (const e of [tl.on, tl.off]) s = Math.max(s, smoother(e.down, e.slow, u) * (1 - smoother(e.end, e.up, u)));
    return -lnK * s;
  };
  // τ(u) tabulé (double précision, trapèzes) ; la vitesse au ralenti est
  // exactement 1/K, si bien que le front avance à vitesse constante
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
    // (intégrale exacte du segment linéaire de la vitesse : assez juste ici,
    // les écarts au ralenti tiennent sous le nanomètre de chemin)
    return tab[i] + (tab[i + 1] - tab[i]) * f;
  };
  const tSlow = { on: tauAt(tl.on.slow), off: tauAt(tl.off.slow) };
  // instant (physique) où la lumière quitte l'ampoule
  const tEvent = { on: tSlow.on - F.rhoStart / C_LIGHT, off: tSlow.off - F.rhoStart / C_LIGHT };
  const clampRho = (r) => Math.min(RHO_MAX, Math.max(RHO_MIN, r));
  // temps écoulé (s, réel) depuis l'événement k le plus récent, u déroulé
  const since = (u, t0) => { const t = tauAt(u); return t >= t0 ? t - t0 : t + P - t0; };

  function rho(u) {
    const ph = u - Math.floor(u);
    const t = tauAt(ph);
    // avant l'allumage de cette boucle : la lampe est éteinte depuis la boucle
    // précédente (les deux fronts sont passés)
    if (ph < tl.on.slow) return { on: RHO_MAX, off: RHO_MAX, lit: 0 };
    const on = clampRho(C_LIGHT * (t - tEvent.on));
    const off = ph < tl.off.slow ? RHO_MIN : clampRho(C_LIGHT * (t - tEvent.off));
    return { on, off, lit: ph < tl.off.slow ? 1 : 0 };
  }

  // ── Le cordon de la douille à tirette ──
  // La main (hors champ) tire la perle de dp mètres en tp secondes, le déclic
  // a lieu en bas ; la perle est relâchée hold secondes plus tard, remonte
  // (ressort de l'interrupteur, amorti) et se balance (pendule de longueur ℓ).
  const cord = F.cord;
  const g = 9.81, wp = Math.sqrt(g / cord.length), tauS = cord.damping;
  const wsp = 2 * Math.PI * 7, zeta = 0.35; // (ressort : 7 Hz, amorti)
  function pullResponse(t) {
    // t : secondes réelles depuis le déclic (négatif avant)
    let y = 0, sx = 0, sz = 0;
    if (t > -cord.pull && t <= cord.hold) y = -cord.depth * sstep(-cord.pull, 0, t);
    else if (t > cord.hold) {
      const s = t - cord.hold;
      y = -cord.depth * Math.exp(-zeta * wsp * s) * Math.cos(wsp * Math.sqrt(1 - zeta * zeta) * s);
      const a = cord.swing * Math.exp(-s / tauS) * Math.sin(wp * s);
      sx = a * Math.cos(cord.dir); sz = a * Math.sin(cord.dir);
    }
    return { y, sx, sz };
  }
  // somme sur les deux tirages et leurs images d'une boucle à l'autre : la
  // réponse est périodique par construction (P secondes réelles par boucle)
  function cordAt(u) {
    const ph = u - Math.floor(u);
    const t = tauAt(ph);
    const out = { y: 0, sx: 0, sz: 0 };
    for (const t0 of [tEvent.on, tEvent.off]) {
      for (let n = -1; n <= 3; n++) {
        const r = pullResponse(t - t0 + n * P);
        out.y += r.y; out.sx += r.sx; out.sz += r.sz;
      }
    }
    return out;
  }

  // phase réelle ∈ [0, 1) : ce qui dérive en temps réel (boule, poussière) la
  // lit ; elle est figée pendant les ralentis
  const realPhase = (u) => { const ph = u - Math.floor(u); return tauAt(ph) / P; };

  return {
    T, K, P, frontSpeed, tEvent, tauAt, lam, rho, cordAt, realPhase, since,
    // vitesse du film (1 = temps réel) : pour la poussière et les courbes
    speed: (u) => Math.exp(lam(u - Math.floor(u))),
  };
}

// ── Caméra ──────────────────────────────────────────────────────────────────
// Un plan fixe qui respire : la caméra glisse lentement sur un arc et avance
// un peu pendant les ralentis (un travelling qui lit u, pas τ). Périodique en u.
export function cameraAt(C, u) {
  const ph = u - Math.floor(u);
  const tl = TIMELINE;
  // avancée douce pendant les deux temps de lumière, retour dans la nuit
  const push = sstep(tl.on.down, tl.on.end, ph) * (1 - sstep(tl.on.end, tl.off.down + 0.04, ph)) * 0.6
    + sstep(tl.off.down, tl.off.end, ph) * (1 - sstep(tl.off.end, 1, ph)) * 0.4;
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
