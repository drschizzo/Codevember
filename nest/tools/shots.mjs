// Captures dans un Chrome headless (WebGPU réel, sans panneau à garder au premier plan).
//
//   node nest/tools/shots.mjs <dossier> <requête|phase|nom[|js]> …  [--w 1280 --h 800 --port 8270]
//
// Chaque élément : la requête de la page (« seed=a1&mood=comble »), la phase, le
// nom de l'image, et facultativement une expression évaluée avant la capture
// (« nest.lookdev(1) »). Les images arrivent dans <dossier> par tools/sink.py.
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, sleep } from '../../tools/cdp.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const plain = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const [dir, ...items] = plain;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = +opt('--port', 8270), sinkPort = port + 1, cdpPort = port + 2;
const W = +opt('--w', 1280), H = +opt('--h', 800), scale = +opt('--scale', 1);

const sink = spawn('python3', [join(root, 'tools/sink.py'), resolve(dir), String(sinkPort)], { stdio: 'ignore' });
process.on('exit', () => sink.kill());
await serve(root, port);
const b = await launch({ port: cdpPort, width: W, height: H });
const p = await b.page({ w: W, h: H });
await b.send('Runtime.enable', {}, p.s);
b.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') console.log('EXC', m.params.exceptionDetails?.exception?.description?.slice(0, 600) ?? m.params.exceptionDetails?.text);
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) console.log(m.params.type.toUpperCase(), m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 600));
});
let lastQ = null;
try {
  for (const it of items) {
    const [q, ph, name, js] = it.split('|');
    if (q !== lastQ) {
      lastQ = q;
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        await p.goto(`http://localhost:${port}/nest/?debug&${q}&v=${Date.now()}`);
        for (let i = 0; i < 150; i++) { await sleep(200); if (await p.ev('!!(window.nest && window.nest.run)').catch(() => false)) { ok = true; break; } }
      }
      if (!ok) throw new Error('window.nest absent');
      const t0 = Date.now();
      await p.ev('nest.run()');
      const errs = await p.ev('JSON.stringify(nest.errors?.slice?.(0, 5) ?? [])').catch(() => '[]');
      console.log(`${q} chargé en ${((Date.now() - t0) / 1000).toFixed(1)} s`, errs !== '[]' ? `ERREURS ${errs}` : '');
      await p.ev(`nest.size(${W}, ${H})`);
    }
    if (js) await p.ev(js);
    await p.ev(`nest.shot(${+ph})`);
    await p.ev(`nest.send(${JSON.stringify(name)}, ${scale}, 'http://127.0.0.1:${sinkPort}/')`);
    console.log('→', name);
  }
} catch (e) { console.error('ÉCHEC', e.message); }
await sleep(300);
await b.close();
process.exit(0);
