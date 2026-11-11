// Le cycle d'une étape, en formules : la même chorégraphie est écrite ici (JS :
// tests, fracture) et dans le vertex shader (scene/glass.js). Toute
// modification doit être faite des deux côtés ; test/recipe.test.mjs vérifie
// leur accord sur des valeurs de référence.
//
// Temps : une étape dure Ts secondes de film ; ℓ est le temps local de
// l'étape (0 : le soufflage commence). La pièce k vit dans
// ℓ_k = mod(t − k·Ts, N·Ts).
//
// Physique : unités de la scène (une pièce mesure 2 : 1 unité ≈ 12,5 cm), g
// vraie. Le film tourne au temps réel, sauf autour de la rupture (caméra
// rapide : la vitesse descend à 1/k puis remonte, le temps physique est
// l'intégrale de cette vitesse) et pendant le soufflage, le refroidissement et
// la refonte (accéléré, assumé : ces processus durent des minutes).

export const PH = {
  acc: 0.18,        // soufflage (la paraison monte du bain et prend forme)
  cool: 0.22,       // refroidissement d'un point de la paroi
  spinStop: [0.28, 0.4], // le plateau ralentit et s'arrête avant la rupture
  rupture: 0.5,     // instant du choc
  melt: 0.82,       // la sole chauffe, les éclats commencent à fondre
  meltSpan: 0.06,   // (les plus proches du centre d'abord)
  meltDur: 0.1,     // durée de la fonte d'un éclat
};

export const GRAV = 78;     // u/s² (9,81 m/s² à 12,5 cm l'unité)
// sole en cuvette : y = DISH_H·(1 − exp(−r²/DISH_W²)) — au centre ≈ 0,029·r², plate
// au-delà de ~6 (le cyclorama commence plus loin)
export const DISH_H = 0.3, DISH_W = 3.2;
export const DISH = DISH_H / (DISH_W * DISH_W); // (courbure au centre)
export const MU = 0.45;     // frottement des éclats sur la sole
export const BOUNCE = 0.22; // restitution du choc sur la sole
export const floorH = (r) => DISH_H * (1 - Math.exp(-(r * r) / (DISH_W * DISH_W)));
// normale de la sole en (x, z)
export const floorN = (x, z) => {
  const k = ((DISH_H * 2) / (DISH_W * DISH_W)) * Math.exp(-(x * x + z * z) / (DISH_W * DISH_W));
  const n = [-k * x, 1, -k * z], l = Math.hypot(n[0], n[1], n[2]);
  return [n[0] / l, n[1] / l, n[2] / l];
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const G = (u) => u * u * u - (u * u * u * u) / 2; // ∫ smoothstep

// ── Vitesse du film autour de la rupture (caméra rapide) ─────────────────────
// slow : { k (ralenti), pre (s avant le choc), plat (s après), post (retour) }
export function physTime(l, Ts, slow) {
  // (la vitesse tombe en 0,12 s, à partir de t0 − pre − 0,12 : avec pre < 0, le
  // choc a lieu presque en temps réel et le ralenti prend le relais aussitôt —
  // un outil qui s'approche au ralenti semble toucher avant que le verre casse)
  const t0 = PH.rupture * Ts, rin = 0.12;
  const A = t0 - slow.pre - rin, B = t0 + slow.plat;
  const I = rin * G(clamp01((l - A) / rin)) + Math.min(Math.max(l - (A + rin), 0), B - (A + rin)) + slow.post * (clamp01((l - B) / slow.post) - G(clamp01((l - B) / slow.post)));
  return l - (1 - 1 / slow.k) * I;
}

// angle du plateau : il tourne pendant le soufflage, ralentit, s'arrête
export function spinAngle(form, l, Ts) {
  const a = PH.spinStop[0] * Ts, b = PH.spinStop[1] * Ts, u = clamp01((l - a) / (b - a));
  return form.angle0 + form.spin * (Math.min(l, a) + (b - a) * (u - G(u)));
}
export const rotY = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]]; };

const rod = (v, a, th) => {
  const c = Math.cos(th), s = Math.sin(th), d = a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
  const x = [a[1] * v[2] - a[2] * v[1], a[2] * v[0] - a[0] * v[2], a[0] * v[1] - a[1] * v[0]];
  return [v[0] * c + x[0] * s + a[0] * d * (1 - c), v[1] * c + x[1] * s + a[1] * d * (1 - c), v[2] * c + x[2] * s + a[2] * d * (1 - c)];
};
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// instant (physique, depuis la libération) où le centre de l'éclat touche la
// sole : deux itérations sur la cuvette
export function landing(F, rest) {
  // (≥ 0 : un éclat du pied, déjà posé, « atterrit » aussitôt)
  const solve = (h) => Math.max(0, (F.v[1] + Math.sqrt(Math.max(0, F.v[1] * F.v[1] + 2 * GRAV * (F.c[1] - h)))) / GRAV);
  let tau = solve(rest);
  for (let i = 0; i < 2; i++) {
    const x = F.c[0] + F.v[0] * tau, z = F.c[2] + F.v[2] * tau;
    tau = solve(floorH(Math.hypot(x, z)) + rest);
  }
  return tau;
}

// centre de l'éclat au temps physique τ depuis sa libération (vol, choc,
// rebond, glissement) ; renvoie aussi le temps écoulé depuis le choc
export function fragmentCenter(F, tau, rest) {
  const tL = landing(F, rest);
  if (tau <= tL) return { c: [F.c[0] + F.v[0] * tau, F.c[1] + F.v[1] * tau - 0.5 * GRAV * tau * tau, F.c[2] + F.v[2] * tau], s2: -1, tL };
  const s2 = tau - tL;
  const xL = F.c[0] + F.v[0] * tL, zL = F.c[2] + F.v[2] * tL;
  const vx = F.v[0] * 0.3, vz = F.v[2] * 0.3, vh = Math.hypot(vx, vz), ts = vh / (MU * GRAV) + 1e-6;
  const s = Math.min(s2, ts), d = s - (s * s) / (2 * ts);
  const x = xL + vx * d, z = zL + vz * d;
  const vimp = Math.abs(F.v[1] - GRAV * tL), vb = BOUNCE * vimp;
  const yb = Math.max(0, vb * s2 - 0.5 * GRAV * s2 * s2);
  return { c: [x, floorH(Math.hypot(x, z)) + rest + yb, z], s2, tL };
}

// un point p (repère de la pièce, au repos) d'un éclat F, au temps ℓ
// F : { c, v, axis, w, tc, tm, n } ; opts : { Ts, slow, rest }
export function fragmentPoint(F, p, l, { Ts, slow, rest: rest0, clampFloor = true }) {
  const rest = F.sup ?? rest0; // (hauteur du centre au repos : position stable de l'éclat)
  const tau = Math.max(0, physTime(l, Ts, slow) - physTime(F.tc, Ts, slow));
  const { c, s2, tL } = fragmentCenter(F, tau, rest);
  const th = F.w * (s2 < 0 ? tau : tL + 0.004 * (1 - Math.exp(-s2 / 0.05)));
  let q = rod([p[0] - F.c[0], p[1] - F.c[1], p[2] - F.c[2]], F.axis, th);
  // une fois au sol, l'éclat bascule dans sa position stable : sa direction d
  // vient contre la sole (selon la normale de la cuvette à cet endroit)
  if (s2 > 0) {
    const n = rod(F.d ?? F.n, F.axis, th), nf = floorN(c[0], c[2]), t = [-nf[0], -nf[1], -nf[2]];
    let ax = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
    const la = Math.hypot(ax[0], ax[1], ax[2]);
    ax = la > 1e-6 ? [ax[0] / la, ax[1] / la, ax[2] / la] : [1, 0, 0];
    const ang = Math.acos(Math.max(-1, Math.min(1, n[0] * t[0] + n[1] * t[1] + n[2] * t[2]))) * Math.min(1, s2 / 0.07);
    if (ang > 1e-6) q = rod(q, ax, ang);
  }
  // refonte : l'éclat s'affaisse, s'étale et coule vers le centre de la cuvette
  const m = clamp01((l - F.tm) / (PH.meltDur * Ts)), flow = 1 - 0.97 * (m * m * (3 - 2 * m));
  q = [q[0] * (1 - 0.4 * m), q[1] * (1 - 0.9 * m), q[2] * (1 - 0.4 * m)];
  const x = c[0] * flow + q[0], z = c[2] * flow + q[2];
  const y = clampFloor ? Math.max(c[1] + q[1], floorH(Math.hypot(x, z)) + 0.002) : c[1] + q[1];
  return [x, y, z];
}

// soufflage : un point de paramètre a (abscisse du profil) quitte le bain et
// rejoint sa place ; renvoie le facteur d'avancement g (0 : dans le bain)
export function inflation(a, l, Ts) {
  const prog = l / (PH.acc * Ts), lo = a * 0.55;
  const u = clamp01((prog - lo) / 0.45);
  return u * u * (3 - 2 * u);
}
