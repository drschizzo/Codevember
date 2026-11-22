// Mesure de chaque scène dans un Chrome headless (WebGPU réel), une instance neuve par scène :
// octets téléchargés (local / CDN, par type), temps de chargement, mémoire des processus
// (empreinte physique macOS : rendu, GPU, total), tas JS, et ce que la sonde WebGPU
// (tools/stats-probe.js) a vu : tampons, textures, shaders, pipelines, coût par image.
//
//   node tools/stats-runtime.mjs [out.json] [projet…]
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8399, CDP = 9339, W = 1920, H = 1080;
const ALL = ['planetaire', 'hollow', 'tesseract', 'membrane', 'planetaire_v2', 'fold', 'tangle', 'moss', 'melt',
  'caustic', 'rust', 'feather', 'labyrinth', 'shatter', 'tension', 'mirage', 'spore', 'kelp', 'pendulum', 'erosion',
  'cocoon', 'bolt', 'echo', 'magma', 'mega'];
const [out = 'stats-runtime.json', ...only] = process.argv.slice(2);
const list = only.length ? only : ALL;
const probe = readFileSync(join(ROOT, 'tools/stats-probe.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('python3', [join(ROOT, '.claude/serve.py'), String(PORT), '.'], { cwd: ROOT, stdio: 'ignore' });
process.on('exit', () => server.kill());
await sleep(800);

function footprint(pid) {
  try {
    const t = execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = t.match(/Footprint:\s*([\d.]+)\s*([KMG]B)/);
    return m ? +m[1] * { KB: 1 / 1024, MB: 1, GB: 1024 }[m[2]] : null;
  } catch { return null; }
}

async function browser() {
  const dir = mkdtempSync(join(tmpdir(), 'cv-stats-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${dir}`,
    '--enable-unsafe-webgpu', ...(process.env.STATS_UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []), '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-precise-memory-info',
    `--window-size=${W},${H}`, '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 50 && !ws; i++) {
    await sleep(200);
    try { ws = (await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()).webSocketDebuggerUrl; } catch {}
  }
  const sock = new WebSocket(ws);
  await new Promise((r) => sock.addEventListener('open', r));
  let id = 0; const pend = new Map(), handlers = [];
  sock.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else handlers.forEach((h) => h(m));
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  return { proc, dir, send, on: (h) => handlers.push(h), close: () => { sock.close(); proc.kill(); return sleep(500).then(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })); } };
}

async function processes(b) {
  const { processInfo } = await b.send('SystemInfo.getProcessInfo');
  const by = {};
  for (const p of processInfo) { const f = footprint(p.id); by[p.type] = (by[p.type] ?? 0) + (f ?? 0); }
  by.browser = footprint(b.proc.pid) ?? 0;
  by.total = Object.values(by).reduce((a, x) => a + x, 0);
  return by;
}

async function measure(name) {
  const b = await browser();
  const base = await processes(b);
  const { targetId } = await b.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: s } = await b.send('Target.attachToTarget', { targetId, flatten: true });
  const req = new Map();
  b.on((m) => {
    if (m.sessionId !== s) return;
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response; req.set(m.params.requestId, { url: r.url, type: m.params.type, mime: r.mimeType, bytes: 0 });
    } else if (m.method === 'Network.loadingFinished') {
      const r = req.get(m.params.requestId); if (r) { r.bytes = m.params.encodedDataLength; r.t = m.params.timestamp; }
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      (errors ??= []).push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
    }
  });
  let errors;
  await b.send('Network.enable', {}, s);
  await b.send('Network.setCacheDisabled', { cacheDisabled: true }, s);
  await b.send('Runtime.enable', {}, s);
  await b.send('Performance.enable', {}, s);
  await b.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, s);
  await b.send('Page.enable', {}, s);
  if (process.env.STATS_STACKS) { // three.js non minifié : des noms de fonctions dans les piles
    await b.send('Fetch.enable', { patterns: [{ urlPattern: '*three.webgpu.min.js*' }, { urlPattern: '*three.tsl.min.js*' }] }, s);
    b.on((m) => { if (m.method === 'Fetch.requestPaused') b.send('Fetch.continueRequest', { requestId: m.params.requestId, ...(/three\.(webgpu|tsl)\.min\.js/.test(m.params.request.url) ? { url: m.params.request.url.replace('.min.js', '.js') } : {}) }, m.sessionId).catch(() => {}); });
  }
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: (process.env.STATS_STACKS ? 'self.__probeStacks = true;' : '') + probe }, s);
  const ev = (expr) => b.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s).then((r) => r.result.value);
  const t0 = Date.now();
  await b.send('Page.navigate', { url: `http://localhost:${PORT}/${name}/` }, s);

  // prêt : l'écran de chargement s'efface (#loader.gone), ou, sans lui, 25 s ; plafond 150 s
  let ready = null, state = '';
  while (Date.now() - t0 < 150000) {
    await sleep(500);
    await ev(`document.getElementById('enter')?.click()`).catch(() => {}); // Planétaire v1 : écran d'entrée
    state = await ev(`(() => { const l = document.getElementById('loader'); return !l ? 'none' : l.classList.contains('error') ? 'error' : l.classList.contains('gone') ? 'gone' : 'busy'; })()`).catch(() => 'nav');
    if (state === 'gone' || state === 'error' || (state === 'none' && Date.now() - t0 > 25000)) { ready = Date.now() - t0; break; }
  }
  await sleep(6000); // régime établi (fondu, préparation des pipelines, premières boucles)
  if (process.env.STATS_SHOT) { // STATS_SHOT=<dossier> : capture de la scène au moment du relevé
    const { data } = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }, s);
    writeFileSync(join(process.env.STATS_SHOT, `${name}.jpg`), Buffer.from(data, 'base64'));
  }
  const sample = await ev('__probe.sample(4000)');
  const gpuTime = await ev('__probe.gpuTiming(60)').catch(() => null);
  const rep = await ev('__probe.report()');
  const { metrics } = await b.send('Performance.getMetrics', {}, s);
  const met = Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  const mem = await processes(b);
  const reqs = [...req.values()];
  const net = { requests: reqs.length, local: 0, cdn: 0, byType: {}, byExt: {} };
  for (const r of reqs) {
    if (!r.url) continue;
    const local = r.url.startsWith(`http://localhost:${PORT}`);
    net[local ? 'local' : 'cdn'] += r.bytes;
    if (local) { // GitHub Pages compresse : taille gzip du fichier tel que servi
      try { net.localGz = (net.localGz ?? 0) + gzipSync(readFileSync(join(ROOT, decodeURIComponent(new URL(r.url).pathname).replace(/\/$/, '/index.html')))).length; }
      catch { net.localGz = (net.localGz ?? 0) + r.bytes; }
    }
    net.byType[r.type] = (net.byType[r.type] ?? 0) + r.bytes;
    const ext = (r.url.split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? r.mime).toLowerCase();
    net.byExt[ext] = (net.byExt[ext] ?? 0) + r.bytes;
  }
  net.total = net.local + net.cdn;
  net.wire = (net.localGz ?? 0) + net.cdn;
  net.top = reqs.sort((a, c) => c.bytes - a.bytes).slice(0, 6).map((r) => ({ url: r.url.replace(`http://localhost:${PORT}`, ''), bytes: r.bytes }));
  await b.close();
  return { name, state, readyMs: ready, net, sample, gpuTime, ...rep, jsHeap: met.JSHeapUsedSize, nodes: met.Nodes,
    memMB: { base, loaded: mem, delta: Object.fromEntries(Object.keys(mem).map((k) => [k, mem[k] - (base[k] ?? 0)])) }, errors };
}

const res = [];
for (const n of list) {
  process.stderr.write(`${n}… `);
  try { const r = await measure(n); res.push(r); process.stderr.write(`${r.state} ${(r.readyMs / 1000).toFixed(1)} s, ${(r.net.total / 1e6).toFixed(1)} Mo, gpu ${((r.gpu.bufBytes + r.gpu.texBytes) / 1e6).toFixed(0)} Mo, total ${r.memMB.delta.total.toFixed(0)} Mo\n`); }
  catch (e) { process.stderr.write(`échec ${e.message}\n`); res.push({ name: n, error: e.message }); }
  writeFileSync(out, JSON.stringify(res, null, 1));
}
process.exit(0);
