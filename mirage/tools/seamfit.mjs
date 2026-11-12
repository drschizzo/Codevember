// Le raccord de la mise en abyme : la caméra C1, qui regarde l'image du petit
// mirascope au-dessus de l'ouverture du grand, et la caméra P*, qui regarde le
// grand lui-même, doivent voir la même chose. L'image n'est pas une copie
// exacte (elle se montre sous un angle plus plongeant, un peu déformée) : on
// cherche P* (élévation, distance, hauteur visée, champ, étirement horizontal)
// qui recouvre le mieux la vue C1, pixel à pixel (même surface, même point).
//   FIX_AX=1 MODE=jour node mirage/tools/seamfit.mjs [e1° d1 fov° aspect yMid]  (la pose retenue : 50 0.011 18 1.7778 0.03)
import { traceNested, K, MINI, cutOf } from '../src/gen/abyme.js';
import { imageOf, PARAB } from '../src/gen/mirascope.js';

const [e1D = 50, d1 = 0.011, fov = 18, aspect = 16 / 9, yMid = 0.03] = process.argv.slice(2).map(Number);
const H = 40, W = Math.round(H * aspect);
export function camRays(pos, tgt, fovV, W, H, ax = 1) {
  const fw = tgt.map((v, i) => v - pos[i]), L = Math.hypot(...fw), F = fw.map((v) => v / L);
  let Rt = [-F[2], 0, F[0]]; const lr = Math.hypot(...Rt); Rt = Rt.map((v) => v / lr);
  const Up = [Rt[1] * F[2] - Rt[2] * F[1], Rt[2] * F[0] - Rt[0] * F[2], Rt[0] * F[1] - Rt[1] * F[0]];
  const th = Math.tan((fovV * Math.PI) / 360), tw = th * (W / H) * ax;
  return (i, j) => { const x = ((i + 0.5) / W * 2 - 1) * tw, y = (1 - (j + 0.5) / H * 2) * th, d = F.map((v, k) => v + Rt[k] * x + Up[k] * y), l = Math.hypot(...d); return [pos, d.map((v) => v / l)]; };
}
const pose = (c, e, d, a) => [c[0] + Math.sin(a) * Math.cos(e) * d, c[1] + Math.sin(e) * d, c[2] + Math.cos(a) * Math.cos(e) * d];
// visée : l'image d'un point de l'axe du petit (yMid, dans son repère)
const c1 = imageOf([0, MINI.y + K * yMid, 0], PARAB.f, 0, 3000).X;
const az = 0.6, cut = process.env.NOCUT ? null : cutOf((az * 180) / Math.PI); // (l'entaille du couvercle, tournée vers la caméra P)
const r1 = camRays(pose(c1, (e1D * Math.PI) / 180, d1, az), c1, fov, W, H); // (le petit est tourné d'un demi-tour : son image a l'orientation du grand)
const B = [];
let leak = 0;
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const b = traceNested(...r1(i, j), { cut }); B.push(b); if (b.level === 0 && (b.id === 'outHi' || b.id === 'bead') && b.n[1] > 0.2) leak++; }
// Deux modes. « nuit » : ce que le projecteur éclaire (dessus des dômes, des
// joncs, du pied) contre le noir. « jour » (MODE=jour, salle allumée) : chaque
// pixel doit toucher la même surface, un niveau plus bas, au même point — ou
// voir la salle dans la même direction (tout est de révolution : points et
// directions sont comparés dans le repère de chaque caméra).
const JOUR = process.env.MODE === 'jour';
const lit = (h) => (h.id === 'outHi' || h.id === 'bead' || h.id === 'foot') && h.n[1] > 0.1;
const rotY = (p, t) => [p[0] * Math.cos(t) - p[2] * Math.sin(t), p[1], p[0] * Math.sin(t) + p[2] * Math.cos(t)];
const azB = az;
function score(p) {
  const c = [0, p.ty, 0], r0 = camRays(pose(c, (p.e0 * Math.PI) / 180, p.d0, az), c, p.fv, W, H, p.ax);
  let ok = 0, err = 0, bad = 0, nl = 0, ang = 0, nr = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const a = traceNested(...r0(i, j), { cut }), b = B[j * W + i];
    if (JOUR) {
      if (a.id === 'room' && b.id === 'room') { const da = rotY(a.d, -az), db = rotY(b.d, -azB); const t = Math.acos(Math.min(1, da[0] * db[0] + da[1] * db[1] + da[2] * db[2])); ang += t; nr++; if (t > 0.15) bad++; continue; }
      if (a.id !== b.id || b.level !== a.level + 1 || !a.p) { bad++; continue; }
      const pa = rotY(a.p, -az), pb = rotY(b.p, -azB); ok++; err += Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      continue;
    }
    const la = lit(a), lb = lit(b);
    if (la || lb) nl++;
    if (la !== lb) bad++;
    else if (la) { if (a.id === b.id && b.level === a.level + 1) { ok++; err += Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]); } else bad++; }
  }
  return { cost: bad / (W * H) + (ok ? err / ok : 1) * 20, mismatch: bad / (W * H), lit: nl / (W * H), errMm: ok ? (err / ok) * 1000 : 99, roomDeg: nr ? (ang / nr) * 180 / Math.PI : 0 };
}
const keys = ['e0', 'd0', 'ty', 'fv', 'ax'], scl = [4, 0.02, 0.006, 2, 0.04];
const toP = (v) => Object.fromEntries(keys.map((k, i) => [k, v[i]]));
const FIX_AX = process.env.FIX_AX === '1';
const cost = (v) => score(toP(FIX_AX ? [...v.slice(0, 4), 1] : v)).cost;
function nelder(x0) {
  let S = [x0, ...keys.map((_, i) => x0.map((v, j) => v + (i === j ? scl[i] : 0)))].map((x) => ({ x, c: cost(x) }));
  for (let it = 0; it < 70; it++) {
    S.sort((a, b) => a.c - b.c);
    const n = keys.length, cen = S[0].x.map((_, j) => S.slice(0, n).reduce((s, q) => s + q.x[j], 0) / n);
    const at = (t) => cen.map((v, j) => v + t * (S[n].x[j] - v));
    const xr = at(-1), cr = cost(xr);
    if (cr < S[0].c) { const xe = at(-2), ce = cost(xe); S[n] = ce < cr ? { x: xe, c: ce } : { x: xr, c: cr }; }
    else if (cr < S[n - 1].c) S[n] = { x: xr, c: cr };
    else { const xc = at(0.5), cc = cost(xc); if (cc < S[n].c) S[n] = { x: xc, c: cc }; else S = S.map((q, i) => (i ? { x: q.x.map((v, j) => S[0].x[j] + 0.5 * (v - S[0].x[j])), c: 0 } : q)).map((q, i) => (i ? { ...q, c: cost(q.x) } : q)); }
  }
  S.sort((a, b) => a.c - b.c);
  return S[0];
}
let bestRun = null;
for (const de of [-12, -6]) for (const ds of [0.9, 1.1]) {
  const r0 = nelder([e1D + de, (d1 / K) * ds, yMid - 0.006, fov, 1]);
  if (!bestRun || r0.c < bestRun.c) bestRun = r0;
}
const p = toP(FIX_AX ? [...bestRun.x.slice(0, 4), 1] : bestRun.x), best = score(p);
const r = (x, n = 5) => +x.toFixed(n);
console.log(JSON.stringify({ e1: e1D, d1, fov, aspect: r(aspect, 3), c1: c1.map((v) => r(v, 6)), leakLevel0: r(leak / (W * H), 3), P: { e0: r(p.e0, 3), d0: r(p.d0, 5), ty: r(p.ty, 5), fov: r(p.fv, 3), ax: r(p.ax, 4) }, yMid, mismatch: r(best.mismatch, 3), lit: r(best.lit, 3), errMm: r(best.errMm, 2), roomDeg: r(best.roomDeg, 2), K, mode: JOUR ? 'jour' : 'nuit' }));
