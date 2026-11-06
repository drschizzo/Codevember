// Cycle de vie d'un système : du nuage à la supernova, puis un nouveau nuage.
//
// Ce module ne simule rien lui-même : il fait avancer une horloge par phase et
// en déduit, à chaque image, les paramètres physiques (masse et luminosité de
// l'étoile, gaz du disque, ligne des glaces, front de dissipation, onde de
// choc…) que main.js transmet au GPU, plus quelques événements ponctuels.
//
// Les durées sont en unités de temps de la simulation (1 orbite à 1 UA = 2π) ;
// la supernova se déroule en secondes réelles, pour rester spectaculaire à
// toute vitesse. Les durées réelles des phases sont indiquées pour mémoire :
// le film est très accéléré, et de façon inégale.

export const PHASES = [
  { id: 'cloud', name: 'Effondrement du nuage', real: '~100 000 ans',
    desc: 'Un nuage de gaz et de poussière s’effondre sous son propre poids. En tournant, il s’aplatit : chaque grain rejoint le disque au rayon fixé par son moment cinétique.' },
  { id: 'proto', name: 'Protoétoile', real: '~1 million d’années',
    desc: 'Au centre, la protoétoile grossit de la matière qui tombe. Elle ne brille que par la chaleur de sa contraction ; deux jets s’échappent le long de l’axe de rotation.' },
  { id: 'disk', name: 'Formation des planètes', real: '1 à 10 millions d’années',
    desc: 'La fusion de l’hydrogène a démarré. Dans le disque, les embryons grossissent, se percutent ; les plus gros captent du gaz et deviennent des géantes. Le gaz du disque se dissipe peu à peu.' },
  { id: 'clear', name: 'Dissipation du disque', real: '~1 million d’années',
    desc: 'Le gaz a disparu. La lumière de l’étoile souffle les poussières fines, les plus grosses spiralent vers elle : le disque se vide de l’intérieur vers l’extérieur. Au-delà reste une ceinture de débris.' },
  { id: 'mature', name: 'Maturité', real: 'quelques millions d’années (étoile massive)',
    desc: 'Le système est formé. L’étoile brille de plus en plus fort en consommant son hydrogène ; les surfaces des planètes évoluent.' },
  { id: 'giant', name: 'Supergéante rouge', real: '~100 000 ans',
    desc: 'Son cœur épuisé, l’étoile enfle et rougit. Elle perd de la masse (les orbites s’élargissent), engloutit les planètes proches et réchauffe les lointaines : les glaces fondent.' },
  { id: 'nova', name: 'Supernova', real: 'quelques heures, puis des siècles',
    desc: 'Le cœur s’effondre en une étoile à neutrons et l’étoile explose. L’onde de choc balaie le système. Ses débris, enrichis en éléments lourds, ensemenceront un nouveau nuage.' },
];

// Durées (unités de simulation ; ×2 par défaut ≈ 1,92 unité/s)
const T_CLOUD = 45, T_PROTO = 40, T_CLEAR = 220, T_MATURE = 160, T_GIANT = 140;
const GAS_TAU = 190;            // dissipation du gaz après l'allumage
const SN_COLLAPSE = 0.9, SN_BOOM = 1.35, SN_END = 17; // secondes (à ×1)

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const mixc = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

const COL_PROTO = [1.0, 0.32, 0.1];
const COL_MAIN = [1.0, 0.82, 0.62];
const COL_GIANT = [1.0, 0.26, 0.06];
const COL_NS = [0.6, 0.75, 1.0];

export function createLifecycle() {
  const life = {
    cycle: 0,
    phase: 0,          // index dans PHASES
    t: 0,              // temps dans la phase (unités de simulation)
    tReal: 0,          // temps réel dans la phase (supernova)
    tIgn: -1,          // temps depuis l'allumage
    gasEnv: 1,         // gaz du disque restant (hors consommation par les planètes)
    // paramètres courants
    p: {},
  };

  function go(i) { life.phase = i; life.t = 0; life.tReal = 0; }

  // gasLeftFrac : gaz réellement restant (après consommation), fourni par main.js
  life.update = (dtSim, dtReal, gasLeftFrac = 1) => {
    const events = [];
    life.t += dtSim;
    life.tReal += dtReal;
    if (life.tIgn >= 0) life.tIgn += dtSim;
    const id = PHASES[life.phase].id;
    const t = life.t;
    const p = {
      Ms: 1, L: 1, color: COL_MAIN, starI: 6, outR: 29, starVisR: 0.15, starR: 0, jets: 0, ambient: 0.04,
      sizeK: 1, gasDens: 1, clearOn: 0, clearR: 0, snA: 0, snR: 0, snW: 1, snHeat: 0, pulsar: 0, spawn: false, shell: 0, shellR: 0,
      progress: 0,
    };

    if (id === 'cloud') {
      const k = t / T_CLOUD;
      p.L = lerp(0.004, 0.03, k); p.starI = lerp(1.2, 2.2, k);
      p.color = COL_PROTO; p.starVisR = lerp(0.05, 0.26, ss(0.1, 1, k));
      p.sizeK = lerp(3.5, 1.8, k); // grains « nébuleux », visibles de loin
      p.jets = ss(0.55, 1, k) * 0.6; p.ambient = lerp(0.7, 0.3, k); // nébuleuse éclairée par les étoiles voisines
      p.progress = k;
      if (t >= T_CLOUD) go(1);
    } else if (id === 'proto') {
      const k = t / T_PROTO;
      p.L = lerp(0.03, 0.12, k); p.starI = lerp(2.2, 2.8, k);
      p.color = COL_PROTO; p.starVisR = lerp(0.26, 0.18, k);
      p.sizeK = lerp(1.8, 1, k);
      p.jets = 0.6 + 0.4 * Math.min(1, k * 3); p.ambient = lerp(0.3, 0.12, k);
      p.progress = k;
      if (t >= T_PROTO) { go(2); life.tIgn = 0; events.push('ignition'); }
    } else if (id === 'disk') {
      const ti = life.tIgn;
      const k = ss(0, 12, ti);
      p.L = lerp(0.12, 1, k); p.color = mixc([1, 0.95, 0.9], COL_MAIN, k);
      p.starI = lerp(14, 6, k); // éclair d'allumage
      p.starVisR = lerp(0.18, 0.15, k);
      p.jets = 1 - ss(0, 30, ti); p.ambient = lerp(0.12, 0.04, ss(0, 20, ti));
      p.spawn = ti > 6 && ti < 90;
      life.gasEnv = Math.exp(-ti / GAS_TAU);
      p.gasDens = Math.min(1, gasLeftFrac / 0.3) * life.gasEnv;
      p.progress = Math.min(1, ti / (GAS_TAU * 3));
      if (gasLeftFrac < 0.04 || life.gasEnv < 0.05) { go(3); events.push('clearing'); }
    } else if (id === 'clear') {
      const k = t / T_CLEAR;
      p.gasDens = 0; p.clearOn = 1;
      p.clearR = lerp(0.3, 7.0, ss(0, 1, k));
      p.progress = k;
      if (t >= T_CLEAR) { go(4); events.push('mature'); }
    } else if (id === 'mature') {
      const k = t / T_MATURE;
      p.gasDens = 0; p.L = lerp(1, 1.5, k);
      p.progress = k;
      if (t >= T_MATURE) { go(5); events.push('giant'); }
    } else if (id === 'giant') {
      const k = t / T_GIANT;
      p.gasDens = 0;
      const g = ss(0, 1, k);
      p.L = lerp(1.5, 45, g * g);
      p.color = mixc(COL_MAIN, COL_GIANT, ss(0, 0.6, k));
      p.starI = lerp(6, 0.85, ss(0, 0.7, k)); // surface froide (~3 500 K) : éclat de surface faible
      p.starVisR = lerp(0.15, 1.35, g);
      p.starR = Math.max(0, p.starVisR * 0.95 - 0.1); // engloutit ce qui passe sous sa surface
      p.Ms = lerp(1, 0.62, g);                         // vent stellaire : perte de masse
      p.progress = k;
      if (t >= T_GIANT) { go(6); events.push('collapse'); }
    } else if (id === 'nova') {
      // (la supernova se joue au plus à ×1 — cf. main.js — : tr en secondes « ×1 »)
      const tr = t / 0.96;
      p.gasDens = 0; p.progress = tr / SN_END;
      if (tr < SN_COLLAPSE) {
        // le cœur s'effondre : l'étoile se rétracte en un instant…
        const k = tr / SN_COLLAPSE;
        p.L = lerp(45, 3, k); p.color = mixc(COL_GIANT, [1, 0.6, 0.4], k);
        p.starVisR = lerp(1.35, 0.04, k * k * k); p.Ms = 0.62; p.starI = lerp(1.4, 3, k);
      } else if (tr < SN_BOOM) {
        // …un instant de silence…
        p.L = 0.3; p.color = [1, 0.7, 0.5]; p.starVisR = 0.04; p.starI = 2; p.Ms = 0.62;
      } else {
        if (!life.boom) { life.boom = true; events.push('supernova'); }
        const ts = tr - SN_BOOM;
        p.Ms = 0.12; // étoile à neutrons : le système n'est plus lié
        p.L = 1 + 600 * Math.exp(-ts * 1.5);
        p.color = mixc([1, 1, 1], COL_NS, ss(0, 3, ts));
        p.starVisR = lerp(0.9, 0.03, ss(0, 0.6, ts)); // boule de feu, puis l'étoile à neutrons
        p.starI = 8 + 60 * Math.exp(-ts * 2.5);
        p.outR = 60;
        p.snR = 2.6 * ts; p.snW = 0.4 + 0.1 * p.snR; p.snA = 30 * Math.exp(-ts / 5);
        p.snHeat = Math.exp(-ts / 6);
        p.shell = ss(0.3, 2, ts) * (0.5 + 0.5 * Math.exp(-ts / 10)); p.shellR = p.snR * 1.04;
        p.pulsar = ss(2, 5, ts);
      }
      if (tr >= SN_END) {
        life.cycle++; life.boom = false; life.tIgn = -1; life.gasEnv = 1;
        go(0); events.push('newcycle');
      }
    }
    if (life.phase < 2) p.gasDens = 1;
    p.snow = 2.7 * Math.sqrt(Math.max(p.L, 0.003));
    life.p = p;
    return events;
  };

  life.reset = () => { life.cycle = 0; life.tIgn = -1; life.gasEnv = 1; life.boom = false; go(0); };
  life.reset();
  return life;
}
