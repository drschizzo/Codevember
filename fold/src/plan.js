// Plan d'une boucle : où et quand tombent les gouttes, où frappe le marteau,
// ce que chaque stimulus atteint, et la carte du temps du film.
//
// Module pur (sans three.js) : calculé dans le worker, vérifié par les tests.
//
// Tout est calculé sur la vraie géométrie :
// - l'affaissement permis de chaque pétiole : la plus grande chute (rebond
//   compris) qui ne fait toucher la feuille, ouverte ou fermée, à aucune
//   autre feuille, ni à une tige, ni au pot, ni à la terre ;
// - la goutte : elle tombe à la verticale ; son centre, au contact, est à la
//   hauteur où sa sphère touche pour la première fois un point de la surface
//   de la plante (folioles, rachis, pétioles, tiges, fleurs) ; c'est la
//   foliole qui porte ce point qui est frappée ;
// - les éclaboussures : des perles balistiques (g vraie) dont la trajectoire
//   ne frôle aucune partie de la plante ; elles se posent sur la terre
//   (tache humide), la lèvre du pot, la soucoupe ou la table ;
// - le marteau : bras pivotant ; l'angle du contact est celui où la surface de
//   la tête touche le profil du pot (ou du socle), par dichotomie.
import { createRng } from './rng.js';
import { makeGrid } from './grid.js';
import { createPoser, applyM } from './pose.js';
import { leafletPoint, leafPoints, v3, ORGANS, foldPoint, foldAngle, fullPoint, petiolePoint } from './gen/plant.js';
import { propagate, buildTimeMap, closeDur, G, SIGNAL, kineticsOf } from './physio.js';
import { outerRadius, profileDistance, tapProfile, caseBars, outerAt, floorRadius } from './container.js';
import { azSchedule, filmTime } from './camera.js';
import { hammerLayout, hammerProbes, HAMMER } from './apparatus.js';

const { sqrt, sin, cos, max, min, abs, hypot, PI } = Math;

// points de surface de la plante au repos (tous ouverts) ; tag : { kind, … }
export function surfacePoints(plant, poser, { du = 8, dv = 3 } = {}) {
  const pts = [];
  const o = poser.update(-1e9); // (aucun événement : plante ouverte)
  const tagOf = new Map();
  poser.pairs.forEach((q, k) => {
    const fold = poser.pinnae[q.pinna].P.fold;
    if (q.full) {
      // limbe d'un seul tenant, ouvert (trèfle, dionée)
      const M = o.left.subarray(k * 12, k * 12 + 12), th = foldAngle(fold, 0);
      for (let i = 0; i <= du; i++) for (let j = 0; j <= 2 * dv; j++) {
        const u = 0.04 + (0.96 * i) / du, v = -1 + j / dv;
        pts.push([applyM(M, foldPoint(fullPoint(fold.shape, u, v), th)), { kind: 'leaflet', pair: k, side: v >= 0 ? 1 : -1, leaf: q.leaf, pinna: poser.pinnae[q.pinna].pi }]);
      }
      return;
    }
    for (const [side, arr] of [[1, o.left], [-1, o.right]]) {
      const M = arr.subarray(k * 12, k * 12 + 12);
      const tag = { kind: 'leaflet', pair: k, side, leaf: q.leaf, pinna: poser.pinnae[q.pinna].pi };
      for (let i = 0; i <= du; i++) for (let j = 0; j <= dv; j++) {
        const u = 0.04 + (0.96 * i) / du, v = -1 + (2 * j) / dv;
        pts.push([applyM(M, leafletPoint(u, v)), tag]);
      }
    }
  });
  poser.pinnae.forEach((p, j) => {
    const M = o.rachis.subarray(j * 12, j * 12 + 12);
    for (let i = 0; i <= 12; i++) pts.push([applyM(M, [i / 12, 0, (p.P.sag ?? 0) * (i / 12) ** 2]), { kind: 'rachis', leaf: p.L.id }]);
  });
  plant.leaves.forEach((L) => { for (let i = 0; i <= 10; i++) pts.push([petiolePoint(L, i / 10), { kind: 'petiole', leaf: L.id }]); });
  plant.stems.forEach((S, si) => S.pts.forEach((p, i) => { pts.push([p, { kind: 'stem', r: S.rad[i] }]); }));
  for (const F of plant.flowers) { for (let i = 0; i < 40; i++) { const d = fib(i, 40); pts.push([v3.add(F.head, v3.mul(d, F.r)), { kind: 'flower' }]); } for (let i = 0; i <= 5; i++) pts.push([v3.add(F.base, v3.mul(F.dir, (F.len * i) / 5)), { kind: 'peduncle' }]); }
  for (const Pd of plant.pods) for (let i = 0; i <= 8; i++) pts.push([v3.add(Pd.head, v3.mul(Pd.dir, (Pd.len * i) / 8)), { kind: 'pod' }]);
  return pts;
}
const fib = (i, n) => { const y = 1 - (2 * (i + 0.5)) / n, r = sqrt(1 - y * y), t = i * 2.39996323; return [r * cos(t), y, r * sin(t)]; };

// ── Affaissement permis de chaque pétiole ────────────────────────────────────
export function limitDroop(plant, S) {
  const grid = makeGrid(0.06);
  const order = [...plant.leaves].sort((a, b) => a.base[1] - b.base[1]);
  const pointsOf = (L, fl, fp, dp) => { const a = leafPoints(L, fl, fp, dp, true), out = []; for (let i = 0; i < a.length; i += 3) out.push([a[i], a[i + 1], a[i + 2]]); return out; };
  // toutes les feuilles, ouvertes et fermées sans affaissement
  for (const L of plant.leaves) for (const [fl, fp] of [[0, 0], [1, 1]]) for (const p of pointsOf(L, fl, fp, 0)) grid.add(p, L.id);
  // tiges, fleurs, gousses : une grille à part (rayon propre à chaque point)
  const solid = makeGrid(0.06);
  plant.stems.forEach((St) => St.pts.forEach((p, i) => solid.add(p, St.rad[i])));
  for (const F of plant.flowers) for (let i = 0; i < 30; i++) solid.add(v3.add(F.head, v3.mul(fib(i, 30), F.r)), 0.005);
  for (const Pd of plant.pods) for (let i = 0; i <= 6; i++) solid.add(v3.add(Pd.head, v3.mul(Pd.dir, (Pd.len * i) / 6)), 0.03);
  const clear = (L, dp) => {
    // (le pétiole ne tombe que folioles et pinnules fermées : voir delayP)
    for (const [fl, fp] of [[1, 1], [0.97, 0.97]]) {
      for (const p of pointsOf(L, fl, fp, dp)) {
        if (grid.any(p, 0.022, (tag) => tag === L.id)) return false;
        // terre, pot, table, parois
        const rho = hypot(p[0], p[2]);
        if (rho < S.rimR + 0.03 && p[1] < S.rimY + 0.04) return false;
        if (rho >= S.rimR + 0.03 && p[1] < S.rimY && rho < outerRadius(S, p[1]) + 0.04) return false;
        if (p[1] < S.tableY + 0.05) return false;
        if (S.inside && !S.inside(p[0], p[1] + 0.04, p[2])) return false;
        for (const q of solid.near(p, 0.055)) { const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2]; if (dx * dx + dy * dy + dz * dz < (q[3] + 0.02) ** 2) return false; }
      }
    }
    return true;
  };
  const OVER = 1.22; // (dépassement du rebond, voir KINETICS.petiole)
  for (const L of order) {
    // dichotomie sur la part de droopMax (le rebond compris)
    let lo = 0, hi = 1;
    if (clear(L, OVER)) lo = 1;
    else for (let i = 0; i < 7; i++) { const m = 0.5 * (lo + hi); if (clear(L, m * OVER) && clear(L, m * OVER * 0.5)) lo = m; else hi = m; }
    L.droop = L.droopMax * lo;
    L.droopFrac = lo;
    // une fois affaissée, elle compte pour les suivantes
    if (lo > 0) for (const p of pointsOf(L, 1, 1, lo * OVER)) grid.add(p, L.id);
  }
}

// ── Plan ─────────────────────────────────────────────────────────────────────
// spec : { seed, events: [{ cause: 'drop' | 'tap', source }], duration (s de
// film), spacing (s physiques entre deux événements), signal }
export function planLoop(plant, S, spec) {
  const rng = createRng(`${spec.seed}:plan`);
  limitDroop(plant, S);
  const poser = createPoser(plant);
  const pts = surfacePoints(plant, poser, { du: 12, dv: 4 });
  const grid = makeGrid(0.05);
  for (const [p, tag] of pts) grid.add(p, tag);
  // barreaux de la caisse de Ward : obstacles pour la vue, la goutte, les perles
  for (const [a, b, r] of caseBars(S)) {
    const n = Math.ceil(v3.len(v3.sub(b, a)) / 0.025);
    for (let i = 0; i <= n; i++) grid.add(v3.lerp(a, b, i / n), { kind: 'frame', r });
  }
  const leafletPts = pts.filter(([, t]) => t.kind === 'leaflet');
  const top = pts.reduce((m, [p]) => max(m, p[1]), -Infinity);
  const K = spec.events.length;
  const P = K * spec.spacing;
  const sig = spec.signal ?? SIGNAL;
  const events = [];
  const used = new Set();
  let burette = null, hammerAz = null; // (un seul statif, un seul marteau par scène)

  spec.events.forEach((ev, k) => {
    const tc = (k + 0.3) * spec.spacing;
    const re = rng.fork(`ev${k}`);
    if (ev.cause === 'drop') {
      const r = re.range(0.014, 0.02);
      // candidats : centres de folioles du haut de la touffe, loin des feuilles déjà visées
      let best = ev.source === 'burette' && burette ? burette.target : null;
      for (let tries = 0; tries < 400 && !best; tries++) {
        const [c, tag] = re.pick(leafletPts);
        if (c[1] < top - 0.9 || used.has(tag.leaf)) continue;
        const hit = grid.columnMax(c[0], c[2], r);
        if (!hit || hit.q[3].kind !== 'leaflet') continue;
        const yc = hit.yc;
        // source : le toit (condensation) ou le bec d'une burette
        let srcY;
        if (ev.source === 'roof') { srcY = S.roofY(c[0], c[2]); if (!(srcY > yc + 0.35)) continue; srcY -= r; }
        else srcY = Math.max(yc + re.range(0.5, 0.8), top + 0.25) - r;
        // la colonne au-dessus est libre (burette : rayon du tube)
        const clearR = ev.source === 'roof' ? r + 0.01 : 0.075;
        if (grid.columnMax(c[0], c[2], clearR)?.yc > yc + 0.02 + (clearR - r)) continue;
        best = { x: c[0], z: c[2], yc, tag: hit.q[3], contact: [hit.q[0], hit.q[1], hit.q[2]], srcY };
      }
      if (!best) { events.push(tapEvent(k, tc, re)); return; }
      // contact recalculé sur une surface fine, autour du point visé (folioles,
      // rachis, pétioles proches) : l'écart à l'instant du choc est nul
      if (!best.fine) {
        const fineAll = surfacePoints(plant, poser, { du: 56, dv: 24 }); // (plus fin que le test : aucun point de la surface n'échappe au contact)
        const fg = makeGrid(0.05);
        for (const [p, tag] of fineAll) if (Math.hypot(p[0] - best.x, p[2] - best.z) < r + 0.05) fg.add(p, tag);
        const hit = fg.columnMax(best.x, best.z, r);
        if (hit) { best.srcY += hit.yc - best.yc; best.yc = hit.yc; best.contact = [hit.q[0], hit.q[1], hit.q[2]]; best.tag = hit.q[3].kind === 'leaflet' ? hit.q[3] : best.tag; }
        best.fine = true;
      }
      used.add(best.tag.leaf);
      if (ev.source === 'burette' && !burette) {
        // statif posé sur la table, hors de la touffe, sur le côté du regard
        // (la burette est vue de profil, la tige du statif ne passe jamais
        // entre la caméra et la plante), bras au-dessus de tout
        const tip = [best.x, best.srcY + r * 0.9, best.z];
        const vw = chooseView({ cause: 'drop', contact: best.contact, leaf: best.tag.leaf, pinna: best.tag.pinna }, spec.view ?? { az: 0, el: 0.12, close: 2.3 }, grid, plant, S);
        const reach = Math.max(S.rimR, extent(pts)) + 0.45;
        const sides = [vw.az + PI / 2, vw.az - PI / 2].map((a) => [cos(a), 0, sin(a)]);
        // le côté le plus dégagé (le moins de plante entre la tige et l'axe)
        const free = (d) => { let n = 0; for (let k2 = 1; k2 < 12; k2++) if (grid.any([d[0] * reach * k2 / 12, top * 0.5, d[2] * reach * k2 / 12], 0.2)) n++; return n; };
        const out = free(sides[0]) <= free(sides[1]) ? sides[0] : sides[1];
        let stand = [best.x + out[0] * reach, S.tableY, best.z + out[2] * reach];
        // le socle (orienté vers le pot, 0,2 u de demi-longueur) reste hors de la
        // soucoupe, du socle tourné ou de la caisse
        const rs = Math.hypot(stand[0], stand[2]), need = floorRadius(S) + 0.25;
        if (rs < need) stand = [(stand[0] / rs) * need, S.tableY, (stand[2] / rs) * need];
        burette = { target: best, tip, stand, tableY: S.tableY, armY: Math.max(top + 0.22, tip[1] + 0.45) };
      }
      const h = best.srcY - best.yc;
      const fall = sqrt((2 * h) / G);
      const pair = poser.pairs[best.tag.pair];
      // une goutte ferme TOUTE la feuille touchée, et elle seule : la vague
      // part du point d'impact et parcourt la feuille (lisible, entière)
      const Sg = 3;
      const { arr, amp } = propagate(plant.graph, pair.node, Sg, sig);
      const hit = plant.leaves[best.tag.leaf];
      const inLeaf = new Set([hit.nodeP, hit.nodeS, ...hit.pinnae.flatMap((Pn) => Pn.pairs.map((q) => q.node))]);
      for (let i = 0; i < amp.length; i++) if (!inLeaf.has(i)) { amp[i] = 0; arr[i] = Infinity; }
      if (hit.droopMax > 0) amp[hit.nodeP] = Math.max(amp[hit.nodeP], sig.threshold.petiole + 0.01);
      const delayP = settleLeaves(plant, arr, amp, sig);
      const E = {
        delayP,
        cause: 'drop', source: ev.source, tc, r, axis: [best.x, best.z], yc: best.yc, contact: best.contact, srcY: best.srcY,
        fall, grow: ev.source === 'roof' ? 160 : 2.2, leaf: best.tag.leaf, pinna: best.tag.pinna, pair: best.tag.pair, sideObj: best.tag.side,
        impulse: (r / 0.017) ** 3, strength: Sg, arr: Array.from(arr, (x) => (Number.isFinite(x) ? x : 1e9)), amp: Array.from(amp),
      };
      E.splash = splash(E, re, grid, S);
      events.push(E);
    } else events.push(tapEvent(k, tc, re));
  });

  function tapEvent(k, tc, re, pref = []) {
    // azimut : le marteau ne touche aucune partie de la plante ; on essaie
    // d'abord ceux qui le montrent de profil à la caméra (pref)
    const prof = tapProfile(S);
    let az = hammerAz ?? 0, ok = hammerAz != null;
    for (let tries = 0; tries < 24 + pref.length && !ok; tries++) {
      az = tries < pref.length ? pref[tries] : S.case ? (re.chance(0.5) ? PI / 2 : -PI / 2) : re.range(0, 2 * PI);
      if (S.case) az = Math.sin(az + 0.001) >= 0 ? PI / 2 : -PI / 2;
      const dir = [cos(az), 0, sin(az)];
      ok = true;
      // (loin du statif de la burette)
      if (burette && Math.hypot(burette.stand[0] - dir[0] * 1.0, burette.stand[2] - dir[2] * 1.0) < 0.7) ok = false;
      for (let d = 0; d < 1.2 && ok; d += 0.05) for (const y of [S.tableY + 0.2, S.tableY + 0.6, S.tableY + 1.0]) {
        const rho0 = S.case ? S.case.D : max(...prof.map((q) => q[0]));
        const p = v3.add(v3.mul(dir, rho0 + 0.05 + d), [0, y, 0]);
        if (grid.any(p, 0.15)) ok = false;
      }
    }
    hammerAz = az;
    const dir = [cos(az), 0, sin(az)];
    // (le profil réel à cet azimut : le relief du pot compris)
    const profAz = S.plinth || S.case ? prof : outerAt(S, az);
    // hauteur frappée
    // géométrie du marteau : on cherche la hauteur de frappe et l'inclinaison du
    // bras pour lesquelles TOUT l'appareil reste hors du pot pendant toute la
    // course — la tête (rayon rh) ne touche qu'au coup, le bras (une tige) et
    // la bobine ne frôlent jamais la lèvre ni le relief
    const yLo = prof[0][1], yHi = prof[prof.length - 1][1];
    const rh = 0.055, arm = 0.5, armR = HAMMER.armR, strike = 0.2;
    const solve = (frac, aC0) => {
      const yh = yLo + frac * (yHi - yLo);
      const rhoW = S.case ? S.case.D : outerRadius({ outer: profAz }, yh);
      const pivot = [rhoW + rh - arm * sin(aC0), yh + arm * cos(aC0)];
      const headAt = (a) => [pivot[0] + arm * sin(a), pivot[1] - arm * cos(a)];
      // (distance signée : négative dans la matière du pot)
      const inside = (r, y) => !S.case && y > yLo && y < yHi && r < outerRadius({ outer: profAz }, y);
      const gap = (a) => { const h = headAt(a); const d = profileDistance(profAz, h[0], h[1]); return (inside(h[0], h[1]) ? -d : d) - rh; };
      let lo = aC0 - 0.15, hi = aC0 + 0.6;
      if (!(gap(hi) > 0) || gap(lo) > 0) return null;
      for (let i = 0; i < 80; i++) { const m = 0.5 * (lo + hi); if (gap(m) > 0) hi = m; else lo = m; }
      const thetaC = hi, rest = thetaC + 0.62;
      for (let k = 1; k <= 24; k++) {
        const a = thetaC + ((rest - thetaC) * k) / 24;
        if (gap(a) <= 0) return null; // (la tête toucherait ailleurs avant)
      }
      for (let k = 0; k <= 24; k++) {
        const a = thetaC + ((rest - thetaC) * k) / 24, h = headAt(a);
        for (let j = 0; j <= 20; j++) {
          const t = (j / 20) * (1 - (rh * 0.9) / arm);
          const x = pivot[0] + (h[0] - pivot[0]) * t, y = pivot[1] + (h[1] - pivot[1]) * t;
          if (inside(x, y) || profileDistance(profAz, x, y) < armR + 0.01) return null;
        }
      }
      // colonne, potence, équerre, électroaimant (voir apparatus.js) : hors du pot
      const Hx = { pivot, arm, rest };
      for (const [x, y, r] of hammerProbes(Hx, S.tableY)) if (inside(x, y) || profileDistance(profAz, x, y) < r + 0.015) return null;
      // le socle (centré sous la colonne) : hors de la soucoupe
      if (!S.case && hammerLayout(Hx).plateRho - HAMMER.plate[0] < floorRadius(S) + 0.04) return null;
      return { yh, pivot, thetaC, rest };
    };
    let geo = null;
    for (const frac of S.plinth || S.case ? [0.5] : [0.62, 0.55, 0.48, 0.4, 0.32, 0.7]) {
      // (pivot à l'extérieur du pot : au coup, le bras penche vers lui)
      for (const aC0 of [-0.12, -0.22, -0.32, -0.45, -0.6, 0.1]) { geo = solve(frac, aC0); if (geo) break; }
      if (geo) break;
    }
    if (!geo) throw new Error('marteau : aucune position ne dégage le pot');
    const { yh, pivot, thetaC, rest } = geo;
    // le coup ferme TOUTE la plante, de bas en haut
    const Sg = 4;
    const { arr, amp } = propagate(plant.graph, plant.graph.root, Sg, sig);
    for (const L of plant.leaves) amp[L.nodeP] = Math.max(amp[L.nodeP], sig.threshold.petiole + 0.01);
    const delayP = settleLeaves(plant, arr, amp, sig);
    return {
      delayP,
      cause: 'tap', tc, az, dir, hammer: { tc, pivot, arm, rh, rest, thetaC, strike, acc: (2 * (rest - thetaC)) / (strike * strike), yh },
      shake: { A: re.range(0.6, 1.0) * (PI / 180), f: 4.2, zeta: 0.12 }, strength: Sg,
      arr: Array.from(arr, (x) => (Number.isFinite(x) ? x : 1e9)), amp: Array.from(amp),
    };
  }

  // points de vue : la caméra voit le contact (et la chute au-dessus), sans
  // feuille entre elles ; le marteau est vu de profil
  const V = spec.view ?? { az: 0, el: 0.12, close: 2.3, wide: 5 };
  // la caméra fait un tour par boucle dans un seul sens (camera.js) ; on
  // cherche le départ az0 pour lequel chaque toucher est vu sans obstacle,
  // puis, à l'azimut où sera la caméra, la hauteur et la distance du plan
  const windowsTmp = events.map((E) => {
    const pre = E.cause === 'drop' ? E.fall + 0.9 : E.hammer.strike + 0.9;
    return { a: E.tc - pre, b: E.tc + 6, slow: E.tc };
  });
  const tm = buildTimeMap({ P, T: spec.duration ?? 40, windows: windowsTmp, samples: 2048 });
  const rot = spec.rot ?? 1;
  let bestCam = null;
  for (let i = 0; i < 24; i++) {
    const az0 = V.az + (i * PI) / 12;
    const az = azSchedule(tm, windowsTmp, az0, rot);
    const views = events.map((E) => chooseView(E, { ...V, az: az(filmTime(tm, E.tc) / tm.T) }, grid, plant, S));
    // un pli en V (dionée, trèfle) se lit dans l'axe de la nervure, depuis la
    // pointe : on préfère le départ qui place la caméra devant les limbes
    let score = views.reduce((n, v) => n + (v.clear ? 1 : 0), 0);
    events.forEach((E, k) => {
      if (E.cause !== 'drop') return;
      const Pn = plant.leaves[E.leaf].pinnae[E.pinna];
      if (!Pn.fold) return;
      const t = v3.norm([Pn.dir0[0], 0, Pn.dir0[2]]), a = views[k].az;
      score += 0.9 * Math.max(0, cos(a) * t[0] + sin(a) * t[2]);
    });
    if (!bestCam || score > bestCam.score) bestCam = { score, az0, views };
  }
  events.forEach((E, k) => { E.view = bestCam.views[k]; });
  // le marteau, placé maintenant qu'on sait d'où la caméra le verra : de profil
  const azFinal = azSchedule(tm, windowsTmp, bestCam.az0, rot);
  events.forEach((E, k) => {
    if (E.cause !== 'tap') return;
    const ca = azFinal(filmTime(tm, E.tc) / tm.T);
    hammerAz = null;
    const N = tapEvent(k, E.tc, rng.fork(`tap${k}`), [ca + PI / 2, ca - PI / 2, ca + PI / 3, ca - PI / 3]);
    N.view = chooseView(N, { ...V, az: ca }, grid, plant, S);
    events[k] = N;
  });
  // fenêtres de temps réel : de la chute (ou de l'élan du marteau) à la fin de la vague
  const T = SIGNAL.threshold;
  const windows = events.map((E) => {
    let wave = 0;
    for (const L of plant.leaves) {
      if (E.amp[L.nodeP] >= T.petiole) wave = max(wave, E.arr[L.nodeP] + (E.delayP[L.id] ?? 0) + closeDur('petiole', kineticsOf(plant.family)) * 0.6);
      if (E.amp[L.nodeS] >= T.pinna) wave = max(wave, E.arr[L.nodeS] + closeDur('pinna', kineticsOf(plant.family)));
      for (const Pn of L.pinnae) for (const q of Pn.pairs) if (E.amp[q.node] >= T.leaflet) wave = max(wave, E.arr[q.node] + closeDur('leaflet', kineticsOf(plant.family)));
    }
    E.wave = min(wave, 9);
    const pre = E.cause === 'drop' ? E.fall + 0.9 : E.hammer.strike + 0.9;
    // (la fin de la vague passe dans la montée de l'accéléré)
    // le pli au ralenti : la dionée claque en 0,2 s (filmée à ×10), la vague
    // de la sensitive à ×3, le trèfle et le Biophytum à ×2, le marteau à ×1,8
    const F = { dionaea: [10, 0.45], sensitive: [3, 2.6], biophytum: [2.5, 2.4], oxalis: [2, 3.2] }[plant.family] ?? [2, 2.5];
    const [foldK, foldDur] = E.cause === 'tap' ? [1.8, 3.5] : F;
    return { a: E.tc - pre, b: E.tc + Math.min(E.wave, E.cause === 'tap' ? 6.5 : 4.5), slow: E.tc, foldK, foldDur };
  });
  return { events, windows, P, top, K, burette, cam: { az0: bestCam.az0, rot } };
}

// Une feuille dont le pétiole tombe a d'abord fermé ses pinnules et ses
// folioles : on les fait répondre (amplitude au seuil, arrivée par le chemin
// le plus court depuis le pulvinus primaire), et le pulvinus primaire ne
// part que lorsque la dernière foliole de la feuille est fermée.
function settleLeaves(plant, arr, amp, sig) {
  const T = sig.threshold, delayP = {};
  for (const L of plant.leaves) {
    if (!(amp[L.nodeP] >= T.petiole)) continue;
    const a0 = arr[L.nodeP];
    const aS = Math.min(arr[L.nodeS], a0 + L.pet / sig.speed[ORGANS.petiole]);
    arr[L.nodeS] = aS; amp[L.nodeS] = Math.max(amp[L.nodeS], T.pinna + 0.01);
    let last = aS + closeDur('pinna', kineticsOf(plant.family));
    for (const Pn of L.pinnae) for (const q of Pn.pairs) {
      const a = Math.min(arr[q.node], aS + (q.s * Pn.len) / sig.speed[ORGANS.rachis]);
      if (!Number.isFinite(a)) continue;
      arr[q.node] = a; amp[q.node] = Math.max(amp[q.node], T.leaflet + 0.01);
      last = Math.max(last, a + closeDur('leaflet', kineticsOf(plant.family)));
    }
    delayP[L.id] = last - a0 + 0.25;
    if (!(L.droopMax > 0)) amp[L.nodeP] = 0; // (rosettes : pas de pétiole qui tombe)
  }
  return delayP;
}

// ligne de vue libre entre a et b (rayon r), hors des points ignorés
function sightClear(grid, a, b, r, skip) {
  const d = v3.sub(b, a), L = v3.len(d), n = Math.ceil(L / 0.03);
  for (let i = 2; i < n - 1; i++) { const p = v3.add(a, v3.mul(d, i / n)); if (grid.any(p, r, skip)) return false; }
  return true;
}
function chooseView(E, V, grid, plant, S) {
  const az = V.az;
  const tan2 = Math.tan(((V.fov ?? 34) * PI) / 360);
  const fit = (R) => R / tan2;
  if (E.cause === 'drop') {
    const c = E.contact, above = [c[0], c[1] + 0.25, c[2]];
    const L = plant.leaves[E.leaf];
    // ce qui se plie, en grand : la feuille entière (trèfle, dionée) ou la
    // pinnule touchée (sensitive, Biophytum : sa fermeture en fermeture éclair)
    let lp = leafPoints(L, 0, 0, 0);
    if (!L.pinnae[0].fold && L.pinnae.length > 1) {
      const Pn = L.pinnae[E.pinna], t = Pn.dir0, out = [];
      for (let k = 0; k <= 10; k++) { const q = v3.add(L.tip, v3.mul(t, (k / 10) * Pn.len)); out.push(q[0], q[1], q[2]); }
      lp = out;
    }
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < lp.length; i += 3) { cx += lp[i]; cy += lp[i + 1]; cz += lp[i + 2]; }
    const n = lp.length / 3, cen = [cx / n, cy / n, cz / n];
    let R = 0.2; for (let i = 0; i < lp.length; i += 3) R = max(R, hypot(lp[i] - cen[0], lp[i + 1] - cen[1], lp[i + 2] - cen[2]));
    const skip = (tag) => (tag.kind === 'leaflet' || tag.kind === 'rachis') && tag.leaf === E.leaf;
    // (au-dessus du plan de la foliole : on voit la goutte arriver sur sa face
    // supérieure ; dans une caisse de Ward, par une vitre de côté)
    // (une rosette basse — la dionée — se regarde d'en haut, vers son cœur)
    const low = plant.family === 'dionaea' ? 0.22 : 0; // (d'en haut, mais pas à la verticale : un plan, pas un schéma)
    const els = (S.case ? [V.el + 0.12, V.el + 0.04, V.el + 0.2, V.el - 0.04] : [V.el + 0.28, V.el + 0.2, V.el + 0.38, V.el + 0.12, V.el + 0.5]).map((e) => e + low);
    for (const el of els) {
      const dir = [cos(az) * cos(el), sin(el), sin(az) * cos(el)];
      // (gros plan : à l'échelle de la feuille — une dionée se filme de plus près)
      let d0 = Math.min(max(1.4, V.close), max(0.95, fit(R * 0.9)));
      while (S.inside && S.inside(...v3.add(c, v3.mul(dir, d0 - 0.15))) && d0 < 6) d0 += 0.05;
      const cam = v3.add(c, v3.mul(dir, d0));
      if (S.case && cam[1] > S.case.eave - 0.12) continue;
      // (les montants d'une caisse : ni sur l'axe, ni dans le champ autour du contact)
      const side = v3.mul(v3.norm(v3.cross(dir, [0, 1, 0])), 0.3);
      const frameFree = [c, v3.add(c, side), v3.sub(c, side), above].every((q) => sightClear(grid, cam, q, 0.08, (t) => t.kind !== 'frame'));
      if (sightClear(grid, cam, c, 0.018, skip) && sightClear(grid, cam, above, 0.02, skip) && frameFree) {
        // plan principal : toute la feuille, d'un peu plus haut, au plus 2,5 fois plus loin
        const d1 = Math.min(d0 * 2.2, max(d0 * 1.2, fit(R * 0.95))); // (la feuille qui se plie remplit l'image)
        return { clear: true, az, el: el + 0.06, dist: d1, target: cen, start: { target: [c[0], c[1] + 0.05, c[2]], dist: d0, el } };
      }
    }
    const d0 = 1.6;
    return { clear: false, az, el: V.el + 0.35, dist: 2.6, target: cen, start: { target: [c[0], c[1] + 0.05, c[2]], dist: d0, el: V.el + 0.35 } };
  }
  // marteau : vu à l'azimut de la caméra ; plan principal sur toute la plante
  const Hm = E.hammer, head = [E.dir[0] * (Hm.pivot[0] + Hm.arm * sin(Hm.thetaC)), Hm.pivot[1] - Hm.arm * cos(Hm.thetaC), E.dir[2] * (Hm.pivot[0] + Hm.arm * sin(Hm.thetaC))];
  const el = V.el + 0.08;
  const need = fit((plant.H - S.tableY) * 0.62);
  const dist = Math.min(max(V.wide, need), 6.5);
  const target = [0, (plant.H + S.tableY) * 0.47, 0];
  const cam = v3.add(head, v3.mul([cos(az) * cos(el + 0.12), sin(el + 0.12), sin(az) * cos(el + 0.12)], 2.4));
  // (le coup se lit à deux : la tête et le pot qu'elle frappe, la plante au-dessus —
  // jamais l'appareil seul dans le vide)
  const t0 = [head[0] * 0.55, head[1] + 0.25, head[2] * 0.55];
  return { clear: sightClear(grid, cam, head, 0.03), az, el, dist, target, start: { target: t0, dist: Math.max(2.8, dist / 1.8), el: el + 0.1 } };
}

const extent = (pts) => pts.reduce((m, [p]) => max(m, hypot(p[0], p[2])), 0);

// ── Éclaboussures ────────────────────────────────────────────────────────────
function splash(E, re, grid, S) {
  const out = [];
  const n = re.int(5, 9);
  const p0 = [E.contact[0], E.contact[1] + 0.004, E.contact[2]];
  for (let i = 0; i < n; i++) {
    for (let tries = 0; tries < 400; tries++) {
      const az = re.range(0, 2 * PI), el = re.range(0.15, 1.2), sp = re.range(2.5, 9) * (E.r / 0.017);
      const v = [cos(az) * cos(el) * sp, sin(el) * sp, sin(az) * cos(el) * sp];
      const r = re.range(0.0035, 0.0075);
      const land = fly(p0, v, r, grid, S, E);
      if (land) { out.push({ p0, v, r, ...land }); break; }
    }
  }
  return out;
}
function fly(p0, v, r, grid, S, E) {
  const dt = 0.002;
  for (let t = dt; t < 0.6; t += dt) {
    const p = [p0[0] + v[0] * t, p0[1] + v[1] * t - 0.5 * G * t * t, p0[2] + v[2] * t];
    // les premières millisecondes : on quitte la foliole frappée
    const skip = t < 0.012 ? (tag) => tag.kind === 'leaflet' && tag.leaf === E.leaf && tag.pinna === E.pinna : null;
    if (grid.any(p, r + 0.014, skip)) return null;
    // sous la source (burette) : jamais au-dessus du point de contact près de l'axe
    if (p[1] > E.yc + 0.03 && hypot(p[0] - E.axis[0], p[2] - E.axis[1]) < 0.09) return null;
    if (S.inside && !S.inside(p[0], p[1], p[2])) return null; // (contre la vitre)
    const rho = hypot(p[0], p[2]);
    const vy = v[1] - G * t;
    if (vy > 0) continue;
    if (rho < S.soilR && p[1] <= 0.045 + r * 0.5) return { t, land: [p[0], 0.045, p[2]], kind: 'soil' }; // (sur le paillage : elle s'y perd)
    if (rho >= S.soilR && rho <= S.rimR && p[1] <= S.rimY + r * 0.6) return { t, land: [p[0], S.rimY + r * 0.6, p[2]], kind: 'rim' };
    if (rho > S.rimR && p[1] < S.rimY && rho < outerRadius(S, p[1]) + r) return null; // (contre la paroi)
    const floorY = S.saucer && rho < S.saucer.r - 0.04 ? S.potBottom - S.saucer.h + 0.012 : S.plinth && rho < S.plinth.r ? S.tableY + S.plinth.h : S.case && abs(p[0]) < S.case.W && abs(p[2]) < S.case.D ? S.tableY + S.case.base : S.tableY;
    if (p[1] <= floorY + r * 0.6) return { t, land: [p[0], floorY + r * 0.6, p[2]], kind: 'table' };
  }
  return null;
}


