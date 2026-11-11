#!/usr/bin/env node
// Échafaudage d'un nouveau projet Codevember.
//
//   node .claude/skills/codevember-scene/scripts/scaffold.mjs <dossier> "<Titre>" "<sous-titre>" [port]
//
// 1. Copie, depuis les projets existants, les modules indépendants du thème
//    (déjà éprouvés : hasard, réglages, mobile, export, chaîne d'image,
//    studio HDR, volume de bruit, pool de workers, maillage, finitions et
//    matériaux), avec les quelques retouches qui les découplent de leur projet.
// 2. Ajoute le gabarit de la skill (main.js, panneau, recette, plateau,
//    worker, tests, README, page « défis techniques » explainer.html), où {{NAME}}, {{TITLE}}, {{SUBTITLE}} sont remplacés.
// 3. Inscrit le serveur de développement dans .claude/launch.json.
//
// Le résultat tourne tout de suite : une pièce de démonstration sur un plateau,
// qui fait un nombre entier de tours par boucle. Tout ce qui est propre au thème
// (gen/, scene/, recipe.js, ui.js) est ensuite à réécrire.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skill = path.resolve(here, '..');
const repo = path.resolve(skill, '../../..');
const [dir, title, subtitle = '', portArg] = process.argv.slice(2);
if (!dir || !title) {
  console.error('usage : scaffold.mjs <dossier> "<Titre>" "<sous-titre>" [port]');
  process.exit(1);
}
const name = path.basename(dir).toLowerCase().replace(/[^a-z0-9_]+/g, '');
const dest = path.resolve(repo, dir);
// (le dossier peut déjà contenir docs/ : le concept s'écrit avant l'échafaudage)
if (fs.existsSync(dest) && fs.readdirSync(dest).some((f) => f !== 'docs' && !f.startsWith('.'))) {
  console.error(`${dest} existe déjà et contient autre chose que docs/.`);
  process.exit(1);
}

// [source (relative au dépôt), destination (relative au projet), retouches]
const COPY = [
  ['tesseract/src/rng.js', 'src/rng.js'],
  ['tesseract/src/app/settings.js', 'src/app/settings.js', [[/tesseract\.render\.v1/, `${name}.render.v1`], [/\n\s*captions: false, analogy: false,[^\n]*/, '']]],
  ['tesseract/src/app/mobile.js', 'src/app/mobile.js'],
  ['tesseract/src/app/capture.js', 'src/app/capture.js'],
  ['tesseract/src/render/post.js', 'src/render/post.js', [
    // (exposition fixe propre à l'humeur : R.grade.exposure, réglée au posemètre)
    [/U\.exposure\.value = cfg\.exposure;/, "U.exposure.value = cfg.exposure * (R?.grade?.exposure ?? 1); // (exposition fixe de l'humeur)"],
  ]],
  ['tesseract/src/render/accum.js', 'src/render/accum.js'],
  ['tesseract/src/scene/env.js', 'src/scene/env.js'],
  ['moss/src/gen/envmap.js', 'src/gen/envmap.js'], // (pixels du studio, calculés hors du fil principal ; scene/env.js en dépend)
  ['tesseract/src/gen/noisevol.js', 'src/gen/noisevol.js', [[/'tesseract-noise'/, `'${name}-noise'`]]],
  ['tesseract/src/gen/client.js', 'src/gen/client.js'],
  ['membrane/src/gen/mesh.js', 'src/gen/mesh.js'],
  ['membrane/src/finishes.js', 'src/finishes.js'],
  ['membrane/src/scene/materials.js', 'src/scene/materials.js'],
  ['.claude/skills/codevember-scene/scripts/sink.py', 'tools/sink.py'],
  // écran de chargement et préparation sans gel : modules communs, à copier tels quels
  // (le dessin propre au thème, src/app/loaderArt.js, vient du gabarit et se réécrit)
  ['melt/src/app/loader.js', 'src/app/loader.js'],
  ['melt/src/app/loaderWorker.js', 'src/app/loaderWorker.js'],
  ['melt/src/app/warmup.js', 'src/app/warmup.js'],
];

const write = (rel, text) => {
  const f = path.join(dest, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};

for (const [src, to, patches = []] of COPY) {
  const from = path.join(repo, src);
  if (!fs.existsSync(from)) { console.warn(`absent, ignoré : ${src}`); continue; }
  let text = fs.readFileSync(from, 'utf8');
  for (const [re, by] of patches) {
    if (!re.test(text)) console.warn(`retouche sans effet dans ${src} : ${re}`);
    text = text.replace(re, by);
  }
  write(to, text);
}

// gabarit
const subst = (t) => t.replaceAll('{{NAME}}', name).replaceAll('{{TITLE}}', title).replaceAll('{{SUBTITLE}}', subtitle);
const walk = (d, base = '') => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const rel = path.join(base, e.name);
    if (e.isDirectory()) walk(path.join(d, e.name), rel);
    else write(rel, subst(fs.readFileSync(path.join(d, e.name), 'utf8')));
  }
};
walk(path.join(skill, 'template'));
// style.css : celui de Tesseract (verre dépoli, Fraunces + Inter)
fs.copyFileSync(path.join(repo, 'tesseract/style.css'), path.join(dest, 'style.css'));

// serveur de développement
const launch = path.join(repo, '.claude/launch.json');
try {
  const L = JSON.parse(fs.readFileSync(launch, 'utf8'));
  if (!L.configurations.some((c) => c.name === name)) {
    const used = new Set(L.configurations.map((c) => c.port));
    let port = Number(portArg) || 8050;
    while (used.has(port)) port += 10;
    L.configurations.push({ name, runtimeExecutable: 'python3', runtimeArgs: ['.claude/serve.py', String(port), dir], port });
    fs.writeFileSync(launch, `${JSON.stringify(L, null, 2)}\n`);
    console.log(`launch.json : « ${name} » sur le port ${port}`);
  }
} catch (e) { console.warn(`launch.json non modifié : ${e.message}`); }

console.log(`Projet créé : ${dest}`);
