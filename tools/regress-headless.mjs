// tools/regress.html dans un Chrome headless (WebGPU réel), sans panneau ni onglet à garder
// au premier plan. Sert l'arbre `root` sur son propre port et collecte les images avec
// tools/sink.py.
//
//   node tools/regress-headless.mjs <dossier-images> <out> [--root <arbre git>] [--only a,b] [--port 8301]
//   python3 tools/regress.py <dossier>/avant <dossier>/apres --bruit <dossier>/bruit
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, sleep } from './cdp.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [dir, out] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!dir || !out) { console.error('usage : node tools/regress-headless.mjs <dossier> <out> [--root r] [--only a,b] [--port p]'); process.exit(2); }
const root = resolve(opt('--root', dirname(dirname(fileURLToPath(import.meta.url)))));
const port = +opt('--port', 8301), sinkPort = port + 1, cdpPort = port + 2;

const sink = spawn('python3', [join(root, 'tools/sink.py'), resolve(dir), String(sinkPort)], { stdio: 'ignore' });
process.on('exit', () => sink.kill());
await serve(root, port);
const b = await launch({ port: cdpPort, width: 1280, height: 800 });
const p = await b.page();
const q = new URLSearchParams({ out, sink: `http://127.0.0.1:${sinkPort}/` });
if (opt('--only')) q.set('only', opt('--only'));
await p.goto(`http://localhost:${port}/tools/regress.html?${q}`);
let last = '';
for (;;) {
  await sleep(2000);
  const j = await p.ev('window.__job && { done: __job.done, current: __job.current, ok: __job.ok.length, failed: __job.failed, seconds: __job.seconds }').catch(() => null);
  if (!j) continue;
  if (j.current !== last) { process.stderr.write(`${j.current}… `); last = j.current; }
  if (j.done) { console.log(`\n${j.ok} projets en ${j.seconds} s`, Object.keys(j.failed).length ? j.failed : ''); break; }
}
await b.close();
process.exit(0);
