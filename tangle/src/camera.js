// La caméra du film : une grue lente qui suit le geste.
//
// Grammaire : la caméra regarde le banc de trois quarts, un peu de côté
// (R.camera.side) ; elle monte et descend avec ce qui se passe (le centre de
// l'enroulement, le balancier qui remonte), se rapproche quand la corde est
// droite et recule un peu quand la torsade s'étend ; elle se balance d'un
// seul mouvement lent par boucle. Tout est calculé une fois, sur la
// trajectoire échantillonnée à 30 images par seconde de film, puis lissé par
// un noyau gaussien périodique (σ = 1,2 s) : la boucle se referme, la vitesse
// angulaire et l'accélération restent bornées (voir test/camera.test.mjs).
// Module pur.
import { sampleSim } from './track.js';

const TAU = Math.PI * 2;

export function cameraPath(S, R, { S: scale, Y0 }) {
  const nf = S.nf, T = S.T;
  const ty = new Float64Array(nf), spread = new Float64Array(nf);
  let st = null;
  for (let f = 0; f < nf; f++) {
    st = sampleSim(S, f / S.fps, st ?? undefined);
    const o = st.buf;
    // centre du désordre : sommets pondérés par leur écart à l'axe
    let sw = 0, sy = 0, sr = 0;
    for (let v = 0; v < S.nv; v++) {
      const x = o[v * 3], y = o[v * 3 + 1], z = o[v * 3 + 2], r = Math.hypot(x, z);
      const w = r * r + 1e-5;
      sw += w; sy += w * y; sr = Math.max(sr, r);
    }
    const mid = (0 + st.flyY) / 2;
    const k = Math.min(1, sr / 0.05);
    ty[f] = mid * (1 - k * 0.6) + (sy / sw) * k * 0.6;
    spread[f] = sr;
  }
  // lissage gaussien périodique
  const smooth = (a, sigma) => {
    const s = sigma * S.fps, rad = Math.ceil(3 * s), w = [];
    for (let i = -rad; i <= rad; i++) w.push(Math.exp(-(i * i) / (2 * s * s)));
    const ws = w.reduce((x, y) => x + y, 0), out = new Float64Array(nf);
    for (let f = 0; f < nf; f++) { let acc = 0; for (let i = -rad; i <= rad; i++) acc += a[(((f + i) % nf) + nf) % nf] * w[i + rad]; out[f] = acc / ws; }
    return out;
  };
  // le cadre : du haut du moteur au-dessous du balancier, centré sur ce qui bouge
  const top = Y0 + 0.22 * scale;
  const fly = new Float64Array(nf);
  for (let f = 0; f < nf; f++) fly[f] = Y0 + (sampleSim(S, f / S.fps, st).flyY - 0.06) * scale;
  const ys = smooth(ty, 1.2), fs = smooth(fly, 1.0);
  const C = R.camera;
  const frames = new Float64Array(nf * 7);
  const tanH = Math.tan((C.fov * Math.PI) / 360);
  for (let f = 0; f < nf; f++) {
    const u = f / nf;
    const span = Math.max(2.4, top - fs[f]);
    const centre = (top + fs[f]) / 2 * 0.75 + (Y0 + ys[f] * scale) * 0.25;
    const dist = (span / 2 / tanH) * 1.12 * C.dist;
    const az = C.side + C.sway * Math.sin(TAU * u) * 0.5; // (un balancement par boucle)
    const el = 0.05 + C.height * 0.35 + 0.03 * Math.sin(TAU * u + 1.3);
    frames[f * 7] = Math.sin(az) * Math.cos(el) * dist;
    frames[f * 7 + 1] = centre + Math.sin(el) * dist;
    frames[f * 7 + 2] = Math.cos(az) * Math.cos(el) * dist;
    frames[f * 7 + 3] = 0;
    frames[f * 7 + 4] = centre;
    frames[f * 7 + 5] = 0;
    frames[f * 7 + 6] = C.fov;
  }
  // pose à l'instant t (Catmull-Rom, périodique)
  function at(t, out = { pos: [0, 0, 0], tgt: [0, 0, 0], fov: 35 }) {
    const x = ((t / T) * nf % nf + nf) % nf, i1 = Math.floor(x), u = x - i1;
    const id = (i) => (((i % nf) + nf) % nf) * 7;
    const a = id(i1 - 1), b = id(i1), c = id(i1 + 1), d = id(i1 + 2);
    const u2 = u * u, u3 = u2 * u;
    const w0 = -0.5 * u3 + u2 - 0.5 * u, w1 = 1.5 * u3 - 2.5 * u2 + 1, w2 = -1.5 * u3 + 2 * u2 + 0.5 * u, w3 = 0.5 * u3 - 0.5 * u2;
    const g = (k) => w0 * frames[a + k] + w1 * frames[b + k] + w2 * frames[c + k] + w3 * frames[d + k];
    out.pos[0] = g(0); out.pos[1] = g(1); out.pos[2] = g(2);
    out.tgt[0] = g(3); out.tgt[1] = g(4); out.tgt[2] = g(5); out.fov = g(6);
    return out;
  }
  return { at, frames, nf };
}
