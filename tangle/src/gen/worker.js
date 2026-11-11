// Worker de génération : la simulation de la corde et la géométrie du banc
// sont calculées hors du fil principal, à partir d'une spécification JSON ;
// les tampons sont transférés sans copie. Les constructeurs sont des
// fonctions pures, importables depuis Node (tests, bancs d'essai).
import { buildNoiseVolume } from './noisevol.js';
import { simulate } from './sim.js';
import { buildBench } from './bench.js';

// live : la simulation envoie en route, par lots, quelques états de la corde
// ({ id, part: { taus, rows, stride, P } }) ; l'écran de chargement les dessine
function simLive(spec, id) {
  let taus = [], rows = [], stride = 0, P = 0, last = performance.now();
  const flush = () => {
    if (!taus.length) return;
    const t = Float32Array.from(taus), r = new Float32Array(rows.length * stride);
    rows.forEach((x, i) => r.set(x, i * stride));
    self.postMessage({ id, part: { taus: t, rows: r, stride, P } }, [t.buffer, r.buffer]);
    taus = []; rows = []; last = performance.now();
  };
  const out = simulate(spec, {
    hz: spec.hz ?? 3000,
    onSnap: (row, tau, p) => {
      stride = row.length; P = p;
      taus.push(tau); rows.push(row.slice());
      if (performance.now() - last > 50) flush();
    },
  });
  flush();
  return out;
}

function build({ spec, what, live, id }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'sim': return live ? simLive(spec, id) : simulate(spec, { hz: spec.hz ?? 3000 });
    case 'bench': return buildBench(spec);
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    const out = build(data);
    const transfer = [];
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) transfer.push(v.buffer); else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
