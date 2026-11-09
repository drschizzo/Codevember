// Banc d'essai du solveur : lance la recherche sur une plage de graines, en
// parallèle (un thread par cœur), et résume rendement, temps, variété et
// stabilité.
//
//   node tools/bench.mjs [première graine] [nombre] [fichier de sortie .json] [mode]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { search } from '../src/orbit/search.js';

if (!isMainThread) {
  parentPort.on('message', (seed) => {
    const r = search(seed, workerData);
    const o = r.orbit;
    parentPort.postMessage({
      seed, ok: r.ok, ms: r.ms, params: r.params,
      attempts: r.tries.length, reasons: r.tries.filter((t) => !t.ok).map((t) => t.reason),
      strategy: o?.strategy, mode: o?.mode,
      ...(o && {
        action: o.action, residual: o.residual, closure: o.closure, rho: o.rho, stable: o.stable,
        msAttempt: o.ms, msStability: o.msStability, ...o.info, coef: Array.from(o.coef),
      }),
    });
  });
} else {
  const first = Number(process.argv[2] ?? 0), count = Number(process.argv[3] ?? 200), out = process.argv[4], mode = process.argv[5];
  const threads = Math.max(1, availableParallelism() - 1);
  const seeds = Array.from({ length: count }, (_, i) => first + i);
  const results = [];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: threads }, () => new Promise((done) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { stability: true, maxAttempts: 24, over: { ...(mode && mode !== 'mixte' && { mode }), ...(process.env.ARMS && { maxArms: Number(process.env.ARMS) }) } } });
    const next = () => {
      const s = seeds.shift();
      if (s === undefined) { w.terminate(); done(); return; }
      w.postMessage(s);
    };
    w.on('message', (r) => { results.push(r); process.stderr.write(`\r${results.length}/${count}`); next(); });
    next();
  })));
  process.stderr.write('\n');
  results.sort((a, b) => a.seed - b.seed);
  if (out) writeFileSync(out, JSON.stringify(results));

  const pct = (a, b) => `${((100 * a) / Math.max(1, b)).toFixed(0)} %`;
  const q = (arr, f) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? NaN; };
  const ok = results.filter((r) => r.ok);
  const line = (label, rs) => {
    const g = rs.filter((r) => r.ok);
    console.log(`${label.padEnd(16)} ${String(rs.length).padStart(4)} graines · réussite ${pct(g.length, rs.length).padStart(5)}`
      + ` · temps médian ${(q(rs.map((r) => r.ms), 0.5) / 1000).toFixed(1)} s, p90 ${(q(rs.map((r) => r.ms), 0.9) / 1000).toFixed(1)} s`
      + ` · essais ${q(rs.map((r) => r.attempts), 0.5)}`);
  };
  console.log(`\n${count} graines en ${((Date.now() - t0) / 1000).toFixed(0)} s sur ${threads} threads\n`);
  line('toutes', results);
  for (const N of [3, 4, 5, 6, 7, 8, 9]) line(`N = ${N}`, results.filter((r) => r.params.N === N));
  line('plan', results.filter((r) => r.params.D === 2));
  line('espace', results.filter((r) => r.params.D === 3));
  line('ω = 0', results.filter((r) => r.params.omega === 0));
  line('ω ≠ 0', results.filter((r) => r.params.omega !== 0));

  const reasons = {};
  for (const r of results) for (const x of r.reasons) reasons[x] = (reasons[x] || 0) + 1;
  console.log('\nessais rejetés :', Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
  const strat = {};
  for (const r of ok) strat[r.strategy] = (strat[r.strategy] || 0) + 1;
  console.log('stratégies gagnantes :', JSON.stringify(strat));

  const sigs = new Set(ok.map((r) => r.sig));
  console.log(`\norbites valides ${ok.length} · distinctes ${sigs.size}`);
  // familles : même nombre de corps, mêmes croisements, mêmes trois harmoniques dominantes
  const fam = new Set(ok.map((r) => `${r.params.N}|${r.crossings}|${[...r.harmonics.slice(0, 3)].sort((a, b) => a - b)}`));
  line('avec symétrie', results.filter((r) => r.params.sym));
  line('sans symétrie', results.filter((r) => !r.params.sym));
  const z = ok.filter((r) => r.params.omega === 0);
  console.log(`familles ${fam.size} · sans rotation : ${z.length} orbites, ${new Set(z.map((r) => `${r.params.N}|${r.action.toFixed(2)}`)).size} distinctes`);
  const buckets = [[0, 0], [1, 1], [2, 3], [4, 7], [8, 1e9]];
  console.log('croisements :', buckets.map(([a, b]) => `${b > 1e8 ? `${a}+` : a === b ? a : `${a}–${b}`} : ${ok.filter((r) => r.crossings >= a && r.crossings <= b).length}`).join(' · '));
  const modes = {};
  for (const r of ok) modes[r.mode] = (modes[r.mode] || 0) + 1;
  console.log('modes gagnants :', JSON.stringify(modes));
  console.log(`stables (ρ < 1,01) : ${ok.filter((r) => r.stable).length}  →  graines ${ok.filter((r) => r.stable).map((r) => r.seed).join(', ')}`);
  console.log(`harmoniques finales K : ${JSON.stringify(ok.reduce((m, r) => ({ ...m, [r.params.K]: (m[r.params.K] || 0) + 1 }), {}))}`);
  console.log(`engrenages (médiane, p90) : ${q(ok.map((r) => r.gears), 0.5)}, ${q(ok.map((r) => r.gears), 0.9)}`);
  console.log(`croisements (médiane, p90) : ${q(ok.map((r) => r.crossings), 0.5)}, ${q(ok.map((r) => r.crossings), 0.9)}`);
  console.log(`plus courte approche / taille (médiane) : ${q(ok.map((r) => r.ratio), 0.5).toFixed(3)}`);
  console.log(`résidu de Newton (p90) : ${q(ok.map((r) => r.residual), 0.9).toExponential(1)} · raccord des tirs (p90) : ${q(ok.map((r) => r.closure), 0.9).toExponential(1)}`);
  console.log(`temps d'un essai réussi (médiane) : ${q(ok.map((r) => r.msAttempt), 0.5).toFixed(0)} ms · stabilité : ${q(ok.map((r) => r.msStability), 0.5).toFixed(0)} ms`);
}
