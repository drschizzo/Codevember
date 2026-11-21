// Le temps du film et le temps physique (module pur).
//
// Une boucle dure P secondes physiques (quelques heures) : la coulée en occupe
// un quart d'heure, le refroidissement le reste. Le film les montre à deux
// vitesses, comme une caméra en accéléré qu'on règle (« speed ramp ») :
// lentement pendant le bourgeonnement, très vite pendant le refroidissement.
// τ(u) est l'intégrale d'une vitesse lisse et périodique ; τ(u + 1) = τ(u) + P.
//
// u0, u1 : début et fin de la coulée dans la boucle ; t = 0 au début de la
// coulée (première percée), tFlow = fin du dernier orteil.
// shape (facultatif) : courbe monotone [0, 1] → [0, 1] (K + 1 valeurs) qui
// redistribue le temps de la coulée dans sa fenêtre — l'accéléré ralentit
// quand beaucoup de lave arrive à l'image, accélère pendant les accalmies.
export function makeTimeline({ P, tFlow, u0 = 0.08, u1 = 0.68, ramp = 0.06, n = 2048, lead = 0, shape = null }) {
  // vitesse relative : 1 pendant la coulée, k dehors, raccords en cosinus
  const w = (u) => {
    const d0 = u - u0, d1 = u1 - u;
    // (les raccords sont hors de la fenêtre : toute la coulée, percée comprise, est au ralenti)
    const a = Math.min(1, Math.max(0, (d0 + ramp) / ramp)), b = Math.min(1, Math.max(0, (d1 + ramp) / ramp));
    const s = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
    return 1 - s(a) * s(b); // 0 dans la coulée, 1 ailleurs
  };
  // k tel que la coulée (tFlow + lead) tienne dans [u0, u1] et la boucle dure P
  const span = tFlow + lead;
  // intégrales des poids sur la boucle et sur la fenêtre de la coulée
  let I0 = 0, I1 = 0, J0 = 0, J1 = 0;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, x = w(u);
    I0 += (1 - x) / n; I1 += x / n;
    if (u >= u0 && u <= u1) { J0 += (1 - x) / n; J1 += x / n; }
  }
  // r·(J0 + k J1) = span ; r·(I0 + k I1) = P
  const k = (P * J0 - span * I0) / (span * I1 - P * J1);
  const r = span / (J0 + k * J1);
  const tab = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { const u = (i + 0.5) / n; tab[i + 1] = tab[i] + (r * ((1 - w(u)) + k * w(u))) / n; }
  // origine : t = −lead au début de la coulée
  const at0 = (u) => { const x = u * n, i = Math.min(n - 1, Math.floor(x)); return tab[i] + (tab[i + 1] - tab[i]) * (x - i); };
  const off = at0(u0) + lead;
  return {
    P, k, r, u0, u1,
    // temps physique (s) à la phase u (déroulée) ; continu, τ(u + 1) = τ(u) + P
    tau(u) {
      const f = Math.floor(u);
      let t = at0(u - f) - off;
      if (shape && t > 0 && t < tFlow) {
        const K = shape.length - 1, x = (t / tFlow) * K, i = Math.min(K - 1, Math.floor(x));
        t = (shape[i] + (shape[i + 1] - shape[i]) * (x - i)) * tFlow;
      }
      return f * P + t;
    },
    // vitesse du film (s physiques par seconde de film, pour une boucle de D s)
    rate(u, D) { const f = u - Math.floor(u); return (r * ((1 - w(f)) + k * w(f))) / D; },
  };
}
