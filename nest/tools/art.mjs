// Capture du dessin de chargement : node nest/tools/art.mjs <sortie.png> [requête]
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, sleep } from '../../tools/cdp.mjs';
const [out, q = 'p=0.55'] = process.argv.slice(2);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
await serve(root, 8290);
const b = await launch({ port: 8292, width: 1280, height: 800 });
const p = await b.page({ w: 1280, h: 800 });
await p.goto(`http://localhost:8290/nest/tools/art.html?${q}`);
for (let i = 0; i < 100; i++) { await sleep(100); if (await p.ev('!!window.__done').catch(() => false)) break; }
console.log('ms', await p.ev('window.__ms'));
const { data } = await b.send('Page.captureScreenshot', { format: 'png' }, p.s);
writeFileSync(out, Buffer.from(data, 'base64'));
await b.close(); process.exit(0);
