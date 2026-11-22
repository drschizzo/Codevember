// Chrome headless piloté par le protocole DevTools (sans dépendance) : WebGPU réel
// (Metal sur macOS), une instance neuve par appel, profil jetable.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9339, width = 1920, height = 1080 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cv-cdp-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--enable-unsafe-webgpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-precise-memory-info',
    `--window-size=${width},${height}`, '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 50 && !ws; i++) {
    await sleep(200);
    try { ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch {}
  }
  if (!ws) { proc.kill(); throw new Error('Chrome ne répond pas'); }
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
  // un onglet : session, évaluation (valeur JSON, promesses attendues)
  async function page({ w = width, h = height, init } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, s);
    await send('Page.enable', {}, s);
    if (init) await send('Page.addScriptToEvaluateOnNewDocument', { source: init }, s);
    const ev = (expr) => send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s).then((r) => {
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    });
    return { s, ev, goto: (url) => send('Page.navigate', { url }, s) };
  }
  return {
    proc, send, page, on: (h) => handlers.push(h),
    close: async () => { sock.close(); proc.kill(); await sleep(500); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); },
  };
}

// serveur statique sans cache du dépôt (.claude/serve.py)
export async function serve(root, port) {
  const p = spawn('python3', [join(root, '.claude/serve.py'), String(port), '.'], { cwd: root, stdio: 'ignore' });
  process.on('exit', () => p.kill());
  for (let i = 0; i < 30; i++) { await sleep(200); try { await fetch(`http://127.0.0.1:${port}/`); return p; } catch {} }
  throw new Error(`serveur ${port} muet`);
}
