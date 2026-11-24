// Prototype du cœur : trois ombres prescrites, soleil de minuit, coque par
// intersection des extrusions obliques (Mitra et Pauly 2009, sur un sol).
// node anamorph/tools/proto-shadow.mjs <dossier de sortie>
// Écrit les ombres de la coque (PGM) et imprime la couverture de chaque cible.
import fs from 'node:fs';

const out = process.argv[2] || '.';
const deg = Math.PI / 180;

// ── Soleil ──
const LAT = 78 * deg, DEC = 20 * deg;
// H : angle horaire (0 = midi, soleil au sud). Repère : x est, y nord, z haut.
function sun(H) {
  const sh = Math.sin(LAT) * Math.sin(DEC) + Math.cos(LAT) * Math.cos(DEC) * Math.cos(H);
  const h = Math.asin(sh);
  // azimut compté depuis le nord vers l'est
  const az = Math.atan2(-Math.cos(DEC) * Math.sin(H), Math.sin(DEC) * Math.cos(LAT) - Math.cos(DEC) * Math.sin(LAT) * Math.cos(H));
  return { h, az, d: [Math.sin(az) * Math.cos(h), Math.cos(az) * Math.cos(h), Math.sin(h)] };
}

// ── Silhouettes (prototype : unions d'ellipses en coordonnées de figure) ──
// (a, b) : a le long de l'axe radial (pied de l'objet → bout de l'ombre), b latéral ; unité = longueur de la figure.
const E = (ca, cb, ra, rb, rot = 0) => ({ ca, cb, ra, rb, c: Math.cos(rot), s: Math.sin(rot) });
const inE = (e, a, b) => { const x = a - e.ca, y = b - e.cb; const u = e.c * x + e.s * y, v = -e.s * x + e.c * y; return (u / e.ra) ** 2 + (v / e.rb) ** 2 <= 1; };
const FIG = {
  // renard assis, debout dans l'image : pattes au pied, oreilles au bout
  renard: [E(0.30, 0.02, 0.28, 0.17), E(0.12, -0.18, 0.10, 0.20, 0.3), E(0.62, 0.05, 0.13, 0.11), E(0.76, 0.07, 0.10, 0.07), E(0.86, -0.02, 0.10, 0.035, 0.25), E(0.86, 0.12, 0.10, 0.035, -0.25), E(0.70, 0.17, 0.04, 0.08)],
  // phoque couché, de côté : le corps suit l'axe radial
  phoque: [E(0.45, 0.0, 0.38, 0.12), E(0.84, 0.06, 0.11, 0.08), E(0.12, -0.02, 0.10, 0.07, 0.4), E(0.06, 0.07, 0.07, 0.04, -0.6), E(0.50, -0.11, 0.08, 0.03, 0.6)],
  // poisson
  poisson: [E(0.52, 0.0, 0.34, 0.14), E(0.10, 0.0, 0.08, 0.13), E(0.50, 0.15, 0.10, 0.05, 0.4), E(0.50, -0.15, 0.08, 0.04, -0.4)],
};
const figIn = (name, a, b) => a >= 0 && a <= 1 && FIG[name].some((e) => inE(e, a, b));

// ── Trois heures : minuit (ombre vers le sud, loin de la caméra), matin, soir ──
const HOURS = [{ H: 180 * deg, fig: 'renard' }, { H: 95 * deg, fig: 'phoque' }, { H: -95 * deg, fig: 'poisson' }];
const ZMAX = 0.8; // hauteur de l'objet (m)
for (const k of HOURS) {
  k.s = sun(k.H);
  const dh = [-k.s.d[0], -k.s.d[1]]; const n = Math.hypot(...dh); k.u = [dh[0] / n, dh[1] / n]; // direction de l'ombre au sol
  k.v = [-k.u[1], k.u[0]];
  k.L = ZMAX / Math.tan(k.s.h); // longueur de l'ombre
  k.a0 = 0; k.b0 = 0; k.scale = k.L;
  console.log(`H=${(k.H / deg).toFixed(0)}° h=${(k.s.h / deg).toFixed(1)}° az=${(k.s.az / deg).toFixed(0)}° L=${k.L.toFixed(2)} m  ${k.fig}`);
}
// cible au sol : point (x, y) → coordonnées de figure
const inTarget = (k, x, y) => figIn(k.fig, (x * k.u[0] + y * k.u[1] - k.a0) / k.scale, (x * k.v[0] + y * k.v[1] - k.b0) / k.scale);
const place = (k, a0, b0) => { k.a0 = a0; k.b0 = b0; k.scale = k.L - a0; };

// ── Coque ──
const R = 1.3;
function evaluate(N, NZ, G, write) { // demi-largeur au sol de la boîte de l'objet, résolution
const vox = new Uint8Array(N * N * NZ);
let count = 0;
for (let iz = 0; iz < NZ; iz++) for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
  const x = -R + (ix + 0.5) * 2 * R / N, y = -R + (iy + 0.5) * 2 * R / N, z = (iz + 0.5) * ZMAX / NZ;
  let ok = true;
  for (const k of HOURS) { const t = z / k.s.d[2]; if (!inTarget(k, x - t * k.s.d[0], y - t * k.s.d[1])) { ok = false; break; } }
  if (ok) { vox[(iz * N + iy) * N + ix] = 1; count++; }
}
if (write) console.log(`coque : ${count} voxels, ${(count * (2 * R / N) ** 2 * ZMAX / NZ * 1e3).toFixed(1)} L`);

// ── Ombre de la coque, couverture ──
const covs = [];
for (const [i, k] of HOURS.entries()) {
  const ext = k.L * 1.05;
  const img = new Uint8Array(G * G); // 0 dehors, 1 cible seule, 2 ombre ∩ cible, 3 ombre hors cible
  // repère de l'image : axe radial vertical (vers le haut), latéral horizontal
  const toGround = (a, b) => [a * k.u[0] + b * k.v[0], a * k.u[1] + b * k.v[1]];
  const px = (a, b) => [Math.floor((b / ext + 0.5) * G), Math.floor((1 - (a + 0.05 * ext) / ext) * G)];
  for (let j = 0; j < G; j++) for (let q = 0; q < G; q++) {
    const a = (1 - (j + 0.5) / G) * ext - 0.05 * ext, b = ((q + 0.5) / G - 0.5) * ext;
    const [x, y] = toGround(a, b);
    if (inTarget(k, x, y)) img[j * G + q] = 1;
  }
  // projette chaque voxel (centre + étalement d'un demi-voxel)
  for (let iz = 0; iz < NZ; iz++) for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
    if (!vox[(iz * N + iy) * N + ix]) continue;
    for (const oz of [0.25, 0.75]) {
      const x = -R + (ix + 0.5) * 2 * R / N, y = -R + (iy + 0.5) * 2 * R / N, z = (iz + oz) * ZMAX / NZ;
      const t = z / k.s.d[2]; const gx = x - t * k.s.d[0], gy = y - t * k.s.d[1];
      const a = gx * k.u[0] + gy * k.u[1], b = gx * k.v[0] + gy * k.v[1];
      const [q, j] = px(a, b);
      for (let dj = -1; dj <= 1; dj++) for (let dq = -1; dq <= 1; dq++) {
        const jj = j + dj, qq = q + dq; if (jj < 0 || qq < 0 || jj >= G || qq >= G) continue;
        const p = jj * G + qq; img[p] = img[p] === 1 || img[p] === 2 ? 2 : 3;
      }
    }
  }
  let tgt = 0, cov = 0, over = 0;
  for (const p of img) { if (p === 1 || p === 2) tgt++; if (p === 2) cov++; if (p === 3) over++; }
  covs.push(cov / tgt);
  if (!write) continue;
  console.log(`${k.fig}: couverture ${(100 * cov / tgt).toFixed(1)} %, débord ${(100 * over / tgt).toFixed(1)} % (dilatation d'un pixel)`);
  const rgb = Buffer.alloc(G * G * 3);
  const col = [[245, 245, 245], [235, 120, 110], [40, 40, 50], [80, 120, 240]];
  img.forEach((p, n) => { rgb[3 * n] = col[p][0]; rgb[3 * n + 1] = col[p][1]; rgb[3 * n + 2] = col[p][2]; });
  fs.writeFileSync(`${out}/ombre${i}.ppm`, Buffer.concat([Buffer.from(`P6 ${G} ${G} 255\n`), rgb]));
}
  return covs;
}
// recherche aléatoire des placements (basse résolution), puis évaluation fine
let best = { score: -1 };
const rnd = ((a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; })(7);
for (let it = 0; it < 300; it++) {
  const P = HOURS.map((k) => it === 0 ? [0, 0] : best.score > 0 && rnd() < 0.6 ? [best.P[HOURS.indexOf(k)][0] + (rnd() - 0.5) * 0.3, best.P[HOURS.indexOf(k)][1] + (rnd() - 0.5) * 0.3] : [-rnd() * 1.2, (rnd() - 0.5) * 0.8]);
  HOURS.forEach((k, i) => place(k, Math.min(0, P[i][0]), P[i][1]));
  const c = evaluate(64, 48, 128, false);
  const score = Math.min(...c);
  if (score > best.score) { best = { score, P, c }; console.log(it, c.map((x) => (100 * x).toFixed(1)).join(' '), P.map((p) => p.map((x) => x.toFixed(2)).join(',')).join(' | ')); }
}
HOURS.forEach((k, i) => place(k, Math.min(0, best.P[i][0]), best.P[i][1]));
evaluate(200, 128, 320, true);
