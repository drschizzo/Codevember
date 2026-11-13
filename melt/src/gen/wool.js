// Le tricot de laine (humeur Laine), au niveau des fibres.
//
// Modèle de fil procédural de Zhao, Luan et Bala (« Fitting procedural yarn
// models for realistic cloth rendering », SIGGRAPH 2016), dans la forme qu'en
// donnent Wu et Yuksel (« Real-time fiber-level cloth rendering », I3D 2017) :
//  - le fil suit une courbe de contrôle : ici les rangs d'un jersey, une suite
//    de mailles en V, la jambe en avant, la tête et le pied passés derrière les
//    rangs voisins ;
//  - les brins tournent autour de l'axe du fil :
//      Δc_ply(θ) = ½R_ply (cos(θ_j + θ) N + sin(θ_j + θ) B),  θ_j = 2πj / n_ply ;
//  - la section d'un brin est une ellipse, écrasée contre son voisin
//    (facteurs e_N, e_B) ; chaque fibre y tourne en hélice (torsion α) :
//      Δc_i(θ) = R(θ) (cos(θ_i + θ) N_ply e_N + sin(θ_i + θ) B_ply e_B) ;
//  - sa distance à l'axe « migre » :
//      R(θ) = R_i/2 · (R_max + R_min + (R_max − R_min) cos(θ_i + sθ)) ;
//    les R_i suivent la densité de Zhao et al. (ε, β) ;
//  - une période sur quelques-unes est une boucle (R_max remplacé par R_loop) ;
//  - une autre est un poil : la fibre est rompue, son bout libre part de
//    R_hair et revient à R_min, avec sa propre torsion α_hair ;
//  - les fibres du centre du brin, trop serrées pour se distinguer, forment
//    une « fibre de cœur » unique, dont la matière dessine les fibres en hélice
//    (Wu et Yuksel, § 3.2) ;
//  - l'ombre ambiante suit la distance au centre du fil (§ 3.5), plus l'ombre
//    des rangs voisins sur les parties passées derrière ; les ombres portées
//    viennent de tubes simples (le cœur des brins), pas des fibres (§ 3.4).
//
// Repère du monde (mm, y vers le haut). Le cristal repose sur les fibres les
// plus hautes de son emprise (rayon `clear`) : rien n'y dépasse y = 0.
import { createRng } from '../../../shared/rng.js';

const TAU = Math.PI * 2;

class Tubes {
  constructor() { this.p = []; this.n = []; this.t = []; this.f = []; this.i = []; }
  // fb(k, s) → [a, b, c, d] par sommet ; les fibres : (nuance, abscisse, ombre, nature)
  // nature : 0 cœur, 1 fibre, 2 boucle ou poil ; le cœur : (angle 0..1, longueur (mm), ombre, 0)
  add(pts, r, sides, fb) {
    const m = pts.length;
    if (m < 2) return;
    const base = this.p.length / 3;
    let prevN = null;
    for (let k = 0; k < m; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(m - 1, k + 1)];
      let T = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const tl = Math.hypot(...T) || 1; T = T.map((x) => x / tl);
      let N = prevN ?? (Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
      const d = N[0] * T[0] + N[1] * T[1] + N[2] * T[2];
      N = [N[0] - T[0] * d, N[1] - T[1] * d, N[2] - T[2] * d];
      const nl = Math.hypot(...N) || 1; N = N.map((x) => x / nl);
      prevN = N;
      const Bv = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
      const rr = typeof r === 'function' ? r(k / (m - 1)) : r;
      for (let s = 0; s < sides; s++) {
        const th = (s / sides) * TAU, c = Math.cos(th), si = Math.sin(th);
        const nx = N[0] * c + Bv[0] * si, ny = N[1] * c + Bv[1] * si, nz = N[2] * c + Bv[2] * si;
        this.p.push(pts[k][0] + nx * rr, pts[k][1] + ny * rr, pts[k][2] + nz * rr);
        this.n.push(nx, ny, nz);
        this.t.push(T[0], T[1], T[2], 1);
        this.f.push(...fb(k, s / sides));
      }
    }
    for (let k = 0; k < m - 1; k++) for (let s = 0; s < sides; s++) {
      const a = base + k * sides + s, b = base + k * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
      this.i.push(a, b, c, b, d, c);
    }
  }
  out() {
    return { position: new Float32Array(this.p), normal: new Float32Array(this.n), tangent: new Float32Array(this.t), fb: new Float32Array(this.f), index: new Uint32Array(this.i) };
  }
}

// repère transporté le long d'une polyligne
function frames(C) {
  const n = C.length, F = [];
  let N = [0, 1, 0];
  for (let k = 0; k < n; k++) {
    const a = C[Math.max(0, k - 1)], b = C[Math.min(n - 1, k + 1)];
    let T = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...T) || 1; T = T.map((x) => x / l);
    const d = N[0] * T[0] + N[1] * T[1] + N[2] * T[2];
    N = [N[0] - T[0] * d, N[1] - T[1] * d, N[2] - T[2] * d];
    const nl = Math.hypot(...N) || 1; N = N.map((x) => x / nl);
    const B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
    F.push({ T, N, B });
  }
  return F;
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };

// Paramètres du fil (mm) : laine à tricoter, deux brins
export const YARN = {
  R: 0.42, // rayon du fil (laine fine, mérinos)
  plies: 2, plyR: 0.21, plyPitch: 1.9, // brins : rayon, pas de leur torsion autour du fil
  eN: 0.8, eB: 1.15, // ellipse du brin (écrasé contre son voisin)
  eps: 0.1, beta: 0.45, // densité des fibres dans le brin (Zhao et al.)
  fibers: 54, coreR: 0.55, // fibres explicites par brin (hors du cœur), rayon du cœur (× brin)
  fiberR: 0.0085, alpha: 1.0, // rayon d'une fibre, pas de l'hélice des fibres
  rMin: 0.55, rMax: 1.05, s: 1.6, // migration (s : migrations par tour)
  pLoop: 0.06, rLoop: 1.8, // boucles : part des périodes, rayon maximal (× brin)
  pHair: 0.16, rHair: [1.8, 4.2], alphaHair: 4.2, // poils : part, rayon du bout libre, pas
  stitchW: 1.75, rowH: 1.45, // maille : largeur, hauteur de rang
};

// densité radiale des fibres (Zhao et al. 2016) : ρ(R) = (1 − 2ε)((e − e^R)/(e − 1))^β + ε
const density = (R, Y) => (1 - 2 * Y.eps) * ((Math.E - Math.exp(R)) / (Math.E - 1)) ** Y.beta + Y.eps;

// spec : { seed, clear (rayon de l'emprise du cristal, mm), lite }
export function buildWool({ seed = 1, clear = 1.9, lite = false }) {
  const rng = createRng(`wool:${seed}`);
  const Y = YARN;
  const near = new Tubes(), far = new Tubes(), shadow = new Tubes();
  const NEAR = lite ? 2.6 : 3.4, FAR = 13;
  const w = Y.stitchW, h = Y.rowH;
  const step = 0.025;
  const ox = w * 0.25, oz = -h * 0.12; // (la jambe d'une maille sous le centre du cadre)
  const runs = (n, pred) => { const out = []; let cur = null; for (let k = 0; k < n; k++) { if (pred(k)) { if (!cur) out.push(cur = []); cur.push(k); } else cur = null; } return out; };
  for (let r = -9; r <= 9; r++) {
    const zr = r * h + oz;
    const C = [];
    const c0 = -8.5, c1 = 8.5;
    const n = Math.ceil(((c1 - c0) * w) / step);
    const phiOf = (k) => { const s = c0 + ((c1 - c0) * k) / n; return s - Math.floor(s); };
    for (let k = 0; k <= n; k++) {
      const s = c0 + ((c1 - c0) * k) / n, phi = s - Math.floor(s);
      const x = s * w + ox;
      const z = zr + (h / 2) * Math.cos(TAU * phi) + 0.08 * Math.sin(TAU * phi * 2);
      let y = -Y.R - 0.3 * Math.cos(TAU * phi) ** 2; // (jambes en avant, tête et pied derrière)
      y -= 0.006 * (x * x + z * z); // (le gant s'arrondit)
      C.push([x, y, z]);
    }
    const FC = frames(C);
    const dist = (k) => Math.hypot(C[k][0], C[k][2]);
    // ombre des rangs voisins sur les parties passées derrière
    const rowOcc = (k) => Math.min(1, Math.cos(TAU * phiOf(k)) ** 2 * 1.15);
    for (let p = 0; p < Y.plies; p++) {
      const thp = (p / Y.plies) * TAU;
      // axe du brin et repère du brin (N vers l'extérieur du fil)
      const ply = [], PN = [], PB = [];
      for (let k = 0; k <= n; k++) {
        const th = thp + (TAU * k * step) / Y.plyPitch;
        const dN = [FC[k].N[0] * Math.cos(th) + FC[k].B[0] * Math.sin(th), FC[k].N[1] * Math.cos(th) + FC[k].B[1] * Math.sin(th), FC[k].N[2] * Math.cos(th) + FC[k].B[2] * Math.sin(th)];
        const o = Y.R - Y.plyR;
        ply.push([C[k][0] + dN[0] * o, C[k][1] + dN[1] * o, C[k][2] + dN[2] * o]);
        PN.push(dN); PB.push(norm(cross(FC[k].T, dN)));
      }
      const at = (k, th, R) => {
        const c = Math.cos(th) * R * Y.plyR * Y.eN, s = Math.sin(th) * R * Y.plyR * Y.eB;
        return [ply[k][0] + PN[k][0] * c + PB[k][0] * s, ply[k][1] + PN[k][1] * c + PB[k][1] * s, ply[k][2] + PN[k][2] * c + PB[k][2] * s];
      };
      // ombre ambiante : distance au centre du fil (Wu et Yuksel § 3.5) et rangs voisins
      const aoAt = (q, k) => {
        const d = Math.hypot(q[0] - C[k][0], q[1] - C[k][1], q[2] - C[k][2]) / Y.R;
        return Math.min(1, Math.max(rowOcc(k), 1 - Math.min(1, d) * 0.9));
      };
      // fibre de cœur
      for (const run of runs(n + 1, (k) => dist(k) < NEAR + 0.6)) {
        near.add(run.map((k) => ply[k]), Y.plyR * Y.coreR, 12, (j, a) => [a, run[j] * step, Math.max(rowOcc(run[j]), 0.35), 0]);
      }
      for (const run of runs(n + 1, (k) => dist(k) >= NEAR - 0.2 && dist(k) < FAR)) {
        const sub = run.filter((_, j) => j % 3 === 0 || j === run.length - 1);
        far.add(sub.map((k) => ply[k]), Y.plyR * 0.95, 10, (j, a) => [a, sub[j] * step, rowOcc(sub[j]) * 0.8, 0]);
      }
      // porteur d'ombre : le brin entier, en tube simple (§ 3.4)
      for (const run of runs(n + 1, (k) => dist(k) < 7)) {
        const sub = run.filter((_, j) => j % 2 === 0 || j === run.length - 1);
        shadow.add(sub.map((k) => ply[k]), Y.plyR * 0.9, 6, () => [0, 0, 0, 0]);
      }
      // fibres explicites : celles du dehors du brin (le cœur porte les autres)
      const nf = lite ? Math.round(Y.fibers * 0.5) : Y.fibers;
      const period = Y.alpha / Y.s; // (longueur d'une migration, mm)
      for (let f = 0; f < nf; f++) {
        let Ri;
        do Ri = Y.coreR * 0.7 + rng.next() * (1 - Y.coreR * 0.7); while (rng.next() > density(Ri, Y));
        const thi = rng.range(0, TAU), id = rng.next();
        // une période sur quelques-unes : boucle, ou poil
        const kind = (k) => { const P = Math.floor((k * step) / period); const hh = ((P * 73856093) ^ (f * 19349663) ^ (p * 83492791) ^ (r * 2654435761)) >>> 0; const x = (hh % 1000) / 1000; return x < Y.pLoop ? 'loop' : x < Y.pLoop + Y.pHair ? 'hair' : 'mig'; };
        const pieces = [];
        let cur = [];
        let prevKind = 'mig';
        for (let k = 0; k <= n; k++) {
          const l = k * step, th = thi + (TAU * l) / Y.alpha;
          const kd = kind(k), within = ((l % period) / period);
          let R = (Ri / 2) * (Y.rMax + Y.rMin + (Y.rMax - Y.rMin) * Math.cos(thi + Y.s * (TAU * l) / Y.alpha));
          if (kd === 'loop') R = (Ri / 2) * (Y.rLoop + Y.rMin + (Y.rLoop - Y.rMin) * Math.cos(thi + Y.s * (TAU * l) / Y.alpha));
          let q;
          if (kd === 'hair' && within < 0.45) {
            // le poil : la fibre est rompue ; son bout libre part loin du brin et y revient
            if (prevKind !== 'hair' || within < step / period) { if (cur.length) pieces.push({ pts: cur, hair: false }); cur = []; }
            const x = within / 0.45;
            const Rh = (Y.rHair[0] + (Y.rHair[1] - Y.rHair[0]) * ((f * 7 + r * 3) % 10) / 10) * (1 - x) + Y.rMin * x;
            q = at(k, thi + (TAU * l) / Y.alphaHair, Rh);
            q[1] -= 0.06 * (1 - x) ** 2; // (le bout libre retombe un peu)
            if (!cur.hair) cur.hair = true;
          } else {
            if (cur.hair) { pieces.push({ pts: cur, hair: true }); cur = [cur[cur.length - 1]]; }
            q = at(k, th, R);
          }
          prevKind = kd;
          cur.push(q);
          cur.ks = cur.ks || [];
          cur.ks.push(k);
        }
        if (cur.length) pieces.push({ pts: cur, hair: !!cur.hair });
        for (const pc of pieces) {
          const ks = pc.pts.ks || pc.pts.map((_, j) => j);
          // seulement près du cristal ; dans son emprise, rien au-dessus de y = 0
          for (const run of runs(pc.pts.length, (j) => dist(ks[Math.min(j, ks.length - 1)] ?? 0) < NEAR)) {
            // (autour du cristal, les fibres sont tassées sous lui : rien ne le dépasse
            // dans son emprise, et elles ne remontent qu'en pente douce au-delà)
            const seg = run.map((j) => { const q = pc.pts[j].slice(); const d = Math.hypot(q[0], q[2]) - clear; q[1] = Math.min(q[1], -Y.fiberR + Math.max(0, d - 0.15) * 0.35); return q; });
            if (pc.hair && run.length && run[0] === 0) {
              // un poil dans l'emprise du cristal le traverserait : on le laisse
              if (seg.some((q, j) => pc.pts[run[j]][1] > -Y.fiberR + Math.max(0, Math.hypot(q[0], q[2]) - clear - 0.15) * 0.35)) continue;
            }
            near.add(seg, pc.hair ? (t) => Y.fiberR * (0.55 + 0.45 * t) : Y.fiberR, 5,
              (j) => [id, j / Math.max(1, seg.length - 1), aoAt(seg[j], ks[Math.min(run[j], ks.length - 1)] ?? 0), pc.hair || kind(ks[run[j]] ?? 0) === 'loop' ? 2 : 1]);
          }
        }
      }
    }
  }
  const N = near.out(), Fa = far.out(), S = shadow.out();
  // le cristal se pose sur la fibre la plus haute de son emprise (y = 0)
  let top = -9;
  for (let i = 0; i < N.position.length; i += 3) if (Math.hypot(N.position[i], N.position[i + 2]) < clear) top = Math.max(top, N.position[i + 1]);
  const dy = -0.0005 - top;
  for (const P of [N.position, Fa.position, S.position]) for (let i = 1; i < P.length; i += 3) P[i] += dy;
  // points de givre : sur le dessus des fibres, hors de l'ombre
  const fr = [];
  for (let i = 0, v = 0; i < N.position.length; i += 3, v++) {
    if (N.normal[i + 1] < 0.55 || N.fb[v * 4 + 2] > 0.45 || N.fb[v * 4 + 3] < 0.5) continue;
    if ((v * 2654435761 >>> 0) % 23) continue;
    fr.push(N.position[i], N.position[i + 1], N.position[i + 2], N.normal[i], N.normal[i + 1], N.normal[i + 2]);
  }
  return { near: N, far: Fa, shadow: S, top: 0, dy, frost: new Float32Array(fr) };
}
