// Planètes côté CPU : lecture de l'état GPU, petite sous-simulation
// de l'aspect des surfaces, noms et libellés de l'interface.
import { M, M_EARTH } from '../sim.js';
import { provenanceRGB } from '../palette.js';
import { ss } from '../util.js';

// Au-dessous de cette masse (M⊕), un corps reste un « embryon » : ni liste, ni note.
export const MIN_PLANET = 0.3;

// ── Libellés ────────────────────────────────────────────────────────────────
const NAMES = 'Aube Brume Cendre Dune Écume Faille Givre Houle Iris Jade Kaolin Lave Mica Nacre Onyx Perle Quartz Rouille Sel Talc Ulve Vesta Wolfram Xénon Yule Zircon Ambre Basalte Corail Diorite Éther Fusain'.split(' ');
export const nameOf = (i) => NAMES[i % NAMES.length] + (i >= NAMES.length ? ' II' : '');
export const fmtMass = (mE, plain) => (mE >= 30 ? `${(mE / 317.8).toFixed(2)} M${plain ? 'J' : '<sub>J</sub>'}` : `${mE.toFixed(mE < 1 ? 2 : 1)} M⊕`);
export const kindOf = (p) => (p.mE < MIN_PLANET ? 'embryon' : p.gasF > 0.5 ? 'géante gazeuse' : p.gasF > 0.08 ? 'mini-Neptune' : p.ice > 0.35 ? 'glacée' : 'rocheuse');
export function surfaceOf(p) {
  const e = p.evo;
  if (!e) return '';
  if (p.gasF > 0.5) return e.heat > 0.3 ? 'jeune géante encore chaude' : 'atmosphère en bandes';
  if (p.gasF > 0.08) return 'enveloppe d’hydrogène épaisse';
  if (e.molten > 0.5) return 'océan de magma';
  if (e.hot > 0.5) return 'atmosphère épaisse et brûlante';
  if (e.ocean > 0.3) return 'océans d’eau liquide';
  if (e.iceSurf > 0.3) return 'surface glacée';
  if (e.craters > 0.4) return 'surface criblée de cratères';
  return 'surface rocheuse';
}

// ── Lecture de l'état GPU ─────────────────────────────────────────────────────
export function readPlanets({ pos, tot, gas }) {
  const list = [];
  for (let i = 0; i < M; i++) {
    const o = i * 4, m = pos[o + 3];
    if (m <= 0) continue;
    const x = pos[o], y = pos[o + 1], z = pos[o + 2];
    const g = gas[o + 1], solid = Math.max(m - g, 1e-20);
    const meanR = tot[o + 1] / solid;
    list.push({
      index: i, x, y, z, a: Math.hypot(x, z), m, mE: m / M_EARTH,
      gas: g, gasF: g / m, ice: tot[o] / solid, meanR, rate: tot[o + 2],
      color: provenanceRGB(meanR),
    });
  }
  return list;
}

// ── Évolution des surfaces ────────────────────────────────────────────────────
// Chaque planète a une petite « vie » qui pilote l'aspect de sa surface :
//  · chaleur interne : l'accrétion et les impacts géants la chauffent (océan
//    de magma, fissures incandescentes), elle refroidit ensuite d'autant plus
//    lentement qu'elle est massive ;
//  · cratères : une surface solide sans atmosphère se cratérise avec l'âge,
//    la fusion (magma, impact) efface tout ;
//  · eau : apportée par la matière née au-delà de la ligne des glaces, son état
//    dépend de la température d'équilibre : vapeur, océans ou banquise ;
//  · atmosphère : retenue seulement au-dessus de ~0,2 M⊕ ; fine et bleue si
//    tempérée, épaisse et jaunâtre (effet de serre) si chaude ;
//  · géantes : jeunes et chaudes (lueur rouge, bandes floues), elles se
//    contrastent en refroidissant.
// setEvo(i, [chaleur, océans, banquise, cratères], [atmo, chaude, âge, T_eq])
// transmet l'état au shader des planètes.
export function createEvolution(setEvo) {
  const evo = new Map(); // index → état
  let lastT = null;
  const fin = (v) => (Number.isFinite(v) ? v : 0); // (une valeur non finie contaminerait l'écran via le bloom)

  return {
    get: (i) => evo.get(i),
    clear() { evo.clear(); },

    // L : luminosité de l'étoile (unités solaires)
    update(planets, simTime, L) {
      const dt = Math.max(0, Math.min(5, simTime - (lastT ?? simTime)));
      lastT = simTime;
      for (const p of planets) {
        let e = evo.get(p.index);
        if (!e) { e = { heat: 0.85, craters: 0, born: simTime }; evo.set(p.index, e); }
        const mE = Math.max(p.mE, 0.02);
        const tau = 12 * Math.pow(mE, 0.35);                                  // refroidissement
        const src = Math.min(0.5, 1.5 * p.rate / mE);                         // chauffage par accrétion
        e.heat = fin(Math.min(1, Math.max(0, e.heat + dt * (src - e.heat / tau))));
        const Teq = 278 * Math.pow(L, 0.25) / Math.sqrt(Math.max(p.a, 0.2)); // K
        const atmo = p.gasF > 0.08 ? 1 : ss(0.15, 1.5, mE) * ss(800, 400, Teq + 150 / mE);
        e.craters = fin(Math.min(1, e.craters + dt * 0.012 * (1 - atmo)) * Math.exp(-e.heat * e.heat * dt * 0.6));
        const water = Math.max(p.ice, ss(0.9, 3.2, p.meanR) * 0.85); // matière hydratée née au-delà des glaces
        const molten = ss(0.35, 0.6, e.heat);
        const ocean = Teq > 180 && Teq < 330 ? water * (1 - molten) : 0;
        const iceSurf = Teq <= 180 ? water * (1 - molten) : 0;
        const hot = ss(300, 420, Teq) * atmo;
        const age = (simTime - e.born) / (2 * Math.PI);
        Object.assign(e, { atmo, water, ocean, iceSurf, hot, Teq, age, molten });
        p.evo = e;
        setEvo(p.index, [e.heat, ocean, iceSurf, e.craters].map(fin), [atmo, hot, Math.min(1, age / 60), Teq / 1000].map(fin));
      }
      for (const i of evo.keys()) if (!planets.some((p) => p.index === i)) evo.delete(i);
    },

    // un impact géant fond la surface : océan de magma, cratères effacés
    impact(i, mImpactor, mTarget) {
      const e = evo.get(i);
      if (e) { e.heat = Math.min(1, e.heat + 0.45 + 1.5 * mImpactor / Math.max(mTarget, 0.05)); e.craters *= 0.15; }
    },
  };
}
