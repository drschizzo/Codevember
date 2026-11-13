#!/usr/bin/env node
// Cohérence du dépôt : ce que chaque projet doit avoir, et ce qui ne doit pas
// dériver d'un projet à l'autre.   node tools/check.mjs   (ou : npm run check)
//
// - importmap : mêmes versions de three, lil-gui et mp4-muxer partout ;
// - livrables : README.md, docs/capture.jpg, explainer.html, tests, carte de
//   l'accueil et ses deux vignettes, section du README racine ;
// - imports : tout import relatif d'un projet mène à un fichier qui existe
//   (les modules communs sont dans shared/) ;
// - copies : un fichier de <projet>/src identique à son homonyme de shared/
//   devrait être importé de shared/, pas copié.
// Les projets d'avant la skill (ARCHIVES) sont dispensés des livrables récents.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVES = new Set(['planetaire']); // (première version d'Orrery, hors accueil)
const NO_TESTS = new Set(['planetaire', 'planetaire_v2', 'hollow', 'membrane']); // (bancs dans tools/ ou aucun)
const VERSIONS = { three: '0.186.1', 'lil-gui': '0.20.0', 'mp4-muxer': '5.1.3' };

const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');
const has = (f) => fs.existsSync(path.join(repo, f));
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(path.join(repo, d), { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(p, out); } else out.push(p);
  }
  return out;
};
const projects = fs.readdirSync(repo).filter((d) => has(`${d}/src/main.js`)).sort();
const home = read('index.html'), rootReadme = read('README.md');
const errors = [], warnings = [];
const err = (p, m) => errors.push(`${p} : ${m}`), warn = (p, m) => warnings.push(`${p} : ${m}`);
const SPEC = /(?:from\s*|import\s*\(\s*|import\s+|new URL\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;

for (const p of projects) {
  const html = read(`${p}/index.html`);
  for (const [lib, v] of Object.entries(VERSIONS)) {
    for (const m of html.matchAll(new RegExp(`${lib}@([0-9.]+)`, 'g'))) if (m[1] !== v) err(p, `index.html : ${lib}@${m[1]} (attendu ${v})`);
  }
  if (!ARCHIVES.has(p)) {
    for (const f of ['README.md', 'docs/capture.jpg', 'explainer.html']) if (!has(`${p}/${f}`)) err(p, `${f} manquant`);
    if (!home.includes(`href="${p}/"`)) err(p, "pas de carte sur la page d'accueil");
    const card = home.match(new RegExp(`home/([a-z_0-9]+)-scene\\.jpg[^]*?href="${p}/"|href="${p}/"[^]*?home/([a-z_0-9]+)-scene\\.jpg`));
    const thumb = card?.[1] || card?.[2];
    if (thumb) for (const k of ['art', 'scene']) if (!has(`home/${thumb}-${k}.jpg`)) err(p, `home/${thumb}-${k}.jpg manquant`);
    if (!rootReadme.includes(`](${p}/)`)) err(p, 'pas de section dans le README racine');
    if (!NO_TESTS.has(p) && !(has(`${p}/test`) && fs.readdirSync(path.join(repo, p, 'test')).some((f) => f.endsWith('.test.mjs')))) err(p, 'aucun test');
  }
  for (const f of walk(p)) {
    if (!/\.(js|mjs|html)$/.test(f)) continue;
    const text = read(f);
    // (les exemples de code des pages de documentation ne sont pas des imports)
    const raw = f.endsWith('.html') ? [...text.matchAll(/<script[^>]*type="module"[^>]*>([^]*?)<\/script>/g)].map((m) => m[1]).join('\n') : text;
    const code = raw.replace(/^\s*\/\/.*$/gm, ''); // (pas les exemples en commentaire)
    for (const m of code.matchAll(SPEC)) {
      const target = path.normalize(path.join(path.dirname(f), m[2]));
      if (target.startsWith('..')) { err(p, `${f} : import hors du dépôt (${m[2]})`); continue; }
      if (!has(target)) err(p, `${f} : import introuvable (${m[2]})`);
    }
    // scripts et feuilles de style des pages
    if (f.endsWith('.html')) for (const m of text.matchAll(/<(?:script|link)[^>]*?(?:src|href)="([^"#?]+)"/g)) {
      if (/^(https?:)?\/\//.test(m[1]) || m[1].startsWith('data:')) continue;
      if (!has(path.normalize(path.join(path.dirname(f), m[1])))) err(p, `${f} : fichier introuvable (${m[1]})`);
    }
    const rel = path.relative(`${p}/src`, f);
    // (une copie qui importe une variante locale est légitime : le module de
    // shared/ importerait l'original)
    const localDeps = [...code.matchAll(SPEC)].some((m) => !path.normalize(path.join(path.dirname(f), m[2])).startsWith('shared'));
    if (!rel.startsWith('..') && has(`shared/${rel}`) && read(`shared/${rel}`) === text && !localDeps) warn(p, `src/${rel} est une copie de shared/${rel}`);
  }
}

// la publication doit emporter shared/ (sans lui, aucune scène ne se charge en ligne)
if (!/cp -r shared _site/.test(read('.github/workflows/pages.yml'))) errors.push('.github/workflows/pages.yml : shared/ n\'est pas copié dans le site publié');

for (const w of warnings) console.log(`à voir   ${w}`);
for (const e of errors) console.log(`ERREUR   ${e}`);
console.log(`${projects.length} projets, ${errors.length} erreur(s), ${warnings.length} remarque(s)`);
process.exit(errors.length ? 1 : 0);
