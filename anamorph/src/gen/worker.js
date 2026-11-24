// Worker de génération : toute la géométrie (et toute simulation lourde) est
// construite hors du fil principal, à partir d'une spécification JSON ; les
// tampons sont transférés sans copie. Les constructeurs sont des fonctions
// pures, importables depuis Node (tests, bancs d'essai).
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { Buffers, roundedBox, gem, torus, lathe, sharpProfile, OUT, IN, EDGE, norm, cross, sub } from '../../../shared/gen/mesh.js';
import { createRng } from '../../../shared/rng.js';
import { setupFigures, solvePlacement, voxelHull, hullSDF, fromFigure, toFigure, shadowOf } from './shadowart.js';
import { coverWithPieces, ACCORDS } from './pieces.js';
import { forgeMesh } from './forge.js';
import { computeDrift } from './drift.js';
import { planAssembly } from './assembly.js';
import { surfaceNets } from './nets.js';

// L'objet : placement des deux figures, coque, maillage (famille « bloc taillé »).
// spec : { seed, lat, dec, height, camAz, figs: [{ name, H }], cell }
export function buildObject(spec, progress = () => {}) {
  const F = setupFigures(spec);
  const rng = createRng(`${spec.seed}:placement`);
  // avancement (écran de chargement) : 0–0,2 placement, 0,2–0,92 pièces, puis maillage
  progress(0.02, JSON.stringify({ figs: F.map((f) => f.name) }));
  const best = solvePlacement(F, spec.height, rng.next, { onStep: (f) => { if ((f * 160 | 0) % 16 === 0) progress(0.02 + 0.18 * f, ''); } });
  // emprise : d'après la coque en voxels
  const Hv = voxelHull(F, spec.height, 1.4, 112, 64);
  const lo = [Infinity, 0, Infinity], hi = [-Infinity, spec.height, -Infinity];
  const { vox, N, NY, box } = Hv;
  for (let iy = 0; iy < NY; iy++) for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) if (vox[(iy * N + iz) * N + ix]) {
    const x = -box + (ix + 0.5) * 2 * box / N, z = -box + (iz + 0.5) * 2 * box / N;
    lo[0] = Math.min(lo[0], x); hi[0] = Math.max(hi[0], x); lo[2] = Math.min(lo[2], z); hi[2] = Math.max(hi[2], z);
  }
  const m = 0.06, cell = spec.cell ?? 0.01;
  const sdf = hullSDF(F, spec.height);
  let mesh, bars = null, coverage = best.cov, drift = null, assembly = null;
  if (spec.family === 'bloc') {
    mesh = surfaceNets(sdf, [lo[0] - m, -3 * cell, lo[2] - m], [hi[0] + m, spec.height + 3 * cell, hi[2] + m], cell).out();
  } else {
    // ferronnerie : barres soudées tirées dans la coque (src/gen/pieces.js)
    // l'écran de chargement dessine l'ombre de chaque pièce posée, sur les deux figures
    let batch = [];
    const onStep = (n, cov, P) => {
      for (let k = 0; k < F.length; k++) {
        const f = F[k];
        const [a0, b0] = toFigure(f, ...shadowOf(f, ...P.p0)), [a1, b1] = toFigure(f, ...shadowOf(f, ...P.p1));
        batch.push([k, +a0.toFixed(4), +b0.toFixed(4), +a1.toFixed(4), +b1.toFixed(4), +(P.r / f.scale).toFixed(4)]);
      }
      if (n % 6 === 0) {
        progress(0.2 + 0.72 * Math.min(1, Math.min(...cov) / 0.8), JSON.stringify({ strokes: batch, cov }));
        batch = [];
      }
    };
    const res = coverWithPieces(F, sdf, [lo[0], 0, lo[2], hi[0], spec.height, hi[2]], createRng(`${spec.seed}:pieces`).next, { onStep, accord: spec.accord });
    if (batch.length) progress(0.92, JSON.stringify({ strokes: batch, cov: res.coverage }));
    bars = res.pieces; coverage = res.coverage;
    mesh = forgeMesh(bars, createRng(`${spec.seed}:forge`).next, spec.accord, ACCORDS[spec.accord]?.joint);
    drift = computeDrift(bars, [lo[0], 0, lo[2], hi[0], spec.height, hi[2]]);
    // l'assemblage : place au sol, ordre, approche de chaque pièce (16 nombres par pièce)
    const plan = planAssembly(bars, [lo[0], 0, lo[2], hi[0], spec.height, hi[2]], createRng(`${spec.seed}:assemblage`).next, { height: spec.height });
    const A = new Float32Array(plan.length * 16);
    plan.forEach((p, i) => A.set([...p.cf, ...p.g.c, ...p.g.q, ...p.v, p.S, p.alt, p.k], i * 16));
    assembly = { data: A, n: plan.length, free: plan.filter((p) => p.free).length };
  }
  return {
    mesh, bars, coverage, drift, assembly,
    placement: F.map((f) => ({ name: f.name, a0: f.a0, b0: f.b0, scale: f.scale, u: f.u, v: f.v, h: f.sun.h, az: f.sun.az, center: fromFigure(f, 0.5, 0), len: f.scale })),
    bounds: [lo[0] - m, 0, lo[2] - m, hi[0] + m, spec.height, hi[2] + m],
  };
}

// (À REMPLACER : un constructeur par nature de pièce du thème)
function buildPiece({ kind, size, round }) {
  const B = new Buffers();
  if (kind === 'hero') {
    roundedBox(B, [0, 0, 0], [size, size, size], round * size * 2, 10, EDGE, OUT);
    torus(B, [0, 0, 0], size * 1.45, size * 0.05, 96, 16, EDGE);
  } else {
    gem(B, [0, 0, 0], size, OUT);
  }
  return B.out();
}

function build({ spec, what, id }) {
  const progress = (p, label) => self.postMessage({ id, progress: p, label });
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'piece': return buildPiece(spec);
    case 'object': return buildObject(spec, progress);
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
