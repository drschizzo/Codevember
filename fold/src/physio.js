// Physiologie et temps : le signal, les pulvinus, le temps physique.
//
// Module pur (sans three.js), partagé par la scène, le worker et les tests.
//
// LE SIGNAL. Un stimulus (goutte, choc) déclenche un potentiel d'action qui
// court le long des faisceaux vasculaires, à vitesse finie (de l'ordre du
// cm/s), propre à chaque organe, plus vite quand il est fort, et s'atténue
// avec la distance parcourue.
// Sur le graphe de la plante (gen/plant.js), Dijkstra donne pour chaque nœud
// l'instant d'arrivée a (chemin le plus rapide) et l'amplitude
// A = S · exp(−Σ ℓ_e / λ_organe). Un pulvinus répond si A dépasse son seuil :
// les pulvinules des folioles d'abord (seuil bas), les pulvinus secondaires
// des pinnules ensuite, le pulvinus primaire du pétiole en dernier (seuil haut).
//
// LES PULVINUS. Un pulvinus qui perd sa turgescence se ferme vite (une
// fraction de seconde pour une foliole, une seconde pour une pinnule) ; le
// pétiole, privé de son appui, tombe sous son poids et rebondit (réponse
// indicielle d'un oscillateur amorti). Il reste fermé une à deux minutes,
// puis se regonfle en quelques minutes (sigmoïde). Avec plusieurs stimulus,
// l'état est le maximum des réponses : un pulvinus déjà fermé le reste.
//
// LE TEMPS. Le film lit le temps physique τ(t) = ∫ v : v = 1 pendant les
// chutes et les vagues de fermeture (temps réel), v = 1/k juste après chaque
// contact (caméra rapide, qui commence AU contact, jamais avant), v = V
// pendant les réouvertures (accéléré). Tout est fonction de τ modulo P (la
// durée physique de la boucle) : τ(t + T) = τ(t) + P, donc l'image à u = 1 est
// celle à u = 0, par construction.

const { exp, sin, cos, sqrt, max, min, log, abs, PI } = Math;

export const G = 98.1;                // pesanteur (u/s², 1 u = 10 cm)

// ── Signal ───────────────────────────────────────────────────────────────────
// vitesses (u/s) et longueurs d'atténuation (u) par organe : tige, pétiole,
// rachis, collet (voir ORGANS dans gen/plant.js)
export const SIGNAL = {
  speed: [0.55, 0.3, 0.2, 0.8],
  boost: 1.6, // (un signal fort court plus vite : v · (1 + boost · max(0, A − ½)))
  lambda: [1.8, 0.85, 0.6, 3.0],
  threshold: { leaflet: 0.2, pinna: 0.36, petiole: 0.56 },
};

// propagation depuis le nœud src (amplitude S) : instants d'arrivée (s) et
// amplitudes, Infinity / 0 là où le signal s'est éteint
export function propagate(graph, src, S, sig = SIGNAL) {
  const n = graph.nodes.length;
  if (!graph.adj) {
    const adj = Array.from({ length: n }, () => []);
    for (const [a, b, len, organ] of graph.edges) { adj[a].push([b, len, organ]); adj[b].push([a, len, organ]); }
    graph.adj = adj;
  }
  const arr = new Float64Array(n).fill(Infinity), amp = new Float64Array(n);
  arr[src] = 0; amp[src] = S;
  // tas binaire sur le temps d'arrivée
  const heap = [[0, src]];
  const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const floorA = sig.threshold.leaflet * 0.5; // (en dessous, le signal s'éteint)
  while (heap.length) {
    const [t, u] = pop();
    if (t > arr[u]) continue;
    for (const [v, len, organ] of graph.adj[u]) {
      const a = amp[u] * exp(-len / sig.lambda[organ]);
      if (a < floorA) continue;
      // (la vague ralentit en s'affaiblissant)
      const tv = t + len / (sig.speed[organ] * (1 + (sig.boost ?? 0) * max(0, amp[u] - 0.5)));
      if (tv < arr[v]) { arr[v] = tv; amp[v] = a; push([tv, v]); }
    }
  }
  return { arr, amp };
}

// ── Cinétique des pulvinus ───────────────────────────────────────────────────
// Δ : temps physique écoulé depuis l'arrivée du signal (s). Renvoie la part de
// fermeture (0 ouvert, 1 fermé ; le pétiole dépasse 1 en rebondissant).
export const KINETICS = {
  leaflet: { close: 0.55, hold: 95, reopen: 360 },
  pinna: { close: 1.3, hold: 100, reopen: 320 },
  // le pétiole tombe quand ses folioles sont fermées, et se relève avant
  // qu'elles ne se rouvrent (voir plan.js : délai du pulvinus primaire)
  petiole: { omega: 2 * PI * 1.25, zeta: 0.45, hold: 30, reopen: 120 },
};
// chaque famille a son tempo : la dionée claque (un cinquième de seconde) et
// reste fermée longtemps ; le trèfle se plie lentement, en parapluie
export const KINETICS_BY = {
  sensitive: KINETICS,
  biophytum: { ...KINETICS, leaflet: { close: 0.8, hold: 95, reopen: 360 } },
  oxalis: { leaflet: { close: 1.6, hold: 80, reopen: 300 }, pinna: { close: 2.6, hold: 80, reopen: 300 }, petiole: KINETICS.petiole },
  dionaea: { leaflet: { close: 0.2, hold: 160, reopen: 400 }, pinna: KINETICS.pinna, petiole: KINETICS.petiole },
};
export const kineticsOf = (family) => KINETICS_BY[family] ?? KINETICS;
const ss = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const sss = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10)); // (C²)
export function closeCurve(level, d, K = KINETICS) {
  if (!(d >= 0)) return 0;
  const k = K[level];
  let c;
  if (level === 'petiole') {
    // réponse indicielle d'un oscillateur sous-amorti : la feuille tombe,
    // dépasse sa position, remonte un peu, se pose
    const { omega: w, zeta: z } = k, wd = w * sqrt(1 - z * z);
    c = 1 - exp(-z * w * d) * (cos(wd * d) + (z / sqrt(1 - z * z)) * sin(wd * d));
  } else {
    // fermeture rapide au départ, qui se pose doucement (1 − (1 − x)³)
    const x = min(1, d / k.close);
    c = 1 - (1 - x) ** 3;
  }
  // réouverture : après la tenue, sigmoïde lente
  const r = sss((d - k.hold - closeDur(level, K)) / k.reopen);
  return c * (1 - r);
}
export const closeDur = (level, K = KINETICS) => (level === 'petiole' ? 4.5 : K[level].close);
export const lifetime = (level, K = KINETICS) => closeDur(level, K) + K[level].hold + K[level].reopen;

// ── Choc d'une goutte : la foliole et la pinnule plient, puis oscillent ─────
// (déplacement continu, vitesse initiale : un choc)
export function impactDip(d, A, f, zeta) {
  if (!(d >= 0)) return 0;
  const w = 2 * PI * f, wd = w * sqrt(1 - zeta * zeta);
  return A * exp(-zeta * w * d) * sin(wd * d) * (d < 6 ? 1 : 0);
}

// ── Carte du temps : film t ∈ [0, T] → temps physique τ ∈ [0, P] ─────────────
// windows : [{ a, b, slow }] fenêtres de temps réel en temps physique
// (a < contact ≤ b), « slow » = instant du contact (caméra rapide, ×k) ou null.
// ramp : durée physique des passages accéléré ↔ réel ; le facteur
// d'accélération V est ajusté pour que le film dure exactement T.
export function buildTimeMap({ P, T, windows, k = 8, slowDur = 0.14, ramp = 4, samples = 8192 }) {
  // lenteur s(τ) = dt/dτ (log-linéaire entre les régimes)
  const wReal = (tau) => {
    let w = 0;
    for (const W of windows) for (const sh of [-P, 0, P]) {
      const a = W.a + sh, b = W.b + sh;
      w = max(w, ss((tau - (a - ramp)) / ramp) * (1 - ss((tau - b) / ramp)));
    }
    return w;
  };
  // le pli lui-même, au ralenti (le cœur du film) : de la fin du choc à la
  // fin du geste, ×foldK
  const wFold = (tau) => {
    let w = 0;
    for (const W of windows) if (W.foldK > 1) for (const sh of [-P, 0, P]) {
      const c = W.slow + sh;
      w = max(w, ss((tau - c - 0.06) / 0.1) * (1 - ss((tau - c - W.foldDur) / 0.4)));
    }
    return w;
  };
  const wSlow = (tau) => {
    let w = 0;
    for (const W of windows) if (W.slow != null) for (const sh of [-P, 0, P]) {
      const c = W.slow + sh;
      // (part de 0 exactement au contact : montée en 12 ms, tenue, retour)
      w = max(w, ss((tau - c) / 0.012) * (1 - ss((tau - c - slowDur) / 0.09)));
    }
    return w;
  };
  // intégration fine : pas adapté au régime
  const integ = (V) => {
    const lnV = log(V), lnk = log(k);
    const taus = [0], ts = [0];
    let tau = 0, t = 0;
    const lnF = (tau) => { let m = 0; for (const W of windows) if (W.foldK > 1) m = max(m, log(W.foldK)); return m; };
    const lnFold = lnF();
    const slowness = (tau) => exp(-lnV * (1 - wReal(tau)) + max(lnk * wSlow(tau), lnFoldAt(tau)));
    const lnFoldAt = (tau) => { let m = 0; for (const W of windows) if (W.foldK > 1) for (const sh of [-P, 0, P]) { const c = W.slow + sh; const w = ss((tau - c - 0.06) / 0.1) * (1 - ss((tau - c - W.foldDur) / 0.4)); m = max(m, log(W.foldK) * w); } return m; };
    void lnFold;
    while (tau < P) {
      const wr = wReal(tau), ws = wSlow(tau);
      const lnS = -lnV * (1 - wr) + max(lnk * ws, lnFoldAt(tau));
      const sl = exp(lnS);
      // pas : ~1/400 s de film, ou 2 ms physiques près des contacts
      let h = min(0.0025 / sl, 0.5);
      if (ws > 0 || wr > 0.98) h = min(h, 0.004);
      h = min(h, P - tau);
      // trapèzes
      const tau2 = tau + h;
      const sl2 = slowness(tau2);
      t += 0.5 * (sl + sl2) * h;
      tau = tau2;
      taus.push(tau); ts.push(t);
    }
    return { taus, ts, total: t };
  };
  // V tel que la durée du film soit T (bissection en log)
  let lo = log(1.5), hi = log(5000), best = null;
  for (let i = 0; i < 40; i++) {
    const m = 0.5 * (lo + hi), r = integ(exp(m));
    best = { ...r, V: exp(m) };
    if (r.total > T) lo = m; else hi = m;
  }
  // rééchantillonnage uniforme en temps de film : τ(t)
  const { taus, ts } = best, scale = T / best.total;
  const tab = new Float64Array(samples + 1);
  let j = 0;
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * T;
    while (j + 1 < ts.length - 1 && ts[j + 1] * scale < t) j++;
    const t0 = ts[j] * scale, t1 = ts[j + 1] * scale;
    const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    tab[i] = taus[j] + (taus[j + 1] - taus[j]) * Math.max(0, Math.min(1, f));
  }
  tab[0] = 0; tab[samples] = P;
  const tauAt = (u) => {
    // u : phase déroulée (partie entière = boucles accomplies)
    const n = Math.floor(u), x = (u - n) * samples, i = Math.min(samples - 1, Math.floor(x)), f = x - i;
    return n * P + tab[i] + (tab[i + 1] - tab[i]) * f;
  };
  // lenteur (dt/dτ) en un instant : pour régler la caméra et le flou
  const speedAt = (u) => { const e = 1e-4; return (tauAt(u + e) - tauAt(u - e)) / (2 * e * T); };
  return { tauAt, speedAt, V: best.V, P, T, wReal, wSlow };
}

// ── Cause : la goutte ────────────────────────────────────────────────────────
// Une goutte de rayon r tombe verticalement, en chute libre, à partir du
// repos (détachement) ; son centre est sur l'axe (x, z) ; au contact (τc), son
// centre est à yc (premier point de contact avec la vraie surface : voir
// plan.js). Avant le détachement, elle grossit (accéléré) puis s'étire.
export function dropCenterY(tau, D) {
  const d = D.tc - tau; // temps avant le contact
  if (d <= 0) return D.yc;
  const tf = D.fall; // durée de la chute
  if (d >= tf) return D.yc + 0.5 * G * tf * tf; // (pendue à sa source)
  return D.yc + 0.5 * G * d * d;
}
// rayon apparent de la goutte pendue (elle grossit par condensation, ou au
// bec de la burette), 0 → r
export function dropGrowth(tau, D) {
  const d = D.tc - D.fall - tau; // temps avant le détachement
  if (d <= 0) return 1;
  return max(0, 1 - d / D.grow) ** (1 / 3); // volume ∝ temps (débit constant)
}

// ── Cause : le marteau de laboratoire ────────────────────────────────────────
// Bras pivotant, tiré par un électroaimant : accélération angulaire constante
// depuis la position haute, jusqu'au contact (angle θc, calculé sur la vraie
// géométrie du pot) ; rebond, puis retour amorti à la position haute.
export function hammerAngle(tau, Hm) {
  const d = tau - Hm.tc;
  if (d <= -Hm.strike) return Hm.rest;
  if (d <= 0) { const s = d + Hm.strike; return Hm.rest - 0.5 * Hm.acc * s * s; }
  // après le choc : vitesse de rebond e·ω, puis rappel critique vers le repos
  const w0 = Hm.acc * Hm.strike * 0.35, k = 9; // (s⁻¹)
  const x = Hm.rest - Hm.thetaC;
  return Hm.thetaC + x * (1 - exp(-k * d) * (1 + k * d)) + w0 * d * exp(-k * d);
}

// ── Évaporation (perles, terre mouillée) ─────────────────────────────────────
export const evap = (d, T) => (d < 0 ? 0 : sqrt(max(0, 1 - d / T)));
