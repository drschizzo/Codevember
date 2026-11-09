// Ce qu'on mesure d'une orbite trouvée : taille, plus courte approche,
// spectre (et donc nombre d'engrenages pour la reproduire), croisements de la
// courbe, signature invariante (pour reconnaître une orbite déjà vue).
import { curveAt } from './action.js';

const TAU = Math.PI * 2;

export function spectrum(c, { D, K }) {
  const e = new Float64Array(K + 1);
  let total = 0;
  for (let k = 1; k <= K; k++) {
    const base = (k - 1) * 2 * D;
    let s = 0;
    for (let i = 0; i < 2 * D; i++) s += c[base + i] * c[base + i];
    e[k] = s; total += s;
  }
  return { e, total };
}

export function sampleCurve(c, p, n = 512) {
  const { D } = p, pts = new Float64Array(n * D), pos = new Float64Array(D);
  for (let i = 0; i < n; i++) {
    curveAt(c, p, (TAU * i) / n, pos);
    for (let d = 0; d < D; d++) pts[i * D + d] = pos[d];
  }
  return pts;
}

// croisements de la projection sur le plan xy (polyligne fermée)
function crossings(pts, D, n) {
  let count = 0;
  const seg = (i) => [pts[i * D], pts[i * D + 1], pts[((i + 1) % n) * D], pts[((i + 1) % n) * D + 1]];
  for (let i = 0; i < n; i++) {
    const [ax, ay, bx, by] = seg(i);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [cx, cy, dx, dy] = seg(j);
      const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      if (d1 * d2 >= 0) continue;
      const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
      const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
      if (d3 * d4 < 0) count++;
    }
  }
  return count;
}

export function analyze(c, p, action) {
  const { N, D, K } = p;
  const n = 512 - (512 % N);
  const pts = sampleCurve(c, p, n);
  let size = 0;
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let d = 0; d < D; d++) r += pts[i * D + d] ** 2;
    size = Math.max(size, Math.sqrt(r));
  }
  // plus courte approche entre deux corps, sur toute la période
  let rmin = Infinity;
  const sh = n / N;
  for (let i = 0; i < n; i++) {
    for (let j = 1; j < N; j++) {
      const i2 = (i + j * sh) % n;
      let r = 0;
      for (let d = 0; d < D; d++) r += (pts[i * D + d] - pts[i2 * D + d]) ** 2;
      rmin = Math.min(rmin, Math.sqrt(r));
    }
  }
  const { e, total } = spectrum(c, p);
  let top = 0, entropy = 0;
  const amps = [];
  for (let k = 1; k <= K; k++) {
    top = Math.max(top, e[k] / total);
    if (e[k] > 0) { const q = e[k] / total; entropy -= q * Math.log(q); }
    amps.push([k, Math.sqrt(e[k])]);
  }
  // engrenages : harmoniques gardées (les plus fortes d'abord) jusqu'à ce que
  // le reste tienne sous 0,2 % de la taille
  amps.sort((a, b) => b[1] - a[1]);
  let rest = amps.reduce((s, a) => s + a[1], 0), gears = 0;
  while (gears < amps.length && rest > 0.002 * size) rest -= amps[gears++][1];
  // part de la troisième moitié haute du spectre : la série est-elle résolue ?
  let tail = 0;
  for (let k = Math.floor((2 * K) / 3); k <= K; k++) tail += e[k];
  // une courbe dont toutes les harmoniques sont multiples de g est parcourue
  // g fois : c'est une orbite plus simple, déjà vue, aux corps renumérotés
  let cover = 0;
  for (let k = 1; k <= K; k++) if (e[k] > 1e-9 * total) cover = gcd(cover, k);
  const zShare = D === 3 ? zEnergy(c, p) / total : 0;
  const cross = crossings(pts, D, n);
  // signature : invariante par décalage du temps, rotation autour de z et symétrie miroir
  const sym = p.sym ? `${p.sym.m}/${p.sym.l}${p.sym.mirror ? 'M' : ''}` : '-';
  const sig = [N, D, sym, Math.abs(p.omega).toFixed(3), action.toFixed(3),
    amps.slice(0, 4).map(([k, a]) => `${k}:${(a / size).toFixed(2)}`).join(',')].join('|');
  return {
    size, rmin, ratio: rmin / size, cover, top, entropy, gears, tail: tail / total, zShare, crossings: cross,
    harmonics: amps.slice(0, gears).map(([k]) => k), sig,
  };
}

// Le certificat : résidu de la loi de Newton le long de la courbe, relatif à
// l'accélération la plus forte. Dans le repère tournant, l'accélération
// inertielle est ẍ + 2ω e_z × ẋ − ω² x⊥ ; elle doit égaler la gravitation des
// N − 1 autres corps. (Une intégration d'un seul tenant ne prouve rien sur une
// orbite instable : la moindre erreur y est amplifiée d'un facteur énorme.)
export function residual(c, p, n = 0) {
  const { N, D, K, omega } = p;
  n = n || N * Math.ceil((8 * K) / N);
  const X = new Float64Array(n * D), V = new Float64Array(n * D), A = new Float64Array(n * D);
  for (let k = 1; k <= K; k++) {
    const b = (k - 1) * 2 * D;
    for (let d = 0; d < D; d++) {
      const a0 = c[b + d], b0 = c[b + D + d];
      if (a0 === 0 && b0 === 0) continue;
      for (let i = 0; i < n; i++) {
        const t = (TAU * i * k) / n, cs = Math.cos(t), sn = Math.sin(t);
        const x = a0 * cs + b0 * sn;
        X[i * D + d] += x; V[i * D + d] += k * (b0 * cs - a0 * sn); A[i * D + d] -= k * k * x;
      }
    }
  }
  const sh = n / N;
  let worst = 0, amax = 0;
  const f = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const o = i * D;
    f[0] = f[1] = f[2] = 0;
    for (let j = 1; j < N; j++) {
      const o2 = ((i + j * sh) % n) * D;
      let r2 = 0;
      for (let d = 0; d < D; d++) r2 += (X[o2 + d] - X[o + d]) ** 2;
      const k3 = 1 / (r2 * Math.sqrt(r2));
      for (let d = 0; d < D; d++) f[d] += (X[o2 + d] - X[o + d]) * k3;
    }
    const ax = A[o] - 2 * omega * V[o + 1] - omega * omega * X[o];
    const ay = A[o + 1] + 2 * omega * V[o] - omega * omega * X[o + 1];
    const az = D === 3 ? A[o + 2] : 0;
    const e = Math.hypot(ax - f[0], ay - f[1], az - f[2]);
    worst = Math.max(worst, e);
    amax = Math.max(amax, Math.hypot(f[0], f[1], f[2]));
  }
  return worst / amax;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

function zEnergy(c, { D, K }) {
  let s = 0;
  for (let k = 1; k <= K; k++) { const b = (k - 1) * 2 * D; s += c[b + 2] ** 2 + c[b + D + 2] ** 2; }
  return s;
}
