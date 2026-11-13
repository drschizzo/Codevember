// Banc : construit chaque variante et écrit ses sommets (profil de face) pour une planche
import { buildVessel, VARIANTS } from '../src/gen/vessels.js';
import { writeFileSync } from 'node:fs';
const out = [];
for (const v of Object.keys(VARIANTS)) {
  const t0 = performance.now();
  const { parts, meta } = buildVessel({ variant: v, flare: 0.5, flutes: v === 'tulipe' ? 24 : 0, spoonAz: 0 });
  const pts = [];
  let bad = 0;
  for (const [name, P] of Object.entries(parts)) {
    if (!P) continue;
    for (let i = 0; i < P.position.length; i += 3) {
      if (!Number.isFinite(P.position[i] + P.position[i + 1] + P.position[i + 2] + P.normal[i] + P.normal[i + 1] + P.normal[i + 2])) bad++;
      if (i % 2 === 0) pts.push([+P.position[i].toFixed(3), +P.position[i + 1].toFixed(3), +P.position[i + 2].toFixed(3), name === 'metal' ? 1 : name === 'liquidBody' ? 2 : 0]);
    }
  }
  console.log(v.padEnd(9), 'sommets', Object.values(parts).reduce((a, P) => a + (P ? P.position.length / 3 : 0), 0), 'NaN', bad, 'haut', meta.top.toFixed(2), 'liquide', meta.liquid.y.toFixed(2), meta.liquid.r.toFixed(2), 'pointe', meta.strike?.map((x) => x.toFixed(2)).join(','), Math.round(performance.now() - t0) + ' ms');
  out.push({ v, pts, meta: { strike: meta.strike, liquid: meta.liquid } });
}
writeFileSync(process.argv[2], JSON.stringify(out));
