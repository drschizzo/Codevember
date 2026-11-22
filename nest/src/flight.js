// La chorégraphie des guêpes, en temps physique t (secondes).
//
// Module pur (Node, page). Chaque ouvrière vit un cycle de période Tᵢ : elle
// arrive d'un point lointain, se pose sur le front de construction (ou entre
// par le trou de vol), marche, repart. Pendant les ralentis du film, t avance
// en temps réel : elles volent et marchent ; dans l'accéléré, t saute de
// plusieurs heures d'une image à l'autre : chaque image en saisit d'autres, à
// d'autres places — l'essaim d'un vrai accéléré photographique. Rien n'est
// intégré d'une image à l'autre : la pose est une fonction de t.
//
// La reine (printemps) : elle arrive en temps réel, se pose sur la poutre,
// puis travaille autour du pétiole et du premier rayon.

const TAU = 2 * Math.PI;
const fract = (x) => x - Math.floor(x);
const hash = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const bez = (p0, p1, p2, p3, t) => { const s = 1 - t; return add(add(mul(p0, s * s * s), mul(p1, 3 * s * s * t)), add(mul(p2, 3 * s * t * t), mul(p3, t * t * t))); };

// quaternion d'un repère (avant = x, haut = y)
export function frameQuat(f, up) {
  const x = norm(f), z = norm(cross(x, up)), y = cross(z, x);
  const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  return q;
}

// Le nid à la saison s : l'enveloppe extérieure (ellipsoïde de la plus grande
// cloche commencée), le front de construction et le trou de vol
export function nestShape(spec, P, s) {
  let B = null, g = 0;
  for (const b of P.bells) if (s >= b.s0) { B = b; g = Math.min(1, (s - b.s0) / (b.s1 - b.s0)); }
  if (!B) return null;
  const lam = B.lam, flat = sstep(0.25, 0.9, lam);
  const a = spec.a * lam, b = spec.b * lam;
  const yTop = b * (0.985 - (0.985 - spec.yBeam / spec.b) * flat * (spec.topK ?? 1));
  const cy = spec.yBeam - yTop;
  const thTop = Math.acos(Math.min(1, yTop / b));
  // la coque visible : la cloche précédente sous le front de la nouvelle
  const prev = P.bells[B.k - 1];
  return { k: B.k, a, b, cy, lam, g, thTop, thFront: thTop + g * (Math.PI - thTop), prev: prev ? prev.lam / lam : 0 };
}
// Carte du relief d'une cloche : rayon maximal du dessus des écailles autour
// de son centre, sur une grille (θ, φ), prise au maximum sur une case voisine
export function reliefMap(position, W = 160, H = 80) {
  const data = new Float32Array(W * H);
  for (let v = 0; v < position.length / 3; v++) {
    const x = position[v * 3], y = position[v * 3 + 1], z = position[v * 3 + 2], r = Math.hypot(x, y, z);
    const j = Math.min(H - 1, Math.floor((Math.acos(Math.max(-1, Math.min(1, y / r))) / Math.PI) * H)), i = Math.floor(((Math.atan2(z, x) + Math.PI) / TAU) * W) % W;
    if (r > data[j * W + i]) data[j * W + i] = r;
  }
  const out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let m = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const jj = j + dj; if (jj < 0 || jj >= H) continue; m = Math.max(m, data[jj * W + ((i + di + W) % W)]); }
    out[j * W + i] = m;
  }
  return { W, H, data: out };
}
function reliefAt(M, th, ph) {
  const j = Math.min(M.H - 1, Math.max(0, Math.floor((th / Math.PI) * M.H))), i = ((Math.floor(((ph + Math.PI) / TAU) * M.W) % M.W) + M.W) % M.W;
  return M.data[j * M.W + i];
}
export function surfacePoint(N, th, ph, lift = 0) {
  const d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
  let r = 1 / Math.sqrt((d[0] * d[0] + d[2] * d[2]) / (N.a * N.a) + (d[1] * d[1]) / (N.b * N.b));
  // (le relief réel : le dessus des écailles, carte de la cloche — sinon les
  // pattes et le gastre entraient dans les écailles relevées)
  if (N.map) r = Math.max(r, reliefAt(N.map, th, ph));
  const p = [d[0] * r, d[1] * r + N.cy, d[2] * r];
  const n = norm([p[0] / (N.a * N.a), (p[1] - N.cy) / (N.b * N.b), p[2] / (N.a * N.a)]);
  return { p: add(p, mul(n, lift)), n };
}

// L'état d'une ouvrière i au temps t ; null si elle n'est pas là
function worker(i, t, N, scale) {
  const T = 9 + 9 * hash(i * 3.1), off = hash(i * 7.7) * 997;
  const x = (t + off) / T, cyc = Math.floor(x), tau = x - cyc;
  const h = (k) => hash(i * 13.37 + cyc * 7.13 + k);
  const R0 = Math.max(N.a, N.b) * 1.7 + 0.35; // (elles volent près du nid : on les voit)
  const far = (k) => { const az = h(k) * TAU, el = -0.25 + h(k + 1) * 0.6; return [Math.cos(az) * Math.cos(el) * R0, N.cy + Math.sin(el) * R0, Math.sin(az) * Math.cos(el) * R0]; };
  const intoHole = h(9) < 0.2;
  // point de pose : sur le front (juste au-dessus du bord de la cloche qui pousse) ou au trou de vol
  const th = intoHole ? Math.PI - 0.12 : Math.max(N.thTop + 0.15, N.thFront - 0.05 - h(4) * 0.25);
  const ph = h(5) * TAU, ph2 = ph + (h(6) - 0.5) * 0.25;
  const L0 = surfacePoint(N, th, ph, (LEG_H + 0.003) * scale), L1 = surfacePoint(N, Math.min(Math.PI - 0.1, th + (h(7) - 0.3) * 0.08), ph2, (LEG_H + 0.003) * scale); // (sur le relief réel des écailles)
  const F0 = far(1), F1 = far(3);
  const s = 1.0 * scale;
  if (tau < 0.2) { // arrivée : courbe de Bézier, ralentit à l'approche, se pose
    const u = sstep(0, 1, tau / 0.2);
    const p = bez(F0, lerp(F0, L0.p, 0.4), add(L0.p, mul(L0.n, 0.25 * scale)), L0.p, u);
    const pE = bez(F0, lerp(F0, L0.p, 0.4), add(L0.p, mul(L0.n, 0.25 * scale)), L0.p, Math.min(1, u + 0.01));
    const v = sub(pE, p), fly = 1 - sstep(0.85, 1, tau / 0.2);
    const f = len(v) > 1e-6 ? v : mul(L0.n, -1);
    const up = norm(lerp([0, 1, 0], L0.n, 1 - fly));
    return { p, q: frameQuat(f, up), s, pose: [t * TAU * 3, fly, t * TAU * 150, 1 - fly] };
  }
  if (tau < 0.85) { // marche sur l'enveloppe (ou entrée dans le nid)
    const u = (tau - 0.2) / 0.65;
    if (intoHole && u > 0.25 && u < 0.75) return null;
    const P0 = lerp(L0.p, L1.p, u), n = norm(lerp(L0.n, L1.n, u));
    let f = sub(L1.p, L0.p); if (len(f) < 1e-5) f = cross(n, [0, 1, 0]);
    f = sub(f, mul(n, f[0] * n[0] + f[1] * n[1] + f[2] * n[2]));
    return { p: P0, q: frameQuat(f, n), s, pose: [(u * len(sub(L1.p, L0.p)) / 0.034) * TAU, 0, 0, 1], ext: [t * TAU * 2.5 * h(11), t * TAU * 1.3, Math.sin(t * 1.7 + i) * 0.5, t * TAU * 1.1] };
  }
  const u = sstep(0, 1, (tau - 0.85) / 0.15); // envol
  const p = bez(L1.p, add(L1.p, mul(L1.n, 0.3 * scale)), lerp(L1.p, F1, 0.6), F1, u);
  const pE = bez(L1.p, add(L1.p, mul(L1.n, 0.3 * scale)), lerp(L1.p, F1, 0.6), F1, Math.min(1, u + 0.01));
  const fly = sstep(0, 0.12, (tau - 0.85) / 0.15);
  return { p, q: frameQuat(sub(pE, p), norm(lerp(L1.n, [0, 1, 0], fly))), s, pose: [t * TAU * 3, fly, t * TAU * 150, 1 - fly] };
}

// Hauteur du corps au-dessus de la surface où elle se tient : le bout des
// tarses (y = −0,026 dans le repère de la guêpe) touche la surface
export const LEG_H = 0.025;

// La reine : arrivée en temps réel (tLand : instant où ses pattes touchent la
// poutre), retournement, quelques pas jusqu'au site (la foulée suit la
// distance parcourue : aucun glissement), puis le travail : elle mâche la
// pâte contre le pétiole, la tête qui va et vient. Dans l'accéléré, elle se
// tient autour du rayon qu'elle bâtit.
const QS = 1.35;
const QH = LEG_H * QS;
// le bout des mandibules, dans le repère de la guêpe (×QS) : c'est lui qui
// touche le papier, jamais la tête ni le thorax
export const QUEEN_REACH = 0.0735 * QS;
// rayon du chantier à l'instant s : le pétiole, puis chaque alvéole dès sa
// naissance au plus tôt (gen/comb.js : centre, hexagone évasé, penché vers
// l'extérieur) — la reine travaille à son bord, jamais dedans
export function combExtent(s, s0, s1, n = 12, pitch = 0.052) {
  const span = s1 - s0, t0 = s0 + span * 0.1, tc = (span * 0.9) / n;
  let r = 0.0085; // (le pétiole à hauteur de mâchoires)
  // (son pied s'évase en plaque à hauteur de la tête : elle recule d'autant)
  if (s > s0 + span * 0.12 * 0.6) r = 0.0145;
  const C = cellCenters(n, pitch);
  for (let i = 0; i < n; i++) {
    if (s < t0 + i * tc * 0.8) break;
    const rr = Math.hypot(C[i][0], C[i][1]);
    r = Math.max(r, rr + (pitch / Math.sqrt(3)) * 1.16 * 1.04 + (0.9 * rr + 0.04) * 0.054 + 0.002);
  }
  return r;
}
const HEADING = norm([-0.87, 0, -0.49]); // (elle arrive de ce côté : l'axe du pétiole devant elle)
function queen(t, tLand, yBeam, comb, onComb) {
  const y = yBeam - QH;
  // le site : ses mandibules au contact du pétiole (pas le pétiole sous elle)
  const site = [-HEADING[0] * (QUEEN_REACH + 0.0085), y, -HEADING[2] * (QUEEN_REACH + 0.0085)];
  const land = [site[0] - HEADING[0] * 0.06, y, site[2] - HEADING[2] * 0.06];
  const toSite = HEADING;
  if (t < tLand) { // elle arrive du fond (côté mur, loin de l'objectif) en descendant, ralentit, se retourne sous la poutre
    const u = Math.max(0, 1 - (tLand - t) / 2.4);
    if (u <= 0) return null;
    const F = [-0.9, yBeam - 0.5, -0.7], c1 = [-0.4, yBeam - 0.36, -0.35], c2 = [land[0] + 0.05, yBeam - 0.14, land[2] - 0.04];
    const k = 1 - (1 - u) ** 2.2; // (elle freine à l'approche)
    const p = bez(F, c1, c2, land, k), pE = bez(F, c1, c2, land, Math.min(1, k + 0.004));
    let f = sub(pE, p); if (len(f) < 1e-6) f = toSite;
    const flip = sstep(0.72, 1, u); // (le dos vers le bas : les pattes cherchent le bois)
    const fwd = norm(lerp(norm(f), toSite, flip));
    const up = norm(lerp([0, 1, 0.25], [0, -1, 0], flip));
    return { p, q: frameQuat(fwd, up), s: QS, pose: [t * TAU * 2.5, 1 - sstep(0.9, 1, u), t * TAU * 120, sstep(0.9, 1, u)] };
  }
  const dt = t - tLand, walkT = 1.6, dist = len(sub(site, land));
  if (dt < walkT) { // quelques pas jusqu'au site : la foulée suit la distance
    const q = sstep(0, 1, dt / walkT), d = q * dist;
    const p = lerp(land, site, q);
    return { p, q: frameQuat(toSite, [0, -1, 0]), s: QS, pose: [(d / 0.046) * TAU, 0, 0, 1], ext: [0, dt * TAU * 1.6, 0.3 * Math.sin(dt * 2), dt * TAU * 1.2] };
  }
  if (!onComb) {
    // au site, elle râpe le bois de la poutre (c'est sa pâte) : par coups de
    // 1,1 s — elle recule de 1,6 mm en arrachant une fibre, la tête basse,
    // les mandibules au travail, les antennes sur le bois ; une pause où la
    // tête balaie ; un pas en avant pour reprendre au même endroit. Les pattes
    // suivent le chemin parcouru (aller et retour comptés : pas de glissement)
    const w = dt - walkT, PER = 1.1, n = Math.floor(w / PER), f = w / PER - n, D = 0.016;
    const back = sstep(0, 0.55, f) * (1 - sstep(0.8, 1, f));
    const travelled = n * 2 * D + D * (sstep(0, 0.55, f) + sstep(0.8, 1, f));
    const scrape = f < 0.55 ? 1 : 0, pause = sstep(0.55, 0.62, f) * (1 - sstep(0.76, 0.8, f));
    const p = [site[0] - toSite[0] * D * back, y, site[2] - toSite[2] * D * back];
    return {
      p, q: frameQuat(toSite, [0, -1, 0]), s: QS, pose: [((dist + travelled) / 0.046) * TAU, 0, 0, 1], // (la phase continue celle des pas jusqu'au site)
      ext: [w * TAU * (2 + 2.5 * scrape), w * TAU * (1.1 + 1.2 * scrape), pause * Math.sin(w * TAU * 1.4) * 0.7, w * TAU * 1.2],
      ext3: [0, 0, 0, 0.3 + 0.6 * scrape],
    };
  }
  // l'accéléré : à chaque prise de vue, elle est ailleurs au bord du rayon, les
  // mandibules sur la paroi qu'elle allonge ; le rayon s'élargit, elle recule
  const cyc = Math.floor(dt / 23), h = (k) => hash(cyc * 3.7 + k);
  // (du côté du rayon opposé à la caméra, qui est côté +z : jamais devant l'objectif)
  const a = Math.PI + 0.35 + h(1) * (Math.PI - 0.7), r = comb.r + QUEEN_REACH + 0.001 + h(2) * 0.004;
  const p = [Math.cos(a) * r, y, Math.sin(a) * r];
  const f = norm([-Math.cos(a), 0, -Math.sin(a)]);
  return { p, q: frameQuat(f, [0, -1, 0]), s: QS, pose: [h(5) * TAU, 0, 0, 1] };
}

// Toutes les guêpes à la phase u : un tableau par emplacement (0 : la reine,
// 1… : les ouvrières), null pour une guêpe absente — l'image précédente se
// calcule par les mêmes emplacements (vecteurs vitesse)
export function waspsAt(u, clock, P, spec, nMax = 110, maps = null) {
  const s = clock.s(u), t = clock.t(u);
  const out = new Array(nMax + 1).fill(null);
  // reine : de son arrivée jusqu'à ce que la cloche 0 se ferme
  const tLand = clock.t(0.05) - 0.4;
  if (s < P.bells[0].s1 && (u < 0.5)) {
    out[0] = queen(t, tLand, spec.yBeam, { r: combExtent(s, P.queen, P.comb) }, s - P.queen > 2e-4);
  }
  const N = nestShape(spec, P, s);
  if (N && maps) N.map = maps[N.k] ?? null;
  const col = colony(s, P);
  if (N && col > 0) {
    const n = Math.round(col * nMax);
    for (let i = 0; i < n; i++) out[i + 1] = worker(i, t, N, 1);
  }
  return out;
}

import { colony } from './season.js';
import { cellCenters } from './gen/comb.js';
