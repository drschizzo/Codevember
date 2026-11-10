// Caméra du film : périodique, lisse, lente.
//
// Pour chaque événement, un plan (cible, azimut, élévation, distance) choisi
// dans plan.js : le contact de la goutte vu de profil, sans feuille entre la
// caméra et lui ; le marteau de profil, la plante entière. Pendant la
// fenêtre de temps réel, la caméra s'approche à peine (dolly de 4 %) ; dans
// l'accéléré qui suit, elle glisse vers le plan de l'événement suivant (le
// sens de rotation est choisi une fois, au plus court). Un balancement et
// un nombre entier de tours s'y ajoutent ; puis la trajectoire est lissée
// par un noyau gaussien périodique (σ ≈ 0,35 s). La pose à u = 1 est celle
// à u = 0.
//
// Module pur : testé dans Node (raccord, vitesse angulaire).
const { sin, cos, PI, exp, max, min, hypot, atan2, round } = Math;
const TAU = 2 * PI;
const sss = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10));

// film t (s) d'un instant physique τ (inversion de la carte du temps)
export function filmTime(tm, tau) {
  let lo = 0, hi = 1;
  const P = tm.P;
  tau = ((tau % P) + P) % P;
  for (let i = 0; i < 50; i++) { const m = 0.5 * (lo + hi); if (tm.tauAt(m) < tau) lo = m; else hi = m; }
  return 0.5 * (lo + hi) * tm.T;
}

// Azimut de la caméra : un tour par boucle, toujours dans le même sens ; on
// tourne lentement pendant les touchers (poids 0,3) et plus vite entre eux
// (poids 1). az(u) = az0 + rot · 2π · W(u) / W(1), W = ∫ poids.
export function azSchedule(tm, windows, az0, rot, N = 2048) {
  const T = tm.T;
  const wf = windows.map((W) => [filmTime(tm, W.a), filmTime(tm, W.b)]);
  const weight = (t) => {
    let inW = 0;
    for (const [a, b] of wf) for (const sh of [-T, 0, T]) {
      const x = t - sh;
      inW = max(inW, sss((x - (a - 1)) / 1) * (1 - sss((x - b) / 1.5)));
    }
    return 1 - 0.7 * inW;
  };
  const cum = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) cum[i + 1] = cum[i] + weight(((i + 0.5) / N) * T);
  const tot = cum[N];
  return (u) => {
    const n = Math.floor(u), x = (u - n) * N, i = Math.min(N - 1, Math.floor(x)), f = x - i;
    return az0 + rot * TAU * (n + (cum[i] + (cum[i + 1] - cum[i]) * f) / tot);
  };
}

export function buildCameraPath({ plan, tm, cam, guard, N = 2880 }) {
  const T = tm.T, ev = plan.events;
  const azAt = azSchedule(tm, plan.windows, plan.cam.az0, plan.cam.rot);
  const keys = ev.map((E, k) => {
    const W = plan.windows[k];
    return { ta: filmTime(tm, W.a), tb: filmTime(tm, W.b), tc: filmTime(tm, E.tc), v: E.view };
  });
  // cible, hauteur, distance : plan de chaque toucher (gros plan sur la cause,
  // puis recul sur ce qui se ferme), transitions douces entre deux touchers
  const startPose = (v) => (v.start ? { tgt: v.start.target, el: v.start.el, dist: v.start.dist } : { tgt: v.target, el: v.el, dist: v.dist });
  const mainPose = (v) => ({ tgt: v.target, el: v.el, dist: v.dist });
  const raw = (t) => {
    const n = keys.length;
    for (let k = 0; k < n; k++) {
      const A = keys[k], B = keys[(k + 1) % n];
      const ta = A.ta, tbA = A.tb;
      let tB = B.ta; if (tB <= tbA) tB += T;
      let tt = t; if (tt < ta) tt += T;
      if (tt >= ta && tt <= tbA) {
        let tc = A.tc; if (tc < ta) tc += T;
        // (la caméra recule d'abord, puis la cible glisse : elle ne frôle rien)
        const x = (tt - tc - 0.35) / 2.6, a = startPose(A.v), m = mainPose(A.v), gd = sss(x * 1.6), gt = sss(x);
        return { tgt: lerp3(a.tgt, m.tgt, gt), el: a.el + (m.el - a.el) * gd, dist: a.dist * (1 - gd) + m.dist * gd };
      }
      if (tt > tbA && tt < tB) {
        const f = sss((tt - tbA) / (tB - tbA));
        const a = mainPose(A.v), b = startPose(B.v);
        return { tgt: lerp3(a.tgt, b.tgt, f), el: a.el + (b.el - a.el) * f, dist: a.dist * (1 - f) + b.dist * f };
      }
    }
    return mainPose(keys[0].v);
  };
  // la caméra ne doit entrer ni dans la cloche ni sous la table : on calcule,
  // pour chaque échantillon, la plus petite distance qui la garde dehors
  // (dichotomie, une fonction continue des paramètres) — jamais un
  // ajustement par paliers image par image, qui la ferait sauter
  const poseAt = (ph, tgt, el, dist) => {
    const azm = azAt(ph) + cam.sway * sin(TAU * ph), e = el + cam.sway * 0.4 * sin(2 * TAU * ph + 1);
    const dir = [cos(azm) * cos(e), sin(e), sin(azm) * cos(e)];
    return [tgt[0] + dir[0] * dist, tgt[1] + dir[1] * dist, tgt[2] + dir[2] * dist];
  };
  const S = [], need = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const ph = i / N, p = raw(ph * T);
    S.push([p.tgt[0], p.tgt[1], p.tgt[2], p.el, p.dist]);
    if (guard) {
      // (distance minimale hors de la cloche dans cette direction : continue,
      // définie partout — pas seulement quand la caméra serait dedans)
      let hi = 0.3;
      for (let k = 0; k < 60 && !guard(poseAt(ph, p.tgt, p.el, hi)); k++) hi *= 1.08;
      let lo = 0.2;
      if (guard(poseAt(ph, p.tgt, p.el, lo))) hi = lo;
      else for (let k = 0; k < 30; k++) { const m = 0.5 * (lo + hi); if (guard(poseAt(ph, p.tgt, p.el, m))) hi = m; else lo = m; }
      need[i] = hi;
    }
  }
  const needS = need;
  // lissage gaussien périodique (σ = 0,8 s)
  const sig = (0.8 / T) * N, R = Math.ceil(sig * 3);
  const w = Array.from({ length: 2 * R + 1 }, (_, j) => exp(-0.5 * ((j - R) / sig) ** 2));
  const ws = w.reduce((a, b) => a + b, 0);
  const Sm = S.map((_, i) => {
    const o = [0, 0, 0, 0, 0];
    for (let j = -R; j <= R; j++) { const q = S[(i + j + N) % N], wj = w[j + R] / ws; for (let c = 0; c < 5; c++) o[c] += q[c] * wj; }
    return o;
  });
  return function at(u) {
    const ph = u - Math.floor(u), x = ph * N, i = Math.floor(x) % N, f = x - Math.floor(x);
    // (Catmull-Rom : vitesse continue d'un échantillon à l'autre)
    const p0 = Sm[(i - 1 + N) % N], p1 = Sm[i], p2 = Sm[(i + 1) % N], p3 = Sm[(i + 2) % N];
    const cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (3 * b - a - 3 * c + d) * f * f * f);
    const q = p1.map((_, c) => cr(p0[c], p1[c], p2[c], p3[c]));
    const azm = azAt(ph) + cam.sway * sin(TAU * ph);
    const el = q[3] + cam.sway * 0.4 * sin(2 * TAU * ph + 1);
    const nd = cr(needS[(i - 1 + N) % N], needS[i], needS[(i + 1) % N], needS[(i + 2) % N]) * 1.03;
    // (plancher continu, maximum adouci : pas de coude quand il prend le relais)
    const k = 0.04, dist = 0.5 * (q[4] + nd + Math.sqrt((q[4] - nd) ** 2 + k * k));
    const tgt = [q[0], q[1], q[2]];
    const dir = [cos(azm) * cos(el), sin(el), sin(azm) * cos(el)];
    const pos = [tgt[0] + dir[0] * dist, tgt[1] + dir[1] * dist, tgt[2] + dir[2] * dist];
    return { pos, tgt, fov: cam.fov, dist };
  };
}
const lerp3 = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
