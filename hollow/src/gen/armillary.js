// Sphère armillaire : une coquille faite d'anneaux. Un anneau polaire (la
// lunette de l'oculus) et un anneau austral tiennent des méridiens ; à
// l'intérieur, l'équateur, les tropiques et des écliptiques inclinées tournent
// chacun à sa vitesse (un nombre entier de tours par boucle) autour de l'axe
// de l'oculus — jamais à travers lui : la caméra passe toujours librement.
// Graduations en clous sur l'équateur, perles-planètes sur les écliptiques.
//
// Chaque anneau est un ruban balayé le long d'un cercle de la sphère, de
// section rectangulaire arrondie : face externe, face interne, flancs (la
// tranche). La proximité du bord (surf.w) suit le travers du ruban : la
// gravure dessine un filet au milieu de chaque anneau.

import { norm, tangentFrame } from './cells.js';
import { Buffers, OUT, IN, EDGE, RIG, revolve } from './mesh.js';
import { appendIris } from './iris.js';
import { createRng } from '../rng.js';

const { cos, sin, PI, max, min, ceil, abs } = Math;
const Z = [0, 0, 1];

// pas angulaire le long des anneaux, segments des coins, par niveau de détail
const LOD = [{ step: 0.018, corner: 3 }, { step: 0.03, corner: 2 }, { step: 0.05, corner: 1 }, { step: 0.09, corner: 0 }];

// section : rectangle arrondi de largeur w (travers, longueur d'arc) et
// d'épaisseur t (vers le centre), parcouru face externe → flanc → face interne
// → flanc. Chaque point : [travers, profondeur, normale (travers, radiale), finition, prox]
function section(w, t, corner) {
  const rc = min(w, t) * 0.32, P = [];
  const arc = (cu, cv, a0, a1, surf) => {
    const n = max(1, corner);
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n), nu = cos(a), nv = sin(a);
      P.push([cu + nu * rc, cv + nv * rc, nu, nv, surf]);
    }
  };
  const hw = w / 2;
  // (corner = 0 : arêtes vives, un point par coin)
  if (!corner) {
    P.push([-hw, 0, 0, 1, OUT], [hw, 0, 0, 1, OUT], [hw, 0, 1, 0, EDGE], [hw, -t, 1, 0, EDGE], [hw, -t, 0, -1, IN], [-hw, -t, 0, -1, IN], [-hw, -t, -1, 0, EDGE], [-hw, 0, -1, 0, EDGE]);
    return P;
  }
  arc(hw - rc, -rc, PI / 2, PI / 4, OUT); arc(hw - rc, -rc, PI / 4, 0, EDGE);
  arc(hw - rc, -t + rc, 0, -PI / 4, EDGE); arc(hw - rc, -t + rc, -PI / 4, -PI / 2, IN);
  arc(-hw + rc, -t + rc, -PI / 2, -3 * PI / 4, IN); arc(-hw + rc, -t + rc, -3 * PI / 4, -PI, EDGE);
  arc(-hw + rc, -rc, PI, 3 * PI / 4, EDGE); arc(-hw + rc, -rc, 3 * PI / 4, PI / 2, OUT);
  return P;
}

// Ruban balayé : path(s) → [d (direction radiale), S (travers, tangent à la sphère)]
// pour s ∈ [0, 1] ; closed : boucle ; r : rayon de la face externe.
function sweep(B, path, len, closed, r, w, t, lod) {
  const L = LOD[lod], sec = section(w, t, L.corner), ns = sec.length;
  const n = max(closed ? 24 : 4, ceil(len / L.step)), rows = closed ? n : n + 1;
  const start = B.n;
  for (let j = 0; j < rows; j++) {
    const [d, S] = path(j / n);
    for (const [u, v, nu, nv, surf] of sec) {
      const p = norm([d[0] + S[0] * (u / r), d[1] + S[1] * (u / r), d[2] + S[2] * (u / r)]);
      const rr = r + v;
      const prox = 1 - min(1, abs(u) / (w / 2));
      B.vert([p[0] * rr, p[1] * rr, p[2] * rr], norm([S[0] * nu + p[0] * nv, S[1] * nu + p[1] * nv, S[2] * nu + p[2] * nv]), surf[0], surf[1], surf[2], Math.round(prox * 255));
    }
  }
  for (let j = 0; j < (closed ? n : n); j++) {
    const a = start + j * ns, b = start + ((j + 1) % rows) * ns;
    for (let k = 0; k < ns; k++) {
      const k1 = (k + 1) % ns;
      B.triN(a + k, b + k, b + k1); B.triN(a + k, b + k1, a + k1);
    }
  }
  // (rubans ouverts : bouchons aux deux bouts)
  if (!closed) for (const j of [0, n]) {
    const o = start + j * ns, c = B.n;
    const [d] = path(j / n), T = norm(sub3(path(min(1, j / n + 0.01))[0], path(max(0, j / n - 0.01))[0]));
    const s = j === 0 ? -1 : 1;
    for (let k = 0; k < ns; k++) B.vert(posOf(B, o + k), [T[0] * s, T[1] * s, T[2] * s], EDGE[0], EDGE[1], EDGE[2], 255);
    const ctr = B.vert(scale3(d, r - t / 2), [T[0] * s, T[1] * s, T[2] * s], EDGE[0], EDGE[1], EDGE[2], 255);
    B.fan(c, ctr, ns);
  }
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const posOf = (B, i) => [B.pos[i * 3], B.pos[i * 3 + 1], B.pos[i * 3 + 2]];

// petit cercle d'axe a, d'angle polaire beta
const circle = (a, beta) => {
  const [e1, e2] = tangentFrame(a);
  return (s) => {
    const f = s * PI * 2, cf = cos(f), sf = sin(f);
    const q = [e1[0] * cf + e2[0] * sf, e1[1] * cf + e2[1] * sf, e1[2] * cf + e2[2] * sf];
    const d = [a[0] * cos(beta) + q[0] * sin(beta), a[1] * cos(beta) + q[1] * sin(beta), a[2] * cos(beta) + q[2] * sin(beta)];
    const S = [-a[0] * sin(beta) + q[0] * cos(beta), -a[1] * sin(beta) + q[1] * cos(beta), -a[2] * sin(beta) + q[2] * cos(beta)];
    return [d, S];
  };
};
// méridien d'azimut phi, de l'angle polaire t0 à t1
const meridian = (phi, t0, t1) => (s) => {
  const t = t0 + (t1 - t0) * s, h = [cos(phi), sin(phi), 0];
  return [[h[0] * sin(t), h[1] * sin(t), cos(t)], [-sin(phi), cos(phi), 0]];
};

export function buildArmillary(spec, lod) {
  const rng = createRng(`${spec.seed}:armillary`);
  const B = new Buffers(1 << 15);
  const t = spec.thickness, w = spec.width;
  const beta0 = spec.portal; // lunette : bord intérieur à l'angle de l'oculus
  const south = PI - spec.south;
  // ── Bâti fixe (r = 1) : lunette, anneau austral, méridiens ──
  B.rig(null);
  const wb = w * 1.6;
  sweep(B, circle(Z, beta0 + wb / 2), 2 * PI * sin(beta0), true, 1, wb, t * 1.2, lod);
  sweep(B, circle(Z, south), 2 * PI * sin(south), true, 1, w, t, lod);
  const nm = spec.meridians, phase = rng.range(0, PI);
  for (let k = 0; k < nm; k++) {
    const phi = phase + (k / nm) * PI * 2;
    sweep(B, meridian(phi, beta0 + wb * 0.9, south), south - beta0, false, 1, w * 0.8, t * 0.9, lod);
  }
  // clous de la lunette
  if (lod < 3) for (let k = 0; k < 24; k++) {
    const [d] = circle(Z, beta0 + wb / 2)(k / 24);
    revolve(B, scale3(d, 1), d, [[w * 0.18, -0.002], [w * 0.17, w * 0.06], [w * 0.1, w * 0.1], [1e-5, w * 0.11]], [10, 8, 6][lod]);
  }
  // ── Anneaux mobiles (rayons décroissants : jamais deux anneaux qui se croisent) ──
  let r = 1 - t * 1.6;
  const ring = (path, len, width, turns, extra) => {
    B.rig([0, 0, 0], Z, turns, turns ? RIG.spin : RIG.none, rng.next());
    sweep(B, path, len, true, r, width, t, lod);
    extra?.(r);
    B.rig(null);
    r -= t * 1.35;
  };
  // équateur gradué
  ring(circle(Z, PI / 2), 2 * PI, w * 1.2, spec.spins[0], (rr) => {
    if (lod >= 3) return;
    for (let k = 0; k < 72; k++) {
      const [d] = circle(Z, PI / 2)(k / 72), big = k % 6 === 0;
      const h = big ? w * 0.16 : w * 0.08, rad = big ? w * 0.16 : w * 0.09;
      revolve(B, scale3(d, rr), d, [[rad, -0.002], [rad, h * 0.7], [rad * 0.6, h], [1e-5, h * 1.05]], [8, 6, 5][lod]);
    }
  });
  if (spec.tropics) {
    ring(circle(Z, PI / 2 - 0.41), 2 * PI * cos(0.41), w * 0.8, spec.spins[1]);
    ring(circle(Z, PI / 2 + 0.41), 2 * PI * cos(0.41), w * 0.8, -spec.spins[1]);
  }
  // écliptiques : grands cercles inclinés (assez peu pour rester loin de l'oculus)
  const maxTilt = PI / 2 - beta0 - wb - 0.12;
  for (let k = 0; k < spec.ecliptics; k++) {
    const tilt = min(maxTilt, spec.tilt * (1 - k * 0.3)), az = rng.range(0, PI * 2);
    const a = norm([sin(tilt) * cos(az), sin(tilt) * sin(az), cos(tilt)]);
    ring(circle(a, PI / 2), 2 * PI, w, spec.spins[2 + k] ?? 1, (rr) => {
      if (!spec.beads || lod >= 3) return;
      // une perle-planète posée sur l'anneau
      const [d] = circle(a, PI / 2)(rng.next()), br = w * 0.9;
      const prof = [];
      for (let i = 0; i <= [10, 7, 5][lod]; i++) { const q = -PI / 2 + (PI * i) / [10, 7, 5][lod]; prof.push([br * cos(q) + 1e-5, br * sin(q) + br]); }
      revolve(B, scale3(d, rr - 0.004), d, prof, [16, 12, 8][lod], OUT);
    });
  }
  B.rig(null);
  // diaphragme sous la lunette (sous la face interne du bâti)
  if (spec.iris?.blades) appendIris(B, { ...spec, thickness: t * 1.2 + 0.004 }, Math.tan(beta0), lod);
  const out = B.result();
  if (lod === 3) delete out.bev;
  return out;
}

