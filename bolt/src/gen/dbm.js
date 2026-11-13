// L'éclair : modèle de claquage diélectrique (Niemeyer, Pietronero et
// Wiesmann, 1984) dans sa forme rapide (Kim, Sweeney, Shelley et Lin, 2007).
//
// La décharge est un agrégat de sites d'un réseau cubique. À chaque pas, un
// site candidat (voisin de l'agrégat) est choisi avec la probabilité
//
//     p_i ∝ Φ_i^η,   Φ_i = (1 − β)·n(φ_i) + β·n(g_i)
//
// où φ_i = Σ_j (1 − R / r_ij) est le potentiel que l'agrégat lui-même impose
// au candidat (somme sur les sites j de l'agrégat, R = ½ maille : nul au
// contact, il repousse la croissance loin de ce qui existe déjà — c'est ce
// qui fait les branches), g_i le potentiel de l'attracteur (le sol : la
// pointe visée, ou le champ uniforme sous le nuage), n(·) la mise à l'échelle
// sur [0, 1] parmi les candidats. η règle l'allure : 2, touffu ; 5, filiforme.
// La somme φ se met à jour en O(candidats) à chaque site ajouté : pas de
// résolution de Laplace sur une grille.
//
// Module pur (ni three.js ni DOM) : worker, tests et écran de chargement.
import { createRng } from '../../../shared/rng.js';

const R1 = 0.5;
const NB = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) NB.push([x, y, z]);
const key = (x, y, z) => (x + 512) + (y + 512) * 1024 + (z + 512) * 1048576;
// hachage d'un site → [0, 1)³ (décalage des sites : pas d'escaliers de réseau)
function hash3(x, y, z, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(s, 1274126177);
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    out[i] = (h >>> 0) / 4294967296;
  }
  return out;
}

// Obstacles (le récipient) : la décharge ne les traverse pas.
//   { type: 'shell', rIn, rOut, yTop, yFloor } : paroi de révolution (axe y), liquide ou fond sous yFloor
//   { type: 'ellipsoid', c, r } : corps plein (théière)
//   { type: 'floor', y } : la table
export function blocked(p, obstacles, margin = 0) {
  for (const o of obstacles) {
    if (o.type === 'floor') { if (p[1] < o.y + margin) return true; continue; }
    if (o.type === 'ellipsoid') {
      const dx = (p[0] - o.c[0]) / (o.r[0] + margin), dy = (p[1] - o.c[1]) / (o.r[1] + margin), dz = (p[2] - o.c[2]) / (o.r[2] + margin);
      if (dx * dx + dy * dy + dz * dz < 1) return true;
      continue;
    }
    const r = Math.hypot(p[0], p[2]);
    if (p[1] < o.yTop + margin && r > o.rIn - margin && r < o.rOut + margin) return true;
    if (p[1] < o.yFloor + margin && r <= o.rIn) return true;
  }
  return false;
}

// Croissance d'une décharge.
//   spec : {
//     seed, h (maille, unités de scène), eta, beta,
//     root : [x, y, z]            d'où part le traceur,
//     targets : [[x, y, z], …]    où il doit arriver (une pointe par arc),
//     field : 'point' | 'down' | 'up'   attracteur : la pointe visée, ou un champ uniforme
//                                       (vers le bas, vers le haut) relayé par la pointe à courte distance,
//     slab : { y0, y1, r, count } | null   d'abord une nappe horizontale (éclair araignée),
//     box : { r, y0, y1 }         domaine,
//     obstacles, maxSites
//   }
// Renvoie l'arbre brut : sites (indices de réseau), parents, ordre de
// naissance, et pour chaque cible le site qui l'a touchée.
export function grow(spec) {
  const targets = spec.targets.map((t) => [...t]);
  const { h, eta, beta = 0.5, root, field = 'point', slab = null, box, obstacles = [], maxSites = 1600, active = 26, jitter = 0.5, surface = null, stopAt = 0 } = spec;
  const rng = createRng(`${spec.seed}`).fork('dbm');
  const salt = Math.floor(rng.next() * 1e9);
  const world = (x, y, z) => {
    const j = hash3(x, y, z, salt);
    return [root[0] + (x + (j[0] - 0.5) * jitter) * h, root[1] + (y + (j[1] - 0.5) * jitter * 0.6) * h, root[2] + (z + (j[2] - 0.5) * jitter) * h];
  };
  const T = targets.map((t) => [(t[0] - root[0]) / h, (t[1] - root[1]) / h, (t[2] - root[2]) / h]); // (en mailles)
  const hit = new Array(T.length).fill(-1);

  const sx = [], sy = [], sz = [], par = [], hrun = [];
  const inAgg = new Map();
  // candidats : tableaux parallèles + table de hachage
  const cx = [], cy = [], cz = [], cphi = [], cpar = [];
  const cidx = new Map();
  const ok = (x, y, z) => {
    const p = [root[0] + x * h, root[1] + y * h, root[2] + z * h];
    if (Math.hypot(p[0], p[2]) > box.r || p[1] < box.y0 || p[1] > box.y1) return false;
    return !blocked(p, obstacles, h * 0.6);
  };
  let stage = slab ? 0 : 1;
  const sgn = field === 'up' ? -1 : 1;
  const inSlab = (y) => { const wy = root[1] + y * h; return wy >= slab.y0 && wy <= slab.y1; };

  function addCandidate(x, y, z, from) {
    const k = key(x, y, z);
    if (inAgg.has(k) || cidx.has(k)) return;
    if (!ok(x, y, z)) return;
    let phi = 0;
    for (let j = 0; j < sx.length; j++) {
      const r = Math.hypot(x - sx[j], y - sy[j], z - sz[j]);
      phi += 1 - R1 / r;
    }
    cidx.set(k, cx.length);
    cx.push(x); cy.push(y); cz.push(z); cphi.push(phi); cpar.push(from);
  }
  function removeCandidate(i) {
    const last = cx.length - 1;
    cidx.delete(key(cx[i], cy[i], cz[i]));
    if (i !== last) {
      cx[i] = cx[last]; cy[i] = cy[last]; cz[i] = cz[last]; cphi[i] = cphi[last]; cpar[i] = cpar[last];
      cidx.set(key(cx[i], cy[i], cz[i]), i);
    }
    cx.pop(); cy.pop(); cz.pop(); cphi.pop(); cpar.pop();
  }
  function addSite(x, y, z, from) {
    const id = sx.length;
    sx.push(x); sy.push(y); sz.push(z); par.push(from);
    hrun.push(from >= 0 && sy[from] === y ? hrun[from] + 1 : 0); // (pas horizontaux d'affilée)
    inAgg.set(key(x, y, z), id);
    for (let i = 0; i < cx.length; i++) {
      const r = Math.hypot(cx[i] - x, cy[i] - y, cz[i] - z);
      cphi[i] += 1 - R1 / r;
    }
    // (un traceur ne rebrousse pas chemin : vers le bas ou à l'horizontale s'il
    // descend, vers le haut s'il monte, dans son plan s'il rampe sous le nuage)
    for (const [dx, dy, dz] of NB) {
      if (stage === 0 ? dy !== 0 && !(dy < 0 && sx.length > slab.count * 0.5) : sgn * dy > 0) continue;
      if (stage === 1 && dy === 0 && hrun[id] >= 2) continue; // (il ne rampe pas : deux pas à plat au plus)
      addCandidate(x + dx, y + dy, z + dz, id);
    }
    return id;
  }

  addSite(0, 0, 0, -1);
  const order = [0];
  let firstHit = -1;
  const Phi = [];
  // attracteur d'un candidat (plus grand = plus attirant)
  const attract = (i) => {
    if (stage === 0) return Math.hypot(cx[i], cz[i]); // (nappe : vers le large)
    let d = Infinity;
    if (surface) return -cy[i];
    // entonnoir : en haut, l'écart horizontal à la pointe compte peu (le
    // traceur erre) ; en approchant de sa hauteur, il compte de plus en plus
    for (let k = 0; k < T.length; k++) {
      if (hit[k] >= 0) continue;
      const f = Math.min(1, Math.max(0, cy[i] / (T[k][1] || 1)));
      const wgt = field === 'point' ? 1 : 0.25 + 1.9 * f * f;
      d = Math.min(d, Math.hypot((cx[i] - T[k][0]) * wgt, cy[i] - T[k][1], (cz[i] - T[k][2]) * wgt));
    }
    return -d;
  };

  let guard = 0, frozen = false;
  while (sx.length < maxSites && guard++ < maxSites * 3) {
    if (stage === 0 && sx.length >= slab.count) stage = 1;
    if (hit.every((v) => v >= 0)) break;
    // mise à l'échelle des deux potentiels
    let pMin = Infinity, pMax = -Infinity, gMin = Infinity, gMax = -Infinity;
    const g = new Array(cx.length);
    let any = false;
    for (let i = 0; i < cx.length; i++) {
      if ((stage === 0 && (!inSlab(cy[i]) || Math.hypot(root[0] + cx[i] * h, root[2] + cz[i] * h) > (slab.r ?? 1e9))) || sx.length - cpar[i] > (frozen ? 1e9 : active)) { g[i] = NaN; continue; }
      g[i] = attract(i); any = true;
      if (cphi[i] < pMin) pMin = cphi[i]; if (cphi[i] > pMax) pMax = cphi[i];
      if (g[i] < gMin) gMin = g[i]; if (g[i] > gMax) gMax = g[i];
    }
    if (!any) { if (!frozen) { frozen = true; continue; } if (stage === 0) { stage = 1; frozen = false; continue; } break; }
    frozen = false;
    const b = stage === 0 ? 0.35 : beta, e = stage === 0 ? Math.min(eta, 2.2) : eta;
    let sum = 0;
    Phi.length = cx.length;
    for (let i = 0; i < cx.length; i++) {
      if (Number.isNaN(g[i])) { Phi[i] = 0; continue; }
      const a = (cphi[i] - pMin) / (pMax - pMin || 1), c = (g[i] - gMin) / (gMax - gMin || 1);
      Phi[i] = ((1 - b) * a + b * c) ** e;
      sum += Phi[i];
    }
    let r = rng.next() * sum, pick = cx.length - 1;
    for (let i = 0; i < cx.length; i++) { r -= Phi[i]; if (r <= 0) { pick = i; break; } }
    const x = cx[pick], y = cy[pick], z = cz[pick], from = cpar[pick];
    removeCandidate(pick);
    const id = addSite(x, y, z, from);
    order.push(id);
    if (surface && hit[0] < 0) {
      const wx = root[0] + x * h, wy = root[1] + y * h, wz = root[2] + z * h;
      if (wy <= surface.y + 1.5 * h && Math.hypot(wx, wz) < surface.r) { hit[0] = id; firstHit = sx.length; targets[0] = [wx, surface.y, wz]; }
    }
    if (stopAt && sx.length >= stopAt && hit[0] < 0) { hit[0] = id; firstHit = sx.length; }
    for (let k = 0; k < T.length; k++) {
      if (hit[k] >= 0 || surface || stopAt) continue;
      if (Math.hypot(x - T[k][0], y - T[k][1], z - T[k][2]) <= 1.6) {
        hit[k] = id;
        if (firstHit < 0) firstHit = sx.length; // (nombre de sites à la première jonction)
      }
    }
  }
  const n = sx.length;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const p = world(sx[i], sy[i], sz[i]); pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; }
  pos[0] = root[0]; pos[1] = root[1]; pos[2] = root[2];
  return { n, pos, parent: Int32Array.from(par), hit, targets, firstHit: firstHit < 0 ? n : firstHit, complete: hit.every((v) => v >= 0) };
}

// L'arbre prêt à être lu par le film.
//   nodes : pos, parent, tb (naissance, en avancement du traceur : 0 → 1 à la
//   première jonction ; > 1 : révélé par un traceur de réamorçage), s
//   (distance au sol le long du canal : l'arc en retour l'atteint à s / v),
//   mask (bit j : sur le canal de l'arc j), w (grosseur : 1 sur un canal,
//   moins sur une branche selon ce qu'elle porte)
//   strokes : [{ target, path (du sol à la racine), length }]
export function buildBolt(spec) {
  let G = null;
  // (une croissance qui n'aboutit pas est relancée avec un attracteur plus ferme)
  for (let attempt = 0; attempt < 6; attempt++) {
    G = grow({ ...spec, seed: `${spec.seed}/${attempt}`, beta: Math.min(0.85, (spec.beta ?? 0.5) + 0.1 * attempt), field: attempt >= 2 && spec.field === 'down' ? 'point' : spec.field });
    if (G.complete && G.n <= (spec.maxGood ?? 520)) break;
  }
  // (dernier recours : droit au but)
  if (!G.complete) G = grow({ ...spec, seed: `${spec.seed}/droit`, beta: 0.92, eta: 6, field: spec.field === 'up' ? 'up' : 'point', slab: null, maxSites: 900 });
  if (!G.complete) throw new Error('la décharge n’a pas trouvé sa pointe');
  const { n, parent, firstHit } = G;
  const hit = [...G.hit], targets = G.targets.map((t) => [...t]);
  const upward = spec.family === 'upward';
  // éclair fourchu : les arcs suivants empruntent d'autres branches, celles
  // dont la pointe est la plus basse et assez loin des impacts déjà choisis ;
  // leur traceur de réamorçage les prolongera jusqu'au liquide
  const extra = [];
  if (spec.forks && spec.surface) {
    const kids = new Uint16Array(n);
    for (let i = 1; i < firstHit; i++) kids[parent[i]]++;
    const tips = [];
    for (let i = 1; i < firstHit; i++) if (!kids[i] && i !== hit[0]) tips.push(i);
    tips.sort((a, b) => G.pos[a * 3 + 1] - G.pos[b * 3 + 1]);
    const far = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]) > spec.surface.r * 0.55;
    for (const i of tips) {
      if (extra.length >= spec.forks) break;
      const p = [G.pos[i * 3], G.pos[i * 3 + 1], G.pos[i * 3 + 2]];
      const rr = Math.hypot(p[0], p[2]), k = rr > spec.surface.r * 0.8 ? (spec.surface.r * 0.8) / rr : 1;
      const t = [p[0] * k, spec.surface.y, p[2] * k];
      if (p[1] > spec.surface.y + (spec.root[1] - spec.surface.y) * 0.6) continue;
      if (![targets[0], ...extra.map((e) => e.t)].every((q) => far(t, q))) continue;
      extra.push({ i, t });
    }
    for (const e of extra) { hit.push(e.i); targets.push(e.t); }
  }
  // canaux : de chaque site d'arrivée à la racine
  const onPath = new Uint8Array(n);
  const paths = hit.map((id, j) => {
    const path = [];
    for (let i = id; i >= 0; i = parent[i]) { path.push(i); onPath[i] |= 1 << j; }
    return path;
  });
  // on garde : tout ce qui est né avant la première jonction, et les canaux
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) keep[i] = (i < firstHit || onPath[i]) ? 1 : 0;
  if (upward) keep.fill(1);
  // (un site gardé dont le parent ne l'est pas : impossible, les parents naissent avant)
  const remap = new Int32Array(n).fill(-1);
  const nodes = { pos: [], parent: [], tb: [], s: [], mask: [], w: [] };
  const push = (p, par, tb, mask) => { nodes.pos.push(p[0], p[1], p[2]); nodes.parent.push(par); nodes.tb.push(tb); nodes.mask.push(mask); nodes.s.push(0); nodes.w.push(0); return nodes.parent.length - 1; };
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const p = [G.pos[i * 3], G.pos[i * 3 + 1], G.pos[i * 3 + 2]];
    const tb = upward ? i / (n - 1) : i < firstHit ? i / (firstHit - 1) : 1.5; // (≥ 1,5 : attend son réamorçage)
    remap[i] = push(p, parent[i] < 0 ? -1 : remap[parent[i]], tb, upward ? 1 | (onPath[i] ? 0xfe & onPath[i] : 0) : onPath[i]);
  }
  // aigrettes : de chaque pointe visée, une courte chaîne qui monte à la
  // rencontre du traceur ; son dernier point est le site d'arrivée
  const strokes = [];
  const rng = createRng(`${spec.seed}`).fork('streamer');
  hit.forEach((id, j) => {
    const target = targets[j];
    let tip = remap[id];
    const tp = nodes.pos.slice(tip * 3, tip * 3 + 3);
    const d = Math.hypot(tp[0] - target[0], tp[1] - target[1], tp[2] - target[2]);
    const m = Math.max(1, Math.round(d / (spec.h * 0.8)));
    const chain = [];
    if (upward) {
      // (éclair ascendant : la « cible » est dans le nuage, le canal s'y perd)
      strokes.push({ target, tip, chain });
      return;
    }
    let prev = tip;
    for (let k = 1; k <= m; k++) {
      const t = k / m;
      const jit = k < m ? spec.h * 0.55 : 0;
      const p = [tp[0] + (target[0] - tp[0]) * t + (rng.next() - 0.5) * jit, tp[1] + (target[1] - tp[1]) * t, tp[2] + (target[2] - tp[2]) * t + (rng.next() - 0.5) * jit];
      // l'aigrette pousse du sol vers le haut : le point le plus bas naît le
      // premier (0,86), le plus haut touche le traceur à tb = 1
      const tb = j === 0 ? 0.86 + 0.14 * ((m - k) / m) : 1.5;
      prev = push(p, prev, tb, 1 << j);
      chain.push(prev);
    }
    strokes.push({ target, tip: prev, chain });
  });
  const N = nodes.parent.length;
  const P = nodes.parent;
  const dist = (a, b) => Math.hypot(nodes.pos[a * 3] - nodes.pos[b * 3], nodes.pos[a * 3 + 1] - nodes.pos[b * 3 + 1], nodes.pos[a * 3 + 2] - nodes.pos[b * 3 + 2]);
  // distance au sol le long du canal
  const s = new Float32Array(N).fill(-1);
  if (upward) {
    // (ascendant : la racine est au sol)
    for (let i = 0; i < N; i++) s[i] = P[i] < 0 ? 0 : s[P[i]] + dist(i, P[i]);
    // canal des réamorçages : de la racine au site le plus lointain de chaque cible
    strokes.forEach((S, j) => { S.path = []; for (let i = S.tip; i >= 0; i = P[i]) S.path.push(i); S.path.reverse(); S.length = s[S.tip]; if (j === 0) for (const i of S.path) nodes.mask[i] |= 2; });
  } else {
    strokes.forEach((S) => {
      // du sol (dernier point de l'aigrette) vers la racine
      S.path = [];
      let acc = 0;
      for (let i = S.tip, prev = -1; i >= 0; prev = i, i = P[i]) {
        if (prev >= 0) acc += dist(i, prev);
        if (s[i] < 0) s[i] = acc; else acc = s[i];
        S.path.push(i);
      }
      S.length = acc;
    });
    // branches : distance du point d'attache, puis vers le large
    for (let i = 0; i < N; i++) if (s[i] < 0) s[i] = s[P[i]] + dist(i, P[i]); // (les parents précèdent toujours leurs enfants)
  }
  // grosseur : ce que la branche porte (nombre de descendants)
  const sub = new Float32Array(N).fill(1);
  for (let i = N - 1; i > 0; i--) if (P[i] >= 0) sub[P[i]] += sub[i];
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = (nodes.mask[i] && !upward) ? 1 : Math.min(1, 0.28 + 0.2 * Math.log2(sub[i]));
  if (upward) for (const i of strokes[0].path) w[i] = 1;
  return {
    n: N, pos: Float32Array.from(nodes.pos), parent: Int32Array.from(P), tb: Float32Array.from(nodes.tb), s, mask: Uint8Array.from(nodes.mask), w,
    strokes: strokes.map((S) => ({ target: S.target, path: S.path, length: S.length, chain: S.chain.length })),
    family: spec.family, sites: G.n, kept: N,
  };
}

// Position de la pointe la plus avancée du traceur à l'avancement a, et écart
// à la pointe de l'aigrette (contact : nul à a = 1, positif avant)
export function gapAt(bolt, a) {
  const S = bolt.strokes[0], m = S.chain;
  // le canal 0, du sol vers la racine : d'abord l'aigrette (m nœuds, nés de bas
  // en haut), puis le traceur (né de haut en bas)
  let top = -1;
  for (let k = 0; k < m && bolt.tb[S.path[k]] <= a; k++) top = k;
  let low = S.path.length;
  for (let k = S.path.length - 1; k >= m && bolt.tb[S.path[k]] <= a; k--) low = k;
  if (low === m && top === m - 1) return 0;
  if (low === S.path.length) return Infinity;
  const A = top >= 0 ? bolt.pos.subarray(S.path[top] * 3, S.path[top] * 3 + 3) : S.target, B = bolt.pos.subarray(S.path[low] * 3, S.path[low] * 3 + 3);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

// Segments à dessiner : chaque arête de l'arbre est subdivisée et déplacée par
// un tremblé fractal (la tortuosité à petite échelle : le réseau donne les
// grands coudes). Un segment : [ax, ay, az, tb,  bx, by, bz, s,  mask, w, tirage, sB − sA]
export function tessellate(bolt, { sub = 3, rough = 0.13, seed = 1 } = {}) {
  const { n, pos, parent, tb, s, mask, w } = bolt;
  const out = [];
  const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  for (let i = 0; i < n; i++) {
    const p = parent[i];
    if (p < 0) continue;
    const A = P(p), B = P(i);
    const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(d[0], d[1], d[2]) || 1e-6;
    // repère perpendiculaire
    const ax = Math.abs(d[1]) < 0.9 * L ? [0, 1, 0] : [1, 0, 0];
    let u = [d[1] * ax[2] - d[2] * ax[1], d[2] * ax[0] - d[0] * ax[2], d[0] * ax[1] - d[1] * ax[0]];
    const ul = Math.hypot(u[0], u[1], u[2]); u = u.map((x) => x / ul);
    const v = [(d[1] * u[2] - d[2] * u[1]) / L, (d[2] * u[0] - d[0] * u[2]) / L, (d[0] * u[1] - d[1] * u[0]) / L];
    const pts = [];
    for (let k = 0; k <= sub; k++) {
      const t = k / sub, e = Math.sin(Math.PI * t); // (extrémités fixes)
      const j = hash3(i, k, 7, seed);
      const o1 = (j[0] - 0.5) * 2 * rough * L * e, o2 = (j[1] - 0.5) * 2 * rough * L * e;
      pts.push([A[0] + d[0] * t + u[0] * o1 + v[0] * o2, A[1] + d[1] * t + u[1] * o1 + v[1] * o2, A[2] + d[2] * t + u[2] * o1 + v[2] * o2]);
    }
    // le segment appartient au canal si ses deux bouts y sont
    const m = mask[i] & mask[p];
    const ww = Math.min(w[i], w[p] || w[i]);
    for (let k = 0; k < sub; k++) {
      const t0 = k / sub, t1 = (k + 1) / sub;
      const tbk = tb[p] + (tb[i] - tb[p]) * t1; // (né quand son bout aval l'est)
      const sa = s[p] + (s[i] - s[p]) * t0, sb = s[p] + (s[i] - s[p]) * t1;
      out.push(pts[k][0], pts[k][1], pts[k][2], Math.max(tb[p], tbk), pts[k + 1][0], pts[k + 1][1], pts[k + 1][2], (sa + sb) / 2, m, ww, hash3(i, k, 3, seed)[0], sb - sa);
    }
  }
  return new Float32Array(out);
}
