// La fondation : le pétiole de papier sous la poutre et le premier rayon
// d'alvéoles que la reine construit avant de l'envelopper.
//
// Module pur (Node, worker). Unités : 1 = 10 cm, repère du monde (poutre au
// dessus, dessous à y = yBeam).
//
// Le rayon : des cellules hexagonales en réseau, ouvertes vers le bas, dont les
// fonds forment la plaque du rayon, accrochée au pétiole. Les cellules naissent
// en spirale autour du pétiole (une cellule neuve s'adosse au plus de parois
// existantes), et s'allongent : les parois sont des lames épaisses (dessus,
// dessous, tranche ; rôle 4 : le fond de la cellule), hautes de h·g où g est leur croissance (attribut `grow`,
// lu au pixel : la paroi est faite jusqu'à la part g de sa hauteur).
import { createRng } from '../../../shared/rng.js';

const PI = Math.PI;

class Mesh {
  constructor() { this.P = []; this.N = []; this.G = []; this.H = []; this.I = []; }
  vert(p, n, g, h) { this.P.push(...p); this.N.push(...n); this.G.push(...g); this.H.push(...h); return this.P.length / 3 - 1; }
  quad(a, b, c, d) { this.I.push(a, b, c, a, c, d); }
  out() {
    const n = this.P.length / 3;
    return { position: new Float32Array(this.P), normal: new Float32Array(this.N), grow: new Float32Array(this.G), cell: new Float32Array(this.H), index: n > 65535 ? new Uint32Array(this.I) : new Uint16Array(this.I) };
  }
}
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

// cellules en spirale (anneaux hexagonaux) : centres dans le plan xz
export function cellCenters(n, pitch) {
  const out = [[0, 0]];
  const dirs = [[1, 0], [0.5, Math.sqrt(3) / 2], [-0.5, Math.sqrt(3) / 2], [-1, 0], [-0.5, -Math.sqrt(3) / 2], [0.5, -Math.sqrt(3) / 2]];
  for (let ring = 1; out.length < n; ring++) {
    let x = dirs[4][0] * ring, y = dirs[4][1] * ring;
    for (let side = 0; side < 6; side++) for (let k = 0; k < ring; k++) { out.push([x, y]); x += dirs[side][0]; y += dirs[side][1]; }
  }
  return out.slice(0, n).map(([x, y]) => [x * pitch, y * pitch]);
}

// spec : { seed, yBeam, s0, s1, n, pitch, depth, petiole }
export function buildFoundation(spec) {
  const S = { yBeam: 1.25, n: 12, pitch: 0.052, depth: 0.05, petiole: 0.035, wall: 0.0016, ...spec };
  const rng = createRng(`comb:${S.seed}`);
  const M = new Mesh();
  const span = S.s1 - S.s0;
  // ── pétiole : une tige de papier vernie de salive, évasée sur la poutre ──
  const yTop = S.yBeam, yComb = S.yBeam - S.petiole;
  {
    const g = [S.s0, span * 0.12], NR = 24, NH = 10, rows = [];
    for (let j = 0; j <= NH; j++) {
      const v = j / NH, y = yTop + 0.004 - (yTop + 0.004 - yComb) * v;
      // (évasé en haut : le papier s'étale sur le bois ; en bas, il s'ouvre en plaque)
      const r = 0.0075 + 0.02 * Math.pow(1 - v, 6) + 0.012 * Math.pow(v, 8);
      const tw = 0.6 * v; // (une tige tordue, faite de bandes)
      const row = [];
      for (let i = 0; i <= NR; i++) {
        const a = (2 * PI * i) / NR + tw;
        row.push(M.vert([Math.cos(a) * r, y, Math.sin(a) * r], [Math.cos(a), 0.2, Math.sin(a)], g, [v, 0, 0, 3]));
      }
      rows.push(row);
    }
    for (let j = 0; j < NH; j++) for (let i = 0; i < NR; i++) M.quad(rows[j][i], rows[j + 1][i], rows[j + 1][i + 1], rows[j][i + 1]);
  }
  // ── cellules ──
  const C = cellCenters(S.n, S.pitch);
  const R = S.pitch / Math.sqrt(3); // (rayon du cercle circonscrit à l'hexagone)
  const t0 = S.s0 + span * 0.1, tc = (span * 0.9) / S.n;
  C.forEach(([cx, cz], i) => {
    const b = t0 + i * tc * rng.range(0.8, 1.0), d = tc * 3.5; // (une cellule s'allonge pendant que les suivantes naissent)
    const g = [b, d];
    const depth = S.depth * (1 - 0.35 * (i / S.n)) * rng.range(0.85, 1.08); // (les premières sont les plus longues)
    // une cellule n'est pas un prisme : elle s'évase vers la bouche, penche
    // vers l'extérieur du rayon (bombé) et n'est jamais tout à fait régulière
    const rr = Math.hypot(cx, cz), dx = rr > 1e-6 ? cx / rr : 0, dz = rr > 1e-6 ? cz / rr : 0;
    const tilt = 0.9 * rr + rng.range(-0.04, 0.04), flare = rng.range(0.08, 0.16), twist = rng.range(-0.08, 0.08);
    const at = (x, z, h) => { // point de la paroi à la part h de la hauteur
      const k = 1 + flare * h;
      const px = cx + (x - cx) * k + dx * tilt * depth * h, pz = cz + (z - cz) * k + dz * tilt * depth * h;
      return [px, yComb - depth * h * (1 - 0.04 * Math.abs(tilt)), pz];
    };
    for (let k = 0; k < 6; k++) {
      const a0 = (PI / 3) * k + PI / 6 + twist, a1 = a0 + PI / 3;
      const r0 = R * rng.range(0.96, 1.04), r1 = R * rng.range(0.96, 1.04);
      const p0 = [cx + Math.cos(a0) * r0, cz + Math.sin(a0) * r0], p1 = [cx + Math.cos(a1) * r1, cz + Math.sin(a1) * r1];
      const nx = Math.cos((a0 + a1) / 2), nz = Math.sin((a0 + a1) / 2);
      const NHw = 5;
      for (const side of [1, -1]) {
        const row = [];
        for (let j = 0; j <= NHw; j++) {
          const h = j / NHw, w = S.wall * (0.5 + 0.9 * h * h) / 2; // (paroi plus épaisse vers la bouche : la lèvre)
          const q0 = at(p0[0] + nx * w * side, p0[1] + nz * w * side, h), q1 = at(p1[0] + nx * w * side, p1[1] + nz * w * side, h);
          row.push([M.vert(q0, [nx * side, 0, nz * side], g, [h, i, 0, side > 0 ? 0 : 1]), M.vert(q1, [nx * side, 0, nz * side], g, [h, i, 0, side > 0 ? 0 : 1])]);
        }
        for (let j = 0; j < NHw; j++) side > 0 ? M.quad(row[j][0], row[j + 1][0], row[j + 1][1], row[j][1]) : M.quad(row[j][0], row[j][1], row[j + 1][1], row[j + 1][0]);
      }
      // la lèvre : un bourrelet arrondi au bord ouvert (lu à h = 1)
      const w = S.wall * 0.7;
      const lip = [];
      for (let m = 0; m <= 4; m++) {
        const ang = (PI * m) / 4, ox = Math.cos(ang) * w, oy = Math.sin(ang) * w * 0.8;
        const q0 = at(p0[0] + nx * ox, p0[1] + nz * ox, 1), q1 = at(p1[0] + nx * ox, p1[1] + nz * ox, 1);
        q0[1] -= oy; q1[1] -= oy;
        const nn = [nx * Math.cos(ang), -Math.sin(ang), nz * Math.cos(ang)];
        lip.push([M.vert(q0, nn, g, [1, i, 0, 2]), M.vert(q1, nn, g, [1, i, 0, 2])]);
      }
      for (let m = 0; m < 4; m++) M.quad(lip[m][0], lip[m][1], lip[m + 1][1], lip[m + 1][0]);
    }
    // fond (plaque du rayon), visible d'emblée avec la cellule
    const ctr = M.vert([cx, yComb, cz], [0, -1, 0], g, [0, i, 0, 4]);
    const rim = [];
    for (let k = 0; k <= 6; k++) { const a = (PI / 3) * k + PI / 6 + twist; rim.push(M.vert([cx + Math.cos(a) * R, yComb, cz + Math.sin(a) * R], [0, -1, 0], g, [0, i, 0, 4])); }
    for (let k = 0; k < 6; k++) M.I.push(ctr, rim[k + 1], rim[k]);
    const top = M.vert([cx, yComb + 0.004, cz], [0, 1, 0], g, [0, i, 0, 4]);
    for (let k = 0; k < 6; k++) M.I.push(top, rim[k], rim[k + 1]);
    // l'œuf : la reine en pond un dans chaque cellule à demi construite,
    // collé par un bout au fond, contre une paroi, pendu vers la bouche
    // (rôle 5 ; blanc nacré : vu d'en dessous, il dit ce qu'est la cellule)
    {
      const ge = [b + d * 0.45, d * 0.1], ea = (PI / 3) * Math.floor(rng.range(0, 6)) + twist + PI / 6, eo = R * 0.28;
      const base = at(cx + Math.cos(ea) * eo, cz + Math.sin(ea) * eo, 0.02), tip = at(cx + Math.cos(ea) * eo * 0.3, cz + Math.sin(ea) * eo * 0.3, 0.42);
      const ax = norm(base.map((x, k) => tip[k] - x)), len = Math.hypot(...base.map((x, k) => tip[k] - x));
      const side = norm([ax[1], -ax[0], 0].map((x, k) => x + (k === 2 ? 1e-3 : 0))), up = norm([ax[1] * side[2] - ax[2] * side[1], ax[2] * side[0] - ax[0] * side[2], ax[0] * side[1] - ax[1] * side[0]]);
      const NU = 10, NV = 7, rows = [];
      for (let v = 0; v <= NV; v++) {
        const t = v / NV, r = 0.0028 * Math.sin(PI * Math.min(1, t * 0.97 + 0.03)) ** 0.8 * (1 + 0.12 * t), row = [];
        for (let k = 0; k <= NU; k++) {
          const a = (2 * PI * k) / NU, o = side.map((x, m) => x * Math.cos(a) + up[m] * Math.sin(a));
          row.push(M.vert(base.map((x, m) => x + ax[m] * t * len + o[m] * r), o, ge, [t, i, 0, 5]));
        }
        rows.push(row);
      }
      for (let v = 0; v < NV; v++) for (let k = 0; k < NU; k++) M.quad(rows[v][k], rows[v + 1][k], rows[v + 1][k + 1], rows[v][k + 1]);
    }
  });
  return { ...M.out(), yComb, cells: C.length };
}
