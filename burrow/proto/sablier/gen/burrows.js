// Les terriers : quatre familles, chacune décrite par une liste de primitives
// (capsules effilées, crêpes lobées, ellipsoïdes) dans le repère du bloc de gel.
// Module pur (sans three) : la recette, le worker et les tests l'importent.
//
// Unités : 1 = 10 cm. Le bloc mesure 2·BLOCK.hx × 2·BLOCK.hy × 2·BLOCK.hz
// (15 × 18 × 10 cm), centré à l'origine, y vers le haut. L'entrée du terrier
// est au milieu de la face du haut, où arrive le col du bulbe.
//
// Les architectures suivent les relevés publiés :
// - Lustre : Tschinkel (2004, 2015), Pogonomyrmex badius — un puits en hélice
//   lâche ; des chambres « en crêpe », horizontales, lobées, accrochées au
//   puits, serrées et grandes en haut, plus petites et plus espacées en bas ;
// - Vis : Daimonelix (Barbour 1892 ; Martin et Bennett 1977), le terrier de
//   Palaeocastor — une vis régulière de plusieurs tours, au pied de laquelle
//   part une chambre en pente ;
// - Garenne : galeries ramifiées qui montent et descendent, culs-de-sac et
//   chambres en bout : des bassins qui se remplissent l'un après l'autre et des
//   poches d'air qui restent ;
// - Treillis : Thalassinoides (Ehrenberg 1944 ; Frey et al.) — étages de
//   galeries horizontales en réseau polygonal, renflées aux jonctions, reliés
//   par des puits.
import { createRng } from '../../../../shared/rng.js';

export const BLOCK = { hx: 0.75, hy: 0.9, hz: 0.5 };
export const MARGIN = 0.07; // (paroi de gel minimale entre le terrier et le verre)
export const FAMILIES = {
  lustre: { label: 'Lustre', who: 'Pogonomyrmex badius (fourmi moissonneuse)' },
  vis: { label: 'Vis', who: 'Daimonelix (castor fossile Palaeocastor)' },
  garenne: { label: 'Garenne', who: 'galeries ramifiées (lapin, blaireau)' },
  treillis: { label: 'Treillis', who: 'Thalassinoides (crustacés fouisseurs)' },
};

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// une courbe échantillonnée → capsules jointives (rayon par sommet)
function tubeOf(pts, rads, out) {
  for (let i = 0; i + 1 < pts.length; i++) out.push({ t: 'cap', a: pts[i], b: pts[i + 1], ra: rads[i], rb: rads[i + 1] });
}

// l'entrée : un court goulot vertical sous la face du haut (le col s'y raccorde)
const TOP = BLOCK.hy;
export const ENTRANCE = [0, TOP, 0];
export const ENTRANCE_R = 0.028;

// enveloppe utile (points de l'axe d'un tube de rayon r)
const inside = (p, r) => Math.abs(p[0]) <= BLOCK.hx - MARGIN - r && Math.abs(p[2]) <= BLOCK.hz - MARGIN - r && p[1] >= -BLOCK.hy + MARGIN + r && p[1] <= TOP;

// ── Lustre (Tschinkel) ───────────────────────────────────────────────────────
function lustre(rng, P) {
  const out = [];
  const rs = P.shaftR, rh = P.helixR, pitch = P.pitch;
  const a0 = rng.range(0, TAU), turnDir = rng.sign();
  const cx = -rh * Math.cos(a0), cz = -rh * Math.sin(a0);
  const yStart = TOP - 0.06, yEnd = -BLOCK.hy + MARGIN + 0.08;
  const wob = [rng.range(0, TAU), rng.range(0, TAU)];
  const shaftAt = (y) => {
    const a = a0 + turnDir * TAU * (yStart - y) / pitch;
    const r = rh * (1 + 0.12 * Math.sin(3.1 * y + wob[0]));
    return [cx + r * Math.cos(a) + 0.012 * Math.sin(7.3 * y + wob[1]), y, cz + r * Math.sin(a)];
  };
  // le puits : goulot droit puis hélice
  const pts = [ENTRANCE.slice(), [0, yStart, 0]], rads = [ENTRANCE_R, rs];
  const n = Math.ceil((yStart - yEnd) / 0.02);
  for (let i = 1; i <= n; i++) { const y = yStart - (yStart - yEnd) * i / n; pts.push(shaftAt(y)); rads.push(rs * (1 + 0.15 * Math.sin(i * 0.9 + wob[0]))); }
  tubeOf(pts, rads, out);
  // les chambres : profondeur croissante, espacement croissant, aire décroissante
  const nc = P.chambers, D = yStart - yEnd - 0.05;
  let lastY = Infinity;
  for (let k = 0; k < nc; k++) {
    const s = (k + 0.35) / nc;
    let y = yStart - 0.08 - D * Math.pow(s, 1.45);
    const R = P.rTop + (P.rBot - P.rTop) * Math.pow(s, 0.8);
    const h = P.h * (1 - 0.3 * s);
    if (lastY - y < h + 0.05) y = lastY - (h + 0.05);
    if (y - h < -BLOCK.hy + MARGIN) break;
    lastY = y;
    const sp = shaftAt(y);
    // direction : la plus libre (loin des parois), avec une préférence tirée
    let best = null;
    for (let t = 0; t < 16; t++) {
      const az = rng.range(0, TAU), off = R * rng.range(0.45, 0.75);
      const c = [sp[0] + Math.cos(az) * off, y, sp[2] + Math.sin(az) * off];
      const room = Math.min(BLOCK.hx - MARGIN - Math.abs(c[0]), BLOCK.hz - MARGIN - Math.abs(c[2]));
      const sc = room - R;
      if (!best || sc > best.sc) best = { c, sc, az };
    }
    let Rk = R;
    if (best.sc < 0) Rk = Math.max(0.06, R + best.sc); // (rétrécie pour tenir dans le bloc)
    const lobes = [];
    const nl = rng.int(2, 4);
    for (let l = 0; l < nl; l++) lobes.push([rng.int(2, 5), rng.range(0.06, 0.16) / (1 + l * 0.4), rng.range(0, TAU)]);
    out.push({ t: 'puck', c: best.c, R: Rk, h, dome: h * 0.25, lobes });
    // raccord au puits sur toute la hauteur de la chambre (pas de poche d'air au raccord)
    out.push({ t: 'cap', a: [sp[0], y + h * 0.1, sp[2]], b: [best.c[0], y + h * 0.1, best.c[2]], ra: h * 0.55, rb: h * 0.55 });
  }
  return out;
}

// ── Vis (Daimonelix) ─────────────────────────────────────────────────────────
function vis(rng, P) {
  const out = [];
  const r = P.tubeR, rh = P.helixR, turns = P.turns, dir = rng.sign();
  const yTop = TOP - 0.1, yBot = -BLOCK.hy + MARGIN + P.chamberR + 0.04;
  const a0 = rng.range(0, TAU);
  // l'axe de la vis, légèrement penché (les spécimens ne sont jamais droits)
  const tilt = [rng.range(-0.06, 0.06), rng.range(-0.04, 0.04)];
  const cx0 = clamp(rng.range(-0.08, 0.08), -(BLOCK.hx - MARGIN - rh - r - 0.06), BLOCK.hx - MARGIN - rh - r - 0.06);
  const at = (s) => { // s ∈ [0, 1] de haut en bas
    const y = yTop + (yBot - yTop) * s, a = a0 + dir * TAU * turns * s;
    const k = (yTop - y);
    return [cx0 + tilt[0] * k + rh * Math.cos(a), y, tilt[1] * k + rh * Math.sin(a)];
  };
  const p0 = at(0);
  const pts = [ENTRANCE.slice(), [0, TOP - 0.04, 0], [p0[0] * 0.5, (TOP - 0.04 + p0[1]) / 2, p0[2] * 0.5]], rads = [ENTRANCE_R, r * 0.8, r * 0.9];
  const n = Math.ceil(turns * 48);
  for (let i = 0; i <= n; i++) { pts.push(at(i / n)); rads.push(r * (1 + 0.06 * Math.sin(i * 0.37))); }
  // la chambre : part du pied de la vis, tangente, en pente douce vers le bas
  const pe = at(1), pb = at(1 - 1 / n);
  let t = sub3(pe, pb); t[1] = 0; const tl = Math.hypot(t[0], t[2]) || 1; t = [t[0] / tl, 0, t[2] / tl];
  const L = P.chamberL, slope = Math.tan(P.chamberSlope);
  const cr = P.chamberR;
  for (let i = 1; i <= 10; i++) {
    const s = i / 10;
    let q = [pe[0] + t[0] * L * s, pe[1] - slope * L * s, pe[2] + t[2] * L * s];
    // garder la chambre dans le bloc : elle tourne si elle sort
    q = [clamp(q[0], -(BLOCK.hx - MARGIN - cr), BLOCK.hx - MARGIN - cr), Math.max(q[1], -BLOCK.hy + MARGIN + cr), clamp(q[2], -(BLOCK.hz - MARGIN - cr), BLOCK.hz - MARGIN - cr)];
    pts.push(q); rads.push(r + (cr - r) * Math.sin(Math.min(1, s * 1.6) * Math.PI / 2));
  }
  tubeOf(pts, rads, out);
  return out;
}

// ── Garenne ──────────────────────────────────────────────────────────────────
function garenne(rng, P) {
  const out = [], segs = []; // segs : axes déjà posés (pour éviter les croisements)
  const r = P.tubeR;
  const clear = (pts, rr, skip, from) => {
    for (const p of pts) for (let s = 0; s < segs.length; s++) {
      if (skip.has(s)) continue;
      const S = segs[s];
      if (len3(sub3(S.p, from)) < 0.16) continue; // (le nœud de départ et ses voisines)
      if (len3(sub3(p, S.p)) < rr + S.r + 0.035) return false;
    }
    return true;
  };
  const addPts = (pts, rr, id) => { for (const p of pts) segs.push({ p, r: rr, id }); };
  let gid = 0;
  // une galerie : de p, cap az, pente de départ et d'arrivée (ondulée), longueur L
  const gallery = (p, az, s0, s1, L, rr) => {
    const pts = [p], n = Math.max(6, Math.round(L / 0.025));
    let q = p.slice();
    const bend = rng.range(-0.9, 0.9), dip = rng.range(-1, 1) * P.undulate;
    for (let i = 1; i <= n; i++) {
      const s = i / n, a = az + bend * s;
      const sl = s0 + (s1 - s0) * s + dip * Math.sin(Math.PI * s * 2);
      const step = L / n;
      q = [q[0] + Math.cos(a) * step, q[1] + Math.sin(sl) * step, q[2] + Math.sin(a) * step];
      pts.push(q);
    }
    return pts;
  };
  // la descente depuis l'entrée
  const az0 = rng.range(0, TAU);
  const first = [ENTRANCE.slice(), [0, TOP - 0.05, 0], ...gallery([0, TOP - 0.05, 0], az0, -1.1, -0.7, 0.35, r).slice(1)];
  tubeOf(first, first.map((_, i) => (i === 0 ? ENTRANCE_R : r)), out);
  addPts(first, r, gid++);
  const nodes = [{ p: first[first.length - 1], az: az0, depth: 0, id: 0 }];
  let made = 0, tries = 0;
  while (nodes.length && made < P.galleries && tries < 1500) {
    tries++;
    // (de préférence les nœuds profonds : la garenne descend dans tout le bloc)
    const N = nodes[Math.floor(Math.pow(rng.next(), 0.6) * nodes.length)];
    const az = N.az + rng.range(-2.2, 2.2);
    // pentes : surtout vers le bas, parfois vers le haut (culs-de-sac à air)
    const up = rng.chance(P.upward);
    const s0 = up ? rng.range(0.15, 0.4) : rng.range(-0.95, -0.35);
    const s1 = up ? rng.range(0.1, 0.35) : rng.range(-0.5, 0.05);
    const L = up ? rng.range(0.16, 0.26) : rng.range(0.26, 0.48);
    const pts = gallery(N.p, az, s0, s1, L, r);
    if (!pts.every((q) => inside(q, r + 0.005)) || pts.some((q) => q[1] > TOP - 0.15)) continue;
    if (!clear(pts, r, new Set(segs.map((S, i) => (S.id === N.id ? i : -1)).filter((i) => i >= 0)), N.p)) continue;
    const id = gid++;
    tubeOf(pts, pts.map(() => r * rng.range(0.92, 1.08)), out);
    addPts(pts, r, id);
    made++;
    const end = pts[pts.length - 1];
    // en bout : une chambre (bulbe), ou un cul-de-sac arrondi
    if (rng.chance(P.chamberP)) {
      const cr = rng.range(P.chamberR * 0.75, P.chamberR * 1.15);
      if (inside(end, cr)) out.push({ t: 'ell', c: end, r: [cr * rng.range(1.1, 1.5), cr * 0.8, cr * rng.range(0.9, 1.2)], yaw: az });
    }
    // (une galerie qui monte est un cul-de-sac : ce qui en partirait resterait plein d'air)
    if (!up && N.depth < 6) nodes.push({ p: end, az, depth: N.depth + 1, id });
    if (rng.chance(0.3)) nodes.splice(nodes.indexOf(N), 1);
  }
  return out;
}

// ── Treillis (Thalassinoides) ────────────────────────────────────────────────
function treillis(rng, P) {
  const out = [];
  const r = P.tubeR, nt = P.tiers;
  const yTop = TOP - 0.25, yBot = -BLOCK.hy + MARGIN + 0.1;
  const tiers = [];
  for (let t = 0; t < nt; t++) {
    const y = yTop + (yBot - yTop) * (t / Math.max(1, nt - 1));
    // nœuds : semis de Poisson dans le rectangle utile
    const ex = BLOCK.hx - MARGIN - r * 1.8, ez = BLOCK.hz - MARGIN - r * 1.8;
    const pts = [];
    for (let k = 0; k < 400 && pts.length < P.nodes; k++) {
      const q = [rng.range(-ex, ex), y, rng.range(-ez, ez)];
      if (pts.every((o) => Math.hypot(o[0] - q[0], o[2] - q[2]) > P.spacing)) pts.push(q);
    }
    // graphe de Gabriel : polygones d'un treillis ; on en retire quelques arêtes
    const edges = [];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const m = [(pts[i][0] + pts[j][0]) / 2, (pts[i][2] + pts[j][2]) / 2];
      const rr = Math.hypot(pts[i][0] - pts[j][0], pts[i][2] - pts[j][2]) / 2;
      if (pts.every((o, k) => k === i || k === j || Math.hypot(o[0] - m[0], o[2] - m[1]) > rr)) edges.push([i, j]);
    }
    // arbre couvrant garanti (Prim sur les arêtes de Gabriel) + une part des autres
    const inT = new Set([0]), keep = [];
    while (inT.size < pts.length) {
      let best = null;
      for (const e of edges) {
        const a = inT.has(e[0]), b = inT.has(e[1]);
        if (a === b) continue;
        const d = Math.hypot(pts[e[0]][0] - pts[e[1]][0], pts[e[0]][2] - pts[e[1]][2]);
        if (!best || d < best.d) best = { e, d };
      }
      if (!best) break;
      keep.push(best.e); inT.add(best.e[0]); inT.add(best.e[1]);
    }
    for (const e of edges) if (!keep.includes(e) && rng.chance(P.extra)) keep.push(e);
    for (const [i, j] of keep) {
      const a = pts[i], b = pts[j], n = 8, q = [], rr = [];
      // la galerie ondule un peu dans le plan horizontal, jamais en hauteur
      const side = rng.range(-0.04, 0.04);
      const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1;
      for (let s = 0; s <= n; s++) {
        const u = s / n, w = Math.sin(Math.PI * u) * side;
        q.push([a[0] + dx * u - dz / L * w, y, a[2] + dz * u + dx / L * w]);
        rr.push(r * (1 - 0.15 * Math.sin(Math.PI * u)));
      }
      tubeOf(q, rr, out);
    }
    // renflements aux jonctions (les « bulbes » de Thalassinoides), posés sur le plancher
    const deg = pts.map(() => 0);
    for (const [i, j] of keep) { deg[i]++; deg[j]++; }
    pts.forEach((q, i) => { if (deg[i] >= 2 || rng.chance(0.5)) { const s = r * rng.range(1.35, 1.7); out.push({ t: 'ell', c: [q[0], y + (s * 0.75 - r), q[2]], r: [s, s * 0.75, s], yaw: 0 }); } });
    tiers.push({ y, pts });
  }
  // puits : entrée → étage du haut ; puis entre étages, à des nœuds proches en plan
  const near = (pts, p) => pts.reduce((b, q) => (Math.hypot(q[0] - p[0], q[2] - p[2]) < Math.hypot(b[0] - p[0], b[2] - p[2]) ? q : b));
  const t0 = near(tiers[0].pts, ENTRANCE);
  tubeOf([ENTRANCE.slice(), [0, TOP - 0.05, 0], [t0[0], tiers[0].y, t0[2]]], [ENTRANCE_R, r, r], out);
  for (let t = 0; t + 1 < tiers.length; t++) {
    const used = new Set();
    for (let s = 0; s < P.shafts; s++) {
      const a = tiers[t].pts[Math.floor(rng.next() * tiers[t].pts.length)];
      const b = near(tiers[t + 1].pts, a);
      const key = `${a}|${b}`;
      if (used.has(key)) continue;
      used.add(key);
      tubeOf([[a[0], tiers[t].y, a[2]], [b[0], tiers[t + 1].y, b[2]]], [r * 0.9, r * 0.9], out);
    }
  }
  return out;
}

// paramètres tirés par famille (la recette les porte : le panneau peut les régler)
export function drawParams(family, rng) {
  switch (family) {
    case 'lustre': return { shaftR: r3(rng.range(0.028, 0.034)), helixR: r3(rng.range(0.05, 0.11)), pitch: r3(rng.range(0.3, 0.55)), chambers: rng.int(7, 10), rTop: r3(rng.range(0.27, 0.34)), rBot: r3(rng.range(0.1, 0.14)), h: r3(rng.range(0.05, 0.065)) };
    case 'vis': return { tubeR: r3(rng.range(0.036, 0.046)), helixR: r3(rng.range(0.2, 0.26)), turns: rng.int(4, 6), chamberL: r3(rng.range(0.3, 0.42)), chamberR: r3(rng.range(0.065, 0.08)), chamberSlope: r3(rng.range(0.08, 0.2)) };
    case 'garenne': return { tubeR: r3(rng.range(0.036, 0.044)), galleries: rng.int(9, 14), upward: r3(rng.range(0.08, 0.16)), undulate: r3(rng.range(0.15, 0.32)), chamberP: r3(rng.range(0.4, 0.65)), chamberR: r3(rng.range(0.075, 0.095)) };
    case 'treillis': return { tubeR: r3(rng.range(0.03, 0.036)), tiers: rng.int(3, 4), nodes: rng.int(6, 9), spacing: r3(rng.range(0.26, 0.32)), extra: r3(rng.range(0.25, 0.5)), shafts: rng.int(1, 2) };
    default: throw new Error(`famille inconnue : ${family}`);
  }
}
const r3 = (x) => Math.round(x * 1000) / 1000 || 0;

// famille + paramètres + graine → primitives
export function burrowPrims(family, params, seed) {
  const rng = createRng(`${seed}:burrow:${family}`);
  switch (family) {
    case 'lustre': return lustre(rng, params);
    case 'vis': return vis(rng, params);
    case 'garenne': return garenne(rng, params);
    case 'treillis': return treillis(rng, params);
    default: throw new Error(`famille inconnue : ${family}`);
  }
}

// ── Distances signées des primitives ─────────────────────────────────────────
// capsule effilée (approchée : rayon interpolé au point le plus proche de l'axe)
function sdCap(px, py, pz, P) {
  const ax = P.a[0], ay = P.a[1], az = P.a[2];
  const bx = P.b[0] - ax, by = P.b[1] - ay, bz = P.b[2] - az;
  const qx = px - ax, qy = py - ay, qz = pz - az;
  const bb = bx * bx + by * by + bz * bz;
  const t = bb > 0 ? clamp((qx * bx + qy * by + qz * bz) / bb, 0, 1) : 0;
  const dx = qx - bx * t, dy = qy - by * t, dz = qz - bz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (P.ra + (P.rb - P.ra) * t);
}
// crêpe lobée : disque à bord rond, plafond légèrement en dôme
function sdPuck(px, py, pz, P) {
  const x = px - P.c[0], y = py - P.c[1], z = pz - P.c[2];
  const rho = Math.hypot(x, z), th = Math.atan2(z, x);
  let Rt = 1;
  for (const [k, a, ph] of P.lobes) Rt += a * Math.cos(k * (th - ph));
  Rt *= P.R;
  const h2 = P.h / 2;
  // dôme : le plafond monte vers le centre (le plancher reste plat)
  const lift = P.dome * Math.max(0, 1 - (rho / Rt) ** 2);
  const yy = y - lift * 0.5;
  const hh = h2 + lift * 0.5;
  const dr = rho - (Rt - hh);
  return dr > 0 ? Math.hypot(dr, yy) - hh : Math.abs(yy) - hh;
}
// ellipsoïde tourné autour de y (distance approchée de Quilez)
function sdEll(px, py, pz, P) {
  const c = Math.cos(P.yaw || 0), s = Math.sin(P.yaw || 0);
  const x0 = px - P.c[0], y = py - P.c[1], z0 = pz - P.c[2];
  const x = c * x0 + s * z0, z = -s * x0 + c * z0;
  const [rx, ry, rz] = P.r;
  const k0 = Math.hypot(x / rx, y / ry, z / rz), k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}
export function sdPrim(x, y, z, P) {
  return P.t === 'cap' ? sdCap(x, y, z, P) : P.t === 'puck' ? sdPuck(x, y, z, P) : sdEll(x, y, z, P);
}
export function primBounds(P) {
  if (P.t === 'cap') {
    const r = Math.max(P.ra, P.rb);
    return [Math.min(P.a[0], P.b[0]) - r, Math.min(P.a[1], P.b[1]) - r, Math.min(P.a[2], P.b[2]) - r, Math.max(P.a[0], P.b[0]) + r, Math.max(P.a[1], P.b[1]) + r, Math.max(P.a[2], P.b[2]) + r];
  }
  if (P.t === 'puck') {
    let m = 1; for (const [, a] of P.lobes) m += a;
    const R = P.R * m;
    return [P.c[0] - R, P.c[1] - P.h - P.dome, P.c[2] - R, P.c[0] + R, P.c[1] + P.h + P.dome, P.c[2] + R];
  }
  const R = Math.max(...P.r);
  return [P.c[0] - R, P.c[1] - R, P.c[2] - R, P.c[0] + R, P.c[1] + R, P.c[2] + R];
}
