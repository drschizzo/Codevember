// Le motif d'une plume, déposé pendant sa croissance (Prum et Williamson 2002,
// « Reaction-diffusion models of within-feather pigmentation patterning »,
// simplifié).
//
// Le pigment est déposé dans le COLLIER du follicule, un anneau de cellules à
// la base du tube : ce qui sort du collier au temps τ se retrouve, une fois
// la plume déroulée, à la hauteur z = 1 − τ (la pointe est formée en
// premier). On simule donc une réaction-diffusion activateur-inhibiteur
// (Gierer-Meinhardt avec saturation) sur l'anneau x ∈ [−1, 1) (périodique :
// x = 0 est le rachis, x = ±1 la ligne postérieure où le tube s'ouvre), et
// chaque pas de temps écrit une rangée du plan déroulé. Le temps devient la
// longueur :
//   - une oscillation homogène en temps → des barres ;
//   - une oscillation dont la phase avance près du rachis → des chevrons ;
//   - une instabilité de Turing sur l'anneau → des taches, des rangées de
//     points, des vermiculures si le motif dérive ;
//   - une source au rachis pendant une fenêtre de temps → une flammèche, un
//     ocelle (anneaux concentriques quand la source oscille).
//
// Module pur (sans three.js) : worker, écran de chargement, tests.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// hachage déterministe (pas de Math.random : la graine fait tout)
function mulberry(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 3432918353), h = (h << 13) | (h >>> 19);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// Programmes du collier : paramètres de la réaction-diffusion et forçages.
//   Da, Dh : diffusion (en largeur d'anneau² par unité de temps)
//   ra : production ; ma, mh : dégradation ; k : saturation ; s0 : production de base
//   osc : modulation périodique de la production (période en part de plume)
//   grad : production plus forte près du rachis
//   slant : collier oblique — le rachis sort plus tard que le
//           bord (en part de plume) : les barres deviennent des chevrons
//           dont la pointe regarde la pointe de la plume
//   src : source au rachis [centre en τ, demi-largeur en τ, intensité, largeur en x]
export const PROGRAMS = {
  // barres : système oscillant, l'inhibiteur est lent (mh < ma)
  bars:     { Da: 0.0004, Dh: 0.004, ra: 1.0, ma: 1.0, mh: 0.55, k: 0.0, s0: 0.03, osc: 0, grad: 0, noise: 0.02, tau: 64 },
  chevrons: { Da: 0.0004, Dh: 0.004, ra: 1.0, ma: 1.0, mh: 0.55, k: 0.0, s0: 0.03, osc: 0, grad: 0, noise: 0.02, tau: 56, slant: 0.16 },
  // taches : Turing sur l'anneau (inhibiteur rapide et diffusant), production pulsée
  spots:    { Da: 0.0004, Dh: 0.03, ra: 1.0, ma: 1.0, mh: 1.6, k: 0.25, s0: 0.0, osc: 0.16, grad: 0, noise: 0.08, tau: 30 },
  // vermiculures : Turing fin, qui dérive (production qui varie lentement)
  streaks:  { Da: 0.00015, Dh: 0.01, ra: 1.0, ma: 1.0, mh: 1.4, k: 0.1, s0: 0.01, osc: 0.045, grad: 0.3, noise: 0.25, tau: 34, drift: 1 },
  // flammèche : une source au rachis dans la seconde moitié de la croissance
  shaft:    { Da: 0.0004, Dh: 0.01, ra: 1.0, ma: 1.0, mh: 1.4, k: 0.6, s0: 0.0, osc: 0, grad: 0, noise: 0.02, tau: 18, src: [0.55, 0.4, 0.5, 0.12] },
  plain:    { Da: 0.001, Dh: 0.01, ra: 1.0, ma: 1.0, mh: 1.4, k: 0.6, s0: 0.0, osc: 0, grad: 0, noise: 0.0, tau: 10 },
};

// Simule le collier. Rend un champ « a » (activateur = pigment) de nx × nz,
// rangée 0 = base de la plume (z = 0), rangée nz − 1 = pointe ; colonne 0 :
// x = −1. onRow(j, row) est appelé à chaque rangée déposée (écran de chargement).
export function simulateCollar(program, seed, { nx = 128, nz = 192, onRow = null, steps = 10 } = {}) {
  const P = typeof program === 'string' ? PROGRAMS[program] : program;
  const rnd = mulberry(`collar:${seed}`);
  const a = new Float32Array(nx), h = new Float32Array(nx), a2 = new Float32Array(nx), h2 = new Float32Array(nx);
  // (collier oblique : on garde des rangées d'avance, lues en biais à la fin)
  const extra = Math.ceil((P.slant ?? 0) * nz) + 1, nh = nz + extra;
  const hist = new Float32Array(nx * nh);
  const out = new Float32Array(nx * nz);
  const dx = 2 / nx;
  // état initial : équilibre perturbé
  for (let i = 0; i < nx; i++) { a[i] = 0.6 + 0.2 * rnd(); h[i] = 0.5 + 0.1 * rnd(); }
  const T = P.tau; // durée de la croissance, en unités de temps de la réaction
  const dt = Math.min(0.02, 0.2 * dx * dx / Math.max(P.Da, P.Dh, 1e-6));
  const nsteps = Math.ceil(T / dt);
  const phase0 = rnd() * 6.283;
  const fx = Array.from({ length: nx }, (_, i) => -1 + (i + 0.5) * dx);
  // (la région près du rachis produit plus tôt : chevrons ; l'ocelle a sa propre géométrie)
  let row = 0;
  const warm = Math.ceil(2 / dt); // (le collier a déjà fonctionné avant la pointe)
  for (let n = -warm; n < nsteps; n++) {
    const tau = Math.max(0, n) / nsteps; // 0 : pointe, 1 : base
    for (let i = 0; i < nx; i++) {
      const im = (i + nx - 1) % nx, ip = (i + 1) % nx, x = fx[i];
      const lapA = (a[im] - 2 * a[i] + a[ip]) / (dx * dx), lapH = (h[im] - 2 * h[i] + h[ip]) / (dx * dx);
      // production : de base, modulée (taches pulsées), avancée près du rachis (chevrons)
      let r = P.ra * (1 + P.grad * (1 - Math.abs(x)) * 0.5);
      if (P.osc) r *= 1 + 0.35 * Math.sin((tau * 6.283) / P.osc + phase0 + (P.drift ? 3 * x : 0));
      let src = P.s0;
      if (P.src) {
        const [c, w, s, wx] = P.src;
        const gt = Math.exp(-(((tau - c) / w) ** 2));
        const gx = wx > 0 ? Math.exp(-((x / wx) ** 2)) : 1;
        src += s * gt * gx;
      }
      const a_ = a[i], h_ = Math.max(h[i], 1e-3);
      const prod = (r * a_ * a_) / (h_ * (1 + P.k * a_ * a_));
      a2[i] = a_ + dt * (P.Da * lapA + prod - P.ma * a_ + src + P.noise * (rnd() - 0.5));
      h2[i] = h_ + dt * (P.Dh * lapH + r * a_ * a_ - P.mh * h_);
      if (!(a2[i] >= 0)) a2[i] = 0;
      if (a2[i] > 8) a2[i] = 8;
    }
    a.set(a2); h.set(h2);
    if (n < 0) continue;
    // une rangée par part de croissance : z = 1 − τ
    const want = Math.floor(((n + 1) / nsteps) * nh);
    while (row < want && row < nh) {
      for (let i = 0; i < nx; i++) hist[row * nx + i] = a[i];
      // rangée déposée j = nz − 1 − r : la colonne x lit l'instant r + slant·(1 − |x|)
      const r = row - extra;
      if (r >= 0) {
        const j = nz - 1 - r;
        for (let i = 0; i < nx; i++) {
          const q = Math.min(nh - 1, r + (P.slant ?? 0) * nz * (1 - Math.abs(fx[i])));
          const q0 = Math.floor(q), f = q - q0, q1 = Math.min(nh - 1, q0 + 1);
          out[j * nx + i] = hist[q0 * nx + i] * (1 - f) + hist[q1 * nx + i] * f;
        }
        onRow?.(j, out.subarray(j * nx, j * nx + nx));
      }
      row++;
    }
  }
  return out;
}

// L'ocelle (paon) ne se lit qu'en deux dimensions : anneaux concentriques
// autour d'un centre sur le rachis, déformés comme dans un vrai œil (le cœur
// réniforme, la pupille plus près de la pointe). Les anneaux viennent de la
// même source oscillante, vue en (x, z) : r = distance au centre en unités de
// croissance.
export function eyeField(x, z, cz = 0.82, rx = 0.62, rz = 0.13) {
  const dx = x / rx, dz = (z - cz) / rz;
  const r = Math.sqrt(dx * dx + dz * dz * (dz > 0 ? 1.15 : 0.9));
  return r;
}

// Normalise le champ simulé en pigment 0–1 (seuil adouci autour de la
// médiane, pour que la moitié environ du motif soit sombre).
export function normalizePattern(field, cover = 0.45) {
  const s = Float32Array.from(field).sort();
  const thr = s[Math.floor((1 - cover) * (s.length - 1))];
  const lo = s[Math.floor(0.05 * (s.length - 1))], hi = s[Math.floor(0.98 * (s.length - 1))];
  const w = Math.max(1e-4, (hi - lo) * 0.12);
  return field.map((v) => sstep(thr - w, thr + w, v));
}

// Texture complète d'une plume (RGBA8, nx × nz, en coordonnées du vexille
// déroulé : x ∈ [−1, 1] de bord à bord, z ∈ [0, 1] de la base à la pointe) :
//   R : mélanine du motif (0–1)
//   G : anneaux de l'ocelle (indice 0–1) ou liseré du bord
//   B : masque structural (irisation, bleu)
//   A : réserve de blanc (zones sans pigment : sous z0, s'effaçant jusqu'à z1)
// spec : { program, cover, eye, margin, structural: [z0, z1], white: [z0, z1] }
export function featherTexture(spec, seed, { nx = 128, nz = 192, onRow = null } = {}) {
  const prog = spec.program ?? 'plain';
  let field;
  if (prog === 'plain') field = new Float32Array(nx * nz);
  else field = normalizePattern(simulateCollar(prog, seed, { nx, nz, onRow }), spec.cover ?? 0.45);
  const px = new Uint8Array(nx * nz * 4);
  for (let j = 0; j < nz; j++) {
    const z = (j + 0.5) / nz;
    for (let i = 0; i < nx; i++) {
      const x = -1 + ((i + 0.5) / nx) * 2, o = (j * nx + i) * 4;
      let m = field[j * nx + i], g = 0, b = 0, w = 0;
      if (spec.eye) {
        const r = eyeField(x, z, spec.eye[0], spec.eye[1], spec.eye[2]);
        g = clamp(1 - r, 0, 1); // (0 hors de l'œil, 1 au centre)
        m *= sstep(0.95, 1.25, r); // (pas de barres dans l'œil)
      }
      if (spec.margin) { const e = 1 - Math.abs(x); g = Math.max(g, sstep(spec.margin * 1.4, spec.margin * 0.6, e)); }
      if (spec.structural) b = sstep(spec.structural[0], spec.structural[1], z);
      if (spec.white) w = sstep(spec.white[1], spec.white[0], z) * (spec.whiteEdge ? sstep(0.4, 0.9, Math.abs(x)) : 1);
      px[o] = Math.round(clamp(m, 0, 1) * 255);
      px[o + 1] = Math.round(g * 255);
      px[o + 2] = Math.round(b * 255);
      px[o + 3] = Math.round(w * 255);
    }
  }
  return { data: px, nx, nz };
}
