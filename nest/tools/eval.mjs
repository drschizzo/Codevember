// Évalue des expressions dans la page (?debug) d'un Chrome headless, après chargement.
//   node nest/tools/eval.mjs 'seed=a1' 'expr1' 'expr2' …
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, sleep } from '../../tools/cdp.mjs';
const [q, ...exprs] = process.argv.slice(2);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = 8280;
await serve(root, port);
const b = await launch({ port: port + 2, width: 960, height: 600 });
const p = await b.page({ w: 960, h: 600 });
await b.send('Runtime.enable', {}, p.s);
b.on((m) => { if (m.method === 'Runtime.exceptionThrown') console.log('EXC', m.params.exceptionDetails?.exception?.description?.slice(0, 400)); });
await p.goto(`http://localhost:${port}/nest/?debug&${q}`);
for (let i = 0; i < 300; i++) { await sleep(200); if (await p.ev('!!(window.nest && window.nest.run)').catch(() => false)) break; }
await p.ev('nest.run()');
for (const e of exprs) { try { console.log(JSON.stringify(await p.ev(e))); } catch (err) { console.log('ERR', err.message); } }
await b.close();
process.exit(0);
