// Les langues de cire : leur contour (une chaînette irrégulière pendue sous la
// voûte), la plaque de la nervure centrale, et un atlas lu par les alvéoles —
// distance au bord (la lisière : les parois y sont plus basses), miel, opercule.
import { createRng } from '../../../shared/rng.js';
import { toHalf } from './bake.js';

export const ATLAS = 160; // (texels par langue)

/** Demi-largeur de la langue à la profondeur y ∈ [0, L] sous la voûte (côté sgn = ±1). */
export function halfWidth(lobe, y, sgn) {
  const t = Math.min(1, Math.max(0, y / lobe.L));
  const body = Math.pow(Math.max(0, 1 - Math.pow(t, lobe.p)), 1 / lobe.q);
  const flare = 1 + lobe.flare * Math.exp(-y / (0.12 * lobe.L));
  const wob = 1 + lobe.wob * Math.sin(y * lobe.wf + lobe.wp * sgn + (sgn > 0 ? 1.7 : 0)) * (1 - t * 0.5) + lobe.skew * sgn * Math.sin(Math.PI * t);
  return lobe.W * body * flare * wob;
}

function border(lobe, n = 90) {
  // polyligne ouverte : côté gauche de haut en bas, puis côté droit de bas en haut
  const P = [];
  for (let i = 0; i <= n; i++) { const y = lobe.L * (1 - Math.pow(1 - i / n, 2.2)); P.push(-halfWidth(lobe, y, -1), -y); }
  for (let i = n - 1; i >= 0; i--) { const y = lobe.L * (1 - Math.pow(1 - i / n, 2.2)); P.push(halfWidth(lobe, y, 1), -y); }
  return P;
}

function distOpen(P, x, y) {
  let best = Infinity;
  for (let i = 0; i + 3 < P.length; i += 2) {
    const ax = P[i], ay = P[i + 1], dx = P[i + 2] - ax, dy = P[i + 3] - ay, l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * spec : { lobes: [{ W, L, p, q, flare, wob, wf, wp, skew, x, z }], content: { cap, honey, patch }, seed }
 * → { atlas (demi-flottants RGBA : distance au bord, miel, opercule, âge), size, boxes [x0, y0, S, _] par langue, plates }
 */
export function buildLobes(spec) {
  const N = spec.lobes.length, T = ATLAS;
  const atlas = new Uint16Array(N * T * T * 4);
  const boxes = new Float32Array(N * 4);
  const plates = [];
  const rng = createRng(spec.seed + ':lobes');
  spec.lobes.forEach((lobe, k) => {
    const P = border(lobe);
    let wmax = 0; for (let i = 0; i < P.length; i += 2) wmax = Math.max(wmax, Math.abs(P[i]));
    const S = Math.max(2 * wmax, lobe.L) * 1.08;
    const x0 = -S / 2, y0 = -S + S * 0.02; // (la langue pend de y = 0)
    boxes.set([x0, y0, S, 0], 4 * k);
    const ph = rng.range(0, 6.28), C = spec.content;
    for (let j = 0; j < T; j++) {
      const y = y0 + (j + 0.5) / T * S;
      for (let i = 0; i < T; i++) {
        const x = x0 + (i + 0.5) / T * S;
        let d = distOpen(P, x, y);
        const inside = y <= 0 && y >= -lobe.L && Math.abs(x) <= halfWidth(lobe, -y, Math.sign(x) || 1);
        if (y > 0) d = Math.hypot(d, 0); // (au-dessus de la voûte : dehors)
        const E = inside ? d : -d;
        // contenu : un arc de miel operculé sous l'attache, du miel ouvert dessous, vide vers la lisière
        const t = -y / lobe.L, r = x / (lobe.W || 1);
        const arc = t + 0.35 * r * r + 0.05 * Math.sin(x * 9 + ph) + 0.04 * Math.sin(y * 13 + ph * 2);
        const ss = (a, b, v) => { const u = Math.min(1, Math.max(0, (v - a) / (b - a))); return u * u * (3 - 2 * u); };
        const cap = (1 - ss(C.cap - 0.05, C.cap + 0.05, arc)) * (C.cap > 0 ? 1 : 0);
        const honey = (1 - ss(C.honey - 0.12, C.honey + 0.1, arc)) * (C.honey > 0 ? 1 : 0);
        const o = ((j * N * T) + k * T + i) * 4;
        atlas[o] = toHalf(E); atlas[o + 1] = toHalf(honey); atlas[o + 2] = toHalf(cap); // âge de la cire : un cœur ancien (le couvain, bruni par les passages) au milieu de la
        // langue, de la cire dorée autour, de la cire fraîche à la lisière
        const heart = Math.max(0, 1 - ((t - 0.6) / 0.42) ** 2 - (r / 0.86) ** 2);
        const age = Math.pow(heart, 0.8) * ss(0, 0.32 * lobe.W, E) * (1 + 0.14 * Math.sin(x * 7 + ph * 1.7) * Math.sin(y * 5.3 + ph)) + 0.05 * Math.sin(x * 23 + y * 17 + ph);
        atlas[o + 3] = toHalf(Math.min(1, Math.max(0, age)));
      }
    }
    plates.push(plate(lobe));
  });
  return { atlas, width: N * T, height: T, boxes, plates };
}

/** La nervure centrale : une lame mince aux bords arrondis, plus épaisse à l'attache. */
function plate(lobe, ny = 70, nx = 28) {
  const pos = [], nor = [], idx = [];
  const th = lobe.th ?? 0.012;
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= ny; j++) {
      const y = lobe.L * (1 - Math.pow(1 - j / ny, 2));
      const wl = halfWidth(lobe, y, -1), wr = halfWidth(lobe, y, 1);
      for (let i = 0; i <= nx; i++) {
        const u = i / nx, a = Math.cos(Math.PI * u); // (−1 … 1, serré aux bords)
        const x = a < 0 ? a * wl : a * wr;
        const e = Math.sqrt(Math.max(0, 1 - a * a)) * Math.min(1, Math.sqrt(Math.max(0, (lobe.L - y) / (0.04 * lobe.L))));
        // (la face avant reste juste derrière le fond des alvéoles : bombée, elle le recouvrait,
        // et les alvéoles vides montraient la nervure au lieu de leur fond)
        pos.push(-x * side, -y, side > 0 ? -0.004 : -0.004 - 2 * th * e);
        nor.push(0, 0, side);
      }
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = base + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // normales lissées
  const P = new Float32Array(pos), Nn = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx_ = uy * vz - uz * vy, ny_ = uz * vx - ux * vz, nz_ = ux * vy - uy * vx;
    for (const q of [a, b, c]) { Nn[q] += nx_; Nn[q + 1] += ny_; Nn[q + 2] += nz_; }
  }
  for (let i = 0; i < Nn.length; i += 3) { const l = Math.hypot(Nn[i], Nn[i + 1], Nn[i + 2]) || 1; Nn[i] /= l; Nn[i + 1] /= l; Nn[i + 2] /= l; }
  return { position: P, normal: Nn, index: new Uint32Array(idx) };
}
