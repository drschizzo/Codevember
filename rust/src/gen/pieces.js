// Les pièces qui rouillent : quatre familles de silhouettes différentes.
//
//  - Nœud  : nœud de treillis riveté — gousset, membrure en cornières jumelées,
//            trois à cinq barres qui convergent, fourrures, des centaines de rivets ;
//  - Vanne : vanne à opercule sur sa tuyauterie — corps de fonte, brides
//            boulonnées, chapeau, presse-étoupe, arcade, tige, volant ;
//  - Roue  : roue motrice de locomotive — moyeu, rayons elliptiques, jante,
//            bandage, contrepoids riveté, maneton, essieu ; sur un coupon de rail ;
//  - Porte : porte étanche de navire — cloison, hiloire rivetée, battant
//            raidi, taquets à coin, charnières, plaque de laiton.
//
// Unités : mètres. Repère de la pièce : y vers le haut, la face principale
// regarde +z (le côté du laser et de la caméra), le support pose en y = 0.
//
// Sortie : `body` (ce qui rouille : finitions OUT acier laminé, IN fonte,
// EDGE laiton / bronze), `stand` (le support : OUT chêne, IN acier peint),
// `info` (boîte englobante, points de levage, hauteur du crochet).
import { Buffers, OUT, IN, EDGE, add, sub, mul, norm, cross, dot } from './mesh.js';
import { frame, P, slab, prism, angleProfile, revolve, rivet, bolt, stud, hexPrism, washer, threadEnd, loft, roundPoly, ringSweep, eyeBolt, earClip } from './parts.js';
import { roundedBox } from './mesh.js';
import { createRng } from '../rng.js';

const { PI, cos, sin, abs, sqrt, max, min, atan2 } = Math;
const STEEL = OUT, CAST = IN, BRONZE = EDGE;
const WOOD = OUT, PAINT = IN;

// contour rentré de d (sens direct)
function outlineInset(pts, d) {
  const n = pts.length; let a = 0;
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  const P2 = a < 0 ? pts.slice().reverse() : pts;
  return P2.map((b, i) => {
    const p = P2[(i + n - 1) % n], c = P2[(i + 1) % n];
    const e0 = norm([b[1] - p[1], -(b[0] - p[0]), 0]), e1 = norm([c[1] - b[1], -(c[0] - b[0]), 0]), m = norm(add(e0, e1));
    return [b[0] - m[0] * d, b[1] - m[1] * d];
  });
}
// enveloppe convexe 2D (Andrew)
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// simplifie un contour : retire les points presque alignés
function simplify(pts, tol = 1e-3) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (abs(cr) > tol * Math.hypot(c[0] - a[0], c[1] - a[1]) || Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.25) out.push(b);
  }
  return out;
}
const bbox = (pos) => {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = min(lo[k], pos[i + k]); hi[k] = max(hi[k], pos[i + k]); }
  return [lo, hi];
};
const block = (S, c, h, r = 0.012) => roundedBox(S, c, h, r, 4, WOOD, WOOD);

// ════════════════════════════════════════════════════════════════════════════
// Nœud de treillis riveté
// ════════════════════════════════════════════════════════════════════════════
function buildNode(p, rng) {
  const B = new Buffers(1 << 17), S = new Buffers();
  const tg = 0.012, ac = p.chordLeg, tc = 0.011, am = p.memberLeg, tm = 0.01;
  const d = 0.019, pitch = p.pitch;
  const y0 = 0.14; // talon de la membrure (dessus des cales)
  const Lc = p.chordLength;
  const lifts = [];
  // ── membrure : deux cornières dos à dos, ailes horizontales vers l'extérieur
  for (const sd of [1, -1]) {
    B.piece = rng.int(0, 255);
    const F = { o: [0, y0, sd * tg / 2], X: [0, 0, sd], Y: [0, 1, 0], Z: norm(cross([0, 0, sd], [0, 1, 0])) };
    prism(B, F, angleProfile(ac, tc, tc * 1.1, tc * 0.5), -Lc / 2, Lc / 2, STEEL, { nz: 8 });
  }
  // ── barres : direction dans le plan, longueur
  const wy = y0 + 0.3 * ac; // ligne d'épure (centre de gravité de la membrure)
  const thetas = p.angles.map((a) => (a * PI) / 180);
  const members = thetas.map((th) => {
    const dir = [cos(th), sin(th)], e = [-sin(th), cos(th)];
    return { th, dir, e, s0: 0, len: p.memberLength * (abs(cos(th)) < 0.2 ? 0.85 : 1) };
  });
  // départ de chaque barre : au-dessus de la membrure, sans chevaucher ses voisines
  const strip = (m, s) => { const o = [0 - m.e[0] * 0.28 * am, wy - m.e[1] * 0.28 * am]; return [0, 1].map((v) => [o[0] + m.dir[0] * s + m.e[0] * v * am, o[1] + m.dir[1] * s + m.e[1] * v * am]); };
  for (const m of members) {
    m.s0 = 0.02;
    for (let it = 0; it < 400; it++) {
      const pts = strip(m, m.s0);
      if (min(pts[0][1], pts[1][1]) > y0 + ac + 0.025) break;
      m.s0 += 0.005;
    }
  }
  // écart entre barres voisines (bandes dans le plan) : on recule la plus courte
  const segDist = (a0, a1, b0, b1) => {
    let dm = 1e9;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      const pa = [a0[0] + (a1[0] - a0[0]) * i / 8, a0[1] + (a1[1] - a0[1]) * i / 8], pb = [b0[0] + (b1[0] - b0[0]) * j / 8, b0[1] + (b1[1] - b0[1]) * j / 8];
      dm = min(dm, Math.hypot(pa[0] - pb[0], pa[1] - pb[1]));
    }
    return dm;
  };
  for (let it = 0; it < 300; it++) {
    let moved = false;
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      const A = members[i], Bm = members[j];
      const a = strip(A, A.s0), b = strip(Bm, Bm.s0);
      const a2 = strip(A, A.s0 + 0.25), b2 = strip(Bm, Bm.s0 + 0.25);
      // (bords voisins : coins de départ et arêtes de la bande)
      const dd = min(segDist(a[0], a2[0], b[0], b2[0]), segDist(a[1], a2[1], b[1], b2[1]), segDist(a[0], a2[0], b[1], b2[1]), segDist(a[1], a2[1], b[0], b2[0]), segDist(a[0], a[1], b[0], b2[0]), segDist(a[0], a[1], b[1], b2[1]), segDist(b[0], b[1], a[0], a2[0]), segDist(b[0], b[1], a[1], a2[1]));
      if (dd < 0.03) { A.s0 += 0.006; Bm.s0 += 0.006; moved = true; }
    }
    if (!moved) break;
  }
  // ── rivets des barres et zone du gousset
  const hullPts = [];
  const rivetsOn = (pts2, z, nz) => { for (const q of pts2) rivet(B, [q[0], q[1], z], [0, 0, nz], d, STEEL); };
  const gussetRivets = [];
  for (const m of members) {
    const nR = p.rivetsPerRow;
    const rows = am >= 0.095 ? [0.38, 0.72] : [0.55];
    for (let ri = 0; ri < rows.length; ri++) {
      for (let k = 0; k < nR; k++) {
        const s = m.s0 + 0.045 + k * pitch + (rows.length > 1 && ri === 1 ? pitch / 2 : 0);
        const v = rows[ri] * am - 0.28 * am;
        gussetRivets.push([m.dir[0] * s + m.e[0] * v, wy + m.dir[1] * s + m.e[1] * v]);
      }
    }
    const sEnd = m.s0 + 0.045 + (nR - 1) * pitch + (rows.length > 1 ? pitch / 2 : 0) + 0.06;
    for (const v of [-0.28 * am - 0.035, 0.72 * am + 0.035]) for (const s of [m.s0 - 0.02, sEnd]) hullPts.push([m.dir[0] * s + m.e[0] * v, wy + m.dir[1] * s + m.e[1] * v]);
    m.sEnd = sEnd;
  }
  // rivets de la membrure dans la zone du gousset
  let xMin = 1e9, xMax = -1e9;
  for (const q of hullPts) { xMin = min(xMin, q[0]); xMax = max(xMax, q[0]); }
  xMin -= 0.03; xMax += 0.03;
  const gc = 0.55 * ac;
  for (let x = xMin + 0.04; x <= xMax - 0.035; x += pitch) gussetRivets.push([x, y0 + gc]);
  hullPts.push([xMin, y0], [xMax, y0], [xMin, y0 + ac], [xMax, y0 + ac]);
  // ── gousset
  const outline = roundPoly(simplify(hull(hullPts)), 0.035, 5);
  B.piece = rng.int(0, 255);
  slab(B, { o: [0, 0, 0], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }, outline, tg, 0.003, STEEL);
  // ── cornières des barres (deux par barre, une de chaque côté)
  for (const m of members) {
    for (const sd of [1, -1]) {
      B.piece = rng.int(0, 255);
      const heel = [-m.e[0] * 0.28 * am, wy - m.e[1] * 0.28 * am];
      const X = [0, 0, sd], Y = [m.e[0], m.e[1], 0], Z = norm(cross(X, Y));
      const F = { o: [heel[0], heel[1], sd * tg / 2], X, Y, Z };
      // (Z = ±dir : on extrude de s0 à s0 + len dans le sens de la barre)
      const sg = dot(Z, [m.dir[0], m.dir[1], 0]);
      const za = sg * m.s0, zb = sg * (m.s0 + m.len);
      prism(B, F, angleProfile(am, tm, tm * 1.1, tm * 0.5), min(za, zb), max(za, zb), STEEL, { nz: 6 });
    }
    // fourrures (au-delà du gousset) : plaque entre les deux cornières + 2 rivets
    for (let s = m.sEnd + 0.18; s < m.s0 + m.len - 0.08; s += 0.32) {
      B.piece = rng.int(0, 255);
      const c = [m.dir[0] * s - m.e[0] * 0.28 * am, wy + m.dir[1] * s - m.e[1] * 0.28 * am];
      const corners = [[0, -0.045], [am * 0.95, -0.045], [am * 0.95, 0.045], [0, 0.045]].map(([v, w]) => [c[0] + m.e[0] * v + m.dir[0] * w, c[1] + m.e[1] * v + m.dir[1] * w]);
      slab(B, { o: [0, 0, 0], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }, roundPoly(corners, 0.006, 2), tg, 0.002, STEEL);
      for (const w of [-0.02, 0.02]) {
        const q = [c[0] + m.e[0] * 0.55 * am + m.dir[0] * w, c[1] + m.e[1] * 0.55 * am + m.dir[1] * w];
        for (const sd of [1, -1]) rivet(B, [q[0], q[1], sd * (tg / 2 + tm)], [0, 0, sd], d, STEEL);
      }
    }
    // (piton de levage au bout des barres les plus hautes : voir plus bas)
    m.tip = [m.dir[0] * (m.s0 + m.len), wy + m.dir[1] * (m.s0 + m.len)];
  }
  // fourrures de la membrure
  for (const xs of [-1, 1]) for (let x = xs > 0 ? xMax + 0.18 : xMin - 0.18; abs(x) < Lc / 2 - 0.06; x += xs * 0.3) {
    B.piece = rng.int(0, 255);
    slab(B, { o: [0, 0, 0], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }, roundPoly([[x - 0.045, y0 + 0.004], [x + 0.045, y0 + 0.004], [x + 0.045, y0 + ac * 0.95], [x - 0.045, y0 + ac * 0.95]], 0.006, 2), tg, 0.002, STEEL);
    for (const sd of [1, -1]) rivet(B, [x, y0 + gc, sd * (tg / 2 + tc)], [0, 0, sd], d, STEEL);
  }
  // rivets du gousset (des deux côtés, sur les ailes des cornières)
  for (const q of gussetRivets) for (const sd of [1, -1]) {
    B.piece = rng.int(0, 255);
    const onChord = abs(q[1] - (y0 + gc)) < 1e-6;
    rivetsOn([q], sd * (tg / 2 + (onChord ? tc : tm)), sd);
  }
  // ── pitons de levage : sur les deux barres extrêmes, dessus de l'aile
  const bySpread = members.slice().sort((a, b) => a.th - b.th);
  for (const m of [bySpread[0], bySpread[bySpread.length - 1]]) {
    const s = m.s0 + m.len - 0.06;
    const q = [m.dir[0] * s + m.e[0] * (0.72 * am), wy + m.dir[1] * s + m.e[1] * (0.72 * am)];
    // (vissé dans le chant de l'aile dans le plan, vers le haut de la barre)
    const nrm = [m.e[0], m.e[1], 0];
    const up = nrm[1] < 0 ? mul(nrm, -1) : nrm;
    const base = [q[0] + (up === nrm ? 0 : -0.0) , q[1], 0];
    lifts.push(eyeBolt(B, [base[0] + up[0] * (up === nrm ? 0 : am), base[1] + up[1] * (up === nrm ? 0 : am), tg / 2 + tm / 2], up, [0, 0, 1], 0.018, STEEL));
  }
  // ── support : deux cales de chêne sous les ailes de la membrure
  for (const xs of [-1, 1]) {
    S.piece = rng.int(0, 255);
    block(S, [xs * (Lc / 2 - 0.16), y0 / 2, 0], [0.09, y0 / 2, 0.16]);
  }
  return { B, S, lifts };
}

// ════════════════════════════════════════════════════════════════════════════
// Vanne à opercule sur sa tuyauterie
// ════════════════════════════════════════════════════════════════════════════
function buildValve(p, rng) {
  const B = new Buffers(1 << 17), S = new Buffers();
  const Dp = p.pipe, rp = Dp / 2, Df = Dp * 1.95, tf = 0.026, nb = p.bolts, db = Dp > 0.2 ? 0.022 : 0.018;
  const rb = (Df / 2 + rp) / 2 + 0.008;
  const yp = 0.2 + Df / 2 + 0.02; // axe de la conduite
  const L = p.length / 2, xb = 0.17;
  const Fx = (x) => frame([x, yp, 0], [1, 0, 0], [0, 1, 0]);
  // brides à collerette (côté conduite) ; face de joint en x = xj, la bride
  // s'étend vers le côté s (±1)
  const pipeFlange = (xj, s) => {
    B.piece = rng.int(0, 255);
    const pr = [[0, 0], [Df / 2 - 0.004, 0], [Df / 2, 0.004], [Df / 2, tf - 0.004], [Df / 2 - 0.004, tf], [rp + 0.03, tf], [rp + 0.012, tf + 0.045], [rp, tf + 0.06], [rp, tf + 0.061]];
    revolve(B, frame([xj, yp, 0], [s, 0, 0], [0, 1, 0]), pr, STEEL, { M: 64, smooth: 0.5 });
  };
  const blindFlange = (xj, s) => {
    B.piece = rng.int(0, 255);
    const pr = [[0, 0.0], [Df / 2 - 0.004, 0], [Df / 2, 0.004], [Df / 2, tf - 0.004], [Df / 2 - 0.006, tf], [rp * 0.9, tf], [rp * 0.75, tf + 0.012], [0, tf + 0.016]];
    revolve(B, frame([xj, yp, 0], [s, 0, 0], [0, 1, 0]), pr, STEEL, { M: 64, smooth: 0.5 });
  };
  const flangeBolts = (xj, n, r, dd, axisF, thick = tf) => {
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.5) / n) * 2 * PI;
      const off = add(mul(axisF.X, cos(a) * r), mul(axisF.Y, sin(a) * r));
      const c = add(axisF.o, off);
      B.piece = rng.int(0, 255);
      bolt(B, add(c, mul(axisF.Z, -thick)), mul(axisF.Z, -1), add(c, mul(axisF.Z, thick)), axisF.Z, dd, STEEL);
    }
  };
  // ── tuyaux
  for (const s of [-1, 1]) {
    B.piece = rng.int(0, 255);
    revolve(B, frame([s * (xb + tf + 0.06), yp, 0], [s, 0, 0], [0, 1, 0]), [[rp, 0], [rp, L - xb - 2 * tf - 0.12]], STEEL, { M: 64 });
    pipeFlange(s * xb, s);
    pipeFlange(s * (L - tf), -s);
    blindFlange(s * (L - tf), s);
    flangeBolts(s * xb, nb, rb, db, frame([s * xb, yp, 0], [1, 0, 0], [0, 1, 0]));
    flangeBolts(s * (L - tf), nb, rb, db, frame([s * (L - tf), yp, 0], [1, 0, 0], [0, 1, 0]));
  }
  // ── corps de fonte : révolution autour de x (brides, cols, bulbe)
  B.piece = rng.int(0, 255);
  const rB = rp * 1.45;
  const body = [[Df / 2 - 0.004, -xb], [Df / 2, -xb + 0.004], [Df / 2, -xb + tf - 0.004], [Df / 2 - 0.006, -xb + tf], [rp + 0.03, -xb + tf + 0.006], [rp + 0.02, -xb + tf + 0.03]];
  for (let j = 0; j <= 10; j++) { const t = j / 10, z = -xb + tf + 0.04 + (2 * (xb - tf - 0.04)) * t; body.push([rp + 0.02 + (rB - rp - 0.02) * sin(PI * t) ** 0.7, z]); }
  body.push([rp + 0.02, xb - tf - 0.03], [rp + 0.03, xb - tf - 0.006], [Df / 2 - 0.006, xb - tf], [Df / 2, xb - tf + 0.004], [Df / 2, xb - 0.004], [Df / 2 - 0.004, xb]);
  revolve(B, frame([0, yp, 0], [1, 0, 0], [0, 1, 0]), [[0, -xb], ...body, [0, xb]], CAST, { M: 64, smooth: 0.45 });
  // nervures de moulage (de la bride au bulbe), quatre de chaque côté
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
    B.piece = rng.int(0, 255);
    const a = PI / 4 + (k * PI) / 2;
    const F = { o: [s * (xb - tf), yp, 0], X: [-s, 0, 0], Y: [0, cos(a), sin(a)], Z: [0, -sin(a), cos(a)] };
    const prof = [[0, Df / 2 - 0.02], [0.07, rB * 0.95], [0.075, rp + 0.03], [0, rp + 0.03]];
    slab(B, F, prof, 0.012, 0.004, CAST);
  }
  // ── col du chapeau (révolution autour de y), bride, chapeau
  const yN = yp + rB * 0.6, yF = yp + rB + 0.12, Db = Dp * 1.55, nbb = p.bonnetBolts;
  B.piece = rng.int(0, 255);
  revolve(B, frame([0, yN, 0], [0, 1, 0], [1, 0, 0]), [[0, 0], [rp * 0.95, 0], [rp * 0.95, yF - yN - 0.05], [rp * 1.0, yF - yN - 0.03], [Db / 2 - 0.006, yF - yN - 0.006], [Db / 2, yF - yN], [Db / 2, yF - yN + 0.018], [Db / 2 - 0.004, yF - yN + 0.022], [0, yF - yN + 0.022]], CAST, { M: 64, smooth: 0.5 });
  B.piece = rng.int(0, 255);
  const yb = yF + 0.022, hb = 0.16;
  revolve(B, frame([0, yb, 0], [0, 1, 0], [1, 0, 0]), [[0, 0], [Db / 2 - 0.004, 0], [Db / 2, 0.004], [Db / 2, 0.018], [Db / 2 - 0.006, 0.022], [rp * 0.9, 0.03], [rp * 0.75, hb * 0.6], [rp * 0.55, hb * 0.85], [0.055, hb], [0.055, hb + 0.06], [0.07, hb + 0.06], [0.07, hb + 0.075], [0, hb + 0.075]], CAST, { M: 64, smooth: 0.5 });
  flangeBolts(yF, nbb, Db / 2 - 0.025, 0.016, frame([0, yF + 0.011, 0], [0, 1, 0], [1, 0, 0]), 0.011);
  // presse-étoupe (bronze) et ses deux goujons
  const yG = yb + hb + 0.075;
  B.piece = rng.int(0, 255);
  revolve(B, frame([0, yG, 0], [0, 1, 0], [1, 0, 0]), [[0, 0], [0.045, 0], [0.045, 0.03], [0.04, 0.034], [0.03, 0.034], [0.03, 0.05], [0, 0.05]], BRONZE, { M: 40, smooth: 0.6 });
  B.piece = rng.int(0, 255);
  slab(B, { o: [0, yG + 0.03, 0], X: [1, 0, 0], Y: [0, 0, -1], Z: [0, 1, 0] }, roundPoly([[-0.1, -0.03], [0.1, -0.03], [0.1, 0.03], [-0.1, 0.03]], 0.03, 6), 0.016, 0.004, BRONZE);
  for (const s of [-1, 1]) stud(B, [s * 0.075, yG + 0.03 + 0.008, 0], [0, 1, 0], 0.012, 0.03, STEEL);
  // arcade : deux bras qui montent du chapeau vers la tête
  const yT = yG + 0.3;
  for (const s of [-1, 1]) {
    B.piece = rng.int(0, 255);
    const pts = [];
    for (let j = 0; j <= 16; j++) { const t = j / 16; pts.push([s * (0.085 + 0.05 * sin(PI * t) - 0.02 * t), yb + 0.11 + (yT - yb - 0.11) * t, 0]); }
    loft(B, pts, (i) => { const t = i / 16; const w = 1 + 0.35 * (4 * (t - 0.5) ** 2); return [0.022 * w, 0.016 * w]; }, CAST, { nr: 16, up: [0, 0, 1] });
  }
  B.piece = rng.int(0, 255);
  revolve(B, frame([0, yT - 0.03, 0], [0, 1, 0], [1, 0, 0]), [[0, 0], [0.11, 0], [0.115, 0.006], [0.115, 0.035], [0.11, 0.042], [0.05, 0.05], [0.05, 0.07], [0, 0.07]], CAST, { M: 48, smooth: 0.6 });
  // tige filetée (montante) en bronze
  B.piece = rng.int(0, 255);
  revolve(B, frame([0, yG + 0.05, 0], [0, 1, 0], [1, 0, 0]), [[0, 0], [0.017, 0], [0.017, yT - yG - 0.04]], BRONZE, { M: 20 });
  threadEnd(B, [0, yT + 0.04, 0], [0, 1, 0], 0.036, 0.16, 0.008, BRONZE);
  // volant : moyeu, rayons, jante
  const yW = yT + 0.11, Rw = p.wheel, nsp = p.spokes;
  B.piece = rng.int(0, 255);
  revolve(B, frame([0, yW - 0.03, 0], [0, 1, 0], [1, 0, 0]), [[0.02, 0], [0.045, 0], [0.05, 0.01], [0.05, 0.04], [0.045, 0.05], [0.02, 0.05]], CAST, { M: 32, smooth: 0.6 });
  hexPrism(B, frame([0, yW + 0.02, 0], [0, 1, 0]), 0.05, 0.035, BRONZE, { both: true });
  B.piece = rng.int(0, 255);
  {
    const rows = [], R = Rw, r = 0.016;
    for (let j = 0; j <= 12; j++) {
      const th = (2 * PI * j) / 12, row = [];
      for (let i = 0; i < 96; i++) { const ph = (2 * PI * i) / 96, dd = [cos(ph), 0, sin(ph)], nn = [cos(th) * dd[0], sin(th), cos(th) * dd[2]]; row.push(B.vert([dd[0] * R + nn[0] * r, yW + 0.045 + nn[1] * r * 1.15, dd[2] * R + nn[2] * r], nn, CAST)); }
      rows.push(row);
    }
    B.grid(rows, true);
  }
  for (let k = 0; k < nsp; k++) {
    B.piece = rng.int(0, 255);
    const a = (k / nsp) * 2 * PI + 0.3, pts = [];
    for (let j = 0; j <= 10; j++) { const t = j / 10, r = 0.045 + (Rw - 0.05) * t; pts.push([cos(a) * r, yW + 0.02 + 0.03 * t ** 1.5, sin(a) * r]); }
    loft(B, pts, (i) => [0.013 - 0.004 * (i / 10), 0.009], CAST, { nr: 12, up: [0, 1, 0] });
  }
  // pitons sur les brides pleines
  const lifts = [];
  for (const s of [-1, 1]) { B.piece = rng.int(0, 255); lifts.push(eyeBolt(B, [s * (L + 0.012), yp + Df / 2, 0], [0, 1, 0], [1, 0, 0], 0.016, STEEL)); }
  // ── support : deux sellettes (cale de chêne + berceau peint)
  for (const s of [-1, 1]) {
    const x = s * (L * 0.62);
    S.piece = rng.int(0, 255);
    const hB = yp - rp - 0.05;
    block(S, [x, hB / 2, 0], [0.09, hB / 2, 0.2]);
    S.piece = rng.int(0, 255);
    // berceau : plaque cintrée sous la conduite
    const prof = [];
    for (let j = 0; j <= 14; j++) { const a = -PI / 2 - 0.9 + (1.8 * j) / 14; prof.push([cos(a) * (rp + 0.008), sin(a) * (rp + 0.008)]); }
    for (let j = 14; j >= 0; j--) { const a = -PI / 2 - 0.9 + (1.8 * j) / 14; prof.push([cos(a) * (rp + 0.02), sin(a) * (rp + 0.02)]); }
    prism(S, { o: [x, yp, 0], X: [0, 0, 1], Y: [0, 1, 0], Z: [-1, 0, 0] }, prof, -0.035, 0.035, PAINT, { smooth: 0.5 });
    // (le berceau repose sur la cale : pieds)
    roundedBox(S, [x, hB + 0.012, 0], [0.04, 0.012, rp * 0.9], 0.004, 3, PAINT, PAINT);
  }
  return { B, S, lifts };
}

// ════════════════════════════════════════════════════════════════════════════
// Roue motrice de locomotive
// ════════════════════════════════════════════════════════════════════════════
function buildWheel(p, rng) {
  const B = new Buffers(1 << 17), S = new Buffers();
  const R = p.radius, railTop = 0.2, yc = railTop + R;
  const Fz = (z) => frame([0, yc, z], [0, 0, 1], [1, 0, 0]);
  const rIn = R - 0.075; // intérieur du bandage = extérieur de la jante
  // bandage : roulement conique, boudin côté intérieur (z < 0)
  B.piece = rng.int(0, 255);
  revolve(B, Fz(0), [[rIn, 0.065], [R - 0.004, 0.065], [R, 0.06], [R + 0.002, 0.0], [R + 0.004, -0.04], [R + 0.012, -0.05], [R + 0.03, -0.058], [R + 0.032, -0.064], [R + 0.026, -0.07], [R + 0.01, -0.075], [rIn, -0.075], [rIn, 0.065]], STEEL, { M: 128, smooth: 0.6 }); // (profil fermé : l'alésage du bandage)
  // jante (fonte) : profil en T
  B.piece = rng.int(0, 255);
  revolve(B, Fz(0), [[rIn + 0.002, -0.05], [rIn - 0.035, -0.05], [rIn - 0.045, -0.035], [rIn - 0.05, -0.02], [rIn - 0.05, 0.02], [rIn - 0.045, 0.035], [rIn - 0.035, 0.05], [rIn + 0.002, 0.05], [rIn + 0.002, -0.05]].reverse(), CAST, { M: 128, smooth: 0.7 }); // (fermé, engagé de 2 mm dans le bandage)
  // moyeu
  B.piece = rng.int(0, 255);
  const rH = 0.17;
  revolve(B, Fz(0), [[0.09, -0.11], [rH - 0.01, -0.11], [rH, -0.1], [rH, 0.08], [rH - 0.012, 0.09], [0.13, 0.095], [0.12, 0.11], [0.09, 0.11]].reverse(), CAST, { M: 64, smooth: 0.6 });
  // rayons : section elliptique effilée, évasée aux deux bouts
  // (le maneton est porté par un rayon : son angle est celui du rayon le plus
  // proche de la verticale, décalé au hasard d'un rayon ou deux)
  const nS = p.spokes, crankA = (Math.round(nS / 4) + rng.int(-1, 1)) * (2 * PI / nS);
  for (let k = 0; k < nS; k++) {
    B.piece = rng.int(0, 255);
    const a = (k / nS) * 2 * PI, dir = [cos(a), sin(a), 0], pts = [];
    const r0 = rH - 0.01, r1 = rIn - 0.045;
    for (let j = 0; j <= 14; j++) { const t = j / 14; pts.push(add([0, yc, 0], mul(dir, r0 + (r1 - r0) * t))); }
    loft(B, pts, (i) => { const t = i / 14; const fl = 1 + 0.6 * (max(0, 1 - t / 0.12) ** 2 + max(0, 1 - (1 - t) / 0.1) ** 2); return [(0.034 - 0.012 * t) * fl, (0.026 - 0.006 * t) * min(fl, 1.3)]; }, CAST, { nr: 16, up: [0, 0, 1] });
  }
  // contrepoids en croissant : deux plaques rivetées, à l'opposé du maneton
  const cw = crankA + PI, span = p.counterSpan;
  const crescent = [];
  const rA = rIn - 0.05, rI = rH + 0.07;
  for (let j = 0; j <= 24; j++) { const a = cw - span / 2 + (span * j) / 24; crescent.push([cos(a) * rA, sin(a) * rA]); }
  const innerR = (a) => { const t = (a - (cw - span * 0.35)) / (span * 0.7); return rA - 0.09 - 0.07 * (1 - (2 * t - 1) ** 2); };
  for (let j = 24; j >= 0; j--) { const a = cw - span * 0.35 + (span * 0.7 * j) / 24; crescent.push([cos(a) * innerR(a), sin(a) * innerR(a)]); }
  const cres = roundPoly(crescent.filter((_, i) => i % 1 === 0), 0.0, 1);
  // deux plaques qui serrent les rayons (elles les chevauchent), et le
  // remplissage coulé entre elles : un bloc d'un seul tenant
  for (const sd of [1, -1]) {
    B.piece = rng.int(0, 255);
    slab(B, { o: [0, yc, sd * 0.03], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }, cres, 0.024, 0.004, STEEL);
  }
  B.piece = rng.int(0, 255);
  { const N2 = outlineInset(cres, 0.004); slab(B, { o: [0, yc, 0], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }, N2, 0.04, 0.003, CAST); }
  // rivets du contrepoids : le long de l'arc extérieur et intérieur
  for (let j = 1; j < 12; j++) {
    const a = cw - span / 2 + (span * j) / 12;
    for (const inner of [false, true]) {
      if (inner && abs(a - cw) > span * 0.3) continue;
      const rr = inner ? innerR(a) + 0.028 : rA - 0.028;
      for (const sd of [1, -1]) { B.piece = rng.int(0, 255); rivet(B, [cos(a) * rr, yc + sin(a) * rr, sd * 0.042], [0, 0, sd], 0.018, STEEL); }
    }
  }
  // maneton : bossage sur la jante côté avant, broche, collet, écrou
  const rc = p.crankR;
  const cp = [cos(crankA) * rc, yc + sin(crankA) * rc];
  B.piece = rng.int(0, 255);
  revolve(B, frame([cp[0], cp[1], 0], [0, 0, 1], [1, 0, 0]), [[0, -0.04], [0.085, -0.04], [0.095, -0.03], [0.095, 0.035], [0.085, 0.045], [0.06, 0.05], [0, 0.05]], CAST, { M: 48, smooth: 0.6 });
  B.piece = rng.int(0, 255);
  revolve(B, frame([cp[0], cp[1], 0.05], [0, 0, 1], [1, 0, 0]), [[0, 0], [0.055, 0], [0.055, 0.012], [0.05, 0.016], [0.05, 0.13], [0.065, 0.135], [0.07, 0.15], [0.065, 0.16], [0.042, 0.165], [0, 0.165]], STEEL, { M: 48, smooth: 0.6 });
  hexPrism(B, frame([cp[0], cp[1], 0.215], [0, 0, 1]), 0.06, 0.03, STEEL, { both: true });
  // essieu (derrière : vers le palier) et chapeau de moyeu
  B.piece = rng.int(0, 255);
  revolve(B, Fz(-0.6), [[0, 0], [0.085, 0], [0.09, 0.005], [0.09, 0.5], [0.095, 0.5], [0.095, 0.71], [0.08, 0.72], [0.06, 0.73], [0, 0.73]], STEEL, { M: 48, smooth: 0.6 });
  hexPrism(B, frame([0, yc, 0.11], [0, 0, 1]), 0.12, 0.05, STEEL, { both: true });
  threadEnd(B, [0, yc, 0.16], [0, 0, 1], 0.06, 0.025, 0.006, STEEL);
  // pitons de levage : vissés dans le bandage, en haut, de part et d'autre
  // (les élingues montent droit au crochet sans rien traverser)
  const lifts = [];
  for (const s of [-1, 1]) { B.piece = rng.int(0, 255); const a = PI / 2 + s * 0.32, d = [cos(a), sin(a), 0]; lifts.push(eyeBolt(B, [d[0] * R, yc + d[1] * R, 0.012], d, [0, 0, 1], 0.016, STEEL)); }
  // ── support : coupon de rail sur deux traverses, cales, chevalet sous l'essieu
  {
    // rail (profil Vignole) le long de x, à z = boudin
    const zr = -0.0;
    const prof = [[-0.065, 0], [0.065, 0], [0.065, 0.008], [0.012, 0.018], [0.008, 0.09], [0.032, 0.1], [0.034, 0.13], [-0.034, 0.13], [-0.032, 0.1], [-0.008, 0.09], [-0.012, 0.018], [-0.065, 0.008]];
    S.piece = rng.int(0, 255);
    prism(S, { o: [0, railTop - 0.13, zr], X: [0, 0, 1], Y: [0, 1, 0], Z: [-1, 0, 0] }, roundPoly(prof, 0.004, 2), -0.5, 0.5, PAINT, { smooth: 0.7, nz: 4 });
    for (const x of [-0.32, 0.32]) { S.piece = rng.int(0, 255); block(S, [x, (railTop - 0.13) / 2, zr - 0.1], [0.09, (railTop - 0.13) / 2, 0.36]); }
    // cales de bois de part et d'autre de la roue, posées sur le rail
    for (const s of [-1, 1]) {
      S.piece = rng.int(0, 255);
      const xw = s * (sqrt(max(0, R * R - (R - 0.05) ** 2)) + 0.06);
      block(S, [xw, railTop + 0.03, zr], [0.06, 0.03, 0.05], 0.006);
    }
    // chevalet de chêne sous l'essieu, derrière
    S.piece = rng.int(0, 255);
    const ze = -0.4;
    block(S, [0, (yc - 0.09) / 2, ze], [0.22, (yc - 0.09) / 2 - 0.0, 0.08]);
  }
  return { B, S, lifts };
}

// ════════════════════════════════════════════════════════════════════════════
// Porte étanche de navire dans sa cloison
// ════════════════════════════════════════════════════════════════════════════
function buildDoor(p, rng) {
  const B = new Buffers(1 << 17), S = new Buffers();
  const W = p.width, H = p.height, base = 0.12;
  const bw = W + 0.42, bh = H + 0.36;
  const cy = base + 0.07 + bh / 2; // centre de la cloison
  const tb = 0.01;
  const XY = (z) => ({ o: [0, cy, z], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] });
  // cloison
  B.piece = rng.int(0, 255);
  slab(B, XY(tb / 2), roundPoly([[-bw / 2, -bh / 2], [bw / 2, -bh / 2], [bw / 2, bh / 2], [-bw / 2, bh / 2]], 0.02, 3), tb, 0.003, STEEL);
  // contour de la porte (rectangle à grands congés, ou ovale)
  const opening = p.oval
    ? Array.from({ length: 64 }, (_, i) => { const a = (i / 64) * 2 * PI; const c = cos(a), s = sin(a); return [W / 2 * Math.sign(c) * abs(c) ** 0.6, H / 2 * Math.sign(s) * abs(s) ** 0.6]; })
    : roundPoly([[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]], 0.16, 8);
  // hiloire : cornière balayée le long du contour, aile à plat sur la cloison
  const ca = 0.075, ct = 0.011;
  B.piece = rng.int(0, 255);
  ringSweep(B, XY(tb), opening, roundPoly([[0, 0], [ca, 0], [ca, ct], [ct, ct], [ct, ca], [0, ca]], [ct * 0.25, ct / 2, ct / 2, ct, ct / 2, ct / 2], 3), STEEL);
  // rivets de l'hiloire (sur l'aile à plat) et de la cloison (rive)
  const along = (path, off, step) => {
    const pts = [], N = [];
    const n = path.length;
    let acc = 0;
    const outN = (i) => { const a = path[(i + n - 1) % n], c = path[(i + 1) % n]; const t = norm([c[0] - a[0], c[1] - a[1], 0]); return [t[1], -t[0]]; };
    for (let i = 0; i < n; i++) {
      const a = path[i], b = path[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (acc <= l) { const t = acc / l, q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], o = outN(i); pts.push([q[0] + o[0] * off, q[1] + o[1] * off]); acc += step; }
      acc -= l;
    }
    return pts;
  };
  const oc = opening[0][0] < 0 ? opening : opening;
  const ccwOpen = (() => { let a = 0; for (let i = 0; i < oc.length; i++) { const p0 = oc[i], q = oc[(i + 1) % oc.length]; a += p0[0] * q[1] - q[0] * p0[1]; } return a < 0 ? oc.slice().reverse() : oc; })();
  for (const q of along(ccwOpen, ca * 0.6, 0.085)) { B.piece = rng.int(0, 255); rivet(B, [q[0], cy + q[1], tb + ct], [0, 0, 1], 0.017, STEEL); }
  // battant : tôle posée contre l'arête de l'aile saillante, débordant de 3 cm
  const zl = tb + ca + 0.004, tl = 0.012;
  const leaf = along(ccwOpen, 0.03, 0.02);
  B.piece = rng.int(0, 255);
  slab(B, XY(zl + tl / 2), leaf, tl, 0.004, STEEL);
  // raidisseurs du battant (plats sur chant) : deux horizontaux et un vertical
  const zs = zl + tl;
  const stiff = (x0, y0, x1, y1) => {
    B.piece = rng.int(0, 255);
    const dir = norm([x1 - x0, y1 - y0, 0]);
    const F = { o: [x0, cy + y0, zs], X: dir, Y: [0, 0, 1], Z: norm(cross(dir, [0, 0, 1])) };
    const len = Math.hypot(x1 - x0, y1 - y0);
    slab(B, F, roundPoly([[0, 0], [len, 0], [len - 0.02, 0.06], [0.02, 0.06]], 0.006, 2), 0.012, 0.003, STEEL);
  };
  const sx = W / 2 - 0.08, sy = H / 2 - 0.12;
  stiff(-sx, H * 0.18, sx, H * 0.18); stiff(-sx, -H * 0.2, sx, -H * 0.2);
  if (!p.oval) stiff(0, -sy, 0, sy);
  // taquets : tourillon sur patte rivetée à la cloison, bras qui passe au-dessus du battant
  const nd = p.dogs;
  const per = along(ccwOpen, 0.13, 1e-3);
  for (let k = 0; k < nd; k++) {
    const q = per[Math.floor(((k + 0.5) / nd) * per.length) % per.length];
    const c = [q[0], cy + q[1]];
    const out2 = norm([q[0] / (W / 2) ** 2, q[1] / (H / 2) ** 2, 0]);
    const tan = [-out2[1], out2[0], 0];
    // patte
    B.piece = rng.int(0, 255);
    const lug = [[-0.05, -0.04], [0.05, -0.04], [0.05, 0.04], [-0.05, 0.04]].map(([a, b]) => [c[0] + tan[0] * a + out2[0] * b, c[1] + tan[1] * a + out2[1] * b]);
    slab(B, { o: [0, 0, tb + 0.006], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }, roundPoly(lug, 0.012, 3), 0.012, 0.003, STEEL);
    for (const a of [-0.032, 0.032]) rivet(B, [c[0] + tan[0] * a, c[1] + tan[1] * a, tb + 0.012], [0, 0, 1], 0.012, STEEL);
    // tourillon (cylindre perpendiculaire à la cloison)
    B.piece = rng.int(0, 255);
    revolve(B, frame([c[0], c[1], tb + 0.012], [0, 0, 1], [1, 0, 0]), [[0, 0], [0.022, 0], [0.022, 0.07], [0.018, 0.075], [0, 0.076]], STEEL, { M: 24, smooth: 0.7 });
    // bras : du tourillon vers l'intérieur, au-dessus du battant (coin)
    const tipIn = 0.07, zA = zs + 0.014;
    const pts = [];
    for (let j = 0; j <= 10; j++) { const t = j / 10; pts.push([c[0] - out2[0] * (tipIn * t) , c[1] - out2[1] * (tipIn * t), tb + 0.075 + (zA - tb - 0.075) * min(1, t * 1.6)]); }
    loft(B, pts, (i) => [0.016, 0.011], STEEL, { nr: 12, up: [0, 0, 1], caps: true });
    // poignée : vers l'extérieur, terminée par une boule
    const hp = [];
    for (let j = 0; j <= 10; j++) { const t = j / 10; hp.push([c[0] + out2[0] * (0.11 * t), c[1] + out2[1] * (0.11 * t), tb + 0.07 + 0.02 * t]); }
    loft(B, hp, () => [0.011, 0.011], STEEL, { nr: 12, up: [0, 0, 1] });
    revolve(B, frame(hp[10], [out2[0], out2[1], 0.15]), (() => { const pr = [[0, -0.018]]; for (let j = 1; j < 10; j++) { const a = -PI / 2 + (PI * j) / 10; pr.push([0.018 * cos(a), 0.018 * sin(a)]); } pr.push([0, 0.018]); return pr; })(), STEEL, { M: 16, smooth: 1.2 });
  }
  // charnières (côté gauche) : pentures rivetées sur le battant, nœuds et axe
  for (const hy of [H * 0.3, -H * 0.3]) {
    B.piece = rng.int(0, 255);
    const x0 = -W / 2 - 0.03, y = cy + hy;
    slab(B, { o: [0, 0, zs + 0.005], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }, roundPoly([[x0 - 0.02, y - 0.035], [x0 + 0.34, y - 0.025], [x0 + 0.36, y], [x0 + 0.34, y + 0.025], [x0 - 0.02, y + 0.035]], 0.01, 3), 0.01, 0.003, STEEL);
    for (const xr of [0.08, 0.17, 0.26]) rivet(B, [x0 + xr, y, zs + 0.01], [0, 0, 1], 0.014, STEEL);
    B.piece = rng.int(0, 255);
    const xk = x0 - 0.05;
    revolve(B, frame([xk, y - 0.07, (tb + zs) / 2 + 0.02], [0, 1, 0], [1, 0, 0]), [[0, 0], [0.024, 0], [0.026, 0.004], [0.026, 0.136], [0.024, 0.14], [0, 0.14]], STEEL, { M: 24, smooth: 0.7 });
    revolve(B, frame([xk, y + 0.07, (tb + zs) / 2 + 0.02], [0, 1, 0], [1, 0, 0]), [[0, 0], [0.012, 0], [0.012, 0.02], [0.02, 0.022], [0.02, 0.032], [0, 0.034]], STEEL, { M: 16, smooth: 0.7 });
    // patte de cloison
    slab(B, { o: [0, 0, tb + 0.005], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }, roundPoly([[xk - 0.09, y - 0.06], [xk + 0.01, y - 0.06], [xk + 0.01, y + 0.06], [xk - 0.09, y + 0.06]], 0.01, 3), 0.01, 0.003, STEEL);
    for (const yr of [-0.035, 0.035]) rivet(B, [xk - 0.06, y + yr, tb + 0.01], [0, 0, 1], 0.014, STEEL);
  }
  // plaque de laiton (accent) rivetée aux quatre coins
  {
    B.piece = rng.int(0, 255);
    const py = cy + H * 0.36, pw = 0.2, ph = 0.07, px = p.oval ? 0 : -W * 0.22;
    slab(B, { o: [px, py, zs + 0.0025], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }, roundPoly([[-pw / 2, -ph / 2], [pw / 2, -ph / 2], [pw / 2, ph / 2], [-pw / 2, ph / 2]], 0.008, 3), 0.004, 0.0015, BRONZE);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) rivet(B, [px + a * (pw / 2 - 0.014), py + b * (ph / 2 - 0.014), zs + 0.0045], [0, 0, 1], 0.007, BRONZE, 10);
  }
  // pied : cornière rivetée au bas de la cloison, sur deux madriers ; goussets derrière
  B.piece = rng.int(0, 255);
  const yb = cy - bh / 2;
  for (const sd of [1, -1]) {
    prism(B, { o: [0, base, sd > 0 ? tb : 0], X: [0, 0, sd], Y: [0, 1, 0], Z: norm(cross([0, 0, sd], [0, 1, 0])) }, angleProfile(0.09, 0.01), -bw / 2, bw / 2, STEEL, { nz: 6 });
    for (let x = -bw / 2 + 0.06; x < bw / 2 - 0.04; x += 0.11) rivet(B, [x, base + 0.05, sd > 0 ? tb + 0.01 : -0.01], [0, 0, sd], 0.016, STEEL);
  }
  for (const xs of [-1, 1]) {
    B.piece = rng.int(0, 255);
    slab(B, { o: [xs * (bw / 2 - 0.12), 0, 0], X: [0, 0, -1], Y: [0, 1, 0], Z: [1, 0, 0] }, roundPoly([[0.01, base + 0.01], [0.32, base + 0.01], [0.012, base + 0.5]], 0.02, 3), 0.012, 0.003, STEEL);
  }
  for (const xs of [-1, 1]) { S.piece = rng.int(0, 255); block(S, [xs * (bw / 2 - 0.2), base / 2, -0.1], [0.08, base / 2, 0.36]); }
  // pitons en haut de la cloison
  const lifts = [];
  for (const s of [-1, 1]) { B.piece = rng.int(0, 255); lifts.push(eyeBolt(B, [s * (bw / 2 - 0.12), yb + bh, tb / 2], [0, 1, 0], [1, 0, 0], 0.018, STEEL)); }
  return { B, S, lifts };
}

// ── Catalogue ────────────────────────────────────────────────────────────────
export const FAMILIES = {
  noeud: { label: 'Nœud riveté', build: buildNode },
  vanne: { label: 'Vanne', build: buildValve },
  roue: { label: 'Roue motrice', build: buildWheel },
  porte: { label: 'Porte étanche', build: buildDoor },
};

// tirage des paramètres d'une pièce (dans recipe.js, flux 'piece')
export function pieceParams(family, rng) {
  switch (family) {
    case 'noeud': {
      const n = rng.pick([3, 4, 4, 5]);
      const sets = { 3: [[48, 90, 132], [40, 75, 140], [55, 125, 90]], 4: [[38, 70, 110, 142], [35, 62, 90, 145], [42, 90, 115, 148]], 5: [[32, 58, 90, 122, 148]] };
      return { angles: rng.pick(sets[n]), chordLength: +rng.range(1.3, 1.55).toFixed(2), chordLeg: rng.pick([0.1, 0.11]), memberLeg: rng.pick([0.08, 0.09, 0.1]), memberLength: +rng.range(0.85, 1.05).toFixed(2), pitch: rng.pick([0.07, 0.075, 0.08]), rivetsPerRow: rng.int(4, 6) };
    }
    case 'vanne': return { pipe: rng.pick([0.168, 0.194, 0.219]), bolts: rng.pick([8, 12, 12, 16]), bonnetBolts: rng.pick([8, 10, 12]), length: +rng.range(1.25, 1.5).toFixed(2), wheel: +rng.range(0.17, 0.23).toFixed(2), spokes: rng.pick([4, 5, 6]) };
    case 'roue': return { radius: +rng.range(0.58, 0.66).toFixed(2), spokes: rng.pick([12, 14, 16, 18]), counterSpan: +rng.range(1.3, 1.9).toFixed(2), crankR: +rng.range(0.28, 0.34).toFixed(2) };
    case 'porte': return { width: +rng.range(0.66, 0.78).toFixed(2), height: +rng.range(1.15, 1.3).toFixed(2), oval: rng.chance(0.35), dogs: rng.pick([6, 8, 8, 10]) };
    default: throw new Error(`famille inconnue : ${family}`);
  }
}

export function buildPiece({ family, params, seed }) {
  const rng = createRng(`${seed}:${family}`);
  const { B, S, lifts } = FAMILIES[family].build(params, rng);
  const body = B.out(), stand = S.out();
  const [lo, hi] = bbox(body.position);
  return { body, stand, info: { lo, hi, lifts, verts: B.n, standVerts: S.n } };
}
