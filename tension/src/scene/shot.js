// La caméra et les lumières suivent la marche : un travelling latéral.
//
// Le repère de la marche (gen/film.js · rig) avance d'un mouvement uniforme
// (translation, ou rotation autour du centre C) ; le centre réel de la
// structure, lui, avance par à-coups (une culbute, une onde, un tour). La
// caméra suit le repère, plus l'écart du centre à ce repère, lissé par un
// noyau gaussien périodique (σ ≈ 0,9 s) : elle accompagne sans sursauter.
// Tout est périodique en u : la pose à u = 1 est celle de u = 0 déplacée par
// le pas (image identique).
const TAU = Math.PI * 2;

export function makeShot(film, { samples = 360, sigma = 0.9 } = {}) {
  const N = film.N, S = samples;
  const dev = new Float64Array(S * 3);
  const P = new Float32Array(N * 3);
  for (let k = 0; k < S; k++) {
    const u = k / S;
    film.pose(u, P);
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < N; i++) { cx += P[i * 3]; cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; }
    cx /= N; cy /= N; cz /= N;
    const r = film.rig(u), c = Math.cos(-r.psi), s = Math.sin(-r.psi);
    const dx = cx - r.x, dz = cz - r.z;
    dev[k * 3] = c * dx - s * dz; dev[k * 3 + 1] = cy; dev[k * 3 + 2] = s * dx + c * dz;
  }
  // lissage gaussien périodique
  const sg = Math.max(1, (sigma / film.dur) * S), W = Math.ceil(sg * 3);
  const sm = new Float64Array(S * 3);
  for (let k = 0; k < S; k++) {
    let a = 0, b = 0, c = 0, ws = 0;
    for (let j = -W; j <= W; j++) {
      const w = Math.exp(-(j * j) / (2 * sg * sg)), q = (((k + j) % S) + S) % S;
      a += w * dev[q * 3]; b += w * dev[q * 3 + 1]; c += w * dev[q * 3 + 2]; ws += w;
    }
    sm[k * 3] = a / ws; sm[k * 3 + 1] = b / ws; sm[k * 3 + 2] = c / ws;
  }
  // Catmull-Rom périodique
  const at = (u) => {
    const f = (u - Math.floor(u)) * S, k = Math.floor(f), t = f - k;
    const g = (q) => (((k + q) % S) + S) % S;
    const out = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const p0 = sm[g(-1) * 3 + a], p1 = sm[g(0) * 3 + a], p2 = sm[g(1) * 3 + a], p3 = sm[g(2) * 3 + a];
      out[a] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    }
    return out;
  };
  // repère : origine, cap, et le centre suivi (monde)
  function frame(u) {
    const ph = u - Math.floor(u);
    const r = film.rig(ph), d = at(ph), c = Math.cos(r.psi), s = Math.sin(r.psi);
    return { x: r.x + c * d[0] - s * d[2], y: d[1], z: r.z + s * d[0] + c * d[2], psi: r.psi, c, s };
  }
  // un vecteur du repère de la marche (x devant, z côté caméra) vers le monde
  const toWorld = (F, x, y, z) => [F.c * x - F.s * z, y, F.s * x + F.c * z];
  return { frame, toWorld, TAU };
}

// Pose de la caméra à la phase u (recette R.camera, encombrement film.ext) :
// travelling latéral, distance réglée sur la taille de la structure, léger
// balancement périodique d'azimut et de hauteur. Rend { pos, tgt, tw, F }.
export const FAMILY_CAM = { culbute: { az: 0, el: 0, d: 1 }, chenille: { az: 0.55, el: 0.14, d: 0.78 }, cerceau: { az: 0, el: 0, d: 1 } };
export function cameraAt(shot, film, C, u, aspect) {
  const ph = u - Math.floor(u);
  const F = shot ? shot.frame(u) : { x: 0, y: 1, z: 0, psi: 0, c: 1, s: 0 };
  const tw = (x, y, z) => [F.c * x - F.s * z, y, F.s * x + F.c * z];
  // (largeur : ~62 % du cadre pour une structure longue ; hauteur : ~48 %)
  const ext = film?.ext ?? [3, 3, 3], th = Math.tan((C.fov * Math.PI) / 360);
  const base = (Math.max(ext[1] / (0.96 * th), ext[0] / (1.24 * th * Math.max(1, aspect))) + ext[2] * 0.5) * C.dist;
  // (une structure longue se regarde de trois quarts avant et d'un peu plus haut :
  //  de profil, la Chenille n'est qu'un trait)
  const FB = FAMILY_CAM[film?.T?.family] ?? FAMILY_CAM.culbute;
  const lead = tw(C.lead * base * 0.25, 0, 0);
  const tgt = [F.x + lead[0], F.y * 0.85, F.z + lead[2]];
  const az = C.az + FB.az + C.sway * Math.sin(TAU * ph), el = C.el + FB.el + 0.35 * C.sway * Math.sin(TAU * ph + 1.3);
  const o = tw(Math.sin(az) * Math.cos(el) * base * FB.d, Math.sin(el) * base * FB.d, Math.cos(az) * Math.cos(el) * base * FB.d);
  const pos = [tgt[0] + o[0], Math.max(0.25, tgt[1] + o[1]), tgt[2] + o[2]];
  return { pos, tgt, tw, F, ext };
}
