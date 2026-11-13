// La simulation sur le GPU (shaders de calcul WebGPU sur le périphérique de
// three.js), enregistrée puis relue.
//
// Même algorithme, mêmes passes et mêmes constantes que la référence en JS
// (gen/sim.js) — lire celle-ci d'abord. Un pas de temps = sept passes :
//   sources  — débit de la boîte, pluie, niveau imposé au déversoir
//   flux     — tuyaux virtuels, frottement de Manning
//   carry    — le sédiment suit les flux d'eau (conservatif)
//   depth    — hauteur d'eau, vitesse
//   erode    — arrachement / dépôt (Meyer-Peter–Müller, vitesse de chute), diffusion du lit,
//              mémoire de l'humidité, cumul du cisaillement (rides)
//   talusOut, talusIn — effondrement au-delà de l'angle de talus
// Le temps hydraulique avance d'un pas fixe ; les grandeurs qui en dépendent
// (débit, pluie, niveau de base) sont calculées sur le processeur pour chaque
// pas et lues par un décalage dynamique dans un tampon d'uniformes.
//
// Enregistrement (passe record) : FT états du lit à pleine résolution (b − b₀
// en demi-flottant, 2 octets), lissés à la relecture par une B-spline dans le
// temps (l'érosion du sable est un changement régulier) ; FM états de sa mémoire
// (le plus bas atteint, l'humidité, les rides, 4 octets) ; FW états de l'eau et,
// avec chacun, l'INSTANT où chaque cellule a changé dans l'intervalle qui le
// précède : pendant la simulation, une passe accumule pour chaque cellule Σ|Δ|,
// Σ t·|Δ|, Σ t²·|Δ| de la surface libre (t : position du pas dans l'intervalle) ;
// on en tire l'instant moyen et l'étalement (8 bits chacun). À la relecture, un
// front d'eau fait basculer chaque cellule à son instant et glisse à sa vraie
// vitesse, au lieu de s'effacer d'un côté pendant qu'il apparaît de l'autre (le
// « stop motion » de toute interpolation qui mélange deux états) et FW états de l'eau à demi-résolution
// (surface libre − b₀, turbidité, vitesse). Puis, à chaque image, la passe
// resolve interpole les états — le relief en Catmull-Rom dans le temps sur
// quatre états, borné par les deux états encadrants : sa vitesse est continue
// (une interpolation linéaire entre états espacés de 0,45 s faisait avancer
// l'érosion par saccades) — et applique le gabarit ; elle écrit les
// StorageTexture que les matériaux lisent.
import * as THREE from 'three/webgpu';
import { TABLE, inflowAt, rainAt, baseAt, fbm, MAX_LAYERS } from '../gen/table.js';
import { PHYS } from '../gen/sim.js';

const WG = 64;
const ALIGN = 256; // (décalages dynamiques d'uniformes)

function wgsl(NX, NY) {
  const P = PHYS, f = (x) => (Number.isInteger(x) ? `${x}.0` : `${x}`);
  return /* wgsl */`
const NX: u32 = ${NX}u;
const NY: u32 = ${NY}u;
const N: u32 = ${NX * NY}u;
const OUT: u32 = ${NX - 2}u;
const L: f32 = ${f(TABLE.Lx / NX)};
const A: f32 = ${f((TABLE.Lx / NX) ** 2)};
const G: f32 = ${f(P.g)};
const MAN: f32 = ${f(P.manning)};
const DWET: f32 = ${f(P.dWet)};
const VMAX: f32 = ${f(P.vMax)};
const KC: f32 = ${f(P.Kc)};
const TAUC: f32 = ${f(P.tauC)};
const KS: f32 = ${f(P.Ks)};
const WS: f32 = ${f(P.ws)};
const EMAX: f32 = ${f(P.eMax)};
const DVEL: f32 = ${f(P.dVel)};
const TWET: f32 = ${f(P.talusWet)};
const DSUB: f32 = ${f(P.dSub)};
const TDAMP: f32 = ${f(P.talusDamp)};
const TRATE: f32 = ${f(P.talusRate)};
const DIFF: f32 = ${f(P.diffuse)};
const TDRY: f32 = ${f(P.tDry)};
const KRIP: f32 = ${f(P.kRip)};

struct Strata { nl: u32, p0: u32, p1: u32, p2: u32, lay: array<vec4f, ${MAX_LAYERS}> };
struct Step { q: f32, r: f32, lvl: f32, mf: f32, dt: f32, p0: f32, p1: f32, p2: f32 };
@group(0) @binding(0) var<storage, read_write> cell: array<vec4f>;  // b, d, bmin, humidité
@group(0) @binding(1) var<storage, read_write> sA: array<f32>;      // sédiment
@group(0) @binding(2) var<storage, read_write> sB: array<f32>;
@group(0) @binding(3) var<storage, read_write> flux: array<vec4f>;  // sorties vers −x, +x, −y, +y
@group(0) @binding(4) var<storage, read_write> aux: array<vec4f>;   // vx, vy, rides, lit provisoire
@group(0) @binding(5) var<storage, read_write> tout: array<vec4f>;  // talus : 8 sorties (2 par cellule)
@group(0) @binding(6) var<storage, read> stat: array<vec4f>;        // b₀, érodabilité, poids source, poids pluie
@group(0) @binding(7) var<uniform> SG: Strata;
@group(1) @binding(0) var<uniform> P: Step;

fn hardAt(depth: f32) -> f32 {
  var k = SG.nl - 1u;
  for (var i = 0u; i < SG.nl; i++) { if (depth <= SG.lay[i].x) { k = i; break; } }
  let h = SG.lay[k].y;
  if (k + 1u < SG.nl) {
    let t = smoothstep(SG.lay[k].x - 0.0006, SG.lay[k].x + 0.0006, depth);
    return mix(h, SG.lay[k + 1u].y, t);
  }
  return h;
}

@compute @workgroup_size(${WG}) fn sources(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x; if (c >= N) { return; }
  let i = c % NX;
  var v = cell[c];
  let st = stat[c];
  v.y += (P.q * st.z + P.r * st.w) * P.dt;
  var s = sA[c];
  if (i >= OUT) { v.y = max(0.0, P.lvl - v.x); s = 0.0; }
  cell[c] = v; sA[c] = s;
}

fn flowTo(f: f32, h: f32, n: u32, ok: bool, damp: f32) -> f32 {
  if (!ok) { return 0.0; }
  let q = cell[n];
  return max(0.0, (f + P.dt * A * G * (h - q.x - q.y) / L) * damp);
}
@compute @workgroup_size(${WG}) fn fluxes(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x; if (c >= N) { return; }
  let i = c % NX; let j = c / NX;
  let v = cell[c];
  if (v.y < DWET) { flux[c] = vec4f(0.0); return; }
  let h = v.x + v.y;
  let ve = aux[c].xy;
  let kf = G * MAN * MAN * length(ve) / pow(max(v.y, 1e-4), 4.0 / 3.0);
  let damp = 1.0 / (1.0 + P.dt * kf);
  let f0 = flux[c];
  let a = flowTo(f0.x, h, c - 1u, i > 0u, damp);
  let e = flowTo(f0.y, h, c + 1u, i < NX - 1u, damp);
  let t = flowTo(f0.z, h, c - NX, j > 0u, damp);
  let u = flowTo(f0.w, h, c + NX, j < NY - 1u, damp);
  let sum = a + e + t + u;
  var K = 0.0;
  if (sum > 0.0) { K = min(1.0, v.y * A / (sum * P.dt)); }
  flux[c] = vec4f(a, e, t, u) * K;
}

fn conc(n: u32) -> f32 { let dd = cell[n].y; return select(0.0, sA[n] / dd, dd > DWET); }
@compute @workgroup_size(${WG}) fn carry(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x; if (c >= N) { return; }
  let i = c % NX; let j = c / NX;
  var inn = 0.0;
  if (i > 0u) { inn += flux[c - 1u].y * conc(c - 1u); }
  if (i < NX - 1u) { inn += flux[c + 1u].x * conc(c + 1u); }
  if (j > 0u) { inn += flux[c - NX].w * conc(c - NX); }
  if (j < NY - 1u) { inn += flux[c + NX].z * conc(c + NX); }
  let f = flux[c];
  sB[c] = max(0.0, sA[c] + P.dt * (inn - conc(c) * (f.x + f.y + f.z + f.w)) / A);
}

@compute @workgroup_size(${WG}) fn depth(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x; if (c >= N) { return; }
  let i = c % NX; let j = c / NX;
  let inL = select(0.0, flux[c - 1u].y, i > 0u);
  let inR = select(0.0, flux[c + 1u].x, i < NX - 1u);
  let inT = select(0.0, flux[c - NX].w, j > 0u);
  let inB = select(0.0, flux[c + NX].z, j < NY - 1u);
  let f = flux[c];
  let d0 = cell[c].y;
  let d1 = max(0.0, d0 + P.dt * (inL + inR + inT + inB - f.x - f.y - f.z - f.w) / A);
  cell[c].y = d1;
  let dm = (d0 + d1) * 0.5;
  var ve = vec2f(0.0);
  if (dm >= DWET) {
    let dv = max(dm, DVEL);
    ve = vec2f((inL - f.x + f.y - inR) * 0.5 / (dv * L), (inT - f.z + f.w - inB) * 0.5 / (dv * L));
    let m = length(ve);
    if (m > VMAX) { ve *= VMAX / m; }
  }
  aux[c] = vec4f(ve, aux[c].zw);
}

@compute @workgroup_size(${WG}) fn erode(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x; if (c >= N) { return; }
  let i = c % NX; let j = c / NX;
  let v = cell[c];
  var bN = v.x;
  var s = sB[c];
  var rip = aux[c].z;
  if (i >= 1u && i < OUT && j >= 1u && j < NY - 1u) {
    let wc = select(0.0, 1.0, v.y >= DWET);
    var lap = 0.0;
    let nb = array<u32, 4>(c - 1u, c + 1u, c - NX, c + NX);
    for (var k = 0u; k < 4u; k++) {
      let n = nb[k]; let ni = n % NX; let nj = n / NX;
      if (ni < 1u || ni >= OUT || nj < 1u || nj >= NY - 1u) { continue; }
      let q = cell[n];
      lap += 0.5 * (wc + select(0.0, 1.0, q.y >= DWET)) * (q.x - v.x);
    }
    bN += min(0.2, DIFF * P.dt * P.mf / A) * lap;
    var wet = 1.0;
    if (v.y < DWET) {
      wet = v.w * exp(-P.dt / TDRY);
      if (s > 0.0) { bN += s * P.mf; s = 0.0; }
    } else {
      let vm = length(aux[c].xy);
      let tau = MAN * MAN * vm * vm / pow(max(v.y, 0.001), 1.0 / 3.0);
      let C = KC * pow(max(0.0, tau - TAUC), 1.5);
      // (des rides ne se forment que sous une vraie lame d'eau, pas sous le ruissellement de la pluie)
      rip = min(1.0, rip + KRIP * max(0.0, tau - TAUC) * smoothstep(0.004, 0.008, v.y) * P.dt);
      if (s < C) {
        let st = stat[c];
        let hard = select(hardAt(st.x - v.x), 0.0, v.x > v.z + 0.0002);
        let deep = 1.0 - clamp((v.y - 0.012) / 0.01, 0.0, 1.0);
        let e = min(EMAX / P.mf, KS * (1.0 - hard) * st.y * deep * (C - s) * P.dt);
        bN -= e * P.mf; s += e;
      } else {
        let e = (s - C) * min(1.0, WS * P.dt / max(v.y, 0.001));
        bN += e * P.mf; s -= e;
      }
    }
    cell[c].w = wet;
  }
  sA[c] = s;
  aux[c] = vec4f(aux[c].xy, rip, bN);
}

const D8 = array<vec2i, 8>(vec2i(-1, 0), vec2i(1, 0), vec2i(0, -1), vec2i(0, 1), vec2i(-1, -1), vec2i(1, 1), vec2i(1, -1), vec2i(-1, 1));
fn inside(p: vec2i) -> bool { return p.x >= 1 && p.x < i32(OUT) && p.y >= 1 && p.y < i32(NY) - 1; }
@compute @workgroup_size(${WG}) fn talusOut(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x; if (c >= N) { return; }
  let p = vec2i(i32(c % NX), i32(c / NX));
  var o = array<f32, 8>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  if (inside(p)) {
    let tn = select(TDAMP, TWET, cell[c].y > DSUB);
    let bc = aux[c].w;
    var tot = 0.0; var mx = 0.0;
    for (var k = 0u; k < 8u; k++) {
      let q = p + D8[k];
      if (!inside(q)) { continue; }
      let dist = select(L * 1.41421356, L, k < 4u);
      let ex = max(0.0, bc - aux[u32(q.y) * NX + u32(q.x)].w - tn * dist);
      o[k] = ex; tot += ex; mx = max(mx, ex);
    }
    let fct = select(0.0, TRATE * mx * 0.5 / tot, tot > 0.0);
    for (var k = 0u; k < 8u; k++) { o[k] *= fct; }
  }
  tout[2u * c] = vec4f(o[0], o[1], o[2], o[3]);
  tout[2u * c + 1u] = vec4f(o[4], o[5], o[6], o[7]);
}
fn outOf(n: u32, k: u32) -> f32 { let v = tout[2u * n + k / 4u]; let m = k % 4u; return select(select(select(v.w, v.z, m == 2u), v.y, m == 1u), v.x, m == 0u); }
@compute @workgroup_size(${WG}) fn talusIn(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x; if (c >= N) { return; }
  let p = vec2i(i32(c % NX), i32(c / NX));
  var b = aux[c].w;
  if (inside(p)) {
    var delta = 0.0;
    for (var k = 0u; k < 8u; k++) {
      delta -= outOf(c, k);
      let q = p + D8[k];
      if (inside(q)) { delta += outOf(u32(q.y) * NX + u32(q.x), k ^ 1u); }
    }
    b += delta;
  }
  cell[c].x = b;
  cell[c].z = min(cell[c].z, b);
}
`;
}

// ── Enregistrement, aperçu, relecture ────────────────────────────────────────
function wgslIO(NX, NY) {
  const HX = NX / 2, HY = NY / 2;
  return /* wgsl */`
const NX: u32 = ${NX}u;
const NY: u32 = ${NY}u;
const N: u32 = ${NX * NY}u;
const HX: u32 = ${HX}u;
const HY: u32 = ${HY}u;
const HN: u32 = ${HX * HY}u;
const L: f32 = ${TABLE.Lx / NX};
const DWET: f32 = ${PHYS.dWet};
struct Rec { frame: u32, kind: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<storage, read> cell: array<vec4f>;
@group(0) @binding(1) var<storage, read> sA: array<f32>;
@group(0) @binding(2) var<storage, read> aux: array<vec4f>;
@group(0) @binding(3) var<storage, read> stat: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> recT: array<u32>;    // (écrit par le module des instants)
@group(0) @binding(5) var<storage, read_write> recW: array<vec2u>;
@group(0) @binding(6) var<storage, read_write> prev: array<vec2f>;   // aperçu 128 × 64 (écran de chargement)
@group(0) @binding(7) var<storage, read_write> recM: array<u32>;    // bmin − b₀ (demi-flottant), humidité, rides (8 bits)
@group(1) @binding(0) var<uniform> R: Rec;

@compute @workgroup_size(64) fn recMemory(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x; if (c >= N) { return; }
  let bm = pack2x16float(vec2f(cell[c].z - stat[c].x, 0.0)) & 0xFFFFu;
  let w = u32(round(clamp(cell[c].w, 0.0, 1.0) * 255.0)); let r = u32(round(clamp(aux[c].z, 0.0, 1.0) * 255.0));
  recM[R.frame * N + c] = bm | (w << 16u) | (r << 24u);
}
@compute @workgroup_size(64) fn recWater(@builtin(global_invocation_id) gid: vec3u) {
  let h = gid.x; if (h >= HN) { return; }
  let hi = h % HX; let hj = h / HX;
  var eta = 0.0; var b0 = 0.0; var nw = 0.0; var tb = 0.0; var ve = vec2f(0.0); var dw = 0.0;
  for (var k = 0u; k < 4u; k++) {
    let c = (2u * hj + k / 2u) * NX + 2u * hi + k % 2u;
    let v = cell[c];
    b0 += stat[c].x;
    if (v.y >= DWET) { eta += v.x + v.y; nw += 1.0; tb += sA[c] / v.y; ve += aux[c].xy * v.y; dw += v.y; }
  }
  b0 *= 0.25;
  var rel = -1.0; var turb = 0.0; var vel = vec2f(0.0);
  if (nw > 0.0) { rel = eta / nw - b0; turb = tb / nw; vel = ve / max(dw, 1e-6); }
  recW[R.frame * HN + h] = vec2u(pack2x16float(vec2f(rel, turb * 100.0)), pack2x16float(vel));
}
@compute @workgroup_size(64) fn preview(@builtin(global_invocation_id) gid: vec3u) {
  let p = gid.x; if (p >= 8192u) { return; }
  let pi = p % 128u; let pj = p / 128u;
  let sx = NX / 128u; let sy = NY / 64u;
  var dz = 0.0; var dd = 0.0;
  for (var y = 0u; y < sy; y++) { for (var x = 0u; x < sx; x++) {
    let c = (pj * sy + y) * NX + pi * sx + x;
    dz += cell[c].x - stat[c].x; dd = max(dd, cell[c].y);
  } }
  prev[p] = vec2f(dz / f32(sx * sy), dd);
}
`;
}

// ── Instants des changements : accumulation à chaque pas, enregistrement ──
function wgslTiming(NX, NY) {
  const HX = NX / 2, HY = NY / 2;
  const head = /* wgsl */`
const NX: u32 = ${NX}u;
const NY: u32 = ${NY}u;
const N: u32 = ${NX * NY}u;
const HX: u32 = ${HX}u;
const HN: u32 = ${HX * HY}u;
@group(0) @binding(0) var<storage, read> cell: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> acc: array<vec4f>;   // lit : Σ|Δ|, Σt|Δ|, Σt²|Δ|, valeur au pas précédent
@group(0) @binding(3) var<storage, read_write> accW: array<vec4f>;  // surface libre : idem
`;
  const acc = head + /* wgsl */`
struct Step { q: f32, r: f32, lvl: f32, mf: f32, dt: f32, fT: f32, fW: f32, p2: f32 };
@group(1) @binding(0) var<uniform> P: Step;
@compute @workgroup_size(64) fn accum(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x; if (c >= N) { return; }
  let v = cell[c];
  let e = v.x + v.y;
  let w = accW[c]; let de = abs(e - w.w);
  accW[c] = vec4f(w.x + de, w.y + de * P.fW, w.z + de * P.fW * P.fW, e);
}
`;
  const rec = head + /* wgsl */`
@group(0) @binding(1) var<storage, read> stat: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> recT: array<u32>;    // b − b₀ de deux cellules voisines (demi-flottants)
@group(0) @binding(5) var<storage, read_write> recWT: array<u32>;   // instant | étalement de la surface libre (demi-résolution)
struct Rec { frame: u32, kind: u32, p0: u32, p1: u32 };
@group(1) @binding(0) var<uniform> R: Rec;
fn timing(a: vec3f, thr: f32) -> u32 {
  if (a.x < thr) { return 128u | (148u << 8u); } // (presque rien n'a bougé : interpolation linéaire, code réservé)
  let tau = a.y / a.x;
  let sg = sqrt(max(0.0, a.z / a.x - tau * tau));
  return u32(round(clamp(tau, 0.0, 1.0) * 255.0)) | (u32(round(clamp(sg, 0.0, 0.5) * 510.0)) << 8u);
}
@compute @workgroup_size(64) fn recBed(@builtin(global_invocation_id) gid: vec3u) {
  let p = gid.x; if (p >= N / 2u) { return; }
  let c = 2u * p;
  recT[R.frame * (N / 2u) + p] = pack2x16float(vec2f(cell[c].x - stat[c].x, cell[c + 1u].x - stat[c + 1u].x));
}
@compute @workgroup_size(64) fn recWaterTime(@builtin(global_invocation_id) gid: vec3u) {
  let h = gid.x; if (h >= HN) { return; }
  let hi = h % HX; let hj = h / HX;
  var sum = vec3f(0.0);
  for (var k = 0u; k < 4u; k++) {
    let c = (2u * hj + k / 2u) * NX + 2u * hi + k % 2u;
    let w = accW[c];
    sum += w.xyz;
    accW[c] = vec4f(0.0, 0.0, 0.0, w.w);
  }
  recWT[R.frame * HN + h] = timing(sum, 0.002);
}
`;
  return { acc, rec };
}

function wgslResolve(NX, NY) {
  const HX = NX / 2, HY = NY / 2;
  return /* wgsl */`
const NX: u32 = ${NX}u;
const NY: u32 = ${NY}u;
const N: u32 = ${NX * NY}u;
const HX: u32 = ${HX}u;
const HY: u32 = ${HY}u;
const HN: u32 = ${HX * HY}u;
const L: f32 = ${TABLE.Lx / NX};
struct Res {
  t0: u32, t1: u32, w0: u32, w1: u32,
  tt: f32, tw: f32, water: f32, screed: f32,   // mélange des états, eau visible (0–1), position de la lame (m, −1 : pas de passage)
  bermTan: f32, bead: f32, drain: f32, tm: f32, // pente du bourrelet, bourrelet minimal (m), infiltration de l'eau restante (0–1), mélange de la mémoire
  tA: u32, tD: u32, m0: u32, m1: u32,          // états voisins (B-spline dans le temps), états de la mémoire
  lp: vec3f, lpen: f32,                        // position de la lampe principale (monde), demi-pénombre (rad)
};
@group(0) @binding(0) var<storage, read> recT: array<u32>;   // b − b₀ de deux cellules voisines
@group(0) @binding(1) var<storage, read> recW: array<vec2u>;
@group(0) @binding(2) var<storage, read> stat: array<vec4f>;
@group(0) @binding(3) var<storage, read> surplus: array<f32>;  // matière poussée par la lame, cumulée depuis l'aval (m²)
@group(0) @binding(4) var terr: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var wat: texture_storage_2d<rgba32float, write>;
@group(0) @binding(6) var<storage, read_write> cur: array<vec4f>;   // relief courant : b, humidité, rides, profondeur atteinte
@group(0) @binding(7) var nrm: texture_storage_2d<rgba16float, write>; // nx, nz, humidité, rides (filtrable)
@group(0) @binding(8) var occ: texture_storage_2d<rgba16float, write>; // occlusion du relief, creux, profondeur atteinte, ombre portée de la lampe (filtrable)
@group(0) @binding(9) var<storage, read> recM: array<u32>;
@group(0) @binding(10) var<storage, read> recWT: array<u32>;
@group(1) @binding(0) var<uniform> R: Res;

// Avancement (0–1) d'une cellule dans l'intervalle, au temps t (0–1) : elle
// bascule à l'instant enregistré, sur la durée de son étalement (le front passe).
// F(0) = 0 et F(1) = 1 exactement : pas de saut aux états. Sans changement
// mesurable, ou très étalé, c'est l'interpolation linéaire.
fn advance(t: f32, code: u32, sgMin: f32) -> f32 {
  let tau = f32(code & 255u) / 255.0;
  let sg = max(max(f32((code >> 8u) & 255u) / 510.0, 0.03), sgMin);
  let lo = tau - 1.7 * sg; let hi = tau + 1.7 * sg;
  let g0 = smoothstep(lo, hi, 0.0); let g1 = smoothstep(lo, hi, 1.0);
  if (g1 - g0 < 0.05) { return t; }
  // (un changement étalé sur tout l'intervalle — régulier — reste linéaire : une
  // courbe en S dans chaque intervalle ferait battre la vitesse au rythme des états)
  return mix((smoothstep(lo, hi, t) - g0) / (g1 - g0), t, smoothstep(0.12, 0.24, sg));
}
const DEF: u32 = 128u | (148u << 8u); // (code « rien n'a changé »)
fn bAt(k: u32, c: u32) -> f32 { let v = unpack2x16float(recT[k * (N / 2u) + c / 2u]); return select(v.x, v.y, (c & 1u) == 1u); }
// lit enregistré (b − b₀) à la cellule c, entre les états t0 et t1 : B-spline
// cubique dans le temps sur quatre états (C², sans dépassement). L'érosion du sable
// est un changement régulier (les instants enregistrés le montrent : presque
// toutes les cellules changent sur tout l'intervalle) ; une bascule par cellule,
// essayée ici, faisait ressortir des cellules isolées en petits carrés.
fn relAt(c: u32) -> f32 {
  let b0v = bAt(R.t0, c); let b1v = bAt(R.t1, c);
  let ba = bAt(R.tA, c); let bd = bAt(R.tD, c);
  let t = R.tt; let s = 1.0 - t;
  return (ba * (s * s * s) + b0v * (3.0 * t * t * t - 6.0 * t * t + 4.0) + b1v * (-3.0 * t * t * t + 3.0 * t * t + 3.0 * t + 1.0) + bd * (t * t * t)) / 6.0;
}

@compute @workgroup_size(8, 8) fn resolve(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; let j = gid.y;
  if (i >= NX || j >= NY) { return; }
  let c = j * NX + i;
  let b0 = stat[c].x;
  let rb = relAt(c);                  // b − b₀
  let M0 = recM[R.m0 * N + c]; let M1 = recM[R.m1 * N + c];
  // le plus bas atteint : celui de l'état de mémoire antérieur (il ne peut qu'être
  // plus haut que le vrai), borné par le lit courant — c'est un minimum courant
  let bmr = min(unpack2x16float(M0 & 0xFFFFu).x, rb);
  let mem = mix(vec2f(f32((M0 >> 16u) & 0xFFu), f32(M0 >> 24u)), vec2f(f32((M1 >> 16u) & 0xFFu), f32(M1 >> 24u)), R.tm) / 255.0; // humidité, rides
  var b = b0 + rb;
  var dep = max(0.0, rb - bmr);       // épaisseur de dépôt frais
  var depth = max(0.0, -bmr);         // profondeur atteinte sous b₀ (strates)
  var fresh = 0.0;                    // sable retourné par la lame
  var rip = mem.y;
  var wet = mem.x;
  if (R.screed > -1.5) {
    let x = (f32(i) + 0.5) * L;
    if (x >= R.screed) {
      // derrière la lame : la surface du gabarit
      b = b0; dep = 0.0; depth = 0.0; rip = 0.0; fresh = 1.0;
    } else {
      // devant : le bourrelet de sable poussé, talus à l'angle de repos
      let k = min(NX - 1u, u32(R.screed / L));
      let V = max(R.bead * R.bead / (2.0 * R.bermTan), surplus[j * NX + k]);
      let hB = sqrt(2.0 * V * R.bermTan);
      let crest = stat[j * NX + k].x + hB - (R.screed - x) * R.bermTan;
      if (crest > b) { b = crest; dep = crest - b0 + depth; rip = 0.0; fresh = 1.0; }
    }
  }
  if (fresh > 0.5) { wet = 0.0; }
  textureStore(terr, vec2u(i, j), vec4f(b, depth, dep, fresh));
  cur[c] = vec4f(b, wet, rip, depth); // (la profondeur atteinte repart dans la texture filtrable)
  // eau (demi-résolution)
  if (i < HX && j < HY) {
    let h = j * HX + i;
    let e0 = recW[R.w0 * HN + h]; let e1 = recW[R.w1 * HN + h];
    // (le front d'eau arrive à son instant, étalé sur l'écart avec les voisines)
    let hi2 = h % HX; let hj2 = h / HX; let me = f32(recWT[R.w1 * HN + h] & 255u) / 255.0;
    var gw = 0.0;
    let nbw = array<u32, 4>(select(h - 1u, h, hi2 == 0u), select(h + 1u, h, hi2 == HX - 1u), select(h - HX, h, hj2 == 0u), select(h + HX, h, hj2 == HY - 1u));
    let mine = recWT[R.w1 * HN + h];
    for (var k = 0u; k < 4u; k++) {
      let o = recWT[R.w1 * HN + nbw[k]];
      // (seulement entre cellules qui ont vraiment changé : le code réservé dit « rien »)
      if (o != DEF && mine != DEF) { gw = max(gw, abs(f32(o & 255u) / 255.0 - me)); }
    }
    // (vagues, débit qui varie : régulier, linéaire ; front qui arrive : à son instant)
    let tw = advance(R.tw, mine, min(0.25, 0.6 * gw));
    let m0 = unpack2x16float(e0.x); let m1 = unpack2x16float(e1.x);
    let v0 = unpack2x16float(e0.y); let v1 = unpack2x16float(e1.y);
    var bb = 0.0; var bn = 0.0;
    for (var k = 0u; k < 4u; k++) {
      let cc = (2u * j + k / 2u) * NX + 2u * i + k % 2u;
      bb += stat[cc].x;
      bn += relAt(cc);
    }
    bb *= 0.25; bn *= 0.25;
    // (un bloc sec vaut « sous le lit » : une rive qui avance monte du fond)
    let dry = bn - 0.004;
    let w0 = select(1.0, 0.0, m0.x < -0.5); let w1 = select(1.0, 0.0, m1.x < -0.5);
    let r0 = select(m0.x, dry, m0.x < -0.5); let r1 = select(m1.x, dry, m1.x < -0.5);
    let wt = mix(w0, w1, tw);
    var eta = bb + mix(r0, r1, tw);
    // à la fin de l'expérience, l'eau qui reste (le lac derrière une digue, les
    // flaques) s'infiltre : la surface libre descend jusqu'au lit (sans cela, elle
    // disparaissait d'un coup)
    eta = mix(eta, bn - 0.0008, R.drain);
    var turb = 0.0; var vel = vec2f(0.0);
    if (wt > 0.0) {
      turb = (m0.y * w0 * (1.0 - tw) + m1.y * w1 * tw) / max(1e-4, w0 * (1.0 - tw) + w1 * tw);
      vel = (v0 * w0 * (1.0 - tw) + v1 * w1 * tw) / max(1e-4, w0 * (1.0 - tw) + w1 * tw);
    }
    if (R.water <= 0.0 || wt <= 0.0 || R.drain >= 1.0) { eta = -1.0; }
    textureStore(wat, vec2u(i, j), vec4f(eta, turb * 0.01, vel));
  }
}

// normales du relief courant (différences centrées, en cellules), humidité, rides
@compute @workgroup_size(8, 8) fn normals(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; let j = gid.y;
  if (i >= NX || j >= NY) { return; }
  let c = j * NX + i;
  let iL = select(i - 1u, 0u, i == 0u); let iR = min(NX - 1u, i + 1u);
  let jT = select(j - 1u, 0u, j == 0u); let jB = min(NY - 1u, j + 1u);
  let gx = (cur[j * NX + iR].x - cur[j * NX + iL].x) / (f32(iR - iL) * L);
  let gy = (cur[jB * NX + i].x - cur[jT * NX + i].x) / (f32(jB - jT) * L);
  let n = normalize(vec3f(-gx, 1.0, -gy));
  let v = cur[c];
  textureStore(nrm, vec2u(i, j), vec4f(n.x, n.z, v.y, v.z));
  // occlusion par l'horizon du relief : 8 directions, 5 pas (2,5 mm à 4 cm)
  let h0 = v.x;
  var vis = 0.0;
  for (var k = 0u; k < 8u; k++) {
    let a = f32(k) * 0.7853982 + 0.39;
    let dir = vec2f(cos(a), sin(a));
    var hmax = 0.0;
    var r = 1.0;
    for (var s = 0u; s < 5u; s++) {
      let q = vec2i(vec2f(f32(i), f32(j)) + dir * r);
      let qc = clamp(q, vec2i(0), vec2i(i32(NX) - 1, i32(NY) - 1));
      let dh = cur[u32(qc.y) * NX + u32(qc.x)].x - h0;
      hmax = max(hmax, dh / (r * L));
      r *= 2.0;
    }
    vis += 1.0 - sin(atan(hmax));
  }
  vis /= 8.0;
  // creux : hauteur sous la moyenne des voisins à 3 cellules (en mm)
  var m = 0.0;
  for (var k = 0u; k < 8u; k++) {
    let a = f32(k) * 0.7853982;
    let q = clamp(vec2i(vec2f(f32(i), f32(j)) + vec2f(cos(a), sin(a)) * 3.0), vec2i(0), vec2i(i32(NX) - 1, i32(NY) - 1));
    m += cur[u32(q.y) * NX + u32(q.x)].x;
  }
  let cav = clamp((m / 8.0 - h0) * 400.0, -1.0, 1.0);
  // Ombre portée du relief par la lampe principale : un tracé vers la lampe sur la
  // carte de hauteur (pas d'une cellule, puis de plus en plus longs, jusqu'à ~1 m),
  // pénombre selon la taille apparente de la lampe. Exacte à la cellule et lisse
  // une fois filtrée — la carte d'ombre, étirée en lumière rasante sur tout le
  // bac, dessinait des escaliers de plusieurs millimètres sur les bords d'ombre.
  let P = vec3f((f32(i) + 0.5) * L - f32(NX) * L * 0.5, h0, (f32(j) + 0.5) * L - f32(NY) * L * 0.5);
  let dl = R.lp - P;
  let hd = max(length(dl.xz), 1e-5);
  let dir = dl.xz / hd;
  let tanL = dl.y / hd;
  var mt = -1.0e6;
  var sd = 1.0;
  for (var k = 0u; k < 80u; k++) {
    let q = vec2f(f32(i), f32(j)) + dir * sd;
    if (q.x < 0.0 || q.y < 0.0 || q.x > f32(NX - 1u) || q.y > f32(NY - 1u)) { break; }
    let q0 = vec2u(floor(q)); let fq = fract(q);
    let q1 = min(q0 + vec2u(1u, 1u), vec2u(NX - 1u, NY - 1u));
    let hq = mix(mix(cur[q0.y * NX + q0.x].x, cur[q0.y * NX + q1.x].x, fq.x), mix(cur[q1.y * NX + q0.x].x, cur[q1.y * NX + q1.x].x, fq.x), fq.y);
    mt = max(mt, (hq - h0) / (sd * L));
    sd += max(1.0, sd * 0.05);
  }
  let sh = smoothstep(-R.lpen, R.lpen, atan(tanL) - atan(mt));
  textureStore(occ, vec2u(i, j), vec4f(vis, cav, v.w, sh));
}
`;
}

export function createGpuSim(renderer, { lite = false } = {}) {
  const device = renderer.backend.device;
  const NX = lite ? TABLE.NX / 2 : TABLE.NX, NY = lite ? TABLE.NY / 2 : TABLE.NY, N = NX * NY;
  const HX = NX / 2, HY = NY / 2, HN = HX * HY;
  // (lit : 480 états, un toutes les ~0,065 s de film ; mémoire : 96 ;
  // eau : 192, avec l'instant de chaque changement)
  const FT = lite ? 240 : 480, FW = lite ? 96 : 192, FM = lite ? 48 : 96;
  const l = TABLE.Lx / NX, dt = PHYS.courant * l;
  const S_ = GPUBufferUsage.STORAGE, CD = GPUBufferUsage.COPY_DST, CS = GPUBufferUsage.COPY_SRC;
  const buf = (size, usage = S_ | CD | CS) => device.createBuffer({ size, usage });
  const B = {
    cell: buf(N * 16), sA: buf(N * 4), sB: buf(N * 4), flux: buf(N * 16), aux: buf(N * 16), tout: buf(N * 32), stat: buf(N * 16),
    strata: buf(16 + MAX_LAYERS * 16, GPUBufferUsage.UNIFORM | CD),
    recT: buf(FT * N * 2), recM: buf(FM * N * 4), recWT: buf(FW * HN * 4), acc: buf(N * 16), accW: buf(N * 16), recW: buf(FW * HN * 8), prev: buf(8192 * 8), surplus: buf(N * 4), cur: buf(N * 16),
  };
  const BATCH = 256;
  const stepBuf = buf(BATCH * ALIGN, GPUBufferUsage.UNIFORM | CD);
  const recBuf = buf((FT + FW + FM + 2) * ALIGN, GPUBufferUsage.UNIFORM | CD);
  const resBuf = buf(80, GPUBufferUsage.UNIFORM | CD);
  const prevRead = device.createBuffer({ size: 8192 * 8, usage: GPUBufferUsage.MAP_READ | CD });

  const report = (name, module) => module.getCompilationInfo?.().then((info) => { for (const m of info.messages) if (m.type === 'error') console.error(`${name}.wgsl ${m.lineNum}:${m.linePos} ${m.message}`); });
  const modSim = device.createShaderModule({ code: wgsl(NX, NY) }); report('sim', modSim);
  const modIO = device.createShaderModule({ code: wgslIO(NX, NY) }); report('io', modIO);
  const modRes = device.createShaderModule({ code: wgslResolve(NX, NY) }); report('resolve', modRes);
  const TIM = wgslTiming(NX, NY);
  const modAcc = device.createShaderModule({ code: TIM.acc }); report('accum', modAcc);
  const modTim = device.createShaderModule({ code: TIM.rec }); report('timing', modTim);

  const C = GPUShaderStage.COMPUTE;
  const st = (type) => ({ visibility: C, buffer: { type } });
  const L0 = device.createBindGroupLayout({ entries: [st('storage'), st('storage'), st('storage'), st('storage'), st('storage'), st('storage'), st('read-only-storage'), st('uniform')].map((e, binding) => ({ binding, ...e })) });
  const Ldyn = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true } }] });
  const plSim = device.createPipelineLayout({ bindGroupLayouts: [L0, Ldyn] });
  const mk = (module, layout, entryPoint) => device.createComputePipeline({ layout, compute: { module, entryPoint } });
  const K = Object.fromEntries(['sources', 'fluxes', 'carry', 'depth', 'erode', 'talusOut', 'talusIn'].map((e) => [e, mk(modSim, plSim, e)]));
  const g0 = device.createBindGroup({ layout: L0, entries: [B.cell, B.sA, B.sB, B.flux, B.aux, B.tout, B.stat, B.strata].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const gStep = device.createBindGroup({ layout: Ldyn, entries: [{ binding: 0, resource: { buffer: stepBuf, size: 32 } }] });

  const LIO = device.createBindGroupLayout({ entries: [st('read-only-storage'), st('read-only-storage'), st('read-only-storage'), st('read-only-storage'), st('storage'), st('storage'), st('storage'), st('storage')].map((e, binding) => ({ binding, ...e })) });
  const plIO = device.createPipelineLayout({ bindGroupLayouts: [LIO, Ldyn] });
  // instants des changements : cell, stat, acc, accW, recT, recWT
  const LT = device.createBindGroupLayout({ entries: [st('read-only-storage'), st('read-only-storage'), st('storage'), st('storage'), st('storage'), st('storage')].map((e, binding) => ({ binding, ...e })) });
  const plT = device.createPipelineLayout({ bindGroupLayouts: [LT, Ldyn] });
  const KT = { accum: mk(modAcc, plT, 'accum'), recBed: mk(modTim, plT, 'recBed'), recWaterTime: mk(modTim, plT, 'recWaterTime') };
  const gT = device.createBindGroup({ layout: LT, entries: [B.cell, B.stat, B.acc, B.accW, B.recT, B.recWT].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const KIO = { recMemory: mk(modIO, plIO, 'recMemory'), recWater: mk(modIO, plIO, 'recWater'), preview: mk(modIO, plIO, 'preview') };
  const gIO = device.createBindGroup({ layout: LIO, entries: [B.cell, B.sA, B.aux, B.stat, B.recT, B.recW, B.prev, B.recM].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const gRec = device.createBindGroup({ layout: Ldyn, entries: [{ binding: 0, resource: { buffer: recBuf, size: 16 } }] });
  {
    const a = new Uint32Array(((FT + FW + FM + 2) * ALIGN) / 4);
    for (let k = 0; k < FT; k++) a[(k * ALIGN) / 4] = k;
    for (let k = 0; k < FW; k++) a[((FT + k) * ALIGN) / 4] = k;
    for (let k = 0; k < FM; k++) a[((FT + FW + k) * ALIGN) / 4] = k;
    device.queue.writeBuffer(recBuf, 0, a);
  }

  // textures lues par les matériaux (three.js) : relief courant et eau courante
  const terrainTex = new THREE.StorageTexture(NX, NY);
  terrainTex.type = THREE.FloatType; terrainTex.format = THREE.RGBAFormat;
  terrainTex.minFilter = terrainTex.magFilter = THREE.NearestFilter; terrainTex.generateMipmaps = false;
  const waterTex = new THREE.StorageTexture(HX, HY);
  waterTex.type = THREE.FloatType; waterTex.format = THREE.RGBAFormat;
  waterTex.minFilter = waterTex.magFilter = THREE.NearestFilter; waterTex.generateMipmaps = false;
  const normalTex = new THREE.StorageTexture(NX, NY);
  normalTex.type = THREE.HalfFloatType; normalTex.format = THREE.RGBAFormat;
  normalTex.minFilter = normalTex.magFilter = THREE.LinearFilter; normalTex.generateMipmaps = false;
  const occTex = new THREE.StorageTexture(NX, NY);
  occTex.type = THREE.HalfFloatType; occTex.format = THREE.RGBAFormat;
  occTex.minFilter = occTex.magFilter = THREE.LinearFilter; occTex.generateMipmaps = false;
  renderer.initTexture(terrainTex); renderer.initTexture(waterTex); renderer.initTexture(normalTex); renderer.initTexture(occTex);
  const LR = device.createBindGroupLayout({
    entries: [st('read-only-storage'), st('read-only-storage'), st('read-only-storage'), st('read-only-storage'),
      { visibility: C, storageTexture: { access: 'write-only', format: 'rgba32float' } },
      { visibility: C, storageTexture: { access: 'write-only', format: 'rgba32float' } },
      st('storage'),
      { visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      { visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      st('read-only-storage'), st('read-only-storage')].map((e, binding) => ({ binding, ...e })),
  });
  const LRu = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform' } }] });
  const plR = device.createPipelineLayout({ bindGroupLayouts: [LR, LRu] });
  const KR = mk(modRes, plR, 'resolve'), KN = mk(modRes, plR, 'normals');
  const gR = device.createBindGroup({
    layout: LR,
    entries: [
      { binding: 0, resource: { buffer: B.recT } }, { binding: 1, resource: { buffer: B.recW } },
      { binding: 2, resource: { buffer: B.stat } }, { binding: 3, resource: { buffer: B.surplus } },
      { binding: 4, resource: renderer.backend.get(terrainTex).texture.createView() },
      { binding: 5, resource: renderer.backend.get(waterTex).texture.createView() },
      { binding: 6, resource: { buffer: B.cur } },
      { binding: 7, resource: renderer.backend.get(normalTex).texture.createView() },
      { binding: 8, resource: renderer.backend.get(occTex).texture.createView() },
      { binding: 9, resource: { buffer: B.recM } },
      { binding: 10, resource: { buffer: B.recWT } },
    ],
  });
  const gRu = device.createBindGroup({ layout: LRu, entries: [{ binding: 0, resource: { buffer: resBuf } }] });

  const groups = (n) => Math.ceil(n / WG);
  let spec = null, ran = false, b0 = null, final = null;
  // (partagé entre les simulations : une scène relancée ne doit pas copier dans le
  // tampon d'aperçu pendant que la précédente le lit encore)
  let previewBusy = false;

  // Prépare une scène : b₀, érodabilité, sources ; strates ; remise à zéro
  function setup({ b0: B0, strata, S, seed }) {
    spec = S; ran = false; final = null;
    b0 = B0;
    const stat = new Float32Array(N * 4);
    const srcW = new Float32Array(N);
    let sum = 0;
    if (S.src) {
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const x = (i + 0.5) * l, y = (j + 0.5) * l;
        const w = Math.exp(-(((x - S.src.x) / 0.012) ** 2) - (((y - S.src.y) / (S.src.w / 2)) ** 2) * 1.5);
        srcW[j * NX + i] = w > 0.02 ? w : 0; sum += srcW[j * NX + i];
      }
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const c = j * NX + i, x = (i + 0.5) * l;
      stat[c * 4] = B0[c];
      stat[c * 4 + 1] = 1 + PHYS.hetero * fbm(x * 30, (j + 0.5) * l * 30, (S.seed ?? 1) + 555, 3) * 1.4;
      stat[c * 4 + 2] = sum > 0 ? srcW[c] / (sum * l * l) : 0;
      stat[c * 4 + 3] = S.rain && x >= S.rain.x0 && x <= S.rain.x1 ? 1 : 0;
    }
    device.queue.writeBuffer(B.stat, 0, stat);
    const cell = new Float32Array(N * 4);
    for (let c = 0; c < N; c++) { cell[c * 4] = B0[c]; cell[c * 4 + 2] = B0[c]; }
    device.queue.writeBuffer(B.cell, 0, cell);
    // (accumulateurs des instants : la valeur précédente est la surface de départ)
    const ac = new Float32Array(N * 4);
    for (let c = 0; c < N; c++) ac[c * 4 + 3] = B0[c];
    device.queue.writeBuffer(B.acc, 0, ac); device.queue.writeBuffer(B.accW, 0, ac);
    for (const k of ['sA', 'sB', 'flux', 'aux', 'tout']) device.queue.writeBuffer(B[k], 0, new Float32Array(B[k].size / 4));
    const sg = new ArrayBuffer(16 + MAX_LAYERS * 16), su = new Uint32Array(sg), sf = new Float32Array(sg);
    su[0] = Math.min(MAX_LAYERS, strata.length);
    strata.slice(0, MAX_LAYERS).forEach((Lr, k) => { sf[4 + k * 4] = Lr.bottom; sf[5 + k * 4] = Lr.hard; });
    device.queue.writeBuffer(B.strata, 0, sg);
  }

  // Lance toute la simulation, en lots ; onFrame(k, FT, preview) après chaque
  // état du relief enregistré (aperçu 128 × 64 : [Δb, eau] entrelacés).
  async function run({ onProgress, onPreview, alive = () => true, until = Infinity } = {}) {
    const S = spec;
    const total = Math.ceil(Math.min(S.T, until) / dt);
    const tRec = Array.from({ length: FT }, (_, k) => Math.round((k / (FT - 1)) * total));
    const wRec = Array.from({ length: FW }, (_, k) => Math.round((k / (FW - 1)) * total));
    const mRec = Array.from({ length: FM }, (_, k) => Math.round((k / (FM - 1)) * total));
    let nT = 0, nW = 0, nM = 0, n = 0;
    const data = new ArrayBuffer(BATCH * ALIGN), f32 = new Float32Array(data);
    // position d'un pas dans l'intervalle d'enregistrement qui le contient (0–1)
    const frac = (rec) => { let k = 0; return (step) => { while (k < rec.length - 2 && rec[k + 1] <= step) k++; return Math.min(1, Math.max(0, (step + 0.5 - rec[k]) / Math.max(1, rec[k + 1] - rec[k]))); }; };
    const fT = frac(tRec), fW = frac(wRec);
    const t0 = performance.now();
    while (n <= total) {
      if (!alive()) return false;
      const m = Math.min(BATCH, total + 1 - n);
      for (let k = 0; k < m; k++) {
        const T = (n + k) * dt, o = (k * ALIGN) / 4;
        f32[o] = inflowAt(S, T); f32[o + 1] = rainAt(S, T); f32[o + 2] = baseAt(S, T); f32[o + 3] = S.morfac; f32[o + 4] = dt;
        f32[o + 5] = fT(n + k); f32[o + 6] = fW(n + k);
      }
      device.queue.writeBuffer(stepBuf, 0, data, 0, m * ALIGN);
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setBindGroup(0, g0);
      let wantPreview = false;
      for (let k = 0; k < m; k++) {
        const step = n + k;
        // enregistrements AVANT le pas `step` (l'état au temps step·dt)
        while (nT < FT && tRec[nT] === step) {
          pass.setPipeline(KT.recBed); pass.setBindGroup(0, gT); pass.setBindGroup(1, gRec, [nT * ALIGN]);
          pass.dispatchWorkgroups(groups(N / 2)); nT++; wantPreview = true;
        }
        while (nM < FM && mRec[nM] === step) {
          pass.setPipeline(KIO.recMemory); pass.setBindGroup(0, gIO); pass.setBindGroup(1, gRec, [(FT + FW + nM) * ALIGN]);
          pass.dispatchWorkgroups(groups(N)); nM++;
        }
        while (nW < FW && wRec[nW] === step) {
          pass.setPipeline(KIO.recWater); pass.setBindGroup(0, gIO); pass.setBindGroup(1, gRec, [(FT + nW) * ALIGN]);
          pass.dispatchWorkgroups(groups(HN));
          pass.setPipeline(KT.recWaterTime); pass.setBindGroup(0, gT); pass.setBindGroup(1, gRec, [(FT + nW) * ALIGN]);
          pass.dispatchWorkgroups(groups(HN)); nW++;
        }
        if (step === total) break;
        pass.setBindGroup(0, g0);
        pass.setBindGroup(1, gStep, [k * ALIGN]);
        for (const e of ['sources', 'fluxes', 'carry', 'depth', 'erode', 'talusOut', 'talusIn']) { pass.setPipeline(K[e]); pass.dispatchWorkgroups(groups(N)); }
        // (instant des changements de ce pas)
        pass.setPipeline(KT.accum); pass.setBindGroup(0, gT); pass.setBindGroup(1, gStep, [k * ALIGN]);
        pass.dispatchWorkgroups(groups(N));
      }
      if (wantPreview && onPreview && !previewBusy) {
        pass.setPipeline(KIO.preview); pass.setBindGroup(0, gIO); pass.setBindGroup(1, gRec, [0]);
        pass.dispatchWorkgroups(8192 / 64);
      }
      pass.end();
      if (wantPreview && onPreview && !previewBusy) enc.copyBufferToBuffer(B.prev, 0, prevRead, 0, 8192 * 8);
      device.queue.submit([enc.finish()]);
      if (wantPreview && onPreview && !previewBusy) {
        previewBusy = true;
        const k = nT;
        prevRead.mapAsync(GPUMapMode.READ).then(() => {
          const a = new Float32Array(prevRead.getMappedRange().slice(0));
          prevRead.unmap(); previewBusy = false;
          onPreview(a, k / FT);
        }, () => { previewBusy = false; });
      }
      n += m;
      onProgress?.(Math.min(1, n / total));
      await device.queue.onSubmittedWorkDone(); // (rend la main : l'écran de chargement reste fluide)
    }
    while (previewBusy) await device.queue.onSubmittedWorkDone();
    ran = true;
    return { steps: total, ms: performance.now() - t0 };
  }

  // Surplus poussé par la lame : ∫ (b_fin − b₀) dx depuis l'aval, lissé en
  // travers (le bourrelet s'étale le long de la lame). Calculé une fois sur
  // le processeur à partir du dernier état.
  async function finish() {
    final = await readTerrain(FT - 1);
    const sur = new Float32Array(N), row = new Float32Array(NX);
    for (let j = 0; j < NY; j++) {
      let acc = 0;
      for (let i = NX - 1; i >= 0; i--) { const c = j * NX + i; acc += Math.max(-0.02, final.b[c] - b0[c]) * l; row[i] = acc; sur[c] = acc; }
    }
    // lissage en travers (gaussienne de ~4 cm)
    const R = Math.round(0.04 / l), w = [];
    for (let k = -R; k <= R; k++) w.push(Math.exp(-((k / (R / 2)) ** 2)));
    const ws = w.reduce((a, b) => a + b, 0), out = new Float32Array(N);
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
      let a = 0;
      for (let k = -R; k <= R; k++) a += w[k + R] * sur[Math.min(NY - 1, Math.max(0, j + k)) * NX + i];
      out[j * NX + i] = Math.max(0, a / ws);
    }
    device.queue.writeBuffer(B.surplus, 0, out);
    return final;
  }

  // lecture d'un état enregistré (tests, surplus, mise au point)
  async function readTerrain(k) {
    // (la mémoire : l'état enregistré le plus proche dans le temps)
    const km = Math.round((k / (FT - 1)) * (FM - 1));
    const rb = device.createBuffer({ size: N * 6, usage: GPUBufferUsage.MAP_READ | CD });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(B.recT, k * N * 2, rb, 0, N * 2);
    enc.copyBufferToBuffer(B.recM, km * N * 4, rb, N * 2, N * 4);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const u = new Uint16Array(rb.getMappedRange().slice(0));
    rb.unmap(); rb.destroy();
    const b = new Float32Array(N), bmin = new Float32Array(N), wet = new Float32Array(N), rip = new Float32Array(N);
    const h = THREE.DataUtils.fromHalfFloat, M = N;
    for (let c = 0; c < N; c++) {
      b[c] = b0[c] + h(u[c]);
      bmin[c] = Math.min(b[c], b0[c] + h(u[M + c * 2]));
      const hi = u[M + c * 2 + 1]; wet[c] = (hi & 255) / 255; rip[c] = (hi >> 8) / 255;
    }
    return { b, bmin, wet, rip };
  }
  // le relief courant, tel que la dernière relecture l'a écrit (mise au point : fluidité)
  async function readCur() {
    const rb = device.createBuffer({ size: N * 16, usage: GPUBufferUsage.MAP_READ | CD });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(B.cur, 0, rb, 0, N * 16);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(rb.getMappedRange().slice(0));
    rb.unmap(); rb.destroy();
    return a;
  }
  // lecture d'un état enregistré de l'eau (mise au point) : surface libre − b₀ (−1 : sec), turbidité, vitesse
  async function readWater(k) {
    const rb = device.createBuffer({ size: HN * 8, usage: GPUBufferUsage.MAP_READ | CD });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(B.recW, k * HN * 8, rb, 0, HN * 8);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const u = new Uint16Array(rb.getMappedRange().slice(0));
    rb.unmap(); rb.destroy();
    const h = THREE.DataUtils.fromHalfFloat, out = new Float32Array(HN * 4);
    for (let i = 0; i < HN * 4; i++) out[i] = h(u[i]);
    return out;
  }
  // l'état courant de la simulation (cell : b, d, bmin, humidité)
  async function readCell() {
    const rb = device.createBuffer({ size: N * 16, usage: GPUBufferUsage.MAP_READ | CD });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(B.cell, 0, rb, 0, N * 16);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(rb.getMappedRange().slice(0));
    rb.unmap(); rb.destroy();
    return a;
  }

  // Relecture à l'image : st = { tT (0–FT−1, réel), tW (0–FW−1), water (0/1), screed (m ; −1 : bac entier régalé ; −2 : pas de gabarit), bead, bermTan }
  const resData = new ArrayBuffer(80), ru = new Uint32Array(resData), rf = new Float32Array(resData);
  function resolve(s) {
    const tT = Math.min(FT - 1, Math.max(0, s.tT)), tW = Math.min(FW - 1, Math.max(0, s.tW));
    const a = Math.min(FT - 2, Math.floor(tT)), w = Math.min(FW - 2, Math.floor(tW));
    const tM = (tT / (FT - 1)) * (FM - 1), m = Math.min(FM - 2, Math.floor(tM));
    ru[0] = a; ru[1] = a + 1; ru[2] = w; ru[3] = w + 1;
    rf[4] = tT - a; rf[5] = tW - w; rf[6] = s.water ?? 1; rf[7] = s.screed ?? -2;
    rf[8] = s.bermTan ?? 0.67; rf[9] = s.bead ?? 0.003; rf[10] = s.drain ?? 0; rf[11] = tM - m;
    ru[12] = Math.max(0, a - 1); ru[13] = Math.min(FT - 1, a + 2); ru[14] = m; ru[15] = m + 1;
    const lp = s.light ?? [0, 10, 0];
    rf[16] = lp[0]; rf[17] = lp[1]; rf[18] = lp[2]; rf[19] = s.lightPen ?? 0.015;
    device.queue.writeBuffer(resBuf, 0, resData);
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(KR); pass.setBindGroup(0, gR); pass.setBindGroup(1, gRu);
    pass.dispatchWorkgroups(Math.ceil(NX / 8), Math.ceil(NY / 8));
    pass.setPipeline(KN);
    pass.dispatchWorkgroups(Math.ceil(NX / 8), Math.ceil(NY / 8));
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  return {
    NX, NY, HX, HY, FT, FW, FM, dt, l, terrainTex, waterTex, normalTex, occTex,
    setup, run, finish, resolve, readTerrain, readWater, readCur, readCell,
    get ran() { return ran; },
    get final() { return final; },
    bytes: () => Object.values(B).reduce((a, b) => a + b.size, 0),
  };
}
