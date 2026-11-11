// L'horloge du film — fonctions pures (Node et navigateur).
//
// Une seule horloge règle tout : le temps physique de l'eau P(t), dont la
// vitesse descend à la caméra rapide autour de chaque dessin ; les dessins
// (leur temps propre τⱼ et leur fenêtre Wⱼ) ; la ride de fond (lue au même
// temps physique : elle ralentit avec le reste) ; les familles Faraday et
// Kármán ; la caméra. Tout ne dépend que de la recette et de la phase u.
//
// Ralenti : v(t) = vn − (vn − vmin)·b((t − tⱼ)/w), b(x) = (1 − x²)³ ;
// ∫b = w·B, B(x) = x − x³ + 3x⁵/5 − x⁷/7 (B(±1) = ±16/35) : forme fermée.

export const B7 = (x) => {
  if (x >= 1) return 16 / 35;
  if (x <= -1) return -16 / 35;
  const x2 = x * x;
  return x * (1 - x2 + (3 / 5) * x2 * x2 - (x2 * x2 * x2) / 7);
};
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ── Foyer : des dessins qui se forment par convergence ─────────────────────
// R.loop.duration = T (s de film) ; R.foyer.slow = { vn, vmin, w }
export function foyerClock(R) {
  const T = R.loop.duration;
  const n = R.foyer.events.length;
  const { vn, vmin, w } = R.foyer.slow;
  const tj = R.foyer.events.map((_, j) => ((j + 0.5) / n) * T);
  const slot = T / n;
  // P(t) : temps physique cumulé depuis t = 0 (t ∈ [0, T])
  const P = (t) => {
    let s = vn * t;
    for (const c of tj) s -= (vn - vmin) * w * (B7((t - c) / w) - B7(-c / w));
    return s;
  };
  const total = P(T);
  return {
    T, total, slot, tj,
    phys: (u) => P((u - Math.floor(u)) * T),
    speed: (u) => {
      const t = (u - Math.floor(u)) * T;
      let v = vn;
      for (const c of tj) { const x = (t - c) / w; if (Math.abs(x) < 1) v -= (vn - vmin) * (1 - x * x) ** 3; }
      return v;
    },
    // état de chaque dessin : { tau (s physiques depuis la focalisation), w (fenêtre), dt (s de film) }
    events(u) {
      const t = (u - Math.floor(u)) * T, Pt = P(t);
      return tj.map((c) => {
        let dt = t - c, tau = Pt - P(c);
        if (dt > T / 2) { dt -= T; tau -= total; } else if (dt < -T / 2) { dt += T; tau += total; }
        const a = Math.abs(dt);
        const win = 1 - sstep(R.foyer.fade[0] * slot / 2, R.foyer.fade[1] * slot / 2, a);
        return { tau, w: win, dt };
      });
    },
  };
}

// ── Faraday : un cristal de lumière stationnaire ────────────────────────────
// Le forçage monte (le moteur de l'excitateur accélère), le réseau naît au
// centre et s'étend ; un second réseau naît sur un bord et gagne ; le
// forçage retombe, tout s'éteint. L'onde oscille à Ω/2 ; le stroboscope,
// légèrement désaccordé, la montre battre lentement (nombre entier de
// battements par boucle).
export function faradayState(R, u) {
  const F = R.faraday, ph = u - Math.floor(u);
  const [a0, a1, d0, d1] = F.ramp; // montée, plein, descente
  const drive = sstep(a0, a1, ph) * (1 - sstep(d0, d1, ph));
  // fronts : rayon du premier réseau, puis du second
  const r1 = F.reach * sstep(F.grow[0], F.grow[1], ph);
  const r2 = F.reach * 1.4 * sstep(F.invade[0], F.invade[1], ph);
  const beat = Math.cos(2 * Math.PI * F.beats * ph + F.beatPhase);
  return { drive, r1, r2, beat, ph };
}

// ── Kármán : une allée de tourbillons ───────────────────────────────────────
// Tourbillons émis à période fixe (nombre entier par boucle), alternés de part
// et d'autre du poteau, emportés par le courant, qui grandissent puis
// s'usent. Renvoie [x, z, profondeur de la fossette (m), rayon du cœur (m)].
export function karmanVortices(R, u) {
  const K = R.karman, T = R.loop.duration, ph = u - Math.floor(u);
  const n = K.emissions; // par boucle
  const P = T / n; // s de film entre deux émissions
  const out = [];
  for (let i = 0; i < n; i++) {
    // âge (s de film) du tourbillon i, et de ses copies des boucles précédentes
    let age = (ph * T - i * P) % T;
    if (age < 0) age += T;
    for (let k = 0; k < 2; k++, age += T) {
      if (age > K.life) break;
      const x = K.post[0] + K.radius * 1.6 + K.speed * age;
      if (x > K.xEnd + 0.06) continue;
      const side = i % 2 ? 1 : -1;
      // l'allée s'élargit doucement vers l'aval
      const z = K.post[1] + side * (K.radius * 0.5 + K.spread * Math.min(1, age / (2 * P)) * 0.5 + 0.02 * age / K.life);
      const grow = sstep(0, 0.6 * P, age);
      const fade = 1 - sstep(K.life * 0.55, K.life, age);
      const outFade = 1 - sstep(K.xEnd - 0.06, K.xEnd + 0.04, x);
      const core = Math.sqrt(K.core * K.core + K.diffuse * age);
      out.push([x, z, side * 0 + K.depth * grow * fade * outFade * (K.core / core) ** 1.2, core]);
    }
  }
  return out;
}

// ── Caméra : périodique, lente, lisse ──────────────────────────────────────
// Pose = fonction de u ; une respiration vers le dessin pendant chaque
// ralenti (foyer), sinon un lent balancement latéral.
export function cameraPose(R, u, clock = null) {
  const C = R.camera, ph = u - Math.floor(u);
  const TAU = Math.PI * 2;
  // balancement : un aller et retour par boucle (azimut), une respiration en hauteur
  const az = C.az + C.sway * Math.sin(TAU * ph + C.swayPhase);
  // près d'un dessin (gaussienne de son instant) : la caméra s'avance et
  // regarde le fond ; loin de tout dessin : elle remonte vers la surface
  let near = 0;
  if (clock && R.family === 'foyer') {
    for (const e of clock.events(u)) near += Math.exp(-(e.dt * e.dt) / (2 * C.pushWidth * C.pushWidth));
  }
  near = Math.min(1, near);
  const dist = C.dist * (1 - C.push * near);
  const el = C.el + C.bob * Math.sin(TAU * 2 * ph + 0.7);
  const t = [C.target[0], C.target[1] + (C.rise || 0) * (1 - near), C.target[2]];
  const pos = [t[0] + Math.sin(az) * Math.cos(el) * dist, t[1] + Math.sin(el) * dist, t[2] + Math.cos(az) * Math.cos(el) * dist];
  return { pos, target: t, fov: C.fov };
}
