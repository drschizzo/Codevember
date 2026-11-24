// Prototype 2 : silhouettes détaillées, ombre exacte (rayons vers le disque
// solaire, pénombre comprise), comparaison de dispositions des heures.
// node anamorph/tools/proto-shadow2.mjs <sortie> <config>
import fs from 'node:fs';
import { figureMask } from '../src/gen/silhouettes.js';

const out = process.argv[2] || '.';
const CONF = process.argv[3] || 'opposees';
const deg = Math.PI / 180;
const LAT = 78 * deg, DEC = 20 * deg, SUN_R = 0.267 * deg;

function sun(H) {
  const h = Math.asin(Math.sin(LAT) * Math.sin(DEC) + Math.cos(LAT) * Math.cos(DEC) * Math.cos(H));
  const az = Math.atan2(-Math.cos(DEC) * Math.sin(H), Math.sin(DEC) * Math.cos(LAT) - Math.cos(DEC) * Math.sin(LAT) * Math.cos(H));
  return { h, az, d: [Math.sin(az) * Math.cos(h), Math.cos(az) * Math.cos(h), Math.sin(h)] };
}

const CONFS = {
  // ombres : loin de la caméra (minuit) et de côté, opposées
  opposees: [['renard', 180], ['macareux', 95], ['phoque', -95]],
  // trois ombres en éventail, sans paire opposée
  eventail: [['renard', 180], ['macareux', 140], ['lievre', -140]],
  deux: [['renard', 180], ['lievre', 120]],
  renardPhoque: [['renard', 180], ['phoque', -95]],
  lievrePhoque: [['lievre', 180], ['phoque', 95]],
  macareuxPhoque: [['macareux', 180], ['phoque', -95]],
};
const ZMAX = 0.8;
const HOURS = CONFS[CONF].map(([fig, Hd]) => {
  const s = sun(Hd * deg);
  const n = Math.hypot(s.d[0], s.d[1]);
  const u = [-s.d[0] / n, -s.d[1] / n];
  return { fig, H: Hd * deg, s, u, v: [-u[1], u[0]], L: ZMAX / Math.tan(s.h), mask: figureMask(fig, 512), a0: 0, b0: 0, scale: 1 };
});
for (const k of HOURS) console.log(`${k.fig}: h=${(k.s.h / deg).toFixed(1)}° ombre vers ${((Math.atan2(k.u[0], k.u[1]) / deg + 360) % 360).toFixed(0)}° L=${k.L.toFixed(2)} m`);

const place = (k, a0, b0) => { k.a0 = a0; k.b0 = b0; k.scale = k.L - a0; };
const toFig = (k, x, y) => [(x * k.u[0] + y * k.u[1] - k.a0) / k.scale, (x * k.v[0] + y * k.v[1] - k.b0) / k.scale];
const inTarget = (k, x, y) => { const [a, b] = toFig(k, x, y); return k.mask.at(a, b); };

// ── coque ──
const R = 1.4;
function hull(N, NZ) {
  const vox = new Uint8Array(N * N * NZ);
  for (let iz = 0; iz < NZ; iz++) {
    const z = (iz + 0.5) * ZMAX / NZ;
    const sh = HOURS.map((k) => z / k.s.d[2]);
    for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
      const x = -R + (ix + 0.5) * 2 * R / N, y = -R + (iy + 0.5) * 2 * R / N;
      let ok = 1;
      for (let i = 0; i < HOURS.length && ok; i++) { const k = HOURS[i]; if (!inTarget(k, x - sh[i] * k.s.d[0], y - sh[i] * k.s.d[1])) ok = 0; }
      vox[(iz * N + iy) * N + ix] = ok;
    }
  }
  return { vox, N, NZ };
}

// couverture rapide : projection des voxels dans le repère de figure (grille G)
function coverage(Hl, G) {
  const { vox, N, NZ } = Hl;
  return HOURS.map((k) => {
    const sh = new Uint8Array(G * G);
    for (let iz = 0; iz < NZ; iz++) for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
      if (!vox[(iz * N + iy) * N + ix]) continue;
      for (const oz of [0.25, 0.75]) {
        const x = -R + (ix + 0.5) * 2 * R / N, y = -R + (iy + 0.5) * 2 * R / N, z = (iz + oz) * ZMAX / NZ;
        const t = z / k.s.d[2];
        const [a, b] = toFig(k, x - t * k.s.d[0], y - t * k.s.d[1]);
        const j = Math.floor((1 - a) * G), q = Math.floor((b + 0.5) * G);
        for (let dj = -1; dj <= 1; dj++) for (let dq = -1; dq <= 1; dq++) { const jj = j + dj, qq = q + dq; if (jj >= 0 && qq >= 0 && jj < G && qq < G) sh[jj * G + qq] = 1; }
      }
    }
    let t = 0, c = 0;
    for (let j = 0; j < G; j++) for (let q = 0; q < G; q++) { const a = 1 - (j + 0.5) / G, b = (q + 0.5) / G - 0.5; if (k.mask.at(a, b)) { t++; if (sh[j * G + q]) c++; } }
    return c / t;
  });
}

// ── recherche des placements ──
let rs = 11;
const rnd = () => { rs |= 0; rs = rs + 0x6D2B79F5 | 0; let t = Math.imul(rs ^ rs >>> 15, 1 | rs); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
let best = { score: -1, P: HOURS.map(() => [0, 0]) };
for (let it = 0; it < 400; it++) {
  const P = HOURS.map((k, i) => it === 0 ? [0, 0] : rnd() < 0.7 ? [Math.min(0, best.P[i][0] + (rnd() - 0.5) * 0.25), best.P[i][1] + (rnd() - 0.5) * 0.25] : [-rnd() * 1.6, (rnd() - 0.5) * 1.0]);
  HOURS.forEach((k, i) => place(k, P[i][0], P[i][1]));
  const c = coverage(hull(56, 40), 128);
  const score = Math.min(...c);
  if (score > best.score) best = { score, P, c };
}
console.log('placement :', best.c.map((x) => (100 * x).toFixed(1) + ' %').join('  '));
HOURS.forEach((k, i) => place(k, best.P[i][0], best.P[i][1]));

// ── coque fine, ombre exacte par rayons vers le disque solaire ──
const Hf = hull(220, 140);
const { vox, N, NZ } = Hf;
let nv = 0, bb = [1e9, -1e9, 1e9, -1e9]; for (let iz = 0; iz < NZ; iz++) for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) if (vox[(iz * N + iy) * N + ix]) { nv++; const x = -R + (ix + 0.5) * 2 * R / N, y = -R + (iy + 0.5) * 2 * R / N; bb = [Math.min(bb[0], x), Math.max(bb[1], x), Math.min(bb[2], y), Math.max(bb[3], y)]; }
console.log(`coque : ${(nv * (2 * R / N) ** 2 * ZMAX / NZ * 1e3).toFixed(0)} L, emprise ${(bb[1] - bb[0]).toFixed(2)} × ${(bb[3] - bb[2]).toFixed(2)} m`);
const occ = (x, y, z) => { const ix = Math.floor((x + R) / (2 * R) * N), iy = Math.floor((y + R) / (2 * R) * N), iz = Math.floor(z / ZMAX * NZ); return ix >= 0 && iy >= 0 && iz >= 0 && ix < N && iy < N && iz < NZ && vox[(iz * N + iy) * N + ix]; };
const DISK = []; for (let i = 0; i < 12; i++) { const r = SUN_R * Math.sqrt((i + 0.5) / 12), t = i * 2.39996; DISK.push([r * Math.cos(t), r * Math.sin(t)]); }
const step = 2 * R / N * 0.5;

const G = 360, PAD = 0.06;
const sheet = Buffer.alloc(G * 2 * G * HOURS.length * 3);
const W = G * 2 * HOURS.length;
HOURS.forEach((k, idx) => {
  let tgt = 0, inter = 0, uni = 0;
  for (let j = 0; j < G; j++) for (let q = 0; q < G; q++) {
    // vue dans le repère de la figure : a vertical, b horizontal (un peu de marge)
    const a = 1 + PAD - (j + 0.5) / G * (1 + 2 * PAD), b = ((q + 0.5) / G - 0.5) * (1 + 2 * PAD);
    const gx = (a * k.scale + k.a0) * k.u[0] + (b * k.scale + k.b0) * k.v[0];
    const gy = (a * k.scale + k.a0) * k.u[1] + (b * k.scale + k.b0) * k.v[1];
    // fraction du disque solaire masquée
    let hit = 0;
    for (const [da, db] of DISK) {
      const h = k.s.h + da, az = k.s.az + db / Math.cos(k.s.h);
      const d = [Math.sin(az) * Math.cos(h), Math.cos(az) * Math.cos(h), Math.sin(h)];
      const tmax = ZMAX / d[2];
      for (let t = step * 0.5; t < tmax; t += step) if (occ(gx + t * d[0], gy + t * d[1], t * d[2])) { hit++; break; }
    }
    const shade = hit / DISK.length; // 1 = ombre pleine
    const inT = k.mask.at(a, b);
    if (inT) tgt++;
    if (inT && shade > 0.5) inter++;
    if (inT || shade > 0.5) uni++;
    // gauche : la cible ; droite : l'ombre obtenue (sol neige, ombre bleue)
    const L = (r, g, bl, off) => { const p = (j * W + idx * 2 * G + off + q) * 3; sheet[p] = r; sheet[p + 1] = g; sheet[p + 2] = bl; };
    L(inT ? 25 : 238, inT ? 25 : 238, inT ? 30 : 236, 0);
    const lit = [246, 247, 250], dark = [92, 112, 150];
    L(...lit.map((c, i) => Math.round(c + (dark[i] - c) * shade)), G);
  }
  console.log(`${k.fig}: IoU ${(100 * inter / uni).toFixed(1)} %, couverture ${(100 * inter / tgt).toFixed(1)} %`);
});
fs.writeFileSync(`${out}/${CONF}.ppm`, Buffer.concat([Buffer.from(`P6 ${W} ${G} 255\n`), sheet]));
