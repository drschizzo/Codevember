// Motif de déchirure : où la membrane pourra se rompre.
//
// Chaque triangle reçoit une étiquette (le lambeau auquel il appartiendra) ;
// les arêtes entre deux étiquettes différentes sont des « coutures »
// préparées dans le maillage (sommets dédoublés, voir split.js), tenues par
// des liens qui céderont pendant la simulation — ou non : c'est la tension
// qui décide de l'ordre, de la vitesse et de l'étendue de la déchirure.
//
// Les étiquettes sont calculées sur la direction du centre de chaque
// triangle, déformée par un bruit fractal : les lignes de rupture suivent la
// géométrie de l'armature (entre deux lames, d'une épine à l'autre, du centre
// d'une face vers ses sommets) mais en zigzag irrégulier, à toutes les échelles,
// comme une vraie déchirure. Un second réseau, plus fin et plus résistant,
// greffe des embranchements le long des coupures principales.

import { createNoise3, createRng } from '../rng.js';
import { V3 } from './geo.js';

const { PI, atan2, acos, floor, min, max, sqrt } = Math;
const wrap = (a) => { a %= 2 * PI; return a < 0 ? a + 2 * PI : a; };

// angle d'un vecteur autour d'un axe (repère arbitraire mais fixe)
function frameAround(axis) {
  const a = V3.norm(V3.cross(axis, Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  return [a, V3.cross(axis, a)];
}

// pattern : { kind, n, phi0, twist, end (rad), sites, faces, sectors, warp, warpScale, branch, seed }
export function labelTriangles(pos, tri, nt, nbr, P) {
  const N3 = createNoise3(`tear:${P.seed}`), rng = createRng(`tear:${P.seed}`);
  const warpAt = (c, amp, sc) => {
    if (amp <= 0) return c;
    const o = 7.3;
    return V3.norm([
      c[0] + amp * N3.fbm(c[0] * sc, c[1] * sc, c[2] * sc, 4),
      c[1] + amp * N3.fbm(c[0] * sc + o, c[1] * sc, c[2] * sc, 4),
      c[2] + amp * N3.fbm(c[0] * sc, c[1] * sc + o, c[2] * sc, 4),
    ]);
  };
  const major = new Int32Array(nt), minor = new Int32Array(nt), sec = new Int32Array(nt), inside = new Uint8Array(nt);
  const cent = new Float64Array(nt * 3);
  // sites des branches secondaires (dans la zone déchirable)
  const nSec = Math.round(P.branch * 60);
  const secSites = [];
  while (secSites.length < nSec) { const d = rng.dir(); if (acos(d[2]) < P.end) secSites.push(d); }
  const faceFrames = (P.faces || []).map((f) => {
    const c = V3.norm(f.reduce((a, b) => V3.add(a, b), [0, 0, 0]));
    const [ea, eb] = frameAround(c);
    // angles des sommets autour du centre : secteurs entre deux sommets voisins,
    // les coupures vont donc du centre vers les sommets
    const angs = f.map((v) => wrap(atan2(V3.dot(v, eb), V3.dot(v, ea)))).sort((x, y) => x - y);
    return { c, ea, eb, angs };
  });
  const siteFrames = (P.sites || []).map((s) => { const [ea, eb] = frameAround(s); return { c: s, ea, eb }; });

  for (let t = 0; t < nt; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], d = tri[t * 3 + 2];
    const c = V3.norm([pos[a * 3] + pos[b * 3] + pos[d * 3], pos[a * 3 + 1] + pos[b * 3 + 1] + pos[d * 3 + 1], pos[a * 3 + 2] + pos[b * 3 + 2] + pos[d * 3 + 2]]);
    cent.set(c, t * 3);
    const w = warpAt(c, P.warp, P.warpScale);
    const th = acos(Math.max(-1, Math.min(1, w[2]))), ph = atan2(w[1], w[0]);
    // limite de la zone déchirable, irrégulière
    const lim = P.end + 0.12 * N3.fbm(c[0] * 3 + 11, c[1] * 3, c[2] * 3, 3);
    inside[t] = th < lim ? 1 : 0;
    switch (P.kind) {
      case 'star': {
        // secteurs entre les lames (et vrille éventuelle : spirale)
        const s = wrap(ph - P.phi0 - PI / P.n - P.twist * th);
        major[t] = floor(s / ((2 * PI) / P.n)) % P.n;
        minor[t] = 0;
        break;
      }
      case 'sites': {
        // épines : cellule de Voronoï de chaque épine, découpée en étoile autour
        // de la pointe (perforation) ; calotte du pôle en quartiers
        let best = -1, bd = -2;
        siteFrames.forEach((S, i) => { const dd = V3.dot(w, S.c); if (dd > bd) { bd = dd; best = i; } });
        if (th < P.pole) { major[t] = 10000; minor[t] = floor(wrap(ph - P.phi0) / ((2 * PI) / 4)); break; }
        const S = siteFrames[best];
        major[t] = best;
        // perforation : une étoile autour de la pointe seulement ; au-delà, la
        // cellule reste d'un seul tenant (de grands lambeaux, pas des confettis)
        minor[t] = bd > Math.cos(P.punch ?? 0.16) ? 1 + floor(wrap(atan2(V3.dot(w, S.eb), V3.dot(w, S.ea)) + P.phi0) / ((2 * PI) / P.sectors)) : 0;
        break;
      }
      case 'faces': {
        // cage : chaque face se fend du centre vers ses sommets
        let best = 0, bd = -2;
        faceFrames.forEach((F, i) => { const dd = V3.dot(w, F.c); if (dd > bd) { bd = dd; best = i; } });
        const F = faceFrames[best], ang = wrap(atan2(V3.dot(w, F.eb), V3.dot(w, F.ea)));
        let k = 0;
        while (k < F.angs.length && ang > F.angs[k]) k++;
        major[t] = best;
        minor[t] = k % F.angs.length;
        inside[t] = 1;
        break;
      }
      default: major[t] = 0;
    }
    // réseau secondaire (embranchements)
    if (secSites.length) {
      const w2 = warpAt(c, P.warp * 0.6, P.warpScale * 2.3);
      let best = 0, bd = -2;
      secSites.forEach((s, i) => { const dd = V3.dot(w2, s); if (dd > bd) { bd = dd; best = i; } });
      sec[t] = best;
    }
  }
  // îlots : un triangle entouré d'autres étiquettes les rejoint (deux passes)
  for (let pass = 0; pass < 2; pass++) {
    for (let t = 0; t < nt; t++) {
      const n0 = nbr[t * 3], n1 = nbr[t * 3 + 1], n2 = nbr[t * 3 + 2];
      const key = (u) => major[u] * 1000 + minor[u];
      const k = key(t), k0 = key(n0), k1 = key(n1), k2 = key(n2);
      if (k !== k0 && k0 === k1) { major[t] = major[n0]; minor[t] = minor[n0]; }
      else if (k !== k1 && k1 === k2) { major[t] = major[n1]; minor[t] = minor[n1]; }
      else if (k !== k0 && k0 === k2) { major[t] = major[n0]; minor[t] = minor[n0]; }
    }
  }
  return { major, minor, sec, inside, cent };
}

// Coutures : arêtes du maillage (u, v) entre deux triangles d'étiquettes
// différentes, dans la zone déchirable. mult : résistance relative (les
// embranchements sont plus solides : seuls certains cèdent).
export function findSeams(tri, nt, nbr, L, P) {
  const seams = [];
  const primary = new Uint8Array(nt);
  const isSeam = (t, u, prim) => {
    if (!L.inside[t] || !L.inside[u]) return false;
    if (prim) {
      if (P.kind === 'faces') return L.major[t] === L.major[u] && L.minor[t] !== L.minor[u];
      return L.major[t] !== L.major[u] || L.minor[t] !== L.minor[u];
    }
    return L.sec[t] !== L.sec[u];
  };
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const u = nbr[t * 3 + e];
    if (u < t) continue;
    if (isSeam(t, u, true)) { seams.push({ a: tri[t * 3 + e], b: tri[t * 3 + ((e + 1) % 3)], tA: t, tB: u, mult: 1 }); primary[t] = primary[u] = 1; }
  }
  // embranchements : coutures secondaires près des coupures principales
  if (P.branch > 0) {
    const near = new Uint8Array(nt);
    let front = [];
    for (let t = 0; t < nt; t++) if (primary[t]) { near[t] = 1; front.push(t); }
    for (let r = 0; r < P.branchReach; r++) {
      const nx = [];
      for (const t of front) for (let e = 0; e < 3; e++) { const u = nbr[t * 3 + e]; if (u >= 0 && !near[u]) { near[u] = 1; nx.push(u); } }
      front = nx;
    }
    const done = new Set(seams.map((s) => (s.tA < s.tB ? s.tA * 1e6 + s.tB : s.tB * 1e6 + s.tA)));
    for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
      const u = nbr[t * 3 + e];
      if (u < t || !near[t] || !near[u]) continue;
      if (done.has(t * 1e6 + u)) continue;
      if (isSeam(t, u, false)) seams.push({ a: tri[t * 3 + e], b: tri[t * 3 + ((e + 1) % 3)], tA: t, tB: u, mult: P.branchStrength });
    }
  }
  return seams;
}

export { sqrt, min, max };
