// Données de la page « Statistiques », écrites dans stats/index.html même (balise
// script#cv-stats : la page s'ouvre aussi depuis le disque, où rien d'autre ne se charge) : lignes et historique git
// (tools/stats-static.mjs, recalculés ici), mesures en navigateur (sorties de
// tools/stats-runtime.mjs, les dernières l'emportent), textes de stats/notes.json,
// noms et sous-titres lus sur l'accueil. Ni prototypes ni planetaire (v1).
//
//   node tools/stats-page.mjs runtime-a.json [runtime-b.json …]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const stat = JSON.parse(execFileSync('node', [join(ROOT, 'tools/stats-static.mjs')], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }));
const runtime = {};
for (const f of process.argv.slice(2)) for (const r of read(f)) runtime[r.name] = r;
const notes = read(join(ROOT, 'stats/notes.json'));

// les jours parus, dans l'ordre de l'accueil
const home = readFileSync(join(ROOT, 'index.html'), 'utf8');
const days = [...home.matchAll(/id="d(\d+)" data-dir="(\w+)"[\s\S]*?<h2>(.*?)<\/h2>[\s\S]*?class="tag">(.*?)<\/p>/g)]
  .map(([, d, id, name, tag]) => ({ day: +d, id, name, tag }));
const list = [...days, { day: null, id: 'mega', name: 'Le relais', tag: 'Tous les jours en un seul plan' }];

const lines = (p, roles) => roles.reduce((s, r) => s + (p.roles[r]?.code ?? 0), 0);
const r1 = (x, k = 1) => Math.round(x * k) / k;
const projects = list.map(({ day, id, name, tag }) => {
  const p = stat.projects[id], r = runtime[id];
  if (!p) throw new Error(`pas de statistiques pour ${id}`);
  if (!notes[id]) throw new Error(`pas de texte pour ${id} dans stats/notes.json`);
  const o = {
    day, id, name, tag, ...notes[id],
    code: lines(p, ['runtime']), tests: lines(p, ['test', 'tools']), explainer: lines(p, ['explainer']),
    files: Object.entries(p.roles).filter(([k]) => k !== 'proto').reduce((s, [, v]) => s + v.files, 0),
    commits: p.git.commits, first: p.git.first, last: p.git.last,
    sheet: existsSync(join(ROOT, `stats/passes/${id}.html`)), // (planche des passes : tools/passes.mjs)
  };
  if (r) Object.assign(o, {
    download: r.net.wire, own: r.net.localGz,
    ready: r.state === 'gone' ? r1(r.readyMs / 1000, 10) : null, // (sans écran de chargement : non mesuré)
    ram: Math.round(r.memMB.delta.total), vram: Math.round((r.gpu.bufBytes + r.gpu.texBytes) / 2 ** 20),
    tris: r1(r.sample.perFrame.tris / 1e6, 100), draws: Math.round(r.sample.perFrame.draws), passes: Math.round(r.sample.perFrame.passes),
    shaders: r.shaders.modules, wgsl: r.shaders.wgslLines, pipelines: r.shaders.renderPipelines + r.shaders.computePipelines,
    fps: Math.min(60, Math.round(1000 / r.sample.frameMs.median)),
  });
  return o;
});

// le dépôt entier hors prototypes et planetaire (v1)
let all = 0, shared = 0;
for (const [k, p] of Object.entries(stat.projects)) {
  if (k === 'planetaire' || k.startsWith('.')) continue;
  const n = lines(p, ['runtime', 'test', 'tools', 'explainer']);
  all += n; if (k === 'shared') shared = n;
}
const out = { at: new Date().toISOString().slice(0, 10), machine: 'MacBook Pro M1 Max, Chrome, 1920 × 1080', commits: stat.commitsTotal, lines: all, shared, projects };
const page = join(ROOT, 'stats/index.html'), html = readFileSync(page, 'utf8');
const tag = /<script id="cv-stats">[\s\S]*?<\/script>/;
if (!tag.test(html)) throw new Error('balise script#cv-stats introuvable dans stats/index.html');
writeFileSync(page, html.replace(tag, () => `<script id="cv-stats">window.CV_STATS = ${JSON.stringify(out)};</script>`));
console.log(`stats/index.html : ${projects.length} projets, ${projects.filter((p) => p.ready).length} mesurés`);
