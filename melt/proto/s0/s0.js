// Prototype s0 : une trémie de bismuth qui fond pour de vrai.
//
// 1. Simulation (WGSL, au chargement) : problème de Stefan par la méthode de
//    l'enthalpie sur une grille 3D (voir sim.mjs, même modèle). La croûte du
//    fond fond sous la grappe, chauffée par le creuset : le cristal descend
//    dans le bain (dans son repère, le bain monte : c'est ce que calcule la
//    simulation ; le rendu remet le bain fixe). Le panache d'air chaud du bain
//    chauffe le cristal ; les parois
//    minces et les arêtes fondent d'abord ; le liquide s'égoutte dans le bain.
//    On note l'instant τ où chaque cellule fond.
// 2. Rendu : le cristal à l'instant u est { trémie } ∩ { τ > u }. La distance
//    vient de la trémie analytique (faces d'origine, nettes) et de
//    φ = (u − τ)·v, avec v = 1/|∇τ| la vitesse du front (faces fondues). Les
//    faces fondues sont du métal liquide (argent, sans oxyde) ; les autres
//    gardent leur oxyde.
//
// URL : ?u=0.5 (instant de la remontée) &h=0.025 (pas de la grille) &sink=8097
import { P0, level } from './sim.mjs';
import { MOODS } from '../../src/recipe.js';

const params = new URLSearchParams(location.search);
const W = 1280, H = 800;
const P = { ...P0, h: +(params.get('h') ?? 0.02), ...JSON.parse(params.get('p') ?? '{}') }; // (?p={"a":0.8} : réglages à l'essai)
const NX = Math.round((2 * P.X) / P.h), NY = Math.round(P.Y / P.h), NZ = NX, N = NX * NY * NZ;

const COMMON = /* wgsl */ `
struct S {
  dims: vec4f,   // nx, ny, nz, h
  box: vec4f,    // X, Y, dt, steps
  crys: vec4f,   // s, cy, ang, tilt
  tide: vec4f,   // LL, LH, exposant, air ambiant
  heat: vec4f,   // alpha, T0, Tb, Lh
  xch: vec4f,    // hb, ha, a, lambda
  fall: vec4f,   // vitesse d'enfoncement du cristal sans appui, température de la croûte, —, —
};
fn rotY(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
fn rotX(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
fn hopper(p: vec3f, s: f32, cy: f32, ang: f32, tilt: f32) -> f32 {
  let q = rotX(rotY(p - vec3f(0.0, cy, 0.0), ang), tilt);
  let b = abs(q) - vec3f(s);
  let dbox = length(max(b, vec3f(0.0))) + min(max(b.x, max(b.y, b.z)), 0.0);
  let a = abs(q);
  var n = 0.0; var t = vec2f(0.0);
  if (a.x >= a.y && a.x >= a.z) { n = a.x; t = q.yz; } else if (a.y >= a.z) { n = a.y; t = q.xz; } else { n = a.z; t = q.xy; }
  // (la base a poussé sur la croûte : une soudure pleine, pas une face en trémie)
  if (q.y < -max(a.x, a.z)) { return dbox; }
  let w = s * 0.11;
  let rim = s - max(abs(t.x), abs(t.y));
  let k = min(floor(rim / w), 7.0);
  let depth = k * w * 0.75;
  var dcav = n - (s - depth);
  if (k > 0.5) { let up = (k - 1.0) * w * 0.75; let lat = rim - k * w; dcav = min(dcav, length(vec2f(lat, max(n - (s - up), 0.0)))); }
  return max(dbox, dcav);
}
fn level(u: f32, S0: S) -> f32 { return S0.tide.x + (S0.tide.y - S0.tide.x) * pow(clamp(u, 0.0, 1.0), S0.tide.z); }
`;

const SIM = COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> S0: S;
@group(0) @binding(1) var<storage, read> Hin: array<f32>;
@group(0) @binding(2) var<storage, read_write> Hout: array<f32>;
@group(0) @binding(3) var<storage, read_write> tau: array<f32>;
// ctr : pas, plus basse cellule solide (atomicMin), niveau du bain dans le
// repère du cristal, enfoncement du cristal (bits de f32)
@group(0) @binding(4) var<storage, read_write> ctr: array<atomic<u32>, 4>;
@group(0) @binding(8) var<storage, read_write> hist: array<f32>;
fn nx() -> i32 { return i32(S0.dims.x); } fn ny() -> i32 { return i32(S0.dims.y); } fn nz() -> i32 { return i32(S0.dims.z); }
fn id3(i: i32, j: i32, k: i32) -> i32 { return i + nx() * (j + ny() * k); }
fn Tof(e: f32) -> f32 { if (e < 0.0) { return e; } if (e > S0.heat.w) { return e - S0.heat.w; } return 0.0; }

@compute @workgroup_size(64)
fn init(@builtin(global_invocation_id) g: vec3u) {
  let id = i32(g.x); if (id >= nx() * ny() * nz()) { return; }
  let i = id % nx(); let j = (id / nx()) % ny(); let k = id / (nx() * ny());
  let h = S0.dims.w;
  let p = vec3f(-S0.box.x + (f32(i) + 0.5) * h, (f32(j) + 0.5) * h, -S0.box.x + (f32(k) + 0.5) * h);
  if (hopper(p, S0.crys.x, S0.crys.y, S0.crys.z, S0.crys.w) < 0.0) { Hout[id] = S0.heat.y; tau[id] = 99.0; }
  else { Hout[id] = 0.0; tau[id] = -1.0; }
  if (id == 0) { atomicStore(&ctr[0], 0u); atomicStore(&ctr[1], 999999u); atomicStore(&ctr[2], bitcast<u32>(S0.tide.x)); atomicStore(&ctr[3], 0u); }
}
@compute @workgroup_size(1)
fn advance() {
  // l'appui : la section du solide au ras du bain. Quand la taille a fondu
  // (section < 15 % de celle du cristal), le bloc au-dessus n'est plus porté :
  // il s'enfonce dans le bain jusqu'à reposer sur une section plus large
  let s = atomicLoad(&ctr[0]) + 1u; atomicStore(&ctr[0], s);
  let u = f32(s) * S0.box.z; let L = level(u, S0);
  var d = bitcast<f32>(atomicLoad(&ctr[3]));
  let h = S0.dims.w;
  let A = f32(atomicLoad(&ctr[1])) * h * h;
  if (A < 0.15 * 4.0 * S0.crys.x * S0.crys.x && L + d < S0.box.y - 0.1) { d += S0.fall.x * S0.box.z; }
  atomicStore(&ctr[3], bitcast<u32>(d));
  atomicStore(&ctr[2], bitcast<u32>(L + d));
  atomicStore(&ctr[1], 0u);
  if (s < arrayLength(&hist)) { hist[s] = d; }
}
@compute @workgroup_size(64)
fn step(@builtin(global_invocation_id) g: vec3u) {
  let id = i32(g.x); if (id >= nx() * ny() * nz()) { return; }
  let dt = S0.box.z; let u = f32(atomicLoad(&ctr[0])) * dt;
  let e0 = Hin[id];
  if (tau[id] <= u) { Hout[id] = e0; return; }
  let i = id % nx(); let j = (id / nx()) % ny(); let k = id / (nx() * ny());
  let h = S0.dims.w; let L = bitcast<f32>(atomicLoad(&ctr[2])); // (le bain, dans le repère du cristal)
  let K = S0.heat.x / (h * h); let Hb = S0.xch.x / h; let Ha = S0.xch.y / h;
  let T = Tof(e0);
  var f = 0.0;
  let off = array<vec3i, 6>(vec3i(-1, 0, 0), vec3i(1, 0, 0), vec3i(0, -1, 0), vec3i(0, 1, 0), vec3i(0, 0, -1), vec3i(0, 0, 1));
  for (var m = 0; m < 6; m++) {
    let q = vec3i(i, j, k) + off[m];
    if (q.y < 0) { f += K * (S0.fall.y - T); continue; } // la croûte du fond : solide, plus froide (le creuset gèle par le bas), elle tient le pied
    let y = (f32(q.y) + 0.5) * h;
    if (q.x >= 0 && q.x < nx() && q.y < ny() && q.z >= 0 && q.z < nz()) {
      let o = id3(q.x, q.y, q.z);
      if (tau[o] > u) { f += K * (Tof(Hin[o]) - T); continue; }
    }
    // (une cellule voisine en partie noyée échange au prorata : sans cela, le
    // bain monte par couches entières et la fonte se strie)
    let wet = clamp((L - (y - 0.5 * h)) / h, 0.0, 1.0);
    f += wet * Hb * (S0.heat.z - T) + (1.0 - wet) * Ha * (S0.tide.w + (S0.heat.z * S0.xch.z - S0.tide.w) * exp(-max(y - L, 0.0) / S0.xch.w) - T);
  }
  let e = e0 + dt * f;
  Hout[id] = e;
  let half = 0.5 * S0.heat.w;
  if (e >= half) { tau[id] = u + dt * (half - e0) / max(e - e0, 1e-9); } else if ((f32(j) + 0.5) * h >= L && (f32(j) + 0.5) * h < L + 2.0 * h) { atomicAdd(&ctr[1], 1u); }
}

// le champ relu par le rendu : (τ, vitesse du front v = 1/|∇τ|), en trois
// temps : remplir l'air au bord de la trémie, lisser (la méthode de l'enthalpie
// fond une cellule à la fois : τ fait des marches d'une cellule), dériver
@group(0) @binding(5) var field: texture_storage_3d<rgba16float, write>;
@group(0) @binding(6) var<storage, read_write> tA: array<f32>;
@group(0) @binding(7) var<storage, read_write> tB: array<f32>;
fn cl3(q: vec3i) -> i32 { let r = clamp(q, vec3i(0), vec3i(nx() - 1, ny() - 1, nz() - 1)); return id3(r.x, r.y, r.z); }
@compute @workgroup_size(4, 4, 4)
fn fill(@builtin(global_invocation_id) g: vec3u) {
  let q = vec3i(g); if (q.x >= nx() || q.y >= ny() || q.z >= nz()) { return; }
  var v = tau[id3(q.x, q.y, q.z)];
  if (v < 0.0) {
    // (cellule d'air : prend l'instant de ses voisines solides, pour que
    // l'interpolation ne creuse pas de fausse surface au bord de la trémie)
    var m = -1.0;
    for (var a = -1; a <= 1; a++) { for (var b = -1; b <= 1; b++) { for (var c = -1; c <= 1; c++) {
      m = max(m, tau[cl3(q + vec3i(a, b, c))]);
    } } }
    v = max(m, 0.0);
  }
  tA[id3(q.x, q.y, q.z)] = min(v, 1.4);
}
@compute @workgroup_size(4, 4, 4)
fn blurAB(@builtin(global_invocation_id) g: vec3u) {
  let q = vec3i(g); if (q.x >= nx() || q.y >= ny() || q.z >= nz()) { return; }
  var s = 0.0; var w = 0.0;
  for (var a = -1; a <= 1; a++) { for (var b = -1; b <= 1; b++) { for (var c = -1; c <= 1; c++) {
    let k = 1.0 / f32(1 + abs(a) + abs(b) + abs(c));
    s += k * tA[cl3(q + vec3i(a, b, c))]; w += k;
  } } }
  tB[id3(q.x, q.y, q.z)] = s / w;
}
@compute @workgroup_size(4, 4, 4)
fn blurBA(@builtin(global_invocation_id) g: vec3u) {
  let q = vec3i(g); if (q.x >= nx() || q.y >= ny() || q.z >= nz()) { return; }
  var s = 0.0; var w = 0.0;
  for (var a = -1; a <= 1; a++) { for (var b = -1; b <= 1; b++) { for (var c = -1; c <= 1; c++) {
    let k = 1.0 / f32(1 + abs(a) + abs(b) + abs(c));
    s += k * tB[cl3(q + vec3i(a, b, c))]; w += k;
  } } }
  tA[id3(q.x, q.y, q.z)] = s / w;
}
@compute @workgroup_size(4, 4, 4)
fn bake(@builtin(global_invocation_id) g: vec3u) {
  let q = vec3i(g); if (q.x >= nx() || q.y >= ny() || q.z >= nz()) { return; }
  let t = tB[id3(q.x, q.y, q.z)];
  let gr = vec3f(tB[cl3(q + vec3i(1, 0, 0))] - tB[cl3(q - vec3i(1, 0, 0))], tB[cl3(q + vec3i(0, 1, 0))] - tB[cl3(q - vec3i(0, 1, 0))], tB[cl3(q + vec3i(0, 0, 1))] - tB[cl3(q - vec3i(0, 0, 1))]) / (2.0 * S0.dims.w);
  let v = clamp(1.0 / max(length(gr), 1e-4), 0.02, 30.0);
  textureStore(field, q, vec4f(t, v, 0.0, 0.0));
}
`;

const RENDER = COMMON + /* wgsl */ `
struct R {
  res: vec4f, cam: vec4f, camF: vec4f, camR: vec4f, camU: vec4f,
  st: vec4f,      // u (fonte), vitesse d'oxydation, image, descente du cristal
  envLo: vec4f, envHi: vec4f, forge: vec4f,
  boxes: array<vec4f, 18>,
};
@group(0) @binding(0) var<uniform> S0: S;
@group(0) @binding(1) var<uniform> u: R;
@group(0) @binding(2) var fieldT: texture_3d<f32>;
@group(0) @binding(3) var smp: sampler;
@group(0) @binding(4) var<storage, read_write> acc: array<vec4f>;
const PI = 3.14159265;
fn hash31(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
fn noise3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3f(1,0,0)), w.x), mix(hash31(i + vec3f(0,1,0)), hash31(i + vec3f(1,1,0)), w.x), w.y),
             mix(mix(hash31(i + vec3f(0,0,1)), hash31(i + vec3f(1,0,1)), w.x), mix(hash31(i + vec3f(0,1,1)), hash31(i + vec3f(1,1,1)), w.x), w.y), w.z);
}
fn smin(a: f32, b: f32, k: f32) -> f32 { let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

fn fieldAt(p: vec3f) -> vec2f {
  let uvw = vec3f((p.x + S0.box.x) / (2.0 * S0.box.x), p.y / S0.box.y, (p.z + S0.box.x) / (2.0 * S0.box.x));
  return textureSampleLevel(fieldT, smp, uvw, 0.0).xy;
}
// (distance, part fondue de la surface : 0 face d'origine, 1 face fondue)
var<private> MELTED: f32;
fn crystal(pw: vec3f) -> f32 {
  let p = pw + vec3f(0.0, u.st.w, 0.0); // (repère du cristal : il est descendu de u.st.w)
  let dh = hopper(p, S0.crys.x, S0.crys.y, S0.crys.z, S0.crys.w);
  if (dh > 0.08) { MELTED = 0.0; return dh; }
  let F = fieldAt(p);
  let phi = (u.st.x - F.x) * F.y;
  MELTED = smoothstep(-0.01, 0.01, phi - dh);
  return max(dh, phi);
}
fn scene(p: vec3f) -> f32 {
  let L = S0.tide.x; // (le bain reste à sa hauteur : c'est le cristal qui descend)
  return smin(crystal(p), p.y - L, 0.03); // le ménisque : le bain mouille le cristal
}
fn nrm(p: vec3f) -> vec3f {
  let e = 0.002; let k = vec2f(1.0, -1.0);
  return normalize(k.xyy * scene(p + k.xyy * e) + k.yyx * scene(p + k.yyx * e) + k.yxy * scene(p + k.yxy * e) + k.xxx * scene(p + k.xxx * e));
}
fn rect(d: vec3f, c: vec3f, up: vec3f, hw: f32, hh: f32) -> f32 {
  let cc = dot(d, c); if (cc <= 0.0) { return 0.0; }
  let r = normalize(cross(c, up)); let v = cross(r, c);
  let q = d / cc;
  return (1.0 - smoothstep(hw * 0.85, hw, abs(dot(q, r)))) * (1.0 - smoothstep(hh * 0.85, hh, abs(dot(q, v))));
}
fn env(d: vec3f) -> vec3f {
  var c = mix(u.envLo.xyz, u.envHi.xyz, smoothstep(0.12, 0.75, d.y));
  for (var b = 0; b < 6; b++) {
    let A = u.boxes[3 * b]; let B = u.boxes[3 * b + 1]; let Cb = u.boxes[3 * b + 2];
    if (A.w <= 0.0) { continue; }
    c += B.xyz * A.w * rect(d, A.xyz, Cb.xyz, B.w, Cb.w);
  }
  if (u.forge.w > 0.0) { c += u.forge.xyz * u.forge.w * smoothstep(0.25, -0.15, d.y); }
  return c;
}
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
fn cdiv(a: vec2f, b: vec2f) -> vec2f { let d = dot(b, b); return vec2f(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d; }
fn filmR(th: f32, lam: f32, cosi: f32) -> f32 {
  let n1 = 2.2; let n2 = vec2f(1.9, 3.4);
  let r01 = vec2f((1.0 - n1) / (1.0 + n1), 0.0);
  let r12 = cdiv(vec2f(n1, 0.0) - n2, vec2f(n1, 0.0) + n2);
  let sint = sqrt(max(0.0, 1.0 - cosi * cosi)) / n1;
  let dl = 4.0 * PI * n1 * th * sqrt(1.0 - sint * sint) / lam;
  let e = vec2f(cos(dl), sin(dl));
  let r = cdiv(r01 + cmul(r12, e), vec2f(1.0, 0.0) + cmul(r01, cmul(r12, e)));
  return dot(r, r);
}
fn filmRGB(th: f32, cosi: f32) -> vec3f {
  return vec3f(0.5 * filmR(th, 610.0, cosi) + 0.5 * filmR(th, 650.0, cosi),
               0.5 * filmR(th, 530.0, cosi) + 0.5 * filmR(th, 560.0, cosi),
               0.5 * filmR(th, 450.0, cosi) + 0.5 * filmR(th, 480.0, cosi));
}

fn trace(ro0: vec3f, rd0: vec3f) -> vec3f {
  var ro = ro0; var rd = rd0; var T = vec3f(1.0); var Lc = vec3f(0.0);
  let L = S0.tide.x; // (le bain reste à sa hauteur : c'est le cristal qui descend)
  for (var b = 0; b < 4; b++) {
    var t = 0.003; var hit = false; var water = false;
    // (boîte de la grille : au-delà, seulement le bain ou le studio)
    let bmin = vec3f(-S0.box.x, -u.st.w, -S0.box.x); let bmax = vec3f(S0.box.x, S0.box.y - u.st.w, S0.box.x);
    let inv = 1.0 / rd; let t0 = (bmin - ro) * inv; let t1 = (bmax - ro) * inv;
    let tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z)); let tf = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
    // (le bain d'abord : la marche s'arrête à sa surface)
    var tp = 1e9; if (rd.y < -1e-4 && ro.y > L) { tp = (L - ro.y) / rd.y; }
    if (min(tf, tp) > max(tn, 0.0)) {
      t = max(tn, 0.003);
      for (var i = 0; i < 300; i++) {
        let d = scene(ro + rd * t);
        if (d < 0.0004 + 0.0004 * t) { hit = true; break; }
        t += max(d * 0.6, 0.0006);
        if (t > min(tf, tp)) { break; }
      }
    }
    if (!hit) {
      if (tp < 1e8) { t = tp; hit = true; water = true; }
      else { Lc += T * env(rd); break; }
    }
    let p = ro + rd * t;
    var n = vec3f(0.0, 1.0, 0.0);
    let dc = crystal(p);
    if (!water && dc < 0.02) { n = nrm(p); } else { water = true; }
    let cosi = clamp(-dot(rd, n), 0.0, 1.0);
    var R = vec3f(0.6);
    if (water || dc > 0.006) {
      R = filmRGB(12.0, cosi); // le bain (et le ménisque) : métal nu, à peine voilé
    } else {
      // l'oxyde : plus épais en haut (sorti du bain plus tôt), épaissi par la
      // chaleur juste au-dessus de la ligne ; une face fondue est du métal liquide
      // (âge à l'air au bas de la marée, en boucles : le haut est sorti le premier)
      let age = 0.30 + 0.24 * clamp((p.y + u.st.w - S0.tide.x) / (S0.tide.y - S0.tide.x), 0.0, 1.0);
      var th = u.st.y * 300.0 * sqrt(age) + 14.0 * (noise3(p * 2.5) - 0.5);
      th += 140.0 * smoothstep(0.0, 0.1, u.st.x) * exp(-max(p.y - L, 0.0) / 0.9);
      R = mix(filmRGB(th, cosi), filmRGB(8.0, cosi), MELTED);
    }
    T *= R;
    ro = p + n * 0.003; rd = reflect(rd, n);
    if (b == 3) { Lc += T * env(rd); }
  }
  return Lc;
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = u.res.xy;
  if (f32(gid.x) >= res.x || f32(gid.y) >= res.y) { return; }
  let k = u.st.z;
  let jit = vec2f(fract(k * 0.7548777), fract(k * 0.5698403)) - 0.5;
  let uv = (vec2f(gid.xy) + 0.5 + jit) / res;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let th = u.cam.w;
  let rd = normalize(u.camF.xyz + ndc.x * th * (res.x / res.y) * u.camR.xyz + ndc.y * th * u.camU.xyz);
  let c = min(trace(u.cam.xyz, rd), vec3f(24.0));
  let idx = gid.y * u32(res.x) + gid.x;
  if (k < 0.5) { acc[idx] = vec4f(c, 1.0); } else { acc[idx] += vec4f(c, 1.0); }
}
`;

const SHOW = /* wgsl */ `
@group(0) @binding(0) var<storage, read> acc: array<vec4f>;
@group(0) @binding(1) var<uniform> info: vec4f;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var P = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(P[i], 0.0, 1.0);
}
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let a = acc[u32(fc.y) * u32(info.x) + u32(fc.x)];
  var c = a.rgb / max(a.w, 1.0) * info.z;
  let q = fc.xy / info.xy - 0.5; c *= 1.0 - 0.4 * dot(q, q);
  return vec4f(pow(aces(c), vec3f(1.0 / 2.2)), 1.0);
}
`;

async function compile(device, code, label) {
  const mod = device.createShaderModule({ code, label });
  const ci = await mod.getCompilationInfo();
  const errs = ci.messages.filter((m) => m.type === 'error');
  if (errs.length) throw new Error(`${label} : ` + errs.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join(' | '));
  return mod;
}

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
  device.addEventListener('uncapturederror', (e) => { console.error(e.error.message); window.__err = e.error.message; });
  const canvas = document.querySelector('#c'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('webgpu'); const fmt = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format: fmt, alphaMode: 'opaque' });
  const info = document.querySelector('#info');

  // ── la simulation ──
  const K = P.alpha / (P.h * P.h), dt = 0.9 / (6 * K + P.hb / P.h), steps = Math.ceil(P.uEnd / dt);
  const S = new Float32Array([NX, NY, NZ, P.h, P.X, P.Y, dt, steps, P.s, P.cy, P.ang, P.tilt, P.LL, P.LH, P.rise, P.amb, P.alpha, P.T0, P.Tb, P.Lh, P.hb, P.ha, P.a, P.lam, 6, P.crust, 0, 0]);
  const sbuf = device.createBuffer({ size: S.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(sbuf, 0, S);
  const mkS = (n) => device.createBuffer({ size: n * 4, usage: GPUBufferUsage.STORAGE });
  const Hb0 = mkS(N), Hb1 = mkS(N), tauB = mkS(N), ctr = mkS(4), tA = mkS(N), tB = mkS(N), histB = device.createBuffer({ size: (steps + 1) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const field = device.createTexture({ size: [NX, NY, NZ], dimension: '3d', format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const smod = await compile(device, SIM, 'sim');
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
    { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ] });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipe = (entryPoint) => device.createComputePipeline({ layout: pl, compute: { module: smod, entryPoint } });
  const pInit = pipe('init'), pStep = pipe('step'), pAdv = pipe('advance'), pFill = pipe('fill'), pBAB = pipe('blurAB'), pBBA = pipe('blurBA'), pBake = pipe('bake');
  const fview = field.createView();
  const bg = (a, b) => device.createBindGroup({ layout, entries: [
    { binding: 0, resource: { buffer: sbuf } }, { binding: 1, resource: { buffer: a } }, { binding: 2, resource: { buffer: b } },
    { binding: 3, resource: { buffer: tauB } }, { binding: 4, resource: { buffer: ctr } }, { binding: 5, resource: fview },
    { binding: 6, resource: { buffer: tA } }, { binding: 7, resource: { buffer: tB } }, { binding: 8, resource: { buffer: histB } }] });
  const g01 = bg(Hb0, Hb1), g10 = bg(Hb1, Hb0);
  const nwg = Math.ceil(N / 64);
  const t0 = performance.now();
  {
    const enc = device.createCommandEncoder(); const p = enc.beginComputePass();
    p.setPipeline(pInit); p.setBindGroup(0, g10); p.dispatchWorkgroups(Math.min(nwg, 65535), Math.ceil(nwg / 65535)); p.end();
    device.queue.submit([enc.finish()]);
  }
  // (plus de 65 535 groupes : grille 2D de groupes, l'index linéaire est recomposé)
  if (nwg > 65535) throw new Error('grille trop grande pour une dispatch 1D');
  const CH = 100;
  for (let s0 = 0; s0 < steps; s0 += CH) {
    const enc = device.createCommandEncoder(); const p = enc.beginComputePass();
    for (let s = s0; s < Math.min(steps, s0 + CH); s++) {
      p.setPipeline(pStep); p.setBindGroup(0, s % 2 ? g10 : g01); p.dispatchWorkgroups(nwg);
      p.setPipeline(pAdv); p.dispatchWorkgroups(1);
    }
    p.end(); device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    info.textContent = `simulation : ${Math.min(steps, s0 + CH)} / ${steps} pas`;
  }
  {
    const enc = device.createCommandEncoder(); const p = enc.beginComputePass();
    const d3 = [Math.ceil(NX / 4), Math.ceil(NY / 4), Math.ceil(NZ / 4)];
    p.setBindGroup(0, g01);
    p.setPipeline(pFill); p.dispatchWorkgroups(...d3);
    // (trois passes : la tension superficielle lisse les faces fondues)
    for (const bp of [pBAB, pBBA, pBAB]) { p.setPipeline(bp); p.dispatchWorkgroups(...d3); }
    p.setPipeline(pBake); p.dispatchWorkgroups(...d3); p.end();
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  const simMs = performance.now() - t0;
  // l'enfoncement du cristal à chaque pas, relu pour le rendu
  const drop = await (async () => {
    const rb = device.createBuffer({ size: (steps + 1) * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(histB, 0, rb, 0, (steps + 1) * 4); device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ); const a = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); return a;
  })();
  const dropAt = (u) => drop[Math.max(0, Math.min(steps, Math.round(u / dt)))];

  // ── le rendu ──
  const rmod = await compile(device, RENDER, 'rendu');
  const rpipe = device.createComputePipeline({ layout: 'auto', compute: { module: rmod, entryPoint: 'main' } });
  const NU = 9 * 4 + 18 * 4;
  const U = new Float32Array(NU);
  const ubuf = device.createBuffer({ size: NU * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const abuf = device.createBuffer({ size: W * H * 16, usage: GPUBufferUsage.STORAGE });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const rbg = device.createBindGroup({ layout: rpipe.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: sbuf } }, { binding: 1, resource: { buffer: ubuf } },
    { binding: 2, resource: field.createView() }, { binding: 3, resource: sampler }, { binding: 4, resource: { buffer: abuf } }] });
  const shmod = await compile(device, SHOW, 'affichage');
  const mkShow = (format) => device.createRenderPipeline({ layout: 'auto', vertex: { module: shmod, entryPoint: 'vs' }, fragment: { module: shmod, entryPoint: 'fs', targets: [{ format }] } });
  const pShowC = mkShow(fmt), pShowO = mkShow('rgba8unorm');
  const ibuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const outTex = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const sbgC = device.createBindGroup({ layout: pShowC.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: abuf } }, { binding: 1, resource: { buffer: ibuf } }] });
  const sbgO = device.createBindGroup({ layout: pShowO.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: abuf } }, { binding: 1, resource: { buffer: ibuf } }] });
  const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  async function render({ u = 0.4, mood = 'forge', ox = 1.45, cam = [2.1, 2.5, 5.4], tgt = [0, 0.75, 0], fov = 30, spp = 16, exposure = 1 } = {}) {
    const M = MOODS[mood];
    const f = norm(cam.map((c, i) => tgt[i] - c)), r = norm(cross(f, [0, 1, 0])), up = cross(r, f);
    U.fill(0);
    U.set([W, H, 0, 0], 0); U.set([...cam, Math.tan((fov * Math.PI) / 360)], 4);
    U.set([...f, 0], 8); U.set([...r, 0], 12); U.set([...up, 0], 16);
    // (la croûte fond sous la grappe : le cristal descend dans le bain)
    U.set([u, ox, 0, level(u, P) - P.LL + dropAt(u)], 20); U.set([...M.lo, 0], 24); U.set([...M.hi, 0], 28); U.set([...M.forge.color, M.forge.strength], 32);
    M.boxes.slice(0, 6).forEach((b, k) => { U.set([...norm(b.dir), b.I], 36 + 12 * k); U.set([...b.color, b.hw], 40 + 12 * k); U.set([...(b.up ?? [0, 1, 0]), b.hh], 44 + 12 * k); });
    device.queue.writeBuffer(ibuf, 0, new Float32Array([W, H, exposure * M.grade.exposure, 0]));
    for (let k = 0; k < spp; k++) {
      U[22] = k; device.queue.writeBuffer(ubuf, 0, U);
      const enc = device.createCommandEncoder(); const p = enc.beginComputePass();
      p.setPipeline(rpipe); p.setBindGroup(0, rbg); p.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8)); p.end();
      device.queue.submit([enc.finish()]);
    }
    const enc = device.createCommandEncoder();
    for (const [pp, view, g] of [[pShowC, ctx.getCurrentTexture().createView(), sbgC], [pShowO, outTex.createView(), sbgO]]) {
      const p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      p.setPipeline(pp); p.setBindGroup(0, g); p.draw(3); p.end();
    }
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  async function send(name) {
    const bpr = W * 4;
    const buf = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: outTex }, { buffer: buf, bytesPerRow: bpr }, [W, H]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const img = new ImageData(new Uint8ClampedArray(buf.getMappedRange().slice(0)), W, H);
    buf.unmap(); buf.destroy();
    const c = new OffscreenCanvas(W, H); c.getContext('2d').putImageData(img, 0, 0);
    await fetch(`http://127.0.0.1:${params.get('sink') ?? 8097}/${name}`, { method: 'POST', body: await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }) });
  }
  window.s0 = { render, send, simMs, steps, dims: [NX, NY, NZ], dropAt };
  info.textContent = `grille ${NX}×${NY}×${NZ}, ${steps} pas, ${(simMs / 1000).toFixed(1)} s`;
  await render({ u: +(params.get('u') ?? 0.4), spp: 4 });
  window.__ready = true;
}
main().catch((e) => { console.error(e); window.__err = String(e.message ?? e); });
