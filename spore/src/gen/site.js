// Tout ce qu'un site calcule une fois (module pur : worker, tests, outils) :
// le plasmodium (front, réseau de Tero, perles), la géométrie des veines, les
// gabarits des sporanges, les spores et leurs chutes. Le GPU relit ces
// tableaux ; seule la phase change à l'image.
import { buildPlasmodium, K_SNAP, S0, S1 } from './plasmodium.js';
import { buildTemplate } from './sporangia.js';
import { simulateSmoke, SMOKE } from './smoke.js';
import { heightGrid } from './wood.js';
import { fruitState, beamShape } from '../fruit.js';
import { windSpeed } from '../timeline.js';
import { FAMILIES } from '../families.js';

const MAX_ROWS = 8192;
// (Hemitrichia : seuil des tubes-fruits. Plus bas, presque tout le réseau
// devenait fruit, un feutre de rubans ; à 66 % il reste un filet à mailles
// ouvertes, celui d'H. serpula)
const FRUIT_R = 0.66;

// ── Veines : brins (chaînes entre nœuds de degré ≠ 2), lissés, en tubes ─────
function strandsOf(Gr, keep) {
  const { n, ea, eb, off, adj } = Gr;
  const deg = new Int32Array(n);
  for (let k = 0; k < Gr.m; k++) if (keep[k]) { deg[ea[k]]++; deg[eb[k]]++; }
  const seen = new Uint8Array(Gr.m), strands = [];
  const other = (k, i) => (ea[k] === i ? eb[k] : ea[k]);
  const walk = (i0, k0) => {
    const nodes = [i0], edges = [];
    let i = i0, k = k0;
    for (;;) {
      seen[k] = 1; edges.push(k);
      const j = other(k, i); nodes.push(j);
      if (deg[j] !== 2 || j === i0) break;
      let nk = -1;
      for (let q = off[j]; q < off[j + 1]; q++) { const e = adj[q]; if (keep[e] && !seen[e]) { nk = e; break; } }
      if (nk < 0) break;
      i = j; k = nk;
    }
    return { nodes, edges };
  };
  for (let i = 0; i < n; i++) {
    if (!deg[i] || deg[i] === 2) continue;
    for (let q = off[i]; q < off[i + 1]; q++) { const k = adj[q]; if (keep[k] && !seen[k]) strands.push(walk(i, k)); }
  }
  for (let k = 0; k < Gr.m; k++) if (keep[k] && !seen[k]) strands.push(walk(ea[k], k)); // (boucles)
  return { strands, deg };
}

// lissage d'affichage : les nœuds de degré 2 glissent vers le milieu de leurs
// voisins (le treillis dessinerait des escaliers) ; les jonctions bougent peu
function smoothNodes(Gr, keep, deg, iters = 8, wJ = 0.12, init = Gr) {
  const x = Float64Array.from(init.x), z = Float64Array.from(init.z);
  for (let it = 0; it < iters; it++) {
    const nx = Float64Array.from(x), nz = Float64Array.from(z);
    for (let i = 0; i < Gr.n; i++) {
      if (!deg[i]) continue;
      let sx = 0, sz = 0, c = 0;
      for (let q = Gr.off[i]; q < Gr.off[i + 1]; q++) { const k = Gr.adj[q]; if (!keep[k]) continue; const j = Gr.ea[k] === i ? Gr.eb[k] : Gr.ea[k]; sx += x[j]; sz += z[j]; c++; }
      const w = deg[i] === 2 ? 0.5 : wJ;
      nx[i] = x[i] * (1 - w) + (sx / c) * w; nz[i] = z[i] * (1 - w) + (sz / c) * w;
    }
    x.set(nx); z.set(nz);
  }
  return { x, z };
}

const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

// tubes des brins : attributs par sommet
//   c  (x, z, tx, tz)   point de l'axe, tangente
//   o  (cosθ, sinθ, axial, w)   décalage dans la section (θ = 0 de côté,
//                               π/2 en haut), part axiale (calottes), poids
//   e  (ligne A, ligne B)       arêtes dont le rayon est lu (mélangées par w)
function veinGeometry(strands, P, rowOf, NR = 10, SUB = 3) {
  const C = [], O = [], E = [], I = [];
  let nv = 0;
  const ring = (cx, cz, tx, tz, ra, rb, w, axial = 0, scale = 1) => {
    const start = nv;
    for (let a = 0; a < NR; a++) {
      const th = (a / NR) * Math.PI * 2;
      C.push(cx, cz, tx, tz); O.push(Math.cos(th) * scale, Math.sin(th) * scale, axial, w); E.push(ra, rb); nv++;
    }
    return start;
  };
  const join = (r0, r1) => { for (let a = 0; a < NR; a++) { const b = (a + 1) % NR; I.push(r0 + a, r0 + b, r1 + b, r0 + a, r1 + b, r1 + a); } };
  for (const S of strands) {
    const pts = S.nodes.map((i) => [P.x[i], P.z[i]]);
    const m = pts.length;
    const g = (k) => pts[Math.min(m - 1, Math.max(0, k))];
    const samples = [];
    for (let k = 0; k < m - 1; k++) {
      for (let q = 0; q < SUB; q++) {
        const t = q / SUB;
        const x = catmull(g(k - 1)[0], g(k)[0], g(k + 1)[0], g(k + 2)[0], t), z = catmull(g(k - 1)[1], g(k)[1], g(k + 1)[1], g(k + 2)[1], t);
        const e = rowOf[S.edges[k]];
        let ra = e, rb = e, w = 0;
        if (q === 0 && k > 0) { ra = rowOf[S.edges[k - 1]]; rb = e; w = 0.5; }
        samples.push([x, z, ra, rb, w]);
      }
    }
    const eL = rowOf[S.edges[m - 2]];
    samples.push([g(m - 1)[0], g(m - 1)[1], eL, eL, 0]);
    // tangentes
    const tan = samples.map((_, k) => {
      const a = samples[Math.max(0, k - 1)], b = samples[Math.min(samples.length - 1, k + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l];
    });
    let prev = -1;
    // calotte de départ (hémisphère vers l'arrière)
    const capRings = (k, dir) => {
      const [x, z, ra, rb, w] = samples[k], [tx, tz] = tan[k];
      const rs = [];
      for (let j = 3; j >= 1; j--) { const be = (Math.PI / 2) * (j / 4); rs.push(ring(x, z, tx, tz, ra, rb, w, dir * Math.sin(be), Math.cos(be))); }
      return rs;
    };
    const tipStart = capRings(0, -1);
    for (let j = 0; j + 1 < tipStart.length; j++) join(tipStart[j], tipStart[j + 1]);
    prev = tipStart[tipStart.length - 1];
    samples.forEach(([x, z, ra, rb, w], k) => {
      const r = ring(x, z, tan[k][0], tan[k][1], ra, rb, w);
      join(prev, r); prev = r;
    });
    const tipEnd = capRings(samples.length - 1, 1).reverse();
    for (const r of tipEnd) { join(prev, r); prev = r; }
  }
  return { c: Float32Array.from(C), o: Float32Array.from(O), e: Float32Array.from(E), index: Uint32Array.from(I), count: nv };
}

export function buildSite(spec) {
  const { R, M: lite } = spec;
  const sstepJS = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const fam = FAMILIES[R.family], sp = fam.species[R.species];
  const L = R.site.L;
  const ground = heightGrid({ ...R.wood, L, W: R.site.W, logR: R.site.logR }, 256);
  const Pm = buildPlasmodium({ P: R.plasmodium, sp, fruit: R.fruit, L });
  const { Gr, net, rad, beads } = Pm;
  const m = Gr.m;
  // arêtes gardées : visibles à un instant au moins ; triées par rayon maximal
  const rmax = new Float32Array(m);
  for (let k = 0; k < m; k++) for (let q = 0; q < K_SNAP; q++) rmax[k] = Math.max(rmax[k], rad(net.snapD[q * m + k]));
  let kept = [...Array(m).keys()].filter((k) => rmax[k] > 0).sort((a, b) => rmax[b] - rmax[a]);
  if (kept.length > MAX_ROWS) kept = kept.slice(0, MAX_ROWS);
  const keep = new Uint8Array(m), rowOf = new Int32Array(m).fill(-1);
  kept.forEach((k, i) => { keep[k] = 1; rowOf[k] = i; });
  // Hemitrichia : les veines-fruits forment leurs propres brins (de longs
  // tubes continus, sans calotte à chaque petite branche qui s'en détache)
  const lastR0 = (k) => rad(net.snapD[(K_SNAP - 1) * m + k]);
  let strands, deg, netFruit = null;
  if (sp.mode === 'net') {
    const kf = new Uint8Array(m), kr = new Uint8Array(m);
    for (let k = 0; k < m; k++) if (keep[k]) { if (lastR0(k) >= sp.vein * FRUIT_R) kf[k] = 1; else kr[k] = 1; }
    const a = strandsOf(Gr, kf), b = strandsOf(Gr, kr);
    strands = [...a.strands, ...b.strands];
    netFruit = { keep: kf, deg: a.deg };
    deg = new Int32Array(Gr.n); for (let i = 0; i < Gr.n; i++) deg[i] = a.deg[i] + b.deg[i];
  } else ({ strands, deg } = strandsOf(Gr, keep));
  // (le filet d'Hemitrichia, vu de près en tubes épais, demande un lissage plus poussé)
  let P = smoothNodes(Gr, keep, deg, sp.mode === 'net' ? 16 : 8, sp.mode === 'net' ? 0.25 : 0.12);
  // (Hemitrichia : les tubes-fruits se lissent encore entre eux seuls. Dans le
  // réseau entier, leurs nœuds sont des jonctions — de petites branches s'en
  // détachent, qui se videront — et restaient épinglés : le filet mûr se
  // dessinait en marches à angle droit)
  if (netFruit) P = smoothNodes(Gr, netFruit.keep, netFruit.deg, 20, 0.2, P);
  // Hemitrichia : les veines maîtresses (au rayon final ≥ 66 % du maximum) deviennent le fruit
  const lastR = (k) => rad(net.snapD[(K_SNAP - 1) * m + k]);
  const fruitEdge = (k) => sp.mode === 'net' && lastR(k) >= sp.vein * FRUIT_R;
  // table des arêtes (K × lignes, RGBA) : rayon, flux signé, vidange, arrivée
  const rows = kept.length;
  const tex = new Float32Array(K_SNAP * rows * 4);
  let qmax = 1e-9;
  for (let q = 0; q < K_SNAP; q++) for (const k of kept) qmax = Math.max(qmax, Math.abs(net.snapQ[q * m + k]));
  kept.forEach((k, row) => {
    const Tm = (Gr.T[Gr.ea[k]] + Gr.T[Gr.eb[k]]) / 2;
    for (let q = 0; q < K_SNAP; q++) {
      const o = (row * K_SNAP + q) * 4;
      tex[o] = rad(net.snapD[q * m + k]);
      tex[o + 1] = net.snapQ[q * m + k] / qmax;
      tex[o + 2] = fruitEdge(k) ? -1 : Pm.drain[k];
      tex[o + 3] = Tm;
    }
  });
  // rayons lissés le long de chaque brin (un tube continu, pas un chapelet)
  for (const St of strands) {
    const rows2 = St.edges.map((k) => rowOf[k]).filter((r) => r >= 0);
    if (rows2.length < 3) continue;
    for (let q = 0; q < K_SNAP; q++) {
      const v = rows2.map((r) => tex[(r * K_SNAP + q) * 4]);
      const sm = v.map((_, i) => { let a = 0, w = 0; for (let j = -4; j <= 4; j++) { const x = v[i + j]; if (!(x > 0)) continue; const ww = Math.exp(-(j * j) / 6); a += x * ww; w += ww; } return w ? a / w : 0; });
      // (une arête nulle reste nulle : le tube n'apparaît pas avant son heure)
      rows2.forEach((r, i) => { if (v[i] > 0) tex[(r * K_SNAP + q) * 4] = sm[i]; });
    }
  }
  const veins = veinGeometry(strands, P, rowOf);
  // ── sporanges ──
  const template = sp.head ? buildTemplate(R.family, sp, `${R.seed}:tpl`) : null;
  const dims = template?.dims;
  const beadArr = new Float32Array(beads.length * 8);
  beads.forEach((b, i) => {
    // (perles en mode « veine » : reposées sur l'axe lissé de leur veine)
    beadArr.set([b.x, b.z, b.size, b.delay, b.az, b.rnd, b.tilt, b.spin], i * 8);
  });
  // tête d'un sporange à la phase s (pour le départ des spores)
  const heads = (i, s) => {
    const b = beads[i], st = fruitState(b, s, R, sp), sz = b.size;
    const y0 = ground(b.x, b.z);
    let yc, r, h, top;
    if (R.family === 'arcyria') {
      const e = 1 + (sp.expand - 1) * st.open;
      const hn = (dims.top - dims.cupTop) * e;
      yc = dims.cupTop + hn / 2; r = dims.netR * (1 + 0.25 * st.open); h = hn / 2; top = dims.cupTop + hn;
    } else if (R.family === 'lamproderma' || R.family === 'trichia' || R.family === 'lycogala') { yc = dims.headC; r = dims.netR; h = (dims.headH ?? dims.headR * 2) / 2; top = dims.top; }
    else { yc = dims.stalkH + dims.headH * 0.6; r = dims.netR; h = dims.headH * 0.4; top = dims.top; }
    const t = beamShape(yc / top);
    return { c: [b.x + st.bx * t * sz, y0 + yc * sz, b.z + st.bz * t * sz], r: r * sz, h: h * sz };
  };
  // Hemitrichia : les spores partent des tubes (un point au hasard des veines-fruits)
  let sporeBeads = beads, sporeHeads = heads;
  if (sp.mode === 'net') {
    const fk = kept.filter((k) => fruitEdge(k));
    const rng = (i) => { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); };
    sporeBeads = fk.slice(0, 400).map((k, i) => ({ x: (P.x[Gr.ea[k]] + P.x[Gr.eb[k]]) / 2, z: (P.z[Gr.ea[k]] + P.z[Gr.eb[k]]) / 2, size: 1, delay: rng(i) * 0.6 + 0.2 * Pm.drain[k], az: 0, rnd: rng(i + 9) }));
    sporeHeads = (i, s) => { const b = sporeBeads[i], r = sp.tube * 1.4; return { c: [b.x, ground(b.x, b.z) + r, b.z], r, h: r * 0.5 }; };
  }
  // ── le nuage : simulation de fluide, émise par les têtes qui s'ouvrent ──
  const kick = { arcyria: 0.5, stemonitis: 0.25, lamproderma: 0.4, hemitrichia: 0.6, trichia: 1.2, lycogala: 2.2 }[R.family] ?? 0.4;
  const emitters = sporeBeads.map((b, i) => {
    const V = (sp.head ? (sp.head.r ** 2) * sp.head.h * 3.1 : sp.tube ** 2 * 0.2) * (b.size ?? 1) ** 3;
    const op = (s) => (sp.mode === 'net' ? sstepJS(0.74 + b.delay * 0.06, 0.86 + b.delay * 0.06, s) : fruitState(b, s, R, sp).open);
    // (Lycogala : chaque rafale aspire une bouffée par l'ouverture — Venturi)
    const puff = R.family === 'lycogala' ? (s) => (windSpeed(s, R.wind.gust, R.wind.strength) / 0.7) ** 2 : () => 1;
    return { at: (s) => sporeHeads(i, s), rate: (s) => Math.max(0, op(s + 0.002) - op(s - 0.002)) / 0.004 / SMOKE.sec * V * puff(s), kick };
  });
  const K = R.light.key;
  const sunDir = K.kind === 'lamp' ? [Math.sin(R.camera.az) * 0.6, 0.7, Math.cos(R.camera.az) * 0.6] : [Math.cos(K.az) * Math.cos(K.el), Math.sin(K.el), Math.sin(K.az) * Math.cos(K.el)];
  const Sm = simulateSmoke({ R, L, ground, emitters, sunDir, settle: 0.3 * ((sp.spore ?? 10) / 10) ** 2, grains: lite ? 2500 : 6000, seeds: Pm.seeds, seed: `${R.seed}:smoke` });
  const F = Pm.F;
  return {
    sheet: { T: F.T, Gx: F.Gx, Gz: F.Gz, x0: F.x0, z0: F.z0, h: F.h },
    edges: { tex, rows, K: K_SNAP, s0: S0, s1: S1 },
    veins,
    beads: beadArr, nBeads: beads.length,
    template, dims,
    smoke: Sm,
    seeds: Pm.seeds.map((g) => [g.x, g.z, g.t]).flat(),
    stats: { nodes: Gr.n, edges: m, kept: rows, strands: strands.length, residual: net.residual, Vnet: Pm.Vnet, Vbeads: Pm.Vbeads, designated: Sm.grains.designated.length, budget: Sm.budget },
  };
}
