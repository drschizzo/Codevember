// Croissance d'un cristal de neige : le modèle mésoscopique de Gravner et
// Griffeath (« Modeling snow crystal growth II: a mesoscopic lattice map with
// plausible dynamics », Physica D 237, 2008).
//
// Réseau hexagonal (coordonnées axiales q, r ; voisins (±1, 0), (0, ±1),
// (1, −1), (−1, 1)). Chaque cellule porte quatre grandeurs :
//   a  attachée (fait partie du cristal) ou non,
//   b  masse « de bord » (couche quasi liquide),
//   c  masse de glace,
//   d  masse de vapeur, qui diffuse.
// Un pas :
//   1. diffusion : d ← moyenne de d sur la cellule et ses six voisines (une
//      voisine attachée renvoie la valeur de la cellule : la vapeur ne la
//      traverse pas) ;
//   2. gel : sur une cellule de bord (non attachée, au moins une voisine
//      attachée), une part κ de la vapeur devient glace, le reste masse de bord ;
//   3. attachement : une cellule de bord à n voisines attachées s'attache si
//      n ≤ 2 et b ≥ β ; si n = 3 et (b ≥ 1, ou b ≥ α et peu de vapeur autour,
//      Σd < θ) ; toujours si n ≥ 4 (elle comble un creux) ;
//   4. fonte : une part μ de la masse de bord et γ de la glace des cellules
//      de bord retourne à la vapeur ;
//   5. bruit : la vapeur est multipliée par 1 ± σ (asymétrie des bras).
// La vapeur s'épuise près du cristal ; les pointes, qui voient plus de
// vapeur, avancent plus vite et se ramifient (instabilité de Mullins-Sekerka) ;
// les faces planes avancent par attachement collectif (n = 3).
//
// Le bord du domaine (anneau R) est un réservoir à la densité ρ. Seuls les
// anneaux proches du cristal sont calculés (au-delà, d = ρ inchangé).
//
// Fonction pure, sans dépendance : importable depuis Node et les workers.

export const SQ3 = Math.sqrt(3);

// réseau : indices des cellules du disque hexagonal de rayon R, rangées par
// anneau (distance hexagonale croissante)
export function lattice(R) {
  const N = 2 * R + 1;
  const idx = (q, r) => (r + R) * N + (q + R);
  const ring = new Int16Array(N * N).fill(-1);
  const byRing = Array.from({ length: R + 1 }, () => []);
  for (let r = -R; r <= R; r++) for (let q = -R; q <= R; q++) {
    const h = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
    if (h <= R) { ring[idx(q, r)] = h; byRing[h].push(idx(q, r)); }
  }
  const order = new Int32Array(byRing.flat());
  const ringStart = new Int32Array(R + 2);
  let s = 0;
  for (let k = 0; k <= R; k++) { ringStart[k] = s; s += byRing[k].length; }
  ringStart[R + 1] = s;
  return { R, N, idx, ring, order, ringStart, NB: [1, -1, N, -N, N - 1, -N + 1] };
}

// position cartésienne (pas du réseau = 1) d'un indice
export function cellXY(L, i) {
  const q = (i % L.N) - L.R, r = Math.floor(i / L.N) - L.R;
  return [q + r / 2, (r * SQ3) / 2];
}

// p : { R, rho, beta, alpha, theta, kappa, mu, gamma, sigma, seed, fill, then }
// fill : part du rayon du domaine que le cristal doit atteindre ;
// then : { at, growth } — un second jeu de paramètres, pris quand le cristal
// atteint la part `at` de son rayon final (les conditions changent en chute)
// → { L, a (Uint8), c (Float32), T (Int32 : pas d'attachement, −1 sinon), steps, rmax }
export function grow(p) {
  const it = growSteps(p);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

// la même croissance, pas à pas : rend la main toutes les `every` étapes
// (l'écran de chargement la dessine pendant qu'elle se fait)
export function* growSteps(p, every = 0) {
  const { R, sigma = 0, fill = 0.9, maxSteps = 60000 } = p;
  let { rho, beta, alpha, theta, kappa, mu, gamma } = p;
  let switched = !p.then;
  const L = lattice(R);
  const { N, order, ringStart, NB, ring } = L;
  const M = N * N;
  const a = new Uint8Array(M), b = new Float32Array(M), c = new Float32Array(M);
  const d = new Float32Array(M), d2 = new Float32Array(M), nAtt = new Uint8Array(M);
  const T = new Int32Array(M).fill(-1);
  for (let k = 0; k < order.length; k++) d[order[k]] = rho;
  // germe : la cellule centrale (le nucléus)
  const o = L.idx(0, 0);
  a[o] = 1; c[o] = 1; d[o] = 0; T[o] = 0;
  // bruit déterministe (xorshift) : seul le bruit dépend de la graine
  let s32 = (p.seed ?? 1) >>> 0 || 1;
  const rnd = () => { s32 ^= s32 << 13; s32 >>>= 0; s32 ^= s32 >>> 17; s32 ^= s32 << 5; s32 >>>= 0; return s32 / 4294967296; };

  let rmax = 0, t = 0;
  const target = Math.floor(R * fill), att = [];
  for (t = 1; t <= maxSteps; t++) {
    const lim = Math.min(R - 1, rmax + 24); // (anneaux actifs)
    const end = ringStart[lim + 1];
    // 1. diffusion
    for (let k = 0; k < end; k++) {
      const i = order[k];
      if (a[i]) { d2[i] = 0; continue; }
      const di = d[i];
      let s = di;
      for (let n = 0; n < 6; n++) { const j = i + NB[n]; s += a[j] ? di : d[j]; }
      d2[i] = s / 7;
    }
    for (let k = 0; k < end; k++) { const i = order[k]; d[i] = d2[i]; }
    // voisines attachées (cellules de bord)
    const edgeEnd = ringStart[Math.min(R, rmax + 2)];
    for (let k = 0; k < edgeEnd; k++) {
      const i = order[k];
      if (a[i]) { nAtt[i] = 0; continue; }
      let n = 0;
      for (let m = 0; m < 6; m++) n += a[i + NB[m]];
      nAtt[i] = n;
    }
    // 2. gel
    for (let k = 0; k < edgeEnd; k++) {
      const i = order[k];
      if (a[i] || !nAtt[i]) continue;
      b[i] += (1 - kappa) * d[i]; c[i] += kappa * d[i]; d[i] = 0;
    }
    // 3. attachement (décidé sur l'état avant attachement)
    att.length = 0;
    for (let k = 0; k < edgeEnd; k++) {
      const i = order[k];
      if (a[i] || !nAtt[i]) continue;
      const n = nAtt[i];
      if (n <= 2) { if (b[i] >= beta) att.push(i); }
      else if (n === 3) {
        if (b[i] >= 1) att.push(i);
        else if (b[i] >= alpha) {
          let s = d[i];
          for (let m = 0; m < 6; m++) s += d[i + NB[m]];
          if (s < theta) att.push(i);
        }
      } else att.push(i);
    }
    for (const i of att) {
      a[i] = 1; c[i] += b[i]; b[i] = 0; T[i] = t;
      if (ring[i] > rmax) rmax = ring[i];
    }
    // 4. fonte (cellules de bord restantes)
    for (let k = 0; k < edgeEnd; k++) {
      const i = order[k];
      if (a[i] || !nAtt[i]) continue;
      d[i] += mu * b[i] + gamma * c[i]; b[i] *= 1 - mu; c[i] *= 1 - gamma;
    }
    // 5. bruit
    if (sigma > 0) for (let k = 0; k < end; k++) { const i = order[k]; if (!a[i]) d[i] *= 1 + sigma * (rnd() < 0.5 ? -1 : 1); }
    if (rmax >= target) break;
    if (every && t % every === 0) yield { L, a, c, t, rmax, target };
    if (!switched && rmax >= p.then.at * target) {
      // l'air change : la vapeur loin du cristal prend la nouvelle densité
      const dr = p.then.growth.rho - rho;
      for (let k = 0; k < order.length; k++) { const i = order[k]; if (!a[i]) d[i] = Math.max(0, d[i] + dr); }
      ({ rho, beta, alpha, theta, kappa, mu, gamma } = p.then.growth);
      switched = true;
    }
  }
  return { L, a, c, T, steps: Math.min(t, maxSteps), rmax };
}
