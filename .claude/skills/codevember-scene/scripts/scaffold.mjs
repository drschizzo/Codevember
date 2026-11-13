#!/usr/bin/env node
// Échafaudage d'un nouveau projet Codevember.
//
//   node .claude/skills/codevember-scene/scripts/scaffold.mjs <dossier> "<Titre>" "<sous-titre>" [port]
//
// 1. Pose le gabarit de la skill (main.js, panneau, recette, réglages, plateau,
//    worker, tests, README, page « défis techniques » explainer.html), où
//    {{NAME}}, {{TITLE}}, {{SUBTITLE}} sont remplacés. Rien n'est copié des
//    autres projets : les modules indépendants du thème (hasard, mobile,
//    export, chaîne d'image, studio HDR, volume de bruit, pool de workers,
//    maillage, finitions et matériaux, écran de chargement, feuille de style)
//    sont dans shared/ et le gabarit les importe.
// 2. Inscrit le serveur de développement dans .claude/launch.json.
//
// Le résultat tourne tout de suite : une pièce de démonstration sur un plateau,
// qui fait un nombre entier de tours par boucle. Tout ce qui est propre au thème
// (gen/, scene/, recipe.js, ui.js, loaderArt.js) est ensuite à réécrire. Un module
// de shared/ ne se modifie pas pour un projet : voir shared/README.md.
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

const write = (rel, text) => {
  const f = path.join(dest, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};

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
