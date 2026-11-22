// Où passe le temps de préparation d'une scène ? Chrome headless, cache vide : durée de
// chaque étape de l'écran de chargement (messages 'steps' vers son worker), travail des
// workers de génération (demandes, durée cumulée), et fonctions les plus coûteuses du fil
// principal pendant le chargement (STARTUP_NAMES=1 : three.js non minifié, noms lisibles).
//
//   node tools/startup.mjs <projet> [--port 8440]
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, sleep } from './cdp.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const name = args[0], port = +opt('--port', 8440);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
await serve(root, port);

// (worker de l'écran de chargement : ses étapes ; workers de génération : demandes et réponses)
const init = `(() => {
  const S = self.__startup = { t0: performance.now(), steps: [], jobs: new Map(), gen: [] };
  const W = self.Worker;
  self.Worker = class extends W {
    constructor(url, o) {
      super(url, o);
      const u = String(url);
      const pm = this.postMessage.bind(this);
      this.postMessage = (m, tr) => {
        if (m?.type === 'steps') S.steps.push({ t: performance.now(), key: m.steps[m.idx] });
        else if (m?.id != null && m.what) S.jobs.set(u + m.id, { what: m.what, t: performance.now() });
        pm(m, tr);
      };
      this.addEventListener('message', ({ data }) => {
        if (data?.id == null || data.progress != null) return;
        const j = S.jobs.get(u + data.id); if (!j) return;
        S.gen.push({ what: j.what, t0: j.t, t1: performance.now() }); S.jobs.delete(u + data.id);
      });
    }
  };
})();`;
const b = await launch({ port: port + 2 });
const p = await b.page({ init });
await b.send('Network.enable', {}, p.s);
await b.send('Network.setCacheDisabled', { cacheDisabled: true }, p.s);
if (process.env.STARTUP_NAMES) { // three.js non minifié (lent, et peut bloquer des workers)
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*three.webgpu.min.js*' }, { urlPattern: '*three.tsl.min.js*' }] }, p.s);
  // (toute requête mise en pause est relâchée, d'où qu'elle vienne : un worker attendrait sinon sans fin)
  b.on((m) => { if (m.method === 'Fetch.requestPaused') b.send('Fetch.continueRequest', { requestId: m.params.requestId, ...(/three\.(webgpu|tsl)\.min\.js/.test(m.params.request.url) ? { url: m.params.request.url.replace('.min.js', '.js') } : {}) }, m.sessionId).catch(() => {}); });
}
const PROF = !!process.env.STARTUP_PROF; // (le profileur peut figer une page en cours de génération : à demander)
if (PROF) {
  await b.send('Profiler.enable', {}, p.s);
  await b.send('Profiler.setSamplingInterval', { interval: 1000 }, p.s);
  await b.send('Profiler.start', {}, p.s);
}
const t0 = Date.now();
await p.goto(`http://localhost:${port}/${name}/`);
let ready = null;
let lastLog = 0;
while (Date.now() - t0 < 180000) {
  await sleep(250);
  if (Date.now() - lastLog > 10000 && process.env.STARTUP_DEBUG) { lastLog = Date.now(); console.error('…', ((Date.now() - t0) / 1000).toFixed(0), 's', await p.ev(`JSON.stringify({ steps: __startup.steps.length, gen: __startup.gen.length, loader: document.getElementById('loader')?.className, err: (window.__err || []).slice(-2) })`).catch((e) => 'ev ' + e.message)); }
  if (await p.ev(`document.getElementById('loader')?.classList.contains('gone')`).catch(() => false)) { ready = (Date.now() - t0) / 1000; break; }
}
const { profile } = PROF ? await b.send('Profiler.stop', {}, p.s) : { profile: { nodes: [], samples: [], timeDeltas: [] } };
const S = await p.ev(`(() => { const S = __startup; return { steps: S.steps.map((s) => ({ key: s.key, t: (s.t - S.t0) / 1000 })), gen: S.gen.map((g) => ({ what: g.what, t0: (g.t0 - S.t0) / 1000, t1: (g.t1 - S.t0) / 1000 })), end: (performance.now() - S.t0) / 1000 }; })()`);
await b.close();

console.log(`${name} : prêt en ${ready?.toFixed(1) ?? '?'} s`);
// étapes : de chaque changement au suivant
const st = S.steps.filter((s, i, a) => i === 0 || s.key !== a[i - 1].key);
for (let i = 0; i < st.length; i++) console.log(`  ${st[i].key.padEnd(10)} ${st[i].t.toFixed(1).padStart(5)} s → ${(i + 1 < st.length ? st[i + 1].t : S.end).toFixed(1).padStart(5)} s  (${((i + 1 < st.length ? st[i + 1].t : S.end) - st[i].t).toFixed(1)} s)`);
// génération : par type de demande, durée cumulée et fenêtre
const by = {};
for (const g of S.gen) { const e = (by[g.what] ??= { n: 0, sum: 0, t0: 1e9, t1: 0 }); e.n++; e.sum += g.t1 - g.t0; e.t0 = Math.min(e.t0, g.t0); e.t1 = Math.max(e.t1, g.t1); }
for (const [k, e] of Object.entries(by).sort((a, b) => b[1].sum - a[1].sum)) console.log(`  worker « ${k} » × ${e.n} : ${e.sum.toFixed(1)} s cumulées, de ${e.t0.toFixed(1)} à ${e.t1.toFixed(1)} s`);
// fil principal : temps propre par fonction
const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
let idle = 0, total = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]), us = profile.timeDeltas[i] ?? 0, cf = n.callFrame; total += us;
  if (cf.functionName === '(idle)') { idle += us; continue; }
  const k = `${cf.functionName || '(anonyme)'} ${cf.url.replace(/^.*\/(?=[^/]+\/[^/]+$)/, '')}${cf.url ? ':' + (cf.lineNumber + 1) : ''}`;
  self.set(k, (self.get(k) ?? 0) + us);
}
console.log(`  fil principal : ${((total - idle) / 1e6).toFixed(1)} s occupées sur ${(total / 1e6).toFixed(1)} s`);
for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`    ${(us / 1e6).toFixed(2).padStart(6)} s  ${k}`);
process.exit(0);
