// Le sous-duvet : sous les plumes de couverture, la peau d'un oiseau n'est
// jamais nue — des houppes de duvet la couvrent. On les sème sur le corps
// (une grille décalée par un hachage, un point par cellule : pas de trame
// visible), chacune faite de barbes frisées posées par la même formule que le
// duvet de la scène (barbPose, famille radiale, figée à u = 1), et on cuit le
// tout en un seul maillage statique (positions et normales dans le monde) :
// rien à calculer à l'image.
import { barbTable, barbPose, BARB_STRIDE, featherFrame, qrot, mix, quatFromBasis } from './feather.js';

const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// repère d'une rosette sur une surface { p, n, d } (comme featherFrame)
function frameOn({ p, n, d: d0 }, beta, yaw) {
  const e0 = crs(n, d0), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const d = d0.map((v, i) => v * cy + e0[i] * sy);
  const Y = n.map((v, i) => v * Math.cos(beta) + d[i] * Math.sin(beta));
  const Z = n.map((v, i) => v * Math.sin(beta) - d[i] * Math.cos(beta));
  return { p, n, q: quatFromBasis(crs(Y, Z), Y, Z) };
}

// P : forme du duvet (shapeOf('duvet')), lay : le plan du plumage
export function buildDown(P, lay, seed, { spacing = 0.9, segs = 6, lite = false, th0: tA = null, th1: tB = null, phSpan = 2.5, surface = null } = {}) {
  let h = 2166136261;
  for (const ch of `down:${seed}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const { Rd } = lay, thH = lay.thH ?? 0;
  const step = spacing * (lite ? 1.4 : 1);
  const th0 = tA ?? Math.max(0.05, thH - 1.0), th1 = tB ?? Math.min(1.62, thH + 1.15);
  const T = barbTable(P, `${seed}:down`, lite ? 9 : 14);
  const nb = T.length / BARB_STRIDE;
  const pos = [], nor = [], idx = [];
  const S = { u: 1, L: P.L, k: 0, wear: 0, g: [0, -1, 0], radial: true, cal: P.calamus, over: P.over };
  for (let th = th0; th < th1; th += step / Rd) {
    // (surface : le socle de la gerbe, une calotte prolongée par un cylindre —
    // th y est l'abscisse curviligne du méridien, divisée par Rd)
    const ring = surface ? Rd * Math.sin(Math.min(th, Math.PI / 2)) : Rd * Math.sin(th);
    const n = Math.max(1, Math.floor((ring * phSpan) / step));
    for (let i = 0; i < n; i++) {
      const ph = ((i + rnd()) / n - 0.5) * phSpan;
      if (phSpan < 6 && Math.abs(ph * ring) > 16 + P.L * 4) continue;
      const tj = th + (rnd() - 0.5) * (step / Rd);
      const fr = surface ? frameOn(surface(Rd, tj * Rd, ph), 0.15 * rnd(), (rnd() - 0.5) * 2) : featherFrame(Rd, tj, ph, 0.15 * rnd(), 0, (rnd() - 0.5) * 2); // (une rosette à plat : les barbes s'étalent sur la peau, sous les plumes)
      const sc = 0.7 + 0.5 * rnd();
      // (la houppe est plantée un peu sous la peau : seules ses barbes affleurent)
      const base = fr.p.map((v, k) => v - fr.n[k] * 0.08);
      for (let b = 0; b < nb; b++) {
        const B = [...T.slice(b * BARB_STRIDE, (b + 1) * BARB_STRIDE)];
        B[9] = (B[9] + i * 0.37 + th * 3.1) % 1;
        const v0 = pos.length / 3;
        for (let s = 0; s <= segs; s++) {
          for (const v of [-1, 1]) {
            const r = barbPose(B, s / segs, v, 0, S);
            const w = qrot(fr.q, r.p.map((x) => x * sc)), nn = qrot(fr.q, r.n);
            pos.push(base[0] + w[0], base[1] + w[1], base[2] + w[2]);
            nor.push(nn[0], nn[1], nn[2]);
          }
        }
        for (let s = 0; s < segs; s++) { const a = v0 + s * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
    }
  }
  // attribut de rôle : (t le long de la barbe, v en travers)
  const tv = new Float32Array((pos.length / 3) * 2);
  for (let q = 0; q < pos.length / 3; q++) { tv[q * 2] = ((q % ((segs + 1) * 2)) >> 1) / segs; tv[q * 2 + 1] = q % 2 ? 1 : -1; }
  void mix;
  return { position: new Float32Array(pos), normal: new Float32Array(nor), tv, index: new Uint32Array(idx) };
}
