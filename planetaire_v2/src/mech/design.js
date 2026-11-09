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
// ── Les étages. Chaque bras et le train qu'il porte forment une « dalle ».
// Les dalles de même rang de deux astres différents qui se croisent (à un
// instant quelconque de la période) doivent être à des hauteurs différentes ;
// la goupille d'un astre, qui monte du bout de sa chaîne jusqu'au plan des
// astres, doit passer au-dessus des dalles qu'elle croise. On répartit les
// dalles par coloration de ce graphe de conflits ; ce qui ne peut pas être
// résolu est compté comme collision.

const TAU = Math.PI * 2;
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

export const SLAB = 0.016;     // épaisseur d'une dalle (bras + train)
export const MIN_TEETH = 10;
const MARGIN = 0.008;           // jeu entre pièces mobiles
const PIN_R = 0.0035;

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
    if (rmax <= L / 3 || n >= 7) break;
  }
  const gears = [{ role: 'A', z: zA, x: 0 }];
  let x = (m * zA) / 2;
  for (let i = 0; i < n; i++) { x += (m * zI) / 2; gears.push({ role: 'I', z: zI, x }); x += (m * zI) / 2; }
  gears.push({ role: 'B', z: zB, x: L });
  for (const g of gears) g.r = (m * g.z) / 2;
  return { m, gears, n, ratio: (negative ? -1 : 1) * (zA / zB) };
}

export function designMachine(arms, N, { samples = 192 } = {}) {
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
  const barW = L.map((l) => Math.min(0.02, Math.max(0.006, 0.012 + 0.012 * l)));
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
  const body = []; // body[s][j] = [x, y]
  for (let s = 0; s < samples; s++) {
    const t = (TAU * s) / samples;
    const S = [], B = [];
    for (let j = 0; j < N; j++) {
      const Pj = Float64Array.from(pivots(t + (TAU * j) / N));
      const row = [];
      for (let i = 0; i < n; i++) {
        const x0 = Pj[2 * i], y0 = Pj[2 * i + 1], x1 = Pj[2 * i + 2], y1 = Pj[2 * i + 3];
        const ux = (x1 - x0) / (L[i] || 1), uy = (y1 - y0) / (L[i] || 1);
        row.push([x0 - ux * cw[i], y0 - uy * cw[i], x1, y1]);
      }
      S.push(row); B.push([Pj[2 * n], Pj[2 * n + 1]]);
    }
    seg.push(S); body.push(B);
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
  // goupille de j au-dessus de la dalle (i, j2) qu'elle croise : below[j2][i] ∋ j
  // (la dalle doit être plus basse que le point de départ de la goupille)
  const pinHits = []; // [jPin, i, jSlab]
  for (let j = 0; j < N; j++) {
    for (let j2 = 0; j2 < N; j2++) {
      if (j2 === j) continue;
      for (let i = 0; i < n; i++) {
        for (let s = 0; s < samples; s++) {
          if (pointSeg(body[s][j][0], body[s][j][1], seg[s][j2][i]) < halfW[i] + PIN_R + MARGIN) { pinHits.push([j, i, j2]); break; }
        }
      }
    }
  }

  // ── étages. Rang i : bande d'épaisseur S_i dalles ; la goupille de j part du
  // haut de sa dernière dalle. Une dalle (i, j2) croisée par la goupille de j
  // doit être sous la dernière dalle de j : si i < n − 1, c'est automatique
  // (bandes empilées) ; au dernier rang, c'est une contrainte d'ordre.
  const level = Array.from({ length: n }, () => new Array(N).fill(0));
  const S = new Array(n).fill(1);
  let collisions = 0;
  for (let i = 1; i < n; i++) {
    const last = i === n - 1;
    // contraintes d'ordre au dernier rang : niveau(j2) < niveau(j)
    const before = Array.from({ length: N }, () => new Set());
    if (last) for (const [j, ii, j2] of pinHits) if (ii === i) before[j].add(j2);
    // ordre de traitement : tri topologique (les cycles sont des collisions)
    const order = [], seen = new Array(N).fill(0);
    const visit = (j) => {
      if (seen[j] === 2) return;
      if (seen[j] === 1) { collisions++; return; }
      seen[j] = 1;
      for (const j2 of before[j]) visit(j2);
      seen[j] = 2; order.push(j);
    };
    for (let j = 0; j < N; j++) visit(j);
    for (const j of order) {
      let lv = 0;
      for (const j2 of before[j]) if (order.indexOf(j2) < order.indexOf(j)) lv = Math.max(lv, level[i][j2] + 1);
      const used = new Set([...conflict[i][j]].filter((j2) => order.indexOf(j2) < order.indexOf(j)).map((j2) => level[i][j2]));
      while (used.has(lv)) lv++;
      level[i][j] = lv;
    }
    S[i] = Math.max(...level[i]) + 1;
  }

  // hauteur de chaque dalle (base de la bande + sous-étage), à partir de 0
  const base = [0];
  for (let i = 1; i < n; i++) base.push(base[i - 1] + S[i - 1] * SLAB);
  const height = base[n - 1] + S[n - 1] * SLAB;

  return {
    arms, N, n, k, L, phi, trains, barW, halfW, cw, level, S, base, height, collisions,
    conflicts: conflict.map((c) => c.reduce((a, s) => a + s.size, 0) / 2),
    pinHits: pinHits.length,
    // pivots d'une chaîne (repère du plateau)
    pivots: (t, out) => { pivots(t); if (out) out.set(P); return out || P; },
  };
}
