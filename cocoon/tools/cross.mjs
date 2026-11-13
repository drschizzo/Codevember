// Banc de traversée (même critère que le test) : où et de combien
import { windCocoon } from '../src/gen/winding.js';
const fam = process.argv[2] || 'losange';
const spec = { family: fam, cage: { shape: 'ovoid', R: 0.13, hub: 0.024, ribs: 16, wire: 0.0016 }, band: { threads: 10, thread: 0.0016, gap: 1.05, width: 10 * 0.0016 * 1.05 }, wind: { c1: 0.55, n1: 8, c2: 0.3, ribs: 5, mu: 0.85, amp: 0.04, k: 1.15, passes: 2 }, grid: { ns: +(process.argv[3] || 512), np: 2 * +(process.argv[3] || 512) }, step: 0.003 };
const W = windCocoon(spec), { P, nb, m, TS, TP, Hp: heights, d } = W;
const TAU = Math.PI * 2, wrap = (a) => a - TAU * Math.round(a / TAU);
const cp = d / P.hub, np = Math.ceil(TAU / cp), grid = new Map();
const def = [], where = new Array(10).fill(0), gapj = new Map();
let checked = 0;
for (let j = 0; j < m; j++) for (let k = 0; k < nb; k++) {
  const i = k * m + j, s = TS[i], ph = ((TP[i] % TAU) + TAU) % TAU, h = heights[i];
  const cs = Math.floor(s / d), cx = Math.floor(ph / cp);
  if (j % 3 === 0) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const L = grid.get(`${cs + a},${(cx + b + np) % np}`); if (!L) continue;
    for (const q of L) {
      if (j - q.j < 12) continue;
      const r = P.rAt((s + q.s) / 2), dd = Math.hypot(q.s - s, r * wrap(q.ph - ph));
      if (dd > 0.95 * d) continue;
      checked++;
      const need = Math.sqrt(d * d - dd * dd) - 0.15 * d;
      if (h - q.h < need) { def.push((need - (h - q.h)) / d); where[Math.min(9, Math.floor((s / P.len) * 10))]++; const g = Math.min(9999, j - q.j); const bucket = g < 30 ? '<30' : g < 100 ? '<100' : g < 400 ? '<400' : '≥400'; gapj.set(bucket, (gapj.get(bucket) || 0) + 1); }
    }
  }
  const kk = `${cs},${cx}`; if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push({ j, s, ph, h });
}
def.sort((a, b) => a - b);
console.log(fam, 'grille', spec.grid.ns, 'contrôlés', checked, 'fautes', def.length, 'déficit (× d) médian', def[def.length >> 1]?.toFixed(2), 'p90', def[Math.floor(def.length * 0.9)]?.toFixed(2), 'max', def[def.length - 1]?.toFixed(2));
console.log('   par dixième de σ', where.join(' '), ' écart en points', JSON.stringify(Object.fromEntries(gapj)));
