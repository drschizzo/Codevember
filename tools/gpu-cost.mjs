// Où va le temps d'une scène ? (indicatif : le coût change le long de la boucle, et masquer un objet
// peut déplacer du travail ailleurs ; répéter les mesures avant de conclure.)
// Chrome headless sans synchronisation verticale, scène en
// ?debug : temps médian par image en masquant tour à tour les objets les plus lourds,
// sans ombres, et à demi-résolution (une scène limitée par le remplissage tombe ~4×).
//
//   node tools/gpu-cost.mjs <projet> [--top 8] [--name objet] [--port 8430]
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, sleep } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const name = args[0], top = +opt('--top', 8), port = +opt('--port', 8430), key = opt('--name', name);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
await serve(root, port);

// (cdp.mjs ne lève pas la synchronisation verticale : instance à part)
const { CHROME } = await import('./cdp.mjs');
const dir = mkdtempSync(join(tmpdir(), 'cv-cost-'));
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port + 1}`, `--user-data-dir=${dir}`, '--enable-unsafe-webgpu',
  '--disable-gpu-vsync', '--disable-frame-rate-limit', '--no-first-run', '--window-size=1920,1080', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => proc.kill());
let ws;
for (let i = 0; i < 50 && !ws; i++) { await sleep(200); try { ws = (await (await fetch(`http://127.0.0.1:${port + 1}/json/version`)).json()).webSocketDebuggerUrl; } catch {} }
const sock = new WebSocket(ws); await new Promise((r) => sock.addEventListener('open', r));
let id = 0; const pend = new Map();
sock.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pend.set(i, r); sock.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId: s } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, s);
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
await send('Page.navigate', { url: `http://localhost:${port}/${name}/?debug` }, s);
const t0 = Date.now();
while (Date.now() - t0 < 150000) { await sleep(500); if (await ev(`document.getElementById('loader')?.classList.contains('gone') && !!window[${JSON.stringify(key)}]`).catch(() => false)) break; }
await sleep(5000);
const W = `window[${JSON.stringify(key)}]`;
// temps médian par image sur 2,5 s
const measure = () => ev(`new Promise((res) => { const d = []; let last = 0; const t0 = performance.now(); const f = (t) => { if (last) d.push(t - last); last = t; if (t - t0 < 2500) requestAnimationFrame(f); else { d.sort((a, b) => a - b); res(d[d.length >> 1]); } }; requestAnimationFrame(f); })`);
await send('Performance.enable', {}, s);
const cpu = async () => Object.fromEntries((await send('Performance.getMetrics', {}, s)).result.metrics.map((m) => [m.name, m.value]));
const c0 = await cpu(), f0 = await ev('new Promise((r) => { let n = 0; const t0 = performance.now(); const f = (t) => { n++; if (t - t0 < 2500) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); })'), c1 = await cpu();
const base = await measure();
console.log(`${name} : ${base.toFixed(1)} ms par image ; fil principal ${((c1.TaskDuration - c0.TaskDuration) * 1000 / f0).toFixed(1)} ms par image (scripts ${((c1.ScriptDuration - c0.ScriptDuration) * 1000 / f0).toFixed(1)})`);
if (args.includes('--profile')) { // fonctions les plus coûteuses du fil principal (temps propre)
  await send('Profiler.enable', {}, s); await send('Profiler.setSamplingInterval', { interval: 200 }, s); await send('Profiler.start', {}, s);
  await sleep(3000);
  const { result: { profile } } = await send('Profiler.stop', {}, s);
  const self = new Map(), dt = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
  for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
  for (const [nid, us] of dt) { const cf = byId.get(nid).callFrame; const k = `${cf.functionName || '(anonyme)'} ${cf.url.replace(/^.*\/(?=[^/]+\/[^/]+$)/, '')}:${cf.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + us); }
  const tot = [...self.values()].reduce((a, b) => a + b, 0);
  console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, us]) => `  ${(us / tot * 100).toFixed(1).padStart(5)} %  ${k}`).join('\n'));
}
for (const expr of args.flatMap((a, i) => (args[i - 1] === '--try' ? [a] : []))) { // essai : une expression (sur W) qui retire un travail
  const undo = await ev(`(() => { const W = ${W}; return String(${expr}); })()`);
  await sleep(500);
  const t = await measure();
  console.log(`  ${(base - t).toFixed(1).padStart(6)} ms  avec : ${expr}`);
  if (undo && undo !== 'undefined') await ev(`(() => { const W = ${W}; ${undo}; })()`).catch(() => {});
}
const objs = await ev(`(() => { const sc = ${W}.scene; const out = []; let i = 0; sc.traverse((o) => { if (!o.isMesh && !o.isPoints && !o.isLine) return; const g = o.geometry; const n = g.index ? g.index.count : g.attributes.position?.count ?? 0; const inst = o.isInstancedMesh ? o.count : g.isInstancedBufferGeometry ? g.instanceCount : 1; o.userData.__i = i++; out.push({ i: o.userData.__i, name: o.name || o.parent?.name || o.type, tris: Math.round(n * (inst ?? 1) / 3), mat: o.material?.type ?? '?', visible: o.visible, shadow: o.castShadow }); }); return out.filter((o) => o.visible).sort((a, b) => b.tris - a.tris); })()`);
const rows = [];
for (const o of objs.slice(0, top)) {
  await ev(`${W}.scene.traverse((x) => { if (x.userData.__i === ${o.i}) x.visible = false; })`);
  await sleep(300);
  const t = await measure();
  await ev(`${W}.scene.traverse((x) => { if (x.userData.__i === ${o.i}) x.visible = true; })`);
  rows.push(`  ${(base - t).toFixed(1).padStart(6)} ms  sans « ${o.name} » (${(o.tris / 1e6).toFixed(2)} M triangles, ${o.mat}${o.shadow ? ', ombre' : ''})`);
}
// ombres figées : les cartes ne sont plus redessinées (rien n'est recompilé)
await ev(`${W}.scene.traverse((x) => { if (x.isLight && x.castShadow) { x.shadow.__au = x.shadow.autoUpdate; x.shadow.autoUpdate = false; } })`);
await sleep(800);
const noShadow = await measure();
await ev(`${W}.scene.traverse((x) => { if (x.isLight && x.castShadow) x.shadow.autoUpdate = x.shadow.__au ?? true; })`);
await sleep(800);
await ev(`${W}.renderer.setPixelRatio(0.5)`);
await sleep(800);
const half = await measure();
console.log(rows.join('\n'));
console.log(`  ${(base - noShadow).toFixed(1).padStart(6)} ms  cartes d'ombre figées (plus redessinées)`);
console.log(`  demi-résolution : ${half.toFixed(1)} ms (${(half / base * 100).toFixed(0)} % ; ~25 % = limité par le remplissage, ~100 % = par les sommets ou le CPU)`);
proc.kill(); process.exit(0);
