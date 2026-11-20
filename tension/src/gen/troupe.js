// La troupe : plusieurs sculptures avancent ensemble, chacune dans son couloir.
// Fonctions pures (rendu, tests, Node).
//
// Chaque membre a son film (gen/film.js : un pas, du repos au repos). Pour que
// la boucle se referme, tous doivent avoir parcouru la même distance D au bout
// de la même durée T :
// - la distance : un membre fait n pas (le nombre entier le plus proche de ce
//   que sa taille demande), et sa taille est ajustée pour que n pas fassent
//   exactement D (échelle s = D / (n · pas)) ; D est choisi, parmi les multiples
//   des pas de chacun, pour que ces tailles s'écartent le moins des tailles voulues ;
// - la durée : une structure s fois plus grande, sous la même gravité, bouge
//   √s fois plus lentement (similitude de Froude) ; un pas dure donc durée · √s.
//   T est le temps du membre le plus lent ; les autres attendent, au repos,
//   entre deux pas, comme une troupe attend ses traînards.
// Les départs sont décalés (phase), et rien n'est ralenti : dans une troupe,
// un ralenti de caméra devrait ralentir tout le monde à la fois.
//
// Le résultat a la forme d'un film : pose(u), rests(u), rig(u), ext, dur, dist,
// et une topologie réunie T (nœuds, barres et câbles de tous les membres,
// chacun marqué de son membre : `mem`).

// members : [{ film, size (échelle voulue), phase (0..1), ahead (décalage le long de la marche, en u) }],
// rangés du couloir le plus loin de la caméra (z le plus petit) au plus proche.
// side : de quel côté de l'avant se tient la caméra (signe de son azimut) ; la formation est en échelon, pour
// que, vues de trois quarts, les sculptures se présentent côte à côte au lieu de se cacher l'une derrière l'autre.
export function makeTroupe(members, { rest = 0.06, clearance = 1.1, side = 1, echelon = 0.9 } = {}) {
  // D : parmi les multiples des pas de chacun, celui qui déforme le moins les tailles voulues
  const fitOf = (D) => Math.max(...members.map((m) => { const n = Math.max(1, Math.round(D / (m.size * m.film.dist))); return Math.abs(Math.log(D / (n * m.film.dist) / m.size)); }));
  // (le plus petit D qui tient les tailles à 18 % près ; à défaut, celui qui les tient le mieux)
  const cand = [];
  for (const m of members) for (let k = 1; k <= 3; k++) { const d = m.size * m.film.dist * k; cand.push([d, fitOf(d)]); }
  cand.sort((a, b) => a[0] - b[0]);
  const D = (cand.find((c) => c[1] <= Math.log(1.18)) ?? cand.reduce((a, b) => (b[1] < a[1] - 1e-9 ? b : a)))[0];
  const M = members.map((m, i) => {
    const f = m.film, n = Math.max(1, Math.round(D / (m.size * f.dist))), s = D / (n * f.dist);
    // Un pas de Culbute ou d'Icosaèdre finit ré-étiqueté par une symétrie : le nœud perm[i] arrive où le
    // nœud i est parti. Pour qu'un nœud garde sa trajectoire d'un pas au suivant, il rejoue au pas k la
    // piste du nœud perm⁻ᵏ ; les câbles suivent leurs extrémités.
    const inv = new Array(f.N); (f.perm ?? [...inv.keys()]).forEach((j, q) => (inv[j] = q));
    const cab = new Map(f.T.cables.map((c, q) => [Math.min(c.i, c.j) * f.N + Math.max(c.i, c.j), q]));
    const nodeMap = [[...inv.keys()]], cableMap = [f.T.cables.map((_, q) => q)];
    for (let k = 1; k < 2 * n; k++) {
      const nm = nodeMap[k - 1].map((q) => inv[q]);
      nodeMap.push(nm);
      cableMap.push(f.T.cables.map((c) => cab.get(Math.min(nm[c.i], nm[c.j]) * f.N + Math.max(nm[c.i], nm[c.j]))));
    }
    return { ...m, i, n, s, step: f.dur * Math.sqrt(s), tmp: new Float32Array(f.N * 3), nodeMap, cableMap };
  });
  const T = Math.max(...M.map((m) => m.n * m.step)) * (1 + rest);
  // encombrement de chaque membre sur tout son pas (dans son propre repère, à l'échelle)
  for (const m of M) {
    const f = m.film, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], c = [0, 0];
    for (let k = 0; k < 48; k++) {
      f.pose(k / 48, m.tmp);
      for (let i = 0; i < f.N; i++) for (let a = 0; a < 3; a++) { const v = m.tmp[i * 3 + a] - (a === 0 ? f.dist * (k / 48) : 0); lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v); }
    }
    f.pose(0, m.tmp);
    for (let i = 0; i < f.N; i++) { c[0] += m.tmp[i * 3] / f.N; c[1] += m.tmp[i * 3 + 2] / f.N; }
    const rad = Math.max(...m.film.T.nodes.map((nd) => nd.r));
    m.zlo = (lo[2] - rad) * m.s; m.zhi = (hi[2] + rad) * m.s; m.h = (hi[1] + rad) * m.s; m.len = (hi[0] - lo[0] + 2 * rad) * m.s; m.c0 = c;
  }
  // couloirs : côte à côte, sans recouvrement quoi que fasse chacun
  let z = 0;
  M.forEach((m, k) => { if (k) z += clearance * Math.max(m.s, M[k - 1].s); m.z0 = z - m.zlo; z += m.zhi - m.zlo; });
  for (const m of M) m.z0 -= z / 2;

  // ── topologie réunie ──
  const TT = { nodes: [], bars: [], cables: [], members: [], family: null, troupe: true };
  for (const m of M) {
    const t = m.film.T, n0 = TT.nodes.length, b0 = TT.bars.length, c0 = TT.cables.length;
    t.nodes.forEach((nd) => TT.nodes.push({ ...nd, r: nd.r * m.s, mem: m.i }));
    t.bars.forEach((b) => TT.bars.push({ ...b, i: b.i + n0, j: b.j + n0, mem: m.i }));
    t.cables.forEach((c) => TT.cables.push({ ...c, i: c.i + n0, j: c.j + n0, L0: c.L0 * m.s, mem: m.i }));
    m.n0 = n0; m.c0i = c0;
    TT.members.push({ family: t.family, scale: m.s, T: t, n0, b0, c0, hub: t.hub ? t.hub.map((h) => h + n0) : null, steps: m.n });
  }
  // (la caméra se règle sur la famille du plus grand)
  TT.family = M.reduce((a, b) => (b.h > a.h ? b : a)).film.T.family;
  const N = TT.nodes.length, NC = TT.cables.length;

  // où en est le membre m à la phase u : pas en cours, phase dans ce pas (1 : au repos, pas fini), tours de boucle
  const at = (m, u) => {
    const v = u - Math.floor(u) + m.phase, w = Math.floor(v), tl = (v - w) * T, slot = T / m.n;
    const k = Math.min(m.n - 1, Math.floor(tl / slot)), ph = (tl - k * slot) / m.step;
    const kt = k + w * m.n;
    return ph >= 1 ? { ph: 0, k: kt + 1, adv: (kt + 1) * m.film.dist } : { ph, k: kt, adv: kt * m.film.dist };
  };
  // (au départ de la boucle, le centre de chaque membre est à sa place dans la formation)
  M.forEach((m, k) => {
    const a = at(m, 0); m.film.pose(a.ph, m.tmp);
    let cx = 0; for (let i = 0; i < m.film.N; i++) cx += m.tmp[i * 3] / m.film.N;
    // (d'un couloir au suivant : un recul proportionnel à l'écart des couloirs et à la longueur des deux voisines)
    const p = M[k - 1], zc = m.z0 + (m.zlo + m.zhi) / 2;
    m.zc = zc;
    m.xc = k ? p.xc - side * (echelon * (zc - p.zc) + 0.3 * (m.len + p.len) / 2) + (m.ahead ?? 0) * 0.2 : 0;
    m.x0 = m.xc - (cx + a.adv) * m.s;
  });
  const mid = M.reduce((a, m) => a + m.xc, 0) / M.length;
  for (const m of M) m.x0 -= mid;

  function pose(u, out = new Float32Array(N * 3)) {
    for (const m of M) {
      const a = at(m, u), f = m.film;
      f.pose(a.ph, m.tmp);
      const nm = m.nodeMap[a.k % (2 * m.n)];
      for (let i = 0; i < f.N; i++) {
        const o = (m.n0 + i) * 3, q = nm[i] * 3;
        out[o] = m.x0 + (m.tmp[q] + a.adv) * m.s; out[o + 1] = m.tmp[q + 1] * m.s; out[o + 2] = m.z0 + m.tmp[q + 2] * m.s;
      }
    }
    return out;
  }
  function rests(u, out = new Float32Array(NC)) {
    for (const m of M) {
      const a = at(m, u), r = m.film.rests(a.ph, (m.rtmp ??= new Float32Array(m.film.NC)));
      const cm = m.cableMap[a.k % (2 * m.n)];
      for (let c = 0; c < m.film.NC; c++) out[m.c0i + c] = r[cm[c]] * m.s;
    }
    return out;
  }
  const rig = (u) => ({ x: D * u, z: 0, psi: 0 });
  // le point que la caméra suit : le milieu de l'emprise de la formation, à mi-hauteur de la plus haute
  const hmax = Math.max(...M.map((m) => m.h));
  function focus(P) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < N; i++) { const x = P[i * 3], z = P[i * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    return [(x0 + x1) / 2, hmax * 0.5, (z0 + z1) / 2];
  }
  const ext = (() => {
    const Q = pose(0), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], Q[i * 3 + a]); hi[a] = Math.max(hi[a], Q[i * 3 + a]); }
    return [hi[0] - lo[0], hi[1], hi[2] - lo[2]];
  })();
  return {
    N, NC, dur: T, pose, rests, rig, focus, ext, T: TT, dist: D, period: D, arc: false, C: null, theta: 0, Rarc: Infinity, ks: [], tau: (t) => t,
    seamErr: Math.max(...M.map((m) => m.film.seamErr)), shapeErr: Math.max(...M.map((m) => m.film.shapeErr)),
    members: M.map((m) => ({ family: m.film.T.family, steps: m.n, scale: m.s, step: m.step, z0: m.z0, x0: m.x0, zlo: m.z0 + m.zlo - 0, zhi: m.z0 + m.zhi, phase: m.phase, wait: 1 - (m.n * m.step) / T })),
  };
}
