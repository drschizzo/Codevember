// Worker de génération : tout calcul lourd (transport optimal, spectres,
// géométrie) est fait hors du fil principal, à partir d'une spécification
// JSON ; les tampons sont transférés sans copie. Les constructeurs sont des
// fonctions pures, importables depuis Node (tests, bancs d'essai).
import { buildNoiseVolume } from './noisevol.js';
import { buildEvent } from './lens.js';
import { ambientSpectrum } from './ambient.js';
import { buildApparatus } from './apparatus.js';

let current = 0;
// avancement : la grille du transport (quelques nœuds), pour l'écran de chargement
function progressOf(spec) {
  let last = 0;
  return (it, res, u, M) => {
    const now = performance.now();
    if (now - last < 60 && it > 0) return;
    last = now;
    // ∇u sur une grille de 33×33 nœuds
    const n = 33, h = 1 / (M - 1), out = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const I = Math.max(1, Math.min(M - 2, Math.round((i / (n - 1)) * (M - 1)))), J = Math.max(1, Math.min(M - 2, Math.round((j / (n - 1)) * (M - 1))));
      const k = J * M + I;
      out[(j * n + i) * 2] = (u[k + 1] - u[k - 1]) / (2 * h);
      out[(j * n + i) * 2 + 1] = (u[k + M] - u[k - M]) / (2 * h);
    }
    self.postMessage({ id: current, progress: { event: spec.index ?? 0, it, res, grid: out, n } }, [out.buffer]);
  };
}

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'event': {
      const ev = buildEvent({ ...spec, onStep: progressOf(spec) });
      const NN = spec.N * spec.N, inter = new Float32Array(NN * 2);
      for (let i = 0; i < NN; i++) { inter[2 * i] = ev.spec.re[i]; inter[2 * i + 1] = ev.spec.im[i]; }
      // (la cible, réduite, pour l'écran de chargement)
      const nt = 64, t = new Float32Array(nt * nt), s = 256 / nt;
      for (let j = 0; j < nt; j++) for (let i = 0; i < nt; i++) t[j * nt + i] = ev.nu[(j * s + (s >> 1)) * 256 + i * s + (s >> 1)];
      return { inter, lens: ev.lens, target: t, nt };
    }
    case 'ambient': return { inter: ambientSpectrum(spec) };
    case 'apparatus': return buildApparatus(spec);
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    current = data.id;
    const out = build(data);
    const transfer = [];
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) transfer.push(v.buffer); else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
