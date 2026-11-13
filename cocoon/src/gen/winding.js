// Le cœur de Cocoon : le chemin du ruban sur la cage, et le dépôt du fil.
//
// 1. Chemins (dans la carte (σ, φ) de la paroi, σ abscisse curviligne du
//    méridien) : géodésiques de Clairaut (r·sin α = c) avec un séjour aux
//    pôles qui referme le motif après N circuits, cerclage en hélice, boucles
//    en huit (la bave du ver à soie), raccords lisses entre régimes. Un seul
//    ruban continu, du premier au dernier point.
// 2. Dépôt : le ruban (n fils jointifs) se pose sur une carte de hauteur ;
//    chaque fil repose sur ce qui est déjà là (maximum sous son empreinte +
//    demi-épaisseur, lissé le long du fil) puis l'élève de sa section ronde :
//    aucun fil ne traverse un fil posé avant lui, par construction.
// 3. Transmission : pour chaque cellule de la carte, les « instants » s (part
//    du ruban posée, ∈ [0, 1]) des quatre premiers fils qui la couvrent. La
//    paroi à l'instant S laisse passer τ^(nombre de s_k < S) : c'est ce que
//    lisent les murs, la brume et l'autre lanterne.
//
// Module pur (sans three) : worker, tests et bancs d'essai Node.
import { makeProfile, wallPoint } from './profile.js';

const TAU = Math.PI * 2;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const mod = (x, m) => ((x % m) + m) % m;

// ── 1. Chemins ───────────────────────────────────────────────────────────────

// Une demi-géodésique de Clairaut entre les deux parallèles r = c : φ(σ)
// intégré avec la substitution σ = a + (b − a)(1 − cos πx)/2, qui rend
// l'intégrande fini aux points de rebroussement (où il diverge en 1/√).
export function geodesicHalf(P, c, m = 1200) {
  const a = P.sigmaAtR(c, -1), b = P.sigmaAtR(c, +1);
  const sig = new Float64Array(m + 1), phi = new Float64Array(m + 1);
  let acc = 0, prev = 0;
  for (let i = 0; i <= m; i++) {
    const x = i / m, s = a + ((b - a) * (1 - Math.cos(Math.PI * x))) / 2;
    const dsdx = ((b - a) * Math.PI * Math.sin(Math.PI * x)) / 2;
    const r = P.rAt(s), q = Math.max(1e-9, r * r - c * c);
    const f = (c / (r * Math.sqrt(q))) * dsdx;
    if (i) acc += 0.5 * (f + prev) / m;
    prev = Number.isFinite(f) ? f : prev;
    sig[i] = s; phi[i] = acc;
  }
  return { a, b, sig, phi, dphi: acc };
}

// Accumulateur de chemin : points (σ, φ) denses, régimes, puis rééchantillonnage
// à pas constant dans la métrique de la paroi.
class PathBuilder {
  constructor(P) { this.P = P; this.s = []; this.p = []; this.marks = []; }
  get last() { const n = this.s.length; return n ? [this.s[n - 1], this.p[n - 1]] : null; }
  push(s, p) { this.s.push(s); this.p.push(p); }
  mark(name) { this.marks.push({ name, i: this.s.length }); }
  // raccord lisse vers (s1, φ1) : σ en smoothstep, φ linéaire (sens +φ)
  bridge(s1, p1, n = 60) {
    const [s0, p0] = this.last;
    for (let i = 1; i <= n; i++) {
      const x = i / n, e = x * x * (3 - 2 * x);
      this.push(s0 + (s1 - s0) * e, p0 + (p1 - p0) * x);
    }
  }
  // longueur métrique d'un pas
  dl(i) {
    const s0 = this.s[i - 1], s1 = this.s[i], r = this.P.rAt((s0 + s1) / 2);
    return Math.hypot(s1 - s0, r * (this.p[i] - this.p[i - 1]));
  }
  // rééchantillonnage à pas `step` (m) : tableaux σ, φ, longueur cumulée
  resample(step) {
    const n = this.s.length, L = new Float64Array(n);
    for (let i = 1; i < n; i++) L[i] = L[i - 1] + this.dl(i);
    const total = L[n - 1], m = Math.max(2, Math.round(total / step) + 1);
    const S = new Float64Array(m), F = new Float64Array(m);
    let j = 0;
    for (let k = 0; k < m; k++) {
      const l = (k / (m - 1)) * total;
      while (j < n - 2 && L[j + 1] < l) j++;
      const f = (l - L[j]) / Math.max(1e-12, L[j + 1] - L[j]);
      S[k] = this.s[j] + (this.s[j + 1] - this.s[j]) * f;
      F[k] = this.p[j] + (this.p[j + 1] - this.p[j]) * f;
    }
    const marks = this.marks.map((mk) => ({ name: mk.name, s: L[Math.min(n - 1, mk.i)] / total }));
    return { sig: S, phi: F, total, marks };
  }
}

// Couche géodésique : N circuits (montée, séjour en haut, descente, séjour en
// bas). L'avance par circuit est Δ = 2π·p/N (motif qui se referme après N
// circuits, p premier avec N) ; le séjour aux pôles (le long du parallèle
// r = c) comble l'écart entre l'avance naturelle 2·Δφ½ et Δ.
export function choosePattern(dphiHalf, N, target = 0.382, maxDwell = 0.9) {
  let best = null;
  for (let p = 1; p < N; p++) {
    if (gcd(p, N) !== 1) continue;
    const dwell = mod((TAU * p) / N - 2 * dphiHalf, TAU);
    const cost = Math.abs(p / N - target) * 4 + (dwell > maxDwell ? 10 + dwell : dwell * 0.3);
    if (!best || cost < best.cost) best = { p, dwell, cost };
  }
  return best;
}

function geodesicLayer(B, P, { c, N, p = null, advance = null, target = 0.382, dwellMin = 0.05 }) {
  const G = geodesicHalf(P, c);
  let dwell;
  if (advance != null) dwell = mod(advance - 2 * G.dphi, TAU);
  else {
    const pat = p ? { p, dwell: mod((TAU * p) / N - 2 * G.dphi, TAU) } : choosePattern(G.dphi, N, target);
    dwell = pat.dwell;
  }
  if (dwell < dwellMin) dwell += TAU; // (jamais de demi-tour sec au pôle)
  dwell = Math.min(dwell, TAU + 1);
  const h = G.sig.length - 1;
  // départ : on rejoint le parallèle bas de cette couche
  const start = B.last;
  let phi0 = start ? start[1] + 0.35 : 0;
  if (start) B.bridge(G.a, phi0, 90);
  else B.push(G.a, phi0);
  const dwellArc = (s, from, amount) => {
    const n = Math.max(4, Math.ceil((amount * P.rAt(s)) / 0.002));
    for (let i = 1; i <= n; i++) B.push(s, from + (amount * i) / n);
  };
  for (let k = 0; k < N; k++) {
    for (let i = 1; i <= h; i++) B.push(G.sig[i], phi0 + G.phi[i]);
    let ph = phi0 + G.dphi;
    dwellArc(G.b, ph, dwell / 2); ph += dwell / 2;
    for (let i = h - 1; i >= 0; i--) B.push(G.sig[i], ph + (G.dphi - G.phi[i]));
    ph += G.dphi;
    dwellArc(G.a, ph, dwell / 2); ph += dwell / 2;
    phi0 = ph;
  }
  return { c, N, dwell, dphiHalf: G.dphi };
}

// Cerclage : hélice de pas `pitch` de σ0 à σ1 (sens +φ), précédée d'un raccord.
function hoop(B, P, s0, s1, pitch) {
  const [, p0] = B.last;
  B.bridge(s0, p0 + 0.8, 80);
  const [, pa] = B.last;
  const turns = Math.abs(s1 - s0) / pitch;
  const n = Math.ceil(turns * 400);
  for (let i = 1; i <= n; i++) { const x = i / n; B.push(s0 + (s1 - s0) * x, pa + TAU * turns * x); }
}

// Zone où un cerclage tient par frottement : pente du méridien |dr/dσ| ≤ μ
function hoopZone(P, mu) {
  let a = P.sEq, b = P.sEq;
  while (a > P.sLo && Math.abs(P.drAt(a)) <= mu) a -= P.ds;
  while (b < P.sHi && Math.abs(P.drAt(b)) <= mu) b += P.ds;
  return [a, b];
}

// Boucles en huit : un balayage lent (le corps du ver qui avance autour de la
// paroi en hélice, d'un pôle à l'autre puis retour) et, en travers, une
// lemniscate de Gerono (la tête qui bat). Une boucle de longueur ℓ8 ≈ 5,2·A
// couvre ℓ8·wb ; pour k couches par passage sur une bande de largeur 2A, le
// pas d'une boucle à l'autre vaut a = ℓ8·wb / (2A·k) ≈ 2,6·wb / k.
function figureEight(B, P, { amp, wb, k = 1.15, passes = 2, sMargin }) {
  const lo = P.sLo + sMargin, hi = P.sHi - sMargin;
  const a = (2.6 * wb) / k;          // pas d'une boucle le long du balayage (m)
  const pitch = 2 * amp * 0.92;      // pas de l'hélice de balayage (en σ, par tour)
  const per = 40;                    // points par boucle avant rééchantillonnage
  const [, p0] = B.last;
  let sc = lo, phiC = p0 + 0.7;
  B.bridge(sc, phiC, 60);
  let dir = 1, th = 0, done = 0;
  while (done < passes) {
    // un pas de boucle : le centre avance de a/per dans la métrique
    const rc = Math.max(0.02, P.rAt(sc));
    const slope = (dir * pitch) / (2 * Math.PI * rc); // dσ / (r dφ)
    const n = Math.hypot(1, slope), da = a / per;
    const dS = (da * slope) / n, dP = da / n / rc;
    sc += dS; phiC += dP;
    if ((dir > 0 && sc >= hi) || (dir < 0 && sc <= lo)) { sc = dir > 0 ? hi : lo; dir = -dir; done++; }
    const e1s = slope / n, e1p = 1 / n, e2s = -e1p, e2p = e1s; // (e1 le long, e2 en travers)
    th += (2 * Math.PI) / per;
    const A = amp * Math.min(1, (rc / (amp * 1.6))); // (boucles plus petites près des pôles)
    const ox = A * Math.sin(th), oy = 0.5 * A * Math.sin(2 * th);
    const os = e2s * ox + e1s * oy, op = e2p * ox + e1p * oy;
    const s = Math.min(P.sHi - 0.004, Math.max(P.sLo + 0.004, sc + os));
    B.push(s, phiC + op / Math.max(0.02, P.rAt(s)));
  }
}

// ── Familles : la suite des régimes de chaque façon d'enrouler ──────────────
export const FAMILIES = {
  losange: { label: 'Losange', note: 'géodésiques croisées en losanges qui se subdivisent' },
  cerclage: { label: 'Cerclage', note: 'côtes, hélice qui monte, renforts polaires' },
  huit: { label: 'Huit', note: 'boucles en huit, comme la bave du ver à soie' },
  meridien: { label: 'Méridien', note: 'enroulement polaire, un quartier qui se ferme' },
};

// Nombre de circuits d'une couche géodésique de paramètre c pour couvrir la
// paroi une fois (deux plis) avec un ruban de largeur wb
const coverN = (P, c, wb, k = 1.1) => Math.max(3, Math.ceil((TAU * P.rMax * Math.sqrt(Math.max(0.05, 1 - (c / P.rMax) ** 2)) / wb) * k));

export function buildPath(spec) {
  const P = makeProfile(spec.cage);
  const B = new PathBuilder(P);
  const wb = spec.band.width; // largeur du ruban (m)
  const cMin = P.hub + wb / 2 + 0.003;
  const F = spec.family;
  const layers = [];
  if (F === 'losange') {
    B.mark('armature');
    layers.push(geodesicLayer(B, P, { c: P.rMax * spec.wind.c1, N: spec.wind.n1, target: 3 / 8 }));
    B.mark('fermeture');
    const c2 = Math.max(cMin * 1.2, P.rMax * spec.wind.c2);
    layers.push(geodesicLayer(B, P, { c: c2, N: coverN(P, c2, wb), target: 0.382 }));
    B.mark('finition');
    layers.push(geodesicLayer(B, P, { c: cMin + wb * 0.4, N: Math.ceil(coverN(P, cMin, wb) * 0.32), target: 0.382 }));
    const [a, b] = hoopZone(P, 0.25);
    const m = (a + b) / 2, half = Math.min((b - a) / 2, wb * 1.6);
    hoop(B, P, m - half, m + half, wb * 0.96);
  } else if (F === 'meridien') {
    B.mark('armature');
    layers.push(geodesicLayer(B, P, { c: cMin, N: 3, advance: TAU / 6 + Math.PI }));
    B.mark('fermeture');
    const N = coverN(P, cMin, wb, 0.56);
    layers.push(geodesicLayer(B, P, { c: cMin, N, advance: Math.PI + (TAU / N) * 0.5 * 1.0 }));
    B.mark('finition');
    const c3 = P.rMax * 0.42;
    layers.push(geodesicLayer(B, P, { c: c3, N: Math.ceil(coverN(P, c3, wb) * 0.35), target: 0.5 }));
  } else if (F === 'cerclage') {
    B.mark('armature');
    const nr = spec.wind.ribs;
    layers.push(geodesicLayer(B, P, { c: cMin, N: nr, advance: Math.PI + Math.PI / nr }));
    B.mark('fermeture');
    const [a, b] = hoopZone(P, spec.wind.mu);
    hoop(B, P, a, b, wb * 0.97);
    B.mark('finition');
    layers.push(geodesicLayer(B, P, { c: cMin, N: Math.ceil(coverN(P, cMin, wb) * 0.5), target: 0.382 }));
  } else { // huit
    B.mark('armature');
    layers.push(geodesicLayer(B, P, { c: cMin, N: 3, advance: Math.PI + TAU / 9 }));
    B.mark('fermeture');
    figureEight(B, P, { amp: spec.wind.amp, wb, k: spec.wind.k ?? 1.15, passes: spec.wind.passes ?? 2, sMargin: spec.wind.amp * 0.55 });
    B.mark('finition');
    layers.push(geodesicLayer(B, P, { c: cMin, N: 4, advance: Math.PI + TAU / 11 }));
  }
  const path = B.resample(spec.step ?? 0.003);
  return { P, path, layers };
}

// ── 2 et 3. Dépôt sur la carte de hauteur, table de transmission ─────────────

// petit hachage déterministe (irrégularités du fil)
const hash = (i) => { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
const vnoise = (x, seed) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i * 7919 + seed) * (1 - u) + hash((i + 1) * 7919 + seed) * u; };

export function windCocoon(spec, onProgress = null) {
  const { P, path, layers } = buildPath(spec);
  const nb = spec.band.threads, d = spec.band.thread, pitch = d * (spec.band.gap ?? 1.04);
  const m = path.sig.length;
  // ── carte (σ, φ) ──
  const Ns = spec.grid?.ns ?? 1024, Np = spec.grid?.np ?? 2048;
  const cs = P.len / Ns, cp = TAU / Np;
  const H = new Float32Array(Ns * Np);       // hauteur du dessus (m, le long de la normale)
  const stamp = new Int32Array(Ns * Np).fill(-1 << 30); // pas du ruban qui a déposé
  const cook = new Float32Array(Ns * Np * 4).fill(2); // 4 premiers s (2 = vide)
  const cnt = new Uint8Array(Ns * Np);
  const lastK = new Int32Array(Ns * Np).fill(-1), lastJ = new Int32Array(Ns * Np).fill(-1 << 30);
  // cage : côtes en fil de rayon ρ ; entre deux côtes, le fil tendu fait une
  // corde (la paroi est un prisme à facettes, pas une surface lisse)
  const nRib = spec.cage.ribs, rho = spec.cage.wire / 2;
  for (let i = 0; i < Ns; i++) {
    const r = P.rAt((i + 0.5) * cs);
    for (let k = 0; k < Np; k++) {
      const ph = (k + 0.5) * cp, sec = TAU / nRib, dl = mod(ph, sec) - sec / 2;
      H[i * Np + k] = rho + r * (Math.cos(sec / 2) / Math.cos(dl) - 1);
    }
  }
  // ── fils : décalages latéraux dans le plan tangent ──
  const off = new Float64Array(nb);
  for (let k = 0; k < nb; k++) off[k] = (k - (nb - 1) / 2) * pitch;
  // tangente du ruban (dans la métrique) en chaque point
  const ts = new Float64Array(m), tp = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    const a = Math.max(0, j - 1), b = Math.min(m - 1, j + 1), r = P.rAt(path.sig[j]);
    const es = path.sig[b] - path.sig[a], ep = (path.phi[b] - path.phi[a]) * r, l = Math.hypot(es, ep) || 1;
    ts[j] = es / l; tp[j] = ep / l;
  }
  // coordonnées (σ, φ) de chaque fil (avec un léger flottement : le fil n'est
  // jamais parfaitement parallèle à ses voisins)
  const TS = new Float32Array(nb * m), TP = new Float32Array(nb * m);
  for (let k = 0; k < nb; k++) {
    for (let j = 0; j < m; j++) {
      const wob = (vnoise(j * 0.11, k * 31 + 7) - 0.5) * 0.22 * d;
      const o = off[k] + wob;
      const s = Math.min(P.sHi, Math.max(P.sLo, path.sig[j] + -tp[j] * o));
      const r = Math.max(0.01, P.rAt(s));
      TS[k * m + j] = s; TP[k * m + j] = path.phi[j] + (ts[j] * o) / r;
    }
  }
  const Hp = new Float32Array(nb * m), NB = new Uint8Array(nb * m);
  const rd = d / 2;
  // rastérise l'empreinte d'un segment de fil ; mode 0 : lire le maximum, 1 : déposer
  let readMax = 0;
  const seg = (k, j, mode, hTop, minStamp) => {
    const i0 = k * m + j - 1, i1 = i0 + 1;
    const s0 = TS[i0], s1 = TS[i1];
    let p0 = TP[i0], p1 = TP[i1];
    const r = Math.max(0.005, P.rAt((s0 + s1) / 2));
    const lo = Math.min(s0, s1) - rd, hi = Math.max(s0, s1) + rd;
    const ia = Math.max(0, Math.floor(lo / cs)), ib = Math.min(Ns - 1, Math.floor(hi / cs));
    const plo = Math.min(p0, p1) - rd / r, phi_ = Math.max(p0, p1) + rd / r;
    const ka = Math.floor(plo / cp), kb = Math.floor(phi_ / cp);
    // segment dans la métrique locale (x = r·φ, y = σ)
    const ax = r * p0, ay = s0, bx = r * p1, by = s1, vx = bx - ax, vy = by - ay, vv = vx * vx + vy * vy || 1e-12;
    for (let i = ia; i <= ib; i++) {
      const y = (i + 0.5) * cs;
      for (let kk = ka; kk <= kb; kk++) {
        const x = r * (kk + 0.5) * cp;
        let t = ((x - ax) * vx + (y - ay) * vy) / vv; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - ax - vx * t, dy = y - ay - vy * t, q = dx * dx + dy * dy;
        if (q > rd * rd) continue;
        const c = i * Np + mod(kk, Np);
        if (mode === 0) {
          if (stamp[c] >= minStamp) continue; // (son propre dépôt récent : ignoré)
          if (H[c] > readMax) readMax = H[c];
        } else {
          const top = hTop + Math.sqrt(rd * rd - q); // (section ronde : hTop est l'axe du fil)
          if (top > H[c]) { H[c] = top; stamp[c] = j; }
          if (q < rd * rd * 0.6 && !(lastK[c] === k && j - lastJ[c] <= 3)) {
            if (cnt[c] < 4) { // (les quatre premiers instants, rangés)
              let q = cnt[c];
              const sv = sOf(j);
              while (q > 0 && cook[c * 4 + q - 1] > sv) { cook[c * 4 + q] = cook[c * 4 + q - 1]; q--; }
              cook[c * 4 + q] = sv;
            }
            if (cnt[c] < 255) cnt[c]++;
            lastK[c] = k; lastJ[c] = j;
          }
        }
      }
    }
  };
  // s de chaque point du ruban : part de la longueur posée
  const sOf = (j) => j / (m - 1);
  const chunk = spec.family === 'huit' ? 8 : 16, lag = 3; // (un tronçon ne se recroise pas lui-même)
  const raw = new Float32Array(nb * m);
  for (let j0 = 1; j0 < m; j0 += chunk) {
    const j1 = Math.min(m - 1, j0 + chunk - 1);
    // lecture (avant tout dépôt de ce tronçon ; son propre dépôt récent ignoré)
    for (let k = 0; k < nb; k++) {
      for (let j = j0; j <= j1; j++) {
        readMax = -1;
        seg(k, j, 0, 0, j0 - lag);
        raw[k * m + j] = Math.max(readMax, 0) + rd;
      }
      if (j0 === 1) raw[k * m] = raw[k * m + 1];
    }
    // lissage : dilatation (le fil enjambe un peu avant le croisement), puis
    // moyenne glissante — le long du fil seulement
    for (let k = 0; k < nb; k++) {
      for (let j = j0; j <= j1; j++) {
        let mx = 0;
        for (let q = -2; q <= 2; q++) { const jj = Math.min(j1, Math.max(0, j + q)); mx = Math.max(mx, raw[k * m + jj]); }
        Hp[k * m + j] = mx;
      }
      for (let j = j0; j <= j1; j++) {
        let a = 0, w = 0;
        for (let q = -1; q <= 1; q++) { const jj = j + q; if (jj < 0 || jj > j1) continue; const ww = q ? 0.25 : 0.5; a += Hp[k * m + jj] * ww; w += ww; }
        // (jamais sous le minimum lu : pas de traversée)
        Hp[k * m + j] = Math.max(raw[k * m + j], a / w);
      }
    }
    // couches sous chaque point (pour la lueur venue de la lampe)
    for (let k = 0; k < nb; k++) {
      for (let j = j0; j <= j1; j++) {
        const i = Math.min(Ns - 1, Math.max(0, Math.floor(TS[k * m + j] / cs))), kk = mod(Math.floor(TP[k * m + j] / cp), Np);
        NB[k * m + j] = Math.min(255, cnt[i * Np + kk]);
      }
    }
    // dépôt
    for (let k = 0; k < nb; k++) for (let j = j0; j <= j1; j++) seg(k, j, 1, Hp[k * m + j], 0);
    if (onProgress && (j0 % (chunk * 40) === 1)) onProgress(j0 / m);
  }
  Hp[0] = Hp[1];
  for (let k = 1; k < nb; k++) Hp[k * m] = Hp[k * m + 1];
  // ── sorties ──
  // enveloppe (pour le rail des ailettes) : hauteur maximale par rangée σ
  const env = new Float32Array(Ns);
  for (let i = 0; i < Ns; i++) { let mx = 0; for (let k = 0; k < Np; k++) mx = Math.max(mx, H[i * Np + k]); env[i] = mx; }
  return { P, path, layers, nb, m, d, TS, TP, Hp, NB, cook, cnt, env, grid: { Ns, Np, cs, cp } };
}

// Points 3D de chaque fil (repère de la station) et segments instanciés :
//  a = (p0, s0), b = (p1, s1), c = (couches dessous, indice du fil, tirage, 0)
export function threadSegments(W, dec = 3) {
  const { P, nb, m, TS, TP, Hp, NB, cook, grid } = W;
  // instant où un point passe sous un fil posé après lui (un passage plus
  // tardif, pas ses voisins de ruban ; les fils d'un ruban sont jointifs) : il
  // n'est plus visible, on ne le dessine plus. 2 = jamais (ou inconnu).
  const buriedAt = (k, j) => {
    const i = Math.min(grid.Ns - 1, Math.max(0, Math.floor(TS[k * m + j] / grid.cs)));
    const kk = ((Math.floor(TP[k * m + j] / grid.cp) % grid.Np) + grid.Np) % grid.Np;
    const c = (i * grid.Np + kk) * 4, s = j / (m - 1), gap = 24 / (m - 1);
    for (let q = 0; q < 4; q++) { const v = cook[c + q]; if (v <= 1 && v > s + gap) return v; }
    return 2;
  };
  // Points rendus : un sur `dec` (9 mm). Un fil tendu entre deux points est
  // droit ; la flèche d'une corde de 9 mm sur la cage fait moins de 0,1 mm. La
  // hauteur d'un point rendu est le maximum des points qu'il remplace : le fil
  // enjambe les croisements (comme un fil tendu), il ne s'y enfonce jamais.
  const idx = [];
  for (let j = 0; j < m - 1; j += dec) idx.push(j);
  idx.push(m - 1);
  const M = idx.length, per = M - 1, n = nb * per;
  const a = new Float32Array(n * 4), b = new Float32Array(n * 4), c = new Float32Array(n * 4);
  // tangentes aux deux bouts de chaque segment : les rubans de deux segments
  // voisins se raccordent sans cassure
  const ta = new Float32Array(n * 4), tb = new Float32Array(n * 4);
  const pts = new Float32Array(M * 3), q = [0, 0, 0];
  const nbS = new Float32Array(m);
  let o = 0;
  for (let k = 0; k < nb; k++) {
    const rk = hash(k * 977 + 3);
    for (let i = 0; i < M; i++) {
      const j = idx[i];
      let h = Hp[k * m + j];
      for (let jj = Math.max(0, j - dec + 1); jj <= Math.min(m - 1, j + dec - 1); jj++) h = Math.max(h, Hp[k * m + jj]);
      wallPoint(P, TS[k * m + j], TP[k * m + j], h, q); pts.set(q, i * 3);
    }
    const tan = (i, out) => {
      const i0 = Math.max(0, i - 1), i1 = Math.min(M - 1, i + 1);
      const x = pts[i1 * 3] - pts[i0 * 3], y = pts[i1 * 3 + 1] - pts[i0 * 3 + 1], z = pts[i1 * 3 + 2] - pts[i0 * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      out[0] = x / l; out[1] = y / l; out[2] = z / l;
      return out;
    };
    // couches sous le fil, lissées le long du fil (± 9 points) : un compte
    // entier qui saute de segment en segment dessinait un camouflage dans la lueur
    for (let j = 0; j < m; j++) { let a0 = 0, w0 = 0; for (let q2 = -9; q2 <= 9; q2++) { const jj = j + q2; if (jj < 0 || jj >= m) continue; const ww = 10 - Math.abs(q2); a0 += NB[k * m + jj] * ww; w0 += ww; } nbS[j] = a0 / w0; }
    const t0 = [0, 0, 0], t1 = [0, 0, 0];
    for (let i = 1; i < M; i++, o++) {
      const j0 = idx[i - 1], j1 = idx[i];
      a.set([pts[(i - 1) * 3], pts[(i - 1) * 3 + 1], pts[(i - 1) * 3 + 2], j0 / (m - 1)], o * 4);
      b.set([pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], j1 / (m - 1)], o * 4);
      c.set([nbS[j0], k, rk, nbS[j1]], o * 4);
      tan(i - 1, t0); tan(i, t1);
      // (le segment disparaît quand tout ce qu'il couvre est enfoui)
      let bur = 0;
      for (let jj = Math.max(0, j0 - 1); jj <= Math.min(m - 1, j1 + 1); jj++) bur = Math.max(bur, buriedAt(k, jj));
      ta.set([t0[0], t0[1], t0[2], bur], o * 4); tb.set([t1[0], t1[1], t1[2], 0], o * 4);
    }
  }
  return { a, b, c, ta, tb, count: n, per, dec, m };
}

// Le ruban (axe central) : positions 3D du point de pose au-dessus de la
// paroi et tangentes, par point du chemin — pour la cinématique de l'appareil.
export function bandCenter(W) {
  const { P, path, nb, m, Hp } = W;
  const pos = new Float32Array(m * 3), tan = new Float32Array(m * 3), hgt = new Float32Array(m), p = [0, 0, 0];
  for (let j = 0; j < m; j++) {
    let h = 0;
    for (let k = 0; k < nb; k++) h = Math.max(h, Hp[k * m + j]);
    wallPoint(P, path.sig[j], path.phi[j], h, p);
    pos.set(p, j * 3); hgt[j] = h;
  }
  for (let j = 0; j < m; j++) {
    const a = Math.max(0, j - 2), b = Math.min(m - 1, j + 2);
    let x = pos[b * 3] - pos[a * 3], y = pos[b * 3 + 1] - pos[a * 3 + 1], z = pos[b * 3 + 2] - pos[a * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    tan.set([x / l, y / l, z / l], j * 3);
  }
  return { pos, tan, hgt };
}
