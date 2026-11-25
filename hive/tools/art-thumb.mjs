// Vignette de l'accueil : le dessin de l'écran de chargement (même tracé que
// src/app/loaderArt.js), sorti en JSON pour tools/art-thumb.py.
import { generate } from '../src/recipe.js';
import { track, tileAt, elements, applyIso } from '../src/gen/tiling.js';
import { hatPatch, hatParams, hatTile } from '../src/gen/hat.js';
const T = generate(process.argv[2] || 'h98').comb.lobes[0].tiling, psi = +(process.argv[3] || 0.3), p = +(process.argv[4] || 0.62);
if (T.group === 'hat') {
  // (le chapeau : même tracé que l'écran de chargement, tuiles du centre vers le bord, anti-chapeaux teintés)
  const H = hatPatch(2), P = hatParams(T.loop, psi), P0 = hatParams(T.loop, 0);
  const c = H.tiles.map((t) => { const q = hatTile(t, P0.a, P0.b); return [q[0], q[1]]; });
  let cx = 0, cy = 0; for (const q of c) { cx += q[0]; cy += q[1]; } cx /= c.length; cy /= c.length;
  const order = H.tiles.map((t, i) => ({ t, r: Math.hypot(c[i][0] - cx, c[i][1] - cy) })).sort((a, b) => a.r - b.r);
  const mid = hatTile(order[0].t, P.a, P.b), shown = Math.floor(order.length * Math.min(1, 0.08 + p * 1.05)), out = [];
  for (let e = 0; e < shown; e++) { const Q = hatTile(order[e].t, P.a, P.b), q = []; for (let i = 0; i < Q.length; i += 2) q.push(Q[i] - mid[0], Q[i + 1] - mid[1]); out.push({ q, d: Math.hypot(Q[0] - mid[0], Q[1] - mid[1]), fresh: e > shown - 4, honey: !!order[e].t.mir }); }
  await new Promise((done) => process.stdout.write(JSON.stringify(out), done)); // (attendre que tout soit écrit avant de sortir)
  process.exit(0);
}
const tr = track(T.group, T.path);
const els = elements(T.group, 4.6).map((g) => ({ g, r: Math.hypot(g.tx, g.ty) })).sort((a, b) => a.r - b.r);
const P = tileAt(T.group, T.path, tr, T.profiles, psi, 8, T.amp);
let ox = 0, oy = 0; for (let i = 0; i < P.length; i += 2) { ox += P[i]; oy += P[i + 1]; } ox /= P.length / 2; oy /= P.length / 2;
const shown = Math.floor(els.length * Math.min(1, 0.08 + p * 1.05)), out = [];
for (let e = 0; e < shown; e++) { const q = []; for (let i = 0; i < P.length; i += 2) { const v = applyIso(els[e].g, [P[i], P[i + 1]]); q.push(v[0] - ox, v[1] - oy); } const c = applyIso(els[e].g, [ox, oy]); out.push({ q, d: Math.hypot(c[0] - ox, c[1] - oy), fresh: e > shown - 4, honey: e % 5 === 0 }); }
process.stdout.write(JSON.stringify(out));
