// Planche HTML des passes d'une scène, à partir du relevé de tools/passes.mjs : les
// passes dans l'ordre d'exécution, regroupées quand elles se suivent pour le même
// travail (mipmaps, bloom…), avec leur rôle déduit de la pile, leurs cibles et leurs
// vignettes. Page autonome (vignettes incluses).
//
//   node tools/passes-page.mjs <releve.json> <sortie.html>
import { readFileSync, writeFileSync } from 'node:fs';

const [src, out] = process.argv.slice(2);
const R = JSON.parse(readFileSync(src, 'utf8'));
const NAMES = { planetaire_v2: 'Orrery', mega: 'Le relais' };
const title = NAMES[R.name] ?? R.name[0].toUpperCase() + R.name.slice(1);

// ── le rôle d'une passe : le premier motif reconnu sur sa pile ──
const ROLES = [
  [/ShadowNode|ShadowMap/, 'ombre', 'Carte d’ombre', 'La scène vue depuis une lumière : seule la profondeur compte. Chaque pixel éclairé y comparera sa distance à la lumière pour savoir s’il est dans l’ombre.'],
  [/generateMipmaps/, 'mip', 'Mipmaps', 'Versions réduites successives d’une texture (½, ¼, …), pour la lire sans scintillement de loin ou pour en tirer des flous bon marché.'],
  [/PMREMGenerator/, 'pmrem', 'Préfiltrage de l’environnement', 'L’environnement est flouté à plusieurs degrés, un par rugosité : les matériaux mats y lisent un reflet flou, les polis un reflet net.'],
  [/CubeCamera/, 'cube', 'Sonde d’environnement', 'La scène rendue dans six directions depuis un point, pour les reflets et l’éclairage d’ambiance.'],
  [/GTAONode/, 'ao', 'Occlusion ambiante (GTAO)', 'Estime, à partir de la profondeur et des normales, combien chaque point est enfoncé dans un creux : les recoins s’assombrissent.'],
  [/SSRNode/, 'ssr', 'Reflets en espace écran (SSR)', 'Cherche dans l’image déjà rendue ce que chaque surface brillante doit refléter, puis floute selon la rugosité.'],
  [/SSGINode/, 'ssgi', 'Lumière indirecte en espace écran (SSGI)', 'La lumière qui rebondit d’une surface sur sa voisine, estimée à partir de l’image rendue.'],
  [/DepthOfFieldNode/, 'dof', 'Profondeur de champ', 'Calcule pour chaque pixel son flou d’objectif selon sa distance au plan net, puis floute l’image en conséquence.'],
  [/GaussianBlurNode/, 'blur', 'Flou gaussien', 'Un flou en deux temps (horizontal puis vertical), utilisé par un autre effet : halo, brume, profondeur de champ…'],
  [/BloomNode/, 'bloom', 'Bloom', 'Isole les parties les plus lumineuses, les réduit et les floute à plusieurs tailles, puis les ajoute à l’image : le halo des sources fortes.'],
  [/TRAANode/, 'traa', 'Antialiasing temporel (TRAA)', 'Mélange l’image avec les précédentes, recalées grâce aux vitesses : bords lisses et bruit des effets moyenné dans le temps.'],
  [/SMAANode/, 'smaa', 'Antialiasing (SMAA)', 'Détecte les bords en escalier et les adoucit.'],
  [/FXAANode/, 'fxaa', 'Antialiasing (FXAA)', 'Adoucit les bords en escalier en une passe.'],
  [/ViewportTextureNode|ViewportSharedTextureNode|copyFramebufferToTexture/, 'copy', 'Copie de l’image', 'L’image en cours est copiée pour être relue par un matériau (verre, eau : ce qu’on voit à travers).'],
  [/AfterImageNode/, 'trail', 'Rémanence', 'Mélange l’image avec la précédente pour laisser une traînée.'],
  [/LensflareNode|AnamorphicNode/, 'flare', 'Reflets d’objectif', 'Les reflets parasites d’une optique autour des sources fortes.'],
  [/RTTNode/, 'rtt', 'Étape intermédiaire', 'Un calcul de post-traitement rendu dans une texture pour être relu par l’étape suivante (mélange, étalonnage, grain…).'],
  [/PassNode/, 'scene', 'Rendu de la scène', 'Les objets de la scène dessinés avec leurs matériaux et leurs lumières.'],
  [/RenderPipeline|PostProcessing/, 'out', 'Sortie à l’écran', 'La dernière étape : tonemapping, couleurs et assemblage de l’image affichée.'],
];
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// (la description d'une passe du projet : le commentaire d'en-tête de son fichier source)
const head = (file) => {
  const path = join(ROOT, file.replace(/^.*?(?=\w+\/src\/)/, ''));
  if (!existsSync(path)) return '';
  const lines = [];
  for (const l of readFileSync(path, 'utf8').split('\n')) { const m = l.match(/^\s*\/\/ ?(.*)$/); if (!m) break; if (!m[1].trim() && lines.length) break; if (m[1].trim()) lines.push(m[1].trim()); }
  const t = lines.join(' ');
  return t.length > 320 ? t.slice(0, t.lastIndexOf(' ', 310)) + '…' : t;
};
// (son titre : le début de ce commentaire, jusqu'à la première ponctuation, s'il est court)
const short = (d, fallback) => { const t = d.split(/ ?[:,.(;—]/)[0].trim(); return t.length >= 3 && t.length <= 48 ? t[0].toUpperCase() + t.slice(1) : fallback; };
const proj = (p) => p.stack.find((f) => /\w+\/src\//.test(f.file) && !/three/.test(f.file));
const where = (f) => f && `${f.file.replace(/^.*?(?=\w+\/src\/)/, '')}${f.fn ? ' · ' + f.fn.replace(/^Object\./, '') : ''}`;
// (la fonction la plus proche de la passe sur la pile l'emporte : un flou lancé par la
// profondeur de champ est un flou ; une passe ouverte par une copie d'image est la
// reprise du rendu de la scène après cette copie)
function role(p) {
  if (p.kind === 'compute') { const f = proj(p); const hd = f ? head(f.file) : ''; return { key: 'compute:' + where(f), t: short(hd, 'Calcul sur la carte graphique'), d: hd || 'Un programme de calcul (simulation, champ, particules) : il écrit dans des tampons ou des textures, sans rien dessiner.', from: where(f) }; }
  for (const { fn } of p.stack) {
    if (/copyFramebufferToTexture/.test(fn)) return p.kind === 'copy' ? { key: 'vcopy', t: 'Copie de l’image', d: '' } : { key: 'cont', t: 'Rendu de la scène (suite)', d: '' };
    if (p.kind === 'copy' && /TRAANode/.test(fn)) return { key: 'copy:traa', t: 'Historique du TRAA', d: 'L’image et la profondeur de cette image sont gardées pour la suivante, qui s’y recalera.' };
    for (const [re, key, t, d] of ROLES) if (re.test(fn)) {
      if (key === 'out' && !p.targets.some((x) => x.screen)) continue;
      return p.kind === 'copy' ? { key: 'copy:' + key, t: `Copie (${t.toLowerCase()})`, d } : { key, t, d };
    }
  }
  const f = proj(p);
  if (p.kind === 'copy') return { key: 'copy', t: 'Copie de texture', d: 'Une texture recopiée dans une autre.', from: where(f) };
  if (f) { const hd = head(f.file); return { key: 'proj:' + where(f), t: short(hd, 'Rendu propre au projet'), d: hd || 'Un rendu lancé par le code de la scène elle-même : un champ, une simulation ou une texture calculée en dessinant.', from: where(f) }; }
  return { key: 'autre', t: 'Autre passe', d: '' };
}

// ── pré-passe : une passe de scène suivie d'une autre qui écrit plus de cibles ──
const ps = R.passes.map((p) => ({ ...p, role: role(p) }));
const scenes = ps.filter((p) => p.role.key === 'scene');
for (const p of scenes) {
  const n = p.targets.length, later = scenes.filter((q) => q.i > p.i && q.targets.length > n);
  if (later.length) Object.assign(p.role, { key: 'pre', t: 'Pré-passe de la scène', d: 'La scène dessinée une première fois, sans éclairage complet : profondeur et normales pour les effets qui en ont besoin avant l’image (occlusion, reflets).' });
}
// (le rendu principal écrit souvent plusieurs cibles à la fois : couleur, vitesses, normales…)

// ── étapes intermédiaires et sortie : ce qu'elles combinent, qui lit leur résultat
// (relevés récents : chaque passe note les textures qu'elle lit) ──
const nice = (r) => (r.key === 'cont' || /^Rendu de la scène/.test(r.t) ? 'rendu de la scène' : r.t[0].toLowerCase() + r.t.slice(1));
const producer = (id, before) => { for (let j = before - 1; j >= 0; j--) if (ps[j].targets?.some((t) => t.id === id)) return ps[j]; return null; };
for (const p of ps) {
  if (!p.reads || !['rtt', 'out'].includes(p.role.key)) continue;
  const k = ps.indexOf(p);
  const ins = [...new Set(p.reads.map((id) => producer(id, k)).filter(Boolean).map((q) => nice(q.role)))].filter((x) => !x.startsWith('étape intermédiaire'));
  const own = p.targets.map((t) => t.id);
  const next = ps.slice(k + 1).find((q) => q.reads?.some((id) => own.includes(id)));
  const list = (a) => a.length > 1 ? a.slice(0, -1).join(', ') + ' et ' + a.at(-1) : a[0];
  if (p.role.key === 'rtt') {
    p.role = { ...p.role, key: 'rtt:' + k, t: next ? `Étape intermédiaire → ${nice(next.role)}` : p.role.t,
      d: `Un calcul de post-traitement rendu dans une texture${ins.length ? `, à partir de : ${list(ins)}` : ''}${next ? `. L’étape « ${nice(next.role)} » lit ensuite ce résultat.` : '.'}` };
  } else if (ins.length) p.role = { ...p.role, d: `${p.role.d} Elle lit : ${list(ins)}.` };
}

// ── regroupement : passes consécutives du même rôle ; le cycle des objets transparents
// (copie de l'image, mipmaps, reprise du rendu) en une seule étape ──
const GLASS = { key: 'glass', t: 'Objets transparents : l’image copiée sous chaque objet', d: 'Avant chaque objet qu’on voit à travers (verre, eau, membrane), le rendu de la scène s’interrompt : l’image déjà dessinée et sa profondeur sont copiées, réduites en mipmaps pour les flous de rugosité, puis l’objet est dessiné en lisant cette copie. Les vignettes montrent l’image à chaque reprise.' };
const groups = [];
for (const p of ps) {
  const g = groups.at(-1), k = p.role.key;
  if (k === 'vcopy' || k === 'cont' || (k === 'mip' && g?.role.key === 'glass')) {
    if (g?.role.key === 'glass') g.passes.push(p); else groups.push({ role: { ...GLASS }, passes: [p] });
  } else if (g && g.role.key === k && k !== 'scene' && k !== 'pre') g.passes.push(p);
  else groups.push({ role: p.role, passes: [p] });
}
for (const g of groups) if (g.role.key === 'glass') {
  const n = g.passes.filter((p) => p.role.key === 'vcopy' && !p.targets.length && /rgba|bgra/.test(p.what)).length;
  g.role.t = `Objets transparents : ${n} copie${n > 1 ? 's' : ''} de l’image`;
  g.shots = g.passes.filter((p) => p.role.key === 'cont' && p.draws).map((p) => p.targets[0]).filter((t) => t?.url);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fr = (x, d = 0) => x.toLocaleString('fr-FR', { maximumFractionDigits: d });
const FMT = { rgba16float: 'couleur 16 bits flottants', rgba32float: 'couleur 32 bits flottants', rgba8unorm: 'couleur 8 bits', bgra8unorm: 'écran 8 bits', 'rgba8unorm-srgb': 'couleur 8 bits sRGB', rg16float: '2 canaux 16 bits', r16float: '1 canal 16 bits', r8unorm: '1 canal 8 bits', r32float: '1 canal 32 bits', depth24plus: 'profondeur', 'depth24plus-stencil8': 'profondeur + stencil', depth32float: 'profondeur 32 bits', depth16unorm: 'profondeur 16 bits' };
const MODE = { profondeur: 'profondeur (proche = clair)', vecteurs: 'vecteurs (x → rouge, y → vert)', valeurs: 'valeurs (étirées du min au max)', 'lumière (HDR)': 'lumière HDR (exposition de la scène)', couleur: 'couleur' };
// (le nom que three donne à la texture dit souvent ce qu'elle contient)
const LABEL = [
  [/^output$/, 'couleur'], [/^velocity$/, 'vitesses'], [/^normal$/, 'normales'], [/^refl$/, 'réflectance (F0, rugosité)'], [/^diffuse$/, 'couleur diffuse'],
  [/^(depth|depthBuffer|ShadowDepthTexture)$/, 'profondeur'], [/^ShadowMap$/, 'couleur de l’ombre'], [/^GTAONode\.AO$/, 'occlusion'],
  [/^SSRNode\.SSR$/, 'reflets'], [/^SSRNode\.Blur$/, 'reflets floutés'], [/^TRAANode\.resolve$/, 'image lissée'],
  [/NearField$/, 'flou des premiers plans'], [/FarField$/, 'flou des arrière-plans'], [/NearFieldBlurred$/, 'premiers plans floutés'], [/Blur\d+(Near|Far)?$/, 'flou partiel'], [/Composite$/, 'image recomposée'],
  [/bright$/, 'parties lumineuses'], [/\.h(\d)$/, 'flou horizontal, niveau $1'], [/\.v(\d)$/, 'flou vertical, niveau $1'],
  [/horizontal$/, 'flou horizontal'], [/vertical$/, 'flou vertical'],
];
const what = (t) => { if (t.screen) return ''; for (const [re, s] of LABEL) { const m = t.label.match(re); if (m) return s.replace('$1', m[1] ?? ''); } return ''; };
const tgt = (t) => {
  const what = t.screen ? 'l’écran' : `${t.w >> t.mip} × ${t.h >> t.mip}${t.vol ? ` × ${t.l}` : ''}`;
  return `${what} · ${FMT[t.f] ?? t.f}${t.ms > 1 ? ` · MSAA ×${t.ms}` : ''}${t.l > 1 ? ` · ${t.vol ? 'tranche' : 'couche'} ${t.layer + 1}/${t.l}` : ''}${t.mip ? ` · niveau ${t.mip}` : ''}`;
};
// (même règle que la sonde : exposition de la scène pour les textures nommées par three ou à la taille de l'image)
const REF = R.passes.flatMap((p) => p.targets).find((t) => t.label === 'output');
const ownExpo = (t) => !REF || (!t.label && !(t.w === REF.w && t.h === REF.h));
const totals = { passes: ps.filter((p) => p.kind !== 'copy').length, draws: ps.reduce((s, p) => s + (p.draws ?? 0), 0), tris: ps.reduce((s, p) => s + (p.tris ?? 0), 0), compute: ps.filter((p) => p.kind === 'compute').length };

const card = (g, k) => {
  const P = g.passes, n = P.length, first = P[0];
  const draws = P.reduce((s, p) => s + (p.draws ?? 0), 0), tris = P.reduce((s, p) => s + (p.tris ?? 0), 0), disp = P.reduce((s, p) => s + (p.dispatch ?? 0), 0);
  const facts = [
    n > 1 ? `${n} passes` : P[0].kind === 'copy' ? 'copie' : P[0].kind === 'compute' ? 'calcul' : 'une passe',
    draws ? `${fr(draws)} dessin${draws > 1 ? 's' : ''}` : '', tris > 2000 ? `${fr(tris / 1e6, 2)} M triangles` : '', disp ? `${fr(disp)} lancement${disp > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' · ');
  // vignettes : toutes pour une passe, une par passe (la première cible non vide) pour un groupe
  const shots = g.shots ?? (n === 1 ? first.targets.filter((t) => t.url && !(t.empty && first.targets.some((u) => u !== t && !u.empty))) : P.map((p) => p.targets.find((t) => t.url && !t.empty) ?? p.targets[0])
    .filter((t) => t?.url));
  const cap = (t) => `${what(t) ? `<b>${esc(what(t))}</b><br>` : ''}${esc(tgt(t))}<br><span>${esc(t.mode === 'lumière (HDR)' && ownExpo(t) ? 'lumière HDR (exposition propre à l’image)' : MODE[t.mode] ?? t.mode)}${t.empty ? ' · vide' : ''}</span>`;
  const fig = (t) => `<figure><button type="button" aria-label="Agrandir"><img src="${t.url}" width="${t.tw}" height="${t.th}" alt=""></button><figcaption>${cap(t)}</figcaption></figure>`;
  // (la sortie à l'écran, à côté de la capture d'écran de la page : les couleurs doivent concorder)
  if (g.role.key === 'out') shots.splice(0, shots.length, ...shots.filter((t) => !t.depth)); // (la profondeur de l'étape finale n'apprend rien)
  if (g.role.key === 'out' && R.shot) shots.push({ url: R.shot, tw: 1024, th: Math.round(1024 * R.size[1] / R.size[0]), label: '', f: '', mode: '', ref: true });
  const figs = shots.map((t) => t.ref ? `<figure><button type="button" aria-label="Agrandir"><img src="${t.url}" width="${t.tw}" height="${t.th}" alt=""></button><figcaption><b>capture d’écran de la page</b><br>référence pour les couleurs</figcaption></figure>` : fig(t));
  const targets = n === 1 ? '' : `<p class="tg">${esc([...new Set(P.flatMap((p) => p.targets.map(tgt)))].slice(0, 4).join(' ; '))}${P.some((p) => p.targets.length) ? '' : ''}</p>`;
  return `<li class="g ${first.kind}">
  <div class="txt"><span class="k">${String(k + 1).padStart(2, '0')}</span><h2>${esc(g.role.t)}</h2>
    <p class="d">${esc(g.role.d)}</p>${first.what && g.role.key !== 'glass' ? `<p class="tg">${esc(first.what)}</p>` : ''}
    <p class="f">${esc(facts)}${g.role.from ? ` · <code>${esc(g.role.from)}</code>` : ''}</p>${targets}</div>
  ${shots.length ? `<div class="shots${shots.length > 3 ? ' many' : ''}">${figs.join('')}</div>` : ''}
</li>`;
};

const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#050506"><title>${esc(title)} · passes</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,300&family=Inter:wght@300;400&display=swap" rel="stylesheet">
<style>
:root { color-scheme: dark; --bg: #050506; --fg: #ece8e1; --dim: #8f8a82; --gold: #e9c48a; --line: rgba(255, 240, 220, 0.1); }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { background: var(--bg); } body { color: var(--fg); font: 300 15px/1.55 Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
a { color: inherit; text-decoration: none; }
.wrap { max-width: 1240px; margin: 0 auto; padding: 0 16px 64px; }
header { padding: clamp(40px, 8vh, 80px) 0 28px; }
.back { color: var(--dim); font-size: 13px; } .back:hover { color: var(--gold); }
h1 { margin-top: 20px; font: 300 clamp(36px, 6vw, 60px)/1.05 Fraunces, Georgia, serif; }
.lede { margin-top: 14px; max-width: 46em; color: var(--dim); font: italic 300 17px/1.5 Fraunces, Georgia, serif; }
.sum { margin-top: 18px; color: var(--dim); font-size: 13px; } .sum b { color: var(--fg); font-weight: 400; }
ol { list-style: none; border-top: 1px solid var(--line); }
.g { display: grid; grid-template-columns: minmax(260px, 360px) 1fr; gap: 16px 32px; padding: 22px 0; border-bottom: 1px solid var(--line); }
.k { color: var(--gold); font-size: 11px; letter-spacing: .16em; }
h2 { margin-top: 4px; font: 300 22px/1.2 Fraunces, Georgia, serif; }
.d { margin-top: 6px; color: var(--dim); font-size: 13.5px; }
.f, .tg { margin-top: 8px; font-size: 12.5px; color: var(--fg); opacity: .8; } .tg { color: var(--dim); opacity: 1; }
code { font: 400 11.5px ui-monospace, Menlo, monospace; color: var(--gold); opacity: .85; }
.shots { display: flex; flex-wrap: wrap; gap: 12px; align-content: start; }
figure { width: min(100%, 300px); } .many figure { width: 150px; }
figure button { all: unset; display: block; width: 100%; cursor: zoom-in; border-radius: 4px; }
figure button:focus-visible { outline: 1px solid var(--gold); outline-offset: 2px; }
figure button:hover img { border-color: rgba(233, 196, 138, .5); }
/* visionneuse : une image en grand, les flèches feuillettent la série de l'étape */
.lb { position: fixed; inset: 0; z-index: 9; display: none; grid-template-rows: minmax(0, 1fr) auto; place-items: center; gap: 10px; padding: 24px 64px 18px; background: #030304; }
.lb.on { display: grid; }
.lb img { width: 100%; height: 100%; min-height: 0; object-fit: contain; border: 0; border-radius: 2px; cursor: zoom-out; image-rendering: auto; }
.lb .cap { text-align: center; font-size: 13px; color: var(--dim); line-height: 1.45; } .lb .cap b { color: var(--fg); font-weight: 400; } .lb .cap em { color: var(--gold); font-style: normal; }
.lb .nav { all: unset; position: absolute; top: 50%; transform: translateY(-50%); width: 48px; height: 72px; display: grid; place-items: center; color: var(--fg); font-size: 28px; cursor: pointer; opacity: .7; }
.lb .nav:hover, .lb .nav:focus-visible { opacity: 1; color: var(--gold); } .lb .prev { left: 8px; } .lb .next { right: 8px; }
.lb .x { all: unset; position: absolute; top: 12px; right: 18px; font-size: 22px; color: var(--dim); cursor: pointer; } .lb .x:hover { color: var(--fg); }
@media (max-width: 760px) { .lb { padding: 16px 8px 14px; } .lb .nav { top: auto; bottom: 8px; transform: none; } }
img { display: block; width: 100%; height: auto; border-radius: 4px; border: 1px solid var(--line); background: #000; image-rendering: auto; }
figcaption { margin-top: 5px; font-size: 11.5px; color: var(--dim); line-height: 1.4; } figcaption span { opacity: .75; } figcaption b { color: var(--fg); font-weight: 400; }
.copy h2, .copy .d { opacity: .75; }
@media (max-width: 760px) { .g { grid-template-columns: 1fr; } .many figure { width: calc(50% - 6px); } }
</style></head><body><div class="wrap">
<header><a class="back" href="../">← Statistiques</a><h1>${esc(title)} : les passes d’une image</h1>
<p class="lede">Tout ce que la carte graphique exécute pour produire une image de la scène, dans l’ordre. Chaque vignette montre ce que contient la cible de la passe une fois celle-ci terminée.</p>
<p class="sum"><b>${totals.passes}</b> passes${totals.compute ? ` dont <b>${totals.compute}</b> de calcul` : ''} · <b>${fr(totals.draws)}</b> dessins · <b>${fr(totals.tris / 1e6, 1)} M</b> triangles · relevé du ${new Date(R.at).toLocaleDateString('fr-FR')} à ${R.size[0]} × ${R.size[1]}</p></header>
<ol>${groups.map(card).join('\n')}</ol>
</div>
<div class="lb" role="dialog" aria-modal="true" aria-label="Vignette agrandie"><img alt=""><p class="cap"></p>
<button class="nav prev" type="button" aria-label="Précédente">‹</button><button class="nav next" type="button" aria-label="Suivante">›</button><button class="x" type="button" aria-label="Fermer">×</button></div>
<script>
  // visionneuse : clic sur une vignette ; ← → feuillettent les vignettes de la même étape, Échap ferme
  const lb = document.querySelector('.lb'), big = lb.querySelector('img'), cap = lb.querySelector('.cap');
  let set = [], k = 0, from = null;
  const show = () => {
    const f = set[k]; big.src = f.querySelector('img').src;
    cap.innerHTML = f.querySelector('figcaption').innerHTML + (set.length > 1 ? '<br><em>' + (k + 1) + ' / ' + set.length + '</em> · ← → pour feuilleter' : '');
    lb.querySelectorAll('.nav').forEach((b) => (b.hidden = set.length < 2));
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('figure button'); if (!b) return;
    const f = b.closest('figure'); set = [...f.parentElement.querySelectorAll('figure')]; k = set.indexOf(f); from = b;
    show(); lb.classList.add('on'); lb.querySelector('.x').focus();
  });
  const close = () => { lb.classList.remove('on'); from?.focus(); };
  const step = (d) => { k = (k + d + set.length) % set.length; show(); };
  lb.querySelector('.prev').onclick = () => step(-1); lb.querySelector('.next').onclick = () => step(1);
  lb.querySelector('.x').onclick = close; big.onclick = close;
  lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
  document.addEventListener('keydown', (e) => {
    if (!lb.classList.contains('on')) return;
    if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1);
  });
</script>
</body></html>`;
writeFileSync(out, html);
console.log(`${out} : ${groups.length} étapes, ${(html.length / 1024).toFixed(0)} Ko`);
