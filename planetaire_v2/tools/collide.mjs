// Contrôle des collisions de la machine, indépendant de sa conception : on fait
// tourner les chaînes sur une période, à pas très fin (SAMPLES instants : moins
// d'un millimètre de déplacement entre deux), et l'on teste, sur la vraie forme
// des pièces (barre, contrepoids, chaque roue du train) :
//   - chaque élément vertical (axe de pivot qui monte d'un bras au suivant,
//     goupille d'astre, colonne de galet qui descend au plateau) contre chaque
//     dalle qu'il traverse en hauteur ;
//   - chaque paire de dalles au même niveau (de n'importe quel rang) ;
//   - chaque paire d'éléments verticaux qui se côtoient en hauteur.
//
//   node tools/collide.mjs [première graine] [nombre] [N imposé]
import { search, ARM_TOL } from '../src/orbit/search.js';
import { epicycles } from '../src/scene/epicycles.js';
import { designMachine, SLAB } from '../src/mech/design.js';

const TAU = Math.PI * 2;
const first = Number(process.argv[2] ?? 0), count = Number(process.argv[3] ?? 40), forceN = process.argv[4] ? Number(process.argv[4]) : null;
const PIN_R = 0.007, COL_R = 0.013, SHOE_R = 0.016, STUD_R = 0.0055;

const pointSeg = (px, py, s) => {
  const vx = s[2] - s[0], vy = s[3] - s[1], l2 = vx * vx + vy * vy || 1e-12;
  const u = Math.max(0, Math.min(1, ((px - s[0]) * vx + (py - s[1]) * vy) / l2));
  return Math.hypot(px - s[0] - u * vx, py - s[1] - u * vy);
};

export function check(D, SAMPLES = null) {
  const { n, N, L, cw, level, base, supports, barW, trains, k } = D;
  // pas : le point le plus rapide se déplace de moins de 0,7 mm entre deux instants
  const vmax = k.reduce((a, kk, i) => a + Math.abs(kk) * L[i], 0) + Math.max(...k.map((kk, i) => Math.abs(kk) * cw[i]));
  const S = SAMPLES ?? Math.min(40000, Math.max(2000, Math.ceil((vmax * TAU) / 0.0007)));
  const lv = (i, j) => Math.round((base[i] + level[i][j] * SLAB) / SLAB); // niveau entier
  // (rayons des pièces tels que scene/machine.js les construit)
  const vR = (p) => (p >= n ? PIN_R * (D.hw ? D.hw[n - 1] : 1) : D.canonR ? D.canonR[p] : Math.max(STUD_R * 2.2, Math.max(0.009, barW[p] * 0.5) * 0.8));
  const cwR = (i) => (D.cwR ? D.cwR[i] : Math.max(0.006, barW[i] * 0.95));
  const P = new Float64Array(2 * n + 2);
  const hits = { vertical: 0, column: 0, slab: 0, pair: 0 };
  const worst = new Set();
  // éléments verticaux : [chaîne, pivot ou colonne, niveau bas, niveau haut, rayon]
  // (un élément occupe ses niveaux extrêmes inclus ; une colonne s'arrête sous son bras)
  const verts = [];
  for (let j = 0; j < N; j++) {
    for (let p = 1; p < n; p++) verts.push({ j, p, lo: lv(p - 1, j), hi: lv(p, j), r: vR(p), kind: 'vertical' });
    verts.push({ j, p: n, lo: lv(n - 1, j), hi: Infinity, r: PIN_R, kind: 'vertical' });
    supports.forEach((us, a) => (us || []).forEach((u) => verts.push({ j, a, u, lo: -1, hi: lv(a, j) - 0.5, r: a === 0 ? COL_R : COL_R, shoe: true, kind: 'column' })));
  }
  // deux axes qui se croisent : l'un des deux est ouvert sur la hauteur partagée
  const inWin = (win, t) => win.some(([a, b]) => (t >= a && t <= b) || (t + TAU >= a && t + TAU <= b));
  const openPair = (v, w, t) => v.kind === 'vertical' && w.kind === 'vertical' && D.portals
    && (D.portals[v.j][v.p].some((g) => g.p2 === w.p && g.j2 === w.j && inWin(g.win, t)) || D.portals[w.j][w.p].some((g) => g.p2 === v.p && g.j2 === v.j && inWin(g.win, t)));
  // un axe ouvert (portail : mech/design.js) laisse passer la dalle qui le traverse
  const open = (v, i2, j2, t) => v.kind === 'vertical' && D.portals && D.portals[v.j][v.p].some((g) => g.p2 === undefined && g.i === i2 && g.j2 === j2 && g.win.some(([a, b]) => (t >= a && t <= b) || (t + TAU >= a && t + TAU <= b)));
  for (let s = 0; s < S; s++) {
    const t = (TAU * s) / S;
    const piv = [], seg = [];
    for (let j = 0; j < N; j++) {
      D.pivots(t + (TAU * j) / N, P);
      piv.push(Float64Array.from(P));
      seg.push(Array.from({ length: n }, (_, i) => {
        const x0 = P[2 * i], y0 = P[2 * i + 1], x1 = P[2 * i + 2], y1 = P[2 * i + 3];
        const ux = (x1 - x0) / (L[i] || 1), uy = (y1 - y0) / (L[i] || 1);
        return [x0 - ux * cw[i], y0 - uy * cw[i], x1, y1, ux, uy];
      }));
    }
    const slabDist = (x, y, j2, i2) => {
      const sg = seg[j2][i2], x0 = piv[j2][2 * i2], y0 = piv[j2][2 * i2 + 1], ux = sg[4], uy = sg[5];
      let d = pointSeg(x, y, sg) - barW[i2] / 2;
      d = Math.min(d, Math.hypot(x - (x0 - ux * cw[i2]), y - (y0 - uy * cw[i2])) - cwR(i2));
      const tr = trains[i2 + 1];
      if (tr) for (const g of tr.gears) d = Math.min(d, Math.hypot(x - (x0 + ux * g.x), y - (y0 + uy * g.x)) - (g.r + tr.m));
      return d;
    };
    const pos = (v) => {
      if (v.kind === 'vertical') return [piv[v.j][2 * v.p], piv[v.j][2 * v.p + 1]];
      const Q = piv[v.j], a = v.a;
      return [Q[2 * a] + v.u * (Q[2 * a + 2] - Q[2 * a]), Q[2 * a + 1] + v.u * (Q[2 * a + 3] - Q[2 * a + 1])];
    };
    const at = verts.map(pos);
    verts.forEach((v, vi) => {
      const [x, y] = at[vi];
      for (let j2 = 0; j2 < N; j2++) for (let i2 = 0; i2 < n; i2++) {
        if (j2 === v.j) {
          // (sa propre chaîne : l'axe est solidaire des deux dalles qu'il relie ;
          // une colonne ne traverse que les rangs plus bas de sa chaîne)
          if (v.kind === 'vertical') continue;
          if (i2 >= v.a) continue;
        }
        if (i2 === 0 && j2 !== v.j && v.kind === 'vertical') continue; // (l'étoile tourne en bloc)
        const l2 = lv(i2, j2);
        if (l2 < v.lo || l2 > v.hi) continue;
        // (axe confondu avec le pivot ou le bout de cette dalle : montage concentrique)
        if (v.kind === 'vertical' && (Math.hypot(x - piv[j2][2 * i2], y - piv[j2][2 * i2 + 1]) < 1e-9 || Math.hypot(x - piv[j2][2 * i2 + 2], y - piv[j2][2 * i2 + 3]) < 1e-9)) continue;
        if (slabDist(x, y, j2, i2) < v.r && !open(v, i2, j2, t)) { hits[v.kind]++; worst.add(`${v.kind} ${v.kind === 'column' ? `c${v.a}` : v.p}/${v.j} × ${i2}/${j2}`); }
      }
      for (let wi = vi + 1; wi < verts.length; wi++) {
        const w = verts[wi];
        if (w.j === v.j) continue;
        if (w.hi < v.lo || w.lo > v.hi) continue;
        if (v.kind === 'column' && w.kind === 'column' && v.a === 0 && w.a === 0) continue; // (étoile)
        const r = v.kind === 'column' && w.kind === 'column' ? 2 * SHOE_R : v.r + w.r;
        if (v.kind === 'vertical' && w.kind === 'vertical' && Math.hypot(x - at[wi][0], y - at[wi][1]) < 1e-9) continue; // (concentriques)
        if (Math.hypot(x - at[wi][0], y - at[wi][1]) < r && !openPair(v, w, t)) { hits.pair++; worst.add(`pair ${v.kind}${v.p ?? `c${v.a}`}/${v.j} × ${w.kind}${w.p ?? `c${w.a}`}/${w.j}`); }
      }
    });
    for (let i = 1; i < n; i++) for (let j = 0; j < N; j++) for (let i2 = 1; i2 < n; i2++) for (let j2 = 0; j2 < N; j2++) {
      if (j2 === j || (i2 * N + j2) <= (i * N + j) || lv(i, j) !== lv(i2, j2)) continue;
      // deux dalles au même niveau : barres, contrepoids et roues de l'une contre l'autre
      const a = seg[j][i], tr = trains[i + 1];
      const pts = [[a[0], a[1], cwR(i)]];
      for (let q = 0; q <= 16; q++) pts.push([a[0] + ((a[2] - a[0]) * q) / 16, a[1] + ((a[3] - a[1]) * q) / 16, barW[i] / 2]);
      if (tr) for (const g of tr.gears) pts.push([piv[j][2 * i] + a[4] * g.x, piv[j][2 * i + 1] + a[5] * g.x, g.r + tr.m]);
      if (pts.some(([x, y, r]) => slabDist(x, y, j2, i2) < r)) { hits.slab++; worst.add(`slab ${i}/${j} × ${i2}/${j2}`); }
    }
  }
  const nPortals = D.portals ? D.portals.flat().reduce((a, x) => a + x.length, 0) : 0;
  return { hits, pairs: worst.size, samples: S, portals: nPortals, sample: [...worst].slice(0, 4) };
}

if (process.argv[1]?.endsWith('collide.mjs')) {
  let tot = 0, bad = 0;
  for (let sd = first; sd < first + count; sd++) {
    const r = search(String(sd), { maxAttempts: 24, over: { maxArms: 14, ...(forceN && { N: forceN, sym: null }) } });
    if (!r.ok) continue;
    const o = r.orbit, k = 1 / o.info.size;
    const coef = Float64Array.from(o.coef, (v) => v * k);
    const epi = epicycles(coef, o.params, 1, { tol: ARM_TOL, max: 14 });
    const t0 = performance.now();
    const D = designMachine(epi.arms, o.params.N);
    const ms = performance.now() - t0;
    const c = check(D);
    tot++;
    const nh = c.hits.vertical + c.hits.column + c.hits.slab + c.hits.pair;
    if (nh) bad++;
    const levels = Math.round(D.height / SLAB);
    console.log(`${sd}\tN=${o.params.N}\tbras=${D.n}\tniveaux=${levels}\tgalets=${D.supported}/${D.n}\tconception ${ms.toFixed(0)} ms\tportails=${c.portals}\tcoll(design)=${D.collisions.toFixed(4)}\tpénétrations=${nh} (${c.samples} instants)\t${JSON.stringify(c.hits)}\t${c.sample.join(' ; ')}`);
  }
  console.log(`\n${bad}/${tot} machines avec pénétrations`);
}
