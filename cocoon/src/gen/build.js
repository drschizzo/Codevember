// Construction complète d'une scène à partir de la spécification du bobinage
// (recipe.windSpec) : tout ce que la scène affiche et lit. Module pur.
import { windCocoon, threadSegments, bandCenter } from './winding.js';
import { thetaTable } from './profile.js';
import { layout, eyeTable, buildColumn, buildBeam, buildStation, buildYoke, buildCarriage, buildEye, buildProxy } from './apparatus.js';

export function buildScene(spec, onProgress = null) {
  const t0 = Date.now();
  const W = windCocoon(spec, (p) => onProgress?.(0.75 * p));
  const seg = threadSegments(W);
  onProgress?.(0.8);
  const band = bandCenter(W);
  const E = eyeTable(W.P, band, W.env, W.grid, { spinneret: spec.family === 'huit' });
  onProgress?.(0.9);
  const lay = layout(W.P);
  const P = W.P;
  const out = {
    seg, band, eye: E,
    cookie: W.cook, grid: { Ns: W.grid.Ns, Np: W.grid.Np, cs: W.grid.cs, cp: W.grid.cp },
    theta: thetaTable(P, 0, 512),
    profile: { r: Float32Array.from(P.r), y: Float32Array.from(P.y), dr: Float32Array.from(P.dr), dy: Float32Array.from(P.dy), len: P.len, sLo: P.sLo, sHi: P.sHi, H: P.H, hub: P.hub, rMax: P.rMax },
    env: W.env,
    marks: W.path.marks, total: W.path.total, m: W.m, nb: W.nb,
    lay,
    geo: {
      column: buildColumn(lay), beam: buildBeam(lay), station: buildStation(P, lay, spec.cage),
      yoke: buildYoke(lay, E, P), carriage: buildCarriage(), eyeRing: buildEye(), proxy: buildProxy(P, W.env, W.grid),
    },
    ms: Date.now() - t0,
  };
  onProgress?.(1);
  return out;
}
