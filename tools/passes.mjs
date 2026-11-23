// Planche des passes d'une scène : Chrome headless (WebGPU réel), three.js non minifié
// pour lire les piles, une image capturée passe par passe (tools/passes-probe.js).
// Écrit le relevé brut (JSON, vignettes comprises) ; la planche HTML se fait ensuite.
//
//   node tools/passes.mjs <projet> <sortie.json> [--wait 6] [--port 8460]
//   node tools/passes-page.mjs <sortie.json> stats/passes/<projet>.html
//   node tools/stats-page.mjs <mesures.json>   (relie les planches depuis stats/)
// Un projet à la fois : les vignettes pèsent plusieurs Mo par relevé.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, sleep } from './cdp.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [name, out] = args, port = +opt('--port', 8460), wait = +opt('--wait', 6);
if (!name || !out) { console.error('usage : node tools/passes.mjs <projet> <sortie.json>'); process.exit(1); }
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
await serve(ROOT, port);
const b = await launch({ port: port + 1 });
try {
  const p = await b.page({ init: readFileSync(join(ROOT, 'tools/passes-probe.js'), 'utf8') });
  // three.js non minifié : des noms de fonctions dans les piles (toute requête mise en pause
  // est relâchée, d'où qu'elle vienne : un worker attendrait sinon sans fin)
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*three.webgpu.min.js*' }, { urlPattern: '*three.tsl.min.js*' }] }, p.s);
  b.on((m) => { if (m.method === 'Fetch.requestPaused') b.send('Fetch.continueRequest', { requestId: m.params.requestId, ...(/three\.(webgpu|tsl)\.min\.js/.test(m.params.request.url) ? { url: m.params.request.url.replace('.min.js', '.js') } : {}) }, m.sessionId).catch(() => {}); });
  await b.send('Runtime.enable', {}, p.s);
  const errors = [];
  b.on((m) => { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300)); });
  const t0 = Date.now();
  await p.goto(`http://localhost:${port}/${name}/`);
  let state = 'busy';
  while (Date.now() - t0 < 180000) {
    await sleep(500);
    state = await p.ev(`(() => { const l = document.getElementById('loader') ?? document.getElementById('boot'); return !l ? 'none' : l.classList.contains('error') ? 'error' : l.classList.contains('gone') ? 'gone' : 'busy'; })()`).catch(() => 'nav');
    if (state === 'gone' || state === 'error') break;
  }
  if (state !== 'gone') throw new Error(`${name} : chargement ${state} — ${errors.slice(-3).join(' | ')}`);
  await sleep(wait * 1000);
  const size = await p.ev(`[innerWidth, innerHeight]`);
  // (le relevé reste dans la page et revient passe par passe : d'un bloc, plusieurs Mo de
  // vignettes peuvent rester coincés dans le protocole)
  const n = await p.ev(`Promise.race([__passes.capture().then((r) => (self.__passesOut = r).length), new Promise((_, no) => setTimeout(() => no(new Error('capture sans fin : ' + __passes.errors.slice(0, 3).join(' | '))), 60000))])`);
  // (la capture d'écran de la page aussitôt après le relevé : la référence pour juger les couleurs de la dernière passe)
  const { data: shot } = await b.send('Page.captureScreenshot', { format: 'webp', quality: 82, clip: { x: 0, y: 0, width: size[0], height: size[1], scale: 1024 / size[0] } }, p.s);
  const passes = [];
  for (let i = 0; i < n; i++) passes.push(JSON.parse(await p.ev(`JSON.stringify(__passesOut[${i}])`)));
  errors.push(...await p.ev(`__passes.errors.slice(0, 20)`));
  writeFileSync(out, JSON.stringify({ name, at: new Date().toISOString(), size, errors, shot: 'data:image/webp;base64,' + shot, passes }));
  console.log(`${name} : ${passes.length} passes, ${passes.reduce((s, x) => s + x.targets.length, 0)} vignettes${errors.length ? `, ${errors.length} erreurs` : ''}`);
} finally { await b.close(); }
process.exit(0);
