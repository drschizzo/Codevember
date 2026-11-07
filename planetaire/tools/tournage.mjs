// Tournage : pilote ?film dans Chrome headless (WebGPU) et écrit la vidéo / les images fixes.
//
//   npm i puppeteer-core          (une fois)
//   python3 -m http.server 8020   (dans planetaire/)
//   node tools/tournage.mjs "w=1920&ss=2&fps=24" film.mp4
//   node tools/tournage.mjs "w=960&ss=1&stills=12,40,95" images/   (prévisualisation)
//
// CHROME : chemin de Chrome (défaut : macOS) ; BASE : URL de la page (défaut : http://localhost:8020/).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [,, query, outPath] = process.argv;
const fd = outPath.endsWith('.mp4') ? fs.openSync(outPath, 'w') : null;
if (!fd) fs.mkdirSync(outPath, { recursive: true });
let pending = 0;
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  protocolTimeout: 0,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--window-size=1920,1080', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const p = await b.newPage();
await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
p.on('console', (m) => { if (m.type() === 'error' && !/getArrayBufferAsync|reading 'size'/.test(m.text())) console.log('console:', m.text()); });
p.on('pageerror', (e) => { if (!/reading 'size'/.test(e.message)) console.log('pageerror:', e.message); });
await p.exposeFunction('__filmWrite', (pos, data) => { const buf = Buffer.from(data, 'base64'); fs.writeSync(fd, buf, 0, buf.length, pos); });
await p.exposeFunction('__filmStill', (t, data) => { fs.writeFileSync(`${outPath}/t${String(t).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64')); });
await p.goto(`${process.env.BASE || 'http://localhost:8020/'}?film&${query}`, { waitUntil: 'load' });
const t0 = Date.now();
let lastLog = 0;
for (;;) {
  await new Promise((r) => setTimeout(r, 3000));
  const st = await p.evaluate(() => ({ done: !!window.__filmDone, err: window.__filmError, pr: window.__filmProgress, log: window.__filmLog, imp: window.__impacts }));
  if (st.err) { console.log('ERREUR', st.err); break; }
  if (Date.now() - lastLog > 20000 && st.pr) { lastLog = Date.now(); console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(st.pr)); }
  if (st.done) { console.log('plans', JSON.stringify(st.log)); console.log('impacts', JSON.stringify(st.imp)); break; }
}
await new Promise((r) => setTimeout(r, 3000));
if (fd) fs.closeSync(fd);
await b.close();
console.log('fini en', ((Date.now() - t0) / 1000).toFixed(0), 's');
