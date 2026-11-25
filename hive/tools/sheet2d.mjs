// Planche 2D : le pavage à plusieurs phases, pour juger les formes (JSON → tools/sheet2d.py)
import { track, tileAt, elements, applyIso } from '../src/gen/tiling.js';
const cases = JSON.parse(process.argv[2]);
const out = [];
for (const c of cases) {
  const tr = track(c.group, c.path); const els = elements(c.group, 4.2);
  const row = [];
  for (let k = 0; k < c.n; k++) {
    const T = tileAt(c.group, c.path, tr, c.profiles, k / c.n, 14, c.amp ?? 1);
    row.push(els.map((g) => { const P = []; for (let i = 0; i < T.length; i += 2) { const p = applyIso(g, [T[i], T[i+1]]); P.push(+p[0].toFixed(3), +p[1].toFixed(3)); } return P; }));
  }
  out.push(row);
}
process.stdout.write(JSON.stringify(out));
