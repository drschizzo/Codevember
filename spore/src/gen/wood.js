// Le bois cuit (module pur : worker, tests, Node).
//
// Une carte de relief et une carte de couleur sur UNE période du bois : x de
// 0 à L (le long du vent et du fil), z de −W/2 à W/2 (en travers). Tout le
// bruit est périodique en x (période entière de cellules), si bien que le bois
// se répète exactement de L en L : c'est ce qui permet à la caméra d'avancer
// de L par boucle et de retomber sur la même image.
//
// Sorties :
//   rel : Float32 RGBA (converti en demi-flottants pour le GPU) — hauteur (cm),
//         pente ∂h/∂x, pente ∂h/∂z, occlusion des creux (0 creux … 1 dégagé) ;
//   col : Uint8 RGBA — albédo (sRGB), rugosité.
// La surface du bois est y = base(z) + h(x, z), base(z) = √(R² − z²) − R (le
// dessus arrondi de la bûche, de rayon R) : la MÊME fonction pose le plasmodium, les sporanges
// et les spores (surface()).
//
// Supports :
//   drift      bois flotté : fil relevé par l'érosion (les cernes d'été
//              debout, le bois de printemps creusé), fibres, gerces ;
//   weathered  tronc gris décortiqué : id., plus de gerces, fibres arrachées ;
//   char       bois carbonisé : écailles (« peau d'alligator ») aux dessus
//              bombés et luisants, fentes profondes en travers et en long ;
//   rot        pourriture cubique brune : petits cubes, fibres, humide ;
//   spalted    bois échauffé : poncé par l'eau, lignes noires des zones
//              (« spalting ») et taches pâles ;
//   cedar      planche de cèdre débitée : cernes en arcs, traits de scie.

const TAU = Math.PI * 2;

// le dessus de la bûche (cercle de rayon R centré sous le bois)
export const logBase = (z, R) => Math.sqrt(Math.max(0, R * R - z * z)) - R;

function hash2(i, j, s) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const mod = (a, n) => ((a % n) + n) % n;

// bruit de gradient 2D périodique en x (période px cellules)
export function pnoise(x, z, px, s = 0) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const g = (i, j, dx, dz) => { const a = hash2(mod(i, px), j, s) * TAU; return Math.cos(a) * dx + Math.sin(a) * dz; };
  const u = fade(fx), v = fade(fz);
  const n00 = g(ix, iz, fx, fz), n10 = g(ix + 1, iz, fx - 1, fz), n01 = g(ix, iz + 1, fx, fz - 1), n11 = g(ix + 1, iz + 1, fx - 1, fz - 1);
  return (n00 + u * (n10 - n00) + v * (n01 + u * (n11 - n01) - n00 - u * (n10 - n00))) * 1.4;
}
// fBm périodique : x en cm, f en cellules par cm le long de z ; la période en x
// est arrondie à un nombre entier de cellules sur L
export function makeNoise(L, s = 0) {
  return (x, z, f, oct = 4, ax = 1) => {
    let sum = 0, a = 0.5, ff = f;
    for (let o = 0; o < oct; o++) {
      const px = Math.max(1, Math.round(L * ff * ax));
      sum += a * pnoise((x / L) * px, z * ff, px, s + o * 17);
      ff *= 2; a *= 0.5;
    }
    return sum;
  };
}
// Worley périodique en x : distances F1, F2 aux points de cellules (cx
// cellules sur L, cz cellules par cm en travers)
export function makeWorley(L, s = 0) {
  return (x, z, cx, cz, jit = 0.85) => {
    const X = (x / L) * cx, Z = z * cz, ix = Math.floor(X), iz = Math.floor(Z);
    let f1 = 9, f2 = 9, id = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const i = ix + a, j = iz + b, m = mod(i, cx);
      const px = i + 0.5 + (hash2(m, j, s) - 0.5) * jit, pz = j + 0.5 + (hash2(m, j, s + 9) - 0.5) * jit;
      const dx = (px - X) * (L / cx), dz = (pz - Z) / cz, d = Math.hypot(dx, dz);
      if (d < f1) { f2 = f1; f1 = d; id = hash2(m, j, s + 3); } else if (d < f2) f2 = d;
    }
    return [f1, f2, id];
  };
}

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSRGB = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

// relief et couleur d'un point (x ∈ [0, L), z) : [h, albédo linéaire r g b, rugosité]
function makePattern(spec, L) {
  const s = [...String(spec.seed ?? 'w')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) & 0xffff;
  const N = makeNoise(L, s), Wy = makeWorley(L, s + 101);
  const c1 = hex(spec.color).map(toLin), c2 = hex(spec.color2).map(toLin);
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const k = spec.relief ?? 1;
  // fil du bois : coordonnée en travers, ondulée
  const grain = (x, z, amp = 0.09) => z + amp * N(x, z, 0.6, 3, 0.35);
  // cernes debout (bois d'été) : bandes de largeur irrégulière
  const rings = (g, w = 0.11) => {
    const q = g / w + 0.6 * N(g * 3, 0.3, 0.4, 2, 0.0001);
    const f = q - Math.floor(q);
    // (chaque cerne a son propre relief : tous égaux, le fil se lisait comme
    // une tôle ondulée)
    const amp = 0.35 + 0.9 * hash2(Math.floor(q), 1, s);
    return ss(0.0, 0.08, f) * ss(0.42, 0.22, f) * amp; // (bande de latewood)
  };
  // gerces : fentes le long du fil, par bandes en travers ; chaque bande tire
  // (ou non) une fente, sa position, sa longueur, sa largeur ; bouts effilés
  const checks = (x, z, dens, band = 0.32) => {
    let best = 0;
    const jz = Math.floor(z / band);
    for (let b = jz - 1; b <= jz + 1; b++) {
      if (hash2(b, 3, s) > 0.42 * dens) continue;
      const z0 = (b + 0.2 + 0.6 * hash2(b, 5, s)) * band;
      const len = L * (0.25 + 0.45 * hash2(b, 7, s)), x0 = L * hash2(b, 9, s);
      let t = mod(x - x0, L) / len; // (périodique en x)
      if (t > 1) continue;
      const wob = 0.025 * N(x, b, 1.5, 2) + 0.008 * N(x, b + 0.5, 6, 1);
      const w = (0.006 + 0.012 * hash2(b, 11, s)) * Math.sin(Math.PI * t) ** 0.6;
      const d = Math.abs(z - z0 - wob);
      best = Math.max(best, ss(w, w * 0.25, d) * Math.sin(Math.PI * t) ** 0.4);
    }
    return best;
  };
  // blocs (carbonisation, pourriture cubique) : rangées en travers de hauteur
  // irrégulière, chacune coupée en blocs par des fentes en travers du fil ;
  // rend la distance à la fente la plus proche (cm) et un tirage par bloc
  const blocks = (x, z, row, col, wob = 0.03) => {
    const zz = z + wob * N(x, z, 1.2, 2);
    const jr = Math.floor(zz / row);
    let dz = 9, id = 0;
    // fentes longitudinales : bords de rangée (une sur deux interrompue)
    const fz = zz / row - jr;
    dz = Math.min(fz, 1 - fz) * row;
    const brk = hash2(jr, Math.floor(x / (col * 3)), s + 21) < 0.3 && fz > 0.5 ? 1 : 0;
    if (brk) dz = Math.min(9, (1 - fz) * row + row * 0.5);
    // fentes transversales : décalées d'une rangée à l'autre, pas irrégulier
    const n = Math.max(2, Math.round(L / col));
    const xs = x / L * n + hash2(jr, 1, s) + 0.25 * N(z, x * 0.1, 0.9, 2);
    const ix = Math.floor(xs), fx = xs - ix;
    const dx = Math.min(fx, 1 - fx) * (L / n);
    id = hash2(mod(ix, n), jr, s + 4);
    return [Math.min(dx, dz), id];
  };
  switch (spec.pattern) {
    case 'drift': case 'weathered': {
      const wf = spec.pattern === 'weathered';
      return (x, z) => {
        const g = grain(x, z, 0.16) + 0.05 * N(x, z, 2.2, 2);
        const along = 0.55 + 0.45 * Math.max(-1, Math.min(1, 1.6 * N(x, g, 1.4, 2))); // (érosion inégale le long du fil)
        const ring = rings(g, wf ? 0.085 : 0.12) * along;
        const ring2 = rings(g + 0.37, wf ? 0.21 : 0.27) * 0.6 * (1.4 - along * 0.6);
        const fib = N(x * 0.05, g, 38, 2, 0.02) * 0.5 + N(x * 0.1, g, 90, 1, 0.02) * 0.3;
        const ck = checks(x, z, wf ? 1.7 : 1);
        const mound = N(x, z, 0.9, 3);
        const ero = Math.max(0, N(x, g, 3.5, 2)) * (wf ? 0.012 : 0.008); // (fibres arrachées par plaques)
        let h = (ring * 0.011 + ring2 * 0.006 + fib * 0.004 + mound * 0.02 - ero - ck * 0.07) * k;
        const t = Math.min(1, Math.max(0, 0.42 + mound * 0.8 - ring * 0.15 + fib * 0.5 + ero * 30 + ck * 0.9));
        let col = mixc(c1, c2, t * (wf ? 0.8 : 0.55));
        col = col.map((c) => c * (1 + 0.12 * N(x, z, 8, 2)));
        return [h, col, (spec.rough ?? 0.8) + ck * 0.1];
      };
    }
    case 'char': {
      return (x, z) => {
        const g = grain(x, z, 0.05);
        // écailles de charbon : grandes, irrégulières, recoupées de fentes fines
        // (Voronoï anisotrope — cellules plus larges en travers du fil — et
        // fortement déformé : une croûte, pas des briques)
        const wx = x + 0.09 * N(x, z, 1.3, 3) + 0.03 * N(x + 5, z, 5, 2), wz = g + 0.07 * N(x + 2, z, 1.1, 3);
        const [f1, f2, id] = Wy(wx, wz, 13, 1.7, 0.95);
        const d = (f2 - f1) * 0.5;
        const [g1, g2] = Wy(wx + 0.37, wz + 0.11, 31, 4.2, 0.95);
        const d2 = (g2 - g1) * 0.5;
        const crack = Math.max(ss(0.016, 0.002, d), ss(0.005, 0.0008, d2) * (id > 0.4 ? 0.7 : 0.2));
        const dome = Math.sqrt(Math.min(1, d / 0.18)) * 0.022 + N(x, z, 3, 2) * 0.004;
        const fib = N(x * 0.05, g, 30, 2, 0.02);
        const h = (dome - crack * 0.07 + fib * 0.004 + (id - 0.5) * 0.012) * k;
        const shine = ss(0.03, 0.1, d) * (0.5 + 0.5 * id);
        let col = mixc(c1, c2, 0.35 + 0.5 * crack + 0.15 * N(x, z, 6, 2)).map((c) => c * 0.75);
        col = mixc(col, [0.08, 0.075, 0.07], shine * 0.25 * (0.5 + 0.5 * fib)); // (reflets argentés du charbon)
        // (mat, sauf quelques écailles lustrées : une croûte uniformément
        // satinée reflétait le studio et le charbon devenait une céramique grise)
        const lustre = shine * ss(0.55, 0.8, id);
        return [h, col, Math.min(1, (spec.rough ?? 0.45) + 0.18 + crack * 0.3 - lustre * 0.4)];
      };
    }
    case 'rot': {
      return (x, z) => {
        const g = grain(x, z, 0.08);
        const wx = x + 0.05 * N(x, z, 1.6, 3), wz = g + 0.04 * N(x + 2, z, 1.4, 3);
        const [f1, f2, id] = Wy(wx, wz, 26, 3.4, 0.95);
        const d = (f2 - f1) * 0.5;
        const [g1, g2] = Wy(wx + 0.21, wz + 0.07, 61, 8, 0.95);
        const crack = Math.max(ss(0.01, 0.0015, d), ss(0.004, 0.0006, (g2 - g1) * 0.5) * 0.5);
        const fib = N(x * 0.04, g, 45, 2, 0.02);
        const lump = N(x, z, 2.2, 3);
        const h = (Math.sqrt(Math.min(1, d / 0.08)) * 0.01 - crack * 0.035 + fib * 0.005 + lump * 0.012 + (id - 0.5) * 0.006) * k;
        let col = mixc(c1, c2, Math.min(1, 0.3 + crack * 0.6 + 0.3 * lump + 0.2 * fib + 0.2 * (id - 0.5)));
        return [h, col, (spec.rough ?? 0.55) + crack * 0.2];
      };
    }
    case 'spalted': {
      return (x, z) => {
        const g = grain(x, z, 0.12);
        const ring = rings(g, 0.18);
        const fib = N(x * 0.05, g, 34, 2, 0.02);
        const zn = N(x, z, 1.1, 3);
        const zl = Math.abs(zn + 0.12); // (lignes de zone : une courbe de niveau)
        // (lignes de zone d'épaisseur variable, avec un halo brun diffus : un
        // trait d'égale largeur se lisait comme un dessin à l'encre)
        const lw = 0.004 + 0.007 * (0.5 + 0.5 * N(x + 3, z, 2.5, 2));
        const line = ss(lw, lw * 0.3, zl) * (0.75 + 0.25 * N(x, z + 4, 6, 2));
        const halo = ss(lw * 5, lw, zl) * 0.3;
        const pale = ss(0.1, 0.3, N(x + 7, z, 0.8, 2));
        const h = (ring * 0.006 + fib * 0.003 + N(x, z, 0.7, 3) * 0.015) * k;
        let col = mixc(c1, [c1[0] * 1.25, c1[1] * 1.22, c1[2] * 1.15], pale * 0.6);
        col = mixc(col, [c1[0] * 0.8, c1[1] * 0.72, c1[2] * 0.6], zn > -0.12 ? 0.35 : 0); // (une zone, une teinte)
        col = mixc(col, c2, ring * 0.35 + fib * 0.15);
        col = mixc(col, [c1[0] * 0.45, c1[1] * 0.38, c1[2] * 0.3], halo);
        col = mixc(col, [0.012, 0.01, 0.008], Math.min(1, line));
        return [h, col, spec.rough ?? 0.7];
      };
    }
    case 'cedar': {
      return (x, z) => {
        // planche débitée sur dosse : les cernes sont les courbes de niveau de
        // la distance au cœur, qui s'enfonce et remonte le long de la planche
        // (cathédrales) ; une période sur L
        const d = 0.25 + 0.42 * (0.5 + 0.5 * Math.cos((x / L) * TAU + 0.6)) + 0.05 * N(x, z, 0.6, 2);
        const zc = z - 0.35 + 0.1 * N(x, z, 0.4, 2);
        const q = Math.sqrt(d * d + zc * zc) / 0.11 + 0.25 * N(x, z, 0.8, 2);
        const f = q - Math.floor(q);
        const late = ss(0.6, 0.78, f) * ss(1.0, 0.9, f);
        const ray = ss(0.6, 0.95, N(x * 0.04, z, 60, 1, 0.01)) * 0.4;
        // (traits de scie irréguliers : pas variable, profondeur par passes)
        const saw = (Math.sin((x / L) * TAU * 44 + 2.2 * N(x, z, 0.7, 2)) * 0.5 + 0.5) * (0.25 + 0.75 * Math.max(0, N(x, z * 0.3, 1.1, 2) + 0.4)) * 0.6;
        const fib = N(x * 0.05, z, 40, 2, 0.02);
        const h = (late * 0.004 + saw * 0.0025 + fib * 0.002) * k;
        let col = mixc(c1, c2, late * 0.7 + fib * 0.15);
        col = col.map((c, i) => c * (1 + ray * (i === 0 ? 0.25 : 0.15)) * (1 + 0.08 * N(x, z, 3, 2)));
        return [h, col, (spec.rough ?? 0.6) - late * 0.1];
      };
    }
    default: throw new Error(`support inconnu : ${spec.pattern}`);
  }
}

// cuisson : M × M texels sur [0, L) × [−W/2, W/2]
export function bakeWood(spec) {
  const { L, W, M = 1024 } = spec;
  const P = makePattern(spec, L);
  const H = new Float32Array(M * M), col = new Uint8Array(M * M * 4);
  const dx = L / M, dz = W / M;
  for (let j = 0; j < M; j++) {
    const z = -W / 2 + (j + 0.5) * dz;
    for (let i = 0; i < M; i++) {
      const x = (i + 0.5) * dx;
      const [h, c, r] = P(x, z);
      const o = j * M + i;
      H[o] = h;
      col[o * 4] = Math.round(255 * toSRGB(Math.min(1, Math.max(0, c[0]))));
      col[o * 4 + 1] = Math.round(255 * toSRGB(Math.min(1, Math.max(0, c[1]))));
      col[o * 4 + 2] = Math.round(255 * toSRGB(Math.min(1, Math.max(0, c[2]))));
      col[o * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0.05, r)));
    }
  }
  // pentes (différences centrées ; périodiques en x) et occlusion (creux sous
  // la moyenne locale, deux rayons)
  const rel = new Float32Array(M * M * 4);
  const at = (i, j) => H[Math.min(M - 1, Math.max(0, j)) * M + mod(i, M)];
  const box = (src, r) => { // flou en boîte séparable (périodique en x)
    const tmp = new Float32Array(M * M), out = new Float32Array(M * M);
    for (let j = 0; j < M; j++) { let s = 0; for (let i = -r; i <= r; i++) s += src[j * M + mod(i, M)]; for (let i = 0; i < M; i++) { tmp[j * M + i] = s / (2 * r + 1); s += src[j * M + mod(i + r + 1, M)] - src[j * M + mod(i - r, M)]; } }
    for (let i = 0; i < M; i++) { let s = 0; for (let j = -r; j <= r; j++) s += tmp[Math.min(M - 1, Math.max(0, j)) * M + i]; for (let j = 0; j < M; j++) { out[j * M + i] = s / (2 * r + 1); s += tmp[Math.min(M - 1, j + r + 1) * M + i] - tmp[Math.max(0, j - r) * M + i]; } }
    return out;
  };
  const b1 = box(H, 6), b2 = box(H, 24);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const o = j * M + i;
    rel[o * 4] = H[o];
    rel[o * 4 + 1] = (at(i + 1, j) - at(i - 1, j)) / (2 * dx);
    rel[o * 4 + 2] = (at(i, j + 1) - at(i, j - 1)) / (2 * dz);
    const cav = Math.min(H[o] - b1[o], 0) * 0.6 + Math.min(H[o] - b2[o], 0) * 0.4;
    rel[o * 4 + 3] = Math.max(0.15, Math.min(1, 1 + cav * 18));
  }
  // hauteur lissée (rayon 24 texels ≈ 1 mm) : le niveau d'un gel qui remplit les creux
  const smooth = new Float32Array(M * M);
  for (let o = 0; o < M * M; o++) smooth[o] = Math.max(b2[o], H[o] * 0.5 + b2[o] * 0.5);
  return { rel, col, smooth, M, L, W, logR: spec.logR };
}

// La surface (CPU) : hauteur et normale du bois au point monde (x, z),
// bilinéaire sur la carte cuite — la même que le vertex shader.
export function surface(maps) {
  const { rel, M, L, W, logR } = maps;
  const sample = (x, z, c) => {
    const u = mod(x, L) / L * M - 0.5, v = ((z + W / 2) / W) * M - 0.5;
    const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
    const g = (i, j) => rel[(Math.min(M - 1, Math.max(0, j)) * M + mod(i, M)) * 4 + c];
    return (g(i0, j0) * (1 - fu) + g(i0 + 1, j0) * fu) * (1 - fv) + (g(i0, j0 + 1) * (1 - fu) + g(i0 + 1, j0 + 1) * fu) * fv;
  };
  const base = (z) => logBase(z, logR);
  const y = (x, z) => base(z) + sample(x, z, 0);
  const normal = (x, z) => {
    const hx = sample(x, z, 1), hz = sample(x, z, 2) - z / Math.sqrt(Math.max(1e-6, logR * logR - z * z));
    const l = Math.hypot(hx, 1, hz);
    return [-hx / l, 1 / l, -hz / l];
  };
  return { y, normal, base, sample };
}

// grille de hauteurs grossière (n × n sur une période) pour les calculs du
// worker (chute des spores) : même motif que la carte cuite, bilinéaire
export function heightGrid(spec, n = 256) {
  const { L, W, logR } = spec;
  const P = makePattern(spec, L), H = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) H[j * n + i] = P(((i + 0.5) * L) / n, -W / 2 + ((j + 0.5) * W) / n)[0];
  return (x, z) => {
    const u = (mod(x, L) / L) * n - 0.5, v = ((z + W / 2) / W) * n - 0.5;
    const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
    const g = (i, j) => H[Math.min(n - 1, Math.max(0, j)) * n + mod(i, n)];
    return logBase(z, logR) + (g(i0, j0) * (1 - fu) + g(i0 + 1, j0) * fu) * (1 - fv) + (g(i0, j0 + 1) * (1 - fu) + g(i0 + 1, j0 + 1) * fu) * fv;
  };
}
