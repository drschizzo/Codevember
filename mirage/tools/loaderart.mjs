// Le dessin de l'écran de chargement, rendu dans Node en SVG (le worker ne
// tourne pas quand le panneau est masqué) : un contexte 2D qui enregistre.
//   node tools/loaderart.mjs <graine> <sortie.svg> [avancement] [temps]
import fs from 'node:fs';
import { generate } from '../src/recipe.js';
import createArt from '../src/app/loaderArt.js';
const [seed = 'd4', out = 'art.svg', p = '0.6', tt = '3'] = process.argv.slice(2);
const W = 1280, H = 800;
const parts = [];
let path = '', st = {};
const ctx = {
  set globalAlpha(v) { st.ga = v; }, get globalAlpha() { return st.ga ?? 1; },
  set strokeStyle(v) { st.ss = v; }, set fillStyle(v) { st.fs = v; }, set lineWidth(v) { st.lw = v; },
  beginPath() { path = ''; }, moveTo(x, y) { path += `M${x.toFixed(1)} ${y.toFixed(1)}`; }, lineTo(x, y) { path += `L${x.toFixed(1)} ${y.toFixed(1)}`; },
  arc(x, y, r) { path += `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`; },
  stroke() { parts.push(`<path d="${path}" fill="none" stroke="${st.ss}" stroke-width="${st.lw ?? 1}" opacity="${st.ga ?? 1}"/>`); },
  fill() { parts.push(`<path d="${path}" fill="${st.fs}" opacity="${st.ga ?? 1}"/>`); },
  strokeRect(x, y, w, h) { parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${st.ss}" stroke-width="${st.lw ?? 1}" opacity="${st.ga ?? 1}"/>`); },
  fillRect(x, y, w, h) { parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${st.fs}" opacity="${st.ga ?? 1}"/>`); },
};
const R = generate(seed);
const art = createArt();
art.data({ seed: R.seed, family: R.family, f: R.mirascope.f, liftMax: R.mirascope.liftMax });
const S = { w: W, h: H, dpr: 1, t: +tt, dt: 0.016, p: +p, done: 0 };
for (let i = 0; i < 12; i++) { parts.length = 0; art.draw(ctx, S); } // (le budget de rayons neufs par image)
fs.writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#050506"/>${parts.join('')}</svg>`);
