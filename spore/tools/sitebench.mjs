// Mesure de la génération d'un site dans Node (temps, tailles, invariants).
import { buildSite } from '../src/gen/site.js';
import { generate } from '../src/recipe.js';
for (const sd of (process.argv[2] || 'a1,b2:stemonitis,c3:arcyria,d4:hemitrichia').split(',')) {
  const [s, fam] = sd.split(':');
  const R = generate(s, fam ? { family: fam } : {});
  const t0 = performance.now();
  const S = buildSite({ R });
  const ms = performance.now() - t0;
  const landed = [];
  for (let i = 0; i < S.spores.count; i++) landed.push(S.spores.a2[i * 4 + 3]);
  landed.sort((a, b) => a - b);
  console.log(sd, R.family, R.species, `${ms.toFixed(0)} ms`, JSON.stringify(S.stats), 'veins v', S.veins.count, 'tri', S.veins.index.length / 3,
    'tpl v', S.template ? S.template.position.length / 3 : 0, 'chute s p10/50/90', [0.1, 0.5, 0.9].map((q) => landed[Math.floor(q * landed.length)]?.toFixed(3)));
}
