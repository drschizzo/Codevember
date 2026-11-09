// Conception de la machine : de la série de Fourier à un mécanisme qui la
// trace pour de bon. Ce module ne dessine rien ; il calcule les pièces, leurs
// dentures, leurs étages, et vérifie que tout tient (sous Node comme dans la
// page).
//
// ── La chaîne d'un astre. Le bras i a pour longueur |c_i| et tourne à la
// vitesse entière k_i par rapport au plateau. Il pivote au bout du bras i−1,
// par rapport auquel il doit tourner à k_i − k_{i−1}. Transmission (le montage
// des planétaires) : une roue A, solidaire du bras i−2 (le plateau pour i = 1),
// montée sur un tenon qui traverse le moyeu du bras i−1 ; des renvois le long
// du bras i−1 ; la roue B, solidaire du bras i, au bout du bras i−1. Dans le
// repère du bras porteur, A tourne à k_{i−2} − k_{i−1} ; chaque engrènement
// extérieur inverse le sens, d'où
//     (k_i − k_{i−1}) = (k_{i−2} − k_{i−1}) · (−1)^{n+1} · z_A / z_B
// (n renvois, k_{−1} = 0, k_{−2} n'existe pas : le bras 0 est mené par le tube
// central). Le rapport est rationnel ; son signe fixe la parité de n ; le
// nombre de dents est entier ; le module est choisi pour que la chaîne
// A – renvois – B tombe exactement sur la longueur du bras :
//     m · (z_A + z_B + 2 Σ z_renvois) / 2 = |c_{i−1}|.
//
// ── Les étages. L'étoile des bras 0 juste au-dessus du plateau, chaque bras
// un étage plus haut que celui qui le porte, les astres au sommet, au-dessus
// de toutes les roues. Chaque pivot repose sur une
// colonne qui descend jusqu'au plateau, où son patin glisse dans un sillon
// (la courbe que ce pivot décrit). Chaque bras et le train qu'il porte forment
// une « dalle ». Deux dalles de même rang qui se croisent doivent être à des
// hauteurs différentes ; une colonne ne doit croiser aucune dalle plus basse
// qu'elle (au même rang, c'est une contrainte d'ordre ; aux rangs inférieurs,
// une collision). On répartit les dalles par coloration du graphe de conflits,
// et l'on essaie plusieurs ordres de sommation des bras (l'extrémité de la
// chaîne n'en dépend pas) pour garder le meilleur.

const TAU = Math.PI * 2;
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

export const SLAB = 0.034;     // épaisseur d'une dalle (bras + train)
export const MIN_TEETH = 10;
const MARGIN = 0.012;           // jeu entre pièces mobiles
const COL_R = 0.008;
const SHAFT_R = 0.009;          // axe d'un pivot (tenon, canon, roue B)
const STUD_R = 0.0055;          // tenon (scene/machine.js)

// fraction irréductible approchant un rapport (les k sont entiers : exact)
function frac(num, den) {
  const g = gcd(num, den) || 1;
  let p = num / g, q = den / g;
  if (q < 0) { p = -p; q = -q; }
  return [p, q];
}

// train d'engrenages le long d'un bras de longueur L, de rapport signé ρ = p/q
// (vitesse de B / vitesse de A, dans le repère du bras)
export function designTrain(L, p, q) {
  const negative = p * q < 0;
  const ap = Math.abs(p), aq = Math.abs(q);
  // dents : multiples de p et q, au moins MIN_TEETH
  const t = Math.max(1, Math.ceil(MIN_TEETH / Math.min(ap, aq)));
  const zA = ap * t, zB = aq * t;
  // renvois : parité imposée par le sens (aucun ou deux… si ρ < 0 ; un, trois… sinon) ;
  // on en ajoute tant qu'une roue dépasse le tiers de la longueur du bras
  let n = negative ? 0 : 1;
  let zI = 0, m = 0;
  for (; n <= 9; n += 2) {
    zI = Math.max(MIN_TEETH, Math.round(Math.min(zA, zB) * 0.8));
    m = (2 * L) / (zA + zB + 2 * n * zI);
    const rmax = (m * Math.max(zA, zB, n ? zI : 0)) / 2;
    if (rmax <= L / 2.2 || n >= 7) break;
  }
  const gears = [{ role: 'A', z: zA, x: 0 }];
  let x = (m * zA) / 2;
  for (let i = 0; i < n; i++) { x += (m * zI) / 2; gears.push({ role: 'I', z: zI, x }); x += (m * zI) / 2; }
  gears.push({ role: 'B', z: zB, x: L });
  for (const g of gears) g.r = (m * g.z) / 2;
  return { m, gears, n, ratio: (negative ? -1 : 1) * (zA / zB) };
}

function designOrder(arms, N, samples) {
  const n = arms.length;
  const k = arms.map((a) => a.k);
  const L = arms.map((a) => a.amp);
  const phi = arms.map((a) => Math.atan2(a.im, a.re));
  const kk = (i) => (i < 0 ? 0 : k[i]);

  // ── trains : le bras i (i ≥ 1) est mené par un train porté par le bras i−1
  const trains = [null];
  for (let i = 1; i < n; i++) {
    const [p, q] = frac(k[i] - k[i - 1], kk(i - 2) - k[i - 1]);
    const tr = designTrain(L[i - 1], p, q);
    // vérification : rapport obtenu = rapport voulu
    tr.check = Math.abs(tr.ratio - p / q);
    trains.push(tr);
  }

  // ── largeur utile de chaque dalle (bras, contrepoids, roues)
  const barW = L.map((l) => Math.min(0.045, Math.max(0.014, 0.016 + 0.03 * l)));
  const halfW = L.map((l, i) => {
    const tr = trains[i + 1];
    return Math.max(barW[i] / 2, tr ? Math.max(...tr.gears.map((g) => g.r)) : 0) + 0.006;
  });
  // contrepoids : derrière le pivot, équilibre la charge portée
  const cw = L.map((l, i) => (i < n - 1 || true ? 0.22 * l : 0));

  // pivots d'une chaîne à l'instant t (repère du plateau)
  const P = new Float64Array(2 * n + 2);
  function pivots(t) {
    let x = 0, y = 0;
    P[0] = 0; P[1] = 0;
    for (let i = 0; i < n; i++) {
      const a = k[i] * t + phi[i];
      x += L[i] * Math.cos(a); y += L[i] * Math.sin(a);
      P[2 * i + 2] = x; P[2 * i + 3] = y;
    }
    return P;
  }

  // ── segments (avec contrepoids) de toutes les chaînes à chaque instant
  const seg = []; // seg[s][j][i] = [x0, y0, x1, y1]
  const piv = []; // piv[s][j] = pivots
  for (let s = 0; s < samples; s++) {
    const t = (TAU * s) / samples;
    const S = [], B = [];
    for (let j = 0; j < N; j++) {
      const Pj = Float64Array.from(pivots(t + (TAU * j) / N));
      B.push(Pj);
      const row = [];
      for (let i = 0; i < n; i++) {
        const x0 = Pj[2 * i], y0 = Pj[2 * i + 1], x1 = Pj[2 * i + 2], y1 = Pj[2 * i + 3];
        const ux = (x1 - x0) / (L[i] || 1), uy = (y1 - y0) / (L[i] || 1);
        row.push([x0 - ux * cw[i], y0 - uy * cw[i], x1, y1]);
      }
      S.push(row);
    }
    seg.push(S); piv.push(B);
  }

  // ── conflits entre dalles de même rang, et entre goupilles et dalles
  const segDist = (a, b) => {
    const d = (px, py, s) => {
      const vx = s[2] - s[0], vy = s[3] - s[1], l2 = vx * vx + vy * vy || 1e-12;
      const u = Math.max(0, Math.min(1, ((px - s[0]) * vx + (py - s[1]) * vy) / l2));
      return Math.hypot(px - s[0] - u * vx, py - s[1] - u * vy);
    };
    // (segments qui se coupent : distance nulle)
    const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const A0 = [a[0], a[1]], A1 = [a[2], a[3]], B0 = [b[0], b[1]], B1 = [b[2], b[3]];
    if (cross(A0, A1, B0) * cross(A0, A1, B1) < 0 && cross(B0, B1, A0) * cross(B0, B1, A1) < 0) return 0;
    return Math.min(d(a[0], a[1], b), d(a[2], a[3], b), d(b[0], b[1], a), d(b[2], b[3], a));
  };
  const pointSeg = (px, py, s) => {
    const vx = s[2] - s[0], vy = s[3] - s[1], l2 = vx * vx + vy * vy || 1e-12;
    const u = Math.max(0, Math.min(1, ((px - s[0]) * vx + (py - s[1]) * vy) / l2));
    return Math.hypot(px - s[0] - u * vx, py - s[1] - u * vy);
  };

  // les bras 0 de toutes les chaînes tournent ensemble (une étoile) : pas de conflit
  const conflict = Array.from({ length: n }, () => Array.from({ length: N }, () => new Set()));
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < N; j++) {
      for (let j2 = j + 1; j2 < N; j2++) {
        for (let s = 0; s < samples; s++) {
          if (segDist(seg[s][j][i], seg[s][j2][i]) < 2 * halfW[i] + MARGIN) { conflict[i][j].add(j2); conflict[i][j2].add(j); break; }
        }
      }
    }
  }
  // ── galets porteurs. La pile monte depuis le plateau : l'étoile des bras 0
  // juste au-dessus de lui, chaque bras un étage plus haut que celui qui le
  // porte, les astres au sommet. Un bras peut reposer sur une colonne qui
  // descend de son dessous jusqu'au plateau, où son patin glisse dans un
  // sillon ; fixée à la fraction u de sa longueur (u = 1 : sous le pivot
  // suivant, dont elle prolonge l'axe ; u < 0 : sous le contrepoids). Elle
  // traverse les étages plus bas : on cherche une position telle qu'aucune
  // dalle plus basse (de n'importe quelle chaîne) ne passe jamais dessus.
  const U = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25];
  const supports = [];
  const colAt = (s, j, a, u) => {
    const P = piv[s][j];
    return [P[2 * a] + u * (P[2 * a + 2] - P[2 * a]), P[2 * a + 1] + u * (P[2 * a + 3] - P[2 * a + 1])];
  };
  const hits = (s, x, y, j2, i2) => pointSeg(x, y, seg[s][j2][i2]) < halfW[i2] + COL_R + MARGIN;
  // un axe vertical en (x, y) traverse-t-il la vraie forme de la dalle (i2, j2)
  // (barre, contrepoids, roues du train) ? Un axe confondu avec le pivot de la
  // dalle est un montage coaxial, pas une collision.
  const shaftHits = (s, x, y, j2, i2) => {
    const P = piv[s][j2], x0 = P[2 * i2], y0 = P[2 * i2 + 1];
    if (Math.hypot(x - x0, y - y0) < 1e-6) return false;
    const r = SHAFT_R + 0.004;
    if (pointSeg(x, y, seg[s][j2][i2]) < barW[i2] / 2 + r) return true;
    const ux = (P[2 * i2 + 2] - x0) / (L[i2] || 1), uy = (P[2 * i2 + 3] - y0) / (L[i2] || 1);
    if (Math.hypot(x - (x0 - ux * cw[i2]), y - (y0 - uy * cw[i2])) < Math.max(0.006, barW[i2] * 0.95) + r) return true;
    const tr = trains[i2 + 1];
    if (tr) for (const g of tr.gears) if (Math.hypot(x - (x0 + ux * g.x), y - (y0 + uy * g.x)) < g.r + tr.m + r) return true;
    return false;
  };
  for (let a = 0; a < n; a++) {
    // l'étoile (rang 0) ne croise jamais rien : deux galets par bras, sous le
    // pivot et à mi-longueur (deux sillons circulaires)
    if (a === 0) { supports.push(L[0] > 0.25 ? [1, 0.55] : [1]); continue; }
    let found = null;
    for (const u of [...U, -cw[a] / (L[a] || 1)]) {
      let ok = true;
      for (let s = 0; s < samples && ok; s++) {
        for (let j = 0; j < N && ok; j++) {
          const [cx, cy] = colAt(s, j, a, u);
          for (let j2 = 0; j2 < N && ok; j2++) {
            for (let i2 = 0; i2 < a && ok; i2++) if (hits(s, cx, cy, j2, i2)) ok = false;
          }
        }
      }
      if (ok) { found = u; break; }
    }
    supports.push(found === null ? null : [found]);
  }

  // ── étages (rang 0 en bas). Au rang i, deux contraintes d'ordre :
  //   - une colonne qui descend de la dalle (i, j) et croise la dalle (i, j2)
  //     exige que (i, j2) soit plus haute ;
  //   - au dernier rang, la goupille qui monte de (i, j) jusqu'à l'astre et
  //     croise (i, j2) exige que (i, j2) soit plus basse.
  // Un cycle venant d'une colonne la fait retirer ; sinon c'est une collision.
  // Les contraintes sont pondérées par la part du temps où elles comptent :
  // quand elles forment un cycle (deux axes qui montent chacun à travers le
  // bras de l'autre : aucun étagement ne convient), on renonce à la plus brève,
  // et la collision qui reste est comptée en fraction de période.
  const level = Array.from({ length: n }, () => new Array(N).fill(0));
  const S = new Array(n).fill(1);
  let collisions = 0;
  const share = (test) => { let c = 0; for (let s = 0; s < samples; s++) if (test(s)) c++; return c / samples; };
  for (let i = 1; i < n; i++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      // w.get(j)?.get(j2) = poids de « j2 plus bas que j »
      const w = Array.from({ length: N }, () => new Map());
      const add = (hi, lo, f) => { if (f > 0) w[hi].set(lo, Math.max(w[hi].get(lo) || 0, f)); };
      for (let j = 0; j < N; j++) {
        for (let j2 = 0; j2 < N; j2++) {
          if (j2 === j) continue;
          // goupille de l'astre (dernier rang) : monte à travers les dalles plus hautes
          if (i === n - 1) add(j, j2, share((s) => hits(s, piv[s][j][2 * n], piv[s][j][2 * n + 1], j2, i)));
          // colonne de galet : descend à travers les dalles plus basses
          if (supports[i] !== null) add(j2, j, share((s) => { const [cx, cy] = colAt(s, j, i, supports[i][0]); return hits(s, cx, cy, j2, i); }));
          // l'axe qui monte de (i, j), au bout du bras, vers le bras suivant de
          // sa chaîne traverse les dalles plus hautes de ce rang ; celui qui
          // monte du rang inférieur jusqu'au pivot de (i, j), les plus basses
          if (i < n - 1) add(j, j2, share((s) => shaftHits(s, piv[s][j][2 * i + 2], piv[s][j][2 * i + 3], j2, i)));
          add(j2, j, share((s) => shaftHits(s, piv[s][j][2 * i], piv[s][j][2 * i + 1], j2, i)));
        }
      }
      // cycles : on cherche un cycle, on retire son arête la plus légère, etc.
      const findCycle = () => {
        const seen = new Array(N).fill(0), stack = [];
        let found = null;
        const visit = (j) => {
          if (found) return;
          seen[j] = 1; stack.push(j);
          for (const j2 of w[j].keys()) {
            if (found) return;
            if (seen[j2] === 1) { found = stack.slice(stack.indexOf(j2)); return; }
            if (!seen[j2]) visit(j2);
          }
          stack.pop(); seen[j] = 2;
        };
        for (let j = 0; j < N && !found; j++) if (!seen[j]) visit(j);
        return found;
      };
      let cyc = findCycle();
      // (un cycle dû à la colonne : on retire d'abord la colonne)
      if (cyc && supports[i] !== null && attempt === 0) { supports[i] = null; continue; }
      while (cyc) {
        let best = null;
        for (let q = 0; q < cyc.length; q++) {
          const a = cyc[q], b = cyc[(q + 1) % cyc.length], f = w[a].get(b);
          if (!best || f < best.f) best = { a, b, f };
        }
        w[best.a].delete(best.b);
        collisions += best.f;
        cyc = findCycle();
      }
      // ordre topologique (les plus bas d'abord), puis niveaux
      const order = [], seen = new Array(N).fill(0);
      const visit = (j) => { if (seen[j]) return; seen[j] = 1; for (const j2 of w[j].keys()) visit(j2); order.push(j); };
      for (let j = 0; j < N; j++) visit(j);
      for (const j of order) {
        let lv = 0;
        for (const j2 of w[j].keys()) lv = Math.max(lv, level[i][j2] + 1);
        const used = new Set([...conflict[i][j]].filter((j2) => order.indexOf(j2) < order.indexOf(j)).map((j2) => level[i][j2]));
        while (used.has(lv)) lv++;
        level[i][j] = lv;
      }
      S[i] = Math.max(...level[i]) + 1;
      break;
    }
  }

  // hauteur de chaque dalle (base de la bande + sous-étage), à partir de 0
  const base = [0];
  for (let i = 1; i < n; i++) base.push(base[i - 1] + S[i - 1] * SLAB);
  const height = base[n - 1] + S[n - 1] * SLAB;

  return {
    arms, N, n, k, L, phi, trains, barW, halfW, cw, level, S, base, height, collisions,
    conflicts: conflict.map((c) => c.reduce((a, s) => a + s.size, 0) / 2),
    supports, supported: supports.filter((u) => u !== null).length,
    // pivots d'une chaîne (repère du plateau)
    pivots: (t, out) => { pivots(t); if (out) out.set(P); return out || P; },
  };
}

// une conception reçue d'un worker (sans fonction) : on lui rend ses pivots
export function withPivots(D) {
  const { n, k, L, phi } = D, P = new Float64Array(2 * n + 2);
  D.pivots = (t, out) => {
    let x = 0, y = 0;
    P[0] = 0; P[1] = 0;
    for (let i = 0; i < n; i++) { const a = k[i] * t + phi[i]; x += L[i] * Math.cos(a); y += L[i] * Math.sin(a); P[2 * i + 2] = x; P[2 * i + 3] = y; }
    if (out) out.set(P);
    return out || P;
  };
  return D;
}

// plusieurs ordres de sommation des bras (le plus long d'abord, puis des
// permutations tirées) : on garde la machine qui a le moins de collisions,
// puis la plus basse
export function designMachine(arms, N, { samples = 160, tries = 24 } = {}) {
  let best = null;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let t = 0; t < tries; t++) {
    let order = arms.slice();
    if (t > 0) {
      // le premier bras (le plus long) reste en tête : l'étoile du centre
      const rest = order.slice(1);
      for (let i = rest.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [rest[i], rest[k]] = [rest[k], rest[i]]; }
      order = [order[0], ...rest];
    }
    const d = designOrder(order, N, samples);
    // le moins de collisions, puis le plus de galets, puis le plus bas
    const better = !best || d.collisions < best.collisions
      || (d.collisions === best.collisions && (d.supported > best.supported || (d.supported === best.supported && d.height < best.height)));
    if (better) best = d;
    if (best.collisions === 0 && (best.supported === best.n || t >= 7) && t >= 1) break;
  }
  best.portals = portals(best);
  return best;
}

// ── Les passages. Sur les machines les plus complexes, certains croisements
// sont inévitables : les grands bras d'une chaîne balaient les axes verticaux
// des chaînes voisines, et les conflits forment une boucle qu'aucun étagement
// ne défait. La machine les gère : à la hauteur du bras qui arrive, l'axe
// s'ouvre (un portail, voir scene/machine.js) le temps que le bras passe, puis
// se referme. Tout ne dépend que de τ : on calcule d'avance, pour chaque élément
// vertical (axe du pivot p de la chaîne j, ou goupille de l'astre si p = n),
// chaque dalle qu'il rencontre et les fenêtres de temps de la rencontre.
//   portals[j][p] = [{ i, j2, l0, l1, win: [[τ0, τ1], …] }]  (τ sur [0, 2π), τ1
//   peut dépasser 2π ; l0…l1 : niveaux ouverts, ceux de la dalle i de la chaîne
//   j2, ou, si deux axes se croisent (p2 donné), ceux qu'ils partagent : l'un des
//   deux s'ouvre sur toute cette hauteur)
const PORTAL_CLEAR = 0.008; // jeu autour de l'axe pendant le passage
export function portals(D) {
  const { n, N, L, cw, barW, trains, level, base } = D;
  const lv = (i, j) => Math.round((base[i] + level[i][j] * SLAB) / SLAB);
  // rayon de l'élément vertical (axe et canon, ou goupille), tel que construit
  const vR = (p) => (p >= n ? 0.007 : Math.max(STUD_R * 2.2, Math.max(0.009, barW[p] * 0.5) * 0.8));
  const vmax = L.reduce((a, l, i) => a + Math.abs(D.k[i]) * l, 0);
  const S = Math.min(12000, Math.max(3000, Math.ceil((vmax * TAU) / 0.002)));
  const Q = new Float64Array(S * N * (2 * n + 2)), P = new Float64Array(2 * n + 2), st = 2 * n + 2;
  for (let s = 0; s < S; s++) for (let j = 0; j < N; j++) { D.pivots((TAU * s) / S + (TAU * j) / N, P); Q.set(P, (s * N + j) * st); }
  const dist = (x, y, o, i) => {
    const x0 = Q[o + 2 * i], y0 = Q[o + 2 * i + 1], ux = (Q[o + 2 * i + 2] - x0) / (L[i] || 1), uy = (Q[o + 2 * i + 3] - y0) / (L[i] || 1);
    const sl = (x - x0) * ux + (y - y0) * uy, w = Math.abs((y - y0) * ux - (x - x0) * uy);
    let d = Math.hypot(sl - Math.max(-cw[i], Math.min(L[i], sl)), w) - Math.max(barW[i] / 2, 0.009);
    d = Math.min(d, Math.hypot(sl + cw[i], w) - Math.max(0.006, barW[i] * 0.95));
    const tr = trains[i + 1];
    if (tr) for (const g of tr.gears) d = Math.min(d, Math.hypot(sl - g.x, w) - (g.r + tr.m));
    return d;
  };
  const out = Array.from({ length: N }, () => Array.from({ length: n + 1 }, () => []));
  for (let j = 0; j < N; j++) for (let p = 1; p <= n; p++) {
    const lo = lv(p - 1, j), hi = p < n ? lv(p, j) : Infinity, r = vR(p) + PORTAL_CLEAR;
    for (let j2 = 0; j2 < N; j2++) {
      if (j2 === j) continue;
      for (let i = 1; i < n; i++) {
        const l2 = lv(i, j2);
        if (l2 < lo || l2 > hi) continue;
        const hit = new Uint8Array(S);
        let any = false;
        for (let s = 0; s < S; s++) {
          const a = (s * N + j) * st, b = (s * N + j2) * st, x = Q[a + 2 * p], y = Q[a + 2 * p + 1];
          // (axe confondu avec le pivot ou le bout de cette dalle : montage concentrique)
          if (Math.hypot(x - Q[b + 2 * i], y - Q[b + 2 * i + 1]) < 1e-9 || Math.hypot(x - Q[b + 2 * i + 2], y - Q[b + 2 * i + 3]) < 1e-9) continue;
          if (dist(x, y, b, i) < r) { hit[s] = 1; any = true; }
        }
        if (!any) continue;
        const win = [];
        for (let s = 0; s < S; s++) {
          if (!hit[s] || hit[(s + S - 1) % S]) continue;
          let e = s;
          while (hit[(e + 1) % S] && e - s < S) e++;
          win.push([(TAU * (s - 1)) / S, (TAU * (e + 2)) / S]);
        }
        if (!win.length) win.push([0, TAU * 2]); // (toujours en contact)
        out[j][p].push({ i, j2, l0: l2, l1: l2, win });
      }
    }
  }
  // deux axes verticaux qui se croisent (chaînes j < j2) : le premier s'ouvre
  const range = (j, p) => [lv(p - 1, j), p < n ? lv(p, j) : Infinity];
  for (let j = 0; j < N; j++) for (let p = 1; p <= n; p++) for (let j2 = j + 1; j2 < N; j2++) for (let p2 = 1; p2 <= n; p2++) {
    const [a0, a1] = range(j, p), [b0, b1] = range(j2, p2), l0 = Math.max(a0, b0), l1 = Math.min(a1, b1);
    if (l0 > l1) continue;
    const r = vR(p) + vR(p2) + PORTAL_CLEAR;
    const hit = new Uint8Array(S);
    let any = false;
    for (let s = 0; s < S; s++) {
      const a = (s * N + j) * st, b = (s * N + j2) * st, d = Math.hypot(Q[a + 2 * p] - Q[b + 2 * p2], Q[a + 2 * p + 1] - Q[b + 2 * p2 + 1]);
      if (d > 1e-9 && d < r) { hit[s] = 1; any = true; }
    }
    if (!any) continue;
    const win = [];
    for (let s = 0; s < S; s++) {
      if (!hit[s] || hit[(s + S - 1) % S]) continue;
      let e = s;
      while (hit[(e + 1) % S] && e - s < S) e++;
      win.push([(TAU * (s - 1)) / S, (TAU * (e + 2)) / S]);
    }
    if (!win.length) win.push([0, TAU * 2]);
    // (une goupille s'ouvre jusqu'au sommet de la pile)
    out[j][p].push({ p2, j2, l0, l1: Math.min(l1, Math.round(D.height / SLAB)), win });
  }
  return out;
}
