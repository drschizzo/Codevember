import { GROUPS, track, tileAt, elements, area, isSimple, applyIso, isoPow } from '../src/gen/tiling.js';
function inside(poly, x, y) { let c = false; const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) { const xi = poly[2*i], yi = poly[2*i+1], xj = poly[2*j], yj = poly[2*j+1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const group of ['p3', 'p4', 'p6']) {
  for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    const q = [0.34, 0.33, 0.33];
    const path = { legs: [{ a, b, q }, { a: b, b: a, q: [0.2 + 0.3 * rnd(), 0.3, 0.3] }] };
    for (const l of path.legs) { const s = l.q[0] + l.q[1] + l.q[2]; l.q = l.q.map((v) => v / s); }
    const profiles = [{ a1: 0.12, a2: 0.1 }, { a1: -0.1, a3: 0.06 }, { a2: 0.12 }];
    const tr = track(group, path);
    const els = elements(group, 6);
    let worstA = 0, simple = true, cover = 0, tot = 0, maxJump = 0;
    const pts = []; for (let i = 0; i < 300; i++) pts.push([(rnd() - 0.5) * 3, (rnd() - 0.5) * 3]);
    let prevMask = null;
    const N = 240;
    for (let k = 0; k <= N; k++) {
      const psi = k / N;
      const T = tileAt(group, path, tr, profiles, psi, 12);
      worstA = Math.max(worstA, Math.abs(Math.abs(area(T)) - 1));
      if (!isSimple(T)) simple = false;
      if (k % 12 === 0) {
        const tiles = els.map((g) => { const P = new Float64Array(T.length); for (let i = 0; i < T.length; i += 2) { const p = applyIso(g, [T[i], T[i+1]]); P[i] = p[0]; P[i+1] = p[1]; } return P; });
        for (const p of pts) { let c = 0; for (const P of tiles) if (inside(P, p[0], p[1])) c++; tot++; if (c === 1) cover++; }
      }
      // continuité : appartenance des points à l'alvéole suivie
      const mask = pts.map((p) => inside(T, p[0], p[1]));
      if (prevMask) { let ch = 0; for (let i = 0; i < mask.length; i++) if (mask[i] !== prevMask[i]) ch++; maxJump = Math.max(maxJump, ch); }
      prevMask = mask;
    }
    // relais : l'alvéole à ψ=1 est l'image de celle à ψ=0
    const T0 = tileAt(group, path, tr, profiles, 0, 12), T1 = tileAt(group, path, tr, profiles, 1 - 1e-9, 12);
    let d = 0; for (let i = 0; i < T0.length; i += 2) { const p = applyIso(tr.relay, [T0[i], T0[i+1]]); let m = 1e9; for (let j = 0; j < T1.length; j += 2) m = Math.min(m, Math.hypot(p[0]-T1[j], p[1]-T1[j+1])); d = Math.max(d, m); }
    const ang = Math.round(Math.atan2(tr.relay.s, tr.relay.c) * 180 / Math.PI);
    console.log(group, `portes ${a}-${b}`, 'aire±', worstA.toExponential(1), 'simple', simple, 'couverture', (cover / tot).toFixed(3), 'saut max', maxJump, '/300', 'relais', ang + '°', 'err', tr.relay.err.toExponential(1), 'écart', d.toExponential(1), 'éléments', els.length);
  }
}
