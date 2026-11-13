// La vapeur et le nuage : un seul fluide simulé.
//
// Un panache chaud axisymétrique (équations de Boussinesq, coordonnées (r, z))
// monte de la surface du thé dans un air en deux couches : neutre jusqu'au
// niveau de condensation (z = 1), stablement stratifié au-dessus, et fermé par
// une inversion forte (le « plafond » où s'étale l'enclume). Un traceur, la
// vapeur condensée, est injecté avec l'air chaud. Tout ce qu'on voit — la
// colonne, sa tête qui s'étale, les étages qui s'empilent, l'enclume — est ce
// traceur : le nuage EST la vapeur accumulée.
//
//   ∂u/∂t + (u·∇)u = −∇p + b ẑ        ∇·u = 0
//   ∂b/∂t + (u·∇)b = −Γ(z) w           (b : flottabilité, écart à l'air ambiant)
//   ∂s/∂t + (u·∇)s = 0                 (s : traceur)
//
// Pourquoi le nuage monte par étages : un air chauffé à b₀ s'arrête là où
// l'air ambiant a la même densité, à z ≈ 1 + b/Γ. La source chauffe de plus en
// plus fort (le thé vient d'être frappé par la foudre) : les premières bouffées
// s'étalent à la base, les suivantes plus haut, la dernière sous le plafond.
//
// Schéma : « stable fluids » (Stam) — advection semi-lagrangienne, projection
// par Gauss-Seidel sur le laplacien cylindrique — sur une grille de NR × NZ
// cellules. La simulation est enregistrée (NF images du traceur, 8 bits) et
// relue par le film ; l'interpolation trilinéaire de la texture 3D fait
// l'interpolation dans le temps.
//
// Unité : 1 = hauteur de la source au niveau de condensation. Module pur.

export const PLUME = { NR: 64, NZ: 88, NF: 72, DX: 0.025, DT: 0.025, STEPS: 576 };

// spec : { seed, r0 (rayon de la source), top (hauteur du plafond, > 1), heat (force finale de la source),
//          puffs (bouffées), spread }
export function simulatePlume(spec) {
  const { NR, NF, DX, DT, STEPS } = PLUME;
  const { r0 = 0.1, top = 1.7, heat = 1, puffs = 7, gamma = 5, mix = 0.12 } = spec;
  // (le plafond est le haut du domaine, fermé : la grille a la hauteur du nuage)
  const NZ = Math.max(48, Math.min(PLUME.NZ, Math.round(top / DX)));
  const N = NR * NZ, I = (i, j) => i + j * NR;
  let u = new Float32Array(N), w = new Float32Array(N), b = new Float32Array(N), s = new Float32Array(N);
  let u2 = new Float32Array(N), w2 = new Float32Array(N), b2 = new Float32Array(N), s2 = new Float32Array(N);
  const p = new Float32Array(N), div = new Float32Array(N);
  // stratification : nulle sous z = 1, gamma au-dessus, très forte au-dessus du plafond
  const G = new Float32Array(NZ);
  const ss = (a, c, x) => { const t = Math.max(0, Math.min(1, (x - a) / (c - a))); return t * t * (3 - 2 * t); };
  for (let j = 0; j < NZ; j++) { const z = (j + 0.5) * DX; G[j] = gamma * ss(0.93, 1.05, z); }
  // échantillonnage bilinéaire en coordonnées de grille (x : rayon, y : hauteur) ; l'axe est un miroir
  const sample = (f, x, y, odd) => {
    let sg = 1;
    if (x < 0) { x = -x; if (odd) sg = -1; }
    x = Math.min(NR - 1.001, Math.max(0, x - 0.5)); y = Math.min(NZ - 1.001, Math.max(0, y - 0.5));
    const i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = I(i, j);
    return sg * ((f[k] * (1 - fx) + f[k + 1] * fx) * (1 - fy) + (f[k + NR] * (1 - fx) + f[k + NR + 1] * fx) * fy);
  };
  const frames = new Uint8Array(NR * NZ * NF), mass = new Float32Array(NF);
  const every = STEPS / NF;
  let nf = 0;
  const iR0 = r0 / DX;
  for (let step = 0; step < STEPS; step++) {
    const t = step / STEPS;
    // ── la source : elle monte en puissance, bat par bouffées, puis faiblit ──
    const ramp = ss(0, 0.12, t), fade = 1 - 0.82 * ss(0.82, 0.98, t);
    const puff = 1 + 0.45 * Math.sin(2 * Math.PI * puffs * t) * ss(0.1, 0.3, t);
    const B = heat * (0.3 + 1.85 * ss(0.2, 0.85, t)) * ramp * fade * puff; // (faible d'abord : les premières bouffées s'étalent à la base, sans percer)
    for (let j = 0; j < 3; j++) for (let i = 0; i < NR; i++) {
      const prof = Math.exp(-(((i + 0.5) / iR0) ** 2)), k = I(i, j);
      if (prof < 0.01) break;
      b[k] += (B - b[k]) * prof * 0.6; s[k] += (fade * ramp - s[k]) * prof * 0.6; w[k] += (0.35 * ramp * fade - w[k]) * prof * 0.3;
    }
    // ── forces : flottabilité, stratification ──
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NR; i++) { const k = I(i, j); b[k] -= DT * w[k] * G[j]; w[k] += DT * b[k]; }
    // ── projection : ∇²p = ∇·u (laplacien cylindrique), parois : axe et fond fermés, haut et large ouverts ──
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NR; i++) {
      const r = (i + 0.5) * DX, k = I(i, j);
      const ue = i < NR - 1 ? (u[k] + u[k + 1]) / 2 : u[k], uw = i > 0 ? (u[k] + u[k - 1]) / 2 : 0;
      const wn = j < NZ - 1 ? (w[k] + w[k + NR]) / 2 : 0, ws = j > 0 ? (w[k] + w[k - NR]) / 2 : 0;
      div[k] = (((r + DX / 2) * ue - (r - DX / 2) * uw) / (r * DX) + (wn - ws) / DX);
    }
    for (let it = 0; it < 36; it++) for (let j = 0; j < NZ; j++) for (let i = 0; i < NR; i++) {
      const r = (i + 0.5) * DX, k = I(i, j);
      const ce = (r + DX / 2) / r, cw = i > 0 ? (r - DX / 2) / r : 0;
      const pe = i < NR - 1 ? p[k + 1] : 0, pw = i > 0 ? p[k - 1] : 0;
      const up = j < NZ - 1, dn = j > 0;
      p[k] = (ce * pe + cw * pw + (up ? p[k + NR] : 0) + (dn ? p[k - NR] : 0) - div[k] * DX * DX) / (ce + cw + (up ? 1 : 0) + (dn ? 1 : 0));
    }
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NR; i++) {
      const k = I(i, j);
      const pe = i < NR - 1 ? p[k + 1] : 0, pw = i > 0 ? p[k - 1] : p[k];
      const pn = j < NZ - 1 ? p[k + NR] : p[k], ps = j > 0 ? p[k - NR] : p[k];
      u[k] -= (pe - pw) / (2 * DX); w[k] -= (pn - ps) / (2 * DX);
      if (j === 0) w[k] = Math.max(0, w[k]);
      if (j === NZ - 1) w[k] = Math.min(0, w[k]);
    }
    // ── advection semi-lagrangienne ──
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NR; i++) {
      const k = I(i, j), x = i + 0.5 - (DT * u[k]) / DX, y = j + 0.5 - (DT * w[k]) / DX;
      u2[k] = sample(u, x, y, true) * 0.999; w2[k] = sample(w, x, y, false) * 0.999; b2[k] = sample(b, x, y, false); s2[k] = sample(s, x, y, false);
    }
    [u, u2] = [u2, u]; [w, w2] = [w2, w]; [b, b2] = [b2, b]; [s, s2] = [s2, s];
    // ── mélange turbulent (viscosité de tourbillon) : c'est lui qui fait
    // entraîner l'air ambiant par le panache — il s'élargit en cône, se dilue,
    // et s'arrête au lieu de percer le plafond comme un jet laminaire ──
    for (const [f, f2, kd, odd] of [[u, u2, mix, true], [w, w2, mix, false], [b, b2, mix, false], [s, s2, mix * 0.35, false]]) {
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NR; i++) {
        const k = I(i, j), c = f[k];
        const e = i < NR - 1 ? f[k + 1] : c, wv = i > 0 ? f[k - 1] : (odd ? -c : c), n = j < NZ - 1 ? f[k + NR] : c, so = j > 0 ? f[k - NR] : c;
        f2[k] = c + kd * (e + wv + n + so - 4 * c);
      }
      f.set(f2);
    }
    // (éponge aux bords ouverts : rien ne revient)
    for (let j = 0; j < NZ; j++) { const k = I(NR - 1, j); s[k] *= 0.9; b[k] *= 0.9; u[k] = Math.max(0, u[k]); }
    if (spec.debug && step % 40 === 0) { let m = 0, mb = 0; for (let k = 0; k < N; k++) { m = Math.max(m, Math.abs(w[k]), Math.abs(u[k])); mb = Math.max(mb, Math.abs(b[k])); } console.log(step, 'vmax', m.toFixed(2), 'bmax', mb.toFixed(2)); }
    // ── enregistrement ──
    if (Math.floor((step + 1) / every) > nf && nf < NF) {
      let m = 0;
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NR; i++) { const v = Math.max(0, Math.min(1, s[I(i, j)])); frames[i + NR * (j + NZ * nf)] = Math.round(Math.sqrt(v) * 255); m += v * (i + 0.5); }
      mass[nf++] = m;
    }
  }
  // (la première image est vide : la boucle repart de rien)
  frames.fill(0, 0, NR * NZ);
  mass[0] = 0;
  // étendue du nuage dans la dernière image : rayon et hauteur où il reste du traceur
  let rMax = 0, zMax = 0;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NR; i++) if (frames[i + NR * (j + NZ * (NF - 1))] > 60) { rMax = Math.max(rMax, (i + 1) * DX); zMax = Math.max(zMax, (j + 1) * DX); }
  return { frames, mass, NR, NZ, NF, DX, rMax, zMax };
}
