// Contrôle des accords de matières (src/recipe.js) : pour chaque accord de
// chaque humeur, toutes variantes dépliées, la part de la machine en métal
// chaud (or, laiton, cuivre, bronze : pondérée par la surface de chaque rôle) et le
// nombre de familles de matières ; puis les mêmes mesures sur des graines.
//
//   node tools/accords.mjs [nombre de graines]
import { MOODS, MATTERS, ACCORD_ROLES, generate } from '../src/recipe.js';

// surface approximative de chaque rôle dans l'image
const AREA = { plate: 3.5, gears: 2.5, foot: 2.5, arms: 1.5, arms2: 0.75, pins: 0.75 };
const TOTAL = Object.values(AREA).reduce((a, b) => a + b, 0);
const FAMILY = {
  chaud: ['or', 'orRose', 'laiton', 'laitonBrosse', 'cuivre', 'bronze'], // (le bronze patiné brille orangé sous la lampe)
  blanc: ['acierPoli', 'acierBrosse', 'chrome', 'argent', 'maillechort'],
  sombre: ['acierNoirci', 'fonte', 'ruthenium', 'ardoise', 'laqueNoire', 'marbreNoir', 'ebene'],
  couleur: ['acierBleui', 'emailBleu', 'emailRouge', 'titane', 'bronzeVert'],
  pale: ['porcelaine', 'marbreBlanc', 'nacre'],
  bois: ['noyer'],
};
const familyOf = (k) => Object.keys(FAMILY).find((f) => FAMILY[f].includes(k));
const MAX_WARM = 0.45, MIN_FAMILIES = 3;

function measure(matters) {
  let warm = 0;
  const fams = new Set();
  for (const role of ACCORD_ROLES) {
    const f = familyOf(matters[role]);
    if (!MATTERS[matters[role]]) throw new Error(`matière inconnue : ${matters[role]}`);
    if (!f) throw new Error(`matière sans famille : ${matters[role]}`);
    fams.add(f);
    if (f === 'chaud') warm += AREA[role];
  }
  const both = familyOf(matters.plate) === 'chaud' && familyOf(matters.gears) === 'chaud';
  return { warm: warm / TOTAL, families: fams.size, flat: both || matters.plate === matters.foot || matters.arms === matters.arms2 };
}

const unfold = (acc) => acc.reduce((list, slot) => list.flatMap((l) => (Array.isArray(slot) ? slot : [slot]).map((v) => [...l, v])), [[]]);

let bad = 0, count = 0;
for (const [key, M] of Object.entries(MOODS)) {
  console.log(`\n${M.label}`);
  M.accords.forEach((acc, i) => {
    for (const v of unfold(acc)) {
      const matters = Object.fromEntries(ACCORD_ROLES.map((r, j) => [r, v[j]]));
      const m = measure(matters);
      const ok = m.warm <= MAX_WARM && m.families >= MIN_FAMILIES && !m.flat;
      count++; if (!ok) bad++;
      console.log(`  ${ok ? ' ' : '✗'} ${i + 1}  chaud ${(m.warm * 100).toFixed(0).padStart(2)} %  familles ${m.families}  ${v.map((k) => MATTERS[k].label).join(' · ')}`);
    }
  });
}
console.log(`\n${count} accords, ${bad} hors règle (métal chaud ≤ ${MAX_WARM * 100} %, jamais plateau et roues à la fois, ≥ ${MIN_FAMILIES} familles, plateau ≠ bâti, bras ≠ bras alternés)`);

// sur des graines : trois mondes par scène
const n = Number(process.argv[2] ?? 300);
let warmSum = 0, warmMax = 0, cool = 0;
const moods = {};
for (let s = 0; s < n; s++) {
  const R = generate(String(s));
  if (R.layers.some((L) => ['observatoire', 'clinique'].includes(L.mood))) cool++;
  if (new Set(R.layers.map((L) => L.mood)).size !== R.layers.length) bad++;
  for (const L of R.layers) {
    const m = measure(L.matters);
    warmSum += m.warm; warmMax = Math.max(warmMax, m.warm);
    moods[L.mood] = (moods[L.mood] || 0) + 1;
  }
}
console.log(`${n} graines : métal chaud ${(warmSum / n / 3 * 100).toFixed(0)} % en moyenne, ${(warmMax * 100).toFixed(0)} % au plus ; ${cool} scènes sur ${n} ont un monde froid ou clair`);
console.log('humeurs :', moods);
process.exit(bad ? 1 : 0);
