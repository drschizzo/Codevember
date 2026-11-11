// La plume : forme, barbes, déroulement, calendrier de la boucle, plumage.
// Module pur (sans three.js) : la même formule sert au vertex shader
// (scene/feather.js la recopie en TSL), aux tests et au placement.
//
// Repère local d'une plume : le follicule à l'origine, le rachis le long de
// +y (droit pendant la croissance, courbé ensuite), la face dorsale vers +z,
// x latéral. Un point du vexille a des coordonnées « déroulées » (σ, y) :
// σ ≥ 0 la distance au rachis le long du vexille, y la hauteur le long du
// rachis, et un côté (±1).
//
// LE DÉROULEMENT. Dans la gaine, les deux moitiés du vexille sont roulées sur
// un cylindre de rayon ρ(y) = (W_g + W_d) / 2π (la circonférence est la
// largeur totale), le rachis sur la génératrice dorsale. Une tranche est un
// arc de longueur σ et de courbure κ = (1 − λ) / ρ ; λ passe de 0 (roulé) à
// 1 (plan) :
//   x = côté · sin(κσ) / κ,   z = −(1 − cos κσ) / κ
// Une courbure qui change sans que la longueur d'arc change : le déroulement
// est une isométrie (les barbes ne s'étirent pas ; vérifié dans les tests).

import { FAMILIES, BIRDS } from '../families.js';

const TAU = Math.PI * 2;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// (montée sans à-coup : dérivées première et seconde nulles aux bords)
export const smoother = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const mix = (a, b, t) => a + (b - a) * t;

// ── Le calendrier de la boucle (part de boucle u) ────────────────────────────
// Une seule horloge : la croissance, le déroulement, l'agrafage, la pose et
// l'usure lisent tous ces bornes ; la caméra et la lumière aussi.
export const SCHED = {
  push: [0.0, 0.075],   // le tuyau sort sous l'ancienne plume et la soulève (accéléré)
  fall: [0.075, 0.15],  // libérée, elle glisse sur le dos (caméra rapide, ×8)
  grow: [0.15, 0.4],    // le tuyau finit de monter (accéléré)
  front: [0.34, 0.6],   // le front de déroulement descend de la pointe à la base
  open: 0.045,          // durée locale d'ouverture (rebond élastique)
  zipLag: 0.025, zipW: 0.035, zipDur: 0.035, // agrafage : retard, avancée vers le bord, durée
  bend: [0.46, 0.72],   // le rachis prend sa courbure
  settle: [0.72, 0.85], // la plume se couche
  wear: [0.86, 0.99],   // l'usure
  pushFrac: 0.42,       // part de la croissance faite sous l'ancienne plume (il la soulève)
};

// part émergée du rachis (0 : dans le follicule, 1 : sortie entière)
export function growth(u, L) {
  const gp = SCHED.pushFrac;
  return gp * smoother(SCHED.push[0], SCHED.push[1], u) + (1 - gp) * smoother(SCHED.grow[0], SCHED.grow[1], u);
}
// profondeur (cm) du point y = 0 de la plume sous la peau : L au départ,
// la part du calamus qui reste dans le follicule à la fin
// (au départ, tout est caché : la pointe des barbes dépasse un peu le rachis,
// et le duvet est fait de barbes plus longues que son calamus)
export const sinkAt = (u, L, cal, over = 1.08) => mix(L * over, 0.85 * cal * L, growth(u, L));
// courbure du rachis (1/cm) : la sienne, bornée pour épouser le corps sans y entrer
export const bendOf = (P, Rd) => Math.min(P.bend + 0.5 / Rd, 0.9 / Rd);
// instant où le front de déroulement atteint la hauteur s (part du rachis)
export const releaseAt = (s) => SCHED.front[0] + (1 - clamp(s, 0, 1)) * (SCHED.front[1] - SCHED.front[0]);
// ouverture élastique : 0 → 1, dérivée nulle au départ, léger dépassement (rebond)
export function elastic(x) {
  if (x <= 0) return 0;
  return 1 - Math.exp(-4 * x) * (Math.cos(5 * x) + 0.8 * Math.sin(5 * x));
}
// λ (0 roulé → 1 plan) d'un point à la hauteur s
export const unroll = (u, s) => elastic((u - releaseAt(s)) / SCHED.open);
// libéré (la gaine n'est plus là) : 0 → 1 sur une courte durée
export const released = (u, s) => sstep(0, 0.012, u - releaseAt(s));
// agrafage d'un point (σn : distance au rachis / demi-largeur)
export const zipAt = (u, s, sn) => sstep(0, 1, (u - releaseAt(s) - SCHED.zipLag - sn * SCHED.zipW) / SCHED.zipDur);
export const bendAt = (u) => smoother(SCHED.bend[0], SCHED.bend[1], u);
export const settleAt = (u) => smoother(SCHED.settle[0], SCHED.settle[1], u);
export const wearAt = (u) => smoother(SCHED.wear[0], SCHED.wear[1], u);

// ── La forme d'une plume ─────────────────────────────────────────────────────
// demi-largeur d'un côté à la hauteur s (part du rachis), en cm
export function halfWidth(P, s, side) {
  if (P.radial) return 0;
  const sc = P.calamus;
  if (s <= sc) return 0;
  const h = (s - sc) / (1 - sc);
  // large tôt (la base duveteuse s'évase vite), pointe arrondie ou effilée
  let w = Math.pow(h, 0.32) * Math.pow(Math.max(0, 1 - Math.pow(h, P.tipPow)), 0.55);
  if (P.eye) { // ocelle : fils clairsemés en bas, disque de l'œil en haut
    const e = sstep(P.eyeStart - 0.12, P.eyeStart + 0.02, h);
    w = mix(0.62 * Math.pow(h, 0.5), 1.05 * Math.pow(Math.max(0, 1 - Math.pow((h - P.eyeStart) / (1 - P.eyeStart) * 2 - 1, 2)), 0.5), e) * (h > 0.999 ? 0 : 1);
  }
  const W = P.W * 0.5 * (side > 0 ? 1 + P.asym : 1 - P.asym);
  return W * w;
}
// rayon du tube (gaine) à la hauteur s : la circonférence est la largeur totale
// (plafonné : un vexille très large — l'autruche — s'enroule sur plus d'un tour)
export const tubeRadius = (P, s) => P.radial ? P.bundle : Math.min(0.06 * P.L, Math.max(0.012, (halfWidth(P, s, 1) + halfWidth(P, s, -1)) / TAU));

// point d'une barbe dans le plan déroulé, à l'abscisse curviligne l :
// σ (distance au rachis), h (hauteur au-dessus de sa racine) ; angle φ = α − c·l
export function barbArc(alpha, curl, l) {
  const c = Math.abs(curl) < 1e-4 ? 1e-4 : curl;
  return [(Math.cos(alpha - c * l) - Math.cos(alpha)) / c, (Math.sin(alpha) - Math.sin(alpha - c * l)) / c];
}

// Paramètres de forme tirés pour une plume (rng : flux de la recette)
export function shapeOf(familyKey, rng, bird = null) {
  const F = FAMILIES[familyKey];
  const pick = (r) => (Array.isArray(r) ? rng.range(r[0], r[1]) : r);
  const L = pick(F.L);
  const P = {
    family: familyKey, radial: !!F.radial, L,
    W: L * pick(F.width), asym: pick(F.asym) * (rng.range(0, 1) < 0.5 ? -1 : 1), calamus: F.calamus,
    plum: pick(F.plum), alpha: pick(F.alpha ?? [0, 0]), curl: pick(F.curl), tipPow: pick(F.tipPow),
    bend: pick(F.bend), droop: F.droop, zip: F.zip, wave: F.wave, density: F.density ?? 0,
    eye: familyKey === 'ocelle', eyeStart: F.eyeStart ?? 1,
    count: F.count ? Math.round(pick(F.count)) : 0, spread: F.spread ?? null, bundle: 0.06,
  };
  if (P.radial) P.W = 0;
  // (longueur à faire sortir, en L : la pointe des barbes dépasse le rachis ;
  // le duvet est fait de barbes plus longues que son calamus)
  P.over = P.radial ? 1.04 + P.calamus : P.eye ? 1.3 : 1.08;
  return P;
}

// Une table de barbes. Chaque barbe : 16 flottants (4 vec4 d'instance) :
//   0 s racine (part du rachis), 1 côté ±1 (duvet : azimut), 2 longueur ℓ, 3 angle α
//   4 courbure c, 5 ρ à la racine, 6 ρ à la pointe, 7 part duveteuse (0–1)
//   8 indice de la plume (posé au placement), 9 tirage, 10 largeur du ruban, 11 agrafable (0/1)
//   12 affaissement, 13 écart libre (rad), 14 ondulation (cm), 15 usure
// density : barbes par cm et par côté (le gabarit grossier des voisines en a moins, plus larges)
export const BARB_STRIDE = 16;
export function barbTable(P, seed, density = P.density) {
  let h = 2166136261;
  for (const ch of `barbs:${seed}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const rows = [];
  if (P.radial) {
    // duvet : n barbes autour du sommet du calamus, ouvertes en étoile
    const n = density > 0 ? Math.round(density) : P.count;
    for (let i = 0; i < n; i++) {
      const phi = (i + 0.5 * rnd()) / n * TAU * 2.618; // (spirale dorée : pas d'alignement)
      const ell = P.L * (0.5 + 0.5 * rnd());
      // (ouverture répartie sur la sphère : une houppe, pas une gerbe)
      const a = Math.acos(clamp(1 - 2 * mix(P.spread[0] / Math.PI, P.spread[1] / Math.PI, Math.pow(rnd(), 0.9)), -1, 1));
      rows.push([P.calamus, phi % TAU, ell, a, P.curl * (0.5 + rnd()) * (rnd() < 0.5 ? 1 : 0.6), P.bundle, P.bundle, 1,
        0, rnd(), n < 60 ? 0.1 : 0.075, 0, P.droop * (0.5 + rnd()), 0, P.wave * (0.6 + 0.8 * rnd()), 0.1 + 0.3 * rnd()]);
    }
  } else {
    const Lr = P.L, sc = P.calamus;
    for (const side of [1, -1]) {
      const n = Math.max(6, Math.round(density * Lr * (1 - sc)));
      for (let i = 0; i < n; i++) {
        const s = sc + (1 - sc) * (i + 0.35 + 0.3 * rnd()) / n;
        const hh = (s - sc) / (1 - sc);
        const plum = sstep(P.plum * 1.15, P.plum * 0.75, hh);
        const eye = P.eye ? sstep(P.eyeStart - 0.04, P.eyeStart + 0.04, hh) : 0;
        // angle : plus ouvert à la base (duvet), plus aigu vers la pointe
        let alpha = P.alpha * mix(1.18, 0.9, hh) * (1 + 0.04 * (rnd() - 0.5));
        if (P.eye) alpha = mix(alpha, 1.05, eye);
        const curl = P.curl * (0.8 + 0.4 * rnd()) * (P.eye ? 1 - eye : 1);
        // longueur : la pointe de la barbe touche le contour (point fixe)
        let ell = halfWidth(P, s, side) / Math.max(0.2, Math.sin(alpha));
        for (let it = 0; it < 6; it++) {
          const [sg, hy] = barbArc(alpha, curl, ell);
          const st = Math.min(1, s + hy / Lr);
          const want = halfWidth(P, st, side);
          if (sg < 1e-5) break;
          ell = Math.max(0.02, ell * clamp(want / sg, 0.5, 1.5));
        }
        if (P.eye && eye < 0.5) ell *= 1.35; // (fils libres plus longs que le contour : ils pendent)
        const [, hy] = barbArc(alpha, curl, ell);
        const r0 = tubeRadius(P, s), r1 = tubeRadius(P, Math.min(1, s + hy / Lr));
        const spacing = (Lr * (1 - sc)) / n; // (écart le long du rachis)
        const zip = P.zip * (1 - plum) || (P.eye ? eye : 0);
        const width = spacing * Math.sin(alpha) * (zip > 0.5 ? 1.45 : 0.9) + 0.004;
        const tipW = sstep(0.75, 1.0, hh) * 0.6 + 0.4 * rnd() * rnd();
        rows.push([s, side, ell, alpha, curl, r0, r1, plum,
          0, rnd(), width, zip > 0.5 ? 1 : 0, (P.droop * (1 - zip)) * (0.6 + 0.8 * rnd()) * (1 - 0.85 * plum) + plum * 0.01, (0.08 + 0.12 * rnd()) * (1 + plum * 2), (P.wave * (0.5 + rnd())) * (1 + plum * 1.5), tipW]);
      }
    }
  }
  const out = new Float32Array(rows.length * BARB_STRIDE);
  rows.forEach((r, i) => out.set(r, i * BARB_STRIDE));
  return out;
}

// ── La pose d'un point de barbe (la formule du vertex shader) ────────────────
// B : la barbe (16 flottants) ; t ∈ [0, 1] le long ; v ∈ [−1, 1] en travers ;
// ridge ∈ [0, 1] (arête du ramus) ; S : état de la plume
//   { u (temps local de la plume, part de boucle), L, k (courbure finale du
//     rachis, 1/cm), wear, g: [gx, gy, gz] (pesanteur dans le repère local) }
// → { p: [x, y, z] (repère local), n: [nx, ny, nz], pat: [x, z], hidden }
export function barbPose(B, t, v, ridge, S) {
  const [s0, side, ell, alpha0, curl0, rho0, rho1, plum, , rnd, width, zipF, droop, spread, wave, wearAmt] = B;
  const L = S.L, u = S.u;
  const radial = !!S.radial;
  const ellE = ell * (1 - S.wear * wearAmt * 0.45);
  const l = t * ellE;
  // λ : un par barbe (à mi-hauteur) — chaque barbe se déroule sur un cylindre
  // de courbure unique, donc sans s'étirer ; le front descend de barbe en barbe
  const hMid = barbArc(alpha0, curl0, ellE * 0.5)[1];
  const sP = clamp(s0 + hMid / L, 0, 1);
  const lam = unroll(u, sP);
  const rel = released(u, sP);
  const zip = zipF * zipAt(u, sP, t) * (1 - S.wear * (rnd < 0.1 ? 0.85 : 0));
  // angle de la barbe : libre, elle s'écarte (jours entre barbes) ; agrafée, en place
  const alpha = radial ? alpha0 * lam : alpha0 + (1 - zip) * rel * spread * (rnd - 0.35) * 2;
  const curl = radial ? curl0 * lam : curl0;
  let [sg, hy] = barbArc(alpha, curl, l);
  // ruban : décalage en travers dans le plan (perpendiculaire à la barbe)
  const ph = alpha - curl * l;
  const half = width * 0.5 * (1 - 0.3 * t - 0.4 * sstep(0.7, 1, t)); // (la barbe s'effile au bout, sans dents de scie)
  sg += v * half * -Math.cos(ph); hy += v * half * Math.sin(ph);
  const y = s0 * L + hy;
  let x, z, nx, nz, tx, tz; // (tx, tz : direction σ dans la tranche)
  if (radial) {
    const c = Math.cos(side), sn = Math.sin(side);
    const r = rho0 + sg;
    x = c * r; z = sn * r; nx = c; nz = sn; tx = c; tz = sn;
  } else {
    const rho = mix(rho0, rho1, t);
    const kap = (1 - lam) / Math.max(rho, 1e-3);
    const a = kap * sg;
    if (Math.abs(kap) < 1e-4) { x = side * sg; z = -0.5 * kap * sg * sg; }
    else { x = side * Math.sin(a) / kap; z = -(1 - Math.cos(a)) / kap; }
    // (roulé, le tube est centré sur l'axe du follicule : le rachis est sur
    // sa génératrice dorsale, à ρ de l'axe ; il revient sur l'axe en s'ouvrant)
    z += rho * (1 - lam);
    tx = side * Math.cos(a); tz = -Math.sin(a);
    nx = side * Math.sin(a); nz = Math.cos(a);
  }
  // arête du ramus, ondulation des barbes libres, affaissement des barbes lourdes
  const free = (1 - zip) * rel;
  // (les barbes duveteuses frisent : fréquence plus haute)
  const w = wave * free * Math.sin(Math.PI * t) * Math.sin(t * (9 + 9 * plum) + rnd * 20);
  let px = x + nx * (ridge * 0.012 + w), py = y, pz = z + nz * (ridge * 0.012 + w);
  const sag = droop * l * l * free;
  // (vers le corps, la barbe repose sur la rangée du dessous : composante bornée)
  px += S.g[0] * sag; py += S.g[1] * sag; pz += Math.max(S.g[2], mix(-0.6, -0.03, settleAt(u))) * sag;
  // croissance : la plume sort du follicule (translation le long du rachis
  // droit) ; le calamus reste en grande partie dans le follicule
  const yy = py - sinkAt(u, L, S.cal ?? 0.1, S.over ?? 1.08);
  const hidden = yy < 0;
  // courbure du rachis : (x, yy, z) → R(yy) + X·x + N(yy)·z
  const k = S.k * bendAt(u);
  const kk = Math.abs(k) < 1e-6 ? 1e-6 : k;
  const yc = Math.max(0, yy);
  const Ry = Math.sin(kk * yc) / kk, Rz = -(1 - Math.cos(kk * yc)) / kk;
  const Ty = Math.cos(kk * yc), Tz = -Math.sin(kk * yc), Ny = Math.sin(kk * yc), Nz = Math.cos(kk * yc);
  const p = [px, Ry + Ny * pz, Rz + Nz * pz];
  // normale : n de la tranche, inclinée en travers (arête du ramus)
  const tilt = -v * 0.7 * (0.4 + ridge);
  const cx = nx + tilt * tx, cz = nz + tilt * tz;
  const nl = Math.hypot(cx, cz) || 1;
  const n = [cx / nl, Ny * cz / nl, Nz * cz / nl];
  void Ty; void Tz;
  const pat = [clamp(side * (radial ? 0 : sg / (Math.PI * Math.max(mix(rho0, rho1, t), 1e-3))), -1, 1), clamp(y / L, 0, 1)];
  return { p, n, pat, hidden, lam, zip };
}

// Point du rachis à la hauteur s (part du rachis), dans le repère local
export function rachisPoint(s, S) {
  const yy = s * S.L - sinkAt(S.u, S.L, S.cal ?? 0.1, S.over ?? 1.08);
  const off = S.rho ? S.rho(s) * (1 - unroll(S.u, s)) : 0; // (rachis sur la génératrice dorsale du tube roulé)
  const k = S.k * bendAt(S.u), kk = Math.abs(k) < 1e-6 ? 1e-6 : k, yc = Math.max(0, yy);
  const Ny = Math.sin(kk * yc), Nz = Math.cos(kk * yc);
  return { p: [0, Ny / kk + Ny * off, -(1 - Nz) / kk + Nz * off], hidden: yy < 0 };
}

// ── Le corps et le plumage ───────────────────────────────────────────────────
// Le corps : une sphère de rayon Rd, son sommet à l'origine (centre en
// (0, −Rd, 0)). Le follicule de la plume héroïne est sur le méridien φ = 0,
// à l'angle polaire θh (vers +z). Les plumes pointent « vers la queue » :
// vers les θ croissants.
export const quatFromBasis = (x, y, z) => { // (colonnes x, y, z orthonormées)
  const m00 = x[0], m11 = y[1], m22 = z[2], tr = m00 + m11 + m22;
  let qx, qy, qz, qw;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; qw = 0.25 * s; qx = (y[2] - z[1]) / s; qy = (z[0] - x[2]) / s; qz = (x[1] - y[0]) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; qw = (y[2] - z[1]) / s; qx = 0.25 * s; qy = (y[0] + x[1]) / s; qz = (z[0] + x[2]) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; qw = (z[0] - x[2]) / s; qx = (y[0] + x[1]) / s; qy = 0.25 * s; qz = (z[1] + y[2]) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; qw = (x[1] - y[0]) / s; qx = (z[0] + x[2]) / s; qy = (z[1] + y[2]) / s; qz = 0.25 * s; }
  return [qx, qy, qz, qw];
};
export const qrot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };

// repère du corps au point (θ, φ) : position, normale n, pente d (vers la queue), côté e
export function bodyFrame(Rd, th, ph) {
  const n = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
  const p = [n[0] * Rd, n[1] * Rd - Rd, n[2] * Rd];
  const d = norm([Math.cos(th) * Math.sin(ph), -Math.sin(th), Math.cos(th) * Math.cos(ph)]);
  const e = cross(n, d);
  return { p, n, d, e };
}
// repère d'une plume plantée en (θ, φ), dressée de β (0 : selon la normale,
// π/2 : couchée sur la pente), roulée de ω autour de son axe
export function featherFrame(Rd, th, ph, beta, omega = 0, yaw = 0) {
  const { p, n, d: d0, e: e0 } = bodyFrame(Rd, th, ph);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const d = d0.map((v, i) => v * cy + e0[i] * sy), e = e0.map((v, i) => v * cy - d0[i] * sy);
  let Y = n.map((v, i) => v * Math.cos(beta) + d[i] * Math.sin(beta));
  let Z = n.map((v, i) => v * Math.sin(beta) - d[i] * Math.cos(beta));
  let X = cross(Y, Z);
  // roulis autour de Y (recouvrement latéral des tuiles)
  const co = Math.cos(omega), so = Math.sin(omega);
  const X2 = X.map((v, i) => v * co + Z[i] * so), Z2 = Z.map((v, i) => v * co - X[i] * so);
  X = X2; Z = Z2;
  void e;
  return { p, q: quatFromBasis(X, Y, Z), X, Y, Z, n };
}

// La plume couchée : soulevée de ε au-dessus de la pente (les rangées se
// recouvrent comme des tuiles), roulée de ω (recouvrement latéral)
export const LIE = { eps: 0.1, omega: 0.07, erect: 0.62 };
export const LIE_BETA = (radial) => (radial ? 0.85 : Math.PI / 2 - LIE.eps);
// (le duvet ne se couche pas : une houppe reste dressée, penchée vers la queue)
export const betaAt = (u, radial = false) => mix(LIE.erect, LIE_BETA(radial), settleAt(u));

// Plan du plumage : les plumes voisines en rangées décalées. La plume
// héroïne est la tuile (0, 0) ; les deux tuiles de la rangée du dessus qui
// couvriraient son follicule s'écartent (le tuyau sort entre elles).
export function layoutPlumage(P0, seed, { rows = [-8, 14], cols = 7, lite = false, tile = null } = {}) {
  const P = tile ?? P0; // (le plumage : les plumes voisines, pas forcément de la famille héroïne)
  let h = 2166136261;
  for (const ch of `plumage:${seed}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const Rd = P.L * FAMILIES[P.family].dome, thH = 0.72;
  const len = P.L;
  // (on ne voit que le bout de chaque plume : la rangée suivante recouvre plus des deux tiers)
  const rowStep = P.radial ? P.L * 0.38 : len * (P.eye ? 0.26 : 0.3);
  const colStep = P.radial ? P.L * 0.42 : Math.max(P.W, P.L * 0.22) * (P.eye ? 0.72 : 0.56);
  const tiles = [];
  for (let k = rows[0]; k <= rows[1]; k++) {
    const th = thH + (k * rowStep) / Rd;
    if (th < 0.06 || th > 1.62) continue;
    const ring = Rd * Math.sin(th);
    for (let j = -cols; j <= cols; j++) {
      if (k === 0 && j === 0) continue; // (la plume héroïne)
      let b = (j + (k & 1 ? 0.5 : 0)) * colStep;
      const ph = b / ring;
      if (Math.abs(ph) > 1.25) continue;
      tiles.push({ th, ph, k, j, scale: 0.9 + 0.14 * rnd(), wear: 0.1 + 0.3 * rnd(), rnd: rnd(), yaw: (rnd() - 0.5) * 0.05 });
    }
  }
  if (lite) for (let i = tiles.length - 1; i >= 0; i--) if (Math.abs(tiles[i].ph) > 0.8 || tiles[i].k > 5) tiles.splice(i, 1);
  return { Rd, thH, rowStep, colStep, tiles };
}

// La plume ancienne, chassée : poussée (le tuyau la soulève), puis libre,
// elle glisse sur le dos de l'oiseau — le long du méridien, au-dessus des
// rangées — et disparaît derrière la courbe du corps (ralenti ×8 : une caméra
// rapide ; la croissance s'arrête pendant ce temps).
// Rend { th (angle polaire de sa base), lift (cm, selon la normale), tilt
// (rad, autour de l'axe latéral), roll, gone, base (hauteur du contact) }
export const FALL_SLOWMO = 8;
// pointe du tuyau nouveau dans le monde (pendant la poussée, il est droit)
export function pinTip(u, P, lay) {
  const fr = featherFrame(lay.Rd, lay.thH, 0, betaAt(u, P.radial), 0);
  const h = Math.max(0, P.L - sinkAt(u, P.L, P.calamus, P.over));
  return qrot(fr.q, [0, h, 0]).map((v, i) => v + fr.p[i]);
}
export function ejection(u, P, lay) {
  const { thH, Rd } = lay;
  const { p: root, n } = bodyFrame(Rd, thH, 0);
  // le contact : la base de l'ancienne plume repose sur la pointe du tuyau ;
  // elle bascule pour que sa pointe à elle reste sur le plumage
  const pose = (uu) => {
    const tw = pinTip(Math.min(uu, SCHED.push[1]), P, lay);
    const D = tw.map((v, i) => v - root[i]);
    const dn = D[0] * n[0] + D[1] * n[1] + D[2] * n[2];
    return { D, tilt: Math.asin(clamp(dn / (P.L * 0.9), 0, 0.9)) };
  };
  if (u <= SCHED.fall[0]) {
    const { D, tilt } = pose(u);
    return { th: thH, off: D, tilt, roll: 0, gone: false, base: D };
  }
  // temps réel (s) depuis qu'elle est libre ; durée de la boucle de référence : 36 s
  const T = ((u - SCHED.fall[0]) * 36) / FALL_SLOWMO;
  // glissement d'une plume sur des plumes : a = g (sin θ − μ cos θ), μ = 0,45
  const mu = 0.45, acc = 981 * Math.max(0.05, Math.sin(thH) - mu * Math.cos(thH));
  const sl = 0.5 * acc * T * T; // cm, le long du corps
  const th = thH + sl / Rd;
  // (au départ, exactement la pose de la fin de la poussée : pas de saut ;
  // elle retombe à plat sur le plumage en glissant, et oscille un peu)
  const { D: D1, tilt: a1 } = pose(SCHED.fall[0]);
  const k = sstep(0, 0.12, T);
  const nt = bodyFrame(Rd, th, 0).n;
  const off = D1.map((v, i) => v * (1 - k) + nt[i] * 0.25 * k);
  const roll = 0.18 * sstep(0.05, 0.2, T) * Math.sin(T * 22) * sstep(0, 0.05, T);
  // (elle n'est retirée qu'une fois passée derrière la courbe du dos, à
  // 1,3 rad du follicule : la caméra, du côté de la tête, ne la voit plus)
  return { th, off, tilt: a1 * (1 - k), roll, gone: sl / Rd > 1.3, base: null };
}

// ── Le contact : le tuyau soulève puis fend les plumes qui le recouvrent ─────
// Les plumes des rangées du dessus couvrent le follicule ; le tuyau qui sort
// passe dessous, puis à travers. Pour chaque voisine, à chaque instant, on
// exprime l'axe du tuyau dans le repère de la voisine (rachis courbé compris) :
//   - tant que la pointe est dessous, la voisine se drape sur elle : une tente
//     dont la hauteur est juste ce qu'il faut pour passer au-dessus de la
//     pointe et de son rayon (0 quand la pointe est loin) ;
//   - quand la pointe perce la surface, la voisine se fend le long de ses
//     barbes, progressivement (la fente s'ouvre sur les 5 premiers mm de
//     percée), et retombe à moitié sur le tuyau qui la traverse ;
//   - tout s'éteint en douceur quand le point de contact sort de la voisine
//     ou rejoint la peau (pendant que la plume se couche).
// Aucune grandeur ne saute d'une image à l'autre : c'est une fonction continue
// du temps (vérifié image par image dans les tests). La voisine ne pivote
// pas en bloc : seules ses barbes bougent, autour du contact.
export const CONTACT = { margin: 0.16, open: 0.5, fade: 0.6 };

// tube effectif autour de l'axe, à la hauteur s : roulé, la gaine ; déroulé,
// la base du vexille qui fend la plume du dessus
export const contactRadius = (P, u, s) => {
  const lam = Math.min(1, unroll(u, s));
  return tubeRadius(P, s) * (1 - lam) + lam * 0.45 * (halfWidth(P, s, 1) + halfWidth(P, s, -1)) * 0.5 + 0.08;
};

// décalage d'un point (repère local de la voisine, non mis à l'échelle) par le
// contact K = [étendue, x0, y0, r] et Q = [fente 0–1, hauteur de tente (cm)].
// La plume se fend le long de ses barbes (une raie, comme une chevelure) : le
// décalage est latéral, plein au droit du tuyau, et s'éteint vers sa base en
// un rayon, vers sa pointe sur la longueur où le tuyau la longe ; la tente
// soulève les barbes autour du contact.
export function contactPush(p, K, Q) {
  const [ext, x0, y0, r] = K, [split, tent] = Q;
  if (!(split > 0) && !(tent > 0)) return p;
  const dx = p[0] - x0, dy = p[1] - y0, ax = Math.abs(dx);
  const along = dy >= 0 ? 1 - sstep(Math.max(ext, 1e-3) * 0.7, Math.max(ext, 1e-3), dy) : 1 - sstep(r * 0.5, r + 0.4, -dy);
  const push = Math.max(0, r + CONTACT.margin - ax) * along * split;
  const lift = tent * along * (1 - sstep(r, r + 1.2, ax));
  // (le côté de la fente s'adoucit sur 0,15 mm : une barbe pile au droit du
  // tuyau ne saute pas d'un côté à l'autre quand le contact glisse ; celle-là
  // passe par-dessus le tuyau)
  const sg = clamp(dx / 0.015, -1, 1);
  const over = (r + CONTACT.margin) * (1 - Math.abs(sg)) * along * split;
  return [p[0] + sg * push, p[1], p[2] + lift + over];
}

const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const NOCONTACT = () => ({ ext: 0, x0: 0, y0: 0, r: 0, split: 0, tent: 0 });
// Les contacts de toutes les voisines à l'instant u (T : la forme des voisines).
export function tileContacts(P, lay, u, tile = null) {
  const T = tile ?? P;
  const out = lay.tiles.map(NOCONTACT);
  if (P.radial || growth(u, P.L) <= 0) return out;
  const fr = featherFrame(lay.Rd, lay.thH, 0, betaAt(u, P.radial), LIE.omega * settleAt(u));
  const k = bendOf(P, lay.Rd), S = { u, L: P.L, k, cal: P.calamus, radial: false, over: P.over };
  // l'axe du tuyau, dans le monde, échantillonné exactement de la peau à la
  // pointe (des points fixes en s feraient naître le contact d'un coup, quand
  // le deuxième point sort de la peau)
  const sSkin = sinkAt(u, P.L, P.calamus, P.over) / P.L;
  if (sSkin >= 1) return out;
  const axis = [];
  for (let i = 0; i <= 64; i++) {
    const s = Math.max(0, sSkin) + (1 - Math.max(0, sSkin)) * (i / 64) + (i === 0 ? 1e-6 : 0), r = rachisPoint(Math.min(1, s), S);
    axis.push({ s: Math.min(1, s), w: qrot(fr.q, r.p).map((v, j) => v + fr.p[j]) });
  }
  const kt = bendOf(T, lay.Rd), root = fr.p, reach = (P.L + T.L) * 1.1;
  lay.tiles.forEach((t, j) => {
    const f = featherFrame(lay.Rd, t.th, t.ph, LIE_BETA(T.radial), LIE.omega, t.yaw);
    if (Math.hypot(f.p[0] - root[0], f.p[1] - root[1], f.p[2] - root[2]) > reach) return;
    const kl = kt * t.scale, iq = qinv(f.q);
    const loc = axis.map((a) => {
      const l = qrot(iq, a.w.map((v, i) => v - f.p[i])).map((v) => v / t.scale);
      return { s: a.s, l, h: l[2] + (1 - Math.cos(kl * l[1])) / Math.max(kl, 1e-6), len: 0 };
    });
    // (longueur sortie de la peau jusqu'à chaque point : continue dans le temps)
    for (const q of loc) q.len = Math.max(0, (q.s - sSkin) * P.L);
    const tip = loc[loc.length - 1];
    // le point de contact : où l'axe perce la surface en montant (le dernier, le plus près de la pointe)
    let c = null;
    for (let i = loc.length - 1; i > 0; i--) {
      const a = loc[i - 1], b = loc[i];
      if (a.h < 0 && b.h >= 0) {
        const m = a.h / (a.h - b.h);
        const dl = b.l.map((v, q) => v - a.l[q]), sinA = Math.abs(b.h - a.h) / Math.max(1e-6, Math.hypot(dl[0], dl[1], b.h - a.h));
        const sc = a.s + (b.s - a.s) * m;
        c = { x0: a.l[0] + dl[0] * m, y0: a.l[1] + dl[1] * m, s: sc, len: Math.max(0, (sc - sSkin) * P.L), sinA, pierced: true };
        break;
      }
    }
    if (!c) {
      // pas encore percée : seule la pointe qui arrive par-dessous la soulève
      // (un rachis couché sous la voisine ne la touche pas : les rangées sont
      // étagées pour cela)
      if (!(tip.h < 0)) return;
      const a = loc[loc.length - 2], dl = tip.l.map((v, q) => v - a.l[q]);
      const sinA = Math.abs(tip.h - a.h) / Math.max(1e-6, Math.hypot(dl[0], dl[1], tip.h - a.h));
      c = { x0: tip.l[0], y0: tip.l[1], s: tip.s, len: tip.len, depth: tip.h, sinA, pierced: false };
    }
    let r = 0;
    for (let q = -0.03; q <= 0.18; q += 0.03) r = Math.max(r, contactRadius(P, u, clamp(c.s + q, 0, 1)));
    r /= t.scale;
    // poids : le contact s'éteint en douceur hors de la voisine, et quand il rejoint la peau
    const sy = clamp(c.y0 / T.L, 0, 1);
    const halfW = Math.max(halfWidth(T, sy, 1), halfWidth(T, sy, -1));
    const wFoot = (1 - sstep(halfW + r, halfW + r + CONTACT.fade, Math.abs(c.x0))) * sstep(-CONTACT.fade, 0, c.y0) * (1 - sstep(T.L * 0.55, T.L * 1.0, c.y0)); // (vers sa pointe, la voisine se relâche progressivement : elle n'est plus tenue)
    // (drapée : le contact naît quand la pointe sort de la peau ; percée, il
    // reste plein jusqu'à la peau pendant la pousse — c'est là que la plume du
    // dessus couvre le follicule — et ne s'éteint en y arrivant que pendant
    // que la plume se couche, quand le point de percée glisse vers elle)
    const lying = smoother(SCHED.settle[0] - 0.08, SCHED.settle[0], u);
    const wSkin = sstep(0, 0.2, tip.len) * (c.pierced ? 1 - lying * (1 - sstep(0, CONTACT.fade, c.len)) : 1);
    // (le tuyau qui se couche devient parallèle à la voisine : le point de
    // percée file le long d'elle ; le contact s'éteint avec l'angle, qui, lui,
    // varie lentement)
    const wGraze = sstep(0.05, 0.25, c.sinA);
    // (couchée, la plume est à sa place dans sa rangée : plus aucun contact, comme
    // au début de la boucle)
    const wEnd = 1 - smoother(SCHED.settle[1] - 0.02, SCHED.settle[1] + 0.05, u);
    const w = wFoot * wSkin * wGraze * wEnd;
    if (!(w > 0)) return;
    let split, tent;
    if (c.pierced) {
      // la fente s'ouvre à mesure que la pointe dépasse la surface ; la plume retombe à moitié
      // (quand la plume se couche, le tuyau glisse sous la voisine : la fente se
      // referme et la voisine se drape sur lui — une barbe au droit du tuyau
      // changerait sinon de côté de la fente d'une image à l'autre)
      const p = sstep(0, CONTACT.open, tip.h) * (1 - smoother(SCHED.settle[0] - 0.06, SCHED.settle[0] + 0.08, u));
      split = p; tent = (r + CONTACT.margin) * (1 - 0.5 * p);
    } else {
      // drapée sur la pointe : juste assez haute pour passer au-dessus
      split = 0; tent = Math.max(0, r + CONTACT.margin + c.depth);
    }
    out[j] = { ext: r / Math.max(c.sinA, 0.1) + 0.8, x0: c.x0, y0: c.y0, r, split: split * w, tent: tent * w };
  });
  return out;
}
